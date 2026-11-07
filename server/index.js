'use strict';

// The app's own server: accounts, pages, images and LiveKit tokens.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const yauzl = require('yauzl');
const { AsyncLocalStorage } = require('async_hooks');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const QRCode = require('qrcode');
const { ModuleManager, LIMITS: MODULE_LIMITS, compareVersions, oldNameIn, pendingWidensNothing } = require('./modules');
const { buildModule, bundledModules, zipFiles } = require('./module-build');
const { fillManifest } = require('./modules');
const templates = require('./templates');
const { ModuleLinks, objectKey } = require('./module-links');
const { Backgrounds } = require('./backgrounds');
const { ModuleBus, BUS_LIMITS } = require('./module-bus');
const { ChatHistory } = require('./chat-history');
const { cleanReport: cleanAttention } = require('./attention');
const { cleanFacts, iconKnown } = require('./facts');
const { LayoutError, cleanLayout, cleanSystemPatch, SYSTEM_IDS, SYSTEM_ICONS } = require('./layouts');
const { ModuleLimits } = require('./module-limits');
const { ModuleSettings, SettingError } = require('./module-settings');
const { GeocodeCache, askService, keyOf: keyOfPlace, ENOUGH } = require('./geocode');
const { FlightSchedule, FlightLookupError, findFlights, parseNumber: parseFlightNumber } = require('./flight-lookup');
const airportList = require('./airports');
const { RegionCutJobs, RegionCutError } = require('./region-cut');
const { pmtilesInfo, pmtilesWhyNot } = require('./pmtiles-header');
const { ModuleUploads } = require('./module-uploads');
const { inspectHead } = require('./image-clean');
const { cleanName, nameForType, folderBytes, VISIBILITIES, PEOPLE_MAX } = require('./vault-store');
const vaultTypes = require('./vault-types');
const { createScanner } = require('./vault-scan');
const pdfViewer = require('./pdf-viewer');
const { mountVaultShares } = require('./vault-share');
const { watchArrival, slowSenders } = require('./arrival');
const { Ai, AiError, listModelsFor, managedOffer, MANAGED_PROVIDERS } = require('./ai');
const objectFormat = require('./object-format');
const { presenceView, belongsToSpace } = require('./presence-view');
const { mergeCall, cleanAwayMessage } = require('./live');
const { streamWriter } = require('./stream-write');
const destinations = require('./destinations');
const { fetchPreview, fetchImage, cachedImage, PreviewError, calendarUrl } = require('./link-preview');
const { findLink, readFields, CHAT_LINK_LIMITS } = require('./chat-links');
const objectSync = require('./object-sync');
const ics = require('./ics');
const prompts = require('./prompts');
const { createAiPolicy } = require('./ai-policy');
const { createContextBuilder } = require('./ai-context');
const { createAiTools } = require('./ai-tools');
// AI_PROMPT_VERSIONS (rollback pins) and AI_LOG_PROMPTS (full prompts in the log), said once at start (plan-ai-integration.md,
// decision 14). Full prompts are never logged on a hosted install (BASE_DOMAIN): server/ai.js ignores the variable there.
for (const line of prompts.setPins(process.env)) console.warn(line);
if (process.env.AI_LOG_PROMPTS === '1') {
  console.warn(process.env.BASE_DOMAIN ? 'AI_LOG_PROMPTS is ignored on a hosted install (BASE_DOMAIN is set): prompts are not logged.' : 'AI_LOG_PROMPTS is on: every prompt sent to the AI service is written to this log, without the key.');
}
const themeFile = require('./theme-file');
const { productName, shortProductName } = require('./product-name');
const templateFile = require('./template-file');
const { EventEmitter } = require('events');
const { ModuleData, isBookkeeping } = require('./module-data');
const moduleGuards = require('./module-guards');
const { ModuleHooks, HOST_SOURCE } = require('./module-hooks');
const moduleNotices = require('./module-notices');
const themeCssLib = require('./theme-css');
const { eraseSpace } = require('./space-erase');
const { Store, StoreError, SLOTS, PARTICIPANT_SLOTS, CHARACTER_SLOTS, SPACE_PROFILES, SPACE_PROFILE_SLOTS, LEGACY_SLOTS, ROLE_PERMISSIONS, hasOwnerRights, IMAGE_TYPES, MAX_IMAGE_BYTES, LOBBY, randomToken, cleanText, UNNAMED_ENVIRONMENT, MAX_EXTERNAL_CALENDARS } = require('./store');
// The phase timeline rule (plan-one-bar.md, step 1), the one copy the pages use too.
const phaseRule = require('../public/phases.js');
const auth = require('./auth');
const { buildEnvironment, flushEnvironment, setAsideEnvironment } = require('./environment');
const { exportEntries, restoreEntries } = require('./environment-export');
const { HostRegistry, HostError, cleanSlug, reservedSentence } = require('./host-registry');
const { domainSettings } = require('./domains');
const { migrateHost, backupRefusal, refusedAtStartup, refusalSentence, MigrationError, recordedParts, LEGACY_ENVIRONMENT_RECORD } = require('./migrate-names');
const callNames = require('./call-names');
const { mountOldLinks } = require('./old-links');
const { currencyCodes } = require('./currencies');

const {
  PORT = 3000,
  DATA_DIR = path.join(__dirname, '..', 'data'),
  LIVEKIT_HOST = 'localhost:7880',
  LIVEKIT_API_URL = '',
  LIVEKIT_API_KEY = '',
  LIVEKIT_API_SECRET = '',
  // The server's admin (plan-names decision 7): made, or its password reset, on every start. On a hosted server the
  // host admin in host.json; on a single-environment install the one environment's `admin` account.
  ADMIN_LOGIN = '',
  ADMIN_PASSWORD = '',
  OWNER_PASSWORD = '', // built in step 4 and dropped: ignored, with a line on start
  APP_REVISION = 'dev', // the commit the image was built from (the Dockerfile sets it)
  BASE_DOMAIN = '',
  PREVIOUS_BASE_DOMAINS = '',
  // Where the product pages live (documentation/plans/plan-domains.md): a host name, no scheme and no port; unset, the
  // bare BASE_DOMAIN, as before. RESERVED_SLUGS: a comma list of names no new environment may take, on top of the
  // built-in ones. Both are ignored without BASE_DOMAIN. The console is always at admin.<BASE_DOMAIN>.
  PRODUCT_DOMAIN = '',
  RESERVED_SLUGS = '',
  MIGRATE_ENVIRONMENT_SLUG = '',
  CONTACT_EMAIL = '',
  // Seed the host's managed AI service, per company (documentation/plans/plan-environments.md, "Managed AI, per
  // company"): AI_OPENAI_KEY/AI_ANTHROPIC_KEY name a company's key directly; AI_PROVIDER (with AI_ADDRESS,
  // AI_MODEL, AI_KEY) is the older one-company form, filling whichever company it names -- both still work.
  AI_PROVIDER = '',
  AI_ADDRESS = '',
  AI_MODEL = '',
  AI_KEY = '',
  TAVERN_AI_KEY = '', // deprecated: use AI_KEY (used to be an environment's own key; it is the host's now)
  AI_OPENAI_KEY = '',
  AI_ANTHROPIC_KEY = '',
  // An organisation-level Anthropic key needs its workspace id sent with every call (an id, not a secret).
  AI_ANTHROPIC_WORKSPACE = '',
  // Self-serve and billing (plan-environments.md, "Phase 5"): SIGNUP gates POST /api/product/signup -- off unless a
  // host explicitly opts in with SIGNUP=on, so a freshly upgraded host never offers public self-service by
  // surprise. BILLING_SECRET signs the billing webhook (x-billing-signature, HMAC-SHA256 of the raw body) --
  // unset, the webhook route answers 404, same as a feature that was never turned on. A plan's own checkout URL
  // is BILLING_CHECKOUT_<PLAN ID>, read directly off process.env where it is used (the plan id is dynamic,
  // host-configured, so it can't be named here).
  SIGNUP = '',
  BILLING_SECRET = '',
  // Two-step sign-in (documentation/plans/plan-mfa.md, "Regaining access"): ENABLE_MFA turns the whole feature
  // on or off, server-wide (default on); ADMIN_MFA_LOCKOUT_BYPASS lets an admin -- an environment's own or a
  // host admin -- back in without the code step or the enrol requirement, at the cost of that account's own
  // second factor being nothing to lean on while it is set. An environment's own policy is settings.mfaRequired
  // instead, a plain on/off through Manage. HOST_MFA_REQUIRED is the host console's; HOST_MFA=required still
  // works too, from before the switches were renamed.
  ENABLE_MFA = 'true',
  ADMIN_MFA_LOCKOUT_BYPASS = 'false',
  HOST_MFA_REQUIRED = 'false',
  HOST_MFA = '',
  // A single-environment install made from a template (plan-environment-templates.md): its id, e.g. "travel". Applied
  // only to a fresh data directory; ignored, with a line, on existing data and on a server with BASE_DOMAIN (where the
  // host console and the sign-up pick one).
  TEMPLATE = '',
  // The most a picture map file (an owner's upload of picture tiles, see "A picture map" below) may weigh, in MB. A backup
  // and a restore carry the environment's folder, so it is kept well under the restore's own limit. Not a number above 0: 100.
  MAP_IMAGE_MAX_MB = '',
  // Guests in chat (GitHub #289): how many chat messages one guest link may post in a minute (default 20; one address
  // posting as a guest gets half of it, at least 5); how many live streams (GET /api/live) one signed-in person may
  // hold open (default 50: one a browser tab); and how many one guest link may hold open in all (default 25; one address
  // on it gets 40% of that, at least 2, and never more than LIVE_STREAMS_PER_PERSON). Not a whole number above 0: the
  // default.
  GUEST_CHAT_POSTS_PER_MINUTE = '',
  LIVE_STREAMS_PER_PERSON = '',
  LIVE_STREAMS_PER_GUEST_LINK = '',
  // The most a chat picture may weigh, in MB (POST /api/spaces/:id/chat/pictures: held in memory, never stored). Not a
  // number above 0: 3.
  CHAT_PICTURE_MAX_MB = '',
  // How many minutes a chat picture is held in memory for its readers to fetch (default 15); then its url answers 404.
  // Not a number above 0: the default.
  CHAT_PICTURE_KEEP_MINUTES = '',
  // The most MB of chat pictures held in memory for one space (default 30), one environment (default 100) and the whole
  // server (default 200); past one, the oldest held there go first. Each holds at least one picture of
  // CHAT_PICTURE_MAX_MB. Not a number above 0: the default.
  CHAT_PICTURE_SPACE_MB = '',
  CHAT_PICTURE_ENVIRONMENT_MB = '',
  CHAT_PICTURE_SERVER_MB = '',
  // How many MB of chat pictures one person (a guest: one guest link) may send in a minute (default 20). Not a number
  // above 0: the default.
  CHAT_PICTURE_MB_PER_MINUTE = '',
  // How far, in MB, a reader of a server-sent stream (the live stream, notifications, a module's changes) may fall
  // behind before the server drops that stream (default 8): its page reconnects and catches up, and nothing piles up in
  // the server's memory for a reader that stopped reading. Not a number above 0: the default.
  LIVE_STREAM_BUFFER_MB = '',
  // How many times a minute one person (a guest: the id on their pass) may say away or on the call in a space
  // (PATCH /api/spaces/:id/presence; default 60). Not a whole number above 0: the default.
  PRESENCE_CHANGES_PER_MINUTE = '',
  // How many reverse proxies stand in front of the server (default 1, the usual one). The address a request came from
  // is the one the nearest of them saw, so a client can't choose its own with X-Forwarded-For; 0 = no proxy, the
  // connection's own address. Not a whole number of 0 or more: 1, with a line on start.
  TRUST_PROXY_HOPS = '',
  // How long a request's body may take to arrive once its headers have, in seconds (300, Node's own five minutes), on
  // every route but a library upload, which may take two hours and cuts off one too slow itself. Not a number above 0:
  // the default.
  REQUEST_BODY_SECONDS = '',
  // A module's library files (documentation/plans/plan-attachments-vault.md, section 2): VAULT_DIR is the folder their
  // bytes go in, for every environment on the server (VAULT_DIR/<environment slug>/, or VAULT_DIR/_default/ on a
  // single-environment install); unset, DATA_DIR/vault, which no in-app backup carries. VAULT_MAX_GB is the most the
  // whole folder may hold (20), VAULT_SPACE_MAX_GB one space's files (5), VAULT_PERSON_MAX_GB what one person has added
  // across an environment's spaces (2), and VAULT_MB_PER_MINUTE how much one person may send in a minute (500). Not a
  // number above 0: the default. VAULT_MIN_KB_PER_SECOND is how slowly an upload may arrive (16): after its first
  // minute, one that sends less than that in any minute is cut off, and what it reserved is free again.
  // VAULT_SCAN_SECONDS is how long the check of one file that is in may take (5): a picture cleaned, a PDF scanned, a
  // recording's structure read, each in a worker thread with a memory limit; one that takes longer is stopped and the
  // file refused as one that could not be checked safely.
  VAULT_SCAN_SECONDS = '',
  // The check on start that tidies the library (bytes with no record, records with no bytes, leftovers of deleted spaces)
  // stops after VAULT_SWEEP_SECONDS (10) and finishes on the next start.
  VAULT_SWEEP_SECONDS = '',
  VAULT_DIR = '',
  VAULT_MAX_GB = '',
  VAULT_SPACE_MAX_GB = '',
  VAULT_PERSON_MAX_GB = '',
  VAULT_MB_PER_MINUTE = '',
  VAULT_MIN_KB_PER_SECOND = '',
  // Someone whose uploads are cut off for arriving too slowly VAULT_SLOW_CUTOFFS times (3) within VAULT_SLOW_MINUTES (10)
  // can't start another upload until the oldest of those is that long ago.
  VAULT_SLOW_CUTOFFS = '',
  VAULT_SLOW_MINUTES = '',
} = process.env;
// The product's own name -- configuration, never code: PRODUCT_NAME, or the default when it is unset, empty or only
// spaces. One rule, productName() in server/product-name.js, for everything the server answers and says.
const PRODUCT_NAME = productName();
const PRODUCT_SHORT_NAME = shortProductName();

// The server's admin (plan-names decisions 7, 15 and 20): ADMIN_LOGIN and ADMIN_PASSWORD, on every kind of install.
// The old names that went in plan-names step 10 (decision 20), and after it TAVERN_ADMIN_PASSWORD, TAVERN_ADMIN_KEY
// and ADMIN_KEY (the pre-account password), are no longer read at all; set, each says so on every start, with the
// name to use instead, so an install that still sets one is not left guessing why it has no effect.
const REMOVED_CONFIG_NAMES = [['ADMIN_USER', 'ADMIN_LOGIN'], ['TAVERN_ADMIN_USER', 'ADMIN_LOGIN'], ['HOST_ADMIN_LOGIN', 'ADMIN_LOGIN'], ['HOST_ADMIN_PASSWORD', 'ADMIN_PASSWORD'], ['TAVERN_ADMIN_PASSWORD', 'ADMIN_PASSWORD'], ['TAVERN_ADMIN_KEY', 'ADMIN_PASSWORD'], ['ADMIN_KEY', 'ADMIN_PASSWORD'], ['MIGRATE_TENANT_SLUG', 'MIGRATE_ENVIRONMENT_SLUG']];
for (const [old, now] of REMOVED_CONFIG_NAMES) if (process.env[old]) console.warn(`${old} is no longer read: use ${now} instead.`);
if (OWNER_PASSWORD) console.warn("OWNER_PASSWORD is ignored: owners are made in Manage. Use ADMIN_PASSWORD for the server's admin.");
const adminLogin = ADMIN_LOGIN || 'admin';

// --- writing to a server-sent stream ---------------------------------------------------------------------------------
// Every stream is written through sseWrite: a reader more than LIVE_STREAM_BUFFER_MB behind (a page that stopped
// reading, a stalled connection) is dropped rather than queued for, so a slow or hostile reader can't fill the server's
// memory. Its page reconnects and catches up (the live stream's `ready`, then the chat's history).
const liveStreamBufferBytes = (() => {
  const mb = Number(LIVE_STREAM_BUFFER_MB);
  return Math.floor((Number.isFinite(mb) && mb > 0 ? mb : 8) * 1024 * 1024);
})();
// Writes the chunks to `res`, or drops the stream when they would put it over the limit (server/stream-write.js).
const sseWrite = streamWriter(liveStreamBufferBytes);
const adminPassword = ADMIN_PASSWORD;
const aiKeyFromEnv = AI_KEY || TAVERN_AI_KEY;
// The environment a single-environment install moves into on its first start with BASE_DOMAIN (plan-names decision 15).
const migrateEnvironmentSlug = MIGRATE_ENVIRONMENT_SLUG;
const signupEnabled = Boolean(BASE_DOMAIN) && SIGNUP === 'on';
// Where library files keep their bytes (see VAULT_DIR above), and one environment's folder there.
const VAULT_ROOT = path.resolve(String(VAULT_DIR).trim() || path.join(DATA_DIR, 'vault'));
const vaultFolderOf = (slug) => path.join(VAULT_ROOT, slug || '_default');
// What the whole vault folder holds, measured on the first upload after a start and kept up to date by every change
// (environmentFor's onVaultBytes); null until then.
const vaultHost = { bytes: null };
// The bundled templates, checked now: an invalid one stops the start, naming the file and what is wrong.
try {
  templates.all();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const templateId = String(TEMPLATE || '').trim();
if (templateId && BASE_DOMAIN) console.warn(`TEMPLATE=${templateId} is ignored on a server with environments: pick a template when an environment is made, on the host console or the sign-up.`);
if (templateId && !BASE_DOMAIN && !templates.get(templateId)) {
  const known = templates.list().map((t) => t.id);
  console.error(`TEMPLATE=${templateId} is not a template this server has${known.length ? `; the templates are ${known.join(', ')}` : '; it has none'}. Set one of those, or remove TEMPLATE.`);
  process.exit(1);
}
const mfaOffered = ENABLE_MFA !== 'false';
const adminMfaLockoutBypass = ADMIN_MFA_LOCKOUT_BYPASS === 'true';
const hostMfaRequired = HOST_MFA_REQUIRED === 'true' || HOST_MFA === 'required';
// BILLING_CHECKOUT_<PLAN ID>, e.g. BILLING_CHECKOUT_PRO for the plan "pro"; none set means that plan is not
// sold online (plan-environments.md, "Phase 5").
function checkoutUrlFor(planId) {
  return process.env[`BILLING_CHECKOUT_${String(planId).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || null;
}

const VERSION = `v${require('../package.json').version} (${String(APP_REVISION).slice(0, 7)})`;

// The call service (LiveKit) is optional (plan-realtime-optional-livekit.md, step 6): with both keys set the server
// has one and voice and video work; with either unset it starts without one, never builds a LiveKit client and never
// asks it, and everything but the call works (spaces, chat, presence, modules). branding().callService says which.
const HAS_CALL_SERVICE = Boolean(LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
// What a person reads wherever voice and video are refused for want of a call service: the API's answer (503), and
// the sentence the Manage > Modules Conference card shows.
const NO_CALL_SERVICE = 'voice and video are not set up on this server';
const NO_CALL_SERVICE_CARD = 'Voice and video are not set up on this server.';
if (!HAS_CALL_SERVICE) {
  if (LIVEKIT_API_KEY || LIVEKIT_API_SECRET) console.warn(`No LiveKit: ${LIVEKIT_API_KEY ? 'LIVEKIT_API_SECRET' : 'LIVEKIT_API_KEY'} is not set, so voice and video are off.`);
  else console.log('No LiveKit: voice and video are off.');
}

// --- environments (one host, many environments: documentation/plans/plan-environments.md, phase 1) -----------------
// With no BASE_DOMAIN there is exactly one environment, built straight from DATA_DIR: today's install, unchanged.
// With BASE_DOMAIN set, one environment per slug (DATA_DIR/environments/<slug>/), resolved from the request's
// hostname by the resolver middleware below (see "the door"). Either way, request handlers keep reading `store`,
// `modules` and the rest by the names they use today: those names are Proxies that forward to whichever
// environment the current request (or, outside a request, an explicit envContext.run call) resolved.
const envContext = new AsyncLocalStorage();
const environments = new Map(); // slug ('' for the default/no-BASE_DOMAIN environment) -> a built environment
const DEFAULT_SLUG = '';
// Where the modules that ship with this deployment live -- moved up here (out of its old spot near
// bundledList()) because environmentFor()'s auto-install needs it, and environmentFor() runs at module load,
// before that part of the file has executed.
const BUNDLED_DIR = path.join(__dirname, '..', 'modules');
// (Up here for the same reason: environmentFor() gives a module's display icon its built-in icons, at module load.)
// The two panes that ship with the app, listed beside the installed modules. They are always on and
// cannot be removed (for now); their permissions are the built-in ones on the Roles tab.
const BUILTIN_MODULES = [
  { id: 'conference', name: 'Conference', icon: 'video', description: 'Voice and video for the {space}: the tiles, the toolbar, reactions, {asides} and the OBS views.', permissions: 'Share their screen, Use reactions, and the {Asides} group', switchable: true, setting: 'conferenceEnabled', needs: 'Needs a LiveKit server.', turnOff: 'Video and audio stop for everyone in every {space}. Chat, presence and {modules} keep working.', turnOn: 'Voice and video for the {space}. It needs a LiveKit server.' },
  { id: 'chat', name: 'Chat', icon: 'message', description: 'Text chat for the {space}, with pictures and formatting.', permissions: 'Send chat messages and Send pictures in chat' },
];

function currentEnvironment() {
  const env = envContext.getStore();
  if (!env) throw new Error('no environment resolved for this request');
  return env;
}
// A listener a long-lived request (a server-sent stream) leaves on a service: it runs in that request's environment
// whoever emits (a timer, a child process, another request), and a throw is logged, never left to stop the process.
function listenIn(env, fn) {
  return (...args) => {
    try {
      envContext.run(env, () => fn(...args));
    } catch (err) {
      console.error(`${env.slug ? `[${env.slug}] ` : ''}A live stream's listener failed: ${err.stack || err.message}`);
    }
  };
}

// A Proxy standing in for one of the current environment's services, by name: every property access resolves
// against envContext's current environment, and a method comes back bound to the real instance (never the
// Proxy), so `store.someMethod()` runs against the right environment's real `store`, whichever one is current.
// Works uniformly for a class instance, a plain Map, or an EventEmitter -- everything under the seam.
function proxyFor(name) {
  const forward = (trap) => (_target, ...args) => trap(currentEnvironment()[name], ...args);
  return new Proxy(Object.create(null), {
    get: forward((real, prop) => {
      const value = Reflect.get(real, prop, real);
      return typeof value === 'function' ? value.bind(real) : value;
    }),
    set: forward((real, prop, value) => Reflect.set(real, prop, value)),
    has: forward((real, prop) => Reflect.has(real, prop)),
    deleteProperty: forward((real, prop) => Reflect.deleteProperty(real, prop)),
    ownKeys: forward((real) => Reflect.ownKeys(real)),
    getOwnPropertyDescriptor: forward((real, prop) => Reflect.getOwnPropertyDescriptor(real, prop)),
  });
}

const store = proxyFor('store');
// The words a person reads for each level and role (server/words.js): word() reads the current request's environment's
// words, or the defaults outside a request.
const { word, fill: fillWords } = require('./words');
require('./words').useCurrent(() => envContext.getStore()?.store.resolvedWords() || null);
const modules = proxyFor('modules');
const moduleData = proxyFor('moduleData');
const moduleHolds = proxyFor('moduleHolds');
const moduleHooks = proxyFor('moduleHooks');
const chatHistory = proxyFor('chatHistory');
const attention = proxyFor('attention');
const facts = proxyFor('facts');
const chatPosts = proxyFor('chatPosts');
const chatPreviewsAsked = proxyFor('chatPreviewsAsked');
const moduleLinks = proxyFor('moduleLinks');
const moduleBus = proxyFor('moduleBus');
const moduleSettings = proxyFor('moduleSettings');
const ai = proxyFor('ai');
const moduleUploads = proxyFor('moduleUploads');
const vault = proxyFor('vault');
const geocodeCache = proxyFor('geocodeCache');
const regionCutJobs = proxyFor('regionCutJobs');
const moduleLimits = proxyFor('moduleLimits');
const limiter = proxyFor('limiter');
const live = proxyFor('live');
const liveEvents = proxyFor('liveEvents');
const invites = proxyFor('invites');
const inviteEvents = proxyFor('inviteEvents');
const themeEvents = proxyFor('themeEvents');
const moduleEvents = proxyFor('moduleEvents');
const chatPictures = proxyFor('chatPictures');
const iconSvgs = proxyFor('iconSvgs');
const moduleActivity = proxyFor('moduleActivity');
const externalCalendars = proxyFor('externalCalendars');
function noteActivity(...args) { return currentEnvironment().noteActivity(...args); }

// The product host, the console host and the reserved names (server/domains.js), read before anything is written, so a
// setting that stops the start leaves the data folder as it was.
const domains = domainSettings({ baseDomain: BASE_DOMAIN, productDomain: PRODUCT_DOMAIN, reservedSlugs: RESERVED_SLUGS, livekitHost: LIVEKIT_HOST });
for (const line of domains.warnings) console.warn(line);
if (domains.stop) {
  console.error(domains.stop);
  process.exit(1);
}
// The product host's own label may be an existing environment's slug (the product pages would hide it): read host.json
// as it is, without opening the registry, so the start that stops writes nothing.
if (BASE_DOMAIN && domains.productLabel) {
  let existing = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'host.json'), 'utf8'));
    existing = Array.isArray(raw.environments) ? raw.environments : [];
  } catch { /* no host.json yet: no environment has the name */ }
  if (existing.some((t) => t && t.slug === domains.productLabel)) {
    console.error(`PRODUCT_DOMAIN=${domains.productHost} is the address of the "${domains.productLabel}" environment. Pick another host for the product pages.`);
    process.exit(1);
  }
}
// The registry of environments (DATA_DIR/host.json): which environments exist, their plans, the host admins. Only
// built when BASE_DOMAIN is set -- a self-hosted install with no base domain never has this file.
// The host's Names migration part (documentation/plans/plan-names.md, "The migration") runs first, before
// host.json is read and before any environment is built; a failure stops the start with the file named.
if (BASE_DOMAIN) {
  try {
    migrateHost(DATA_DIR);
  } catch (err) {
    if (!(err instanceof MigrationError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}
const hostRegistry = BASE_DOMAIN ? new HostRegistry(DATA_DIR) : null;
if (hostRegistry) {
  hostRegistry.setBaseDomain(BASE_DOMAIN);
  hostRegistry.setPreviousBaseDomains(PREVIOUS_BASE_DOMAINS);
}
const PRODUCT_HOST = domains.productHost; // '' without BASE_DOMAIN
const CONSOLE_HOST = domains.consoleHost; // admin.<BASE_DOMAIN>, '' without it
// A name reserved after an environment took it leaves that environment working, said once per start; only the product
// host's own label stops the start, since the product pages would hide that environment.
if (hostRegistry) {
  hostRegistry.setReservedNames(domains.reservedNames);
  for (const t of hostRegistry.listEnvironments()) {
    if (hostRegistry.isReserved(t.slug)) console.warn(`"${t.slug}" is now reserved; it keeps working, but no new environment can take that name.`);
  }
}
// The key that encrypts every secret at rest (every TOTP secret, and an environment's own AI key -- server/ai.js): the host's own, shared across every environment, on a host with
// environments (host.json's secretsKey -- an owner's export or the console's backup never carries host.json
// at all); a single file beside the store on a self-hosted install (there is no host.json), made on first use.
// Cached after the first call -- neither source ever changes once the server is up.
let _secretsKeyBuf = null;
function secretsKeyBuf() {
  if (_secretsKeyBuf) return _secretsKeyBuf;
  if (hostRegistry) {
    _secretsKeyBuf = Buffer.from(hostRegistry.secretsKey, 'hex');
    return _secretsKeyBuf;
  }
  const file = path.join(DATA_DIR, 'secrets.key');
  if (!fs.existsSync(file)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* not ours to change */ } // private, whatever mode an older install left it with
  _secretsKeyBuf = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  return _secretsKeyBuf;
}
// A single install's secrets.key from before it was kept private: private from this start on, whether or not
// anything reads it this time (a hosted server keeps its key in host.json, which HostRegistry keeps private).
if (!hostRegistry && fs.existsSync(path.join(DATA_DIR, 'secrets.key'))) {
  try { fs.chmodSync(path.join(DATA_DIR, 'secrets.key'), 0o600); } catch { /* not ours to change */ }
}
// (Up here, not beside the two-step sign-in below: environmentFor() runs at module load and hands it to each
// environment's Ai, which encrypts a plain saved key on its first load.)
// The host's own region-cut jobs, over its shared folders (documentation/plans/plan-environments.md, "Shared files:
// the host's map") -- lands a cut in DATA_DIR/shared/<module id>/<folder>/ (`under: ''`, no per-environment
// "modules" segment), never DATA_DIR/shared/modules/... An environment's own regionCutJobs (per environment,
// built in buildEnvironment) is untouched; this is the host's own, only reachable from hostRouter.
const sharedRegionCutJobs = BASE_DOMAIN ? new RegionCutJobs(path.join(DATA_DIR, 'shared'), undefined, { under: '' }) : null;

// First start with BASE_DOMAIN set and data still at DATA_DIR's own root (a pre-environment install -- its settings
// file is app.json now, or still the older LEGACY_ENVIRONMENT_RECORD if it has not been started since that rename): refuses to start
// until told which environment that data becomes.
function migrateIfNeeded() {
  const preEnvironment = fs.existsSync(path.join(DATA_DIR, 'app.json')) || fs.existsSync(path.join(DATA_DIR, LEGACY_ENVIRONMENT_RECORD));
  if (!BASE_DOMAIN || !preEnvironment) return;
  if (!migrateEnvironmentSlug) {
    console.error(`BASE_DOMAIN is set and ${DATA_DIR} is a single-environment install. Set MIGRATE_ENVIRONMENT_SLUG=<slug> for one start to move it to that environment, then remove it.`);
    process.exit(1);
  }
  const slug = cleanSlug(migrateEnvironmentSlug);
  if (hostRegistry.isReserved(slug)) {
    console.error(`MIGRATE_ENVIRONMENT_SLUG=${slug}: ${reservedSentence(slug)}`);
    process.exit(1);
  }
  const dest = path.join(DATA_DIR, 'environments', slug);
  if (fs.existsSync(dest)) throw new Error(`${dest} already exists; migration already ran`);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(DATA_DIR)) {
    if (['host.json', 'fontawesome-pro', 'environments', 'environments-deleted', 'pre-names-host', 'flight-schedule.json', 'vault'].includes(entry)) continue; // the flight schedule is the host's; the vault folder holds every environment's files
    fs.renameSync(path.join(DATA_DIR, entry), path.join(dest, entry));
  }
  hostRegistry.addEnvironment({ slug, name: slug, plan: { modules: 'all' } });
  console.log(`Migrated the existing install to the "${slug}" environment (${dest}).`);
  secretsToHostKey(dest);
  ownersFromServerAdmin(dest);
}
// A single-environment install encrypts its secrets (the AI key in ai.json, every two-step secret in app.json, live
// and pending, and each person's other calendars' addresses) with DATA_DIR/secrets.key; a hosted environment's are read with host.json's secretsKey. So the move
// decrypts each one with the install's key and encrypts it again with the host's, and says what it did. A value the
// install's key can't decrypt is left exactly as it is, and said so; a plain (never encrypted) AI key is left for
// Ai to encrypt on its first load. The install's secrets.key stays in the environment's folder, unused from now on,
// so nothing is lost if a value has to be recovered by hand.
function secretsToHostKey(dir) {
  const keyFile = path.join(dir, 'secrets.key');
  if (!fs.existsSync(keyFile)) return; // nothing was ever encrypted on this install
  try { fs.chmodSync(keyFile, 0o600); } catch { /* not ours to change */ } // kept, and private
  let from;
  try {
    from = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
    if (from.length !== 32) throw new Error('it is not a 32-byte key');
  } catch (err) {
    console.error(`The install's secrets key (${keyFile}) could not be read (${err.message}), so its AI key and two-step secrets were left as they were; they need setting again.`);
    return;
  }
  const to = Buffer.from(hostRegistry.secretsKey, 'hex');
  const done = { moved: 0, unreadable: 0 };
  const calendars = { moved: 0, unreadable: 0 }; // other calendars' addresses, told apart in the log
  const swap = (value, tally = done) => {
    if (typeof value !== 'string' || !value.startsWith('aesgcm$')) return value;
    const plain = auth.decryptSecret(value, from);
    if (plain === null) { tally.unreadable += 1; return value; }
    tally.moved += 1;
    return auth.encryptSecret(plain, to);
  };
  const rewrite = (file, change) => {
    if (!fs.existsSync(file)) return;
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; } // unreadable data is refused later, by name
    if (!data || typeof data !== 'object') return;
    change(data);
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(`${file}.tmp`, 0o600);
    fs.renameSync(`${file}.tmp`, file);
  };
  rewrite(path.join(dir, 'ai.json'), (ai) => { if (ai.key) ai.key = swap(ai.key); });
  const appFile = ['app.json', LEGACY_ENVIRONMENT_RECORD].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (appFile) {
    rewrite(appFile, (app) => {
      for (const u of Array.isArray(app.users) ? app.users : []) {
        if (!u || typeof u !== 'object') continue;
        if (u.mfa && typeof u.mfa === 'object') {
          if (u.mfa.secret) u.mfa.secret = swap(u.mfa.secret);
          if (u.mfa.pending && u.mfa.pending.secret) u.mfa.pending.secret = swap(u.mfa.pending.secret);
        }
        // A person's other calendars' addresses (plan-google-calendar.md, Part 2).
        for (const c of Array.isArray(u.externalCalendars) ? u.externalCalendars : []) if (c && c.url) c.url = swap(c.url, calendars);
      }
    });
  }
  const where = `"${path.basename(dir)}"`;
  if (done.moved) console.log(`Moved ${done.moved} encrypted secret${done.moved === 1 ? '' : 's'} of ${where} (the AI key, two-step sign-in) to the host's key.`);
  if (done.unreadable) console.error(`${done.unreadable} encrypted secret${done.unreadable === 1 ? '' : 's'} of ${where} could not be read with the install's key and ${done.unreadable === 1 ? 'was' : 'were'} left as ${done.unreadable === 1 ? 'it was' : 'they were'}: the AI key has to be entered again, and anyone affected has to set up two-step sign-in again.`);
  if (calendars.moved) console.log(`Moved ${calendars.moved} calendar address${calendars.moved === 1 ? '' : 'es'} of ${where} to the host's key.`);
  if (calendars.unreadable) console.error(`${calendars.unreadable} calendar address${calendars.unreadable === 1 ? '' : 'es'} of ${where} could not be read with the install's key and ${calendars.unreadable === 1 ? 'was' : 'were'} left as ${calendars.unreadable === 1 ? 'it was' : 'they were'}: ${calendars.unreadable === 1 ? 'it has' : 'they have'} to be added again.`);
}
// A single-environment install's admin (role admin, made by ADMIN_LOGIN and ADMIN_PASSWORD) runs that install; once it
// is one environment of a hosted server, the server's admin is the host admin, so that account becomes the
// environment's owner. Data from before the names-roles part needs nothing here: that part makes it an owner.
function ownersFromServerAdmin(dir) {
  const file = path.join(dir, 'app.json');
  let app;
  try { app = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  if (!app || !Array.isArray(app.users) || !recordedParts(app).includes('names-roles')) return;
  const moved = app.users.filter((u) => u && u.role === 'admin' && !u.hostAdmin);
  if (!moved.length) return;
  for (const u of moved) u.role = 'owner';
  fs.writeFileSync(file, `${JSON.stringify(app, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  console.log(`The install's admin (${moved.map((u) => `"${u.login}"`).join(', ')}) is now the "${path.basename(dir)}" environment's owner; the server's admin is the host admin.`);
}
migrateIfNeeded();

// The flight schedule (documentation/plans/plan-flight-lookup.md): one for the whole server, learned from the flights people
// save in the Planner, in the root DATA_DIR -- beside host.json on a hosted install, never inside an environment's folder;
// beside the environment's own files on a single install. Built once, here, and written out at shutdown.
const flightSchedule = new FlightSchedule(DATA_DIR);
process.on('exit', () => flightSchedule.flush());

// On a first start with BASE_DOMAIN where a shared folder (documentation/plans/plan-environments.md, "Shared files:
// the host's map") does not exist yet: if exactly one environment has files in its own, pre-shared folder for
// it, those files move to the shared one, so that environment's map keeps working without anyone copying
// anything by hand; more than one, or none, and the folder is simply left to start empty (an admin adds files
// or cuts a region from the host console). Runs once, here, before any environment is built against the new
// shared location.
function migrateSharedFolders() {
  if (!BASE_DOMAIN) return;
  const envDataDirs = hostRegistry.listEnvironments().map((t) => path.join(DATA_DIR, 'environments', t.slug));
  for (const { module: moduleId, folder } of bundledSharedFolders()) {
    const sharedDir = path.resolve(DATA_DIR, 'shared', moduleId, folder);
    if (fs.existsSync(sharedDir)) continue;
    const withFiles = envDataDirs.filter((d) => {
      try { return fs.readdirSync(path.join(d, 'modules', moduleId, folder)).length > 0; } catch { return false; }
    });
    if (withFiles.length === 1) {
      fs.mkdirSync(path.dirname(sharedDir), { recursive: true });
      fs.renameSync(path.join(withFiles[0], 'modules', moduleId, folder), sharedDir);
      console.log(`Moved "${moduleId}"'s "${folder}" files to the shared folder (from ${withFiles[0]}).`);
    }
  }
}
migrateSharedFolders();

// A company's managed slot from the environment alone, before anything saved in host.json is applied:
// AI_OPENAI_KEY/AI_ANTHROPIC_KEY name that company's key directly; AI_PROVIDER (with AI_ADDRESS, AI_MODEL,
// AI_KEY) is the older one-company form, filling whichever company it names. Both still work; when both apply
// to the same company either sets its key.
function envSlot(provider) {
  const fromOneCompanyForm = AI_PROVIDER === provider;
  return {
    key: (provider === 'openai' ? AI_OPENAI_KEY : provider === 'anthropic' ? AI_ANTHROPIC_KEY : '') || (fromOneCompanyForm ? aiKeyFromEnv : ''),
    model: fromOneCompanyForm ? AI_MODEL : '',
    address: provider === 'compatible' && fromOneCompanyForm ? AI_ADDRESS : '',
    workspace: provider === 'anthropic' ? AI_ANTHROPIC_WORKSPACE : '',
  };
}
// One company's managed slot, combining what is saved (host.json, when there is one -- a single-environment
// install has none, so the environment variables are the only way to offer a company at all there) with its
// live environment-variable override: the one place both managedAi (the Ai-facing offer list) and
// hostAiServices (the host console's own view) start from, so they can never disagree about it.
function managedSlot(provider) {
  const saved = hostRegistry ? hostRegistry.managedAi[provider] : null;
  const env = envSlot(provider);
  const address = provider === 'compatible' ? ((saved && saved.address) || env.address || '') : '';
  // The environment's key belongs to the environment's address (AI_ADDRESS): once a host admin saves another address for
  // the compatible service, that key is never sent there; a key has to be saved with the new address.
  const trim = (a) => String(a || '').trim().replace(/\/$/, '');
  const envKeyHere = provider !== 'compatible' || trim(address) === trim(env.address);
  return {
    model: (saved && saved.model) || env.model || '',
    key: (saved && saved.key) || '',
    address,
    workspace: provider === 'anthropic' ? ((saved && saved.workspace) || env.workspace || '') : '',
    envKey: envKeyHere ? env.key : '',
  };
}
// The host's managed AI offer, every company at once, as an Ai instance reads it: real values, including keys,
// never a view (see hostAiServices for that). In MANAGED_PROVIDERS order, so a fresh environment's own default
// (the first one offered) is openai, then anthropic, then compatible.
function managedAi() {
  const offers = [];
  for (const provider of MANAGED_PROVIDERS) {
    const slot = managedSlot(provider);
    const offer = managedOffer(provider, slot, slot.envKey);
    if (offer) offers.push(offer);
  }
  return offers.length ? offers : null;
}
// The same, for the host console: { provider, model, address, workspace, keySet, keyFromEnvironment, offered },
// one row per company, never a key.
function hostAiServices() {
  return MANAGED_PROVIDERS.map((provider) => {
    const slot = managedSlot(provider);
    const offer = managedOffer(provider, slot, slot.envKey);
    return {
      provider,
      model: offer ? offer.model : slot.model,
      address: slot.address,
      workspace: slot.workspace, // an id, not a secret -- fine to show
      keySet: !!(slot.envKey || slot.key),
      keyFromEnvironment: !!slot.envKey,
      offered: !!offer,
    };
  });
}

// Build (or fetch the already-built) environment for a slug, from its own data directory. Only ever called for
// a slug the caller already knows is real (the default, or one host.json names) -- the resolver 404s before this.
// Environments whose data the Names migration refused (server/migrate-names.js), by slug: { reason ('newer',
// 'unreadable' or 'failed'), file (from DATA_DIR), message (the full sentence the log has), sentence (what a person asking is
// told), at, logged }. An entry stays until that environment builds; each request tries again (so a restore
// brings it back), and the full message is logged once per refusal, not on every request.
const refusals = new Map();
function noteRefusal(key, err) {
  const prior = refusals.get(key);
  if (prior && prior.message === err.message) return prior;
  const refusal = {
    reason: ['newer', 'unreadable'].includes(err.reason) ? err.reason : 'failed',
    file: err.file ? path.relative(DATA_DIR, err.file).split(path.sep).join('/') : null,
    message: err.message,
    sentence: refusalSentence(err),
    at: new Date().toISOString(),
    logged: false,
  };
  refusals.set(key, refusal);
  return refusal;
}
function logRefusalOnce(key) {
  const refusal = refusals.get(key);
  if (!refusal || refusal.logged) return;
  refusal.logged = true;
  console.error(refusal.message);
}
// What the host console shows for a refused environment (null when it is not refused).
function refusalView(slug) {
  const r = refusals.get(slug);
  return r ? { reason: r.reason, file: r.file, message: r.message, at: r.at } : null;
}

function environmentFor(slug) {
  const key = slug || DEFAULT_SLUG;
  let env = environments.get(key);
  if (env) return env;
  const dataDir = slug ? path.join(DATA_DIR, 'environments', slug) : DATA_DIR;
  // A template applies only to an environment being made now: a data directory with no app.json yet.
  const fresh = !fs.existsSync(path.join(dataDir, 'app.json')) && !fs.existsSync(path.join(dataDir, LEGACY_ENVIRONMENT_RECORD));
  try {
    env = buildEnvironment(dataDir, {
      slug: slug || null,
      admin: slug ? null : { login: adminLogin, password: adminPassword },
      managed: managedAi,
      secretsKey: secretsKeyBuf,
      vaultDir: vaultFolderOf(slug),
      vaultSweepMs: (() => { const v = Number(VAULT_SWEEP_SECONDS); return Math.round((Number.isFinite(v) && v > 0 ? v : 10) * 1000); })(),
      onVaultBytes: (delta) => {
        if (vaultHost.bytes !== null) vaultHost.bytes += delta;
        if (hostRegistry && slug) hostRegistry.addStorageUsage(slug, delta);
      },
    });
  } catch (err) {
    if (err instanceof MigrationError) { noteRefusal(key, err); err.slug = key; }
    throw err;
  }
  refusals.delete(key);
  // A fired schedule is told from a timer, outside any request: its listeners run in this environment.
  env.moduleHooks.runIn = (fn) => envContext.run(env, fn);
  // So is a Clear whose Undo time ran out (server/module-holds.js): finishHold runs in this environment.
  env.moduleHolds.runIn = (fn) => envContext.run(env, fn);
  env.moduleHolds.onExpire = (hold) => finishHold(hold);
  // A display icon may also be a built-in module's own icon (store.displayIconIds), beside the installed modules' ones.
  const installedIcons = env.store.moduleIconIds;
  env.store.moduleIconIds = () => [...installedIcons(), ...BUILTIN_MODULES.map((b) => b.icon)];
  // With no call service nobody has the conference, whatever the roles say (store.roleSet).
  env.store.callService = HAS_CALL_SERVICE;
  // Whether a system layout (calendar, map) is on in a space, whoever asks: its destination resolves there (module on in
  // the space, map file present). A space's defaultLayout may name it only while this holds (store.updateSpace).
  env.store.systemLayoutOn = (spaceId, id) => {
    const dest = { calendar: 'calendar', map: 'map' }[id];
    if (!dest) return false;
    const enabled = env.modules.enabledAll();
    const canRead = (manifest) => {
      const found = enabled.find((m) => m.manifest.id === manifest.id);
      return Boolean(found) && manifest.scope.includes('space') && !refusedInLobby(manifest, spaceId) && env.modules.isOnIn(found.entry.id, spaceId);
    };
    return Boolean(destinations.resolveDestinationInSpace(dest, { enabled, canRead, hasFile: (m) => envContext.run(env, () => moduleHasFile(m)) }));
  };
  // An environment's own name (settings.environmentName). Still on the shipped sentinel default --
  // a brand new environment, or one never renamed since before this was configurable -- picks its real one up
  // right here: the default environment gets the product's own name, an environment its registry name. Runs on every
  // build, not just the first, so an install that skipped a few versions catches up on its next start too.
  if (env.store.settings.environmentName === UNNAMED_ENVIRONMENT) {
    env.store.updateSettings({ environmentName: slug ? (hostRegistry.findEnvironment(slug)?.name || PRODUCT_NAME) : PRODUCT_NAME });
  }
  environments.set(key, env);
  const pendingTemplate = useTemplate(env, slug, fresh);
  // An environment that just migrated its own old custom AI setting to "managed" (see Ai's constructor) gives
  // that company's own managed slot a starting point, once, if the host has nothing saved for it yet -- so what
  // worked through the old per-environment AI_KEY keeps working through the host's now instead.
  const aiSeed = env.ai.migrationSeed();
  if (aiSeed && hostRegistry) hostRegistry.seedManagedAi(aiSeed.provider, aiSeed);
  // Fire-and-forget: install() reads a zip asynchronously (yauzl), and environmentFor must stay synchronous --
  // every caller, including the resolver middleware, expects an environment back at once. A few milliseconds'
  // delay before an auto-installed module is actually usable is fine today, since nothing yet depends on it
  // being installed (see plan-stream-module.md's phases: the old GET /view/:key keeps answering on its own
  // until phase 3 removes it); it will matter once that changes, at which point this may need to be awaited.
  // A template's once-only part is applied first, then the automatic installs, in that order (never at the same time).
  env.templateReady = (pendingTemplate ? applyRecordedTemplate(env, slug, pendingTemplate) : Promise.resolve())
    .then(() => autoInstallBundled(env))
    .catch((err) => console.error(`Auto-install failed for "${slug || DEFAULT_SLUG}": ${err.message}`))
    .then(() => envContext.run(env, () => announceModules(env, fresh)))
    .catch((err) => console.error(`Module notices failed for "${slug || DEFAULT_SLUG}": ${err.message}`));
  return env;
}

// The template an environment is made from, and its live part (plan-environment-templates.md). A fresh environment
// records the one it was made with (the registry's, hosted; TEMPLATE, single); one made before, or without one, keeps
// what it has. Its words, home icon and module names and icons are read from the template on every build, so a newer
// template file reaches it on the next start. Answers the template still to apply (recorded, never applied), or null.
function useTemplate(env, slug, fresh) {
  const where = slug ? `[${slug}] ` : '';
  const chosen = slug ? hostRegistry?.findEnvironment(slug)?.template || null : (!BASE_DOMAIN && templateId) || null;
  if (fresh && chosen && !env.store.templateRecord) env.store.recordTemplate({ id: chosen, appliedAt: null, skipped: [] });
  const record = env.store.templateRecord;
  // The environment's own record is the truth (it travels with a backup and a restore); the registry follows it.
  if (slug && hostRegistry) hostRegistry.setEnvironmentTemplate(slug, record?.id || null);
  if (!slug && templateId && !BASE_DOMAIN && !(fresh && chosen)) {
    if (!record) console.warn(`TEMPLATE=${templateId} is ignored: ${DATA_DIR} was made without a template, and a template is picked only when an environment is made.`);
    else if (record.id !== templateId) console.warn(`TEMPLATE=${templateId} is ignored: this environment was made from the "${record.id}" template, which it keeps.`);
  }
  if (!record) return null;
  const template = templates.useLive(env.store, templateFor(env, record.id));
  if (!template) {
    console.warn(`${where}This environment was made from the "${record.id}" template, which this server does not have, so it reads the default words.`);
    return null;
  }
  // A template switched to (switchedAt) is an offer, applied only as confirmed, never here.
  return record.appliedAt || record.switchedAt ? null : template;
}

// A template's once-only part (its settings, Lobby, space defaults, icons and modules), then the record's appliedAt,
// so it never runs again. A module the environment's plan does not include is skipped, and recorded with why.
async function applyRecordedTemplate(env, slug, template) {
  const where = slug ? `[${slug}] ` : '';
  const names = new Map(bundledModules(BUNDLED_DIR).map((m) => [m.id, m.name]));
  const skipped = await templates.applyTemplate(env, template, {
    modulesDir: BUNDLED_DIR,
    allowed: (id) => moduleAllowedFor(slug, id),
    name: (id) => env.store.moduleDisplay(id).name || names.get(id) || id,
  });
  // Recorded only if nothing switched the template away meanwhile (a switch waits for this, but a restore need not).
  const now = env.store.templateRecord;
  if (!now || now.id !== template.id || now.switchedAt) return;
  env.store.recordTemplate({ id: template.id, appliedAt: new Date().toISOString(), appliedVersion: template.version, applied: templates.partFingerprints(template), skipped });
  console.log(`${where}Applied the "${template.id}" template${skipped.length ? `; skipped ${skipped.map((x) => `${x.id} (${x.why})`).join(', ')}` : ''}.`);
}

// --- switching a template (plan-environment-templates.md, "Addendum: switching a template", GitHub #59) ------------
// Every function here takes the environment explicitly: the host's routes run outside any environment's context.

// What the offer and a confirmed apply need: the bundled modules, the plan's say (a template never widens a plan) and
// each module's name as this environment shows it (Conference and Chat included).
function templateOptions(env, slug) {
  const names = new Map(bundledModules(BUNDLED_DIR).map((m) => [m.id, m.name]));
  return {
    modulesDir: BUNDLED_DIR,
    allowed: (id) => moduleAllowedFor(slug, id),
    name: (id) => env.store.moduleDisplay(id).name || names.get(id) || BUILTIN_MODULES.find((b) => b.id === id)?.name || id,
  };
}

// --- where templates come from (addendum 2, "Where templates come from") ---------------------------------------------
// Bundled (templates/<id>.json), the host's own (host.json, on a hosted server) and a single install's imported ones
// (app.json). Ids are unique across them: a host or imported template with a bundled template's id keeps it, and that
// bundled one is not offered here (logged once). A bundled id the host has edited is the edit, whole, over the file
// (addendum 3); the file is used only while that edit is unset.
const clashLogged = new Set();
const bundledEditLogged = new Set();
// The shipped file an edit was made against: its version, what it applies once, and the whole template, so a change
// to words alone still opens the notice (addendum 3, the decided open question).
function bundledBase(shipped) {
  return { version: shipped.version, fingerprint: templates.appliedOnceFingerprint(shipped), whole: templates.wholeFingerprint(shipped) };
}
function bundledBaseDiffers(record, shipped) {
  const base = record?.base;
  if (!base) return true;
  const now = bundledBase(shipped);
  return base.version !== now.version || base.fingerprint !== now.fingerprint || base.whole !== now.whole;
}
// At start: a record with nothing edited takes the new shipped file and raises its version (no notice). One with edits
// is left as it is, and the notice stays open while `base` differs. A record for an id this image does not ship is
// ignored, with a log line.
function reconcileBundledEdits() {
  if (!hostRegistry) return;
  for (const record of hostRegistry.bundledEdits) {
    const shipped = templates.get(record.id);
    if (!shipped) {
      if (!bundledEditLogged.has(record.id)) {
        bundledEditLogged.add(record.id);
        console.warn(`The bundled template "${record.id}" is no longer shipped; its edits are left unused.`);
      }
      continue;
    }
    if (record.template != null || !bundledBaseDiffers(record, shipped)) continue;
    hostRegistry.putBundledEdit({ ...record, version: record.version + 1, base: bundledBase(shipped), updatedAt: new Date().toISOString() });
  }
}
// Every template an environment can see, by id: { ...template (cleanTemplate's shape), source, hidden, edited?, update? }.
// `env` is needed only on a single install (its imported templates); { store } is enough.
function templateCatalog(env) {
  const own = hostRegistry
    ? hostRegistry.templates.map((t) => [t, 'host'])
    : (env?.store?.importedTemplates || []).map((t) => [t, 'imported']);
  const out = new Map();
  for (const [t, source] of own) {
    try {
      out.set(t.id, { ...templates.cleanTemplate(t), source, hidden: Boolean(t.hidden), createdAt: t.createdAt || null, updatedAt: t.updatedAt || null });
    } catch (err) {
      console.error(`The ${source} template "${t.id}" could not be read (${err.message}); it is left out.`);
    }
  }
  for (const b of templates.all().values()) {
    if (out.has(b.id)) {
      if (!clashLogged.has(b.id)) { clashLogged.add(b.id); console.warn(`The bundled template "${b.id}" is not offered here: a ${out.get(b.id).source} template already has that id.`); }
      continue;
    }
    const record = hostRegistry ? hostRegistry.bundledEdit(b.id) : null;
    if (!record) {
      out.set(b.id, { ...b, source: 'bundled', hidden: false, edited: false, update: null });
      continue;
    }
    try {
      const body = record.template != null ? templates.cleanTemplate({ ...record.template, id: b.id, version: record.version }) : b;
      const notice = record.template != null && bundledBaseDiffers(record, b);
      out.set(b.id, {
        ...body,
        id: b.id,
        version: record.version,
        source: 'bundled',
        edited: record.template != null,
        hidden: Boolean(record.hidden),
        update: notice ? { shippedVersion: b.version } : null,
      });
    } catch (err) {
      console.error(`The edits for the bundled template "${b.id}" could not be read (${err.message}); the shipped template is used.`);
      out.set(b.id, { ...b, source: 'bundled', hidden: false, edited: false, update: null });
    }
  }
  return out;
}
const templateFor = (env, id) => (id ? templateCatalog(env).get(id) || null : null);
// What a list shows of a template: { id, name, description, source, version, hidden }.
const templateSummary = (t) => ({ id: t.id, name: t.name, description: t.description, source: t.source, version: t.version, hidden: t.hidden });
// The templates an environment can be made from or switch to: every one not hidden (and `keep`, the one it has).
const templateChoices = (env, keep = null) => [...templateCatalog(env).values()].filter((t) => !t.hidden || t.id === keep).map(templateSummary);
// Whether a template's once-only part waits as an offer: a switch not yet confirmed, or a newer version than the one
// applied (addendum 2: a record from before versions counts as version 1).
// A newer version whose offer would be empty (it changed only live parts, or nothing it applies once is missing) is not
// an open offer: there is nothing to confirm. `env` (with its modules) is needed to tell.
function offerIsOpen(record, template, env = null) {
  if (!record) return false;
  if (record.switchedAt && !record.appliedAt) return true;
  if (!record.appliedAt || !template) return false;
  if (template.version <= (Number.isInteger(record.appliedVersion) ? record.appliedVersion : 1)) return false;
  // Without the environment open (the console's list of an environment not in use): a newer version counts as an offer
  // only if a part it applies once changed since it was applied (its fingerprints); the environment's own state isn't
  // read, so a changed part the environment already has still shows as an offer until it is opened.
  if (!env?.modules) return templates.appliedPartsChanged(record, template);
  const offer = templates.offerFor(env, template, { ...templateOptions(env, env.slug), applied: record.applied || null });
  return Boolean(offer.modules.length || offer.reactions || offer.theme || offer.iconSet || offer.lobby || offer.spaceDefaults);
}

// Why a `template` a switch names can't be used (one sentence), or null: "none" (or null) for no template, else a
// template this environment can see and that isn't hidden (the one it has already is fine).
function templateSwitchProblem(env, value) {
  if (value === null || value === 'none') return null;
  if (typeof value !== 'string' || !value) return 'A template is named by its id, or "none" for no template.';
  const t = templateFor(env, value);
  if (!t || (t.hidden && env.store.templateRecord?.id !== value)) return `There is no template called ${value.slice(0, 40)}.`;
  return null;
}

// Switches an environment to template `value` ("none" or null for none), changing only its live part at once: the
// record (appliedAt and skipped cleared; switchedAt set, so its once-only part waits as an offer), the words, the home
// icon and the module names and icons, and the template's icons into the icon list. The owner's own words, home icon
// and module names are untouched and still win; nothing is turned off. The same template as now changes nothing.
// `by`: the owner's key, or 'host'. Answers whether anything changed.
async function switchTemplate(env, slug, value, by) {
  await env.templateReady; // a template picked at creation finishes applying before it can be switched away
  const to = value === null || value === 'none' ? null : value;
  const from = env.store.templateRecord?.id || null;
  if (from === to) return false;
  const template = to ? templateFor(env, to) : null;
  env.store.switchTemplateRecord(template ? { id: to, appliedAt: null, switchedAt: new Date().toISOString(), skipped: [] } : null, { from, to, by });
  templates.useLive(env.store, template);
  if (template) templates.addIcons(env.store, template);
  if (slug && hostRegistry) hostRegistry.setEnvironmentTemplate(slug, to);
  console.log(`${slug ? `[${slug}] ` : ''}Switched from ${from ? `the "${from}" template` : 'no template'} to ${to ? `the "${to}" template` : 'none'} (by ${by === 'host' ? 'the host' : by}).`);
  return true;
}

// The template as Manage and the console show it, with the offer while it is open: { template, offer }.
function templateAnswer(env, slug) {
  const view = templateView(env.store, env);
  const template = view?.offerOpen ? templateFor(env, view.id) : null;
  return { template: view, offer: template ? templates.offerFor(env, template, { ...templateOptions(env, slug), applied: env.store.templateRecord?.applied || null }) : null };
}

// Applies what was confirmed of the open offer ({ modules: [ids], lobby: boolean, spaceDefaults: boolean }), then
// records appliedAt and what was skipped, so the offer is not made again for this template. Throws a StoreError for
// a refusal. Answers templateAnswer.
async function applyTemplateOffer(env, slug, body) {
  const b = body && typeof body === 'object' ? body : {};
  if (b.modules !== undefined && (!Array.isArray(b.modules) || b.modules.some((m) => typeof m !== 'string'))) throw new StoreError(`Name the ${env.store.word('module', { many: true })} to turn on as a list of their ids.`);
  for (const key of ['lobby', 'spaceDefaults', 'reactions', 'theme', 'iconSet']) if (b[key] !== undefined && typeof b[key] !== 'boolean') throw new StoreError(`${key} must be true or false.`);
  await env.templateReady;
  const record = env.store.templateRecord;
  if (!record) throw new StoreError(`This ${env.store.word('environment')} has no template to apply.`, 409);
  const template = templateFor(env, record.id);
  if (!template) throw new StoreError(`This server doesn't have the "${record.id}" template any more.`, 409);
  if (!offerIsOpen(record, template, env)) throw new StoreError('This template has already been applied.', 409);
  const skipped = await templates.applyOffer(env, template, { modules: b.modules || [], lobby: b.lobby === true, spaceDefaults: b.spaceDefaults === true, reactions: b.reactions === true, theme: b.theme === true, iconSet: b.iconSet === true }, { ...templateOptions(env, slug), applied: record.applied || null });
  // Every part is recorded as seen, applied or passed over: it is offered again only when the template changes it.
  env.store.recordTemplate({ ...record, appliedAt: new Date().toISOString(), appliedVersion: template.version, applied: templates.partFingerprints(template), skipped });
  console.log(`${slug ? `[${slug}] ` : ''}Applied the "${template.id}" template's offer${skipped.length ? `; skipped ${skipped.map((x) => `${x.id} (${x.why})`).join(', ')}` : ''}.`);
  return templateAnswer(env, slug);
}

// The template an environment was made from, for Manage and the console: { id, name, appliedAt, skipped: [{ id, name,
// why }] }, or null for none. `name` is the template's, or its id when this server does not have it.
function templateView(store, env = { store }) {
  const record = store.templateRecord;
  if (!record) return null;
  const names = new Map(bundledModules(BUNDLED_DIR).map((m) => [m.id, m.name]));
  const template = templateFor(env, record.id);
  return {
    id: record.id,
    name: template?.name || record.id,
    source: template ? template.source : null, // 'bundled', 'host' or 'imported'; null when this server doesn't have it
    version: template ? template.version : null,
    appliedAt: record.appliedAt,
    appliedVersion: Number.isInteger(record.appliedVersion) ? record.appliedVersion : (record.appliedAt ? 1 : null),
    // An offer waiting: a switch not yet confirmed, or a newer version of the template than the one applied.
    offerOpen: offerIsOpen(record, template, env),
    skipped: record.skipped.map((x) => ({ id: x.id, name: store.moduleDisplay(x.id).name || names.get(x.id) || x.id, why: x.why })),
  };
}

// A bundled module with install.auto (see cleanManifest in modules.js) gets installed and enabled once, ever,
// per environment, so a server updated to a version where some core feature moved into a module is never left
// without it. Never runs again for a module once it has, even if an admin later uninstalls it (modules.
// autoInstalled/markAutoInstalled). settingsFrom: "environment" copies each declared environment-scope setting whose key
// exists in store.settings into the module's own settings, on that same install, for one whose fields used to
// live there -- a value that fails to validate against its declared type is skipped rather than failing the
// whole install (logged either way).
async function autoInstallBundled(env) {
  await updateBundled(env);
  for (const bundled of bundledModules(BUNDLED_DIR)) {
    if (!bundled.install?.auto || env.modules.isInstalled(bundled.id) || env.modules.autoInstalled(bundled.id)) continue;
    let installed;
    try {
      const { zip } = buildModule(path.join(BUNDLED_DIR, bundled.id));
      installed = await env.modules.install(zip, { source: 'bundled' });
      env.modules.update(bundled.id, { enabled: true });
    } catch (err) {
      console.error(`Could not auto-install "${bundled.id}": ${err.message}`);
      continue; // not marked -- it never actually installed, so the next start tries again
    }
    env.modules.markAutoInstalled(bundled.id);
    if (bundled.install.settingsFrom === 'environment') {
      try {
        const manifest = env.modules.manifestOf(bundled.id, installed.version);
        const values = {};
        for (const def of manifest.settings || []) {
          if (def.scope === 'environment' && env.store.settings[def.key] !== undefined) values[def.key] = env.store.settings[def.key];
        }
        if (Object.keys(values).length) env.moduleSettings.set(manifest, 'environment', {}, values, null);
      } catch (err) {
        console.error(`Auto-installed "${bundled.id}" but could not carry its settings over: ${err.message}`);
      }
    }
    console.log(`Auto-installed and enabled "${bundled.id}".`);
  }
}

// The bell's notice about the bundled modules, to everyone who can turn modules on (owners and the admin, the same
// people PATCH /api/modules/:id lets): a module that ships here and is not installed, or has a newer bundled version
// waiting. The rule and its record are in module-notices.js. Runs in the environment's context, once its installs and
// updates are done, so what is announced is what is left for a person to do. Members and guests are never told.
function announceModules(env, fresh) {
  const hooks = env.moduleHooks;
  const words = env.store.resolvedWords();
  const bundled = bundledModules(BUNDLED_DIR).map((m) => ({ id: m.id, name: m.name, version: m.version, description: fillManifest(m, words).description }));
  const installed = Object.fromEntries(env.modules.list().map((m) => [m.id, m.version]));
  const { notices, record } = moduleNotices.plan({
    bundled,
    installed,
    record: hooks.announced,
    fresh,
    waiting: (id) => {
      const m = bundled.find((b) => b.id === id);
      return Boolean(installed[id]) && compareVersions(m.version, installed[id]) > 0 && !env.modules.view(id)?.versions.includes(m.version);
    },
    allowed: (id) => moduleAllowedByPlan(id),
    compare: compareVersions,
  });
  hooks.saveAnnounced(record); // before the notices: a failure loses one rather than repeating it
  if (!notices.length) return;
  const people = env.store.users.filter((u) => hasOwnerRights(u)).map((u) => u.key);
  for (const n of notices) {
    const text = moduleNotices.noticeText(n, env.store.moduleDisplay(n.id).name || n.name);
    hooks.announce(people, { ...text, href: '/admin#modules' });
  }
  console.log(`Told ${people.length} ${people.length === 1 ? 'person' : 'people'} about ${notices.length} bundled ${notices.length === 1 ? 'module' : 'modules'}: ${notices.map((n) => `${n.id} ${n.kind === 'update' ? `${n.from} to ${n.version}` : n.version}`).join(', ')}.`);
}

// A module installed from this deployment's bundled copy (source "bundled") stays in step with the server: on each
// environment's first build, when this deployment ships a newer version, it is updated to it the way an owner would
// press Update, keeping its on or off, its spaces and its data. Requirements first (requirementsFirst), so what a
// module needs is updated and back on before it is.
//
// Only an update that needs no new approval is made on its own: one that asks for nothing new, or whose only new
// requests are permissions off for every role (pendingWidensNothing: only owners and the admin hold them, so a module
// that was on stays on, and the log says so). An update that asks for anything else new (a permission on for some
// role, a hook, a link, an event, an action) waits for an owner in Modules, and the installed version keeps running;
// the log says so on each start. The exception is an installed version built for an older version of the product (outdated, which
// can't run at all): it is updated whatever the update asks for, and what it newly asks for waits for an owner, off
// until then. An uploaded module is never touched: it waits for its author.
async function updateBundled(env) {
  // On a hosted server each line names the environment it is about.
  const where = BASE_DOMAIN && env.slug ? `[${env.slug}] ` : '';
  // A rename the installed versions already declare and that has not run here (data restored from a backup, say) runs
  // first, before any update is read from disk.
  for (const id of Object.keys(env.modules.registry.modules)) syncStoredKeys(env, id);
  for (const bundled of requirementsFirst(bundledModules(BUNDLED_DIR))) {
    const entry = env.modules.registry.modules[bundled.id];
    if (!entry || entry.source !== 'bundled' || oldNameIn(bundled)) continue;
    const from = entry.version;
    if (compareVersions(bundled.version, [...entry.versions].sort(compareVersions).pop()) <= 0) continue;
    const outdated = Boolean(env.modules.manifestOf(bundled.id, entry.version)?.outdated);
    const wasOn = Boolean(entry.enabled);
    try {
      const { zip } = buildModule(path.join(BUNDLED_DIR, bundled.id));
      const { pending: asks, manifest: next } = await env.modules.preview(zip);
      const asksNothing = !asks || !env.modules.hasPending(asks);
      if (!outdated && !asksNothing && !pendingWidensNothing(asks, next.permissions)) {
        console.log(`${where}"${bundled.id}" ${bundled.version} is here, but it asks for something new, so it waits for an owner to update it in Modules; ${from} keeps running.`);
        continue;
      }
      const view = await env.modules.install(zip, { source: 'bundled' });
      let note = '';
      // Still switched on unless the update asks for something new (install switches it off then); whether it runs also
      // depends on what it requires, which is updated before it (requirementsFirst).
      if (wasOn && !env.modules.registry.modules[bundled.id].enabled) {
        const { pending } = view;
        if (pendingWidensNothing(pending, view.permissions)) {
          // Turned back on as an owner would (approving its new permissions). If something it requires is not on yet
          // (it waits for approval itself), that is not a failure of this update: it says so and stays waiting.
          try {
            env.modules.update(bundled.id, { enabled: true });
            note = ` It stays on: its new permission${pending.permissions.length === 1 ? '' : 's'} (${pending.permissions.join(', ')}) ${pending.permissions.length === 1 ? 'is' : 'are'} off for every role, so only owners have ${pending.permissions.length === 1 ? 'it' : 'them'}.`;
          } catch (err) {
            if (!err.status) throw err;
            note = ` It is off for now: ${err.message}`;
          }
        } else {
          note = ' It waits for an owner to approve what it newly asks for in Modules.';
        }
      }
      console.log(`${where}Updated "${bundled.id}" from ${from} to ${view.version}${outdated ? `: the version installed was built for an older version of ${PRODUCT_NAME}` : ', the version this server ships'}.${note}`);
      // Its stored keys renamed at once, before anyone opens the new version (no request is served in between).
      syncStoredKeys(env, bundled.id);
    } catch (err) {
      console.error(`${where}Could not update "${bundled.id}" from ${from} to ${bundled.version}: ${err.message}`);
    }
  }
  afterModulesChanged(env);
  for (const m of env.modules.list()) {
    if (m.outdated) console.warn(`${where}Module "${m.id}" ${m.version} can't run until it is updated: ${m.outdatedWhy}`);
    else if (m.needsUpdate.length) console.warn(`${where}Module "${m.id}" ${m.version} can't run until ${m.needsUpdate.map((r) => `"${r}"`).join(' and ')}, which it requires, ${m.needsUpdate.length === 1 ? 'is' : 'are'} updated.`);
  }
}

// After a module is installed or updated (or on start, for every installed one): carry renamed permissions' grants
// over, and rename the stored keys its author renamed.
function afterModulesChanged(env) {
  carryReplacedGrants(env);
  for (const id of Object.keys(env.modules.registry.modules)) syncStoredKeys(env, id);
}

// A module's author renamed a prefix of its stored keys (`storage.renamed: [{ from, to }]` in module.json, see
// cleanStorage in modules.js). Each rename is recorded on the registry entry with the version that introduced it (the
// running version when it first took effect): `renamed: [{ from, to, version, at, kept }]`. The rule: a rename is in
// effect for every version from the one that introduced it on, so the data always matches the version that runs.
// Whenever that may have changed (on start, and after an install, an update or a rollback):
// - each rename in effect (declared by the running version, or recorded with a version no newer than it) moves every
//   key still under `from` to `to`, in every scope of the module's data (the environment's, each space's, each
//   person's), in the order recorded. Every time, not once: a key written under the old prefix since (an old page still
//   open) is moved on the next sync. A later version that no longer declares a rename keeps it, and keeps applying it.
// - each recorded rename introduced by a version newer than the running one, as after a rollback to a version from
//   before the rename, is undone, last first: keys under `to` go back to `from`, so the older version finds them, and
//   the record goes.
// A key whose target name is already taken is never overwritten: both are left as they are (`kept`), for the module to
// settle. The log and the module's activity say so when keys moved or a new conflict appeared, never again for the same
// one. By prefix, never by module: the host knows nothing of what the keys mean.
function syncStoredKeys(env, id) {
  const where = BASE_DOMAIN && env.slug ? `[${env.slug}] ` : '';
  const entry = env.modules.registry.modules[id];
  if (!entry) return;
  const running = entry.version;
  const declared = env.modules.manifestOf(id, running)?.storage?.renamed || [];
  const applied = env.modules.appliedRenames(id);
  const same = (a, b) => a.from === b.from && a.to === b.to;
  const isDeclared = (r) => declared.some((d) => same(d, r));
  // A record from before versions were recorded counts as introduced by the running version.
  const introduced = (r) => (typeof r.version === 'string' ? r.version : running);
  const move = (from, to, back, keptBefore = 0) => {
    let result;
    try {
      result = env.moduleData.renamePrefix(id, from, to);
    } catch (err) {
      console.error(`${where}Could not ${back ? 'move back' : 'rename'} "${id}"'s stored keys from ${from} to ${to}: ${err.message}. It is tried again on the next start.`);
      return null;
    }
    if (result.moved || result.kept > keptBefore) {
      const kept = result.kept ? `; kept ${result.kept} whose new name was already taken` : '';
      env.noteActivity(id, `${back ? 'moved back' : 'renamed'} ${result.moved} stored key${result.moved === 1 ? '' : 's'} from ${from} to ${to}${kept}`, null, null);
      console.log(`${where}${back ? 'Moved back' : 'Renamed'} "${id}"'s stored keys from ${from} to ${to}${back ? `, since ${running} is from before that rename` : ''} (${result.moved} in ${result.scopes} place${result.scopes === 1 ? '' : 's'}${kept}).`);
    }
    return result;
  };
  let next = applied.map((r) => ({ ...r }));
  // Undone: introduced by a newer version than the one running, and not declared by it.
  for (const r of [...next].reverse()) {
    if (isDeclared(r) || compareVersions(introduced(r), running) <= 0) continue;
    if (move(r.to, r.from, true)) next = next.filter((x) => !same(x, r));
  }
  // In effect: what is left, then what the running version declares that is not recorded yet.
  for (const r of declared) {
    const had = next.find((x) => same(x, r));
    if (!had) next.push({ from: r.from, to: r.to, version: running, at: new Date().toISOString(), kept: 0 });
    else if (typeof had.version !== 'string' || compareVersions(had.version, running) > 0) had.version = running;
  }
  for (const r of next) {
    const result = move(r.from, r.to, false, Number.isInteger(r.kept) ? r.kept : 0);
    if (result) r.kept = result.kept;
  }
  if (JSON.stringify(next) !== JSON.stringify(applied)) env.modules.setAppliedRenames(id, next);
}

// Bundled modules with each one after the modules it requires (Places before Maps), so a requirement is updated and
// back on before what needs it is turned back on. Otherwise by id, as bundledModules lists them. A cycle, or a
// requirement that does not ship here, simply keeps the listed order for what is left.
function requirementsFirst(list) {
  const byId = new Map(list.map((m) => [m.id, m]));
  const out = [];
  const placed = new Set();
  const visit = (m, path = new Set()) => {
    if (placed.has(m.id) || path.has(m.id)) return;
    path.add(m.id);
    for (const r of Array.isArray(m.requires) ? m.requires : []) if (byId.has(r)) visit(byId.get(r), path);
    placed.add(m.id);
    out.push(m);
  };
  for (const m of list) visit(m);
  return out;
}

// A permission a module's author renamed (a manifest permission's `replaces`, see cleanManifest): each role's own
// choice for the old key (Manage > Roles, settings.roles) is carried to the new key, once, and the old key removed, so
// nobody gains or loses anything by the rename. By shape: once the old key is gone there is nothing left to carry, so
// running it again does nothing. Run for every installed module, after anything is installed or updated. Recorded in
// the module's activity and the log. (Per-space grants hold only the Moderator tick, never a module's key.)
function carryReplacedGrants(env) {
  const where = BASE_DOMAIN && env.slug ? `[${env.slug}] ` : '';
  for (const m of env.modules.list()) {
    for (const p of m.permissions || []) {
      if (typeof p.replaces !== 'string' || p.replaces === p.key || (m.permissions || []).some((x) => x.key === p.replaces)) continue;
      const from = `module.${m.id}.${p.replaces}`;
      const to = `module.${m.id}.${p.key}`;
      const roles = env.store.carryRoleGrant(from, to);
      if (!roles.length) continue;
      env.noteActivity(m.id, `carried the ${roles.join(', ')} role's choice for "${p.replaces}" over to "${p.key}"`, null, null);
      console.log(`${where}Carried the ${roles.join(', ')} role's choice for ${from} over to ${to}.`);
    }
  }
}

// A start without BASE_DOMAIN on a folder that already belongs to a hosted server would build a second, empty
// install beside it (app.json, chat.json, the AI files, secrets.key). Seen on the real server (GitHub #90): every
// later start with BASE_DOMAIN then refused, because the root looked like a single-environment install. Refuse
// first, and write nothing.
function refuseHostedDataWithoutBaseDomain() {
  if (BASE_DOMAIN) return;
  const environmentsDir = path.join(DATA_DIR, 'environments');
  let environments = false;
  try { environments = fs.statSync(environmentsDir).isDirectory(); } catch { /* no environments folder */ }
  if (!fs.existsSync(path.join(DATA_DIR, 'host.json')) && !environments) return;
  console.error('This data folder belongs to a server with environments: set BASE_DOMAIN.');
  process.exit(1);
}
refuseHostedDataWithoutBaseDomain();

// An environment whose data the Names migration refuses (buildEnvironment throws a MigrationError; see
// server/migrate-names.js): a single-environment install stops, with the file named; on a hosted server that one
// environment is skipped and answers 503 when asked for, while the rest and the console run.
function buildAtStartup(slug) {
  try {
    return environmentFor(slug);
  } catch (err) {
    refusedAtStartup(err, { hosted: Boolean(BASE_DOMAIN) });
    const refusal = refusals.get(slug || DEFAULT_SLUG);
    if (refusal) refusal.logged = true; // refusedAtStartup has just logged it
    return null;
  }
}
reconcileBundledEdits();
if (!BASE_DOMAIN) {
  buildAtStartup(DEFAULT_SLUG); // the one environment, built eagerly, exactly as today
} else {
  for (const t of hostRegistry.listEnvironments()) buildAtStartup(t.slug); // every existing environment, built at startup
  // The host admin ADMIN_LOGIN and ADMIN_PASSWORD name (plan-names decision 7): made, or its password reset, on every
  // start, for recovery. Only that one login; any other host admin is left as it is. The password is written only when
  // it differs, so a restart with the same one signs nobody out.
  if (adminPassword) {
    const found = hostRegistry.findAdminByLogin(adminLogin);
    if (!found) {
      hostRegistry.addAdmin({ login: adminLogin, passwordHash: auth.hashPassword(adminPassword) });
      console.log(`Host admin "${adminLogin}" created from the environment.`);
    } else if (!auth.verifyPassword(adminPassword, found.passwordHash)) {
      hostRegistry.setAdminPasswordHash(found.key, auth.hashPassword(adminPassword));
      console.log(`Host admin "${adminLogin}" password reset from the environment.`);
    }
  }
}

// Every environment's own writes still owed to disk (chat, AI usage, saved places, the activity log -- each
// debounced, not synchronous like everything else under the seam).
function flushAllEnvironments() {
  for (const env of environments.values()) flushEnvironment(env);
}
process.on('exit', flushAllEnvironments);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));

// --- LiveKit ---------------------------------------------------------------

function livekitWsUrl(req) {
  return `${auth.isSecure(req) ? 'wss' : 'ws'}://${LIVEKIT_HOST}`;
}

function livekitApiUrl() {
  if (LIVEKIT_API_URL) return LIVEKIT_API_URL;
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(LIVEKIT_HOST);
  return `${local ? 'http' : 'https'}://${LIVEKIT_HOST}`;
}

// The SDK waits 10 seconds when the call service does not answer, and /api/presence and /api/status wait
// with it, so the call page and the space list sit still (GitHub #71). Two seconds, then those routes
// answer with nobody in a call. The same client serves every other call to the service. null with no call service
// (HAS_CALL_SERVICE): every use below asks for it first.
const callService = HAS_CALL_SERVICE ? new RoomServiceClient(livekitApiUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { requestTimeout: 2 }) : null;

// A token for the call service. A person's (`publisher`) is minted only by POST /api/call/join, as they join the call,
// so being at the call service is being on the call: no attribute says it. An OBS viewer's (POST /api/token) is hidden
// and only watches. `call` is the call's name at the call service (callName).
async function mintToken({ identity, name, call, publisher }) {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name, ttl: publisher ? '24h' : '12h' });
  token.addGrant({
    room: call,
    roomJoin: true,
    canPublish: publisher,
    canSubscribe: true,
    canPublishData: publisher, // reactions
    canUpdateOwnMetadata: false,
    hidden: !publisher, // OBS viewers do not show up in the call
  });
  return token.toJwt();
}

// A call's name at the call service, and the space a call belongs to (server/call-names.js, plan-names decision
// 14): worked out from the environment's slug and the space, never stored.
function callName(spaceId) {
  const id = spaceId || LOBBY;
  return callNames.callName({ slug: currentEnvironment().slug, spaceId: id, aside: Boolean(store.asideById(id)) });
}
function spaceIdOfCall(name) {
  return callNames.spaceIdOfCall(name, {
    slug: currentEnvironment().slug,
    hasSpace: (id) => Boolean(store.spaceById(id) || store.asideById(id)),
    slugs: () => (hostRegistry ? hostRegistry.listEnvironments().map((e) => e.slug) : []),
  });
}

// Who is on a call right now, in whichever space, straight from LiveKit: everyone there but a hidden OBS viewer is on
// the call (a person's token is minted only to join it). `call` is the call's own name, for sending to it (it may be a
// name from before the upgrade); it is never sent in an answer (see withoutCall). Asked only while the live register has
// someone on a call (whereEveryone).
async function participants() {
  if (!callService) return [];
  try {
    const active = await callService.listRooms();
    const out = [];
    for (const lk of active) {
      const spaceId = spaceIdOfCall(lk.name);
      if (!spaceId) continue;
      const list = await callService.listParticipants(lk.name).catch(() => []);
      for (const p of list) {
        if (p.permission?.hidden) continue;
        const tracks = p.tracks || [];
        const mic = tracks.find((t) => t.source === 2 /* MICROPHONE */);
        const cam = tracks.find((t) => t.source === 1 /* CAMERA */);
        out.push({
          key: p.identity,
          name: p.name,
          space: spaceId,
          call: lk.name,
          joinedAt: Number(p.joinedAt || 0),
          inCall: true,
          micOn: !!mic && !mic.muted,
          cameraOn: !!cam && !cam.muted,
        });
      }
    }
    return out;
  } catch (err) {
    return [];
  }
}

// A participant as an answer sends it: everything but the call's own name.
function withoutCall(p) {
  if (!p) return null;
  const { call, ...rest } = p;
  return rest;
}


// The space the stream currently hears: the first online owner's space (the
// host admin's stand-in counts as one), or the Lobby if no owner is in a call.
// With the usual single GM this is exactly "wherever the GM is"; with more
// than one online owner, whichever is earliest in the user list wins.
function activeSpaceId(online) {
  for (const u of store.users) {
    if (!hasOwnerRights(u)) continue;
    const p = online.get(u.key);
    if (p) return followableSpaceId(p.space);
  }
  return LOBBY;
}

// A private aside is off the record entirely -- the stream should keep
// hearing wherever the admin was a moment ago, not cut away to (or hide
// behind) an aside Studio is told to treat as not-recording. Walk back to the
// nearest non-private ancestor, normally just the one `origin` hop.
function followableSpaceId(spaceId) {
  const aside = store.asideById(spaceId);
  if (aside?.private && aside.origin) return followableSpaceId(aside.origin);
  return spaceId;
}

// Whether activeSpace actually means anything right now: with no owner
// online there's no "wherever the GM is" to compare against, and view.js's
// aside dim treatment needs to know that rather than reading activeSpace's
// Lobby fallback as a real space everyone else is suddenly "aside" from.
function hasOnlineOwner(online) {
  return store.users.some((u) => hasOwnerRights(u) && online.has(u.key));
}

// --- helpers ---------------------------------------------------------------

function baseUrl(req) {
  return `${auth.isSecure(req) ? 'https' : 'http'}://${req.get('x-forwarded-host') || req.get('host')}`;
}

function currentUser(req) {
  if (req._user !== undefined) return req._user;
  req._user = auth.readSession(store.sessionSecret, auth.sessionToken(req), (key) => store.userByKey(key));
  return req._user;
}

// A hint, not a session: on a real sign-in at this environment (never the host admin's own), remembers which
// slugs this browser has used, most recent first, so the product page's own Sign in can offer them back without
// the host ever learning who anyone is (see "Sign in from the product page" in plan-environments.md). Only set with a
// base domain; never cleared on sign-out, since it names no person, just a short list of addresses.
function setEnvHint(req, res) {
  if (!BASE_DOMAIN) return;
  const env = currentEnvironment();
  if (!env.slug) return;
  const existing = (auth.parseCookies(req.get('cookie')).env_hint || '').split(',').map((s) => s.trim()).filter(Boolean);
  const slugs = [env.slug, ...existing.filter((s) => s !== env.slug)].slice(0, 5);
  res.cookie('env_hint', slugs.join(','), { domain: BASE_DOMAIN, path: '/', sameSite: 'lax', secure: auth.isSecure(req), maxAge: 365 * 86400000, httpOnly: false });
}

// A login and password checked against this environment's own users first, same as always; when that fails and
// there is a host registry, checked against the host admins there too -- the person running the whole deployment
// should be able to sign into any one of them. A match against the registry never touches that user's password
// inside the environment: it only ensures a user record exists for that login (hostAdmin: true, passwordHash
// always null, so nothing here can ever authenticate as it directly -- see PATCH /api/users/:key's refusal), so
// the check always goes back to the registry, every time. Never applied when a *different*, ordinary user
// already owns that login here: a name collision just means the host admin cannot sign in with that particular
// login at this one environment, never that they take over someone else's account.
function resolveLoginUser(login, password) {
  const user = store.userByLogin(login);
  if (user && user.passwordHash && auth.verifyPassword(password, user.passwordHash)) return user;
  if (!hostRegistry || (user && !user.hostAdmin)) return null;
  const admin = hostRegistry.findAdminByLogin(login);
  if (!admin || !auth.verifyPassword(password, admin.passwordHash)) return null;
  return user || store.addUser({ login, displayName: login, role: 'admin', passwordHash: null, hostAdmin: true });
}

// --- two-step sign-in (documentation/plans/plan-mfa.md) -----------------------------------------------------


// Whether the lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) applies to this particular person: an environment's own
// owner, or a single-environment install's admin (the account ADMIN_LOGIN names, which the bypass exists to let back
// in) -- never the host admin's own cross sign-in stand-in, which has no real factor of its own to be locked out of
// (documentation/plans/plan-mfa.md, "Regaining access").
function mfaBypassApplies(user) {
  return adminMfaLockoutBypass && (user.role === 'owner' || (user.role === 'admin' && !user.hostAdmin));
}

// Whether the environment's policy requires this particular person to have a second factor: settings.mfaRequired,
// a plain on/off, unless the whole feature is not offered or the lockout bypass excuses this person from it. The
// host admin's own cross sign-in user is never required here -- their own factor lives at the host console,
// under HOST_MFA_REQUIRED, a separate account entirely.
function mfaPolicyRequires(user) {
  if (!mfaOffered || user.hostAdmin || mfaBypassApplies(user)) return false;
  return Boolean(store.settings.mfaRequired);
}

// The pending step: called right after the first factor succeeds, before any session is issued. Returns null
// when nothing more is owed (the feature is not offered at all, the host admin's own cross sign-in, the
// lockout bypass excusing an admin from both the step and the enrol requirement, no factor and the policy
// does not require one, or a valid mfa_trust cookie for this exact person -- readSession's own stamp check
// already busts it on a reset or a fresh enrolment, since userStamp folds in mfa.version); otherwise
// { enrol, pending } for the caller to answer or redirect with instead of a session.
function mfaGate(req, user) {
  if (!mfaOffered || user.hostAdmin || mfaBypassApplies(user)) return null;
  const enrolled = Boolean(user.mfa);
  if (!enrolled && !store.settings.mfaRequired) return null;
  const trust = auth.readSession(store.sessionSecret, auth.sessionToken(req, auth.TRUST_COOKIE), (key) => (key === user.key ? user : null));
  if (trust) return null;
  const purpose = enrolled ? 'verify' : 'enrol';
  return { enrol: !enrolled, pending: auth.issuePending(store.sessionSecret, { userKey: user.key, env: currentEnvironment().slug || '', purpose }) };
}

// Who is enrolling: the signed-in person, or -- with no session yet -- whoever holds a valid 'enrol' pending
// token (a required account with no factor lands here straight from the first factor, with nothing else to
// prove who they are). Null when neither is true.
function mfaSubject(req) {
  const user = currentUser(req);
  if (user) return user;
  const token = req.body?.pending || auth.parseCookies(req.get('cookie'))[auth.PENDING_COOKIE] || null;
  const pend = token && auth.readPending(store.sessionSecret, token, { env: currentEnvironment().slug || '', purpose: 'enrol' });
  return pend ? store.userByKey(pend.u) : null;
}

// Every enrolment and reset route refuses outright while the feature is turned off server-wide: enrolments
// already made are kept either way, nothing here deletes anything (documentation/plans/plan-mfa.md).
function requireMfaOffered(req, res, next) {
  if (!mfaOffered) return res.status(403).json({ error: 'two-step sign-in is not offered on this server' });
  next();
}

// Checks a code against this person's own factor: a TOTP code (recording the step used, so it cannot be
// replayed) or a recovery code (spending it, which bumps mfa.version and so signs out every other session and
// trusted browser -- using one means the normal device is unavailable, a security-relevant event in its own
// right). `onStep`/`onRecovery` persist the outcome; this function only decides whether the code is good.
function verifyMfaCode(mfa, code, { onStep, onRecovery }) {
  if (!mfa) return false;
  const plain = auth.decryptSecret(mfa.secret, secretsKeyBuf());
  const step = plain ? auth.totpVerify(plain, code, mfa.lastStep) : null;
  if (step !== null && step !== undefined) {
    onStep(step);
    return true;
  }
  const hash = mfa.recovery.find((h) => auth.verifyPassword(String(code || '').trim(), h));
  if (hash) {
    onRecovery(hash);
    return true;
  }
  return false;
}

function hasStreamKey(req) {
  const given = String(req.query.s || req.get('x-stream-key') || '');
  const wanted = store.streamKey;
  return given.length === wanted.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(wanted));
}

// An owner, or the host admin signed in through the stand-in: every right in this environment.
function isOwner(req) {
  return hasOwnerRights(currentUser(req));
}

// Stream access: an owner's session or the stream key (OBS, the Studio app).
function hasStreamAccess(req) {
  return isOwner(req) || hasStreamKey(req);
}

// A guest's reads of pictures (/img/...): any request carrying a space's
// current guest token, on top of a real session or the stream key. Not
// scoped to that one space -- same broad-but-low-stakes trust as the stream
// key above. A guest's presence read does not use this: presenceViewer()
// below scopes it to the guest link's own space (server/presence-view.js).
function hasGuestAccess(req) {
  const token = req.query.guest;
  return typeof token === 'string' && !!store.spaceByGuestToken(token);
}

function requireUser(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: 'sign in first' });
  next();
}

function requireOwner(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: 'sign in first' });
  if (!isOwner(req)) return res.status(403).json({ error: `${word('owner', { many: true })} only` });
  next();
}

function requireStream(req, res, next) {
  if (!hasStreamAccess(req)) return res.status(403).json({ error: 'stream key required' });
  next();
}

// Who may see a person's personal link (/j/<token>, a sign-in in itself): an owner, and the person themselves.
// `self`: the answer is about the person making the request, even before a session exists (sign-in, register).
// `link: false` leaves it out whoever asks (GET /api/status, which the access key in every OBS link reads).
function maySeeLink(req, u, { self = false, link } = {}) {
  if (link === false) return false;
  if (self || isOwner(req)) return true;
  return currentUser(req)?.key === u.key;
}

function publicUser(req, u, opts = {}) {
  // Every space this person actually belongs to right now (never the Lobby --
  // per-space images are for the spaces an owner picked them into, not the
  // one everyone is always in), each with which of their own images override
  // the defaults there.
  const spaces = {};
  for (const space of store.spaces) {
    if (space.isLobby || !space.members.includes(u.key)) continue;
    spaces[space.id] = {
      images: Object.fromEntries(SLOTS.map((slot) => [slot, !!u.spaces[space.id]?.images?.[slot]])),
      useDefaultImages: u.spaces[space.id]?.useDefaultImages !== false,
      permissions: store.spaceFlags(u.key, space.id), // the stored ticks, for the profile page
      effective: store.spacePermissions(u.key, space.id), // what they can actually do there
      // Whether they hold an address for this space (plan-space-calendars.md, section 1), for the same people who see
      // the personal one: never its hash.
      ...(maySeeLink(req, u, opts) ? { calendarFeed: feedView(u.spaces[space.id]?.calendarFeed) } : {}),
    };
  }
  return {
    key: u.key,
    login: u.login,
    displayName: u.displayName,
    role: u.role,
    hostAdmin: u.hostAdmin, // signs in through the host console, not a password of its own -- see resolveLoginUser
    hasPassword: !!u.passwordHash,
    mfaEnrolled: Boolean(u.mfa), // the only mfa field a person other than the account itself ever sees
    // The personal link only for those maySeeLink allows; left out entirely for anyone else.
    ...(maySeeLink(req, u, opts) ? { link: u.linkToken ? `${baseUrl(req)}/j/${u.linkToken}` : null } : {}),
    // Whether they have a calendar feed, for the same people: never its address or its hash (plan-google-calendar.md).
    ...(maySeeLink(req, u, opts) ? { calendarFeed: calendarFeedView(u) } : {}),
    images: Object.fromEntries(SLOTS.map((slot) => [slot, !!u.images[slot]])),
    spaces,
    permissions: store.spacePermissions(u.key, null), // their role's, outside any one space
    player: { ...u.player, effective: store.effectivePlayer(u) },
    callPrefs: u.callPrefs,
    themeMode: u.themeMode || null, // their own light or dark; null follows the environment's default (GitHub #62)
    viewUrl: `${baseUrl(req)}/view/${u.key}`,
    createdAt: u.createdAt,
  };
}

// What the call and the view pages need about everyone: name and the
// talking colour, so tiles and frames match. pictureScale is the conference's
// portrait size (store.settings), the same number the participant box uses.
function presenceUser(u) {
  const p = store.effectivePlayer(u);
  return { key: u.key, displayName: u.displayName, isOwner: hasOwnerRights(u), border: p.border, borderColor: p.borderColor, borderWidth: p.borderWidth, mutedBorder: p.mutedBorder, mutedColor: p.mutedColor, plate: p.plate, plateLayout: p.plateLayout, plateColor: p.plateColor, plateTextColor: p.plateTextColor, plateFontSize: p.plateFontSize, plateOpacity: p.plateOpacity, plateTextCase: p.plateTextCase, charBorder: p.charBorder, charBorderColor: p.charBorderColor, charMutedBorder: p.charMutedBorder, charMutedColor: p.charMutedColor, charBorderWidth: p.charBorderWidth, pictureBackground: p.pictureBackground, pictureColor: p.pictureColor, pictureScale: p.pictureScale, images: Object.fromEntries(SLOTS.map((slot) => [slot, !!u.images[slot]])) };
}

// A space's guest link (guestToken, a way into the call in itself) goes only to those who can manage it: an owner
// (or the admin), and a member of that space with "Manage a space's guest link" (canInvite) -- the same people the
// guest-link routes let change it. Everyone else (a member without it, a member of another space, a guest, an
// access-key holder) gets the space with guestToken null.
function maySeeGuestLink(user, space) {
  if (!user) return false;
  if (hasOwnerRights(user)) return true;
  return space.members.includes(user.key) && Boolean(store.spacePermissions(user.key, space.id).canInvite);
}
// The space's budget target (#216; plan-budget-module.md, decisions 3, 5 and 6) is not a general part of the space.
// Members read it through the module: its context (GET /api/modules/:id/context, for a signed-in person who may read
// that module there; a guest gets null). Those who edit it (owners, the admin and that space's moderators) also read it
// through Set up's read (GET /api/spaces/:id) and their own PATCH's answer. Every other view of a space (the presence
// list, GET /api/spaces, the stream's status, an access key's or a guest's) leaves it out.
function withoutBudget(space) {
  if (!space || !('budget' in space)) return space;
  const { budget: _budget, ...rest } = space;
  return rest;
}
function shownSpace(req, space) {
  const general = withoutBudget(space);
  if (!general || !general.guestToken || maySeeGuestLink(currentUser(req), general)) return general;
  return { ...general, guestToken: null };
}
// A member ticked as this space's moderator (Manage > People, the space's permissions).
function moderates(user, space) {
  return Boolean(user && space && space.members.includes(user.key) && store.spaceFlags(user.key, space.id).moderator);
}
// A space answered to the person who changed it: whole for those who edit the budget (owners, the admin, a moderator
// of that space), without the budget for anyone else (a member's guest link).
const answeredSpace = (req, space) => {
  const user = currentUser(req);
  return hasOwnerRights(user) || moderates(user, space) ? space : withoutBudget(space);
};

// The environment's default mode (Manage > Theme), and the fingerprint of its /theme.css (server/theme-css.js).
const environmentThemeMode = () => (store.settings.themeMode === 'light' ? 'light' : 'dark');
const environmentThemeVersion = () => themeCssLib.themeVersion(store.activeThemeSets(), environmentThemeMode());
// Runs an owner's theme change and, when what /theme.css says changed, tells every open page (the 'theme' event on
// /api/notifications/stream), so each one re-fetches it at once instead of on its next load. A refused change throws
// before anything is told.
function watchTheme(change) {
  const before = environmentThemeVersion();
  const out = change();
  const version = environmentThemeVersion();
  if (version !== before) themeEvents.emit('theme', { themeMode: environmentThemeMode(), activeThemeId: store.settings.activeThemeId || null, version });
  return out;
}

function branding() {
  const s = store.settings;
  // The template's ordered phases, for the phase chip (plan-one-bar.md, step 3); [] with no template or none in it.
  const phases = (Array.isArray(store.templatePhases) ? store.templatePhases : []).map((p) => ({ id: p.id, label: p.label, ...(p.main ? { main: true } : {}), ...(p.icon ? { icon: p.icon } : {}) }));
  return { environmentName: s.environmentName, productName: PRODUCT_NAME, productShortName: PRODUCT_SHORT_NAME, hosted: Boolean(BASE_DOMAIN), words: store.resolvedWords(), verbs: store.resolvedVerbs(), phases, homeIcon: store.homeIcon, templateHomeIcon: store.templateHomeIcon || null, loginText: s.loginText, language: s.language || 'en', clock: s.clock === '24' ? '24' : '12', currency: s.currency || 'USD', allowRegistration: Boolean(s.allowRegistration), mfaOffered, mfaRequired: Boolean(s.mfaRequired), maxQuality: s.maxQuality || 720, allowScreenShare: s.allowScreenShare !== false, allowAsides: s.allowAsides !== false, allowPrivate: s.allowPrivate !== false, allowReactions: s.allowReactions !== false, conferenceEnabled: s.conferenceEnabled !== false, callService: HAS_CALL_SERVICE, autoJoinCall: s.autoJoinCall === true, activeThemeId: s.activeThemeId || null, themeMode: environmentThemeMode(), themeVersion: environmentThemeVersion(), hasIcon: !!store.iconPath(), hasBackground: !!store.siteImagePath('background'), version: VERSION, border: s.border, borderColor: s.borderColor, borderWidth: s.borderWidth || 6, mutedBorder: s.mutedBorder !== false, mutedColor: s.mutedColor || '#b8503f', plate: Boolean(s.plate), plateLayout: s.plateLayout || 'lower-left', plateColor: s.plateColor || '#000000', plateTextColor: s.plateTextColor || '#f1e6d8', plateFontSize: s.plateFontSize || 16, plateOpacity: s.plateOpacity ?? 60, plateTextCase: s.plateTextCase || 'default', charBorder: Boolean(s.charBorder), charBorderColor: s.charBorderColor || '#6fae6b', charMutedBorder: Boolean(s.charMutedBorder), charMutedColor: s.charMutedColor || '#b8503f', charBorderWidth: s.charBorderWidth || 6, pictureBackground: Boolean(s.pictureBackground), pictureColor: s.pictureColor || '#1a1410', pictureScale: s.pictureScale || 100, offlineDim: s.offlineDim ?? 0, offlineTint: s.offlineTint || '#000000', offlineTintOpacity: s.offlineTintOpacity ?? 0, asideDim: s.asideDim ?? 0, asideTint: s.asideTint || '#000000', asideTintOpacity: s.asideTintOpacity ?? 0, privateDim: s.privateDim ?? 0, privateTint: s.privateTint || '#000000', privateTintOpacity: s.privateTintOpacity ?? 0, reactions: Array.isArray(s.reactions) ? s.reactions : [], icons: Array.isArray(s.icons) ? s.icons : [], guestImages: Object.fromEntries(PARTICIPANT_SLOTS.map((slot) => [slot, !!store.guestImagePath(slot)])), defaultImages: Object.fromEntries(PARTICIPANT_SLOTS.map((slot) => [slot, !!store.defaultImagePath(slot)])) };
}

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const text = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2);
  return text.toUpperCase();
}

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
}

function initialsSvg(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">` +
    `<rect width="400" height="400" rx="24" fill="#241c16"/>` +
    `<text x="200" y="200" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="140" font-weight="700" fill="#c8873a">${escapeXml(initials(name))}</text>` +
    `</svg>`;
}

function sendImage(res, file) {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(file);
}

// The generic guest picture, when the admin hasn't set one -- a person
// glyph rather than initials, since a guest tile has no name to draw from
// server-side (that only lives in the LiveKit token, not in our data).
function guestSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">` +
    `<rect width="400" height="400" rx="24" fill="#241c16"/>` +
    `<circle cx="200" cy="155" r="70" fill="#c8873a"/>` +
    `<path d="M60 360c0-90 63-150 140-150s140 60 140 150" fill="#c8873a"/>` +
    `</svg>`;
}

// --- app -------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
// Trust only the proxies in front of us (TRUST_PROXY_HOPS), never `true`: with `true` req.ip is the leftmost
// X-Forwarded-For address, which the client writes, so every per-address limit (sign-in, sign-up, guest chat) could be
// dodged. With a hop count req.ip is the address the nearest trusted proxy saw, and X-Forwarded-Proto/Host (req.protocol,
// req.hostname, so BASE_DOMAIN's host matching) are read only when the connection comes from a trusted proxy.
const trustProxyHops = (() => {
  const raw = String(TRUST_PROXY_HOPS).trim();
  if (raw === '') return 1;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n;
  console.warn(`TRUST_PROXY_HOPS=${raw} is not a whole number of 0 or more: using 1.`);
  return 1;
})();
app.set('trust proxy', trustProxyHops);
// The server waits up to two hours for a request's body (listener.requestTimeout, below), for a library upload of 2 GB
// on a slow link; that upload route cuts off one too slow itself (watchArrival), and a library file's small picture has
// its own deadline. Every other route's body must have arrived REQUEST_BODY_SECONDS (300, as Node's own limit would have
// it) after its headers, or the connection is closed, so nobody can hold any other route open by sending a byte now and
// then (security QA round 2, round 2).
const BODY_MS = (() => { const v = Number(REQUEST_BODY_SECONDS); return Math.round((Number.isFinite(v) && v > 0 ? v : 300) * 1000); })();
const LIBRARY_UPLOAD = /^\/api\/modules\/[^/]+\/library\/?$/i;
const LIBRARY_THUMB_UPLOAD = /^\/api\/modules\/[^/]+\/library\/[^/]+\/thumb\/?$/i;
app.use((req, res, next) => {
  if (req.complete || (req.method === 'POST' && LIBRARY_UPLOAD.test(req.path)) || (req.method === 'PUT' && LIBRARY_THUMB_UPLOAD.test(req.path))) return next();
  const timer = setTimeout(() => { if (!req.complete) req.socket.destroy(); }, BODY_MS);
  timer.unref();
  const done = () => clearTimeout(timer);
  req.once('end', done);
  req.once('close', done);
  next();
});
// Writes only from this origin. A SameSite=Lax cookie still goes along with a request from another origin on the same
// site (on a hosted server every environment is *.BASE_DOMAIN, the console admin.BASE_DOMAIN), and a plain form or a
// no-cors fetch needs no preflight. So a POST, PUT, PATCH or DELETE that carries a cookie is refused when the browser
// says it came from anywhere but this origin (Sec-Fetch-Site), or its Origin isn't this one (baseUrl minds
// X-Forwarded-*). Passes: a Bearer token (Studio; a page elsewhere can't add one without a preflight nobody answers),
// no cookie at all (webhooks, server-to-server), and neither header (old browsers, curl).
// Exempt: POST /login, the sign-in form, which the landing page at the bare base domain posts across origins by
// design; it trusts only the login and password it is sent, never a cookie, and replaces whatever session there was.
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CROSS_ORIGIN_EXEMPT = new Set(['/login']);
function sameOriginOnly(req, res, next) {
  if (/^bearer\s/i.test(req.get('authorization') || '') || !req.get('cookie')) return next();
  const site = req.get('sec-fetch-site');
  const origin = req.get('origin');
  if ((site && site !== 'same-origin' && site !== 'none') || (origin && origin.toLowerCase() !== baseUrl(req).toLowerCase())) {
    return res.status(403).json({ error: 'This request came from another site, so it was refused.' });
  }
  next();
}
app.use((req, res, next) => (WRITE_METHODS.has(req.method) && !CROSS_ORIGIN_EXEMPT.has(req.path) ? sameOriginOnly(req, res, next) : next()));
// verify stashes the exact bytes received, alongside the parsed req.body -- the billing webhook's signature
// (plan-environments.md, "Phase 5") is an HMAC over those bytes, not a re-serialization of the parsed object, which
// would not reliably reproduce what the sender actually signed (key order, whitespace).
// The module file upload (PUT /api/modules/:id/files/:folder) reads its own body and checks its own content type, so a
// wrong type answers that route's own 415, not this parser's 413: the parser leaves that route's body alone.
const MODULE_FILE_UPLOAD = /^\/api\/modules\/[^/]+\/files\/[^/]+$/;
// A module's library routes (a space's files) decide who may before any of the body is read, so this parser leaves
// them alone; the one that takes JSON (a rename) parses its own small body after that.
const LIBRARY_ROUTE = /^\/api\/modules\/[^/]+\/library(?:\/|$)/i; // routes match whatever the case, so this does too
app.use(express.json({ limit: '64kb', type: (req) => !(req.method === 'PUT' && MODULE_FILE_UPLOAD.test(req.path)) && !LIBRARY_ROUTE.test(req.path) && Boolean(req.is('application/json')), verify: (req, _res, buf) => { req.rawBody = buf; } }));

const publicDir = path.join(__dirname, '..', 'public');
const clientDist = path.join(__dirname, '..', 'node_modules', 'livekit-client', 'dist');
const page = (name) => path.join(publicDir, name);
// A template file's text, whatever type it is sent as (the JSON body parser reads it when it is JSON).
const templateFileText = express.text({ type: () => true, limit: 64 * 1024 });
// A theme file's text (POST /api/themes/import, POST /api/host/themes/check). Its own 16 KB limit: a JSON body is parsed
// by the app's own parser (64 KB) and measured by the route by the bytes received; any other type is read as text up
// to the limit (a bigger one, and one the app's parser can't read, get the same sentence -- see the error handler).
const themeFileText = express.text({ type: () => true, limit: themeFile.MAX_THEME_FILE_BYTES });
const rawZip = express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: MODULE_LIMITS.zipBytes + 1024 });
const rawImage = express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE_BYTES + 1024 });

// --- the host console and its API (documentation/plans/plan-environments.md) ----------------------------------------
// A separate mini-app, reached only at admin.<base>: never mounted on the main app directly, so a request routed
// here can never fall through to an environment's own routes below (which need an environment resolved, and none is,
// for the host admin -- see requireHostAdmin, its own session, auth.HOST_COOKIE, never an environment's).
const hostRouter = express.Router();
const hostLimiter = new auth.LoginLimiter();

function currentHostAdmin(req) {
  if (req._hostAdmin !== undefined) return req._hostAdmin;
  req._hostAdmin = hostRegistry ? auth.readSession(hostRegistry.sessionSecret, auth.sessionToken(req, auth.HOST_COOKIE), (key) => hostRegistry.findAdminByKey(key)) : null;
  return req._hostAdmin;
}
function requireHostAdmin(req, res, next) {
  if (!currentHostAdmin(req)) return res.status(401).json({ error: 'sign in first' });
  next();
}
function sendHostError(err, res) {
  if (err instanceof HostError) return res.status(err.status).json({ error: err.message });
  throw err;
}

hostRouter.use(express.static(publicDir, { index: false }));
hostRouter.get('/', (_req, res) => res.sendFile(page('host.html')));

// The host admins' own second step (documentation/plans/plan-mfa.md): HOST_MFA_REQUIRED makes it mandatory,
// same shape as an environment's own gate but keyed on hostRegistry's session secret and its own admin records,
// never an environment's -- 'host' is a reserved slug (RESERVED_SLUGS in server/host-registry.js), so no new environment can take it and collide with a real
// environment's own pending tokens even though the cookie names are shared. Every host admin is eligible for
// the lockout bypass (there is no separate role to check, unlike an environment's own admins).
function hostMfaGate(req, admin) {
  if (!mfaOffered || adminMfaLockoutBypass) return null;
  const enrolled = Boolean(admin.mfa);
  if (!enrolled && !hostMfaRequired) return null;
  const trust = auth.readSession(hostRegistry.sessionSecret, auth.sessionToken(req, auth.TRUST_COOKIE), (key) => (key === admin.key ? admin : null));
  if (trust) return null;
  const purpose = enrolled ? 'verify' : 'enrol';
  return { enrol: !enrolled, pending: auth.issuePending(hostRegistry.sessionSecret, { userKey: admin.key, env: 'host', purpose }) };
}
function hostMfaSubject(req) {
  const admin = currentHostAdmin(req);
  if (admin) return admin;
  const token = req.body?.pending || auth.parseCookies(req.get('cookie'))[auth.PENDING_COOKIE] || null;
  const pend = token && auth.readPending(hostRegistry.sessionSecret, token, { env: 'host', purpose: 'enrol' });
  return pend ? hostRegistry.findAdminByKey(pend.u) : null;
}
hostRouter.post('/api/host/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (hostLimiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a few minutes' });
  const found = hostRegistry.findAdminByLogin(req.body?.login);
  const ok = found && auth.verifyPassword(req.body?.password || '', found.passwordHash);
  if (!ok) { hostLimiter.fail(ip); return res.status(401).json({ error: 'wrong username or password' }); }
  hostLimiter.clear(ip);
  const gate = hostMfaGate(req, found);
  if (gate) {
    auth.setPendingCookie(req, res, gate.pending);
    return res.json({ mfaRequired: true, enrol: gate.enrol, pending: gate.pending });
  }
  const token = auth.issueSession(hostRegistry.sessionSecret, found);
  auth.setSessionCookie(req, res, token, auth.HOST_COOKIE);
  res.json({ admin: { key: found.key, login: found.login } });
});
hostRouter.post('/api/host/login/verify', (req, res) => {
  const ip = req.ip || 'unknown';
  if (hostLimiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a few minutes' });
  const pendingToken = req.body?.pending || auth.parseCookies(req.get('cookie'))[auth.PENDING_COOKIE] || null;
  const pend = pendingToken && auth.readPending(hostRegistry.sessionSecret, pendingToken, { env: 'host', purpose: 'verify' });
  const admin = pend && hostRegistry.findAdminByKey(pend.u);
  if (!admin || !admin.mfa) { hostLimiter.fail(ip); return res.status(401).json({ error: 'sign in again' }); }
  const ok = verifyMfaCode(admin.mfa, req.body?.code, {
    onStep: (step) => hostRegistry.hostAdminMfaRecordStep(admin.key, step),
    onRecovery: (hash) => hostRegistry.hostAdminMfaSpendRecovery(admin.key, hash),
  });
  if (!ok) { hostLimiter.fail(ip); return res.status(401).json({ error: 'wrong code' }); }
  hostLimiter.clear(ip);
  const fresh = hostRegistry.findAdminByKey(admin.key);
  const token = auth.issueSession(hostRegistry.sessionSecret, fresh);
  auth.setSessionCookie(req, res, token, auth.HOST_COOKIE);
  auth.clearSessionCookie(req, res, auth.PENDING_COOKIE);
  if (req.body?.remember) auth.setSessionCookie(req, res, auth.issueSession(hostRegistry.sessionSecret, fresh), auth.TRUST_COOKIE);
  res.json({ admin: { key: fresh.key, login: fresh.login } });
});
hostRouter.post('/api/host/logout', (req, res) => { auth.clearSessionCookie(req, res, auth.HOST_COOKIE); res.json({ ok: true }); });
hostRouter.get('/api/host/me', (req, res) => {
  const found = currentHostAdmin(req);
  if (!found) return res.status(401).json({ error: 'sign in first' });
  res.json({ admin: { key: found.key, login: found.login }, mfaEnrolled: Boolean(found.mfa), mfaRequired: mfaOffered && !adminMfaLockoutBypass && !found.mfa && hostMfaRequired, mfaOffered, mfaBypass: adminMfaLockoutBypass });
});
hostRouter.post('/api/host/me/mfa/start', requireMfaOffered, async (req, res) => {
  const admin = hostMfaSubject(req);
  if (!admin) return res.status(401).json({ error: 'sign in first' });
  const secret = auth.totpSecret();
  hostRegistry.hostAdminMfaStart(admin.key, auth.encryptSecret(secret, secretsKeyBuf()));
  const otpauth = auth.otpauthUrl(PRODUCT_NAME, admin.login, secret);
  const qr = await QRCode.toString(otpauth, { type: 'svg' });
  res.json({ otpauth, qr, secret });
});
hostRouter.post('/api/host/me/mfa/enable', requireMfaOffered, (req, res) => {
  const admin = hostMfaSubject(req);
  if (!admin) return res.status(401).json({ error: 'sign in first' });
  const pending = admin.mfa?.pending;
  if (!pending || Date.now() - new Date(pending.startedAt).getTime() > 3600000) return res.status(400).json({ error: 'start enrolment again' });
  const plain = auth.decryptSecret(pending.secret, secretsKeyBuf());
  const step = plain ? auth.totpVerify(plain, req.body?.code) : null;
  if (step === null || step === undefined) return res.status(401).json({ error: 'wrong code' });
  const recoveryCodes = auth.recoveryCodes();
  hostRegistry.hostAdminMfaEnable(admin.key, recoveryCodes.map((c) => auth.hashPassword(c)));
  hostRegistry.hostAdminMfaRecordStep(admin.key, step);
  const fresh = hostRegistry.findAdminByKey(admin.key);
  // Same reissue as /api/me/mfa/enable, and for the same reason: enabling bumps mfa.version, changing this
  // admin's own userStamp, which would otherwise silently sign an already-signed-in caller out of the very
  // enrolment they just finished.
  const token = auth.issueSession(hostRegistry.sessionSecret, fresh);
  auth.setSessionCookie(req, res, token, auth.HOST_COOKIE);
  auth.clearSessionCookie(req, res, auth.PENDING_COOKIE);
  const out = { recoveryCodes, admin: { key: fresh.key, login: fresh.login }, token };
  res.json(out);
});
hostRouter.post('/api/host/me/mfa/disable', requireMfaOffered, requireHostAdmin, (req, res) => {
  const admin = currentHostAdmin(req);
  if (!admin.mfa) return res.status(400).json({ error: 'no second factor to disable' });
  if (hostMfaRequired && !adminMfaLockoutBypass) return res.status(403).json({ error: 'this deployment requires a second factor for host admins' });
  const ok = verifyMfaCode(admin.mfa, req.body?.code, { onStep: () => {}, onRecovery: () => {} });
  if (!ok) return res.status(401).json({ error: 'wrong code' });
  hostRegistry.hostAdminMfaDisable(admin.key);
  // Same reissue as /api/me/mfa/disable, and for the same reason.
  const token = auth.issueSession(hostRegistry.sessionSecret, hostRegistry.findAdminByKey(admin.key));
  auth.setSessionCookie(req, res, token, auth.HOST_COOKIE);
  res.json({ ok: true, token });
});
// The lockout bypass's own way back in for a host admin: no code, just the account's own password (mirrors
// POST /api/me/mfa/reset).
hostRouter.post('/api/host/me/mfa/reset', requireMfaOffered, requireHostAdmin, (req, res) => {
  const admin = currentHostAdmin(req);
  if (!adminMfaLockoutBypass) return res.status(403).json({ error: 'the lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is not turned on' });
  if (!auth.verifyPassword(req.body?.password || '', admin.passwordHash)) return res.status(401).json({ error: 'wrong password' });
  hostRegistry.hostAdminMfaDisable(admin.key);
  const token = auth.issueSession(hostRegistry.sessionSecret, hostRegistry.findAdminByKey(admin.key));
  auth.setSessionCookie(req, res, token, auth.HOST_COOKIE);
  res.json({ ok: true, token });
});
// A host admin resets an owner's factor from the console -- by login, never a key, since the console never
// learns an environment's own user keys (a peer session's amendment to the contract).
hostRouter.delete('/api/host/environments/:slug/owners/:login/mfa', requireHostAdmin, (req, res) => {
  if (!hostRegistry.findEnvironment(req.params.slug)) return res.status(404).json({ error: 'no such environment' });
  const env = environmentFor(req.params.slug);
  const owner = env.store.userByLogin(req.params.login);
  if (!owner || owner.role !== 'owner') return res.status(404).json({ error: 'no owner with that login there' });
  env.store.mfaDisable(owner.key);
  res.json({ ok: true });
});

// What an environment is using, from its own already-built services (building them if it is not running yet -- an
// admin looking at the list is reason enough to have it up). Storage isn't walked here (a real figure needs
// reading the whole directory); left null until that is worth the cost.
function environmentUsage(slug) {
  let env;
  try {
    env = environmentFor(slug);
  } catch (err) {
    // An environment refused by the Names migration (server/migrate-names.js) still lists, with nothing to count,
    // so the console stays usable to back it up or restore it.
    if (!(err instanceof MigrationError)) throw err;
    logRefusalOnce(slug);
    return { members: null, storageBytes: null, aiCallsThisMonth: null, spaces: null };
  }
  return { members: env.store.users.length, storageBytes: null, aiCallsThisMonth: hostRegistry.aiCallsThisMonth(slug), spaces: env.store.spaces.length };
}
// usage.callsNow for the console, for an environment whose plan caps calls: its running calls counted by the same rule
// as the cap (runningCalls: someone on the call, not merely in the space), from one list of LiveKit's calls for the
// whole host. Left out where there is no cap, or where LiveKit can't be asked.
async function hostCallsNow(list) {
  const out = new Map();
  const capped = list.filter((t) => t.plan?.calls != null && !refusalView(t.slug));
  if (!capped.length || !callService) return out;
  let listed;
  try {
    listed = await callService.listRooms();
  } catch {
    return out;
  }
  for (const t of capped) {
    let env;
    try {
      env = environmentFor(t.slug);
    } catch {
      continue;
    }
    const running = await envContext.run(env, () => runningCalls({ listed }));
    if (running) out.set(t.slug, running.size);
  }
  return out;
}
hostRouter.get('/api/host/environments', requireHostAdmin, async (_req, res) => {
  // `refused`: null, or why this environment is not opening (see refusalView), for the console to show.
  // `template`: the template it was made from, with what was skipped (templateView), or null.
  const list = hostRegistry.listEnvironments();
  const callsNow = await hostCallsNow(list);
  res.json({ environments: list.map((t) => { const usage = environmentUsage(t.slug); if (callsNow.has(t.slug)) usage.callsNow = callsNow.get(t.slug); return { ...t, usage, refused: refusalView(t.slug), template: environmentTemplate(t) }; }) });
});
// The templates an environment can be made from, for the console's create form.
// Every template, with where it comes from, its version, whether it is hidden and which environments use it.
hostRouter.get('/api/host/templates', requireHostAdmin, (_req, res) => {
  const used = hostRegistry.listEnvironments();
  res.json({ templates: [...templateCatalog(null).values()].map((t) => ({ ...templateSummary(t), edited: Boolean(t.edited), update: t.update || null, usedBy: used.filter((e) => e.template === t.id).map((e) => e.slug) })) });
});
// One template in full, for the console's editor. An edited bundled template also carries `shipped`, for compare.
hostRouter.get('/api/host/templates/:id', requireHostAdmin, (req, res) => {
  const t = templateFor(null, req.params.id);
  if (!t) return noSuchTemplate(res, req.params.id);
  const template = fullTemplate(t);
  if (t.source === 'bundled' && t.edited) {
    const shipped = templates.get(t.id);
    if (shipped) template.shipped = { ...shipped, source: 'bundled', edited: false, hidden: false, update: null };
  }
  res.json({ template });
});
// A new host template: its fields (version, hidden and the dates are the server's). 409 when the id is taken.
hostRouter.post('/api/host/templates', requireHostAdmin, (req, res) => {
  const raw = templateFields(req.body);
  const problems = templates.problemsOf(raw, { bundled: bundledIds() });
  if (problems.length) return res.status(400).json({ error: problems[0], problems });
  if (templateFor(null, raw.id)) return res.status(409).json({ error: `There is already a template called ${raw.id}.` });
  const now = new Date().toISOString();
  hostRegistry.putTemplate({ ...raw, version: 1, hidden: false, createdAt: now, updatedAt: now });
  res.status(201).json({ template: fullTemplate(templateFor(null, raw.id)) });
});
// Edits a host template, or a bundled one (addendum 3: the edit is kept over the shipped file). Its version goes up,
// and every environment made from it reads its words, home icon and module names and icons from the new version at
// once. `{ hidden }` hides or shows it (no new version). A field sent as null is removed. The first edit of a bundled
// template is the shipped version plus one; every later edit adds one, and the version never goes down.
hostRouter.patch('/api/host/templates/:id', requireHostAdmin, (req, res) => {
  const t = templateFor(null, req.params.id);
  if (!t) return noSuchTemplate(res, req.params.id);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.hidden !== undefined && typeof body.hidden !== 'boolean') return res.status(400).json({ error: 'hidden must be true or false.' });
  if (t.source === 'bundled') return patchBundledTemplate(t, body, res);
  const stored = hostRegistry.templates.find((x) => x.id === t.id);
  const { id: _ignored, ...edits } = templateFields(body);
  const changed = Object.keys(edits).length > 0;
  let next = { ...stored, ...(body.hidden !== undefined ? { hidden: body.hidden } : {}) };
  if (changed) {
    const merged = { ...templateFields(stored), ...edits, id: t.id };
    for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
    const problems = templates.problemsOf(merged, { bundled: bundledIds() });
    if (problems.length) return res.status(400).json({ error: problems[0], problems });
    next = { ...merged, version: (stored.version || 1) + 1, hidden: next.hidden, createdAt: stored.createdAt, updatedAt: new Date().toISOString() };
  }
  hostRegistry.putTemplate(next);
  if (changed) refreshTemplateLive(t.id);
  res.json({ template: fullTemplate(templateFor(null, t.id)) });
});
// Reset a bundled template to the shipped file: the edit is dropped and the version goes up. A host template can't
// be reset; one that isn't edited has nothing to reset.
hostRouter.delete('/api/host/templates/:id/edits', requireHostAdmin, (req, res) => {
  const t = templateFor(null, req.params.id);
  if (!t) return noSuchTemplate(res, req.params.id);
  if (t.source !== 'bundled') return res.status(400).json({ error: 'Only a bundled template can be reset.' });
  if (!t.edited) return res.status(409).json({ error: `${t.name} has no edits to reset.` });
  const record = hostRegistry.bundledEdit(t.id);
  saveBundledEdit(t.id, { template: null, version: record.version + 1, base: bundledBase(templates.get(t.id)), hidden: record.hidden });
  refreshTemplateLive(t.id);
  res.json({ template: fullTemplate(templateFor(null, t.id)) });
});
// Answers the "updated in this image" notice. `shipped` drops the edits (a reset); `mine` keeps them and clears the
// notice, with no new version.
hostRouter.post('/api/host/templates/:id/update', requireHostAdmin, (req, res) => {
  const keep = req.body?.keep;
  if (keep !== 'shipped' && keep !== 'mine') return res.status(400).json({ error: 'keep must be shipped or mine.' });
  const t = templateFor(null, req.params.id);
  if (!t) return noSuchTemplate(res, req.params.id);
  if (!t.update) return res.status(409).json({ error: `There is no update to review for ${t.name}.` });
  const record = hostRegistry.bundledEdit(t.id);
  const shipped = templates.get(t.id);
  if (keep === 'mine') {
    saveBundledEdit(t.id, { template: record.template, version: record.version, base: bundledBase(shipped), hidden: record.hidden });
    return res.json({ template: fullTemplate(templateFor(null, t.id)) });
  }
  saveBundledEdit(t.id, { template: null, version: record.version + 1, base: bundledBase(shipped), hidden: record.hidden });
  refreshTemplateLive(t.id);
  res.json({ template: fullTemplate(templateFor(null, t.id)) });
});
// A new host template from the one in use (bundled or host), at version 1. The id and name come from the body.
hostRouter.post('/api/host/templates/:id/duplicate', requireHostAdmin, (req, res) => {
  const t = templateFor(null, req.params.id);
  if (!t) return noSuchTemplate(res, req.params.id);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const raw = { ...templateFields(t), id: body.id, name: body.name };
  for (const [k, v] of Object.entries(raw)) if (v === null) delete raw[k];
  const problems = templates.problemsOf(raw, { bundled: bundledIds() });
  if (problems.length) return res.status(400).json({ error: problems[0], problems });
  if (templateFor(null, raw.id)) return res.status(409).json({ error: `There is already a template called ${raw.id}.` });
  const now = new Date().toISOString();
  const stored = storedTemplate(templates.cleanTemplate(raw));
  hostRegistry.putTemplate({ ...stored, version: 1, hidden: false, createdAt: now, updatedAt: now });
  res.status(201).json({ template: fullTemplate(templateFor(null, raw.id)) });
});
// Deletes a host template no environment uses; one in use is hidden instead. A bundled template is hidden, not deleted.
hostRouter.delete('/api/host/templates/:id', requireHostAdmin, (req, res) => {
  const t = templateFor(null, req.params.id);
  if (!t) return noSuchTemplate(res, req.params.id);
  if (t.source === 'bundled') return res.status(403).json({ error: "Bundled templates can't be deleted. Hide it instead." });
  const users = hostRegistry.listEnvironments().filter((e) => e.template === t.id);
  if (users.length) return res.status(409).json({ error: `${word('environment', { many: true, cap: true })} use this template: ${users.map((e) => e.name || e.slug).join(', ')}. Hide it instead.` });
  hostRegistry.removeTemplate(t.id);
  res.json({ ok: true });
});
// A theme file checked for the template editor's theme picker (plan-kind-names.md, "Checking a theme file for the template
// editor"): the file's text as the body, read exactly as POST /api/themes/import reads it (the same 16 KB limit and
// sentences), and nothing stored. Answers the theme as the picker keeps it, and the keys it left out.
hostRouter.post('/api/host/themes/check', requireHostAdmin, sameOriginOnly, themeFileText, (req, res) => {
  try {
    const given = typeof req.body === 'string' ? req.body : req.body === undefined ? '' : req.body;
    const { dropped, ...theme } = themeFile.readThemeFile(given, (t) => Store.prototype.sanitizeTheme.call(null, t), { byteLength: req.rawBody ? req.rawBody.length : null });
    res.json({ theme, dropped });
  } catch (err) {
    if (err instanceof themeFile.ThemeFileError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});
hostRouter.get('/api/host/templates/:id/export', requireHostAdmin, (req, res) => sendTemplateFile(res, templateFor(null, req.params.id), req.params.id));
// Imports a template file as a new host template, keeping the file's version (at least 1). `?id=` gives it another id, for a file whose id is taken.
hostRouter.post('/api/host/templates/import', requireHostAdmin, sameOriginOnly, templateFileText, (req, res) => {
  const read = readTemplateUpload(req, null);
  if (read.error) return res.status(read.status).json(read.error);
  const now = new Date().toISOString();
  hostRegistry.putTemplate({ ...read.raw, version: Number.isInteger(read.raw.version) ? read.raw.version : 1, hidden: false, createdAt: now, updatedAt: now });
  res.status(201).json({ template: fullTemplate(templateFor(null, read.raw.id)), dropped: read.dropped });
});

// A template's own fields from a request body (never version, hidden or the dates, which are the server's).
function templateFields(body) {
  const out = {};
  for (const key of templates.FIELDS) if (key !== 'version' && body && body[key] !== undefined) out[key] = body[key];
  return out;
}
function noSuchTemplate(res, id) {
  return res.status(404).json({ error: `There is no template called ${String(id).slice(0, 40)}.` });
}
// The fields kept for a bundled edit: the template, without its version and without a part it does not have.
function storedTemplate(clean) {
  const out = {};
  for (const key of templates.FIELDS) {
    if (key === 'version') continue;
    if (clean[key] !== undefined && clean[key] !== null) out[key] = clean[key];
  }
  return out;
}
function saveBundledEdit(id, { template, version, base, hidden }) {
  hostRegistry.putBundledEdit({ id, template, version, base, hidden: Boolean(hidden), updatedAt: new Date().toISOString() });
}
// PATCH of a bundled id: the same body and checks as a host template. `{ hidden }` alone changes no version.
function patchBundledTemplate(t, body, res) {
  const shipped = templates.get(t.id);
  const record = hostRegistry.bundledEdit(t.id);
  const { id: _ignored, ...edits } = templateFields(body);
  const changed = Object.keys(edits).length > 0;
  const hidden = body.hidden !== undefined ? body.hidden : Boolean(record?.hidden);
  const versionNow = record?.version ?? shipped.version;
  const base = record?.base || bundledBase(shipped);
  if (!changed) {
    saveBundledEdit(t.id, { template: record?.template ?? null, version: versionNow, base, hidden });
    return res.json({ template: fullTemplate(templateFor(null, t.id)) });
  }
  const current = record?.template != null ? record.template : storedTemplate(shipped);
  const merged = { ...templateFields(current), ...edits, id: t.id };
  for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
  const problems = templates.problemsOf(merged, { bundled: bundledIds() });
  if (problems.length) return res.status(400).json({ error: problems[0], problems });
  const clean = templates.cleanTemplate({ ...merged, version: versionNow + 1 });
  saveBundledEdit(t.id, { template: storedTemplate(clean), version: versionNow + 1, base, hidden });
  refreshTemplateLive(t.id);
  return res.json({ template: fullTemplate(templateFor(null, t.id)) });
}
const bundledIds = () => bundledModules(BUNDLED_DIR).map((m) => m.id);
// A template in full, for an editor or an import's answer: its fields, source, version and hidden.
const fullTemplate = (t) => (t ? { ...t } : null);
// Every built environment made from template `id` reads its live part (words, verbs, phases, home icon, module names and icons) again.
function refreshTemplateLive(id) {
  for (const env of environments.values()) if (env.store.templateRecord?.id === id) templates.useLive(env.store, templateFor(env, id));
}
function sendTemplateFile(res, t, id) {
  if (!t) return res.status(404).json({ error: `There is no template called ${String(id).slice(0, 40)}.` });
  const file = templateFile.templateToFile(t);
  res.set('Content-Disposition', `attachment; filename="${templateFile.templateFileName(t.name)}"`);
  res.type('application/json').send(`${JSON.stringify(file, null, 2)}\n`);
}
// A template file from an import request (JSON, or its text with any other type), checked, with `?id=` renaming it.
// Answers { raw, dropped } or { status, error }.
function readTemplateUpload(req, env) {
  try {
    const given = typeof req.body === 'string' ? req.body : req.body === undefined ? '' : req.body;
    const read = templateFile.readTemplateFile(given, { bundled: bundledIds(), byteLength: req.rawBody ? req.rawBody.length : null });
    const rename = typeof req.query.id === 'string' && req.query.id ? req.query.id : null;
    if (rename) {
      read.raw.id = rename;
      const problems = templates.problemsOf(read.raw, { bundled: bundledIds() });
      if (problems.length) return { status: 400, error: { error: problems[0], problems } };
    }
    if (templateFor(env, read.raw.id)) return { status: 409, error: { error: `There is already a template called ${read.raw.id}.` } };
    return read;
  } catch (err) {
    if (err instanceof templateFile.TemplateFileError) return { status: err.status, error: { error: err.message, ...(err.problems ? { problems: err.problems } : {}) } };
    throw err;
  }
}

// A template id from a create or sign-up request, checked: null for none, else a known id; an unknown one is refused.
function chosenTemplate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HostError(`A template is named by its id, such as ${templates.list()[0]?.id || 'travel'}.`);
  const t = templateFor(null, value);
  if (!t || t.hidden) throw new HostError(`There is no template called ${value.slice(0, 40)}.`);
  return value;
}
// One registry entry's template as the console shows it, from the environment's own record: its store when it is
// open, else its app.json read as it is (never building the environment for it).
function environmentTemplate(entry) {
  const env = environments.get(entry.slug);
  if (env) return templateView(env.store, env);
  const file = path.join(DATA_DIR, 'environments', entry.slug, 'app.json');
  if (!entry.template && !fs.existsSync(file)) return null;
  const names = new Map(bundledModules(BUNDLED_DIR).map((m) => [m.id, m.name]));
  let record = null;
  let read = false;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')).template || null; read = true; } catch { record = null; }
  if (read && (!record || typeof record !== 'object' || typeof record.id !== 'string')) return null; // its own data says none
  const id = record?.id || entry.template;
  if (!id) return null;
  const template = templateFor(null, id);
  const view = { id, name: template?.name || id, source: template ? template.source : null, version: template ? template.version : null, appliedAt: null, appliedVersion: null, offerOpen: false, skipped: [] };
  if (!record || typeof record !== 'object') return view;
  const appliedAt = typeof record.appliedAt === 'string' ? record.appliedAt : null;
  const switchedAt = typeof record.switchedAt === 'string' ? record.switchedAt : null;
  return { ...view, appliedAt, appliedVersion: Number.isInteger(record.appliedVersion) ? record.appliedVersion : (appliedAt ? 1 : null), offerOpen: offerIsOpen({ ...record, appliedAt, switchedAt }, template), skipped: (Array.isArray(record.skipped) ? record.skipped : []).filter((x) => x && typeof x.id === 'string').map((x) => ({ id: x.id, name: names.get(x.id) || x.id, why: String(x.why ?? '') })) };
}
hostRouter.post('/api/host/environments', requireHostAdmin, (req, res) => {
  try {
    const template = chosenTemplate(req.body?.template);
    const environment = hostRegistry.addEnvironment({ slug: req.body?.slug, name: req.body?.name, plan: req.body?.plan, template });
    const env = environmentFor(environment.slug); // the fresh directory and its services, built now (a template applied)
    const owner = req.body?.owner;
    if (owner?.login && owner?.password) env.store.addUser({ login: owner.login, displayName: owner.displayName || owner.login, role: 'owner', passwordHash: auth.hashPassword(owner.password) });
    res.status(201).json({ environment: { ...environment, template: environmentTemplate(environment) } });
  } catch (err) {
    sendHostError(err, res);
  }
});
// `template`: switch the environment to a template ("none" for none), building it if it isn't built yet; the answer
// then carries the template and its offer. Every other field is the registry entry's, as before.
hostRouter.patch('/api/host/environments/:slug', requireHostAdmin, async (req, res) => {
  try {
    const { template, ...rest } = req.body || {};
    if (!hostRegistry.findEnvironment(req.params.slug)) throw new HostError('no such environment', 404);
    if (template !== undefined) {
      const problem = templateSwitchProblem(environmentFor(req.params.slug), template);
      if (problem) throw new HostError(problem);
    }
    let environment = Object.keys(rest).length || template === undefined ? hostRegistry.updateEnvironment(req.params.slug, rest) : hostRegistry.findEnvironment(req.params.slug);
    if (template === undefined) return res.json({ environment });
    const env = environmentFor(req.params.slug);
    await switchTemplate(env, req.params.slug, template, 'host');
    environment = hostRegistry.findEnvironment(req.params.slug);
    res.json({ environment: { ...environment, ...templateAnswer(env, req.params.slug) } });
  } catch (err) {
    if (err instanceof StoreError) return res.status(err.status).json({ error: err.message });
    sendHostError(err, res);
  }
});
// The environment's template as the owner's Template tab reads it, read-only: { template, offer, choices } (the
// console's Review asks this rather than repeating a switch). Builds the environment if it isn't built yet.
hostRouter.get('/api/host/environments/:slug/template', requireHostAdmin, (req, res) => {
  try {
    if (!hostRegistry.findEnvironment(req.params.slug)) throw new HostError('no such environment', 404);
    const env = environmentFor(req.params.slug);
    res.json({ ...templateAnswer(env, req.params.slug), choices: templateChoices(env, env.store.templateRecord?.id) });
  } catch (err) {
    sendHostError(err, res);
  }
});
// Confirms the open offer of the environment's template (the same body as the owner's), and answers the environment
// with its template and offer.
hostRouter.post('/api/host/environments/:slug/template/apply', requireHostAdmin, async (req, res) => {
  try {
    if (!hostRegistry.findEnvironment(req.params.slug)) throw new HostError('no such environment', 404);
    const env = environmentFor(req.params.slug);
    const answer = await applyTemplateOffer(env, req.params.slug, req.body);
    res.json({ environment: { ...hostRegistry.findEnvironment(req.params.slug), ...answer } });
  } catch (err) {
    if (err instanceof StoreError) return res.status(err.status).json({ error: err.message });
    sendHostError(err, res);
  }
});
hostRouter.delete('/api/host/environments/:slug', requireHostAdmin, (req, res) => {
  try {
    if (!hostRegistry.findEnvironment(req.params.slug)) throw new HostError('no such environment', 404);
    hostRegistry.removeEnvironment(req.params.slug);
    const env = environments.get(req.params.slug);
    if (env) { setAsideEnvironment(env); environments.delete(req.params.slug); }
    const from = path.join(DATA_DIR, 'environments', req.params.slug);
    if (fs.existsSync(from)) {
      const to = path.join(DATA_DIR, 'environments-deleted', `${req.params.slug}-${Date.now()}`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
    }
    res.json({ ok: true });
  } catch (err) {
    sendHostError(err, res);
  }
});

// An environment's whole directory, walked into [name, bytes] pairs for zipFiles (server/module-build.js), or read back
// out of a zip on restore (a general-purpose reader, not modules.js's own readZip -- an environment's own data is
// whatever shape it is, not the narrow set of file types a module's zip is allowed). A symbolic link is never followed
// (the server writes none here): it and what it points to stay out of the zip, and the log says which link was skipped.
function walkFiles(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) console.warn(`Left a link out of the zip, not followed: ${full}`);
    else if (st.isDirectory()) walkFiles(full, base, out);
    else if (st.isFile()) out.push([path.relative(base, full).split(path.sep).join('/'), fs.readFileSync(full)]);
  }
  return out;
}
// Total bytes in a directory tree, without reading any file's contents -- walkFiles reads every file (for
// zipping) and would be wasteful just to measure an environment's own storage use (plan-environments.md, "Phase 3").
function dirSize(dir) {
  let total = 0;
  let names;
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; } // a broken link, or gone between readdir and stat
    if (st.isDirectory()) total += dirSize(full);
    else if (st.isFile()) total += st.size;
  }
  return total;
}
const STORAGE_MEASURE_MS = 60000;
// An environment's storage use, remeasured at most once a minute and cached on the registry entry
// (HostRegistry.recordStorageUsage) so a page reading it often (the Environment panel, the console's environment
// list) never pays for a fresh directory walk itself.
function environmentStorageBytes(slug, dataDir) {
  const cached = hostRegistry.findEnvironment(slug)?.usage;
  if (cached?.measuredAt && Date.now() - new Date(cached.measuredAt).getTime() < STORAGE_MEASURE_MS) return cached.storageBytes;
  const bytes = dirSize(dataDir) + dirSize(vaultFolderOf(slug)); // a library's files count too, though they are kept outside
  hostRegistry.recordStorageUsage(slug, bytes);
  return bytes;
}
// The spaces (and asides) of this environment with a call running right now: at least one person is at its call (being
// there is being on the call: a person's token is minted only to join it; a hidden OBS viewer does not count). Asked
// from LiveKit directly, never cached, so a call ending frees its slot at once. `without` leaves people out (whoever
// is about to join somewhere, so moving from one call to another never counts their own). A call under its name from
// before the upgrade is the same space's. spaceIdOfCall scopes this to the current environment's own calls. null when
// LiveKit can't be asked. `listed`, when given, is LiveKit's list of calls already asked for (the host console counts
// every environment's from one list). null with no call service too: there is nothing to ask.
async function runningCalls({ without = [], listed = null } = {}) {
  if (!callService) return null;
  try {
    const active = listed || (await callService.listRooms());
    const running = new Set();
    for (const lk of active) {
      const spaceId = spaceIdOfCall(lk.name);
      if (!spaceId || running.has(spaceId) || !(lk.numParticipants > 0)) continue;
      const list = await callService.listParticipants(lk.name);
      if (list.some((p) => !p.permission?.hidden && !without.includes(p.identity))) running.add(spaceId);
    }
    return running;
  } catch {
    return null;
  }
}
// How many calls are running: /api/environment's usage.callsNow (plan-environments.md, "Phase 4"). 0 when LiveKit
// can't be asked.
async function liveCallCount() {
  return (await runningCalls())?.size ?? 0;
}

// --- plan caps (plan-environments.md, "Phase 3: the caps, enforced at the seam") --------------------------------
// A cap is null for none. Self-hosted (no BASE_DOMAIN, or a slug the registry somehow has no environment for) is
// nobody's environment, so it is never capped -- every planCap() reads null there, same as an uncapped plan.
function planCap(name) {
  if (!BASE_DOMAIN || !hostRegistry) return null;
  const environment = hostRegistry.findEnvironment(currentEnvironment().slug);
  return environment ? environment.plan[name] : null;
}
function gbText(bytes) {
  const gb = bytes / (1024 ** 3);
  return (Number.isInteger(gb) ? gb : Math.round(gb * 10) / 10).toString();
}
// A size for a sentence: "5 GB", "1.5 GB", in MB under a gigabyte ("512 MB") and in KB under a megabyte, never "0 GB".
const sizeText = (bytes) => {
  if (bytes >= 1024 ** 3) return `${gbText(bytes)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round((bytes / 1048576) * 10) / 10} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};
// Each refuses the one thing at its cap with a 403 and a plain sentence, leaving everything else running;
// returns true (having already answered) when refused, so a caller just does `if (refuseX(res)) return;`.
function refuseOverMembers(res) {
  const cap = planCap('members');
  if (cap === null || store.users.length < cap) return false;
  res.status(403).json({ error: `This ${word('environment')} is at its limit of ${cap} ${word('member', { many: true })}.` });
  return true;
}
function refuseOverStorage(res) {
  const cap = planCap('storageBytes');
  if (cap === null) return false;
  const env = currentEnvironment();
  if (environmentStorageBytes(env.slug, env.dataDir) < cap) return false;
  res.status(403).json({ error: `This ${word('environment')} has used its ${sizeText(cap)} of storage.` });
  return true;
}
// Middleware form of refuseOverStorage, for the routes that write bytes to disk (module uploads, profile and
// space pictures, site images) rather than checking it inline.
function checkStorageCap(req, res, next) {
  if (!refuseOverStorage(res)) next();
}
// The sentence when this environment's plan allows no more AI calls this month, else ''.
// `pending`: asks on their way, not yet counted (so two at once can't pass the cap together).
function aiCallsRefusal(pending = 0) {
  const cap = planCap('aiCallsPerMonth');
  if (cap === null || hostRegistry.aiCallsThisMonth(currentEnvironment().slug) + pending < cap) return '';
  return `This ${word('environment')} has used its ${cap} AI calls for this month.`;
}
// 'all' (the default, and every self-hosted install) or a list of module ids. A module already on when a
// plan shrinks under it is untouched here -- this only gates turning one on, never keeps one already running.
function moduleAllowedByPlan(id) {
  const cap = planCap('modules');
  return cap === null || cap === 'all' || (Array.isArray(cap) && cap.includes(id));
}
// The same for an environment by its slug, outside a request (a template applied when the environment is made).
function moduleAllowedFor(slug, id) {
  if (!BASE_DOMAIN || !hostRegistry || !slug) return true;
  const cap = hostRegistry.findEnvironment(slug)?.plan.modules ?? null;
  return cap === null || cap === 'all' || (Array.isArray(cap) && cap.includes(id));
}
function refuseModuleNotInPlan(res, id, name) {
  if (moduleAllowedByPlan(id)) return false;
  res.status(403).json({ error: `This ${word('environment')}'s plan does not include ${store.moduleDisplay(id).name || name}.` });
  return true;
}
// The calls cap (plan-environments.md, "Phase 4"), counted from real calls: entering a space is never refused, and
// joining a call that is already running is never refused; only starting a *new* running call once the plan's
// concurrent-call limit is spent on other spaces is (POST /api/call/join, and the pull that makes an aside).
// Two people starting calls in two spaces at the same moment would both see a free slot before either shows as on the
// call, so a start that passes holds its space's slot for CALL_START_HOLD_MS (in memory, per environment) until the
// person shows as on the call. A server restart drops the holds, which only reopens that same short window.
const CALL_START_HOLD_MS = 15000;
const callStartHolds = new Map(); // environment slug -> Map(spaceId -> { identity, until })
function heldCalls(without = []) {
  const holds = callStartHolds.get(currentEnvironment().slug || '');
  const held = new Set();
  if (!holds) return held;
  const now = Date.now();
  for (const [spaceId, hold] of holds) {
    if (hold.until <= now) holds.delete(spaceId);
    else if (!without.includes(hold.identity)) held.add(spaceId);
  }
  return held;
}
function holdCallStart(spaceId, identity) {
  const slug = currentEnvironment().slug || '';
  if (!callStartHolds.has(slug)) callStartHolds.set(slug, new Map());
  callStartHolds.get(slug).set(spaceId, { identity, until: Date.now() + CALL_START_HOLD_MS });
}
// Names the space a running call is in only to someone who belongs to it (presence by membership,
// plan-primary-nav.md decision 6): a running call they can see is named first; otherwise "an aside" or "another
// <space>". `identity` is the person's key, or `guest-link:<token>` for a guest (POST /api/call/join).
function overCallsSentence(cap, running, identity) {
  const guestSpace = identity.startsWith('guest-link:') ? store.spaceByGuestToken(identity.slice('guest-link:'.length)) : null;
  const user = guestSpace ? null : store.userByKey(identity);
  const viewer = guestSpace ? { guestSpace: guestSpace.id } : { key: identity, owner: hasOwnerRights(user) };
  const shown = running.map((id) => store.spaceById(id)).find((r) => r && belongsToSpace(viewer, r));
  const runningName = shown?.name || (store.asideById(running[0]) ? word('aside', { a: true }) : `another ${word('space')}`);
  return `This ${word('environment')}'s plan allows ${cap} call${cap === 1 ? '' : 's'} at once; one is running in ${runningName}`;
}
// Whether `identity` may start or join the call in `spaceId`: null when they may (and then a new start holds its
// slot, unless `hold` is false), else the refusal's sentence. `leaving` are people moving out of their calls with this start (an aside's
// members): they are not counted where they are now. LiveKit not answering fails open, as callsNow reads 0.
async function callsCapRefusal(spaceId, identity, { leaving = [], hold = true } = {}) {
  const cap = planCap('calls');
  if (cap === null) return null;
  const without = [identity, ...leaving];
  const running = await runningCalls({ without });
  if (!running) return null;
  for (const held of heldCalls(without)) running.add(held);
  if (running.has(spaceId)) return null; // already running (or just started): joining it
  if (running.size < cap) {
    if (hold) holdCallStart(spaceId, identity);
    return null;
  }
  return overCallsSentence(cap, [...running], identity);
}
function readEnvironmentZip(buffer) {
  return new Promise((resolve, reject) => {
    const MAX_FILES = 20000;
    const MAX_TOTAL = 500 * 1024 * 1024;
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(new Error("that isn't a readable zip file"));
      const files = [];
      let total = 0;
      const fail = (message) => { zip.close(); reject(new Error(message)); };
      zip.on('error', () => fail("that isn't a readable zip file"));
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (name.endsWith('/')) return zip.readEntry(); // a folder
        if (files.length >= MAX_FILES) return fail(`too many files (more than ${MAX_FILES})`);
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode === 0o120000) return fail('symbolic links are not allowed');
        total += entry.uncompressedSize;
        if (total > MAX_TOTAL) return fail(`the backup is larger than ${MAX_TOTAL / (1024 * 1024)} MB`);
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return fail("that isn't a readable zip file");
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('error', () => fail("that isn't a readable zip file"));
          stream.on('end', () => { files.push([name, Buffer.concat(chunks)]); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}
hostRouter.post('/api/host/environments/:slug/backup', requireHostAdmin, (req, res) => {
  if (!hostRegistry.findEnvironment(req.params.slug)) return res.status(404).json({ error: 'no such environment' });
  const env = environments.get(req.params.slug);
  if (env) flushEnvironment(env); // every debounced write is on disk before it is zipped
  const dir = path.join(DATA_DIR, 'environments', req.params.slug);
  const zip = zipFiles(fs.existsSync(dir) ? walkFiles(dir) : []);
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${req.params.slug}-backup.zip"` });
  res.send(zip);
});
const rawHostZip = express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: 500 * 1024 * 1024 });
hostRouter.post('/api/host/environments/:slug/restore', requireHostAdmin, rawHostZip, async (req, res) => {
  if (!hostRegistry.findEnvironment(req.params.slug)) return res.status(404).json({ error: 'no such environment' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'choose a zip file to restore' });
  try {
    let files = await readEnvironmentZip(req.body);
    // A backup whose data (app.json, or the older LEGACY_ENVIRONMENT_RECORD when there is no app.json) cannot be read, or
    // whose app.json (or that older record) records a Names migration part this server does not know (made by a newer version of the product), is
    // refused before anything is replaced. Checked on what would actually land: names as written to disk, the last
    // of any repeated entry.
    const refusal = backupRefusal(files);
    if (refusal) return res.status(400).json({ error: refusal });
    // The session and stream keys are never taken from a zip: the restored environment makes new ones (everyone signs
    // in again, and the stream's sources need its new key).
    files = restoreEntries(files);
    const env = environments.get(req.params.slug);
    if (env) { setAsideEnvironment(env); environments.delete(req.params.slug); } // rebuilt fresh from the restored files, next asked for
    const dir = path.join(DATA_DIR, 'environments', req.params.slug);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, data] of files) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data, { mode: 0o600 }); // a restored file is private to the server's user, like the ones it writes itself
    }
    // Built now, so the console (and the sign-in list) knows at once whether the restored data opens.
    refusals.delete(req.params.slug);
    try {
      environmentFor(req.params.slug);
    } catch (err) {
      if (!(err instanceof MigrationError)) throw err;
      logRefusalOnce(req.params.slug);
      return res.json({ ok: true, refused: refusalView(req.params.slug) });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "that isn't a readable zip file" });
  }
});

hostRouter.get('/api/host/settings', requireHostAdmin, (_req, res) => {
  res.json({
    baseDomain: BASE_DOMAIN, productDomain: PRODUCT_HOST, version: VERSION, hostAdmins: hostRegistry.listAdmins(), productName: PRODUCT_NAME, productShortName: PRODUCT_SHORT_NAME, contactEmail: CONTACT_EMAIL || null,
    plans: hostRegistry.plansCatalog(), signup: signupEnabled, billingSecretSet: Boolean(BILLING_SECRET),
    // The modules this image ships, for the template editor: the built-in two, then the bundled ones by id.
    modules: [...BUILTIN_MODULES, ...bundledModules(BUNDLED_DIR)].map((m) => ({ id: m.id, name: m.name || m.id, icon: m.icon || null })),
  });
});
// The flight schedule, shared by every environment (documentation/plans/plan-flight-lookup.md): its counts, forgetting one
// number (?number=WN2483), or clearing it all. The handlers are with the flight lookup's own routes, below.
hostRouter.get('/api/host/flight-schedule', requireHostAdmin, flightScheduleCounts);
hostRouter.delete('/api/host/flight-schedule', requireHostAdmin, flightScheduleClear);
// The plan catalog (plan-environments.md, "Phase 5"): the console's Plans panel edits a plan's name and its five caps;
// PUT replaces the whole catalog (the same shape GET's own `plans` field is), free always kept present regardless
// of what is sent.
hostRouter.put('/api/host/plans', requireHostAdmin, (req, res) => {
  try {
    res.json({ plans: hostRegistry.setPlansCatalog(req.body || {}) });
  } catch (err) {
    sendHostError(err, res);
  }
});
// Provider-agnostic billing webhook: a provider's own format is adapted into this shape outside the app (a
// small relay), which is what keeps every provider's own card handling out of it (plan-environments.md, "Phase 5").
// No host-admin session -- the sender is never signed in here -- so this route sits outside requireHostAdmin
// entirely and authenticates by signature alone, over the exact bytes received (req.rawBody, see express.json's
// verify above), never a re-serialization of the parsed body.
hostRouter.post('/api/host/billing', (req, res) => {
  if (!BILLING_SECRET) return res.status(404).json({ error: 'not found' });
  const expected = crypto.createHmac('sha256', BILLING_SECRET).update(req.rawBody || Buffer.alloc(0)).digest('hex');
  const given = Buffer.from(String(req.get('x-billing-signature') || ''), 'hex');
  const wanted = Buffer.from(expected, 'hex');
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return res.status(401).json({ error: 'bad signature' });
  try {
    const environment = hostRegistry.applyBillingEvent(String(req.body?.slug || ''), String(req.body?.plan || ''), String(req.body?.event || ''));
    res.json({ environment });
  } catch (err) {
    sendHostError(err, res);
  }
});

// The host's own managed AI service (documentation/plans/plan-environments.md, "Managed AI, per company"), above
// every environment, one row per company: an environment chooses one of them (source "managed", a
// managedProvider) or "custom" (its own, see PUT /api/ai). A key never leaves the server, same as an
// environment's own never does.
hostRouter.get('/api/host/ai', requireHostAdmin, (_req, res) => {
  res.json({ services: hostAiServices() });
});
hostRouter.put('/api/host/ai', requireHostAdmin, (req, res) => {
  try {
    const provider = String(req.body?.provider || '');
    if (!MANAGED_PROVIDERS.includes(provider)) throw new AiError('choose openai, anthropic or compatible');
    hostRegistry.setManagedAi(provider, req.body || {});
    res.json({ services: hostAiServices() });
  } catch (err) {
    sendAiError(err, res);
  }
});
hostRouter.post('/api/host/ai/models', requireHostAdmin, async (req, res) => {
  try {
    const provider = String(req.body?.provider || '');
    const slot = managedSlot(provider);
    // A saved key (or the one from the environment) goes only to the address it belongs to: another address needs a key typed with it.
    const sameAddress = provider !== 'compatible' || req.body?.address === undefined || String(req.body.address).trim().replace(/\/$/, '') === slot.address;
    const key = (typeof req.body?.key === 'string' && req.body.key.trim()) || (sameAddress ? slot.envKey || slot.key : '');
    const workspace = typeof req.body?.workspace === 'string' ? req.body.workspace : slot.workspace;
    res.json({ models: await listModelsFor({ provider, address: req.body?.address ?? slot.address, key, workspace }) });
  } catch (err) {
    sendAiError(err, res);
  }
});

// The host's own shared file folders (documentation/plans/plan-environments.md, "Shared files: the host's map"):
// every bundled module that declares one (Maps' map-tiles), whether or not it happens to be installed anywhere
// yet -- an admin manages the folder from here regardless. { module, name, folder, key } each.
function bundledSharedFolders() {
  const out = [];
  for (const m of bundledModules(BUNDLED_DIR)) {
    for (const d of m.settings || []) if ((d.type === 'file' || d.type === 'files') && d.shared === 'host') out.push({ module: m.id, name: m.name, folder: d.folder, key: d.key });
  }
  return out;
}
// One of those, from the request's own :module/:folder, or null (sending the 404 itself) when it names
// nothing real.
function sharedFolderSetup(req, res) {
  const found = bundledSharedFolders().find((f) => f.module === req.params.module && f.folder === req.params.folder);
  if (!found) { res.status(404).json({ error: 'no such shared folder' }); return null; }
  return found;
}
hostRouter.get('/api/host/shared', requireHostAdmin, (_req, res) => {
  const folders = bundledSharedFolders().map(({ module, name, folder }) => {
    const dir = path.resolve(DATA_DIR, 'shared', module, folder);
    const inspected = inspectDir(dir);
    return {
      module,
      name,
      folder,
      files: inspected.files.map((f) => ({ name: f, size: inspected.sizes[f], ...(inspected.zooms[f] ? { zoom: inspected.zooms[f] } : {}), ...(inspected.kinds[f] ? { kind: inspected.kinds[f] } : {}) })),
      address: hostRegistry.sharedFolderAddress(module, folder),
      exists: inspected.exists,
      cutting: Boolean(sharedRegionCutJobs.runningFor(module, 'environment')),
    };
  });
  res.json({ folders });
});
hostRouter.put('/api/host/shared/:module/:folder', requireHostAdmin, (req, res) => {
  const found = sharedFolderSetup(req, res);
  if (!found) return;
  try {
    res.json({ address: hostRegistry.setSharedFolderAddress(found.module, found.folder, req.body?.address).address });
  } catch (err) {
    sendHostError(err, res);
  }
});
hostRouter.delete('/api/host/shared/:module/:folder/files/:name', requireHostAdmin, (req, res) => {
  const found = sharedFolderSetup(req, res);
  if (!found) return;
  const name = req.params.name;
  if (!FILE_NAME_RE.test(name)) return res.status(404).json({ error: 'no such file' });
  const file = path.join(path.resolve(DATA_DIR, 'shared', found.module, found.folder), name);
  if (!inspectDir(path.dirname(file)).files.includes(name)) return res.status(404).json({ error: 'no such file' });
  try {
    fs.unlinkSync(file);
  } catch (err) {
    return res.status(500).json({ error: `the file could not be removed: ${err.message}` });
  }
  res.json({ ok: true });
});

// The place search a host-level "Add a region" find needs, since the host holds no geocoder of its own: the
// first enabled module across every environment that has one configured (Places, typically), each checked
// inside its own envContext.run so moduleSettings and modules resolve to that one environment, the same as a
// request to it would -- admin.<base> never otherwise resolves one.
async function findRegionBoxAcrossEnvironments(q) {
  // Every real environment, never DEFAULT_SLUG -- this route only ever runs with BASE_DOMAIN set, where the default
  // (root DATA_DIR) environment is not a real one anybody uses, so building it just to find it has no geocoder
  // configured would be pure waste.
  const slugs = hostRegistry.listEnvironments().map((t) => t.slug);
  for (const slug of slugs) {
    let env;
    try {
      env = environmentFor(slug);
    } catch (err) {
      if (!(err instanceof MigrationError)) throw err;
      continue; // refused by the Names migration (logged when it was refused): searched past, like one with no geocoder
    }
    const setup = envContext.run(env, () => {
      for (const { manifest } of env.modules.enabledAll()) {
        if (manifest.geocoder) { const s = geocodeSetup(manifest); if (s) return s; }
      }
      return null;
    });
    if (setup) {
      const found = await askService(setup.address, q, null);
      const best = found.find((p) => p.extent);
      return best ? { name: best.name, box: best.extent } : { name: null, box: null };
    }
  }
  return null;
}
hostRouter.get('/api/host/shared/:module/:folder/region-cut/find', requireHostAdmin, async (req, res) => {
  if (!sharedFolderSetup(req, res)) return;
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q.length < 2) return res.status(400).json({ error: 'type a place name first' });
  try {
    const found = await findRegionBoxAcrossEnvironments(q);
    if (found === null) return res.status(404).json({ error: 'no place search is set up on any environment (a module with one, such as Places, names where to look)' });
    res.json(found.box ? { found: true, name: found.name, box: found.box } : { found: false });
  } catch (err) {
    res.status(502).json({ error: 'search is not available right now' });
  }
});
hostRouter.post('/api/host/shared/:module/:folder/region-cut/estimate', requireHostAdmin, async (req, res) => {
  const found = sharedFolderSetup(req, res);
  if (!found) return;
  try {
    res.json(await sharedRegionCutJobs.estimate({ source: hostRegistry.sharedFolderAddress(found.module, found.folder), box: boxFromBody(req.body), maxZoom: Number(req.body?.maxZoom), minZoom: req.body?.minZoom !== undefined ? Number(req.body.minZoom) : undefined }));
  } catch (err) {
    sendRegionCutError(err, res);
  }
});
hostRouter.post('/api/host/shared/:module/:folder/region-cut', requireHostAdmin, async (req, res) => {
  const found = sharedFolderSetup(req, res);
  if (!found) return;
  try {
    const out = await sharedRegionCutJobs.start({
      moduleId: found.module,
      scopeKey: 'environment',
      source: hostRegistry.sharedFolderAddress(found.module, found.folder),
      folder: found.folder,
      name: String(req.body?.name || ''),
      box: boxFromBody(req.body),
      minZoom: req.body?.minZoom !== undefined ? Number(req.body.minZoom) : undefined,
      maxZoom: Number(req.body?.maxZoom),
      by: currentHostAdmin(req)?.key,
      replace: Boolean(req.body?.replace),
    });
    res.status(202).json(out);
  } catch (err) {
    sendRegionCutError(err, res);
  }
});
hostRouter.get('/api/host/shared/:module/:folder/region-cut/:jobId/stream', requireHostAdmin, (req, res) => {
  const job = sharedRegionCutJobs.view(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'that cut is not running (it may have finished a while ago)' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  if (job.status !== 'running') {
    sseWrite(res, `event: ${job.status}\ndata: ${JSON.stringify(job.status === 'done' ? { name: job.name } : { error: job.error })}\n\n`);
    return res.end();
  }
  const { jobId } = req.params;
  const cleanup = () => { sharedRegionCutJobs.off('progress', onProgress); sharedRegionCutJobs.off('done', onDone); sharedRegionCutJobs.off('error', onErr); };
  const onProgress = (id, p) => { if (id === jobId) sseWrite(res, `event: progress\ndata: ${JSON.stringify(p)}\n\n`); };
  const onDone = (id, d) => { if (id !== jobId) return; sseWrite(res, `event: done\ndata: ${JSON.stringify(d)}\n\n`); cleanup(); res.end(); };
  const onErr = (id, error) => { if (id !== jobId) return; sseWrite(res, `event: error\ndata: ${JSON.stringify({ error })}\n\n`); cleanup(); res.end(); };
  sharedRegionCutJobs.on('progress', onProgress);
  sharedRegionCutJobs.on('done', onDone);
  sharedRegionCutJobs.on('error', onErr);
  req.on('close', cleanup); // host-level: no environment to hand back to a later callback, unlike the SSE routes under the seam
});
hostRouter.post('/api/host/admins', requireHostAdmin, (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (password.length < 8) throw new HostError('a password needs at least 8 characters');
    res.status(201).json({ admin: hostRegistry.addAdmin({ login: req.body?.login, passwordHash: auth.hashPassword(password) }) });
  } catch (err) {
    sendHostError(err, res);
  }
});
hostRouter.delete('/api/host/admins/:key', requireHostAdmin, (req, res) => {
  try {
    hostRegistry.removeAdmin(req.params.key);
    res.json({ ok: true });
  } catch (err) {
    sendHostError(err, res);
  }
});
// The product's use pages at the product host: each address, its file in public/ and the template it advertises.
// A page is live only while that template is among the host's offered ones (templateChoices(null)) and its file exists;
// otherwise the address answers 404 like any unknown path (plan-product-pages.md, decisions 7, 8 and 10).
const PRODUCT_PAGES = [
  { path: '/travel', file: 'travel.html', template: 'travel' },
  { path: '/games', file: 'games.html', template: 'games' },
  { path: '/projects', file: 'projects.html', template: 'projects' },
];
const livePages = () => {
  if (!BASE_DOMAIN) return [];
  const offered = new Set(templateChoices(null).map((t) => t.id));
  return PRODUCT_PAGES.filter((p) => offered.has(p.template) && fs.existsSync(page(p.file)));
};
// The product itself, for the landing page (the product host) and the console (admin.<base>): public, no
// session needed, and harmless anywhere else it happens to be reached. name and contact are configuration, never
// code, since the product's own name is still being chosen. Registered on hostRouter here (admin.<base> only
// ever reaches it through here anyway); the main app's own copy is registered after the resolver below, not
// here, so an old-base-domain request still 301s instead of this one route quietly bypassing that.
// `pages`: the use pages live on this host ([{ path, template }]), so the front page links only those.
function productInfo(_req, res) {
  const plans = hostRegistry ? Object.entries(hostRegistry.plansCatalog()).map(([id, p]) => ({ id, name: p.name, caps: p.caps, checkoutUrl: checkoutUrlFor(id) })) : [];
  // `templates`: what a new environment can be made from ([{ id, name, description }]), for the sign-up form.
  // `productDomain`: where the product pages live (PRODUCT_DOMAIN, else the bare base domain); null without a base domain.
  res.json({ name: PRODUCT_NAME, productShortName: PRODUCT_SHORT_NAME, contact: CONTACT_EMAIL || null, baseDomain: BASE_DOMAIN || null, productDomain: PRODUCT_HOST || null, version: VERSION, signup: signupEnabled, plans, templates: BASE_DOMAIN ? templateChoices(null).map(({ id, name, description }) => ({ id, name, description })) : [], pages: livePages().map(({ path: p, template }) => ({ path: p, template })) });
}
hostRouter.get('/api/product', productInfo);
// One environment's public name, for the product page's own Sign in (a slug is an address already, so confirming
// one exists reveals nothing): { slug, name } for an active or pastDue environment, 404 for anything else --
// unknown, suspended, or a slug that does not even look like one (checked before it ever reaches the registry).
function productEnvironment(req, res) {
  if (!hostRegistry) return res.status(404).json({ error: 'not found' });
  let slug;
  try {
    slug = cleanSlug(req.query.slug);
  } catch {
    return res.status(404).json({ error: 'not found' });
  }
  const environment = hostRegistry.findEnvironment(slug);
  if (!environment || (environment.status !== 'active' && environment.status !== 'pastDue')) return res.status(404).json({ error: 'not found' });
  res.json({ slug: environment.slug, name: environment.name });
}
hostRouter.get('/api/product/environment', productEnvironment);
// The same, as a list, for the product page's own Sign in dropdown: every active or pastDue environment, sorted
// by name, suspended ones left out entirely (not even a slug -- there is nothing for a visitor to do with one).
function productEnvironments(_req, res) {
  if (!hostRegistry) return res.json({ environments: [] });
  const environments = hostRegistry
    .listEnvironments()
    .filter((t) => (t.status === 'active' || t.status === 'pastDue') && !refusals.has(t.slug)) // a refused one cannot be signed in to
    .map((t) => ({ slug: t.slug, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ environments });
}
hostRouter.get('/api/product/environments', productEnvironments);
// Whether a name could be a new environment's, for the sign-up form's note as the name is typed (plan-domains.md):
// { slug, free, reason }, reason 'shape', 'reserved' or 'taken', null when free. Public; an address gets 120 a minute.
const addressLimiter = new auth.LoginLimiter(120, 60000);
function productAddress(req, res) {
  if (!hostRegistry) return res.status(404).json({ error: 'not found' });
  const ip = req.ip || 'unknown';
  if (addressLimiter.blocked(ip)) return res.status(429).json({ error: 'Too many checks from this address; try again in a minute.' });
  addressLimiter.fail(ip);
  res.json(hostRegistry.addressFor(req.query.slug));
}
hostRouter.get('/api/product/address', productAddress);
hostRouter.use((_req, res) => res.status(404).json({ error: 'not found' }));

// --- the door: resolve an environment for this request, or route to the host console -----------------------
// With no BASE_DOMAIN every request is the one environment (today's behaviour, unchanged). With BASE_DOMAIN set, the
// hostname picks one branch, in this order (documentation/plans/plan-domains.md, "The door"):
//   1. admin.<base> is the host console above;
//   2. the product host (PRODUCT_DOMAIN, else the bare <base>) serves the product's own pages: the front page, the use
//      pages and sign-up, never any one environment's;
//   3. a host at an old base domain (PREVIOUS_BASE_DOMAINS) is redirected (301) to the same path at the current one --
//      after the product host, so an old base that is now the product host never catches it;
//   4. the bare <base>, when the product pages live elsewhere, is redirected (302) there, path and query kept;
//   5. <slug>.<base> resolves that environment;
//   6. anything else is a plain 404.
// The resolver never reads a path, only the hostname.
// req.hostname is always port-stripped, for matching against hosts that never have one; a redirect still needs the
// request's own port carried through, or it silently lands on the scheme's default port instead -- invisible behind a
// real proxy (the port is implicit there), but wrong for local development at some other port than 80/443.
function requestPort(req) {
  const requestHost = req.get('host') || '';
  const port = requestHost.includes(':') && !requestHost.endsWith(']') ? requestHost.slice(requestHost.lastIndexOf(':')) : '';
  return /^:\d{1,5}$/.test(port) ? port : ''; // anything else is dropped, never put into a Location
}
function redirectToHost(req, res, status, newHost) {
  return res.redirect(status, `${auth.isSecure(req) ? 'https' : 'http'}://${newHost}${newHost.includes(':') ? '' : requestPort(req)}${req.originalUrl}`);
}
// The paths the product host lets through beside / and the use pages: what those pages load and ask.
// The design system pages (public/design-system/, no sign-in) and the app files they import, as static files only.
const DESIGN_SYSTEM_FILES = ['/module-frame.js', '/module-host.js', '/module-stream.js', '/host-menu.js', '/menu-flyout.js', '/tooltip.js', '/brand.js', '/confirm.js', '/nav-bar.js', '/module-chrome.js', '/environment-banner.js', '/page-tabs.js', '/words.js', '/theme-mode.js', '/primary-nav.js', '/destination.css', '/diag.css'];
const designSystemStatic = express.static(publicDir, { index: false }); // static files only, a miss is a plain 404 here
const PRODUCT_HOST_PATHS = ['/landing.css', '/landing.js', '/style.css', '/theme.css', '/img/site/icon', '/favicon.ico', '/api/product', '/api/product/environment', '/api/product/environments', '/api/product/address', '/api/product/signup'];
if (BASE_DOMAIN) {
  app.use((req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    // Font Awesome is asked for by every page including the console's own, but the icon set itself lives
    // outside hostRouter (mounted on `app`, below, since the product host needs it too) -- let through to
    // there rather than into hostRouter, whose own catch-all would otherwise 404 it before it ever arrived.
    if (host === CONSOLE_HOST) return (req.path.startsWith('/fa/') || req.path.startsWith('/fonts/')) ? next() : hostRouter(req, res, next);
    // The product's own landing page (public/landing.html), never any one environment's page -- no store is ever
    // resolved here (see the "no environment" fallback in /theme.css and siteIcon above). Only the handful of paths
    // those pages actually need are let through; anything else is a plain 404, same as an unknown subdomain.
    if (host === PRODUCT_HOST) {
      if (req.path === '/') return res.sendFile(page('landing.html'), { dotfiles: 'allow' });
      const useSite = livePages().find((p) => p.path === req.path);
      if (useSite) return res.sendFile(page(useSite.file), { dotfiles: 'allow' });
      // A folder of the design system pages (/design-system/, /design-system/legacy/inventory/) is its index.html; a folder without one is a 404.
      if (/^\/design-system\/(?:[a-z0-9-]+\/)*$/.test(req.path)) return res.sendFile(path.join(publicDir, req.path, 'index.html'), { dotfiles: 'allow' }, (err) => { if (err) res.status(404).type('text').send('not found'); });
      if (req.path.startsWith('/design-system/') || req.path.startsWith('/sdk/') || DESIGN_SYSTEM_FILES.includes(req.path)) return designSystemStatic(req, res, () => res.status(404).type('text').send('not found'));
      if (PRODUCT_HOST_PATHS.includes(req.path) || req.path.startsWith('/fa/') || req.path.startsWith('/fonts/') || req.path.startsWith('/assets/images/brand/')) return next();
      return res.status(404).type('text').send('not found');
    }
    const oldBase = hostRegistry.previousBaseDomains().find((d) => host === d || host.endsWith(`.${d}`));
    if (oldBase) return redirectToHost(req, res, 301, host === oldBase ? BASE_DOMAIN : `${host.slice(0, host.length - oldBase.length - 1)}.${BASE_DOMAIN}`);
    if (host === BASE_DOMAIN) return redirectToHost(req, res, 302, PRODUCT_HOST);
    if (host.endsWith(`.${BASE_DOMAIN}`)) {
      const slug = host.slice(0, host.length - BASE_DOMAIN.length - 1);
      if (!hostRegistry.findEnvironment(slug)) return res.status(404).type('text').send('not found');
      return envContext.run(environmentFor(slug), next);
    }
    return res.status(404).type('text').send('not found');
  });
} else {
  app.use((req, res, next) => envContext.run(environmentFor(DEFAULT_SLUG), next));
}
app.get('/api/product', productInfo);
app.get('/api/product/environment', productEnvironment);
app.get('/api/product/environments', productEnvironments);
app.get('/api/product/address', productAddress);
// Sign-up at the product host (plan-environments.md, "Phase 5"): always the free plan -- any other named plan
// needs billing first, so the sign-up form only ever offers it as the plan to move to afterwards, through the
// checkout link, never straight from this route. Rate-limited (five an hour per address) the same way a login
// is, just counting every attempt rather than only failed ones.
const signupLimiter = new auth.LoginLimiter(5, 3600000);
app.post('/api/product/signup', (req, res) => {
  if (!BASE_DOMAIN) return res.status(404).json({ error: 'not found' });
  if (!signupEnabled) return res.status(403).json({ error: CONTACT_EMAIL ? `sign-up is off; write to ${CONTACT_EMAIL} instead` : 'sign-up is off' });
  const ip = req.ip || 'unknown';
  if (signupLimiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a bit' });
  signupLimiter.fail(ip);
  try {
    const owner = req.body?.owner;
    if (!owner?.login || !owner?.password) throw new HostError('an owner login and password are required');
    const free = hostRegistry.plansCatalog().free;
    const template = chosenTemplate(req.body?.template);
    const environment = hostRegistry.addEnvironment({ slug: req.body?.slug, name: req.body?.name, plan: { name: 'free', ...free.caps }, template });
    const made = environmentFor(environment.slug).store.addUser({ login: owner.login, displayName: owner.displayName || owner.login, role: 'owner', passwordHash: auth.hashPassword(owner.password) });
    // The new environment's sign-in, its login filled in (plan-domains.md, decision 10): the product host is another
    // site from the environment, so no session comes along. The port is carried the same way the door's redirects
    // carry it (requestPort, above).
    const newHost = `${environment.slug}.${BASE_DOMAIN}`;
    res.status(201).json({ url: `${auth.isSecure(req) ? 'https' : 'http'}://${newHost}${requestPort(req)}/login?login=${encodeURIComponent(made.login)}` });
  } catch (err) {
    sendHostError(err, res);
  }
});

// Links saved under the old names (/rooms/<id>, /img/room/<id>, ?room= on a picture, ?moduleRoom= on a pop-out):
// a permanent redirect to the new name, ahead of the routes below (server/old-links.js).
mountOldLinks(app);

// Pages ----------------------------------------------------------------------

// The app shell must never load inside a frame (clickjacking). Only these two routes carry it: nothing of ours frames
// the shell (the overlay, composites and module frames hold /profile, /admin, /modules/..., /calendar, /map, /m/...).
const NOT_FRAMED = { 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY' };
// The pages our own frames hold (the page overlay: /profile, /admin and Manage's own pages; a composite: /calendar,
// /map; a module's page) and the sign-in pages: framed by this site only. Not the OBS and keyed pages (/<path>/<key>,
// ?s=), nor a module's own files (/m/..., which set their own frame-ancestors 'self'), nor anything else a person might
// embed. The same pages by their file names too (express.static serves /admin.html as it is), and the shell's file,
// /space.html, never framed, as / is.
const FRAMED_HERE = { 'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' };
const FRAMED_HERE_PATHS = new Set([
  '/profile', '/admin', '/login', '/login/verify', '/login/enrol', '/register',
  '/profile.html', '/admin.html', '/module-config.html', '/login.html', '/login-step.html', '/register.html', '/module.html', '/destination.html',
  ...destinations.DESTINATIONS.map((d) => d.path),
]);
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path === '/space.html') res.set(NOT_FRAMED);
  else if (FRAMED_HERE_PATHS.has(req.path) || /^\/profile\/[^/]+$/.test(req.path) || /^\/invite\/[^/]+$/.test(req.path)) res.set(FRAMED_HERE);
  next();
});
// A page a frame asked for that would otherwise redirect a framed request into a page that refuses frames (/, a guest
// link): a tiny page that says so instead, with its status.
function framedRefusal(req, res, status, text) {
  if (req.get('sec-fetch-dest') !== 'iframe') return false;
  res.status(status).set(FRAMED_HERE).type('html')
    .send(`<!doctype html><meta charset="utf-8"><title>${text}</title><p style="font:16px system-ui,sans-serif;margin:2em;text-align:center">${text}</p>`); // text: our own sentence, never input
  return true;
}

app.get('/', (req, res) => {
  if (!currentUser(req)) return res.redirect('/login');
  res.set(NOT_FRAMED).sendFile(page('space.html'));
});

// A guest link: the same page, in guest mode (space.js reads the token from
// the URL itself -- see guestToken there). No account, so no redirect to
// sign in; a dead or turned-off link is handled client-side instead.
app.get('/guest/:token', (_req, res) => {
  res.set(NOT_FRAMED).sendFile(page('space.html'));
});

app.get('/login', (req, res) => {
  if (currentUser(req)) return res.redirect(String(req.query.next || '/').startsWith('/') ? String(req.query.next || '/') : '/');
  res.sendFile(page('login.html'));
});

// The pending step's own page, one file for both (the path says which -- documentation/plans/plan-mfa.md):
// /login/verify for an account with a factor already, /login/enrol for one the policy requires but has none
// yet. Already fully signed in (a real session, not just a pending one) redirects away, same as /login.
app.get('/login/verify', (req, res) => {
  if (currentUser(req)) return res.redirect(String(req.query.next || '/').startsWith('/') ? String(req.query.next || '/') : '/');
  res.sendFile(page('login-step.html'));
});
app.get('/login/enrol', (req, res) => {
  if (currentUser(req)) return res.redirect(String(req.query.next || '/').startsWith('/') ? String(req.query.next || '/') : '/');
  res.sendFile(page('login-step.html'));
});

// The product page's own Sign in ends here: a plain top-level form post (never JSON, so nothing crosses
// origins), on success a session exactly like POST /api/login, then a redirect rather than a JSON body -- a
// path on this environment, never off it (so a scheme, a host or even a second leading slash, which a browser
// reads as scheme-relative, falls back to "/"). A wrong login and password looks the same as a wrong password,
// same as the JSON route.
const loginForm = express.urlencoded({ extended: false, limit: '8kb' });
function safeNextPath(next) {
  const value = String(next || '');
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}
app.post('/login', loginForm, (req, res) => {
  const ip = req.ip || 'unknown';
  const login = String(req.body?.login || '');
  const fail = () => res.redirect(303, `/login?error=1&login=${encodeURIComponent(login)}`);
  if (limiter.blocked(ip)) return fail();
  const user = resolveLoginUser(login, String(req.body?.password || ''));
  if (!user) {
    limiter.fail(ip);
    return fail();
  }
  limiter.clear(ip);
  const gate = mfaGate(req, user);
  if (gate) {
    auth.setPendingCookie(req, res, gate.pending);
    const next = encodeURIComponent(safeNextPath(req.body?.next));
    return res.redirect(303, `/login/${gate.enrol ? 'enrol' : 'verify'}?next=${next}`);
  }
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  setEnvHint(req, res);
  res.redirect(303, safeNextPath(req.body?.next));
});

// Self sign-up (only does anything once an admin turns it on in Settings)
// and accepting an invite (always works, whether or not sign-up is open --
// an admin handed it out on purpose) share the same page; register.js tells
// the two apart from the URL.
app.get('/register', (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  res.sendFile(page('register.html'));
});
app.get('/invite/:token', (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  res.sendFile(page('register.html'));
});

// Personal link: signs the user in and drops them in the call page.
app.get('/j/:token', (req, res) => {
  const user = store.userByLinkToken(req.params.token);
  if (!user) return res.status(404).sendFile(page('bad-link.html'));
  // A personal link is a first factor, not a bypass: someone with a second factor still gets the code step
  // (documentation/plans/plan-mfa.md, "A personal link is a first factor, not a bypass").
  const gate = mfaGate(req, user);
  if (gate) {
    auth.setPendingCookie(req, res, gate.pending);
    return res.redirect(`/login/${gate.enrol ? 'enrol' : 'verify'}`);
  }
  auth.setSessionCookie(req, res, auth.issueSession(store.sessionSecret, user));
  setEnvHint(req, res);
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  auth.clearSessionCookie(req, res);
  res.redirect('/login');
});

app.get('/profile', (req, res) => {
  if (!currentUser(req)) return res.redirect('/login?next=/profile');
  res.sendFile(page('profile.html'));
});
app.get('/me', (_req, res) => res.redirect('/profile')); // the profile page's old address

// An admin editing someone else's profile: the same page, in edit mode --
// see public/profile.js, which tells the two apart by the URL.
app.get('/profile/:key', (req, res) => {
  if (!currentUser(req)) return res.redirect(`/login?next=/profile/${encodeURIComponent(req.params.key)}`);
  if (!isOwner(req)) return res.status(403).send(`${word('owner', { many: true, cap: true })} only.`);
  res.sendFile(page('profile.html'));
});

app.get('/admin', (req, res) => {
  if (!currentUser(req)) return res.redirect('/login?next=/admin');
  if (!isOwner(req)) return res.status(403).send(`${word('owner', { many: true, cap: true })} only.`);
  res.sendFile(page('admin.html'));
});

// Images ---------------------------------------------------------------------

// The server icon: the one set on the Settings tab, else the Coffee Pub
// brandmark. Also mounted at the conventional /favicon.ico path -- pages set
// their own <link rel="icon"> (see brand.js), but plenty of browsers and
// tools still fetch that path directly (bookmarks, tab previews, before any
// page JS has run) and got a bare 404 without this.
function siteIcon(_req, res) {
  // No environment at the bare base domain (the landing page): the bundled default, same as any environment
  // that has not set its own.
  const env = envContext.getStore();
  const file = env && env.store.iconPath();
  if (file) return sendImage(res, file);
  res.set('Cache-Control', 'no-cache').sendFile(path.join(publicDir, 'assets', 'images', 'brand', 'brandmark-color.png'));
}
app.get('/img/site/icon', siteIcon);
app.get('/favicon.ico', siteIcon);
// The sign-in background: nothing until one is set.
app.get('/img/site/background', (_req, res) => {
  const file = store.siteImagePath('background');
  if (file) return sendImage(res, file);
  res.status(404).end();
});

// A space's picture: nothing until one is set.
app.get('/img/space/:id', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req)) return res.status(403).end();
  const file = store.spaceImagePath(req.params.id);
  if (file) return sendImage(res, file);
  res.status(404).end();
});

// The shared guest picture set (see the guest-link routes): one Participant
// box, standing in for every guest's own images since they have none. The
// call's tile asks for 'profile' the same way it does for a real member, so
// that falls back to the Online picture (or the generic glyph) same as it.
app.get('/img/guest/:slot', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req) && !hasGuestAccess(req)) return res.status(403).end();
  const wanted = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  const slot = PARTICIPANT_SLOTS.includes(wanted) ? wanted : 'player';
  const file = store.guestImagePath(slot);
  if (file) return sendImage(res, file);
  if (slot !== 'player' || req.query.fallback === 'none') return res.status(404).end();
  res.set('Cache-Control', 'no-cache').type('image/svg+xml').send(guestSvg());
});

// The server-wide Default Images set -- what effectiveImage() falls back
// to for any member who (and whose space, if any) hasn't set their own.
// For previewing the set itself on the Settings page; 404s when unset,
// same as any other optional slot.
app.get('/img/default/:slot', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req) && !hasGuestAccess(req)) return res.status(403).end();
  const wanted = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  const slot = PARTICIPANT_SLOTS.includes(wanted) ? wanted : null;
  const file = slot && store.defaultImagePath(slot);
  if (file) return sendImage(res, file);
  res.status(404).end();
});

// A user's image for a slot. The profile photo always renders (an initials
// plate when none is set); every other slot is optional and 404s when unset,
// so overlays and the Participant/Character boxes stay transparent. Signed-in
// users, stream key holders and guests with a valid guest link. ?space=<id>
// resolves that space's own picture for this slot if it has one, falling
// back to the default the same as OBS would -- 'profile' never has a space
// override, so the param is ignored for it. (?room= is the old name: server/old-links.js.)
app.get('/img/:key/:slot', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req) && !hasGuestAccess(req)) return res.status(403).end();
  const user = store.userByKey(req.params.key);
  if (!user) return res.status(404).end();
  const wanted = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  const slot = SLOTS.includes(wanted) ? wanted : 'profile';
  const spaceId = slot !== 'profile' && typeof req.query.space === 'string' ? req.query.space : null;
  if (req.query.spaceOnly === '1') {
    // Just this space's own picture -- no fallback to the member's global or default one.
    const own = spaceId && store.usesSpaceImages(user.key, spaceId) && store.resolveImage(user.key, slot, spaceId);
    return own ? sendImage(res, own.file) : res.status(404).end();
  }
  const resolved = store.effectiveImage(user.key, slot, spaceId);
  if (resolved) return sendImage(res, resolved.file);
  if (slot !== 'profile' || req.query.fallback === 'none') return res.status(404).end();
  res.set('Cache-Control', 'no-cache').type('image/svg+xml').send(initialsSvg(user.displayName));
});

// Web app manifest, so the call page installs as a chromeless window
// (Chrome/Edge "Install app", Safari "Add to Dock").
app.get('/manifest.webmanifest', (_req, res) => {
  const s = store.settings;
  const custom = store.iconPath();
  const icons = [];
  if (custom && /\.png$/.test(custom)) icons.push({ src: '/img/site/icon', sizes: 'any', type: 'image/png' });
  icons.push({ src: '/assets/images/brand/brandmark-color.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' });
  res.set('Cache-Control', 'no-cache').type('application/manifest+json').json({
    name: s.environmentName,
    short_name: s.environmentName.length > 12 ? s.environmentName.slice(0, 12) : s.environmentName,
    description: `${s.environmentName}: voice and video calls`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#1a1410',
    theme_color: '#1a1410',
    icons,
  });
});

// Static assets, including the LiveKit browser client and Font Awesome
// (the one icon set every page uses) served from node_modules.
app.use('/lib/livekit-client.esm.mjs', express.static(path.join(clientDist, 'livekit-client.esm.mjs')));
const faDir = path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
// An admin's own Font Awesome Pro package, dropped at DATA_DIR/fontawesome-pro/ (the "Web" download from their own Font
// Awesome account: css/, webfonts/ and svgs/, the same shape as the bundled Free set) -- never fetched, never in the image,
// never a token anywhere in this repo, so the shared image every self-hoster pulls stays Free-only and the licence stays
// the admin's own. Present, it is served (and looked up for an icon's SVG) ahead of Free; a style or icon it does not have
// falls back to Free, so nothing breaks if it is partial or absent.
const faProDir = path.join(DATA_DIR, 'fontawesome-pro');
const hasFaPro = fs.existsSync(path.join(faProDir, 'css'));
app.use('/fa/css', express.static(path.join(faProDir, 'css'), { maxAge: '7d' }), express.static(path.join(faDir, 'css'), { maxAge: '7d' }));
// Font files are fetched by sandboxed module frames too (no origin, so only a wildcard CORS header lets them load),
// hence the header here and on the icon webfonts, and on no other route. The URLs are not content-hashed; the files
// change only with a release, so 30 days.
const fontHeaders = { maxAge: '30d', setHeaders: (res) => res.set('Access-Control-Allow-Origin', '*') };
app.use('/fa/webfonts', express.static(path.join(faProDir, 'webfonts'), fontHeaders), express.static(path.join(faDir, 'webfonts'), fontHeaders));
app.use('/fonts', express.static(path.join(publicDir, 'fonts'), fontHeaders));
app.use('/fonts', (req, res) => res.status(404).type('text').send('not found')); // a missing font ends here, not in the environment routes

// Background blur's own dependencies, all self-hosted for the same reason
// livekit-client is: nothing this page needs is fetched from a CDN at
// runtime. track-processors imports "livekit-client" and
// "@mediapipe/tasks-vision" by bare package name -- space.html's import map
// points those at the second and third routes below.
const trackProcessorsDist = path.join(__dirname, '..', 'node_modules', '@livekit', 'track-processors', 'dist');
const visionDir = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision');
app.use('/lib/track-processors.mjs', express.static(path.join(trackProcessorsDist, 'index.mjs')));
app.use('/lib/tasks-vision.mjs', express.static(path.join(visionDir, 'vision_bundle.mjs')));
app.use('/lib/mediapipe-wasm', express.static(path.join(visionDir, 'wasm'), { maxAge: '30d' }));

// The app's own PDF viewer (server/pdf-viewer.js): its document, which a page frames sandboxed and hands a PDF's bytes,
// and the files it loads, which a null-origin frame loads as cross-origin (hence their CORS header). Nothing here reads
// a session or a file: the bytes only ever come from the page that frames it.
app.get(pdfViewer.VIEWER_PATH, (_req, res) => res.set(pdfViewer.VIEWER_HEADERS).send(pdfViewer.VIEWER_HTML));
const viewerFileHeaders = { index: false, dotfiles: 'deny', setHeaders: (res) => res.set(pdfViewer.VIEWER_FILE_HEADERS) };
app.use('/sdk/pdfjs', express.static(path.join(publicDir, 'sdk', 'pdfjs'), viewerFileHeaders), (_req, res) => res.status(404).type('text').send('not found'));
for (const f of ['pdf-viewer.mjs', 'pdf-viewer.css']) app.get(`/sdk/${f}`, (_req, res) => res.sendFile(path.join(publicDir, 'sdk', f), { headers: pdfViewer.VIEWER_FILE_HEADERS }));

// A server-rendered stylesheet, not a static one: whatever theme colors an
// admin has set (Manage > Settings > Theme), both its light and its dark set
// (server/theme-css.js), as :root overrides -- linked
// after style.css on every page, so the cascade lets it win without
// touching style.css itself. Nothing set yet means only Strong Coffee's
// light set, under data-theme-mode="light", so an untouched server still
// looks exactly like style.css's own built-in defaults.
// This is also why the popped-out call window (space.js clones every
// <link rel="stylesheet"> into that new window) picks up the theme for
// free -- it's just another stylesheet link, not a runtime JS override
// that would need its own copy into that second document.
app.get('/theme.css', (req, res) => {
  res.set('Content-Type', 'text/css');
  res.set('Cache-Control', 'no-cache');
  // No environment at the bare base domain (the landing page): no theme there either, same as one that has not set one.
  const env = envContext.getStore();
  if (!env) return res.send('');
  // Both modes, each under its own <html data-theme-mode> (server/theme-css.js); a page without the attribute shows
  // the signed-in person's own mode, else the environment's default, so the first paint is already right.
  const person = currentUser(req);
  res.send(themeCssLib.themeCss(env.store.activeThemeSets(), person?.themeMode || environmentThemeMode()));
});

// A library module's share links (server/vault-share.js): the signed-in routes that make and turn them off, and the
// public page and routes a link opens, with no session. Ahead of the static files, so /shared.html has its headers too.
mountVaultShares(app, { express, vault, modules, store, auth, word, libraryAccess, libraryHeaders, dropUploadBody, noteActivity, slugOf: () => currentEnvironment().slug || '', sharePage: page('shared.html'), makerCan: shareMakerCan });

app.use(express.static(publicDir, { index: false }));

// Public API ------------------------------------------------------------------

app.get('/api/branding', (_req, res) => res.json(branding()));

app.get('/api/config', (req, res) => res.json({ livekitUrl: HAS_CALL_SERVICE ? livekitWsUrl(req) : null, ...branding() }));

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (limiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a few minutes' });
  const user = resolveLoginUser(req.body?.login, req.body?.password || '');
  if (!user) {
    limiter.fail(ip);
    return res.status(401).json({ error: 'wrong username or password' });
  }
  limiter.clear(ip);
  const gate = mfaGate(req, user);
  if (gate) {
    auth.setPendingCookie(req, res, gate.pending);
    return res.json({ mfaRequired: true, enrol: gate.enrol, pending: gate.pending });
  }
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  setEnvHint(req, res);
  res.json({ user: publicUser(req, user, { self: true }), token });
});

// The second step, for an account with a factor already: a TOTP code or a recovery code, checked against
// whoever the pending token (the cookie, or the body for a caller that cannot rely on one) names. On success
// the real session, plus a trusted-browser cookie when asked -- same shape and cookie handling as a plain
// sign-in from here on. Rate-limited the same way a wrong password is.
app.post('/api/login/verify', (req, res) => {
  const ip = req.ip || 'unknown';
  if (limiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a few minutes' });
  const pendingToken = req.body?.pending || auth.parseCookies(req.get('cookie'))[auth.PENDING_COOKIE] || null;
  const pend = pendingToken && auth.readPending(store.sessionSecret, pendingToken, { env: currentEnvironment().slug || '', purpose: 'verify' });
  const user = pend && store.userByKey(pend.u);
  if (!user || !user.mfa) {
    limiter.fail(ip);
    return res.status(401).json({ error: 'sign in again' });
  }
  const ok = verifyMfaCode(user.mfa, req.body?.code, {
    onStep: (step) => store.mfaRecordStep(user.key, step),
    onRecovery: (hash) => store.mfaSpendRecovery(user.key, hash),
  });
  if (!ok) {
    limiter.fail(ip);
    return res.status(401).json({ error: 'wrong code' });
  }
  limiter.clear(ip);
  const fresh = store.userByKey(user.key);
  const token = auth.issueSession(store.sessionSecret, fresh);
  auth.setSessionCookie(req, res, token);
  auth.clearSessionCookie(req, res, auth.PENDING_COOKIE);
  if (req.body?.remember) auth.setSessionCookie(req, res, auth.issueSession(store.sessionSecret, fresh), auth.TRUST_COOKIE);
  setEnvHint(req, res);
  res.json({ user: publicUser(req, fresh, { self: true }), token });
});

// Self sign-up: only works while an admin has it turned on. A self-signed
// account is a normal user, in the Lobby like everyone (that's automatic,
// not something to grant).
app.post('/api/register', (req, res) => {
  if (!store.settings.allowRegistration) return res.status(403).json({ error: 'sign-up is turned off' });
  if (refuseOverMembers(res)) return;
  const { login, displayName, password } = req.body || {};
  if (!password) throw new StoreError('a password is required');
  const user = store.addUser({ login, displayName, role: 'member', passwordHash: auth.hashPassword(password) });
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  setEnvHint(req, res);
  res.status(201).json({ user: publicUser(req, user, { self: true }) });
});

// An owner-made invite: signs someone up straight into the spaces it was
// made with. Works even while general sign-up is off -- an admin handed
// this out on purpose.
app.post('/api/invites', requireOwner, (req, res) => {
  const invite = store.createInvite((req.body || {}).spaces);
  res.status(201).json({ invite: { ...invite, url: `${baseUrl(req)}/invite/${invite.token}` } });
});
app.get('/api/invites/:token', (req, res) => {
  const invite = store.inviteByToken(req.params.token);
  if (!invite) return res.status(404).json({ error: 'this invite is gone or has expired' });
  res.json({ invite: { spaces: invite.spaces.map((id) => store.spaceById(id)).filter(Boolean).map((r) => r.name), expiresAt: invite.expiresAt } });
});
app.post('/api/invites/:token/accept', (req, res) => {
  const invite = store.inviteByToken(req.params.token);
  if (!invite) return res.status(404).json({ error: 'this invite is gone or has expired' });
  if (refuseOverMembers(res)) return;
  const { login, displayName, password } = req.body || {};
  if (!password) throw new StoreError('a password is required');
  const user = store.addUser({ login, displayName, role: 'member', passwordHash: auth.hashPassword(password) });
  for (const spaceId of invite.spaces) {
    const space = store.spaceById(spaceId);
    if (space) store.updateSpace(spaceId, { members: [...space.members, user.key] });
  }
  store.removeInvite(invite.token);
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  setEnvHint(req, res);
  res.status(201).json({ user: publicUser(req, user, { self: true }) });
});

app.post('/api/logout', (req, res) => {
  auth.clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  const user = currentUser(req);
  res.json({
    user: publicUser(req, user, { self: true }),
    ...branding(),
    // `owner`: this account is one of the environment's owners -- never the host admin's own cross sign-in stand-in
    // (role admin), which has an owner's rights but is not one.
    environment: { hosted: Boolean(BASE_DOMAIN), slug: currentEnvironment().slug || null, name: store.settings.environmentName, owner: user.role === 'owner', hostAdmin: Boolean(user.hostAdmin) },
    livekitUrl: HAS_CALL_SERVICE ? livekitWsUrl(req) : null,
    streamKey: hasOwnerRights(user) ? store.streamKey : undefined,
    // documentation/plans/plan-mfa.md: mfaEnrolled also rides along inside `user` (publicUser, for everyone
    // else's own account too); mfaRequired is this session's own -- the policy asks something of this person
    // that they have not met yet, so the profile page can show the inline enrolment banner -- and overrides
    // branding()'s own environment-wide mfaRequired above. mfaBypass is only ever true for this exact caller.
    mfaEnrolled: Boolean(user.mfa),
    mfaRequired: !user.mfa && mfaPolicyRequires(user),
    mfaBypass: mfaBypassApplies(user),
  });
});

// The signed-in person's own account settings. So far only themeMode (GitHub #62): 'light' or 'dark', or null to
// follow the environment's default mode again. Every field is checked before any is kept, so a refused save changes
// nothing. The person's other open pages are told at once (the 'mode' event on /api/notifications/stream).
const ME_FIELDS = ['themeMode'];
app.patch('/api/me', requireUser, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'send the changes as JSON, such as {"themeMode":"dark"}' });
  const unknown = Object.keys(body).find((k) => !ME_FIELDS.includes(k));
  if (unknown) return res.status(400).json({ error: `${unknown} can't be changed here` });
  if (!Object.keys(body).length) return res.status(400).json({ error: 'there is nothing to change' });
  const { themeMode } = body;
  if (themeMode !== null && themeMode !== 'light' && themeMode !== 'dark') return res.status(400).json({ error: `the mode is light or dark, or null to follow the ${word('environment')}'s default` });
  const user = currentUser(req);
  const mode = store.setThemeMode(user.key, themeMode);
  themeEvents.emit('mode', { userKey: user.key, themeMode: mode });
  res.json({ user: publicUser(req, store.userByKey(user.key), { self: true }), themeMode: environmentThemeMode() });
});

// Enrolment (documentation/plans/plan-mfa.md): for the signed-in person, or -- with no session yet -- whoever
// holds a valid 'enrol' pending token (mfaSubject covers both). start makes a new secret, kept unconfirmed
// until enable; another start simply replaces it. enable confirms it, makes the recovery codes (shown once,
// never again), and -- when there was no session to begin with -- signs the person in with the same answer.
app.post('/api/me/mfa/start', requireMfaOffered, async (req, res) => {
  const user = mfaSubject(req);
  if (!user) return res.status(401).json({ error: 'sign in first' });
  const secret = auth.totpSecret();
  store.mfaStart(user.key, auth.encryptSecret(secret, secretsKeyBuf()));
  const otpauth = auth.otpauthUrl(store.settings.environmentName, user.login, secret);
  const qr = await QRCode.toString(otpauth, { type: 'svg' });
  res.json({ otpauth, qr, secret });
});
app.post('/api/me/mfa/enable', requireMfaOffered, (req, res) => {
  const user = mfaSubject(req);
  if (!user) return res.status(401).json({ error: 'sign in first' });
  const pending = user.mfa?.pending;
  if (!pending || Date.now() - new Date(pending.startedAt).getTime() > 3600000) {
    return res.status(400).json({ error: 'start enrolment again' });
  }
  const plain = auth.decryptSecret(pending.secret, secretsKeyBuf());
  const step = plain ? auth.totpVerify(plain, req.body?.code) : null;
  if (step === null || step === undefined) return res.status(401).json({ error: 'wrong code' });
  const recoveryCodes = auth.recoveryCodes();
  store.mfaEnable(user.key, recoveryCodes.map((c) => auth.hashPassword(c)));
  store.mfaRecordStep(user.key, step);
  const fresh = store.userByKey(user.key);
  // Enabling bumps mfa.version, which changes this very account's own userStamp -- an already-signed-in
  // caller's session cookie was issued under the old stamp and would otherwise silently stop working the
  // moment this answers, logging them out of the enrolment they just finished. Always reissued, whether or
  // not there was a session to begin with (the pending-enrol-token caller had none at all).
  const token = auth.issueSession(store.sessionSecret, fresh);
  auth.setSessionCookie(req, res, token);
  auth.clearSessionCookie(req, res, auth.PENDING_COOKIE);
  const out = { recoveryCodes, user: publicUser(req, fresh, { self: true }), token };
  if (!currentUser(req)) {
    setEnvHint(req, res);
  }
  res.json(out);
});
// Refused when the policy requires a factor for this person -- they may only replace it (start, then
// enable), never go without one while it is required.
app.post('/api/me/mfa/disable', requireMfaOffered, requireUser, (req, res) => {
  const user = currentUser(req);
  if (!user.mfa) return res.status(400).json({ error: 'no second factor to disable' });
  if (mfaPolicyRequires(user)) return res.status(403).json({ error: `this ${word('environment')} requires a second factor for your account` });
  const ok = verifyMfaCode(user.mfa, req.body?.code, {
    onStep: () => {}, // about to be disabled outright -- recording the step used is pointless
    onRecovery: () => {},
  });
  if (!ok) return res.status(401).json({ error: 'wrong code' });
  store.mfaDisable(user.key);
  // Disabling changes this account's own userStamp too (mfa.version was folded in, now gone entirely), which
  // would otherwise silently sign this very request's own session out along with the factor -- reissued so
  // disabling stays a smooth, in-session action rather than an accidental sign-out.
  const token = auth.issueSession(store.sessionSecret, store.userByKey(user.key));
  auth.setSessionCookie(req, res, token);
  res.json({ ok: true, token });
});
// The lockout bypass's own way back in: no code needed, just the account's own password -- for an
// owner who has a second factor but lost the means to produce a code at all. Only while ADMIN_MFA_LOCKOUT_BYPASS is on,
// and only for an owner (documentation/plans/plan-mfa.md, "Regaining access"); the host admin's own cross
// sign-in has no real factor of its own, so it is excluded the same way mfaBypassApplies excludes it.
app.post('/api/me/mfa/reset', requireMfaOffered, requireUser, (req, res) => {
  const user = currentUser(req);
  if (!adminMfaLockoutBypass) return res.status(403).json({ error: 'the lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is not turned on' });
  if (!mfaBypassApplies(user)) return res.status(403).json({ error: `only ${word('owner', { a: true })} or the admin can use the lockout bypass` });
  if (!user.passwordHash || !auth.verifyPassword(req.body?.password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'wrong password' });
  }
  store.mfaDisable(user.key);
  const token = auth.issueSession(store.sessionSecret, store.userByKey(user.key));
  auth.setSessionCookie(req, res, token);
  res.json({ ok: true, token });
});
// An environment admin resets a member's factor -- never their own (use disable instead) -- signing them out
// everywhere and asking nothing until they enrol again.
app.delete('/api/users/:key/mfa', requireOwner, (req, res) => {
  if (currentUser(req).key === req.params.key) return res.status(400).json({ error: 'reset your own from your profile instead' });
  const target = store.userByKey(req.params.key);
  if (!target) return res.status(404).json({ error: 'no such user' });
  // The server's admin recovers through ADMIN_PASSWORD and the lockout bypass, never an owner's reset.
  if (target.role === 'admin' && !target.hostAdmin) return res.status(400).json({ error: "this account is the server's admin: it recovers its two-step sign-in with ADMIN_PASSWORD and the lockout bypass, so it can't be reset here" });
  store.mfaDisable(req.params.key);
  res.json({ ok: true });
});

// An OBS viewer's token for the call service (`role: 'viewer'`, the stream key): hidden, watching one space's or
// aside's call (the Lobby unless asked, as `space`; host.media.watch, the Stream module's keyed page). `call` in the
// answer is the call's own name there. Never refused by the calls cap. A person's token for the call is POST
// /api/call/join's, the only one there is (plan-realtime-optional-livekit.md, step 5): entering a space asks for none.
app.post('/api/token', async (req, res) => {
  if (req.body?.role !== 'viewer') return res.status(400).json({ error: "only an OBS viewer's token is made here (role: 'viewer'); the call's is POST /api/call/join" });
  if (!HAS_CALL_SERVICE) return res.status(503).json({ error: NO_CALL_SERVICE });
  if (!hasStreamAccess(req)) return res.status(403).json({ error: 'stream key required' });
  const spaceId = typeof req.body?.space === 'string' && req.body.space ? req.body.space : LOBBY;
  const theSpace = store.spaceById(spaceId) || store.asideById(spaceId);
  if (!theSpace) return res.status(404).json({ error: `no such ${word('space')}` });
  const call = callName(spaceId);
  const identity = `obs-${Date.now().toString(36)}-${randomToken(4)}`;
  res.json({ token: await mintToken({ identity, name: 'OBS', call, publisher: false }), livekitUrl: livekitWsUrl(req), identity, call, spaceId });
});

// Joining the call (a click, or a pull that moves the call: entering a space never joins, and asks the call service
// nothing): the calls cap, counted from people actually on a call, then the call's token, the only way a person gets
// one, so being at the call service is being on the call. Joining a call already running is never refused; starting a
// new one is, once the plan's limit is spent elsewhere. A person signed in asks for `space` (the Lobby unless given;
// its members, owners and the admin); a guest sends their guest link's token as `guest` (in the body or the query, as
// the guest reads do) and their guest pass as `pass`, and joins that link's space as the id on the pass. Refused
// (403) where the person may not join the call (Conference off, or no "See and join the conference"). An aside's call
// was checked when it was made (POST /api/asides), so joining it is never refused by the cap.
// Answers { ok, token, livekitUrl, call }; 503 with no call service, before anything else.
app.post('/api/call/join', async (req, res) => {
  if (!HAS_CALL_SERVICE) return res.status(503).json({ error: NO_CALL_SERVICE });
  const guestLink = typeof req.body?.guest === 'string' ? req.body.guest : typeof req.query.guest === 'string' ? req.query.guest : '';
  const asked = typeof req.body?.space === 'string' && req.body.space ? req.body.space : null;
  let spaceId;
  let identity;
  let caller = null; // who joins, at the call service: { identity, name, media }
  const user = currentUser(req);
  if (user) {
    spaceId = asked || LOBBY;
    const theSpace = store.spaceById(spaceId) || store.asideById(spaceId);
    if (!theSpace) return res.status(404).json({ error: `no such ${word('space')}` });
    if (!theSpace.members.includes(user.key) && !isOwner(req)) return res.status(403).json({ error: `you are not in that ${word('space')}` });
    identity = user.key;
    caller = { identity: user.key, name: user.displayName, media: Boolean(store.spacePermissions(user.key, spaceId).conference) };
  } else if (guestLink) {
    const theSpace = store.spaceByGuestToken(guestLink);
    if (!theSpace) return res.status(404).json({ error: `that ${word('guest')} link is off or wrong` });
    if (asked && asked !== theSpace.id) return res.status(403).json({ error: `that ${word('guest')} link is for another ${word('space')}` });
    spaceId = theSpace.id;
    identity = `guest-link:${guestLink}`; // names their hold
    const pass = typeof req.body?.pass === 'string' ? readGuestPass(guestLink, req.body.pass) : null;
    if (!pass) return res.status(403).json({ error: `that ${word('guest')} pass is not valid; enter again` });
    caller = { identity: pass.id, name: pass.name, media: Boolean(store.roleSet('guest').conference) };
  } else {
    return res.status(401).json({ error: 'sign in first' });
  }
  if (!caller.media) return res.status(403).json({ error: store.settings.conferenceEnabled === false ? 'voice and video are off' : `you can't join the call in this ${word('space')}` });
  if (!store.asideById(spaceId)) {
    const refusal = await callsCapRefusal(spaceId, identity);
    if (refusal) return res.status(403).json({ error: refusal });
  }
  const call = callName(spaceId);
  const token = await mintToken({ identity: caller.identity, name: caller.name, call, publisher: true });
  res.json({ ok: true, token, livekitUrl: livekitWsUrl(req), call });
});

// The guest pass (plan-realtime-optional-livekit.md, "Requests a page makes"): what POST /api/guest-join hands a guest,
// so the live stream, presence and the call know them by one id and the name they gave. `<what>.<signature>`: `what` is
// { id, name } as base64url JSON, signed (HMAC-SHA256, a key made from the install's secrets key) with the environment and
// the guest link's token, so a guest cannot speak as another guest, nor use it in another environment, and it dies with
// the link (turned off or made again).
function guestPassKey() {
  return crypto.createHmac('sha256', secretsKeyBuf()).update('pass').digest();
}
function guestPassSignature(link, what) {
  return crypto.createHmac('sha256', guestPassKey()).update(`${currentEnvironment().slug || ''}\n${link}\n${what}`).digest('base64url');
}
function makeGuestPass(link, id, name) {
  const what = Buffer.from(JSON.stringify({ id, name })).toString('base64url');
  return `${what}.${guestPassSignature(link, what)}`;
}
// { id, name } from a pass for this guest link, or null when it is not one.
function readGuestPass(link, pass) {
  if (typeof link !== 'string' || !link || typeof pass !== 'string' || pass.length > 400) return null;
  const [what, signature, extra] = pass.split('.');
  if (!what || !signature || extra !== undefined) return null;
  const want = Buffer.from(guestPassSignature(link, what));
  const got = Buffer.from(signature);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let said = null;
  try { said = JSON.parse(Buffer.from(what, 'base64url').toString('utf8')); } catch { return null; }
  if (!said || typeof said.id !== 'string' || !/^guest-[A-Za-z0-9_-]{4,40}$/.test(said.id) || typeof said.name !== 'string' || !said.name) return null;
  return { id: said.id, name: said.name };
}

// Guests: no account, just a name and a space's guest link (see the
// guest-link routes above). Public -- there's nothing to sign in with.
app.get('/api/guest-link/:token', (req, res) => {
  const theSpace = store.spaceByGuestToken(req.params.token);
  if (!theSpace) return res.status(404).json({ error: `that ${word('guest')} link is off or wrong` });
  res.json({ spaceId: theSpace.id, spaceName: theSpace.name });
});
// A guest enters with a name: their pass (makeGuestPass), by which the live stream, presence and the call know them.
// No call service is asked: the call's token comes from POST /api/call/join, with the pass.
app.post('/api/guest-join', (req, res) => {
  const theSpace = store.spaceByGuestToken(req.body?.token);
  if (!theSpace) return res.status(404).json({ error: `that ${word('guest')} link is off or wrong` });
  const name = cleanText(req.body?.name, 40);
  if (!name) return res.status(400).json({ error: 'a name is required' });
  const id = `guest-${randomToken(8)}`;
  const guest = { id, name, pass: makeGuestPass(req.body.token, id, name) };
  res.json({ spaceId: theSpace.id, spaceName: theSpace.name, permissions: store.roleSet('guest'), guest });
});

// A user may replace or clear their own profile photo. This is separate from
// the Player box's Online picture, which only an admin sets (it may be part
// of a matched set of OBS images).
// Any image slot is self-service once the user's role has its "Images"
// permission (Manage > Roles): by default the profile photo and the call
// background (a still behind their own camera, an alternative to blur).
function requireImageRight(req, res, next) {
  const slot = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'unknown image slot' });
  const user = currentUser(req);
  if (!store.roleSet(user.role)[`image_${slot}`]) return res.status(403).json({ error: 'your role can\'t change that image' });
  req.imageSlot = slot;
  next();
}
app.put('/api/me/images/:slot', requireUser, requireImageRight, rawImage, checkStorageCap, (req, res) => {
  store.setImage(currentUser(req).key, req.imageSlot, req.body, req.get('content-type'));
  res.json({ ok: true });
});
app.delete('/api/me/images/:slot', requireUser, requireImageRight, (req, res) => {
  store.removeImage(currentUser(req).key, req.imageSlot);
  res.json({ ok: true });
});
// The same for a space's own pictures, and the switch that turns them on.
function requireOwnSpace(req, res, next) {
  const space = store.spaceById(req.params.spaceId);
  if (!space || !space.members.includes(currentUser(req).key)) return res.status(403).json({ error: `not ${word('member', { a: true })} of that ${word('space')}` });
  next();
}
app.put('/api/me/spaces/:spaceId/images/:slot', requireUser, requireOwnSpace, requireImageRight, rawImage, checkStorageCap, (req, res) => {
  const user = currentUser(req);
  store.setImage(user.key, req.imageSlot, req.body, req.get('content-type'), req.params.spaceId);
  res.json({ user: publicUser(req, store.userByKey(user.key), { self: true }) });
});
app.delete('/api/me/spaces/:spaceId/images/:slot', requireUser, requireOwnSpace, requireImageRight, (req, res) => {
  const user = currentUser(req);
  store.removeImage(user.key, req.imageSlot, req.params.spaceId);
  res.json({ user: publicUser(req, store.userByKey(user.key), { self: true }) });
});
app.patch('/api/me/spaces/:spaceId', requireUser, requireOwnSpace, (req, res) => {
  const user = currentUser(req);
  const set = store.roleSet(user.role);
  if (!Object.entries(set).some(([k, v]) => v && k.startsWith('image_') && k !== 'image_profile' && k !== 'image_background')) {
    return res.status(403).json({ error: `your role can't change ${word('space', { a: true })}'s images` });
  }
  store.setSpacePrefs(user.key, req.params.spaceId, { useDefaultImages: req.body?.useDefaultImages });
  res.json({ user: publicUser(req, store.userByKey(user.key), { self: true }) });
});

// A user's own mic/camera processing settings (gain, noise suppression,
// echo cancellation, auto gain, push to talk, quality, mirror, background
// mode, master volume) -- not which physical device to use, that stays
// local to the browser. Self-service, and admin can set it for someone
// else from their profile page the same way images work.
app.patch('/api/me/call-prefs', requireUser, (req, res) => {
  res.json({ callPrefs: store.setCallPrefs(currentUser(req).key, req.body || {}) });
});
app.patch('/api/users/:key/call-prefs', requireOwner, (req, res) => {
  res.json({ callPrefs: store.setCallPrefs(req.params.key, req.body || {}) });
});

// Presence: everyone in the environment, with names, talking colours and Player options for the tiles and view
// pages, who is in a call right now and in which space, and the spaces themselves (the ones the caller may join
// marked). GET /api/presence answers it; POST /api/presence is a page's heartbeat.
// Who is on the site right now, in a call or not: a page tells the server it is open every half minute
// (POST /api/presence), and a person counts as present for a little longer than that (server/live.js, SITE_MS), or
// while a live stream of theirs is open. Held in memory, so it starts empty when the server does and fills within
// half a minute.
const isPresent = (key) => live.onSite(key);
app.post('/api/presence', requireUser, (req, res) => {
  live.beat(currentUser(req).key);
  res.json({ ok: true });
});

// Who is where, for GET /api/presence and GET /api/status: the live register (server/live.js), with the call service's
// list merged in for who is on a call and their microphone and camera (mergeCall). The call service is asked only while
// the register has someone on a call (their page's word), so entering, leaving and moving never reach it.
// key -> { key, name, space, call, joinedAt, inCall, micOn, cameraOn }.
async function whereEveryone() {
  const places = live.places();
  const onCall = [...places.values()].some((p) => p.onCall);
  return mergeCall(places, onCall ? await participants() : []);
}

// Asides (plan-names step 3 moved these from /api/table/*; step 8 gave them their own record, store.asides, and made
// them the call only: no modules, chat, layout, pictures or settings). Who is where and on the call is the live register's
// (server/live.js), and each nudge to a page goes on its live stream (GET /api/live, tellLive), with a type that names it:
// aside-pull, aside-started, aside-recall and aside-return (plan-realtime-optional-livekit.md, step 4). None of it asks
// the call service, except the calls cap.

// An invitation to a conversation of two: a private aside (off the record) for the inviter and the person invited,
// who is told wherever they have the app open (the notification stream) and can join or decline. It lives a couple
// of minutes; the aside is swept away when nobody is in it, as any aside is.
const INVITE_MS = 2 * 60 * 1000;
// An aside is a call, so none is made without one: [status, sentence] with no call service (503) or the Conference
// switched off (403), else null.
function callOffRefusal() {
  if (!HAS_CALL_SERVICE) return [503, NO_CALL_SERVICE];
  if (store.settings.conferenceEnabled === false) return [403, 'voice and video are off'];
  return null;
}
app.post('/api/asides/invite', requireUser, (req, res) => {
  const off = callOffRefusal();
  if (off) return res.status(off[0]).json({ error: off[1] });
  const me = currentUser(req);
  const to = store.userByKey(String(req.body?.to || ''));
  if (!to || to.key === me.key) return res.status(400).json({ error: 'pick someone else to invite' });
  if (store.settings.allowPrivate === false) return res.status(403).json({ error: 'private conversations are turned off' });
  if (!store.spacePermissions(me.key, null).privateCall) return res.status(403).json({ error: "you can't start a private conversation" });
  if (!isPresent(to.key)) return res.status(409).json({ error: `${to.displayName} is not online right now` });
  const aside = store.addAside([me.key, to.key], null, true);
  const invite = { id: randomToken(), from: me.key, to: to.key, spaceId: aside.id, at: Date.now() };
  invites.set(invite.id, invite);
  for (const [id, i] of invites) if (Date.now() - i.at > INVITE_MS) invites.delete(id);
  inviteEvents.emit('invite', { ...invite, fromName: me.displayName });
  res.json({ aside, invite: { id: invite.id } });
});
// Declining just ends the invitation; the inviter is not told anything unfriendly, the aside simply stays empty.
app.post('/api/asides/invite/:id/decline', requireUser, (req, res) => {
  const invite = invites.get(req.params.id);
  if (invite && invite.to === currentUser(req).key) invites.delete(invite.id);
  res.json({ ok: true });
});

// Presence by membership (plan-primary-nav.md, decision 6; server/presence-view.js has the rules): a signed-in person
// reads where someone is only for the spaces (and asides) they belong to -- owners and the admin belong to all of
// them -- someone in an aside reads as its parent space with `aside: true` to the parent's members, and anyone else's
// place is `space: null, elsewhere: true`. A guest reads only their own space and its people. The access key (OBS,
// Studio) reads everything, as before; GET /api/status is unchanged.
function presenceViewer(req) {
  if (hasStreamKey(req)) return { all: true };
  const user = currentUser(req);
  if (user) return { key: user.key, owner: hasOwnerRights(user) };
  const guestSpace = typeof req.query.guest === 'string' ? store.spaceByGuestToken(req.query.guest) : null;
  return guestSpace ? { guestSpace: guestSpace.id } : null;
}
app.get('/api/presence', async (req, res) => {
  const viewer = presenceViewer(req);
  if (!viewer) return res.status(401).json({ error: 'sign in first' });
  const byKey = await whereEveryone();
  store.pruneAsides(byKey);
  const view = presenceView(viewer, {
    users: store.users,
    spaces: store.spaces,
    asides: store.asides,
    online: byKey,
    present: isPresent,
    describeUser: presenceUser,
    describeSpace: (r) => shownSpace(req, r),
    activeSpace: activeSpaceId(byKey),
  });
  res.json({ ...branding(), ...view, ownerOnline: hasOnlineOwner(byKey) });
});

// An admin pulls one or more people who are on the call with them into a new aside. Nobody is moved by the server: the
// admin's own browser gets the aside in this response and moves itself; everyone else pulled gets a nudge on their live
// stream (aside-pull) telling their page which aside to move to, and everyone in the space the aside came from is told
// it started (aside-started). The caller and the people pulled must be on the call as the register says (their page's
// word, PATCH /api/spaces/:id/presence). An ordinary aside is a GM move -- pulling someone into an in-fiction private
// moment, admin only. A Private Conversation is a real off-the-record word, which any two (or more) people in a call
// should be able to step into together without needing the admin to broker it -- so this route allows any signed-in
// user, but still requires admin for anything that isn't private.
app.post('/api/asides', requireUser, async (req, res) => {
  const off = callOffRefusal();
  if (off) return res.status(off[0]).json({ error: off[1] });
  const initiator = currentUser(req);
  const priv = Boolean(req.body?.private);
  if (priv && store.settings.allowPrivate === false) return res.status(403).json({ error: 'private conversations are turned off' });
  if (!priv && store.settings.allowAsides === false) return res.status(403).json({ error: `${word('aside', { many: true })} are turned off` });
  const raw = req.body?.with;
  const keys = [...new Set(Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])];
  const targets = keys.filter((k) => k !== initiator.key).map((k) => store.userByKey(k)).filter(Boolean);
  if (!targets.length) return res.status(400).json({ error: 'pick someone to pull aside' });
  const mine = live.placeOf(initiator.key);
  if (!mine || !mine.onCall) return res.status(400).json({ error: 'you need to be in a call yourself to pull someone aside' });
  const originId = mine.space;
  const perms = store.spacePermissions(initiator.key, originId);
  if (priv ? !perms.privateCall : !perms.startAside) return res.status(403).json({ error: priv ? 'you can\'t start a private conversation' : `you can't pull someone into ${word('aside', { a: true })}` });
  for (const target of targets) {
    const there = live.placeOf(target.key);
    if (!there || there.space !== originId) return res.status(404).json({ error: `${target.displayName} is not with you right now` });
    if (!there.onCall) return res.status(409).json({ error: `${target.displayName} is not in the conference right now` });
  }
  // An aside is a call. Its members leave the call they are in for it: if nobody else stays on that call, the aside
  // takes its slot; if others stay, the aside is a new running call and the plan's limit is asked here, before
  // anyone is pulled (joining the aside is then never refused). The aside's slot is held until they show on its call.
  const moving = [initiator.key, ...targets.map((t) => t.key)];
  const refusal = await callsCapRefusal(null, initiator.key, { leaving: moving, hold: false });
  if (refusal) return res.status(403).json({ error: refusal });
  const aside = store.addAside(moving, originId, priv);
  if (planCap('calls') !== null) holdCallStart(aside.id, initiator.key);
  // byOwner tells the target's page whether to just go (an owner's call) or ask first.
  for (const target of targets) tellLive(target.key, originId, { type: 'aside-pull', spaceId: aside.id, byOwner: hasOwnerRights(initiator), private: priv, from: initiator.displayName });
  // Everyone in the space it came from, those pulled too: a private word is private from the others, not invisible to
  // them -- this is what lets their tiles turn into "in an aside" placeholders right away instead of just looking like
  // they hung up. A private conversation's carries no members: who is with whom stays off the record (presence by
  // membership gives the parent's members only `aside: true, asidePrivate: true` for each), and the page learns who
  // stepped out from GET /api/presence.
  tellLiveSpace(originId, priv ? { type: 'aside-started', spaceId: aside.id, private: true } : { type: 'aside-started', spaceId: aside.id, members: aside.members, private: false });
  res.json({ aside });
});

// Admin-only recall: every Private Conversation pulled out of the admin's own current space gets a warning on its
// members' live streams (aside-recall) -- their own page runs a 10-second countdown, then moves them back here itself,
// rather than being yanked back instantly. Doesn't touch ordinary asides: the admin is always already in those, so
// there's nothing to recall them from that returning (POST /api/asides/return) doesn't already cover.
app.post('/api/asides/recall', requireOwner, (req, res) => {
  const admin = currentUser(req);
  const mine = live.placeOf(admin.key);
  if (!mine) return res.status(400).json({ error: `you need to be in ${word('space', { a: true })} yourself to recall anyone` });
  const originId = mine.space;
  const destSpace = store.spaceById(originId);
  const privateAsides = store.asides.filter((a) => a.private && a.origin === originId);
  if (!privateAsides.length) return res.status(400).json({ error: 'nobody is off in a private conversation from here right now' });
  const payload = { type: 'aside-recall', spaceId: originId, spaceName: destSpace?.name || 'the call' };
  for (const aside of privateAsides) for (const key of aside.members) tellLive(key, aside.id, payload);
  res.json({ recalled: privateAsides.length });
});

// Whoever leaves an aside returns to the space it was pulled from (the Lobby if that space is gone by now), and
// takes the aside's other member(s) with them the same way a pull does: a nudge on their live stream (aside-return),
// since leaving would otherwise be as one-sided as arriving used to be.
app.post('/api/asides/return', requireUser, (req, res) => {
  const me = currentUser(req);
  const mine = live.placeOf(me.key);
  const current = mine ? store.asideById(mine.space) : null;
  if (!current) return res.status(400).json({ error: `you are not in ${word('aside', { a: true })}` });
  const dest = (current.origin && store.spaceById(current.origin)) || store.spaceById(LOBBY);
  for (const key of current.members) if (key !== me.key) tellLive(key, current.id, { type: 'aside-return', spaceId: dest.id });
  res.json({ space: shownSpace(req, dest) });
});

// Stream API (OBS pages and the Studio app) ---------------------------------

app.get('/api/status', requireStream, async (req, res) => {
  const byKey = await whereEveryone();
  store.pruneAsides(byKey);
  res.json({
    ...branding(),
    users: store.users.map((u) => ({ ...publicUser(req, u, { link: false }), online: withoutCall(byKey.get(u.key)) })),
    spaces: store.spaces.map((r) => shownSpace(req, r)),
    asides: store.asides,
    activeSpace: activeSpaceId(byKey),
    ownerOnline: hasOnlineOwner(byKey),
    pages: modules.keyedPaths(), // every keyed path an enabled module claims, e.g. ["view"] (Coffee Pub Studio asks for this)
  });
});

// What a keyed page (public/keyed.html) needs to mount the module that claims its path: the surface's own entry
// file and enough of the module to draw its chrome. Stream access, same as the page itself.
app.get('/api/pages/:path', requireStream, (req, res) => {
  const claimed = modules.keyedFor(req.params.path);
  if (!claimed) return res.status(404).json({ error: 'no such page' });
  const { manifest, entry, runMode } = claimed;
  res.json({ page: { path: req.params.path, entry: manifest.surfaces.keyed.entry, module: { id: manifest.id, ...shownModule(manifest), version: manifest.version, runMode } } });
});

// Spaces: the Lobby (everyone) plus the spaces an owner curates. Signed-in
// users and stream key holders can read them; owners change them.
app.get('/api/spaces', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req)) return res.status(401).json({ error: 'sign in first' });
  res.json({ spaces: store.spaces.map((r) => shownSpace(req, r)) });
});
app.post('/api/spaces', requireOwner, (req, res) => {
  const { name, description, members, profile, link, linkIcon } = req.body || {};
  res.json({ space: store.addSpace({ name, description, members, profile, link, linkIcon, creator: currentUser(req).key }) });
});
app.post('/api/spaces/order', requireOwner, (req, res) => {
  res.json({ spaces: store.reorderSpaces((req.body || {}).order) });
});
// Set up's read. Owners and the admin get the whole record; a moderator of that space gets its id and the fields a
// moderator may change (MODERATOR_SPACE_FIELDS, the budget among them) as stored; anyone else is "owners only".
app.get('/api/spaces/:id', requireUser, (req, res) => {
  const space = store.spaceById(req.params.id);
  if (!space) return res.status(404).json({ error: `no such ${word('space')}` });
  if (isOwner(req)) return res.json({ space });
  if (!moderates(currentUser(req), space)) return res.status(403).json({ error: `${word('owner', { many: true })} only` });
  const theirs = { id: space.id };
  for (const k of MODERATOR_SPACE_FIELDS) if (k in space) theirs[k] = space[k];
  res.json({ space: theirs });
});
// Owners and the admin change anything; a member ticked as this space's moderator may send `phases` (the dates on
// the timeline, plan-one-bar.md step 1), `opensWith` and `defaultLayout` (Set up, step 4) and `budget` (the target,
// plan-budget-module.md, decision 5) and nothing else: any other field in a moderator's body is "owners only". The values go through store.updateSpace's rules, the same as
// an owner's. Whether the page may offer Set up comes from /api/me: hasOwnerRights, or
// user.spaces[<id>].permissions.moderator.
const MODERATOR_SPACE_FIELDS = ['phases', 'opensWith', 'defaultLayout', 'budget'];
app.patch('/api/spaces/:id', requireUser, (req, res) => {
  const body = req.body || {};
  if (!isOwner(req)) {
    const space = store.spaceById(req.params.id);
    if (!space) return res.status(404).json({ error: `no such ${word('space')}` });
    const onlyTheirs = Object.keys(body).every((k) => MODERATOR_SPACE_FIELDS.includes(k));
    if (!moderates(currentUser(req), space) || !onlyTheirs) return res.status(403).json({ error: `${word('owner', { many: true })} only` });
  }
  const space = store.updateSpace(req.params.id, body);
  liveAccessChanged(); // guests turned off, say: their live streams end now
  res.json({ space: answeredSpace(req, space) });
});
// The main phase's end moved later to cover `day` (YYYY-MM-DD), every later boundary shifted by the same number of
// days (public/phases.js coverMain; plan-one-bar.md step 1), for anyone who can write in a module that is on in this
// space (an owner always). 200 with the new `phases`; 204 when nothing moved (the day is covered already, is before
// the main phase, or there is no dated main phase).
app.post('/api/spaces/:id/phases/cover', (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'sign in first' });
  const space = store.spaceById(req.params.id);
  if (!space) return res.status(404).json({ error: `no such ${word('space')}` });
  const day = req.body?.day;
  if (!phaseRule.isDay(day)) return res.status(400).json({ error: 'Send the day to cover as YYYY-MM-DD.' });
  const perms = modulePerms(who, space.id);
  const mayWrite = (who.user && hasOwnerRights(who.user)) || modules.enabledAll().some(({ manifest, entry }) => manifest.scope.includes('space')
    && ModuleManager.onInSpace(entry, manifest, space.id) && moduleSpaceAccess(entry, who, space) && moduleCan(manifest, perms, 'write'));
  if (!mayWrite) return res.status(403).json({ error: `Only someone who can write in ${word('module', { a: true })} that is on in this ${word('space')} can move its dates.` });
  const phases = Array.isArray(store.templatePhases) ? store.templatePhases : [];
  const result = phaseRule.coverMain(phases, space.phases, day, { created: space.createdAt });
  if (!result.moved) return res.status(204).end();
  res.json({ phases: store.updateSpace(space.id, { phases: result.dates }).phases });
});
app.delete('/api/spaces/:id', requireOwner, (req, res) => {
  eraseSpace(currentEnvironment(), req.params.id); // everything kept for it, then the space; throws 500 if a step fails (server/space-erase.js)
  liveAccessChanged();
  res.json({ ok: true });
});
app.put('/api/spaces/:id/image', requireOwner, rawImage, checkStorageCap, (req, res) => {
  store.setSpaceImage(req.params.id, req.body, req.get('content-type'));
  res.json({ space: store.spaceById(req.params.id) });
});
app.delete('/api/spaces/:id/image', requireOwner, (req, res) => {
  store.removeSpaceImage(req.params.id);
  res.json({ space: store.spaceById(req.params.id) });
});

// A space's guest link: anyone actually in the space can turn it on, copy it,
// regenerate it or turn it off -- there's no account behind a guest to gate
// this on, unlike everything else admin-only above. create/regenerate
// (POST) mirror the personal-link routes above; DELETE turns it off.
function requireSpaceMember(req, res, next) {
  const space = store.spaceById(req.params.id);
  if (!space) return res.status(404).json({ error: `no such ${word('space')}` });
  if (!space.members.includes(currentUser(req).key) && !isOwner(req)) return res.status(403).json({ error: `you are not in that ${word('space')}` });
  next();
}
// Managing the link needs Can Invite for that space (owners always can) --
// being in the space alone no longer is enough.
function requireCanInvite(req, res, next) {
  if (!store.spacePermissions(currentUser(req).key, req.params.id).canInvite) return res.status(403).json({ error: `you can't invite people to this ${word('space')}` });
  next();
}
app.post('/api/spaces/:id/guest-link', requireUser, requireSpaceMember, requireCanInvite, (req, res) => {
  const guestToken = req.body?.regenerate ? store.regenerateGuestLink(req.params.id) : store.enableGuestLink(req.params.id);
  liveAccessChanged(); // a regenerated link's old token ends its live streams now
  res.json({ space: answeredSpace(req, store.spaceById(req.params.id)), guestUrl: `${baseUrl(req)}/guest/${guestToken}` });
});
app.delete('/api/spaces/:id/guest-link', requireUser, requireSpaceMember, requireCanInvite, (req, res) => {
  store.disableGuestLink(req.params.id);
  liveAccessChanged(); // its live streams end now
  res.json({ space: answeredSpace(req, store.spaceById(req.params.id)) });
});

// Admin API -------------------------------------------------------------------

app.get('/api/users', requireOwner, (req, res) => {
  res.json({ users: store.users.map((u) => publicUser(req, u)) });
});

app.get('/api/users/:key', requireOwner, (req, res) => {
  const user = store.userByKey(req.params.key);
  if (!user) return res.status(404).json({ error: 'no such user' });
  res.json({ user: publicUser(req, user) });
});

app.post('/api/users', requireOwner, (req, res) => {
  if (refuseOverMembers(res)) return;
  const { login, displayName, role, password, passwordless } = req.body || {};
  const user = store.addUser({ login, displayName, role, passwordHash: password ? auth.hashPassword(password) : null });
  if (passwordless) store.updateUser(user.key, { linkToken: randomToken() });
  res.status(201).json({ user: publicUser(req, store.userByKey(user.key)) });
});

app.patch('/api/users/:key', requireOwner, (req, res) => {
  const { login, displayName, role, password, player } = req.body || {};
  if (password !== undefined && store.userByKey(req.params.key)?.hostAdmin) {
    throw new StoreError('this account signs in through the host console; its password cannot be changed here');
  }
  const patch = {};
  if (login !== undefined) patch.login = login;
  if (displayName !== undefined) patch.displayName = displayName;
  if (role !== undefined) patch.role = role;
  if (password !== undefined) patch.passwordHash = password ? auth.hashPassword(password) : null;
  if (player !== undefined) patch.player = player;
  const self = currentUser(req);
  if (self.key === req.params.key && role !== undefined && role !== self.role) {
    return res.status(400).json({ error: 'you cannot demote yourself' });
  }
  const user = store.updateUser(req.params.key, patch);
  res.json({ user: publicUser(req, user) });
});

app.delete('/api/users/:key', requireOwner, (req, res) => {
  if (currentUser(req).key === req.params.key) return res.status(400).json({ error: 'you cannot delete yourself' });
  store.removeUser(req.params.key);
  attention.forgetPerson(req.params.key);
  res.json({ ok: true });
});

// Personal link: create or regenerate (POST), turn off (DELETE).
app.post('/api/users/:key/link', requireOwner, (req, res) => {
  const user = store.updateUser(req.params.key, { linkToken: randomToken() });
  res.json({ user: publicUser(req, user) });
});
app.delete('/api/users/:key/link', requireOwner, (req, res) => {
  const user = store.updateUser(req.params.key, { linkToken: null });
  res.json({ user: publicUser(req, user) });
});

app.put('/api/users/:key/images/:slot', requireOwner, rawImage, checkStorageCap, (req, res) => {
  store.setImage(req.params.key, LEGACY_SLOTS[req.params.slot] || req.params.slot, req.body, req.get('content-type'));
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.delete('/api/users/:key/images/:slot', requireOwner, (req, res) => {
  const slot = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'unknown image slot' });
  store.removeImage(req.params.key, slot);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});

// A space's own override for one of that same person's image slots --
// stands in for their default only inside that one space (someone in two
// campaigns with two different characters). Admin-only, same as the
// defaults themselves.
// Per-space settings for one member: which pictures apply there, and what
// they're allowed to do (Permissions on their profile's Spaces tab).
app.patch('/api/users/:key/spaces/:spaceId', requireOwner, (req, res) => {
  store.setSpacePrefs(req.params.key, req.params.spaceId, req.body || {});
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.delete('/api/spaces/:id/members/:key', requireOwner, (req, res) => {
  store.removeMember(req.params.id, req.params.key);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.put('/api/users/:key/spaces/:spaceId/images/:slot', requireOwner, rawImage, checkStorageCap, (req, res) => {
  store.setImage(req.params.key, LEGACY_SLOTS[req.params.slot] || req.params.slot, req.body, req.get('content-type'), req.params.spaceId);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.delete('/api/users/:key/spaces/:spaceId/images/:slot', requireOwner, (req, res) => {
  const slot = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'unknown image slot' });
  store.removeImage(req.params.key, slot, req.params.spaceId);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});

// Admin, or a member the admin gave Can Kick / Can Mute for the space both of them are in right now (never against an
// admin) -- see Permissions on a user's profile, Spaces tab. Where each is, and whether the target is on the call, comes
// from the live register (server/live.js; a guest is there by the id on their pass, their identity on the call too).
// Answers { space, onCall } or { error: [status, sentence] }.
function canModerate(req, targetKey, permission) {
  const actor = currentUser(req);
  const place = live.placeOf(targetKey);
  if (!place) return { error: [404, `they are not in ${word('space', { a: true })} right now`] };
  const { space, onCall } = place;
  if (hasOwnerRights(actor)) return { space, onCall };
  const target = store.userByKey(targetKey);
  if (!target || hasOwnerRights(target) || target.key === actor.key) return { error: [403, 'not allowed'] };
  if (live.placeOf(actor.key)?.space !== space) return { error: [403, `you are not in their ${word('space')}`] };
  if (!store.spacePermissions(actor.key, space)[permission]) return { error: [403, 'not allowed'] };
  return { space, onCall };
}

// A kick takes the person out of the call and the space, both (plan-realtime-optional-livekit.md, decided 5): their live
// streams there get `removed { reason: 'kicked' }` and end, they leave the register at once (no grace), and the call
// service drops them from the call when the register has them on it (only then is it asked). With no call service, or
// it not answering, the space part still happens.
app.post('/api/users/:key/kick', requireUser, async (req, res) => {
  const key = req.params.key;
  const { space, onCall, error } = canModerate(req, key, 'canKick');
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (onCall && callService) {
    await callService.removeParticipant(callName(space), key).catch((err) => console.error(`Removing ${key} from the call failed: ${err.message}`));
  }
  tellLive(key, space, { type: 'removed', reason: 'kicked' });
  live.leave(key, space);
  tellLivePresence([space]);
  res.json({ ok: true });
});

// Muting is the call's: it needs them on the call (the register's word), then asks the call service.
app.post('/api/users/:key/mute', requireUser, async (req, res) => {
  const { space, onCall, error } = canModerate(req, req.params.key, 'canMute');
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (!callService) return res.status(503).json({ error: NO_CALL_SERVICE });
  if (!onCall) return res.status(404).json({ error: 'they are not in a call' });
  const call = callName(space);
  try {
    const info = await callService.getParticipant(call, req.params.key);
    const mic = (info.tracks || []).find((t) => t.source === 2);
    if (!mic) return res.status(404).json({ error: 'no microphone track' });
    await callService.mutePublishedTrack(call, req.params.key, mic.sid, req.body?.muted !== false);
    res.json({ ok: true });
  } catch (err) {
    console.error(`Muting ${req.params.key} on the call failed: ${err.message}`);
    res.status(502).json({ error: `Could not ${req.body?.muted === false ? 'unmute' : 'mute'} them. Voice and video are not reachable.` });
  }
});

// Settings > Roles: the permission list and every role's grid of on/off.
// Modules (Manage > Modules): upload a zip, approve what it asks for, turn it
// on, roll back, uninstall. See docs/MODULES.md.
// What a person reads a module called and sees it as in this environment (plan-environment-templates.md, "Module display
// names and icons"): its display name and icon (the owner's, else the template's), else the manifest's own. For an
// installed manifest, a bundled one or a built-in module alike ({ id, name, icon }).
function shownModule(m) {
  const d = store.moduleDisplay(m.id);
  return { name: d.name || m.name, icon: d.icon || m.icon, content: m.content === 'flush' ? 'flush' : 'padded' };
}
// What a kind of object is called: its manifest `name`, where `{name}` stands for the module's shown name (this
// environment's display name for it, else the manifest's own), so the Planner's "{name}" reads "Itinerary" where it
// is shown as Itinerary. The words' placeholders ({space} and the rest) were filled with the manifest already.
const kindNameOf = (manifest, name) => String(name).replace(/\{name\}/g, () => shownModule(manifest).name);
// A built-in module as Manage shows it: its sentences in this environment's words ({space} and the like, server/words.js),
// and whether it is on, for one with an environment-wide switch.
function builtinView(b) {
  const display = store.moduleDisplay(b.id);
  const view = { ...b, displayName: display.name, displayIcon: display.icon, ownDisplayName: display.ownName, ownDisplayIcon: display.ownIcon, templateDisplayName: display.templateName, templateDisplayIcon: display.templateIcon };
  for (const k of ['description', 'permissions', 'needs', 'turnOff', 'turnOn']) if (typeof view[k] === 'string') view[k] = fillWords(view[k]);
  if (b.setting) view.enabled = store.settings[b.setting] !== false;
  // The conference with no call service: off, its switch can't be turned on, and the card says why (`unavailable`).
  if (b.id === 'conference' && !HAS_CALL_SERVICE) {
    view.enabled = false;
    view.unavailable = NO_CALL_SERVICE_CARD;
  }
  return view;
}
// Modules that ship with this deployment (the modules/ folder), and where each stands:
// not installed, installed and current, or installed with a newer version available. Installing or
// updating one builds its zip on the server, so nothing has to be uploaded; it then goes through the
// same approval as any zip (an update that asks for something new waits for the admin).
function bundledList() {
  const installed = new Map(modules.list().map((m) => [m.id, m.version]));
  const words = store.resolvedWords();
  return bundledModules(BUNDLED_DIR).map((m) => {
    const have = installed.get(m.id) || null;
    const display = store.moduleDisplay(m.id);
    return {
      id: m.id, name: m.name, icon: m.icon, description: fillManifest(m, words).description, version: m.version, installed: have,
      displayName: display.name, displayIcon: display.icon, ownDisplayName: display.ownName, ownDisplayIcon: display.ownIcon, templateDisplayName: display.templateName, templateDisplayIcon: display.templateIcon,
      requires: m.requires || [], // what it needs installed and on (Maps needs Places), so the list can say so before Install
      update: Boolean(have) && compareVersions(m.version, have) > 0 && !modules.view(m.id)?.versions.includes(m.version),
      notInPlan: !moduleAllowedByPlan(m.id), // plan-environments.md, "Phase 3": the Available list marks these "Not in your plan"
    };
  });
}
// Calendar sharing (plan-space-calendars.md, section 4): a module takes part when it offers a dated kind to the addresses
// ("feed": true) or asks for the `external` or `busy` hook, in its running version or in a newer one that ships here
// and waits to be updated. `sharingReasons` names each switch it takes part in -- `calendarFeeds` and
// `publishedCalendar` with a feed kind, `otherCalendars` with either hook -- as null when it can be used, else
// { hooks: [the hooks it waits on], reason: one sentence }. Nothing here names a module. Only owners and admins read it
// (GET /api/modules is owner-only) and they can approve, so the reason tells them to.
const SHARING_HOOKS = ['external', 'busy'];
function sharingOf(view, bundledById = new Map(bundledModules(BUNDLED_DIR).map((b) => [b.id, b]))) {
  const feed = (view.refs?.produces || []).some((p) => p.feed && p.dated);
  const running = SHARING_HOOKS.filter((h) => view.hooks?.[h]);
  const bundled = view.source === 'bundled' ? bundledById.get(view.id) : null;
  const coming = bundled && compareVersions(bundled.version, view.version) > 0 && !(view.versions || []).includes(bundled.version) ? SHARING_HOOKS.filter((h) => bundled.hooks?.[h] && !running.includes(h)) : [];
  if (!feed && !running.length && !coming.length) return { sharing: false, sharingReasons: null };
  const reasons = {};
  if (feed) Object.assign(reasons, { calendarFeeds: null, publishedCalendar: null });
  if (running.length || coming.length) {
    const waits = [...running.filter((h) => (view.pending?.hooks || []).includes(h)), ...coming];
    reasons.otherCalendars = waits.length ? { hooks: waits, reason: `Approve ${view.displayName || view.name}'s update in Manage > ${word('module', { many: true, cap: true })} first.` } : null;
  }
  return { sharing: true, sharingReasons: reasons };
}
app.get('/api/modules', requireOwner, (_req, res) => {
  const bundledById = new Map(bundledModules(BUNDLED_DIR).map((b) => [b.id, b]));
  res.json({ modules: modules.list().map((m) => ({ ...m, ...sharingOf(m, bundledById), ...(m.library ? { libraryFiles: vault.summary(m.id).files, libraryBytes: vault.summary(m.id).bytes } : {}) })), builtin: BUILTIN_MODULES.map((b) => builtinView(b)), bundled: bundledList(), limits: { zipBytes: MODULE_LIMITS.zipBytes } });
});
app.post('/api/modules/bundled/:id/install', requireOwner, async (req, res) => {
  const id = req.params.id;
  const bundled = bundledModules(BUNDLED_DIR).find((m) => m.id === id);
  if (!bundled) return res.status(404).json({ error: `that ${word('module')} does not ship with this deployment` });
  if (refuseModuleNotInPlan(res, id, bundled.name)) return;
  const { zip } = buildModule(path.join(BUNDLED_DIR, id));
  const installed = await modules.install(zip, { source: 'bundled' });
  afterModulesChanged(currentEnvironment());
  moduleEvents.emit('modules');
  res.status(201).json({ module: installed });
});
// Uploading a module's own zip, and choosing to run one in the page rather than sandboxed, are the host's own
// trust decision (plan-environments.md, "Phase 2": what Manage hides from an owner) -- a hosted environment's owner
// may still install and enable any module its plan allows, but never bring in code the host itself hasn't
// vetted. The host admin's own cross sign-in is exempt, same as a self-hosted install (no BASE_DOMAIN at all).
function requireHostTrust(req, res, next) {
  if (BASE_DOMAIN && !currentUser(req)?.hostAdmin) return res.status(403).json({ error: `only the host may add or run unvetted ${word('module', { many: true })} here` });
  next();
}
app.post('/api/modules', requireOwner, requireHostTrust, rawZip, async (req, res) => {
  let installed;
  try {
    installed = await modules.install(req.body);
  } catch (err) {
    if (err instanceof StoreError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  // The zip's own id is only known once it is unpacked -- refused after the fact, undoing the install, rather
  // than duplicating modules.js's own manifest parsing here just to check the plan first (plan-environments.md,
  // "Phase 3"). keepData: false since this was never really installed from the plan's point of view.
  if (!moduleAllowedByPlan(installed.id)) {
    modules.uninstall(installed.id, { keepData: false });
    return res.status(403).json({ error: `This ${word('environment')}'s plan does not include ${installed.displayName || installed.name}.` });
  }
  afterModulesChanged(currentEnvironment());
  moduleEvents.emit('modules');
  res.status(201).json({ module: installed });
});
// displayName and displayIcon: what this environment calls the module and shows it as (null, or '' for the name, goes
// back to the template's or the module's own). A built-in module (Conference, Chat) takes only these two here. Both
// are checked before anything else is changed, and saved only once the rest of the change is accepted.
app.patch('/api/modules/:id', requireOwner, (req, res) => {
  const { displayName, displayIcon, ...rest } = req.body || {};
  const display = store.checkModuleDisplay(req.params.id, { displayName, displayIcon });
  const builtin = BUILTIN_MODULES.find((b) => b.id === req.params.id);
  if (builtin) {
    if (Object.keys(rest).length) return res.status(400).json({ error: `${shownModule(builtin).name} is built in, so only its display name and icon can be changed here.` });
    store.applyModuleDisplay(builtin.id, display);
    return res.json({ module: builtinView(builtin) });
  }
  if (rest.runMode === 'page' && BASE_DOMAIN && !currentUser(req)?.hostAdmin) return res.status(403).json({ error: `only the host may choose to run ${word('module', { a: true })} in the page` });
  if (rest.enabled === true) {
    const current = modules.list().find((m) => m.id === req.params.id);
    if (current && refuseModuleNotInPlan(res, current.id, current.name)) return;
  }
  // `allSpaces` and `spaces` are accepted and ignored (an enabled module is on in every space).
  if (rest.enabled === false) {
    // Turned off, with the modules that need it: a Clear waiting for its Undo in any of them is finished first, while the
    // module is still on, so what other modules keep of its objects (their dated copies) goes as at the end of its time.
    // Not when the update will refuse it (others need it and the caller did not say `force`).
    const current = modules.list().find((m) => m.id === req.params.id);
    const needing = current?.enabled ? modules.dependentsOf(req.params.id) : [];
    if (current?.enabled && (!needing.length || rest.force === true)) for (const id of [req.params.id, ...needing]) moduleHolds.expireModule(id);
  }
  const wasOn = rest.enabled === false && modules.list().find((m) => m.id === req.params.id)?.enabled;
  if (Object.keys(rest).length) modules.update(req.params.id, rest, { spaceExists: (id) => !!store.spaceById(id) });
  else modules.get(req.params.id); // 404 for a module that is not installed
  // A library module turned off ends its share links for good (turned on again, its files return but no old link does).
  if (wasOn && !modules.enabled(req.params.id)) vault.dropSharesOf(req.params.id);
  store.applyModuleDisplay(req.params.id, display);
  if (Object.keys(rest).length) moduleEvents.emit('modules');
  res.json({ module: modules.view(req.params.id) });
});
app.post('/api/modules/:id/rollback', requireOwner, (req, res) => {
  const rolled = modules.rollback(req.params.id, String(req.body?.version || ''));
  // The stored keys follow the version now running (storage.renamed): a rename it does not declare is undone.
  syncStoredKeys(currentEnvironment(), req.params.id);
  moduleEvents.emit('modules');
  res.json({ module: modules.view(req.params.id) || rolled });
});
app.delete('/api/modules/:id', requireOwner, (req, res) => {
  modules.get(req.params.id); // 404 for a module that is not installed, before anything goes
  // A library module's uploads still arriving or being checked are stopped and never kept, so nothing comes back after
  // it goes; its files go with its data: their bytes under VAULT_DIR, and what the server keeps of their records.
  stopLibraryUploads(req.params.id);
  moduleHolds.expireModule(req.params.id); // a Clear waiting for its Undo is finished now
  // How many files the module holds: gone with its data, or kept (they stay on the disk and still count against storage).
  const libraryFiles = modules.view(req.params.id)?.library ? vault.summary(req.params.id).files : 0;
  if (req.query.keepData === '0') vault.forgetModule(req.params.id);
  else vault.dropSharesOf(req.params.id); // kept files, but their links end for good
  modules.uninstall(req.params.id, { keepData: req.query.keepData !== '0' });
  moduleData.forget(req.params.id);
  if (req.query.keepData === '0') {
    moduleHooks.forget(req.params.id);
    moduleHooks.dropModule(req.params.id);
    moduleLinks.dropModule(req.params.id);
    moduleBus.dropModule(req.params.id);
    moduleSettings.forgetModule(req.params.id);
    attention.forgetModule(req.params.id);
    facts.forgetModule(req.params.id);
    store.applyModuleDisplay(req.params.id, { name: null, icon: null }); // its display name and icon go with its data
  }
  moduleEvents.emit('modules');
  res.json({ ok: true, ...(libraryFiles ? (req.query.keepData === '0' ? { filesRemoved: libraryFiles } : { filesKept: libraryFiles }) : {}) });
});

// --- module runtime -------------------------------------------------------
// What an installed, enabled module can do once it is running: be served, list
// where it shows up, and read and write its own data. The page hosting a
// module's frame makes these calls on the frame's behalf (see
// public/module-host.js); the frame itself never talks to the server.

// Who is asking: a signed-in user, a guest carrying a space's guest token, or -- carrying the access key and no
// session -- a keyed viewer: a module's own keyed page (see moduleAccess below), never a person, so it reads
// only, and only a module with a keyed surface.
function moduleViewer(req) {
  const user = currentUser(req);
  if (user) return { user, guestSpace: null };
  const token = req.query.guest;
  const guestSpace = typeof token === 'string' ? store.spaceByGuestToken(token) : null;
  if (guestSpace) return { user: null, guestSpace };
  return hasStreamKey(req) ? { user: null, guestSpace: null, keyed: true } : null;
}

// The sentence for a module that can't be in the Lobby (plan-modules, "the Lobby is for being together"): its display
// name, and the Lobby's own name as this environment has it ("Home base" under the travel template).
function lobbyRefusal(manifest) {
  return `${modules.shownName(manifest)} can't be turned on in ${store.spaceById(LOBBY)?.name || 'the Lobby'}, which is kept for chat, the call and a few ${word('module', { many: true })} made for it.`;
}
const refusedInLobby = (manifest, spaceId) => spaceId === LOBBY && manifest && !ModuleManager.lobbyAllowed(manifest);

// Whether someone may see a module in a space at all: on for that space (modules.isOnIn, the one check, which keeps
// the Lobby for the modules that declare it), and in it.
function moduleSpaceAccess(entry, who, space) {
  if (!modules.isOnIn(entry.id, space.id)) return false;
  if (who.user) return hasOwnerRights(who.user) || space.members.includes(who.user.key);
  return Boolean(who.guestSpace) && who.guestSpace.id === space.id; // a keyed viewer (the access key) is in no space
}

// A module's scope as a request names it (?scope=): 'environment' (also when none is named), 'space', 'spaces' (a
// module's page reading across the viewer's spaces) or 'person'. Anything else -- the old 'room' and 'server' from a
// page open across the upgrade, say -- is refused rather than read as the environment, so nothing a page meant for a
// space lands in the environment's data. Answers the scope, or null after sending the 400.
const SCOPE_NAMES = ['environment', 'space', 'spaces', 'person'];
const BAD_SCOPE = 'scope must be environment, space, spaces or person';
function askedScope(value, res, allowed = SCOPE_NAMES) {
  const scope = value === undefined || value === '' ? 'environment' : value;
  if (!SCOPE_NAMES.includes(scope)) return void res.status(400).json({ error: BAD_SCOPE });
  if (!allowed.includes(scope)) return void res.status(400).json({ error: `scope must be ${allowed.join(', ').replace(/, ([^,]*)$/, ' or $1')} here` });
  return scope;
}
// Who a notification goes to: everyone in the space, everyone in the environment, or one person by key. Anything
// else (the old 'room' and 'server') would be kept and reach nobody, so it is refused.
function refuseNotifyTo(to, res) {
  if (to === undefined || to === null || to === '' || to === 'space' || to === 'environment') return false;
  if (typeof to === 'string' && store.userByKey(to)) return false;
  res.status(400).json({ error: 'to must be space, environment or a person\'s key' });
  return true;
}
// Where a scope's data, uploads and events are kept for a module: 'environment', 'space:<id>' or 'person:<key>'.
const scopeKeyOf = (scope, { spaceId = null, userKey = null } = {}) => (scope === 'space' ? `space:${spaceId}` : scope === 'person' ? `person:${userKey}` : 'environment');

function modulePerms(who, spaceId) {
  if (who.keyed) return {};
  return who.user ? store.spacePermissions(who.user.key, spaceId) : store.roleSet('guest');
}

function moduleCan(manifest, perms, need) {
  const guard = need && manifest.access?.[need];
  return !guard || Boolean(perms[`module.${manifest.id}.${guard}`]);
}

// Resolve the module, scope and permission for a data call. Sends the error
// itself and returns null when the caller may not.
function moduleAccess(req, res, need) {
  const found = modules.enabled(req.params.id);
  if (!found) return void res.status(404).json({ error: `no such ${word('module')}` });
  const { manifest, entry } = found;
  const who = moduleViewer(req);
  if (!who) return void res.status(401).json({ error: 'sign in first' });
  // The access key stands in for a session only on a module's own keyed page, and only to read it: the key is
  // the permission, so there is no space, person or fine-grained access.read to check beyond that.
  if (who.keyed) {
    if (need !== 'read' || !manifest.surfaces.keyed) return void res.status(403).json({ error: `the access key only reads ${word('module', { a: true })} with a keyed page` });
    if (shutFromGuests(who, manifest, null)) return void res.status(403).json({ error: guestsShutRefusal(manifest) });
    return { manifest, entry, scope: 'environment', spaceId: null, scopeKey: 'environment', who, perms: {}, by: 'keyed', hide: hiddenFor(who, manifest, null) };
  }
  const scope = askedScope(req.query.scope, res, ['environment', 'space', 'person']);
  if (!scope) return;
  if (!manifest.scope.includes(scope)) return void res.status(400).json({ error: `this ${word('module')} has no ${scope} scope` });
  let spaceId = null;
  if (scope === 'person') {
    // A person's own data (their profile's): only they can reach it, not even an administrator, because the place it is kept
    // is named by who is asking.
    if (!who.user) return void res.status(403).json({ error: `${word('guest', { many: true })} have no personal data` });
  } else if (scope === 'space') {
    const space = store.spaceById(String(req.query.space || ''));
    if (!space) return void res.status(404).json({ error: `no such ${word('space')}` });
    if (refusedInLobby(manifest, space.id)) return void res.status(404).json({ error: lobbyRefusal(manifest) });
    if (!moduleSpaceAccess(entry, who, space)) return void res.status(403).json({ error: `this ${word('module')} is not available in that ${word('space')} for you` });
    spaceId = space.id;
  } else if (!who.user) {
    return void res.status(403).json({ error: `${word('guest', { many: true })} can only use ${word('module', { a: true })} in ${word('space', { a: true })}` });
  }
  const perms = modulePerms(who, spaceId);
  // `own`: writing the module's data or uploads, which in a person's own data (scope person) takes the module's
  // access.personWrite where it names one, else access.write. Everything else that needs `write` (the AI, link previews,
  // notify, schedule) takes access.write in every scope.
  const guard = need === 'own' ? (scope === 'person' && manifest.access?.personWrite ? 'personWrite' : 'write') : need;
  if (!moduleCan(manifest, perms, guard)) return void res.status(403).json({ error: `your role can't do that in this ${word('module')}` });
  if (shutFromGuests(who, manifest, spaceId)) return void res.status(403).json({ error: guestsShutRefusal(manifest) });
  return { manifest, entry, scope, spaceId, scopeKey: scopeKeyOf(scope, { spaceId, userKey: who.user?.key }), who, perms, by: who.user?.key || 'guest', hide: hiddenFor(who, manifest, spaceId) };
}

// The fields of a module's stored values this viewer may not receive here (the module's guards.hidden,
// server/module-guards.js): everyone who is not signed in (a space's guests, the access key), unless an owner opened them
// in that space (its `guestsSeeHidden`). [] for anyone else.
function hiddenFor(who, manifest, spaceId) {
  const fields = manifest.guards?.hidden;
  if (!fields || !fields.length || who.user) return [];
  return spaceId && store.spaceById(spaceId)?.guestsSeeHidden === true ? [] : fields;
}
// Whether this viewer gets none of the module's data at all: guards whose hidden fields can't be read (guards.shut,
// server/module-guards.js unreadableGuards) keep everything from whoever hiddenFor would keep those fields from.
function shutFromGuests(who, manifest, spaceId) {
  if (!manifest.guards?.shut || who.user) return false;
  return !(spaceId && store.spaceById(spaceId)?.guestsSeeHidden === true);
}
const guestsShutRefusal = (manifest) => `${modules.shownName(manifest)}'s rules can't be read, so ${word('guest', { many: true })} can't see what it holds. Ask the ${word('admin')} to update it.`;
const hideItem = (item, fields) => (item && fields && fields.length ? { ...item, value: moduleGuards.hide(item.value, fields) } : item);
// Who is writing, as server/module-guards.js asks: their key (null for a guest), their name, whether they have the
// environment's owner rights, the module's permissions they hold where the write is, and file(id): who added that file
// to the module in the same place ({ by }), or null when it is not there.
function guardWho(ctx) {
  const user = ctx.who.user;
  return {
    key: user ? user.key : null,
    name: user ? user.displayName : '',
    owner: Boolean(user) && hasOwnerRights(user),
    can: (p) => Boolean(ctx.perms[`module.${ctx.manifest.id}.${p}`]),
    file: (id) => (ctx.manifest.uploads ? moduleUploads.meta(ctx.manifest.id, ctx.scopeKey, id) : null),
  };
}
// The files removed objects named (their rule's `file`; `removed` is [{ key, value }], each as it was stored) go with them,
// unless a value stored here still names the same file in any field (moduleGuards.namesFile). Called after the write,
// so a photo whose file was swapped passes its old value here and its old file goes once nothing names it.
function removeFilesOf(ctx, removed) {
  const guards = ctx.manifest.guards;
  if (!ctx.manifest.uploads || !guards?.keys?.some((r) => r.file)) return;
  const ids = new Set(removed.map(({ key, value }) => moduleGuards.fileOf(guards, key, value)).filter(Boolean));
  if (!ids.size) return;
  const stored = moduleData.list(ctx.manifest.id, ctx.scopeKey).map((item) => item.value);
  for (const id of [...ids]) if (moduleGuards.namesFile(stored, id)) ids.delete(id);
  for (const id of ids) {
    try { moduleUploads.remove(ctx.manifest.id, ctx.scopeKey, id); } catch (err) { console.error(`A removed object's file could not be removed: ${err.message}`); }
  }
}
// The upload ids a module's stored values name (their rule's `file`), for a Clear's hold: those files wait with it.
function filesNamedBy(manifest, items) {
  const guards = manifest.guards;
  if (!manifest.uploads || !guards?.keys?.some((r) => r.file)) return [];
  return [...new Set(items.map(({ key, value }) => moduleGuards.fileOf(guards, key, value)).filter(Boolean))];
}
// A Clear whose Undo time is over (server/module-holds.js, onExpire): what it waited to do now happens. Other modules hear
// that each of its objects went (their dated copies, the pointers that hold them: objectSync.afterWrite), except for a
// key that holds something again (that object is the one they follow now), and the files its objects named go, unless a
// value stored there names one now.
function finishHold(hold) {
  for (const item of hold.items) {
    try {
      if (moduleData.get(hold.module, hold.scopeKey, item.key)) continue;
      objectSync.afterWrite({ module: hold.module, scopeKey: hold.scopeKey, key: item.key, before: item.value, after: null, by: hold.by, tz: hold.tz });
    } catch (err) {
      console.error(`A cleared object's copies could not be updated: ${err.message}`);
    }
  }
  if (!hold.files.length) return;
  const stored = moduleData.list(hold.module, hold.scopeKey).map((item) => item.value);
  for (const fid of hold.files) {
    if (moduleGuards.namesFile(stored, fid)) continue;
    try { moduleUploads.remove(hold.module, hold.scopeKey, fid); } catch (err) { console.error(`A cleared object's file could not be removed: ${err.message}`); }
  }
}
// What Clear refuses for a library module (the Vault): its files are not module data, so it has nothing to clear.
const libraryClearRefusal = (manifest) => `${modules.shownName(manifest)} keeps files, not ${word('module')} data, so Clear has nothing to remove.`;
// Whether this viewer may clear everything the module holds in a space (DELETE .../data): its write permission, and the
// guards' `clear` when it has one. For the canvas's Clear, which is offered only where it removes something: never for a
// library module, not while the module holds no objects in the space (its bookkeeping keys aside), and not while an
// earlier Clear there can still be undone (a second one is refused). Worked out when for-space is read: a page reads it
// again after a 'changes' event.
function mayClearHere(manifest, who, perms, spaceId) {
  if (manifest.library || !moduleCan(manifest, perms, 'write')) return false;
  if (!moduleGuards.mayClear(manifest.guards, guardWho({ who, perms, manifest }))) return false;
  try {
    const scopeKey = scopeKeyOf('space', { spaceId });
    return !moduleHolds.peek(manifest.id, scopeKey) && moduleData.list(manifest.id, scopeKey).some((item) => !isBookkeeping(item.key));
  } catch { return false; }
}
// The guards a data write here is held to. In a person's own data, which only they reach, only `exclusive` and the module's
// own keys hold (checkPut's `personal`), and a delete or a clear is theirs.
const guardsAt = (ctx) => ctx.manifest.guards;
const personalAt = (ctx) => ctx.scope === 'person';
const storedValue = (ctx) => (key) => {
  try { return moduleData.get(ctx.manifest.id, ctx.scopeKey, key)?.value ?? null; } catch { return null; }
};

// --- attention (documentation/plans/plan-space-status-strip.md, "Attention, the contract") ---------------------
// What needs this person's action in a space, as each module last reported it (server/attention.js): kept per space,
// person and module in DATA_DIR/attention.json. A module reports its own count (PUT, which needs `write` in that module
// here; count 0 clears it) and the strip reads the sum (GET). It is per person, so a guest, who has no key, has none.
function attentionFor(req, res) {
  const who = moduleViewer(req);
  if (!who || who.keyed) return void res.status(401).json({ error: 'Sign in first.' });
  if (!who.user) return void res.status(403).json({ error: `${word('guest', { many: true, cap: true })} have no personal list of what needs action.` });
  const space = store.spaceById(req.params.id);
  if (!space) return void res.status(404).json({ error: `There is no such ${word('space')}.` });
  if (!(hasOwnerRights(who.user) || space.members.includes(who.user.key))) return void res.status(403).json({ error: `You are not in that ${word('space')}.` });
  return { who, space, perms: modulePerms(who, space.id) };
}
// The module in this space for this person, or null: on here, in a space-scope module, and not kept out of the Lobby.
function attentionModule(id, ctx) {
  const found = modules.enabled(id);
  if (!found || !found.manifest.scope.includes('space') || refusedInLobby(found.manifest, ctx.space.id)) return null;
  return moduleSpaceAccess(found.entry, ctx.who, ctx.space) ? found : null;
}
app.get('/api/spaces/:id/attention', (req, res) => {
  const ctx = attentionFor(req, res);
  if (!ctx) return;
  const out = [];
  for (const r of attention.list(ctx.space.id, ctx.who.user.key)) {
    const found = attentionModule(r.module, ctx);
    if (!found || !moduleCan(found.manifest, ctx.perms, 'read')) continue;
    out.push({ module: r.module, name: shownModule(found.manifest).name || found.manifest.name, count: r.count, label: r.label, items: r.items, at: r.at });
  }
  res.json({ modules: out, total: out.reduce((sum, m) => sum + m.count, 0) });
});
app.put('/api/spaces/:id/attention/:module', (req, res) => {
  const ctx = attentionFor(req, res);
  if (!ctx) return;
  const found = modules.enabled(req.params.module);
  if (!found) return res.status(404).json({ error: `There is no such ${word('module')}.` });
  if (!attentionModule(req.params.module, ctx)) return res.status(403).json({ error: `That ${word('module')} is not available here for you.` });
  if (!moduleCan(found.manifest, ctx.perms, 'write')) return res.status(403).json({ error: `Your role can't do that in this ${word('module')}.` });
  const { report, error } = cleanAttention(req.body);
  if (error) return res.status(400).json({ error });
  attention.set(ctx.space.id, ctx.who.user.key, found.manifest.id, report);
  res.json({ ok: true });
});
app.delete('/api/spaces/:id/attention/:module', (req, res) => {
  const ctx = attentionFor(req, res);
  if (!ctx) return;
  const found = modules.enabled(req.params.module);
  if (!found) return res.status(404).json({ error: `There is no such ${word('module')}.` });
  if (!attentionModule(req.params.module, ctx)) return res.status(403).json({ error: `That ${word('module')} is not available here for you.` });
  if (!moduleCan(found.manifest, ctx.perms, 'write')) return res.status(403).json({ error: `Your role can't do that in this ${word('module')}.` });
  attention.clear(ctx.space.id, ctx.who.user.key, found.manifest.id);
  res.json({ ok: true });
});

// --- facts (documentation/plans/plan-space-story-strip.md, "The contract", step 4) ------------------------------
// How a space stands, as each module last reported it (server/facts.js): kept per space and module, never per person
// or who sent it, in DATA_DIR/facts.json. A module reports its own facts (PUT, which needs `write` in that module here;
// an empty list clears them) and the status strip reads them (GET), only from the modules this person may read here.
// Guests get no status strip, so they are refused, as attention refuses them.
function factsFor(req, res) {
  const who = moduleViewer(req);
  if (!who || who.keyed) return void res.status(401).json({ error: 'Sign in first.' });
  if (!who.user) return void res.status(403).json({ error: `${word('guest', { many: true, cap: true })} do not see the status line.` });
  const space = store.spaceById(req.params.id);
  if (!space) return void res.status(404).json({ error: `There is no such ${word('space')}.` });
  if (!(hasOwnerRights(who.user) || space.members.includes(who.user.key))) return void res.status(403).json({ error: `You are not in that ${word('space')}.` });
  return { who, space, perms: modulePerms(who, space.id) };
}
app.get('/api/spaces/:id/facts', (req, res) => {
  const ctx = factsFor(req, res);
  if (!ctx) return;
  const out = [];
  for (const r of facts.list(ctx.space.id)) {
    const found = attentionModule(r.module, ctx);
    if (!found || !moduleCan(found.manifest, ctx.perms, 'read')) continue;
    out.push({ module: r.module, name: shownModule(found.manifest).name || found.manifest.name, facts: r.facts, at: r.at });
  }
  res.json({ modules: out });
});
// The module named, on here, for someone who may write in it, or a refusal sent.
function factsWriter(req, res, ctx) {
  const found = modules.enabled(req.params.module);
  if (!found) return void res.status(404).json({ error: `There is no such ${word('module')}.` });
  if (!attentionModule(req.params.module, ctx)) return void res.status(403).json({ error: `That ${word('module')} is not available here for you.` });
  if (!moduleCan(found.manifest, ctx.perms, 'write')) return void res.status(403).json({ error: `Your role can't do that in this ${word('module')}.` });
  return found;
}
app.put('/api/spaces/:id/facts/:module', (req, res) => {
  const ctx = factsFor(req, res);
  if (!ctx) return;
  const found = factsWriter(req, res, ctx);
  if (!found) return;
  const { facts: list, error } = cleanFacts(req.body);
  if (error) return res.status(400).json({ error });
  facts.set(ctx.space.id, found.manifest.id, list);
  res.json({ ok: true });
});
app.delete('/api/spaces/:id/facts/:module', (req, res) => {
  const ctx = factsFor(req, res);
  if (!ctx) return;
  const found = factsWriter(req, res, ctx);
  if (!found) return;
  facts.clear(ctx.space.id, found.manifest.id);
  res.json({ ok: true });
});

// --- saved layouts ------------------------------------------------------------------------------
// Named arrangements of a space's canvas (documentation/plans/plan-saved-layouts.md, step 1; server/layouts.js):
// each person's own, and the space's shared ones. Any signed-in person in the space keeps their own; owners, the
// admin and the space's moderators keep the shared ones, and any of them may change or delete any shared layout;
// a guest (the space's guest link) reads the shared ones only. Only a space has layouts: an aside's id answers 404.
function layoutSpaceFor(req, res) {
  const who = moduleViewer(req);
  if (!who || who.keyed) return void res.status(401).json({ error: 'Sign in first.' });
  const space = store.spaceById(req.params.id);
  if (!space) return void res.status(404).json({ error: `There is no such ${word('space')}.` });
  const allowed = who.user ? hasOwnerRights(who.user) || space.members.includes(who.user.key) : who.guestSpace.id === space.id;
  if (!allowed) return void res.status(403).json({ error: `You are not in that ${word('space')}.` });
  const canShare = Boolean(who.user) && (hasOwnerRights(who.user) || Boolean(store.spaceFlags(who.user.key, space.id).moderator));
  // canSetDefault: who may PATCH the space's defaultLayout -- owners, the admin and, since Set up (plan-one-bar.md
  // step 4), this space's moderators: the same people who share layouts.
  return { who, space, canShare, canSetDefault: canShare };
}
const sharedLayoutRefusal = () => `Only ${word('owner', { many: true })}, the ${word('admin')} and this ${word('space')}'s ${word('moderator', { many: true })} can change shared layouts.`;
const guestLayoutRefusal = () => `${word('guest', { many: true, cap: true })} can load shared layouts but not save or change them.`;
function sendLayoutError(err, res) {
  if (err instanceof LayoutError) return res.status(err.status).json({ error: err.message, ...err.extra });
  throw err;
}

// The system layouts (documentation/plans/plan-layout-views.md, step 1): never stored, made per space from what is on,
// in the order Workspace, Calendar, Map. Workspace is always there. Calendar is there while the Calendar destination
// answers in this space for this person (its module on in the space and readable); Map likewise while Maps is on and
// the map-file rule holds (destinationInSpace, the same rule the destination page uses). Each carries this person's
// own name, icon and tab choices (store.layouts.systemOf), else its defaults. A guest has none.
//   { id, kind: 'system', name, icon, tab, defaultName, defaultIcon, modules }
function systemLayoutsFor(found) {
  if (!found.who.user) return [];
  const mine = store.layouts.systemOf(found.space.id, found.who.user.key);
  const make = (id, defaultName, defaultIcon, modulesOf) => {
    const own = mine[id] || {};
    return { id, kind: 'system', name: own.name || defaultName, icon: own.icon || defaultIcon, tab: id === 'workspace' ? true : own.tab !== false, defaultName, defaultIcon, modules: modulesOf };
  };
  const out = [make('workspace', 'Workspace', SYSTEM_ICONS.workspace, [])];
  for (const [id, dest, moduleId] of [['calendar', 'calendar', 'calendar'], ['map', 'map', 'maps']]) {
    const shown = destinationInSpace(dest, found.who, found.space.id);
    if (!shown) continue;
    const main = shownModule(shown.shown.main.manifest);
    out.push(make(id, main.name, main.icon || SYSTEM_ICONS[id], [{ id: moduleId, mode: 'dock' }]));
  }
  return out;
}
// What a first visit to a space shows for this viewer, resolved from the stored fields so the page does not re-derive it
// (plan-layout-views.md, step 5): { layout: 'workspace' | 'calendar' | 'map' | <shared layout id>, opensWith: [ids] | null }.
// `layout` is the space's defaultLayout while it still resolves (a shared layout that exists; Calendar or Map while it
// is on here for this viewer), else 'workspace'. `opensWith` is the space's own list (the Workspace's default content),
// or null when it has none (the page then falls back to the environment's list, as before); it is sent whatever `layout` is.
function firstVisitFor(found) {
  const space = found.space;
  const stored = space.defaultLayout;
  let layout = 'workspace';
  if (stored === 'calendar' || stored === 'map') {
    if (systemLayoutsFor(found).some((l) => l.id === stored)) layout = stored;
  } else if (stored && store.defaultLayoutOf(space.id)) {
    layout = stored;
  }
  return { layout, opensWith: Array.isArray(space.opensWith) && space.opensWith.length ? [...space.opensWith] : null };
}
// The icon ids a layout may use: this environment's icon list, the modules' own icons, and the defaults.
const layoutIconIds = () => [...new Set([...store.iconIds(), ...store.displayIconIds(), ...Object.values(SYSTEM_ICONS), 'object-group'])];

app.get('/api/spaces/:id/layouts', (req, res) => {
  const found = layoutSpaceFor(req, res);
  if (!found) return;
  const me = found.who.user ? found.who.user.key : null;
  const { mine, shared } = store.layouts.list(found.space.id, me);
  // defaultLayout: the id of the shared layout this space opens with on a first visit, or null (store.defaultLayoutOf).
  const fallback = store.defaultLayoutOf(found.space.id);
  // favorites: this person's favorite layouts' ids, in the order favorited (plan-favorite-layouts.md); [] for a guest.
  const favorites = store.layouts.favorites(found.space.id, me);
  res.json({ mine, shared, system: systemLayoutsFor(found), defaultLayout: fallback ? fallback.id : null, firstVisit: firstVisitFor(found), favorites, canShare: found.canShare, canSetDefault: found.canSetDefault });
});

app.post('/api/spaces/:id/layouts', (req, res) => {
  const found = layoutSpaceFor(req, res);
  if (!found) return;
  if (!found.who.user) return res.status(403).json({ error: guestLayoutRefusal() });
  const { layout, error } = cleanLayout(req.body, { icons: layoutIconIds() });
  if (error) return res.status(400).json({ error });
  if (layout.shared && !found.canShare) return res.status(403).json({ error: sharedLayoutRefusal() });
  try {
    res.status(201).json({ layout: store.layouts.add(found.space.id, found.who.user.key, layout) });
  } catch (err) {
    sendLayoutError(err, res);
  }
});

// The name a person sees for a system layout, for a refusal's sentence (its default word when it is not on here).
const systemNameOf = (found, id) => systemLayoutsFor(found).find((l) => l.id === id)?.name || { workspace: 'Workspace', calendar: 'Calendar', map: 'Map' }[id];

// Rename (name), or replace with the current canvas (modules, snap): any of the three.
app.put('/api/spaces/:id/layouts/:layoutId', (req, res) => {
  const found = layoutSpaceFor(req, res);
  if (!found) return;
  if (!found.who.user) return res.status(403).json({ error: guestLayoutRefusal() });
  const me = found.who.user.key;
  if (SYSTEM_IDS.includes(req.params.layoutId)) return res.status(400).json({ error: `${systemNameOf(found, req.params.layoutId)} can't be replaced.` });
  const there = store.layouts.find(found.space.id, req.params.layoutId, me);
  if (!there) return res.status(404).json({ error: 'There is no such layout here.' });
  if (there.shared && !found.canShare) return res.status(403).json({ error: sharedLayoutRefusal() });
  const { layout: patch, error } = cleanLayout(req.body, { partial: true, icons: layoutIconIds() });
  if (error) return res.status(400).json({ error });
  if (!Object.keys(patch).length) return res.status(400).json({ error: `Send a new name, or the ${word('module', { many: true })} and snap to replace the layout with.` });
  try {
    const layout = store.layouts.update(found.space.id, req.params.layoutId, me, patch);
    // Replacing the default layout's modules moves the space's Opens with along with it.
    if (there.shared) store.syncDefaultLayout(found.space.id);
    res.json({ layout });
  } catch (err) {
    sendLayoutError(err, res);
  }
});

app.delete('/api/spaces/:id/layouts/:layoutId', (req, res) => {
  const found = layoutSpaceFor(req, res);
  if (!found) return;
  if (!found.who.user) return res.status(403).json({ error: guestLayoutRefusal() });
  const me = found.who.user.key;
  if (SYSTEM_IDS.includes(req.params.layoutId)) return res.status(400).json({ error: `${systemNameOf(found, req.params.layoutId)} can't be deleted.` });
  const there = store.layouts.find(found.space.id, req.params.layoutId, me);
  if (!there) return res.status(404).json({ error: 'There is no such layout here.' });
  if (there.shared && !found.canShare) return res.status(403).json({ error: sharedLayoutRefusal() });
  try {
    store.layouts.remove(found.space.id, req.params.layoutId, me);
    // Deleting the default layout clears the space's defaultLayout; its Opens with stays as it was.
    if (there.shared) store.syncDefaultLayout(found.space.id);
    res.status(204).end();
  } catch (err) {
    sendLayoutError(err, res);
  }
});

// A person's own name, icon and tab for a system layout in a space (plan-layout-views.md, step 1): { name?, icon?, tab? },
// name and icon null going back to the default. 200 { layout } (the system layout as GET lists it); 400 for a bad name or
// icon, or tab false on the Workspace; 403 for a guest; 404 for an id that is not on in this space.
app.patch('/api/spaces/:id/layouts/system/:systemId', (req, res) => {
  const found = layoutSpaceFor(req, res);
  if (!found) return;
  if (!found.who.user) return res.status(403).json({ error: guestLayoutRefusal() });
  const id = req.params.systemId;
  if (!systemLayoutsFor(found).some((l) => l.id === id)) return res.status(404).json({ error: 'There is no such layout here.' });
  const { patch, error } = cleanSystemPatch(req.body, { icons: layoutIconIds() });
  if (error) return res.status(400).json({ error });
  if (patch.tab === false && id === 'workspace') return res.status(400).json({ error: 'The Workspace is always shown.' });
  try {
    store.layouts.setSystem(found.space.id, found.who.user.key, id, patch);
    res.json({ layout: systemLayoutsFor(found).find((l) => l.id === id) });
  } catch (err) {
    sendLayoutError(err, res);
  }
});

// Favorite layouts (documentation/plans/plan-favorite-layouts.md, step 1): each signed-in person's own, per space, of
// any layout they can see (their own or a shared one). PUT makes one a favorite, at the end; DELETE stops it being one.
// Both answer { favorites } and doing what is already so is a 200 that changes nothing. There is no limit on how many
// (plan-layout-views.md, decision 13). The ids `calendar` and `map` are the system layouts: PUT/DELETE set their tab
// (404 while not on in this space) and answer { favorites, layout } with the system layout; `workspace` always has its
// tab: DELETE is a 400 "The Workspace is always shown.", PUT a 200 that changes nothing.
function layoutFavorite(on) {
  return (req, res) => {
    const found = layoutSpaceFor(req, res);
    if (!found) return;
    if (!found.who.user) return res.status(403).json({ error: `${word('guest', { many: true, cap: true })} can load shared layouts but not keep favorites.` });
    if (SYSTEM_IDS.includes(req.params.layoutId)) {
      const id = req.params.layoutId;
      if (!systemLayoutsFor(found).some((l) => l.id === id)) return res.status(404).json({ error: 'There is no such layout here.' });
      if (id === 'workspace' && !on) return res.status(400).json({ error: 'The Workspace is always shown.' });
      try {
        if (id !== 'workspace') store.layouts.setSystem(found.space.id, found.who.user.key, id, { tab: on });
        return res.json({ favorites: store.layouts.favorites(found.space.id, found.who.user.key), layout: systemLayoutsFor(found).find((l) => l.id === id) });
      } catch (err) {
        return sendLayoutError(err, res);
      }
    }
    try {
      const favorites = store.layouts.setFavorite(found.space.id, req.params.layoutId, found.who.user.key, on);
      if (!favorites) return res.status(404).json({ error: 'There is no such layout here.' });
      res.json({ favorites });
    } catch (err) {
      sendLayoutError(err, res);
    }
  };
}
app.put('/api/spaces/:id/layouts/:layoutId/favorite', layoutFavorite(true));
app.delete('/api/spaces/:id/layouts/:layoutId/favorite', layoutFavorite(false));

// --- chat history --------------------------------------------------------------------------------
// A message is posted here, kept (see server/chat-history.js for what is kept and for how long) and told live on the
// live stream (tellChat), so whoever is in the space sees it at once and someone who comes later reads what was said. Only a space has a chat: an aside is not
// a space (plan-names step 8), so its id answers 404 here, reading or posting. Reading needs the "open and read the chat" permission, posting "send chat messages", and the person
// must be in the space (or an owner, or a guest of that space).
// The rule itself, apart from answering: { who, space }, or { status, error }. The live stream asks it again at every
// chat event and while it is open, so a guest link turned off or regenerated, a session that no longer reads (expired, the
// account gone or its password or second step changed) or a person taken out of the space ends the stream. Signing
// out does not: it only clears the cookie in the browser, and an open stream already sent its session, so the page that
// signs out closes its own stream by leaving, and the browser's other open tabs keep theirs until they are closed.
// `permission` left out asks only whether they are in the space (the live stream: being there is the test).
function chatAccess(req, spaceId, permission) {
  const found = streamViewer(req);
  if (found.error) return found;
  const { who } = found;
  const space = store.spaceById(spaceId);
  if (!space) return { status: 404, error: `no such ${word('space')}` };
  const allowed = who.user ? hasOwnerRights(who.user) || space.members.includes(who.user.key) : who.guestSpace.id === space.id;
  if (!allowed) return { status: 403, error: `you are not in that ${word('space')}` };
  if (!permission) return { who, space };
  const perms = who.user ? store.spacePermissions(who.user.key, space.id) : store.roleSet('guest');
  if (!perms[permission]) return { status: 403, error: 'your role cannot do that' };
  return { who, space };
}
// Who reads a stream (the chat's, the live one): { who } (moduleViewer's), or { status: 401, error }. The access key
// is for a module's keyed page, never the chat or the live stream: it answers as signed out (layoutSpaceFor does the same).
function streamViewer(req) {
  const who = moduleViewer(req);
  if (!who || who.keyed) {
    // A guest token that names no space (turned off, regenerated, never was) says so, rather than "sign in first".
    const deadLink = !who && typeof req.query.guest === 'string' && req.query.guest !== '';
    return { status: 401, error: deadLink ? `that ${word('guest')} link is off or wrong` : 'sign in first' };
  }
  return { who };
}
function chatSpaceFor(req, res, permission) {
  const found = chatAccess(req, req.params.id, permission);
  if (found.error) return void res.status(found.status).json({ error: found.error });
  return found;
}

// --- guests in chat: the abuse limits (GitHub #289) -------------------------------------------------------------------
// A guest has no account, and one guest link is shared by everyone it was given to, so a guest's posts are counted by
// their guest link, GUEST_CHAT_POSTS_PER_MINUTE a minute, and by their address, half of that (at least 5, never more
// than the link's), so one address can't spend the whole link's minute. Open live streams (GET /api/live): a signed-in
// person LIVE_STREAMS_PER_PERSON at once (default 50: one a browser tab; they are accountable, and every tab holds one);
// a guest link LIVE_STREAMS_PER_GUEST_LINK at once, and one address on it 40% of that (at least 2, never more than
// LIVE_STREAMS_PER_PERSON), so one address can't fill the link. The address is req.ip (TRUST_PROXY_HOPS). Kept per
// environment (the slug is in each key).
const wholeAbove0 = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
const guestChatPostsPerMinute = wholeAbove0(GUEST_CHAT_POSTS_PER_MINUTE, 20);
const guestChatPostsPerAddress = Math.min(guestChatPostsPerMinute, Math.max(5, Math.floor(guestChatPostsPerMinute * 0.5)));
const liveStreamsPerPerson = wholeAbove0(LIVE_STREAMS_PER_PERSON, 50);
const liveStreamsPerGuestLink = wholeAbove0(LIVE_STREAMS_PER_GUEST_LINK, 25);
const liveStreamsPerGuestAddress = Math.min(liveStreamsPerPerson, liveStreamsPerGuestLink, Math.max(2, Math.floor(liveStreamsPerGuestLink * 0.4)));
const guestChatPosts = new Map(); // key -> post times in the last minute
const liveStreamsOpen = new Map(); // key -> streams open now
const chatSlug = () => currentEnvironment().slug || '';
// [[key, most], ...] -> { wait, most }: the seconds until one more post is allowed under every key, or 0 when it is
// allowed now (and then it is counted under each), and which key refused (its index; the one with the longest wait).
function guestPostWait(keys) {
  const now = Date.now();
  let wait = 0;
  let which = -1;
  const kept = keys.map(([key, cap], i) => {
    const recent = (guestChatPosts.get(key) || []).filter((t) => now - t < 60000);
    if (recent.length >= cap) {
      const here = Math.max(1, Math.ceil((recent[recent.length - cap] + 60000 - now) / 1000));
      if (here > wait) { wait = here; which = i; }
    }
    return [key, recent];
  });
  for (const [key, recent] of kept) {
    if (!wait) recent.push(now);
    if (recent.length) guestChatPosts.set(key, recent);
    else guestChatPosts.delete(key);
  }
  return { wait, which };
}
// Old entries go once a minute, so the map holds only who posted lately.
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of guestChatPosts) if (!times.some((t) => now - t < 60000)) guestChatPosts.delete(key);
}, 60000).unref();
// The keys a live stream counts under, each with its most: [[key, most], ...].
function liveStreamKeys(req, who) {
  const slug = chatSlug();
  if (who.user) return [[`${slug}|person|${who.user.key}`, liveStreamsPerPerson]];
  const token = req.query.guest;
  return [[`${slug}|guest|${token}|${req.ip || 'unknown'}`, liveStreamsPerGuestAddress], [`${slug}|link|${token}`, liveStreamsPerGuestLink]];
}

// A shared AI answer as someone other than its asker may read it: the pointers it keeps (`numbered`, `used`, what was attached,
// what the AI looked up, each object's sources) only to objects `canOpen` says this reader can open -- the page's own rule
// (POST /api/objects/resolve). `numbered` keeps its places (a citation [n] is numbered[n - 1]); one the reader can't open
// is null there, and left out of the lists. Anything else is returned as it is.
function aiAnswerForReader(m, canOpen) {
  if (!m || m.kind !== 'ai') return m;
  const keep = (list) => (Array.isArray(list) ? list.filter((r) => r && canOpen(r)) : list);
  const out = { ...m };
  if (Array.isArray(m.numbered)) out.numbered = m.numbered.map((r) => (r && canOpen(r) ? r : null));
  if (Array.isArray(m.used)) out.used = keep(m.used);
  if (Array.isArray(m.summaries)) out.summaries = m.summaries.map((c) => (c && Array.isArray(c.sources) ? { ...c, sources: keep(c.sources) } : c));
  if (m.sent && typeof m.sent === 'object') {
    out.sent = { ...m.sent };
    if (Array.isArray(m.sent.attached)) out.sent.attached = keep(m.sent.attached);
    if (m.sent.lookup && typeof m.sent.lookup === 'object') out.sent.lookup = { ...m.sent.lookup, ...(Array.isArray(m.sent.lookup.read) ? { read: keep(m.sent.lookup.read) } : {}) };
  }
  return out;
}
// Whether `who` can open an object: resolved as the page resolves it (a gone one, or one the reader's role can't read, is not).
function readerCanOpen(who) {
  const memo = new Map();
  return (ref) => {
    const key = objectKey(ref);
    if (!memo.has(key)) {
      memo.set(key, !refAnswer(() => resolveRef(who, ref, null, { skipConsumer: true })).error);
    }
    return memo.get(key);
  };
}

app.get('/api/spaces/:id/chat', (req, res) => {
  const found = chatSpaceFor(req, res, 'chatRead');
  if (!found) return;
  // Public messages, and the caller's own private ones (plan-chat-model.md); a guest reads public messages only.
  const me = found.who.user ? found.who.user.key : null;
  const canOpen = readerCanOpen(found.who);
  // A shared AI answer keeps the pointers of the objects it used; someone other than its asker gets those they can open.
  const messages = chatHistory.list(found.space.id, me).map((m) => (m.kind === 'ai' && m.by !== me ? aiAnswerForReader(m, canOpen) : m));
  res.json({ messages, clearedAt: chatHistory.clearedAt(found.space.id) });
});

// A server-sent stream (the live one): the caps, the headers, the ping, the access asked again, and the counts given
// back when it ends, in one place. `keys` are what it counts under (liveStreamKeys) and `what` names it in a 429's
// sentence ("live streams"). `on` is [[emitter, event, fn], ...]: each fn is called as fn(stream, ...args) in
// this request's environment while the stream is open. `recheck()` answers null while the access holds, else the last
// event to send before the stream ends. `start(stream)` runs once it is listening; `end()` once it has ended, however.
// Each event has an `id:` line. Answers the stream, or null when it answered 429. Written through sseWrite: a reader
// LIVE_STREAM_BUFFER_MB behind is dropped (its page reconnects), never queued for.
//   stream.send(data): one default `message` event whose data is JSON; the same `data` object sent to many streams is
//     made into bytes once and shared;
//   stream.check(): asks the access again (recheck): true while it holds, else the last event goes out and it ends;
//   stream.close(last): sends `last` (when given) and ends it.
const STREAM_RECHECK_MS = 2000;
const STREAM_PING_MS = 25000;
const streamBytes = new WeakMap(); // an event's data object -> its `data:` lines as one Buffer
function streamEventBytes(data) {
  let bytes = streamBytes.get(data);
  if (!bytes) {
    bytes = Buffer.from(`data: ${JSON.stringify(data)}\n\n`);
    streamBytes.set(data, bytes);
  }
  return bytes;
}
function eventStream(req, res, { keys, what, on = [], recheck, start, end }) {
  const full = keys.find(([key, most]) => (liveStreamsOpen.get(key) || 0) >= most);
  if (full) {
    const said = full === keys[0]
      ? `you have too many ${what} open (${full[1]} at most); close one and try again`
      : `this ${word('guest')} link has too many ${what} open (${full[1]} at most); close one and try again`;
    res.status(429).json({ error: said });
    return null;
  }
  for (const [key] of keys) liveStreamsOpen.set(key, (liveStreamsOpen.get(key) || 0) + 1);
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  sseWrite(res, 'retry: 5000\n\n');
  let ended = false;
  let beat = null;
  let again = null;
  let next = 0;
  // A write that did not go: the reader fell too far behind (sseWrite dropped it) or is gone. Either way it ends now.
  const wrote = (done) => {
    if (!done) envContext.run(env, cleanup);
    return done;
  };
  const stream = {
    get ended() { return ended; },
    send(data) {
      if (ended) return;
      next += 1;
      wrote(sseWrite(res, `id: ${next}\n`, typeof data === 'object' && data ? streamEventBytes(data) : `data: ${JSON.stringify(data)}\n\n`));
    },
    check() {
      if (ended) return false;
      const last = recheck();
      if (!last) return true;
      stream.close(last);
      return false;
    },
    close(last) {
      if (ended) return;
      if (last) stream.send(last);
      try {
        res.end();
      } catch {
        // already gone
      }
      cleanup();
    },
  };
  const bound = on.map(([emitter, event, fn]) => [emitter, event, listenIn(env, (...args) => { if (!ended) fn(stream, ...args); })]);
  function cleanup() {
    if (ended) return;
    ended = true;
    clearInterval(beat);
    clearInterval(again);
    for (const [emitter, event, fn] of bound) emitter.off(event, fn);
    for (const [key] of keys) {
      const left = (liveStreamsOpen.get(key) || 1) - 1;
      if (left > 0) liveStreamsOpen.set(key, left);
      else liveStreamsOpen.delete(key);
    }
    if (end) end();
  }
  for (const [emitter, event, fn] of bound) emitter.on(event, fn);
  if (start) start(stream);
  if (ended) return stream; // start() ended it (a kick kept for this person)
  beat = setInterval(() => wrote(sseWrite(res, ': ping\n\n')), STREAM_PING_MS);
  again = setInterval(() => envContext.run(env, () => stream.check()), STREAM_RECHECK_MS);
  req.on('close', () => envContext.run(env, cleanup));
  return stream;
}

// --- the live stream (plan-realtime-optional-livekit.md, steps 1 and 3: presence and chat) ---------------------------
// Who may open GET /api/live (and say PATCH /api/spaces/:id/presence) for `spaceId`: { who, space, aside } or
// { status, error }. A space: its members, owners and the admin, and its guests (chatAccess with no permission). An
// aside: its members, owners and the admin; never a guest. No space (Home): anyone signed in.
function liveAccess(req, spaceId) {
  if (!spaceId) {
    const found = streamViewer(req);
    if (found.error) return found;
    if (!found.who.user) return { status: 400, error: `say which ${word('space')} the live stream is for` };
    return { who: found.who, space: null, aside: null };
  }
  const aside = store.asideById(spaceId);
  if (!aside) {
    const found = chatAccess(req, spaceId, null);
    return found.error ? found : { ...found, aside: null };
  }
  const found = streamViewer(req);
  if (found.error) return found;
  const user = found.who.user;
  if (!user || !(hasOwnerRights(user) || aside.members.includes(user.key))) return { status: 403, error: `you are not in that ${word('space')}` };
  return { who: found.who, space: null, aside };
}

// The people in a space or an aside, as the live stream's presence event lists them (server/live.js, people()): a
// person's name is read from their account now, so a rename shows at the next change.
function livePeople(spaceId) {
  return live.people(spaceId).map((p) => {
    const u = p.guest ? null : store.userByKey(p.key);
    return u ? { ...p, name: u.displayName } : p;
  });
}
// Tell the live streams of these spaces (and asides) that who is there changed. Each sends its own list.
function tellLivePresence(spaceIds) {
  for (const id of new Set(spaceIds)) {
    if (!id) continue;
    try {
      liveEvents.emit('presence', id);
    } catch (err) {
      console.error(`A live stream's listener failed: ${err.stack || err.message}`);
    }
  }
}

// A nudge for one person in a space or an aside (an aside's aside-pull, aside-recall or aside-return, a kick's `removed`),
// on their live streams there. Someone whose stream there is reconnecting (the register's grace) gets it when they open
// one again, within 30 seconds (server/live.js, hold). A `removed` ends the streams it reaches.
function tellLive(who, space, data) {
  if (!live.openFor(who, space).length) return live.hold(who, space, data);
  try {
    liveEvents.emit('nudge', who, space, data);
  } catch (err) {
    console.error(`A live stream's listener failed: ${err.stack || err.message}`);
  }
  return true;
}
// The same for everyone the register has in `space` (an aside's aside-started).
function tellLiveSpace(space, data) {
  for (const p of live.people(space)) tellLive(p.key, space, data);
}

// GET /api/live: the live stream (server-sent events), one per space page: being in a space is this being open. ?space=
// is a space's or an aside's id (left out on Home); a guest adds ?guest=<their link's token> and ?pass=<their guest pass>
// (POST /api/guest-join; 403 without a valid one). Each event is a default `message` with an `id:` line and data
// { type, ... }:
//   ready     { you, space, stream }: first, once listening. `you` is the person's key or, for a guest, the id on their
//             pass (their identity on the call too); `stream` names this stream to PATCH /api/spaces/:id/presence.
//   presence  { space, people: [{ key, name, guest, onCall, away, awayMessage }] }: everyone there, on connect and on
//             every change (server/live.js).
//   chat, chat-delete, chat-clear, chat-clear-some, chat-visibility, chat-preview, chat-kept, chat-picture: what tellChat
//             says, each with `space`, for this stream's space and for the Lobby (Home's chat), each only while the
//             reader may read that chat (chatAccess with chatRead, asked at every event). A private message is never sent;
//             nothing is replayed, so a page catches up from GET /api/spaces/:id/chat after a reconnect.
//   aside-pull { spaceId, byOwner, private, from }, aside-started { spaceId, private, members? }, aside-recall { spaceId,
//             spaceName }, aside-return { spaceId }: the asides' nudges (POST /api/asides, /recall, /return), only to the
//             people they are for; one for a stream that was reconnecting comes when it opens again, within 30 seconds.
//   removed   { reason: 'access', error }: the access no longer holds (asked every STREAM_RECHECK_MS and at once on
//             liveAccessChanged); { reason: 'kicked' }: a kick (POST /api/users/:key/kick). Then the stream ends.
// The person is in the space while the stream is open and for the register's grace after (server/live.js). Too many open
// at once (liveStreamKeys: LIVE_STREAMS_PER_PERSON, LIVE_STREAMS_PER_GUEST_LINK) answers 429.
app.get('/api/live', (req, res) => {
  const spaceId = typeof req.query.space === 'string' && req.query.space ? req.query.space : null;
  const found = liveAccess(req, spaceId);
  if (found.error) return res.status(found.status).json({ error: found.error });
  const guest = !found.who.user;
  // A guest is who their pass says (POST /api/guest-join), the same id on the call.
  const pass = guest && typeof req.query.pass === 'string' ? readGuestPass(req.query.guest, req.query.pass) : null;
  if (guest && !pass) return res.status(403).json({ error: `that ${word('guest')} pass is not valid; enter again` });
  const you = guest ? pass.id : found.who.user.key;
  const name = guest ? pass.name : found.who.user.displayName;
  const env = currentEnvironment();
  let streamId = null;
  eventStream(req, res, {
    keys: liveStreamKeys(req, found.who),
    what: 'live streams',
    on: [
      [liveEvents, 'presence', (stream, id) => {
        if (id === spaceId && stream.check()) stream.send({ type: 'presence', space: spaceId, people: livePeople(spaceId) });
      }],
      // The chat of this space and the Lobby's (Home's chat), to a reader of it. check() drops the cached person first.
      [liveEvents, 'chat', (stream, id, data) => {
        if (id !== spaceId && id !== LOBBY) return;
        if (!stream.check() || chatAccess(req, id, 'chatRead').error) return;
        stream.send(data); // one object for every reader (tellChat), so its bytes are made once and shared
      }],
      [liveEvents, 'access', (stream) => stream.check()],
      [liveEvents, 'nudge', (stream, who, space, data) => {
        if (who !== you || space !== spaceId) return;
        if (data.type === 'removed') stream.close(data);
        else stream.send(data);
      }],
    ],
    recheck: () => {
      req._user = undefined;
      const now = liveAccess(req, spaceId);
      if (!now.error && (guest ? !now.who.user : now.who.user?.key === you)) return null;
      return { type: 'removed', reason: 'access', error: now.error || 'sign in first' };
    },
    start: (stream) => {
      const before = live.placeOf(you)?.space;
      streamId = live.open({ who: you, name, guest, space: spaceId });
      stream.send({ type: 'ready', you, space: spaceId, stream: streamId });
      tellLivePresence([before, spaceId]);
      // What came while this person's stream was reconnecting. A kick kept for them ends this one too.
      if (!spaceId) return;
      for (const data of live.takeHeld(you, spaceId)) {
        if (data.type !== 'removed') { stream.send(data); continue; }
        stream.close(data);
        live.leave(you, spaceId);
        tellLivePresence([spaceId]);
        break;
      }
    },
    end: () => {
      const before = live.placeOf(you)?.space;
      const closed = live.close(streamId);
      if (!closed) return;
      tellLivePresence([before, closed.space, live.placeOf(you)?.space]);
      // When the grace runs out, the person leaves the space: the streams there are told.
      if (closed.until) {
        setTimeout(() => envContext.run(env, () => tellLivePresence([closed.space])), Math.max(0, closed.until - Date.now()) + 50).unref();
      }
    },
  });
});

// At most PRESENCE_CHANGES_PER_MINUTE a minute a person in a space (429), so toggling away in a loop can't flood it.
// Only a change the register took is counted: a refused one (400, 409, 429) uses none of the minute.
const presenceChangesPerMinute = wholeAbove0(PRESENCE_CHANGES_PER_MINUTE, 60);
const presenceChanges = new Map(); // `${slug}|${space}|${who}` -> change times in the last minute
const presenceKey = (who, spaceId) => `${chatSlug()}|${spaceId}|${who}`;
// The seconds until `who` may say one more in `spaceId`, or 0 when they may now.
function presenceWait(who, spaceId) {
  const key = presenceKey(who, spaceId);
  const now = Date.now();
  const recent = (presenceChanges.get(key) || []).filter((t) => now - t < 60000);
  if (recent.length) presenceChanges.set(key, recent);
  else presenceChanges.delete(key);
  if (recent.length < presenceChangesPerMinute) return 0;
  return Math.max(1, Math.ceil((recent[recent.length - presenceChangesPerMinute] + 60000 - now) / 1000));
}
function countPresenceChange(who, spaceId) {
  const key = presenceKey(who, spaceId);
  presenceChanges.set(key, [...(presenceChanges.get(key) || []), Date.now()]);
}
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of presenceChanges) if (!times.some((t) => now - t < 60000)) presenceChanges.delete(key);
}, 60000).unref();
// PATCH /api/spaces/:id/presence { away?, awayMessage?, onCall?, stream? }: the page's word about the person in a space
// or an aside (the live stream's access). `awayMessage` is trimmed to 200 characters; turning away off clears it unless
// one is sent. `onCall` goes on the stream named by `stream` (the id from `ready`), or on every live stream of theirs
// there; it goes when that stream closes. A guest names their `stream` (?guest= as on the stream). Answers { ok: true }
// and sends presence to the space when something changed; 409 when they have no live stream open there; 429 past
// PRESENCE_CHANGES_PER_MINUTE in this space (only the changes taken count).
app.patch('/api/spaces/:id/presence', (req, res) => {
  const found = liveAccess(req, req.params.id);
  if (found.error) return res.status(found.status).json({ error: found.error });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const patch = {};
  for (const field of ['away', 'onCall']) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'boolean') return res.status(400).json({ error: `${field} must be true or false` });
    patch[field] = body[field];
  }
  if (body.awayMessage !== undefined) {
    if (typeof body.awayMessage !== 'string') return res.status(400).json({ error: 'awayMessage must be text' });
    patch.awayMessage = cleanAwayMessage(body.awayMessage);
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'say away, awayMessage or onCall' });
  if (patch.onCall === true && !HAS_CALL_SERVICE) return res.status(503).json({ error: NO_CALL_SERVICE });
  if (body.stream !== undefined && typeof body.stream !== 'string') return res.status(400).json({ error: 'stream must be the id the live stream gave' });
  let who;
  if (found.who.user) {
    who = found.who.user.key;
  } else {
    const entry = typeof body.stream === 'string' ? live.stream(body.stream) : null;
    if (!entry || !entry.guest || entry.space !== req.params.id) return res.status(409).json({ error: `open the ${word('space')} first; there is no live stream of yours there` });
    who = entry.who;
  }
  const wait = presenceWait(who, req.params.id);
  if (wait) return res.status(429).set('Retry-After', String(wait)).json({ error: 'too many away and call changes, wait a moment' });
  const changed = live.set(who, req.params.id, patch, body.stream || null);
  if (changed === null) return res.status(409).json({ error: `open the ${word('space')} first; there is no live stream of yours there` });
  countPresenceChange(who, req.params.id);
  if (changed) tellLivePresence([req.params.id]);
  res.json({ ok: true });
});
// Something that changes who may read a chat happened (a guest link turned off or regenerated, a space changed or
// deleted): every open live stream in this environment asks again now rather than at its next recheck.
function liveAccessChanged() {
  try {
    liveEvents.emit('access');
  } catch (err) {
    console.error(`A live stream's access check failed: ${err.stack || err.message}`);
  }
}

// An owner, or a member ticked as moderator in this space. Guests are neither.
function chatModerator(who, space) {
  if (!who.user) return false;
  if (hasOwnerRights(who.user)) return true;
  return Boolean(store.spaceFlags(who.user.key, space.id).moderator);
}

// What happens to a space's chat, told at once to the live streams that may read it (GET /api/live): a new public
// message, a delete, a clear, who sees a message, a link's preview or Keep, a picture. The stored history is what a later
// visit reads. Never told for a private message.
function tellChat(spaceId, data) {
  try {
    liveEvents.emit('chat', spaceId, { ...data, space: spaceId });
  } catch (err) {
    console.error(`A live stream's listener failed: ${err.stack || err.message}`);
  }
}

app.delete('/api/spaces/:id/chat', (req, res) => {
  const found = chatSpaceFor(req, res, 'chatRead');
  if (!found) return;
  if (!chatModerator(found.who, found.space)) return res.status(403).json({ error: `only ${word('owner', { a: true })} or ${word('moderator', { a: true })} can delete the chat` });
  chatHistory.clear(found.space.id);
  forgetChatPictures(found.space.id, () => true);
  tellChat(found.space.id, { type: 'chat-clear' });
  res.json({ ok: true });
});

// "Delete your private messages" (plan-chat-model.md, decision 13): every private message of the caller's in this
// space, and nothing else -- never anyone else's, never a public one. Registered before /chat/:messageId.
app.delete('/api/spaces/:id/chat/private', (req, res) => {
  const found = chatSpaceFor(req, res, 'chat');
  if (!found) return;
  if (!found.who.user) return res.status(403).json({ error: `${word('guest', { many: true })} have no private messages to delete` });
  const deleted = chatHistory.removePrivate(found.space.id, found.who.user.key);
  res.json({ ok: true, deleted });
});

// Clear… (plan-chat-clear.md, GitHub #166): one type of message, the caller's own (`mine`) or every public one plus
// the caller's own private ones (`everyone`, for an owner, an admin or this space's moderator). Never anyone else's
// private message. Its own path, never a query on DELETE /chat, so a request that loses its query cannot fall through
// to deleting the whole chat (decision 11); registered before /chat/:messageId. Messages only: the objects they made
// stay in their modules. `cleared` is not changed.
const CLEAR_TYPES = ['chat', 'ai', 'module', 'all'];
const CLEAR_TYPES_SAID = `type is ${CLEAR_TYPES.slice(0, -1).join(', ')} or ${CLEAR_TYPES.at(-1)}`; // the values, as sent
app.delete('/api/spaces/:id/chat/messages', (req, res) => {
  const found = chatSpaceFor(req, res, 'chatRead');
  if (!found) return;
  const { type, scope, module: moduleId } = req.query;
  if (typeof type !== 'string' || !CLEAR_TYPES.includes(type)) return res.status(400).json({ error: CLEAR_TYPES_SAID });
  if (type === 'module' && (typeof moduleId !== 'string' || !moduleId.trim())) return res.status(400).json({ error: `which ${word('module')}` });
  if (scope !== 'mine' && scope !== 'everyone') return res.status(400).json({ error: 'scope is mine or everyone' });
  if (!found.who.user) return res.status(403).json({ error: `${word('guest', { many: true })} can't clear messages` });
  if (scope === 'everyone' && !chatModerator(found.who, found.space)) {
    return res.status(403).json({ error: `Only ${word('owner', { a: true })} or ${word('moderator', { a: true })} can clear everyone's messages` });
  }
  const me = found.who.user.key;
  const removed = chatHistory.clearByType(found.space.id, { type, module: type === 'module' ? moduleId.trim() : undefined, scope, by: me });
  // Only public ids are told: a private message was only ever on its author's page. Clearing chat (or all) takes the
  // pictures too, the caller's or everyone's; the pages drop those by the same rule (clearTakesPicture), so a clear of
  // pictures alone is told as well.
  const ids = removed.filter((m) => m.visibility !== 'private').map((m) => m.id);
  const pictures = type === 'chat' || type === 'all' ? forgetChatPictures(found.space.id, (p) => scope === 'everyone' || p.by === me) : 0;
  if (ids.length || pictures) {
    tellChat(found.space.id, {
      type: 'chat-clear-some', ids, by: me, who: found.who.user.displayName, scope, clearType: type,
      ...(type === 'module' ? { module: moduleId.trim() } : {}),
    });
  }
  res.json({ ok: true, deleted: removed.length });
});

app.delete('/api/spaces/:id/chat/:messageId', (req, res) => {
  const found = chatSpaceFor(req, res, 'chat');
  if (!found) return;
  if (!found.who.user) return res.status(403).json({ error: 'you can only delete a message you sent' });
  if (!/^[a-f0-9]{12}$/.test(req.params.messageId)) return res.status(404).json({ error: 'no such message' });
  // Someone else's private message is "no such message", for a moderator too: they cannot see it.
  const me = found.who.user.key;
  const moderator = chatModerator(found.who, found.space);
  // A picture is never stored: its record says who sent it, so they (or a moderator) can take it off everyone's page.
  const picture = chatPictureOf(found.space.id, req.params.messageId);
  if (picture) {
    if (!moderator && picture.by !== me) return res.status(403).json({ error: 'you can only delete a message you sent' });
    forgetChatPicture(req.params.messageId);
    tellChat(found.space.id, { type: 'chat-delete', id: req.params.messageId });
    return res.json({ ok: true });
  }
  const gone = chatHistory.remove(found.space.id, req.params.messageId, moderator ? null : me, me);
  if (gone === false) return res.status(403).json({ error: 'you can only delete a message you sent' });
  if (!gone) return res.status(404).json({ error: 'no such message' });
  // Only a public message was ever on anyone else's page; a private one's id is not told to the call.
  if (gone.visibility !== 'private') tellChat(found.space.id, { type: 'chat-delete', id: gone.id });
  res.json({ ok: true });
});

// Who sees a message (plan-chat-model.md, decision 9): its author flips it public or private. Only `visibility`
// changes. Someone else's private message answers 404, so its existence is not revealed.
app.patch('/api/spaces/:id/chat/:messageId', (req, res) => {
  const found = chatSpaceFor(req, res, 'chat');
  if (!found) return;
  const visibility = req.body?.visibility;
  if (visibility !== 'public' && visibility !== 'private') return res.status(400).json({ error: 'visibility is public or private' });
  if (!found.who.user) return res.status(403).json({ error: 'only the person who posted it can change who sees it' });
  if (!/^[a-f0-9]{12}$/.test(req.params.messageId)) return res.status(404).json({ error: 'no such message' });
  const me = found.who.user.key;
  if (chatPostLimited(me)) return res.status(429).json({ error: 'too many messages, slow down' });
  const out = chatHistory.setVisibility(found.space.id, req.params.messageId, me, visibility);
  if (out === false) return res.status(403).json({ error: 'only the person who posted it can change who sees it' });
  if (!out) return res.status(404).json({ error: 'no such message' });
  if (out.changed) {
    tellChat(found.space.id, visibility === 'public'
      ? { type: 'chat-visibility', id: out.message.id, visibility, message: aiAnswerForReader(out.message, () => false) } // one object for every reader: no pointers; a page reads them (the ones it may open) from GET /chat
      : { type: 'chat-visibility', id: out.message.id, visibility });
  }
  res.json({ message: out.message });
});

// A guest's pass on a chat request (?guest=<token>&pass=<pass>): { id, name }, or null when there is no valid one.
function chatGuestPass(req) {
  return typeof req.query.pass === 'string' ? readGuestPass(req.query.guest, req.query.pass) : null;
}

// One person's chat writes in the last ten seconds (posting, and changing who sees a message): 30 at most.
function chatPostLimited(key) {
  const now = Date.now();
  const recent = (chatPosts.get(key) || []).filter((t) => now - t < 10000);
  if (recent.length >= 30) return true;
  chatPosts.set(key, [...recent, now]);
  return false;
}

app.post('/api/spaces/:id/chat', (req, res) => {
  const found = chatSpaceFor(req, res, 'chat');
  if (!found) return;
  const { who, space } = found;
  const key = who.user ? who.user.key : `guest:${space.id}`;
  // A guest posts under the name on their pass (POST /api/guest-join), never one they send.
  const pass = who.user ? null : chatGuestPass(req);
  if (!who.user && !pass) return res.status(403).json({ error: `that ${word('guest')} pass is not valid; enter again` });
  if (!who.user) {
    const slug = chatSlug();
    const { wait, which } = guestPostWait([[`${slug}|link|${req.query.guest}`, guestChatPostsPerMinute], [`${slug}|ip|${req.ip || 'unknown'}`, guestChatPostsPerAddress]]);
    if (wait) {
      const after = `try again in ${wait} ${wait === 1 ? 'second' : 'seconds'}`;
      const guests = word('guest', { many: true, cap: true });
      return res.status(429).set('Retry-After', String(wait))
        .json({ error: which === 0 ? `${guests} can post ${guestChatPostsPerMinute} messages a minute; ${after}` : `${guests} can post ${guestChatPostsPerAddress} messages a minute from one address; ${after}` });
    }
  }
  if (chatPostLimited(key)) return res.status(429).json({ error: 'too many messages, slow down' });
  // Always an ordinary public message: private ones are made only by the command and AI routes. Its first link
  // (plan-chat-links.md) is stored as `preview: { url }` at once; nothing is fetched here.
  const message = chatHistory.add(space.id, {
    by: who.user ? who.user.key : 'guest',
    who: who.user ? who.user.displayName : pass.name,
    text: req.body?.text,
    link: findLink(typeof req.body?.text === 'string' ? req.body.text : ''),
  });
  // Told to the live streams at once; the sender's page draws it from this answer, and a page that already drew this id
  // ignores the repeat.
  if (message) tellChat(space.id, { type: 'chat', ...message });
  res.json({ message });
});

// --- chat pictures (plan-realtime-optional-livekit.md, step 3; option 4 B) ---------------------------------------------
// A picture in the chat is never stored on disk. The live stream carries only a small chat-picture event (who, the file's
// name, type and size, and a short url); the bytes are held in this server's memory for CHAT_PICTURE_KEEP_MINUTES and
// each reader fetches them from the url with their own access (GET below), so a slow reader is never sent megabytes on its
// stream and loses nothing it can still fetch. Held bytes are bounded: CHAT_PICTURE_SPACE_MB a space,
// CHAT_PICTURE_ENVIRONMENT_MB an environment and CHAT_PICTURE_SERVER_MB in all; a new picture past one of them pushes out
// the oldest held there (its url then answers 404, as after it expires). The record (chatPictures: id -> { space, by,
// at }, never the bytes) lets the sender or a moderator delete it for everyone and Clear... take it; records go after
// CHAT_PICTURE_RECORD_MS, and at most CHAT_PICTURE_RECORDS are kept per environment (the oldest go first).
const CHAT_PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const CHAT_PICTURE_RECORD_MS = 24 * 60 * 60 * 1000;
const CHAT_PICTURE_RECORDS = 2000;
const megabytes = (value, fallback) => {
  const mb = Number(value);
  return Math.floor((Number.isFinite(mb) && mb > 0 ? mb : fallback) * 1024 * 1024);
};
const chatPictureMaxBytes = megabytes(CHAT_PICTURE_MAX_MB, 3);
const chatPictureMaxSaid = chatPictureMaxBytes >= 1024 * 1024 ? `${Math.round((chatPictureMaxBytes / (1024 * 1024)) * 10) / 10} MB` : `${Math.round(chatPictureMaxBytes / 1024)} KB`;
const rawChatPicture = express.raw({ type: CHAT_PICTURE_TYPES, limit: chatPictureMaxBytes });
const chatPictureKeepMs = (() => {
  const minutes = Number(CHAT_PICTURE_KEEP_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60 * 1000;
})();
// Each total holds at least one picture of the largest size.
const chatPictureHeldMost = {
  space: Math.max(chatPictureMaxBytes, megabytes(CHAT_PICTURE_SPACE_MB, 30)),
  environment: Math.max(chatPictureMaxBytes, megabytes(CHAT_PICTURE_ENVIRONMENT_MB, 100)),
  server: Math.max(chatPictureMaxBytes, megabytes(CHAT_PICTURE_SERVER_MB, 200)),
};
// What the bytes are, read from their first bytes (never the name or the header alone): one of CHAT_PICTURE_TYPES, or ''.
function chatPictureType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return '';
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a') return 'image/gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

// The held bytes, for every environment at once (so CHAT_PICTURE_SERVER_MB is one total): `${slug}|${id}` ->
// { slug, space, bytes, mime, at }, oldest first, and the totals held per space, per environment and in all.
const heldChatPictures = new Map();
const heldTotals = { all: 0, environment: new Map(), space: new Map() };
const heldSpaceKey = (slug, space) => `${slug}|${space}`;
function addHeld(map, key, n) {
  const left = (map.get(key) || 0) + n;
  if (left > 0) map.set(key, left);
  else map.delete(key);
}
function dropHeldPicture(key) {
  const held = heldChatPictures.get(key);
  if (!held) return;
  heldChatPictures.delete(key);
  heldTotals.all -= held.bytes.length;
  addHeld(heldTotals.environment, held.slug, -held.bytes.length);
  addHeld(heldTotals.space, heldSpaceKey(held.slug, held.space), -held.bytes.length);
}
function dropExpiredPictures() {
  const now = Date.now();
  for (const [key, held] of heldChatPictures) {
    if (now - held.at < chatPictureKeepMs) break; // oldest first: the rest are newer
    dropHeldPicture(key);
  }
}
setInterval(dropExpiredPictures, 60000).unref();
// Holds a picture's bytes, first pushing out the oldest held in its space, then its environment, then anywhere, until
// each total has room for it.
function holdChatPicture(spaceId, id, bytes, mime, at) {
  dropExpiredPictures();
  const slug = chatSlug();
  const size = bytes.length;
  const spaceKey = heldSpaceKey(slug, spaceId);
  const limits = [
    [() => heldTotals.space.get(spaceKey) || 0, chatPictureHeldMost.space, (h) => h.slug === slug && h.space === spaceId],
    [() => heldTotals.environment.get(slug) || 0, chatPictureHeldMost.environment, (h) => h.slug === slug],
    [() => heldTotals.all, chatPictureHeldMost.server, () => true],
  ];
  for (const [held, most, here] of limits) {
    for (const [key, h] of heldChatPictures) {
      if (held() + size <= most) break;
      if (here(h)) dropHeldPicture(key);
    }
  }
  heldChatPictures.set(`${slug}|${id}`, { slug, space: spaceId, bytes, mime, at });
  heldTotals.all += size;
  addHeld(heldTotals.environment, slug, size);
  addHeld(heldTotals.space, spaceKey, size);
}
// A held picture of this space, or null once it has expired, been pushed out or deleted.
function heldChatPicture(spaceId, id) {
  const held = heldChatPictures.get(`${chatSlug()}|${id}`);
  return held && held.space === spaceId && Date.now() - held.at < chatPictureKeepMs ? held : null;
}
const chatPictureUrl = (spaceId, id) => `/api/spaces/${encodeURIComponent(spaceId)}/chat/pictures/${id}`;

function chatPictureOf(spaceId, id) {
  const p = chatPictures.get(id);
  return p && p.space === spaceId && Date.now() - p.at < CHAT_PICTURE_RECORD_MS ? p : null;
}
// Forget a picture: its record and its bytes.
function forgetChatPicture(id) {
  chatPictures.delete(id);
  dropHeldPicture(`${chatSlug()}|${id}`);
}
// Forget the space's pictures that `take(record)` names: how many went.
function forgetChatPictures(spaceId, take) {
  let n = 0;
  for (const [id, p] of chatPictures) {
    if (p.space === spaceId && take(p)) {
      forgetChatPicture(id);
      n += 1;
    }
  }
  return n;
}
function keepChatPicture(id, record) {
  const now = Date.now();
  for (const [old, p] of chatPictures) if (now - p.at >= CHAT_PICTURE_RECORD_MS) forgetChatPicture(old);
  while (chatPictures.size >= CHAT_PICTURE_RECORDS) forgetChatPicture(chatPictures.keys().next().value);
  chatPictures.set(id, record);
}

// How many bytes of pictures one sender (a person, or a guest link) may send in a minute: CHAT_PICTURE_MB_PER_MINUTE.
const chatPictureBytesPerMinute = (() => {
  const mb = Number(CHAT_PICTURE_MB_PER_MINUTE);
  return Math.floor((Number.isFinite(mb) && mb > 0 ? mb : 20) * 1024 * 1024);
})();
const chatPictureSent = new Map(); // `${slug}|${sender}` -> [[at, bytes], ...] in the last minute
// The seconds until `sender` may send `bytes` more, or 0 when they may now.
function chatPictureWait(sender, bytes) {
  const key = `${chatSlug()}|${sender}`;
  const now = Date.now();
  const recent = (chatPictureSent.get(key) || []).filter(([at]) => now - at < 60000);
  if (recent.length) chatPictureSent.set(key, recent);
  else chatPictureSent.delete(key);
  let total = recent.reduce((sum, [, b]) => sum + b, 0) + bytes;
  if (total <= chatPictureBytesPerMinute) return 0;
  for (const [at, b] of recent) { // the oldest go first: wait until enough of them have
    total -= b;
    if (total <= chatPictureBytesPerMinute) return Math.max(1, Math.ceil((at + 60000 - now) / 1000));
  }
  return 60;
}
function countChatPicture(sender, bytes) {
  const key = `${chatSlug()}|${sender}`;
  chatPictureSent.set(key, [...(chatPictureSent.get(key) || []), [Date.now(), bytes]]);
}
setInterval(() => {
  const now = Date.now();
  for (const [key, sent] of chatPictureSent) if (!sent.some(([at]) => now - at < 60000)) chatPictureSent.delete(key);
}, 60000).unref();
const tooManyPictures = (res, wait) => res.status(429).set('Retry-After', String(wait)).json({ error: 'too many pictures, wait a moment' });

// POST /api/spaces/:id/chat/pictures?file=<its name>[&guest=<token>&pass=<the guest's pass>], the picture's bytes as the
// body with its type (PNG, JPEG, GIF or WebP): held (see above) and told at once to the live streams that may read this
// chat as { type: 'chat-picture', space, id, by, who, file, mime, size, url, at }, never with its bytes; answers
// { id, url }. Needs "send pictures";
// counted as a chat post (the same limits, a guest's too), and under CHAT_PICTURE_MB_PER_MINUTE (429). Not in Home's
// chat (the Lobby: 403). A guest is shown by the name on their pass (403 without a valid one). Who may send, Home, the
// pass, the size the request says (Content-Length, 413) and the picture limit are all asked before the body is read.
function chatPictureFirst(req, res, next) {
  const found = chatSpaceFor(req, res, 'sendPictures');
  if (!found) return;
  if (found.space.id === LOBBY) return res.status(403).json({ error: `pictures can only be sent in a ${word('space')}'s chat` });
  const declared = Number(req.get('content-length'));
  if (Number.isFinite(declared) && declared > chatPictureMaxBytes) return res.status(413).json({ error: `that picture is over ${chatPictureMaxSaid}` });
  const pass = found.who.user ? null : chatGuestPass(req);
  if (!found.who.user && !pass) return res.status(403).json({ error: `that ${word('guest')} pass is not valid; enter again` });
  req.chatPicture = { ...found, pass, sender: found.who.user ? `person|${found.who.user.key}` : `link|${req.query.guest}` };
  const wait = chatPictureWait(req.chatPicture.sender, Number.isFinite(declared) ? declared : 0);
  if (wait) return tooManyPictures(res, wait);
  next();
}
app.post('/api/spaces/:id/chat/pictures', chatPictureFirst, rawChatPicture, (req, res) => {
  const { who, space, sender, pass } = req.chatPicture;
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: 'send a PNG, JPEG, GIF or WebP picture' });
  const mime = chatPictureType(req.body);
  if (!mime || mime !== req.get('content-type')?.split(';')[0].trim().toLowerCase()) return res.status(415).json({ error: 'that is not a PNG, JPEG, GIF or WebP picture' });
  const wait = chatPictureWait(sender, req.body.length);
  if (wait) return tooManyPictures(res, wait);
  if (!who.user) {
    const slug = chatSlug();
    const { wait: guestWait } = guestPostWait([[`${slug}|link|${req.query.guest}`, guestChatPostsPerMinute], [`${slug}|ip|${req.ip || 'unknown'}`, guestChatPostsPerAddress]]);
    if (guestWait) return res.status(429).set('Retry-After', String(guestWait)).json({ error: `too many messages; try again in ${guestWait} ${guestWait === 1 ? 'second' : 'seconds'}` });
  }
  if (chatPostLimited(who.user ? who.user.key : `guest:${space.id}`)) return res.status(429).json({ error: 'too many messages, slow down' });
  countChatPicture(sender, req.body.length);
  const id = crypto.randomBytes(6).toString('hex');
  const by = who.user ? who.user.key : 'guest';
  const at = Date.now();
  const url = chatPictureUrl(space.id, id);
  keepChatPicture(id, { space: space.id, by, at });
  holdChatPicture(space.id, id, req.body, mime, at);
  tellChat(space.id, {
    type: 'chat-picture', id, by,
    who: who.user ? who.user.displayName : pass.name,
    file: cleanText(req.query.file, 120) || 'picture',
    mime,
    size: req.body.length,
    url,
    at,
  });
  res.json({ id, url });
});
// GET /api/spaces/:id/chat/pictures/:pictureId[?guest=<token>&pass=<the guest's pass>]: a held picture's bytes, to
// whoever may read this chat now (chatRead; a guest with a valid pass, else 403). 404 once it has expired
// (CHAT_PICTURE_KEEP_MINUTES), been pushed out or deleted, or never was. Cache-Control private, for its time left.
app.get('/api/spaces/:id/chat/pictures/:pictureId', (req, res) => {
  const found = chatSpaceFor(req, res, 'chatRead');
  if (!found) return;
  if (!found.who.user && !chatGuestPass(req)) return res.status(403).json({ error: `that ${word('guest')} pass is not valid; enter again` });
  const held = CHAT_MESSAGE_ID.test(req.params.pictureId) ? heldChatPicture(found.space.id, req.params.pictureId) : null;
  if (!held) return res.status(404).json({ error: 'that picture is no longer available' });
  const left = Math.max(1, Math.floor((held.at + chatPictureKeepMs - Date.now()) / 1000));
  res.set({ 'Content-Type': held.mime, 'Content-Length': String(held.bytes.length), 'Cache-Control': `private, max-age=${left}`, 'X-Content-Type-Options': 'nosniff' });
  res.end(held.bytes);
});

// --- links in Chat (plan-chat-links.md, GitHub #158) ----------------------------------------------------------------
// The keeper: the first module on in the space (in the environment's module order) that provides an action named
// saveLink taking `url`. Chat never names it. null when none is on.
function chatKeeper(space) {
  for (const found of modules.enabledAll()) {
    const { manifest, entry } = found;
    if (!manifest.scope.includes('space') || !ModuleManager.onInSpace(entry, manifest, space.id)) continue;
    const def = manifest.actions.provides.find((a) => a.name === 'saveLink' && a.input && Object.hasOwn(a.input, 'url'));
    if (def) return { manifest, entry, def };
  }
  return null;
}
// Whether the keeper's Fetch link previews setting is on for the environment (it must declare one).
function keeperPreviews(keeper) {
  if (!keeper || !(keeper.manifest.settings || []).some((s) => s.key === 'linkPreviews')) return false;
  return moduleSettings.values(keeper.manifest, 'environment', {}).linkPreviews === true;
}
// Whether this person may add to the keeper in this space (write access, as POST .../action for a non-local action).
function mayWriteKeeper(who, keeper, space) {
  try {
    busPlace(who, keeper.manifest.id, 'space', space.id, 'write');
    return true;
  } catch (err) {
    if (!err.status) throw err;
    return false;
  }
}
const CHAT_MESSAGE_ID = /^[a-f0-9]{12}$/;

// The author's page asks for its message's preview after posting (decision 7). The page is read only when every rule
// holds; otherwise the message comes back unchanged and nothing leaves the server. A read that fails adds nothing, is
// not retried, and is noted in the activity log, never told to the call.
app.post('/api/spaces/:id/chat/:messageId/preview', async (req, res) => {
  const found = chatSpaceFor(req, res, 'chat');
  if (!found) return;
  const { who, space } = found;
  const me = who.user ? who.user.key : null;
  const messageId = req.params.messageId;
  const message = CHAT_MESSAGE_ID.test(messageId) ? chatHistory.find(space.id, messageId, me) : null;
  if (!message) return res.status(404).json({ error: 'no such message' });
  // A guest's sender is shared by every guest, so a guest is never the author here.
  if (!me || message.by !== me) return res.status(403).json({ error: 'only the person who posted it can ask for its preview' });
  const unchanged = () => res.json({ message: chatHistory.shown(space.id, message) });
  const now = Date.now();
  if (message.visibility === 'private' || message.kind || !message.preview?.url || message.preview.at) return unchanged();
  if (now - message.at > CHAT_LINK_LIMITS.PREVIEW_WINDOW_MS || message.at > now + 60000) return unchanged();
  const keeper = chatKeeper(space);
  if (!keeper || !keeperPreviews(keeper) || !mayWriteKeeper(who, keeper, space)) return unchanged();
  for (const [k, t] of chatPreviewsAsked) if (now - t > CHAT_LINK_LIMITS.PREVIEW_WINDOW_MS * 2) chatPreviewsAsked.delete(k);
  const askedKey = `${space.id}:${message.id}`;
  if (chatPreviewsAsked.has(askedKey)) return unchanged();
  const keeperId = keeper.manifest.id;
  if (overLimit(keeperId, me, 'search')) return res.status(429).json({ error: limitMessage() });
  chatPreviewsAsked.set(askedKey, now);
  let fetched;
  try {
    fetched = await fetchPreview(message.preview.url);
  } catch (err) {
    const why = err instanceof PreviewError ? err.message : 'that page could not be read';
    noteActivity(keeperId, `could not read a link from the chat: ${why}`, me, scopeKeyOf('space', { spaceId: space.id }));
    const now2 = chatHistory.find(space.id, message.id, me);
    return now2 ? res.json({ message: chatHistory.shown(space.id, now2) }) : res.status(404).json({ error: 'no such message' });
  }
  // Read into the message as it is now: deleted meanwhile is gone; made private meanwhile keeps its preview, unannounced.
  const out = chatHistory.setPreview(space.id, message.id, keeperId, readFields(fetched));
  if (!out) return res.status(404).json({ error: 'no such message' });
  if (out.changed && out.message.visibility !== 'private') tellChat(space.id, { type: 'chat-preview', id: out.message.id, preview: out.message.preview });
  res.json({ message: out.message });
});

// The picture of a message's preview, read here so no browser asks another site (as Research's link-image). 404, with
// no body, unless the caller can read the message, it has a picture, and the keeper is on here with its setting on:
// turning Fetch link previews off stops the picture, while a stored title and description still show.
app.get('/api/spaces/:id/chat/:messageId/image', async (req, res) => {
  const found = chatSpaceFor(req, res, 'chatRead');
  if (!found) return;
  const { who, space } = found;
  const reader = who.user ? who.user.key : null;
  const messageId = req.params.messageId;
  const message = CHAT_MESSAGE_ID.test(messageId) ? chatHistory.find(space.id, messageId, reader) : null;
  const address = message?.preview?.image;
  if (!address || typeof address !== 'string') return res.status(404).end();
  const keeper = chatKeeper(space);
  if (!keeper || !keeperPreviews(keeper)) return res.status(404).end();
  try {
    let image = cachedImage(address);
    if (!image) {
      if (overLimit(keeper.manifest.id, reader || 'guest', 'search')) return res.status(429).end();
      image = await fetchImage(address);
    }
    res.set('Content-Type', image.type);
    res.set('Cache-Control', 'private, max-age=600');
    res.send(image.body);
  } catch {
    res.status(404).end();
  }
});

// Keep (decision 4): the message's link saved into the keeper, as the person who kept it. The input is built here from
// the stored message, never from the page, so a page cannot keep something the message does not say. Once per message
// (decision 11): a second Keep answers `kept` and asks for nothing.
app.post('/api/spaces/:id/chat/:messageId/keep', (req, res) => {
  const found = chatSpaceFor(req, res, 'chat');
  if (!found) return;
  const { who, space } = found;
  const me = who.user ? who.user.key : null;
  const messageId = req.params.messageId;
  const message = CHAT_MESSAGE_ID.test(messageId) ? chatHistory.find(space.id, messageId, me) : null;
  if (!message || !message.preview?.url) return res.status(404).json({ error: 'no such message' });
  const keeper = chatKeeper(space);
  if (!keeper) return res.status(404).json({ error: 'nothing here can keep links' });
  const keeperId = keeper.manifest.id;
  let provider;
  try {
    provider = busPlace(who, keeperId, 'space', space.id, keeper.def.local ? 'read' : 'write');
  } catch (err) {
    if (!err.status) throw err;
    return res.status(403).json({ error: `you cannot add to ${shownModule(keeper.manifest).name || keeper.manifest.name} here` });
  }
  if (message.kept) return res.json({ status: 'kept', message: chatHistory.shown(space.id, message) });
  if (chatPostLimited(me || `guest:${space.id}`)) return res.status(429).json({ error: 'too many messages, slow down' });
  if (chatRequestLimited(who, space)) return res.status(429).json({ error: CHAT_REQUESTS_REFUSAL });
  const p = message.preview;
  let input;
  try {
    input = busInput(who, keeper.def.input, { url: p.url, ...(p.title ? { title: p.title } : {}), ...(p.description ? { excerpt: p.description } : {}) }, takerOf(who, keeper.manifest, keeper.def, space.id));
  } catch (err) {
    if (!err.status) throw err;
    return res.status(err.status).json({ error: err.message });
  }
  const request = moduleBus.request({
    from: keeperId,
    provider: keeperId,
    action: 'saveLink',
    input,
    scopeKey: provider.scopeKey,
    by: me || 'guest',
    local: keeper.def.local,
  });
  const out = chatHistory.setKept(space.id, message.id, { by: me || 'guest', who: who.user ? who.user.displayName : word('guest', { cap: true }), at: Date.now() });
  if (!out) return res.status(404).json({ error: 'no such message' });
  if (out.changed && out.message.visibility !== 'private') tellChat(space.id, { type: 'chat-kept', id: out.message.id, kept: out.message.kept });
  res.json({ id: request.id, status: request.status, message: out.message });
});

// --- AI: the policy, the context and the doors (plan-ai-integration.md, slice 1) -----------------------------------------------
// Every AI route and every availability route asks the one policy (server/ai-policy.js); the context is built by
// server/ai-context.js through it; what is said to the model is the prompt registry's (server/prompts/); the request is the
// provider adapters' (server/ai-providers.js), through ai.run, which keeps the usage and the call records.
const aiPolicy = createAiPolicy({
  store, ai, modules, word, limits: moduleLimits, hasOwnerRights,
  resolveRef: (...args) => resolveRef(...args),
  aiCallsRefusal: (pending) => aiCallsRefusal(pending),
});
// A person's role word in a space, as the AI is told it: owner, moderator (ticked for the space), else their role's.
function aiRoleWord(user, space) {
  if (hasOwnerRights(user)) return word('owner');
  if (space && moderates(user, space)) return word('moderator');
  return ['moderator', 'member', 'guest'].includes(user.role) ? word(user.role) : word('member');
}
// The summaries (no text) of every object `who` may read in one place ({ scope: 'space', space } or { scope: 'environment' }),
// across every enabled module that shares a kind -- the pool the context builder picks the relevant objects from. A copy is
// left out when its original is there too.
function aiObjectsIn(who, where) {
  const pool = [];
  const pairs = moduleLinks.pairIndex();
  for (const { manifest } of modules.enabledAll()) {
    for (const produce of manifest.refs.produces) {
      let at;
      try { at = refScope(who, { provider: manifest.id, kind: produce.kind, scope: where.scope, space: where.space, skipConsumer: true }); } catch { continue; }
      const prefix = at.produce.key.replace('{id}', '');
      for (const item of objectRows(at, prefix)) {
        if (!item.value || !REF_ID_RE.test(item.key.slice(prefix.length))) continue;
        pool.push(markPair(objectSummary(at, item.key.slice(prefix.length), item.value), pairs));
      }
    }
  }
  const seen = new Set(pool.map((s) => objectKey(s.ref)));
  return pool.filter((s) => !(s.copy && seen.has(objectKey(s.twinOf))));
}
const aiContext = createContextBuilder({
  store, chatHistory, moduleLinks, policy: aiPolicy, word, listObjects: aiObjectsIn, roleWordOf: aiRoleWord,
  guestsIn: (space) => live.people(space.id).filter((p) => p.guest).map((p) => p.name),
  // The chat part goes only to an asker who may read this chat now (chatAccess's rule: an owner, or a member with chatRead).
  canReadChat: (who, space) => Boolean(who && who.user && (hasOwnerRights(who.user) || (space.members.includes(who.user.key) && store.spacePermissions(who.user.key, space.id).chatRead))),
  serverZone: () => ics.serverZone(),
  timelineOf: phaseRule.timelineOf,
  templatePhases: () => (Array.isArray(store.templatePhases) ? store.templatePhases : []),
});
// The read tools for Chat's /ai and the Assistant view (slice 2, server/ai-tools.js): the same pool as the rollup's, read as
// the person, every result admitted by the policy with part `lookup`.
const aiTools = createAiTools({ policy: aiPolicy, listObjects: aiObjectsIn, moduleLinks });
// The template's words a prompt uses.
const aiWords = () => ({ object: word('object'), objects: word('object', { many: true }), space: word('space') });
// What a call record and an answer keep of `sent`: the counts, never the pointers' content.
const sentCounts = (sent) => ({ attached: sent.attached.length, relevant: sent.relevant, linked: sent.linked, history: sent.history, chat: sent.chat, members: sent.members });
const aiUse = (who, spaceId, purpose, built) => ({ purpose, person: who.user.key, space: spaceId || undefined, environment: currentEnvironment().slug || undefined, counts: sentCounts(built.sent), leftOut: built.leftOut.length ? built.leftOut : undefined });
// A refusal answered and recorded (never the question): the status and its one sentence.
function refuseAi(res, r, { who, space, purpose }) {
  ai.log({ purpose, person: who && who.user ? who.user.key : undefined, space: space ? space.id : undefined, environment: currentEnvironment().slug || undefined, outcome: 'refused', reason: r.reason });
  if (r.retrySeconds) res.set('Retry-After', String(r.retrySeconds));
  return res.status(r.status).json({ error: r.why });
}
// The question as sent, checked: { question } (cleaned, '' when none was sent) or { error } with its sentence. The route
// refuses one over 1,000 characters rather than cutting it (ai-22).
function aiQuestionOf(raw) {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return { error: 'The question must be text.' };
  const q = prompts.cleanQuestion(raw);
  const n = [...q].length;
  if (n > prompts.MAX_QUESTION) return { error: `A question is at most ${prompts.MAX_QUESTION.toLocaleString('en-US')} characters; this one is ${n.toLocaleString('en-US')}.` };
  if (n && n < prompts.MIN_QUESTION) return { error: `Ask a question of at least ${prompts.MIN_QUESTION} characters.` };
  return { question: q };
}
// The pointers sent as `refs` (Chat) or `objects` (a module): up to 12, each an object.
const aiRefsOf = (raw) => (Array.isArray(raw) ? raw.slice(0, prompts.MAX_MATERIAL).filter((r) => r && typeof r === 'object' && !Array.isArray(r)) : []);
// An answer's numbers ([n] in `used`, `sources` in its objects) as the pointers they stand for.
const aiPointers = (numbers, numbered) => [...new Set((numbers || []).map((n) => numbered[n - 1]).filter(Boolean))];
const aiSummaries = (summaries, numbered) => (summaries || []).map((c) => ({ ...c, sources: aiPointers(c.sources, numbered) }));
// What a template is called in the activity list, in plain words.
const AI_TASK_WORDS = { ask: 'a question', summarise: 'a summary', tags: 'tags' };
function countAiCall() {
  if (BASE_DOMAIN && hostRegistry) {
    const slug = currentEnvironment().slug;
    if (slug) hostRegistry.recordAiCall(slug);
  }
}
function sendAiError(err, res) {
  if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
  throw err;
}

// Chat's /ai, the Assistant view and host.chat.ask: who may ask here, before a question is typed.
app.get('/api/spaces/:id/ai', (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'Sign in first.' });
  const space = store.spaceById(req.params.id);
  if (!space) return res.status(404).json({ error: `No such ${word('space')}.` });
  res.json(aiPolicy.availability(who, space, 'chat'));
});

// One question (template ask, purpose chat), with the asker's last turns here and the space's rollup. `refs`: up to 12 of
// this space's objects (another space's are left out and said to be); `question`: 3 to 1,000 characters, or none with an
// attached object (the template's default question); `tz`: the asker's time zone. Both kept as the asker's private messages
// (plan-chat-model.md); the answer carries `prompt`, `sent`, `used` and `cut`. With What AI may see `lookup` on, the AI may
// look this space's objects up as the asker (slice 2): `sent.lookup` is { searches, read } (read: the objects it read, as
// pointers, which join `used`), and `numbered` holds the numbers the look-ups gave out too.
app.post('/api/spaces/:id/ai', async (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'Sign in first.' });
  const space = store.spaceById(req.params.id);
  if (!space) return res.status(404).json({ error: `No such ${word('space')}.` });
  const allowed = aiPolicy.check(who, space, 'chat');
  if (!allowed.ok) return refuseAi(res, allowed, { who, space, purpose: 'chat' });
  const asked = aiQuestionOf(req.body?.question);
  if (asked.error) return res.status(400).json({ error: asked.error });
  const refs = aiRefsOf(req.body?.refs);
  if (!asked.question && !refs.length) return res.status(400).json({ error: 'Ask a question.' });
  const template = prompts.template('ask');
  const built = aiContext.build(who, space, { template, question: asked.question, refs, tz: req.body?.tz });
  const question = asked.question || (built.material.length ? template.defaultQuestion(built.material[0].title) : '');
  if (!question) return res.status(400).json({ error: `Ask a question: the ${word('object')} you chose can't be sent to the AI.`, leftOut: built.leftOut });
  // A bad ask is refused before it is counted: only asks that are carried out use the person's turns.
  const turn = aiPolicy.takeTurn(who);
  if (!turn.ok) return refuseAi(res, turn, { who, space, purpose: 'chat' });
  const me = who.user.key;
  const askedAt = Date.now();
  try {
    const inputs = { question: aiPolicy.redact(question, aiPolicy.secrets()), material: built.material, context: built.context, history: built.history, kinds: promptKinds(), words: aiWords() };
    const toolbox = aiTools.toolbox(who, space, built, { words: aiWords(), contract: template.schema(inputs) });
    const out = await ai.run('ask', inputs, aiUse(who, space.id, 'chat', built), { secrets: aiPolicy.secrets(), toolbox });
    countAiCall();
    const numbered = out.numbered || built.numbered;
    const summaries = aiSummaries(out.summaries, numbered);
    // The objects the AI read join what it used, once each.
    const used = [];
    for (const r of [...aiPointers(out.used, numbered), ...(out.lookup ? out.lookup.read : [])]) if (!used.some((u) => objectKey(u) === objectKey(r))) used.push(r);
    const sent = out.lookup ? { ...built.sent, lookup: out.lookup } : built.sent;
    const q = chatHistory.add(space.id, { by: me, who: who.user.displayName, text: question, visibility: 'private', kind: 'command', command: 'ai', at: askedAt });
    const a = chatHistory.add(space.id, { by: me, who: 'AI', text: out.text, visibility: 'private', kind: 'ai', summaries, replyTo: q ? q.id : undefined, prompt: out.prompt, sent, used, numbered, leftOut: built.leftOut, cut: out.cut });
    noteActivity('chat', `asked the AI (${AI_TASK_WORDS.ask}, ${out.tokens} tokens)`, me, space.id);
    res.json({ text: out.text, summaries, used, numbered, cut: out.cut, tokens: out.tokens, prompt: out.prompt, sent, leftOut: built.leftOut, shared: false, at: a && a.at, id: a && a.id, questionId: q && q.id, question: q, message: a });
  } catch (err) {
    // Failed before the service did any work, or on this server's side (not an AiError): it does not count. A question that
    // failed after a round was billed (`paid`) used the service, so it counts against the month's calls, once; a plain 400 on
    // the first round, with nothing billed, is not a call.
    if (!(err instanceof AiError) || err.refund) aiPolicy.giveBack(who);
    else if (err.paid) countAiCall();
    sendAiError(err, res);
  }
});

// Paste import from Chat (decision 12: not AI use): signed in, not a guest, in the space. { available, why }.
function importSpaceOf(req, res) {
  const who = moduleViewer(req);
  if (!who || who.keyed) { res.status(401).json({ error: 'Sign in first.' }); return null; }
  const space = store.spaceById(req.params.id);
  if (!space) { res.status(404).json({ error: `No such ${word('space')}.` }); return null; }
  if (who.user && !(hasOwnerRights(who.user) || space.members.includes(who.user.key))) { res.status(403).json({ error: `You are not in this ${word('space')}.` }); return null; }
  if (!who.user && !(who.guestSpace && who.guestSpace.id === space.id)) { res.status(403).json({ error: `You are not in this ${word('space')}.` }); return null; }
  return { who, space };
}
app.get('/api/spaces/:id/objects/check', (req, res) => {
  const found = importSpaceOf(req, res);
  if (!found) return;
  const why = aiPolicy.importRefusal(found.who);
  res.json({ available: !why, why });
});

// How many requests one person may ask for from Chat (Keep, Keep ticked, Send to..., a command), together, in a minute:
// the same 60 a module may ask for through the bus (MODULE_LIMITS.action), counted once across every module, so Keep
// ticked on a 50-object import fits and one person cannot push everyone's waiting requests past the bus's cap. Guests
// of a space share one count, as they share one sender. The limiter is the modules' own (module-limits.js) under a key
// no module id can take; it is not noted in the activity list, which is about modules.
const CHAT_REQUESTS = '#chat';
const chatRequestLimited = (who, space) => !moduleLimits.take(CHAT_REQUESTS, who.user ? who.user.key : `guest:${space.id}`, 'action').ok;
const CHAT_REQUESTS_REFUSAL = 'too many requests in a minute, slow down';

// Chat routes `/<name> <text>` to the module that registered that command. The module must be placed in the
// space; whether it is open is the page's to check. Two modules with the same name: `module` picks one.
app.post('/api/spaces/:id/command', (req, res) => {
  const found = chatSpaceFor(req, res, 'chat');
  if (!found) return;
  const name = String(req.body?.name || '').trim();
  const text = String(req.body?.text || '');
  const want = String(req.body?.module || '').trim();
  if (!/^[a-z0-9]{1,12}$/.test(name) || name === 'ai') return res.status(400).json({ error: `No command /${name}` });
  const who = found.who;
  const space = found.space;
  const perms = modulePerms(who, space.id);
  const matches = modules.enabledAll()
    .filter(({ manifest, entry }) => manifest.scope.includes('space') && ModuleManager.onInSpace(entry, manifest, space.id) && moduleSpaceAccess(entry, who, space) && moduleCan(manifest, perms, 'read'))
    .flatMap(({ manifest }) => (manifest.commands || []).filter((c) => c.name === name).map((c) => ({ module: manifest.id, moduleName: shownModule(manifest).name || manifest.name, action: c.action, label: c.label })));
  if (!matches.length) return res.status(404).json({ error: `No command /${name}` });
  const pick = want ? matches.filter((m) => m.module === want) : matches;
  if (pick.length > 1) {
    return res.status(409).json({ error: `which ${word('module')}`, choices: pick.map((m) => ({ module: m.module, name: m.moduleName })) });
  }
  if (!pick.length) return res.status(404).json({ error: `No command /${name}` });
  const chosen = pick[0];
  const provider = busPlace(who, chosen.module, 'space', space.id, 'read');
  const def = provider.found.manifest.actions.provides.find((a) => a.name === chosen.action);
  if (!def || !def.local) return res.status(404).json({ error: `that ${word('module')} does not offer that action` });
  let input;
  try {
    input = busInput(who, def.input, { text }, takerOf(who, provider.found.manifest, def, space.id));
  } catch (err) {
    if (!err.status) throw err;
    return res.status(err.status).json({ error: err.message });
  }
  if (chatRequestLimited(who, space)) return res.status(429).json({ error: CHAT_REQUESTS_REFUSAL });
  const request = moduleBus.request({
    from: chosen.module,
    provider: chosen.module,
    action: chosen.action,
    input,
    scopeKey: provider.scopeKey,
    by: who.user?.key || 'guest',
    local: true,
  });
  // The echo, kept as the caller's private message (plan-chat-model.md, decision 8); a guest's stays on their page.
  const message = who.user
    ? chatHistory.add(space.id, { by: who.user.key, who: who.user.displayName, text, visibility: 'private', kind: 'command', command: name, module: chosen.module })
    : null;
  res.json({ id: request.id, status: request.status, module: chosen.module, moduleName: chosen.moduleName, message });
});

// Actions placed modules offer in this space, so Chat can Keep and route without naming a module.
app.get('/api/spaces/:id/actions', (req, res) => {
  const found = chatSpaceFor(req, res, 'chatRead');
  if (!found) return;
  const who = found.who;
  const space = found.space;
  const perms = modulePerms(who, space.id);
  const actions = [];
  for (const { manifest, entry } of modules.enabledAll()) {
    if (!manifest.scope.includes('space') || !ModuleManager.onInSpace(entry, manifest, space.id)) continue;
    if (!moduleSpaceAccess(entry, who, space) || !moduleCan(manifest, perms, 'read')) continue;
    const shown = shownModule(manifest);
    let writable = null;
    const mayWrite = () => {
      if (writable === null) {
        try { busPlace(who, manifest.id, 'space', space.id, 'write'); writable = true; } catch (err) { if (!err.status) throw err; writable = false; }
      }
      return writable;
    };
    for (const a of manifest.actions.provides) {
      actions.push({
        action: `${manifest.id}:${a.name}`,
        module: manifest.id,
        moduleName: shown.name || manifest.name,
        name: a.name,
        label: a.label,
        input: a.input,
        local: Boolean(a.local),
        // Only the caller's own page of the module carries it out (what it makes is theirs), when they next open it.
        ...(a.askerOnly ? { askerOnly: true } : {}),
        // What a request must carry (the Calendar's createEvent needs ["date"]), as GET /api/bus/actions says it.
        ...(a.needs ? { needs: a.needs } : {}),
        // What objects it takes (plan-object-handoff.md, "What modules declare"), when it says, each entry with whether
        // this caller holds its permission.
        ...(a.takes ? { takes: takesFor(manifest, a, perms) } : {}),
        // Whether this caller can carry it out here (plan-chat-links.md, decision 10): read access for a local
        // action (already true to be listed), write access for any other; and, with `takes`, some entry they may use.
        may: (a.local ? true : mayWrite()) && (!a.takes || takesFor(manifest, a, perms).some((e) => e.may)),
      });
    }
  }
  res.json({ actions });
});

app.post('/api/spaces/:id/action', (req, res) => {
  const found = chatSpaceFor(req, res, 'chat');
  if (!found) return;
  const [providerId, name] = String(req.body?.action || '').split(':');
  if (!providerId || !name) return res.status(400).json({ error: `that ${word('module')} does not offer that action` });
  const who = found.who;
  const space = found.space;
  let provider;
  try {
    provider = busPlace(who, providerId, 'space', space.id, 'read');
  } catch (err) {
    return res.status(err.status || 404).json({ error: err.message });
  }
  const def = provider.found.manifest.actions.provides.find((a) => a.name === name);
  if (!def) return res.status(404).json({ error: `that ${word('module')} does not offer that action` });
  if (!def.local) {
    try { busPlace(who, providerId, 'space', space.id, 'write'); } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }
  }
  // A refusal of the input (a field missing, an object of a kind the action does not take) is its own status, not a 500.
  let input;
  try {
    input = busInput(who, def.input, req.body?.input, takerOf(who, provider.found.manifest, def, space.id));
  } catch (err) {
    if (!err.status) throw err;
    return res.status(err.status).json({ error: err.message });
  }
  if (chatRequestLimited(who, space)) return res.status(429).json({ error: CHAT_REQUESTS_REFUSAL });
  const request = moduleBus.request({
    from: providerId,
    provider: providerId,
    action: name,
    input,
    scopeKey: provider.scopeKey,
    by: who.user?.key || 'guest',
    local: def.local,
    // What it makes is the sender's (Research's savePhoto: a photo in their name, from their upload): only their own page
    // takes it, so nobody else's page is refused it and the picture is never lost (QA round 2, failure 1).
    askerOnly: def.askerOnly,
    // A view (Polls' draftPoll) opens a form on the person's own open page; Chat sends it only when the module is open,
    // so it is handed out for a minute and never waits for the module's next opening (BUS_LIMITS.openOnlyMs).
    openOnly: Boolean(def.local),
  });
  res.json({ id: request.id, status: request.status });
});

// How a request this person made in this space went (plan-object-handoff.md, step 9: Chat's note after Keep and Send
// to...), read as the module SDK's wait does: ask again every half second or so for a few seconds. Only the person who
// asked reads it; anyone else, and a request from another place, is "no such request". A guest's requests all carry the
// same sender, so a guest is refused rather than shown another guest's. Only the outcome comes back (never the input or
// the module's other data): `ok`, the module's `error` sentence and its `data.note`, each one line of at most 300
// characters, for BUS_LIMITS.resultMs after it finished.
const ACTION_NOTE_MAX = 300;
const oneLineNote = (v) => (typeof v === 'string' ? v.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, ACTION_NOTE_MAX) : '');
app.get('/api/spaces/:id/action/:requestId', (req, res) => {
  const found = chatSpaceFor(req, res, 'chatRead');
  if (!found) return;
  const { who, space } = found;
  if (!who.user) return res.status(403).json({ error: `${word('guest', { many: true, cap: true })} can't see how a request went` });
  if (!/^[1-9][0-9]{0,15}$/.test(req.params.requestId)) return res.status(400).json({ error: 'a request id is a whole number' });
  const request = moduleBus.actionById(Number(req.params.requestId));
  const now = Date.now();
  if (!request || request.by !== who.user.key || request.scopeKey !== scopeKeyOf('space', { spaceId: space.id })
    || (request.status === 'done' && now - (request.doneAt || request.at) > BUS_LIMITS.resultMs)) {
    return res.status(404).json({ error: 'no such request' });
  }
  const status = moduleBus.statusOf(request);
  const out = { id: request.id, status };
  if (status === 'done') {
    out.ok = Boolean(request.result?.ok);
    const error = oneLineNote(request.result?.error);
    if (!out.ok && error) out.error = error;
    const note = oneLineNote(request.result?.data?.note);
    if (note) out.note = note;
  }
  res.json(out);
});

// --- a module's page reading every space the viewer belongs to ---------------
// A module with a server page and a space panel (the Calendar) can show, on its page, what is
// stored in each of the viewer's spaces. Only spaces the viewer is a member of count (not every
// space an owner could open), the module must be on for the space, and the viewer's role must
// be allowed to read it there. Read-only: writes always go to one scope.

// A Font Awesome icon as inline SVG, for a module's sandboxed frame, which cannot load the icon font.
function iconSvg(id) {
  if (iconSvgs.has(id)) return iconSvgs.get(id);
  const icon = (store.settings.icons || []).find((i) => i.id === id);
  const classes = icon?.classes || `fa-solid fa-${id}`;
  const style = /fa-brands/.test(classes) ? 'brands' : /fa-regular/.test(classes) ? 'regular' : 'solid';
  const name = classes.split(/\s+/).filter((c) => c.startsWith('fa-')).map((c) => c.slice(3)).find((n) => !['solid', 'regular', 'brands', 'fw'].includes(n));
  const svg = name && /^[a-z0-9-]+$/.test(name) ? faSvg(style, name) : null;
  iconSvgs.set(id, svg);
  return svg;
}

// An icon's SVG, from the admin's Pro package first (if it has this style and icon), then the bundled Free set; null if
// neither does. `style`/`name` are checked by the caller (a route param or a value already drawn from known-good data).
function faSvg(style, name) {
  for (const dir of hasFaPro ? [faProDir, faDir] : [faDir]) {
    try {
      return fs.readFileSync(path.join(dir, 'svgs', style, `${name}.svg`), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
    } catch {
      // try the next place, or give up
    }
  }
  return null;
}

// A Font Awesome icon as inline SVG, by style and name, for a module's widget in a sandboxed frame (which cannot
// load the icon font). Anyone may ask, signed in or not, as for the icon font itself (/fa/css, /fa/webfonts), so a
// space's guests, whose pages carry no session, get their icons too.
app.get('/api/icons/:style/:name', (req, res) => {
  const { style, name } = req.params;
  if (!['solid', 'regular', 'brands'].includes(style) || !/^[a-z0-9-]{1,40}$/.test(name)) return res.status(400).json({ error: 'no such icon' });
  const svg = faSvg(style, name);
  if (!svg) return res.status(404).json({ error: 'no such icon' });
  res.type('image/svg+xml').set('Cache-Control', 'private, max-age=86400').send(svg);
});

// The spaces a signed-in viewer belongs to where this module is on and they may read it, in the space list's order.
const readableSpacesOf = ({ manifest, entry }, who) => (manifest.scope.includes('space') ? store.spaces.filter((r) => r.members.includes(who.user.key)
  && modules.isOnIn(entry.id, r.id) && moduleCan(manifest, modulePerms(who, r.id), 'read')) : []);
// The viewer's spaces for this module, or null after sending the error.
function moduleSpacesFor(req, res) {
  const found = modules.enabled(req.params.id);
  if (!found) return void res.status(404).json({ error: `no such ${word('module')}` });
  const who = moduleViewer(req);
  if (!who?.user) return void res.status(403).json({ error: `${word('guest', { many: true })} can only use ${word('module', { a: true })} in ${word('space', { a: true })}` });
  const { manifest } = found;
  if (!manifest.scope.includes('space')) return void res.status(400).json({ error: `this ${word('module')} has no space scope` });
  if (!moduleCan(manifest, modulePerms(who, null), 'read')) return void res.status(403).json({ error: `your role can't do that in this ${word('module')}` });
  return { manifest, who, spaces: readableSpacesOf(found, who) };
}
// A space's icon: its launch link's when one was chosen, else the template's home icon (a suitcase for trips), else a
// neutral one. Never a chat bubble: a space is not a conversation.
const SPACE_ICON = 'folder';
const spaceSummary = (r) => {
  const icon = r.linkIcon && r.linkIcon !== 'link' ? r.linkIcon : store.templateHomeIcon || SPACE_ICON;
  return { id: r.id, name: r.name, icon, svg: iconSvg(icon) };
};

// Each space also says whether the viewer may write there (`write`: the module's write permission in that space,
// plan-calendar-destination.md, "Server"), so an environment page knows where it may add.
app.get('/api/modules/:id/spaces-data', (req, res) => {
  const found = moduleSpacesFor(req, res);
  if (!found) return;
  const spaces = found.spaces.map((r) => ({ ...spaceSummary(r), write: moduleCan(found.manifest, modulePerms(found.who, r.id), 'write') }));
  if (req.query.info) return res.json({ spaces });
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
  const items = found.spaces.flatMap((r) => moduleData.list(found.manifest.id, scopeKeyOf('space', { spaceId: r.id }), prefix).map((item) => ({ ...item, spaceId: r.id })));
  res.json({ spaces, items });
});

// --- calendar feeds (documentation/plans/plan-google-calendar.md, Part 1; plan-space-calendars.md, sections 1 and 2) ---
// Three kinds of address, one route. A person's private address shares the events they can read with their own
// calendar app; their address for one space shares that space's events only (one token per person per space); the
// environment's published calendar is one address owners hand out, holding every space's events whoever reads it. Each
// token is shown once and kept only as its SHA-256 (store.setCalendarFeed, setSpaceCalendarFeed,
// setPublishedCalendarFeed); /feed/<token>.ics is looked up in the environment the request reached, so one
// environment's address is 404 at another. Nothing here names a module: a kind offers itself with "feed": true beside
// "dated" (cleanRefs in server/modules.js), and is read with the person's rights at each read (the published one with
// nobody's).
const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const FEED_READS_PER_MINUTE = 30;
const FEED_MAX_EVENTS = 2000;
const FEED_NOT_HERE = 'There is no calendar at this address.';
const FEED_NOTHING = 'There are no events here you can add to a calendar app.';
const feedHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newFeedToken = () => crypto.randomBytes(32).toString('base64url');
// What anyone but the holder sees of an address: whether there is one, when it was made and last read. Never the hash.
const feedView = (feed) => ({ on: Boolean(feed), made: feed?.made || null, readAt: feed?.readAt || null });
const calendarFeedView = (u) => feedView(u.calendarFeed);
const feedKinds = (manifest) => manifest.refs.produces.filter((p) => p.feed && p.dated);

// The enabled modules with a kind offered to the feed, each with those kinds: the ones this person may read at
// environment level (the spaces-data rule's first test), or, with `space`, the ones on in that space that they may read
// there.
function feedModulesFor(who, space = null) {
  const perms = modulePerms(who, space ? space.id : null);
  return modules.enabledAll()
    .map((found) => ({ ...found, kinds: feedKinds(found.manifest) }))
    .filter(({ manifest, entry, kinds }) => kinds.length && moduleCan(manifest, perms, 'read')
      && (!space || (manifest.scope.includes('space') && modules.isOnIn(entry.id, space.id))));
}
const feedAllowed = (who) => store.settings.calendarFeeds === true && feedModulesFor(who).length > 0;

// The module whose events the addresses carry, as this environment names it: the enabled one offering a kind, else an
// installed one that is off, else one that ships here; { id, name, on }, or null when nothing here could ever offer one.
function feedModule() {
  const enabled = modules.enabledAll().find(({ manifest }) => feedKinds(manifest).length);
  if (enabled) return { id: enabled.manifest.id, name: modules.shownName(enabled.manifest), on: true };
  for (const id of Object.keys(modules.registry.modules)) {
    const manifest = modules.manifestOf(id, modules.registry.modules[id].version);
    if (manifest && feedKinds(manifest).length) return { id, name: modules.shownName(manifest), on: false };
  }
  const bundled = bundledModules(BUNDLED_DIR).find((b) => (b.refs?.produces || []).some((p) => p.feed && p.dated) && moduleAllowedByPlan(b.id));
  return bundled ? { id: bundled.id, name: store.moduleDisplay(bundled.id).name || bundled.name, on: false } : null;
}

// Why nobody here can hold an address right now, in one sentence, or null: the switch is off (an owner is told where
// to turn it on), the module that would offer events is off, or nothing here offers any. plan-space-calendars.md's
// "why can't I" states.
function addressesWhy(user) {
  const here = store.settings.environmentName || `this ${word('environment')}`;
  const module = feedModule();
  if (store.settings.calendarFeeds !== true) {
    const off = `${word('owner', { many: true, cap: true })} have not turned on private addresses in ${here}.`;
    return hasOwnerRights(user) && module ? `${off} Turn it on in ${module.name}'s configuration.` : off;
  }
  if (module?.on) return null;
  return module ? `${module.name} is off in ${here}.` : `No ${word('module')} here has events to add to a calendar app.`;
}
// Why this person can't hold an address for this space, or null when they can: not a member (an owner or the admin
// who is not one gets none either), the environment's reason above, or the module off or unreadable for them there.
function spaceAddressWhy(user, space) {
  if (!space.members.includes(user.key)) return `You are not in this ${word('space')}.`;
  const why = addressesWhy(user);
  if (why) return why;
  if (!feedModulesFor({ user, guestSpace: null }, space).length) return `${feedModule().name} is off in this ${word('space')}.`;
  return null;
}

// Reads `sources` ([{ manifest, kinds, places: [{ scopeKey, space }] }]) as server/ics.js writes them. Long past events
// are left out; at most 2000, the latest kept. `destinationFor(module id)`: the Calendar destination's path when the link
// should go there, else null for the module's own page. `nameSpaces`: whether each description starts with the space's
// (or the environment's) name.
function readFeed(req, sources, { destinationFor, nameSpaces, published = false }) {
  const tz = ics.serverZone();
  const base = baseUrl(req);
  const host = new URL(base).hostname;
  const environmentName = store.settings.environmentName || '';
  const now = Date.now();
  const out = [];
  for (const { manifest, kinds, places } of sources) {
    // The published calendar is read with nobody's rights: every field kept from guests (guards.hidden) is left out of what
    // it reads, its dates and words alike; a module whose hidden fields can't be read is left out altogether.
    if (published && manifest.guards?.shut) continue;
    const hidden = published ? manifest.guards?.hidden || [] : [];
    const destination = destinationFor(manifest.id);
    for (const kind of kinds) {
      const prefix = kind.key.replace('{id}', '');
      for (const { scopeKey, space } of places) {
        for (const stored of moduleData.list(manifest.id, scopeKey, prefix)) {
          const row = hidden.length ? { ...stored, value: moduleGuards.hide(stored.value, hidden) } : stored;
          const id = row.key.slice(prefix.length);
          if (!REF_ID_RE.test(id)) continue;
          const read = ics.readDated(row.value, kind.dated, tz);
          if (!read || !ics.recentEnough(read, now)) continue;
          const ref = { module: manifest.id, kind: kind.kind, id, scope: space ? 'space' : 'environment', ...(space ? { space: space.id } : {}) };
          const hash = `#ref=${encodeURIComponent(JSON.stringify(ref))}`;
          const url = destination ? `${base}${destination}${hash}` : `${base}/modules/${encodeURIComponent(manifest.id)}${space ? `?space=${encodeURIComponent(space.id)}` : ''}${hash}`;
          const own = kind.summary.subtitle && typeof row.value?.[kind.summary.subtitle] === 'string' ? row.value[kind.summary.subtitle].trim() : '';
          out.push({
            ...read,
            uid: `${kind.kind}-${id}-${space ? space.id : 'environment'}@${host}`,
            stamp: Date.parse(row.updatedAt),
            description: [nameSpaces ? (space ? space.name : environmentName) : '', own, url].filter(Boolean).join('\n'),
            url,
          });
        }
      }
    }
  }
  const startMs = (e) => (e.allDay ? Date.parse(`${e.start}T00:00:00Z`) : e.start);
  out.sort((a, b) => startMs(a) - startMs(b) || (a.uid < b.uid ? -1 : 1));
  return { events: out.slice(-FEED_MAX_EVENTS), tz };
}
const spacePlace = (r) => ({ scopeKey: scopeKeyOf('space', { spaceId: r.id }), space: r });
const environmentPlace = { scopeKey: 'environment', space: null };

// The personal address: every event the person may read, the environment's own where the module has that scope, and
// each space they are a member of where it is on and readable.
function feedEvents(req, user) {
  const who = { user, guestSpace: null };
  const ctx = destinationContext(who);
  const sources = feedModulesFor(who).map((found) => ({
    ...found,
    places: [...(found.manifest.scope.includes('environment') ? [environmentPlace] : []), ...readableSpacesOf(found, who).map(spacePlace)],
  }));
  return readFeed(req, sources, { destinationFor: (id) => destinationPathOf(id, ctx), nameSpaces: true });
}
// A space address: that one space's events, with the person's rights there; the description leaves the space's name
// out, since the calendar is named after it.
function spaceFeedEvents(req, user, space) {
  const who = { user, guestSpace: null };
  const ctx = destinationContext(who);
  const sources = feedModulesFor(who, space).map((found) => ({ ...found, places: [spacePlace(space)] }));
  return readFeed(req, sources, { destinationFor: (id) => destinationPathOf(id, ctx), nameSpaces: false });
}
// The published calendar: no person's rights. The environment's own events and every space's (never the Lobby, which
// has no members of its own; asides hold no modules) where the module is on, except spaces left out
// (space.publishCalendar === false). The link goes to the Calendar destination when it is shown.
function publishedFeedEvents(req) {
  const ctx = { settings: store.settings, enabled: modules.enabledAll(), canRead: (manifest) => manifest.scope.includes('environment'), hasFile: moduleHasFile };
  const sources = modules.enabledAll()
    .map((found) => ({ ...found, kinds: feedKinds(found.manifest) }))
    .filter(({ kinds }) => kinds.length)
    .map((found) => ({
      ...found,
      places: [
        ...(found.manifest.scope.includes('environment') ? [environmentPlace] : []),
        ...(found.manifest.scope.includes('space') ? store.spaces.filter((r) => !r.isLobby && r.publishCalendar !== false && modules.isOnIn(found.entry.id, r.id)).map(spacePlace) : []),
      ],
    }));
  return readFeed(req, sources, { destinationFor: (id) => destinationPathOf(id, ctx), nameSpaces: true, published: true });
}

// Profile's Calendar feed section: whether the person may make an address, and theirs if they have one.
app.get('/api/me/feed', requireUser, (req, res) => {
  const user = currentUser(req);
  res.json({ allowed: feedAllowed({ user, guestSpace: null }), ...calendarFeedView(user) });
});
// A new address, replacing any old one: answered once, never again.
app.post('/api/me/feed', requireUser, (req, res) => {
  const user = currentUser(req);
  if (store.settings.calendarFeeds !== true) return res.status(403).json({ error: `Calendar feeds are off in this ${word('environment')}.` });
  if (!feedAllowed({ user, guestSpace: null })) return res.status(403).json({ error: FEED_NOTHING });
  const token = newFeedToken();
  const feed = store.setCalendarFeed(user.key, feedHash(token));
  res.status(201).json({ url: `${baseUrl(req)}/feed/${token}.ics`, made: feed.made });
});
app.delete('/api/me/feed', requireUser, (req, res) => {
  store.setCalendarFeed(currentUser(req).key, null);
  res.status(204).end();
});
// An owner (or the admin) turning someone's address off. They never see it.
app.delete('/api/users/:key/feed', requireOwner, (req, res) => {
  if (!store.userByKey(req.params.key)) return res.status(404).json({ error: 'no such user' });
  store.setCalendarFeed(req.params.key, null);
  res.status(204).end();
});

// Profile's Calendars tab in one answer (plan-space-calendars.md, section 4): the switches as they read, why each
// cannot be used (null when it can), the module the addresses carry, the personal address, one row per space the
// person is in with their address there, and their other calendars. `busy` comes with busy times (step 6 of the plan).
app.get('/api/me/calendars', requireUser, (req, res) => {
  const user = currentUser(req);
  const who = { user, guestSpace: null };
  const addressesReason = addressesWhy(user);
  const everythingReason = addressesReason || (feedAllowed(who) ? null : FEED_NOTHING);
  const externalOk = externalAllowed();
  if (externalOk) {
    externalCalendars.noteSeen(user.key);
    externalCalendars.readMissing(user.key);
  }
  const spaces = store.spaces.filter((r) => !r.isLobby && r.members.includes(user.key)).map((r) => {
    const reason = spaceAddressWhy(user, r);
    return { ...spaceSummary(r), address: { allowed: !reason, reason, ...feedView(user.spaces?.[r.id]?.calendarFeed) } };
  });
  res.json({
    switches: { addresses: store.settings.calendarFeeds === true, otherCalendars: store.otherCalendarsOn() },
    reasons: { addresses: addressesReason, otherCalendars: externalOk ? null : externalWhy(user) },
    module: feedModule(),
    everything: { allowed: !everythingReason, reason: everythingReason, ...calendarFeedView(user) },
    spaces,
    external: { allowed: externalOk, calendars: externalCalendars.view(user.key) },
  });
});
// A space address (section 1): a new one for the signed-in person in this space, replacing any old one, answered once;
// 403 with the reason when they may not hold one (not a member, the switch off, the module off or unreadable there).
app.post('/api/me/spaces/:id/feed', requireUser, (req, res) => {
  const user = currentUser(req);
  const space = store.spaceById(req.params.id);
  if (!space || space.isLobby) return res.status(404).json({ error: `no such ${word('space')}` });
  const why = spaceAddressWhy(user, space);
  if (why) return res.status(403).json({ error: why });
  const token = newFeedToken();
  const feed = store.setSpaceCalendarFeed(user.key, space.id, feedHash(token));
  res.status(201).json({ url: `${baseUrl(req)}/feed/${token}.ics`, made: feed.made });
});
// Turning one's own off: always allowed, even once the switch is off or the person has left.
app.delete('/api/me/spaces/:id/feed', requireUser, (req, res) => {
  store.setSpaceCalendarFeed(currentUser(req).key, req.params.id, null);
  res.status(204).end();
});
// An owner (or the admin) turning someone's space address off. They never see it.
app.delete('/api/users/:key/spaces/:id/feed', requireOwner, (req, res) => {
  if (!store.userByKey(req.params.key)) return res.status(404).json({ error: 'no such user' });
  store.setSpaceCalendarFeed(req.params.key, req.params.id, null);
  res.status(204).end();
});

// The published calendar (section 2): owners and the admin make, replace and turn off its one address, while
// settings.publishedCalendar is on. Its state is in GET /api/settings (publishedCalendarFeed { on, made, readAt }).
app.post('/api/settings/published-calendar', requireOwner, (req, res) => {
  if (store.settings.publishedCalendar !== true) return res.status(403).json({ error: `The published calendar is off in this ${word('environment')}.` });
  const token = newFeedToken();
  const feed = store.setPublishedCalendarFeed(feedHash(token));
  res.status(201).json({ url: `${baseUrl(req)}/feed/${token}.ics`, made: feed.made });
});
app.delete('/api/settings/published-calendar', requireOwner, (_req, res) => {
  store.setPublishedCalendarFeed(null);
  res.status(204).end();
});

// Reads per address in the current minute: "<slug>|<hash>" -> { from, count }. Kept in memory; a restart forgets it.
const feedReads = new Map();
function feedOverLimit(key, now = Date.now()) {
  if (feedReads.size > 10000) for (const [k, v] of feedReads) if (now - v.from >= 60000) feedReads.delete(k);
  const seen = feedReads.get(key);
  if (!seen || now - seen.from >= 60000) {
    feedReads.set(key, { from: now, count: 1 });
    return 0;
  }
  seen.count += 1;
  return seen.count > FEED_READS_PER_MINUTE ? Math.max(1, Math.ceil((seen.from + 60000 - now) / 1000)) : 0;
}

// Whose address a hash is, checked as it stands now: a personal address (the switch on, the person here), a space
// address (the switch on, the person here, still a member, the module still on and readable for them there), then the
// published calendar (its switch on, and a module offering events still on: turning the Calendar off stops it at once,
// plan-space-calendars.md section 2). null for anything else, which answers 404 without saying which.
function findFeed(hash) {
  if (store.settings.calendarFeeds === true) {
    const user = store.userByFeedHash(hash);
    if (user) return { kind: 'personal', user };
    const held = store.spaceFeedByHash(hash);
    if (held) {
      const space = store.spaceById(held.spaceId);
      if (!space || space.isLobby || spaceAddressWhy(held.user, space)) return null;
      return { kind: 'space', user: held.user, space };
    }
  }
  if (store.settings.publishedCalendar === true && feedModule()?.on && store.publishedCalendarFeed?.hash === hash) return { kind: 'published' };
  return null;
}

// The feed itself, no session: a plain 404 (never a page, never a redirect to sign in) for an unknown token, with the
// setting off, the person gone or no longer a member; 429 past 30 reads a minute; else the calendar, with an ETag of
// what it holds.
app.get('/feed/:file', (req, res) => {
  const notHere = () => res.status(404).type('text/plain').send(FEED_NOT_HERE);
  const m = /^(.+)\.ics$/.exec(req.params.file);
  if (!m || !FEED_TOKEN_RE.test(m[1])) return notHere();
  const hash = feedHash(m[1]);
  const found = findFeed(hash);
  if (!found) return notHere();
  const wait = feedOverLimit(`${currentEnvironment().slug}|${hash}`);
  if (wait) return res.status(429).set('Retry-After', String(wait)).type('text/plain').send('This address was read too often; try again in a minute.');
  let name = store.settings.environmentName || PRODUCT_NAME;
  let read;
  if (found.kind === 'personal') {
    store.noteCalendarFeedRead(found.user.key);
    read = feedEvents(req, found.user);
  } else if (found.kind === 'space') {
    store.noteSpaceCalendarFeedRead(found.user.key, found.space.id);
    read = spaceFeedEvents(req, found.user, found.space);
    name = found.space.name;
  } else {
    store.notePublishedCalendarRead();
    read = publishedFeedEvents(req);
  }
  const body = ics.buildCalendar({ name, tz: read.tz, events: read.events });
  const etag = `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 32)}"`;
  res.set({ ETag: etag, 'Cache-Control': 'private, no-cache', 'X-Robots-Tag': 'noindex' });
  const asked = String(req.get('if-none-match') || '').split(',').map((t) => t.trim().replace(/^W\//, ''));
  if (asked.includes(etag) || asked.includes('*')) return res.status(304).end();
  res.status(200).type('text/calendar; charset=utf-8').send(body);
});

// --- other calendars (documentation/plans/plan-google-calendar.md, Part 2) ----------------------------------------------
// A person pastes a private calendar address (up to five); it is sealed with the secrets key, never answered again, and
// read through the private-address guard (server/link-preview.js) on adding, on Refresh and every 30 minutes, into
// memory only (server/external-calendars.js). A module sees the person's own events only through the admin-approved
// `external` hook. Nothing here names a provider or a module. settings.otherCalendars allows it (store.otherCalendarsOn:
// calendarFeeds, the address out's switch, until an owner sets it; plan-space-calendars.md, decision 7).
const externalModules = () => modules.enabledAll().filter(({ manifest }) => manifest.hooks.external);
const externalAllowed = () => store.otherCalendarsOn() && externalModules().length > 0;
function refuseExternal(res) {
  if (!store.otherCalendarsOn()) return void res.status(403).json({ error: `Other calendars are off in this ${word('environment')}.` });
  if (!externalModules().length) return void res.status(403).json({ error: `No ${word('module')} here shows other calendars.` });
  return false;
}
// Why Profile's Other calendars section can't be used, in plain words naming what to do and where: a step the switch
// waits on first (install, update or approve), then the switch, else the module that would show them (installed but waiting for approval or off, installed in a version without the hook, or
// shipped here and not installed). null when it can be used, or when nothing here could ever show them.
const EXTERNAL_HOOK_LABEL = 'See each person\'s own other calendars';
function externalWhy(user) {
  if (externalAllowed()) return null;
  const own = hasOwnerRights(user);
  const manage = (tab) => `Manage > ${tab}`;
  const modulesTab = manage(word('module', { many: true, cap: true }));
  const ask = (doThis, where) => (own ? `${doThis[0].toUpperCase()}${doThis.slice(1)} in ${where}.` : `Your ${word('owner')} needs to ${doThis} in ${where}.`);
  // The module's part, as { text, step }: `step` when it is a step the switch waits on (install, update or approve:
  // until then Calendar's configuration doesn't exist or its switch is disabled), so it is named first.
  const step = (text) => ({ text, step: true });
  const plain = (text) => ({ text, step: false });
  const moduleWhy = () => {
    // An installed module whose running version asks for the hook: it can't run (outdated, or something it requires is
    // outdated or off), it waits for approval, or it is switched off. Turning it on only helps in the last case.
    for (const id of Object.keys(modules.registry.modules)) {
      const entry = modules.registry.modules[id];
      const manifest = modules.manifestOf(id, entry.version);
      if (!manifest?.hooks?.external) continue;
      const name = modules.shownName(manifest);
      if (manifest.outdated) {
        // A newer copy that ships here fixes it; else only its author can (the sentence Manage's card and PATCH use).
        const fixed = bundledModules(BUNDLED_DIR).find((b) => b.id === id && b.hooks?.external && compareVersions(b.version, entry.version) > 0);
        if (fixed) return step(ask(`update ${name} to ${fixed.version} and approve its "${EXTERNAL_HOOK_LABEL}"`, modulesTab));
        return plain(`${name} was built for an older version of ${PRODUCT_NAME} and needs an update from its author.`);
      }
      const waiting = modules.needsUpdateFor(manifest);
      if (waiting.length) return plain(`${name} needs ${waiting.map((r) => modules.missingName(r)).join(' and ')}, which ${waiting.length === 1 ? 'needs an update from its author' : 'need an update from their authors'}.`);
      if (modules.pendingFor(entry, manifest).hooks.includes('external')) return step(ask(`approve ${name}'s "${EXTERNAL_HOOK_LABEL}"`, modulesTab));
      if (!entry.enabled) return plain(ask(`turn on ${name}`, modulesTab));
      const missing = modules.missingFor(manifest);
      if (missing.length) {
        const names = missing.map((r) => modules.missingName(r)).join(' and ');
        // The AI service is not on the Modules tab, so only modules get a place to go.
        const fact = `${name} needs ${names} installed and turned on first.`;
        return plain(missing.includes('ai') ? fact : `${fact} ${ask(`turn on ${names}`, modulesTab)}`);
      }
      return plain(ask(`turn on ${name}`, modulesTab));
    }
    // One that ships with this server asks for it: installed in an older version without it, or not installed.
    for (const bundled of bundledModules(BUNDLED_DIR)) {
      if (!bundled.hooks?.external || !moduleAllowedByPlan(bundled.id)) continue;
      const name = store.moduleDisplay(bundled.id).name || bundled.name;
      if (modules.isInstalled(bundled.id)) return step(ask(`update ${name} to ${bundled.version} and approve its "${EXTERNAL_HOOK_LABEL}"`, modulesTab));
      return step(ask(`install ${name} and approve its "${EXTERNAL_HOOK_LABEL}"`, modulesTab));
    }
    return null;
  };
  const blocker = moduleWhy();
  if (!store.otherCalendarsOn()) {
    // Never set (it follows calendarFeeds) or set to false: either way the switch is in the Calendar's Configure page
    // (plan-space-calendars.md, decisions 6 and 7, and section 4's "why can't I" states, as addressesWhy words them). An
    // owner is told where, naming the module that would show them as this environment shows it: the running one, else
    // an installed one, else one that ships here; the page makes that name the link to its Configure page.
    const here = store.settings.environmentName || `this ${word('environment')}`;
    const installed = Object.keys(modules.registry.modules).map((id) => modules.manifestOf(id, modules.registry.modules[id].version)).find((m) => m?.hooks?.external);
    const bundled = installed ? null : bundledModules(BUNDLED_DIR).find((b) => b.hooks?.external && moduleAllowedByPlan(b.id));
    const name = externalModules()[0] ? modules.shownName(externalModules()[0].manifest)
      : installed ? modules.shownName(installed)
        : bundled ? (store.moduleDisplay(bundled.id).name || bundled.name) : null;
    const off = `${word('owner', { many: true, cap: true })} have not turned on other calendars in ${here}.`;
    const turnOn = own && name ? `${off} Turn it on in ${name}'s configuration.` : off;
    return blocker?.step ? `${blocker.text} ${turnOn}` : turnOn;
  }
  return blocker ? blocker.text : null;
}
// A pasted address as it is read: webcal: is https:, http: is refused. Answers { url } or { error }.
function externalAddress(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { error: 'Paste the calendar’s address.' };
  const asHttps = text.replace(/^webcals?:\/\//i, 'https://');
  let parsed = null;
  try { parsed = new URL(asHttps); } catch { parsed = null; }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) return { error: 'Paste an address that starts with https:// or webcal://.' };
  if (parsed.protocol === 'http:') return { error: 'That address is not private. Use the one that starts with https:// or webcal://.' };
  if (asHttps.length > 2000) return { error: 'That address is too long.' };
  const checked = calendarUrl(asHttps);
  if (!checked) return { error: 'That address is not allowed.' };
  return { url: checked.href };
}
// Adds per person in ten minutes that reach a read: each one makes this server read an address someone typed.
const EXTERNAL_ADDS = 20;
const externalAdds = new Map(); // "<slug>|<user key>" -> [times]
function externalAddWait(key, now = Date.now()) {
  const recent = (externalAdds.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= EXTERNAL_ADDS) { externalAdds.set(key, recent); return Math.max(1, Math.ceil((recent[0] + 10 * 60 * 1000 - now) / 1000)); }
  recent.push(now);
  externalAdds.set(key, recent);
  return 0;
}

// Profile's Other calendars section: whether it can be used, why not (`why`, null when it can or when nothing here could
// show them), and the person's own, each with its host only.
app.get('/api/me/external-calendars', requireUser, (req, res) => {
  const user = currentUser(req);
  const allowed = externalAllowed();
  if (allowed) {
    externalCalendars.noteSeen(user.key);
    externalCalendars.readMissing(user.key);
  }
  res.json({ allowed, why: allowed ? null : externalWhy(user), calendars: externalCalendars.view(user.key) });
});
// Adds one: read once first, so an address that cannot be read is not kept, and the answer says why.
app.post('/api/me/external-calendars', requireUser, async (req, res) => {
  const user = currentUser(req);
  if (refuseExternal(res) !== false) return;
  if (store.externalCalendarsOf(user.key).length >= MAX_EXTERNAL_CALENDARS) return res.status(400).json({ error: 'You can add up to five calendars.' });
  const { url, error } = externalAddress(req.body?.url);
  if (error) return res.status(400).json({ error });
  if (store.externalCalendarsOf(user.key).some((c) => auth.decryptSecret(c.url, secretsKeyBuf()) === url)) return res.status(409).json({ error: 'That calendar is already added.' });
  const wait = externalAddWait(`${currentEnvironment().slug || ''}|${user.key}`);
  if (wait) return res.status(429).set('Retry-After', String(wait)).json({ error: 'Too many calendars added at once; try again in a few minutes.' });
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  const calendar = store.addExternalCalendar(user.key, { name: name.trim() || new URL(url).hostname, url: auth.encryptSecret(url, secretsKeyBuf()) });
  externalCalendars.noteSeen(user.key);
  const read = await externalCalendars.read(user.key, calendar.id);
  if (!read.ok) {
    store.removeExternalCalendar(user.key, calendar.id);
    externalCalendars.forget(user.key, calendar.id);
    return res.status(400).json({ error: read.error || 'That calendar could not be read.' });
  }
  res.status(201).json({ calendar: externalCalendars.viewOne(user.key, store.externalCalendarsOf(user.key).find((c) => c.id === calendar.id) || calendar) });
});
// Reads one again now, at most once a minute.
app.post('/api/me/external-calendars/:id/refresh', requireUser, async (req, res) => {
  const user = currentUser(req);
  const calendar = store.externalCalendarsOf(user.key).find((c) => c.id === req.params.id);
  if (!calendar) return res.status(404).json({ error: 'There is no such calendar.' });
  if (refuseExternal(res) !== false) return;
  const wait = externalCalendars.refreshWait(user.key, calendar.id);
  if (wait) return res.status(429).set('Retry-After', String(wait)).json({ error: 'This calendar was read less than a minute ago; try again in a minute.' });
  externalCalendars.noteSeen(user.key);
  await externalCalendars.read(user.key, calendar.id, { refresh: true });
  const now = store.externalCalendarsOf(user.key).find((c) => c.id === calendar.id);
  if (!now) return res.status(404).json({ error: 'There is no such calendar.' });
  res.json({ calendar: externalCalendars.viewOne(user.key, now) });
});
// Removes one, address and events, at once. Works with the switch off too.
app.delete('/api/me/external-calendars/:id', requireUser, (req, res) => {
  const user = currentUser(req);
  if (!store.removeExternalCalendar(user.key, req.params.id)) return res.status(404).json({ error: 'There is no such calendar.' });
  externalCalendars.forget(user.key, req.params.id);
  res.status(204).end();
});

// A module's view of the signed-in person's own other calendars: only with the approved `external` hook, only their
// own, read only. A guest, the access key, or the switch off: none. `from` and `to` are dates or times (optional).
const externalWhen = (raw) => {
  if (raw === undefined) return null;
  const text = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(text)) return NaN;
  // A day that does not exist (2026-02-30) is no date: Date.parse would roll it over into the next month.
  const [y, mo, d] = text.slice(0, 10).split('-').map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
};
app.get('/api/modules/:id/external-events', (req, res) => {
  const found = modules.enabled(req.params.id);
  if (!found) return res.status(404).json({ error: `no such ${word('module')}` });
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  if (!requireHook(found, res, 'external')) return;
  const from = externalWhen(req.query.from);
  const to = externalWhen(req.query.to);
  if (Number.isNaN(from) || Number.isNaN(to)) return res.status(400).json({ error: 'from and to are dates, such as 2026-10-01.' });
  if (from !== null && to !== null && to < from) return res.status(400).json({ error: 'to comes after from.' });
  if (!who.user || !store.otherCalendarsOn()) return res.json({ calendars: [], events: [] });
  externalCalendars.noteSeen(who.user.key);
  externalCalendars.readMissing(who.user.key);
  res.json(externalCalendars.eventsFor(who.user.key, { from, to }));
});

// --- objects: one module pointing at another's objects ---------------------------
// Modules cannot reach each other's storage, and that stays. The host knows nothing about any module's
// objects; it offers conduits. A module declares in its manifest the kinds of object it lets others point
// at (`refs.produces`: a kind, the stored key its objects live under, which stored fields make up the
// object's summary, and whether it can open one or show what links to it) and which kinds it wants to point
// at (`refs.consumes`: named kinds, or "*" for whatever other modules share; approved by an admin).
// The consumer stores only a pointer ({ module, kind, id, scope, space? }) and asks the host for the summary
// whenever it draws it. The host answers only what the viewer could already see in the producing
// module: it must be enabled, the viewer must hold its read permission in that scope (and be in the
// space), and the consumer must have been approved for that kind. What comes back is the summary, never
// the stored record. Nothing here names a module: a module installed tomorrow takes part by declaring.

const refError = (status, message) => Object.assign(new Error(message), { status });
const REF_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// A pointer's scope is 'environment', 'person', or 'space' with the space's id in `space`.
const refScopeKey = (ref) => (ref.scope === 'space' ? scopeKeyOf('space', { spaceId: ref.space }) : 'environment');
const refShape = (r) => r && typeof r === 'object' && typeof r.module === 'string' && typeof r.kind === 'string' && REF_ID_RE.test(String(r.id ?? ''))
  && (r.scope === 'environment' || r.scope === 'person' || (r.scope === 'space' && typeof r.space === 'string' && r.space.length <= 64));
// A pointer as the host keeps and answers it: only its own fields.
const plainRef = (r) => ({ module: r.module, kind: r.kind, id: String(r.id), scope: r.scope, ...(r.scope === 'space' ? { space: r.space } : {}) });

// Whether the consumer's manifest declares, and the admin approved, linking to provider:kind.
function consumerMayLink(consumer, provider, kind) {
  const want = `${provider}:${kind}`;
  const declared = consumer.manifest.refs.consumes;
  const approved = consumer.entry.approved?.refs || [];
  return (declared.includes('*') || declared.includes(want)) && (approved.includes('*') || approved.includes(want));
}

// Check that this viewer may look at one scope of `provider`'s items of `kind`. Through a consumer
// (`from`, which must have been approved for the kind), or, for backlinks, with no consumer at all
// (`skipConsumer`): a module may always see what points at its own items, as far as the viewer may.
function refScope(who, { provider, kind, scope, space, from, skipConsumer = false }) {
  const found = modules.enabled(provider);
  if (!found) throw refError(404, `no such ${word('module')}`);
  const produce = found.manifest.refs.produces.find((p) => p.kind === kind);
  if (!produce) throw refError(404, `that ${word('module')} does not share that kind of ${word('object')}`);
  let consumer = null;
  if (!skipConsumer) {
    if (!from) throw refError(400, `say which ${word('module')} is asking`);
    consumer = modules.enabled(from);
    if (!consumer) throw refError(404, `no such ${word('module')}`);
    if (!consumerMayLink(consumer, provider, kind)) throw refError(403, `that ${word('module')} has not been approved to link to those ${word('object', { many: true })}`);
  }
  const { manifest, entry } = found;
  let scopeKey;
  let perms;
  if (scope === 'space') {
    const r = store.spaceById(String(space || ''));
    if (!r) throw refError(404, `no such ${word('space')}`);
    if (!manifest.scope.includes('space')) throw refError(400, `that ${word('module')} has no space scope`);
    if (!moduleSpaceAccess(entry, who, r)) throw Object.assign(refError(403, `that ${word('module')} is not available in that ${word('space')} for you`), { unseen: true });
    // The asking module must itself be on in that space, and readable by the viewer.
    if (consumer && (!moduleSpaceAccess(consumer.entry, who, r) || !moduleCan(consumer.manifest, modulePerms(who, r.id), 'read'))) throw refError(403, `the linking ${word('module')} is not available in that ${word('space')} for you`);
    perms = modulePerms(who, r.id);
    scopeKey = scopeKeyOf('space', { spaceId: r.id });
  } else if (scope === 'person') {
    // The viewer's own items, kept for them alone; a pointer to someone else's simply finds nothing here.
    if (!who.user) throw refError(403, `${word('guest', { many: true })} have no personal data`);
    if (!manifest.scope.includes('person')) throw refError(400, `that ${word('module')} has no personal scope`);
    if (consumer && !moduleCan(consumer.manifest, modulePerms(who, null), 'read')) throw refError(403, `the linking ${word('module')} is not available to you`);
    perms = modulePerms(who, null);
    scopeKey = `person:${who.user.key}`;
  } else {
    if (!who.user) throw refError(403, `${word('guest', { many: true })} can only use ${word('module', { a: true })} in ${word('space', { a: true })}`);
    if (!manifest.scope.includes('environment')) throw refError(400, `that ${word('module')} has no environment scope`);
    if (consumer && !moduleCan(consumer.manifest, modulePerms(who, null), 'read')) throw refError(403, `the linking ${word('module')} is not available to you`);
    perms = modulePerms(who, null);
    scopeKey = 'environment';
  }
  if (!moduleCan(manifest, perms, 'read')) throw Object.assign(refError(403, `your role can't see that ${word('module')}`), { unseen: true });
  // A library's files (the Vault) are never seen by a guest, whatever Roles says (plan-attachments-vault.md, section 4).
  if (manifest.library && !who.user) throw Object.assign(refError(403, `your role can't see that ${word('module')}`), { unseen: true });
  if (shutFromGuests(who, manifest, scope === 'space' ? String(space) : null)) throw Object.assign(refError(403, guestsShutRefusal(manifest)), { unseen: true });
  // `hide`: the provider's fields this viewer may not see there (hiddenFor), left out of every summary made from it.
  // `sees`: for a library's files, which of them this viewer may see there (fileSight); objectRows and objectValue ask it.
  return { manifest, produce, scopeKey, hide: hiddenFor(who, manifest, scope === 'space' ? String(space) : null), ref: { module: provider, kind, scope: scope === 'space' ? 'space' : scope === 'person' ? 'person' : 'environment', ...(scope === 'space' ? { space: String(space) } : {}) }, ...(manifest.library && produce.kind === 'file' && scope === 'space' ? { sees: fileSight(who, String(space), manifest.id) } : {}) };
}

// A library module's files are its objects of kind `file` (plan-attachments-vault.md, section 4): their records are in
// DATA_DIR/modules/<id>/library/, not in the module's data, so every reader of "the objects of a kind" goes through these.
const isFileKind = (manifest, produce) => Boolean(manifest.library) && produce.kind === 'file';
// The rows of a produced kind in one scope, [{ key, value }]: the module's data under the kind's key, or a library's records
// this viewer may see (a file hidden from them is not a row: search, the AI's pool and every list leave it out).
function objectRows(at, prefix) {
  if (isFileKind(at.manifest, at.produce)) {
    if (at.ref.scope !== 'space' || !at.sees) return [];
    return vault.list(at.manifest.id, at.ref.space).filter(at.sees).map((r) => ({ key: `${prefix}${r.id}`, value: r }));
  }
  return moduleData.list(at.manifest.id, at.scopeKey, prefix);
}
// A library file that is there but hidden from this viewer (plan-vault-privacy.md, decision 7): 403 and unseen, so a link
// to it reads hidden, never gone, and nothing of it is said. `hiddenFile` lets a link that holds it keep it.
const HIDDEN_FILE = 'that file is not shared with you';
// One stored object's value (a library's record for a file), or null.
function objectValue(at, id) {
  if (isFileKind(at.manifest, at.produce)) {
    const r = at.ref.scope === 'space' ? vault.get(at.manifest.id, at.ref.space, id) : null;
    if (r && !(at.sees && at.sees(r))) throw Object.assign(refError(403, HIDDEN_FILE), { unseen: true, hiddenFile: true });
    return r;
  }
  const item = moduleData.get(at.manifest.id, at.scopeKey, at.produce.key.replace('{id}', String(id)));
  return item ? item.value : null;
}
// The icon of a file by its type, and its short word, for a chip or a row.
const FILE_ICONS = { image: 'file-image', audio: 'file-audio', video: 'file-video', document: 'file-lines' };
const FILE_WORDS = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'audio/mpeg': 'MP3', 'audio/ogg': 'OGG', 'audio/wav': 'WAV', 'audio/mp4': 'M4A', 'video/mp4': 'MP4', 'video/webm': 'WebM', 'video/quicktime': 'MOV', 'application/pdf': 'PDF', 'text/markdown': 'Markdown' };
// What a file's summary adds to the usual: its icon and size, `missing` when the record is there and its bytes are not (a
// restore without VAULT_DIR: "File missing"), `viewable: false` for a PDF kept as download only.
function fileSummaryExtras(summary, value, ref) {
  const type = typeof value?.type === 'string' ? value.type : '';
  const size = Number.isFinite(value?.size) ? value.size : 0;
  summary.icon = type === 'application/pdf' ? 'file-pdf' : FILE_ICONS[value?.group] || 'file';
  summary.subtitle = [size ? sizeText(size) : '', FILE_WORDS[type] || ''].filter(Boolean).join(' · ');
  summary.group = typeof value?.group === 'string' ? value.group : '';
  summary.size = size;
  summary.type = type;
  if (value?.viewable === false) summary.viewable = false;
  let there = true;
  try { const f = ref.space && vault.filePath(ref.space, value.id); there = Boolean(f) && fs.existsSync(f); } catch { there = false; }
  if (!there) summary.missing = true;
}

// The summary of one stored object: only the fields the producer named, trimmed and typed.
// Priced: it has an actual amount or a planned one.
const VISIT_STATES = ['want', 'booked', 'visited', 'favorite'];
const SUMMARY_TINTS = ['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red'];
const isPriced = (summary) => summary.amount !== undefined || summary.planned !== undefined;
function objectSummary({ manifest, produce, ref, hide }, id, value, withText = false) {
  if (hide && hide.length) value = moduleGuards.hide(value, hide);
  const text = (v) => (typeof v === 'string' ? v.slice(0, 200) : typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const field = (name) => (produce.summary[name] ? value?.[produce.summary[name]] : undefined);
  const summary = {
    ref: { ...ref, id },
    kind: produce.kind,
    kindName: kindNameOf(manifest, produce.name),
    open: produce.open,
    module: { id: manifest.id, ...shownModule(manifest) },
    title: String(text(field('title')) ?? '').trim() || 'Untitled',
  };
  const subtitle = text(field('subtitle'));
  if (subtitle !== undefined && subtitle !== '') summary.subtitle = subtitle;
  for (const name of ['when', 'end']) {
    const v = text(field(name));
    if (v !== undefined && v !== '') summary[name] = v;
  }
  for (const name of ['allDay', 'done']) if (typeof field(name) === 'boolean') summary[name] = field(name);
  // `doneAt` (a time in milliseconds): done once it has passed, whatever the stored flag says (a poll closed by its time).
  const doneAt = field('doneAt');
  if (typeof doneAt === 'number' && Number.isFinite(doneAt) && Date.now() >= doneAt) summary.done = true;
  // A short label a module may give its items to group or colour them ("eat", "stay"): lower case letters, digits and dashes.
  const category = text(field('category'));
  // A producer may give plain words for its categories (`categoryNames`, by the stored category, else by the stored kind).
  const named = produce.categoryNames && (produce.categoryNames[category] || produce.categoryNames[value?.kind]);
  if (named) summary.category = named;
  else if (typeof category === 'string' && /^[A-Za-z0-9-]{1,30}$/.test(category)) summary.category = category.toLowerCase();
  // A cost (plan-budget-module.md, step 3): `amount` a positive number below 1e12, rounded to cents (the Budget module's
  // rule); `paidBy` a person's key; `sharedBy` the keys of who shares it. Anything else is left out.
  const amount = field('amount');
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    const cents = Math.round(amount * 100) / 100;
    if (cents > 0 && cents < 1e12) summary.amount = cents;
  }
  // `planned`: what is expected before anything is paid (a booking's estimate); the same rule. A summary with `planned`
  // and no `amount` is priced too (has=amount): see isPriced.
  const planned = field('planned');
  if (typeof planned === 'number' && Number.isFinite(planned)) {
    const cents = Math.round(planned * 100) / 100;
    if (cents > 0 && cents < 1e12) summary.planned = cents;
  }
  const paidBy = field('paidBy');
  if (typeof paidBy === 'string' && paidBy && paidBy.length <= 64) summary.paidBy = paidBy;
  const sharedBy = field('sharedBy');
  if (Array.isArray(sharedBy)) {
    const keys = [...new Set(sharedBy.filter((k) => typeof k === 'string' && k && k.length <= 64))].slice(0, 50);
    if (keys.length) summary.sharedBy = keys;
  }
  // A place's look and state (plan-places-library.md, step 1): `icon` a Font Awesome Free solid icon that exists; `visit` one of
  // want, booked, visited, favorite; `spaces` the ids of up to 20 spaces (of this environment) the object is marked into.
  const icon = field('icon');
  if (typeof icon === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(icon) && iconKnown(icon)) summary.icon = icon;
  const visit = field('visit');
  if (typeof visit === 'string' && VISIT_STATES.includes(visit)) summary.visit = visit;
  // `color`: a place's own colour, one of the eight theme tints by name (plan-places-library.md, step 4); a pin takes it before its category's.
  const color = field('color');
  if (typeof color === 'string' && SUMMARY_TINTS.includes(color)) summary.color = color;
  const marked = field('spaces');
  if (Array.isArray(marked)) {
    const ids = [...new Set(marked.filter((k) => typeof k === 'string' && k && k.length <= 64 && store.spaceById(k)))].slice(0, 20);
    if (ids.length) summary.spaces = ids;
  }
  // The object's own words (a note's body), plain and up to 8 KB. Left out of the summaries people browse; the server reads it only
  // for the AI hook, as the person asking.
  if (withText) { const t = field('text'); if (typeof t === 'string' && t.trim()) summary.text = t.replace(/\p{Cc}(?<!\n)/gu, ' ').slice(0, 8000); }
  // A place on the map, if the item has one: { lat, lng, name? }, checked; anything else is left out.
  const place = field('place');
  if (place && typeof place === 'object' && Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180) {
    summary.place = { lat: place.lat, lng: place.lng, ...(typeof place.name === 'string' && place.name.trim() ? { name: place.name.replace(/\p{Cc}/gu, ' ').trim().slice(0, 120) } : {}) };
  }
  if (isFileKind(manifest, produce)) fileSummaryExtras(summary, value, ref || {});
  return summary;
}

// The link hook (plan-linked-objects, step 1): which stored key is a produced kind, who points at it, and whether
// its summary changed. Wired here so a data route can call afterWrite without this file and object-sync circling.
objectSync.configure({
  environment: currentEnvironment,
  produceFor(moduleId, key) {
    const found = modules.enabled(moduleId);
    if (!found) return null;
    for (const produce of found.manifest.refs.produces) {
      const at = produce.key.indexOf('{id}');
      if (at < 0) continue;
      const prefix = produce.key.slice(0, at);
      const suffix = produce.key.slice(at + 4);
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      const id = key.slice(prefix.length, suffix ? key.length - suffix.length : undefined);
      if (!id) continue;
      return { produce, id };
    }
    return null;
  },
  linksTo: (ref) => moduleLinks.to(ref),
  produceOf(moduleId, kind) {
    const found = modules.enabled(moduleId);
    if (!found) return null;
    return found.manifest.refs.produces.find((p) => p.kind === kind) || null;
  },
  read(moduleId, scopeKey, key) {
    const stored = moduleData.get(moduleId, scopeKey, key);
    return stored ? stored.value : null;
  },
  write(moduleId, scopeKey, key, value, by) {
    moduleData.put(moduleId, scopeKey, key, value, { by });
  },
  remove(moduleId, scopeKey, key, by) {
    moduleData.remove(moduleId, scopeKey, key, { by });
  },
  dropLinks(ref) {
    moduleLinks.drop(ref);
  },
  pairsFrom: (ref) => moduleLinks.pairsFrom(ref),
  pairTo: (ref) => moduleLinks.pairTo(ref),
  addPair: (from, to, by) => moduleLinks.addPair(from, to, by),
  detachPair: (ref) => moduleLinks.detachPair(ref),
  removePairs: (ref, keepDetached) => moduleLinks.removePairs(ref, keepDetached),
  newId: () => crypto.randomBytes(8).toString('hex'),
  nameOf: (by) => store.userByKey(by)?.displayName || String(by || ''),
  // Kinds in this space that receive a dated twin, and that this sender is approved to link to.
  takers(moduleId, kind, spaceId) {
    const sender = modules.enabled(moduleId);
    if (!sender || !spaceId) return [];
    const out = [];
    for (const view of modules.list()) {
      if (!view.enabled || !modules.isOnIn(view.id, spaceId)) continue;
      const found = modules.enabled(view.id);
      if (!found) continue;
      for (const produce of found.manifest.refs.produces) {
        if (produce.mirror !== 'in' || !produce.create) continue;
        if (view.id === moduleId && produce.kind === kind) continue;
        if (!consumerMayLink(sender, view.id, produce.kind)) continue;
        out.push({ moduleId: view.id, produce });
      }
    }
    return out;
  },
  senders() {
    const out = [];
    for (const view of modules.list()) {
      if (!view.enabled) continue;
      const found = modules.enabled(view.id);
      if (!found) continue;
      for (const produce of found.manifest.refs.produces) {
        if (produce.mirror !== 'out' || produce.dated?.form !== 'wall') continue;
        const at = produce.key.indexOf('{id}');
        if (at < 0) continue;
        const prefix = produce.key.slice(0, at);
        const suffix = produce.key.slice(at + 4);
        out.push({
          moduleId: view.id,
          produce,
          scopes: moduleData.scopesOf(view.id),
          rows(scopeKey) {
            return moduleData.list(view.id, scopeKey, prefix).flatMap((row) => {
              if (!row.key.startsWith(prefix) || !row.key.endsWith(suffix)) return [];
              const id = row.key.slice(prefix.length, suffix ? row.key.length - suffix.length : undefined);
              return id ? [{ id, value: row.value, by: row.by || '' }] : [];
            });
          },
        });
      }
    }
    return out;
  },
  summarize(moduleId, produce, ref, id, value) {
    if (value == null) return null;
    const found = modules.enabled(moduleId);
    if (!found) return null;
    return objectSummary({ manifest: found.manifest, produce, ref }, id, value);
  },
});

// A pair (a dated object and its copy in another module, plan-plan-calendar-sync.md) is flagged on both ends, so a
// module can show a copy as one and a picker can offer the pair once: a copy says `copy: true` and `twinOf` (its original's
// reference); an original that has copies says `twins` (their references). `index` is moduleLinks.pairIndex().
function markPair(summary, index) {
  const original = index.copyOf(summary.ref);
  if (original) return { ...summary, copy: true, twinOf: original };
  const copies = index.copiesOf(summary.ref);
  return copies.length ? { ...summary, twins: copies } : summary;
}

function resolveRef(who, ref, from, opts = {}) {
  if (!refShape(ref)) throw refError(400, 'that is not a valid reference');
  const at = refScope(who, { provider: ref.module, kind: ref.kind, scope: ref.scope, space: ref.space, from, ...opts });
  const value = objectValue(at, ref.id);
  if (!value) throw refError(404, isFileKind(at.manifest, at.produce) ? 'that file is no longer there' : `that ${word('object')} is no longer there`);
  return markPair(objectSummary(at, String(ref.id), value, opts.withText === true), moduleLinks.pairIndex());
}

// The kinds the consumer may point at: every kind of every other enabled module it was approved for.
function consumableKinds(consumerId) {
  const consumer = modules.enabled(consumerId);
  if (!consumer) return [];
  const out = [];
  for (const { manifest } of modules.enabledAll()) {
    if (manifest.id === consumerId) continue;
    for (const p of manifest.refs.produces) {
      if (consumerMayLink(consumer, manifest.id, p.kind)) out.push({ module: manifest.id, moduleName: shownModule(manifest).name, icon: shownModule(manifest).icon, kind: p.kind, name: kindNameOf(manifest, p.name), open: p.open, events: (manifest.events?.publishes || []).filter((e) => e.kind === p.kind).map((e) => ({ name: e.name, label: e.label, data: e.data || {} })) });
    }
  }
  return out;
}

const refAnswer = (fn) => {
  try {
    return fn();
  } catch (err) {
    if (!err.status) throw err;
    // `state` says what to draw: the item is gone, or it exists but this viewer may not see it (never more than they may know).
    return { error: err.message, status: err.status, ...(err.status === 404 ? { state: 'gone' } : err.status === 403 ? { state: 'hidden' } : {}) };
  }
};

// Summaries for a list of pointers, one answer each (a summary, or why not).
app.post('/api/objects/resolve', (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'sign in first' }); // the access key opens only a module's keyed page
  const from = String(req.body?.from || '');
  const refs = Array.isArray(req.body?.refs) ? req.body.refs.slice(0, 50) : [];
  res.json({ summaries: refs.map((ref) => refAnswer(() => resolveRef(who, ref, from))).map((c, i) => (c.error ? { ref: refs[i], ...c } : c)) });
});

// The objects chat names (an AI answer's citations and what it used), as the reader may see them (GitHub #395). Chat is not
// a module, so no consumer is asked for or checked (skipConsumer, as readerCanOpen filters a shared answer): every viewer
// check stays (sign-in or the space's guest link, the space's members, the role's read, guest rules, hidden fields), and a
// space or module of another environment is simply not found here. Same shape as POST /api/objects/resolve, up to 50 refs.
app.post('/api/chat/citations', (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'sign in first' }); // the access key opens only a module's keyed page
  const refs = Array.isArray(req.body?.refs) ? req.body.refs.slice(0, 50) : [];
  res.json({ summaries: refs.map((ref) => refAnswer(() => resolveRef(who, ref, null, { skipConsumer: true }))).map((c, i) => (c.error ? { ref: refs[i], ...c } : c)) });
});

// The kinds the asking module may link to, so it does not have to know other modules by name.
app.get('/api/objects/kinds', (req, res) => {
  if (!moduleViewer(req)) return res.status(401).json({ error: 'sign in first' });
  res.json({ kinds: consumableKinds(String(req.query.from || '')) });
});

// Objects the asking module could link to, in one scope: every kind it was approved to consume. `scope=spaces`
// (plan-map-destination.md, "Server") reads every space the viewer belongs to instead, each provider only where it is
// on and readable for them there (refScope per space, the spaces-data rule), each pointer carrying its `space`; signed-in
// people only. `has=place` keeps only summaries with a place, and then answers up to 1,000 rather than 50 (a map needs
// every pin, not the newest 50).
const SEARCH_CAP = 50;
const SEARCH_CAP_PLACES = 1000;
app.get('/api/objects/search', (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'sign in first' }); // the access key opens only a module's keyed page
  const from = String(req.query.from || '');
  if (!modules.enabled(from)) return res.status(404).json({ error: `no such ${word('module')}` });
  const scope = askedScope(req.query.scope, res, ['environment', 'space', 'spaces', 'person']);
  if (!scope) return;
  if (scope === 'spaces' && !who.user) return res.status(403).json({ error: `${word('guest', { many: true })} can only search one ${word('space')}` });
  const has = req.query.has === undefined || req.query.has === '' ? null : String(req.query.has);
  if (has !== null && has !== 'place' && has !== 'amount') return res.status(400).json({ error: 'has must be place or amount' });
  // Costs are kept from guests (a module's guards.hidden) unless an owner opened them in that space.
  if (has === 'amount' && !who.user && !(scope === 'space' && store.spaceById(String(req.query.space || ''))?.guestsSeeHidden === true)) {
    return res.status(403).json({ error: `${word('guest', { many: true, cap: true })} can't see costs in this ${word('space')}.` });
  }
  // `kind=poll` (a kind name): only that kind, and up to 1,000 of them, like `has`: a module asking for one kind wants all of it.
  const onlyKind = typeof req.query.kind === 'string' && /^[a-z][a-z0-9_-]{0,31}$/i.test(req.query.kind) ? req.query.kind : null;
  if (req.query.kind !== undefined && req.query.kind !== '' && !onlyKind) return res.status(400).json({ error: 'kind is a kind name' });
  const cap = has || onlyKind ? SEARCH_CAP_PLACES : SEARCH_CAP;
  // `in=<space id>` (with scope=environment): only the environment's objects marked for that space, and only for those who
  // belong to it (or own the environment).
  let inSpace = null;
  if (req.query.in !== undefined && req.query.in !== '') {
    if (scope !== 'environment') return res.status(400).json({ error: `in works only with the ${word('environment')} scope` });
    if (!who.user) return res.status(403).json({ error: `${word('guest', { many: true })} can only search one ${word('space')}` });
    inSpace = store.spaceById(String(req.query.in));
    if (!inSpace) return res.status(404).json({ error: `no such ${word('space')}` });
    if (!(hasOwnerRights(who.user) || inSpace.members.includes(who.user.key))) return res.status(403).json({ error: `you are not in that ${word('space')}` });
  }
  const q = String(req.query.q || '').trim().toLowerCase();
  // Each place to read: one scope as asked, or each space the viewer belongs to.
  const places = scope === 'spaces'
    ? store.spaces.filter((r) => r.members.includes(who.user.key)).map((r) => ({ scope: 'space', space: r.id }))
    : [{ scope, space: req.query.space }];
  const summaries = [];
  const pool = [];
  const pairs = moduleLinks.pairIndex();
  // has=amount only: how many priced objects the viewer was kept from because they may not view the module that holds
  // them (a number alone, never for a guest, and in a space only for its members), so Budget can say some are left out.
  let withheld = 0;
  const countWithheld = (k, where) => {
    if (!who.user) return;
    let scopeKey;
    if (where.scope === 'environment') scopeKey = 'environment';
    else if (where.scope === 'space') {
      const r = store.spaceById(String(where.space || ''));
      if (!r || !r.members.includes(who.user.key)) return;
      scopeKey = scopeKeyOf('space', { spaceId: r.id });
    } else return;
    const found = modules.enabled(k.module);
    const produce = found?.manifest.refs.produces.find((p) => p.kind === k.kind);
    if (!produce) return;
    const prefix = produce.key.replace('{id}', '');
    for (const item of moduleData.list(k.module, scopeKey, prefix)) {
      if (!item.value || !REF_ID_RE.test(item.key.slice(prefix.length))) continue;
      if (isPriced(objectSummary({ manifest: found.manifest, produce, ref: {} }, item.key.slice(prefix.length), item.value))) withheld += 1;
    }
  };
  for (const where of places) {
    for (const k of consumableKinds(from)) {
      let at;
      try {
        at = refScope(who, { provider: k.module, kind: k.kind, scope: where.scope, space: where.space, from });
      } catch (err) {
        if (has === 'amount' && err.unseen) countWithheld(k, where);
        continue; // not on for this scope, or not for this viewer
      }
      const prefix = at.produce.key.replace('{id}', '');
      for (const item of objectRows(at, prefix)) {
        if (!item.value || !REF_ID_RE.test(item.key.slice(prefix.length))) continue;
        const summary = markPair(objectSummary(at, item.key.slice(prefix.length), item.value), pairs);
        const fits = !(inSpace && !(summary.spaces || []).includes(inSpace.id))
          && !(onlyKind && summary.ref.kind !== onlyKind)
          && !(has === 'place' && !summary.place)
          && !(has === 'amount' && !isPriced(summary))
          && !(q && !`${summary.title} ${summary.subtitle || ''}`.toLowerCase().includes(q));
        pool.push({ summary, fits });
      }
    }
  }
  // A pair is offered once: its original. A copy is left out when its original is among what this person may see, and
  // always for the module that holds the original (the Itinerary is not offered its own objects through the Calendar).
  const seen = new Set(pool.map((p) => objectKey(p.summary.ref)));
  for (const { summary, fits } of pool) {
    if (!fits) continue;
    if (summary.copy && (summary.twinOf.module === from || seen.has(objectKey(summary.twinOf)))) continue;
    summaries.push(summary);
  }
  // Newest dates first, undated last.
  summaries.sort((a, b) => String(b.when ?? '').localeCompare(String(a.when ?? '')) || a.title.localeCompare(b.title));
  res.json({ summaries: summaries.slice(0, cap), ...(has === 'amount' ? { withheld } : {}) });
});

// The kinds the objects prompt lists here: those the environment's enabled modules take (plan-object-handoff.md, "The prompt").
const promptKinds = () => objectFormat.kindsTaken(modules.enabledAll().map(({ manifest }) => manifest));

// The published objects format: instructions (this environment's word for object and the kinds its modules take) and
// the schema (the whole catalogue).
app.get('/api/objects/format', (req, res) => {
  if (!moduleViewer(req)) return res.status(401).json({ error: 'sign in first' });
  res.json({
    version: objectFormat.FORMAT_VERSION,
    fence: objectFormat.FENCE,
    fileSuffix: objectFormat.FILE_SUFFIX,
    // The paste template (server/prompts/paste.js): written for a person to paste into any AI, never sent to the in-app model.
    instructions: prompts.pasteText({ kinds: promptKinds(), words: aiWords() }, { product: productName() }).text,
    schema: objectFormat.schema(),
  });
});
app.get('/api/objects/format/schema', (req, res) => {
  if (!moduleViewer(req)) return res.status(401).json({ error: 'sign in first' });
  res.status(200).type('application/schema+json').send(JSON.stringify(objectFormat.schema()));
});

// One object, by address (the same answer the batch gives).
app.get('/api/modules/:id/objects/:kind/:objectId', (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'sign in first' }); // the access key opens only a module's keyed page
  const out = refAnswer(() => ({ summary: resolveRef(who, { module: req.params.id, kind: req.params.kind, id: req.params.objectId, scope: req.query.scope, space: req.query.space }, String(req.query.from || '')) }));
  res.status(out.status || 200).json(out);
});

// --- markers (documentation/plans/plan-calendar-markers.md) -----------------------------------------------------------
// A kind marked "marker": true beside "dated" (cleanRefs in server/modules.js) shows on a calendar as a marker that links
// back to its object: never an event, never a copy, never written anywhere and never in a calendar feed. The asking
// module (the Calendar) reads them through the `consumes` the admin approved for each kind, as consumerMayLink decides,
// and each read applies the viewer's rights as they are now (refScope: in the space, the module on there, `read`).
const MARKER_DAYS = 92;
const MARKER_CAP = 500;
const MARKER_WHEN = 'from and to are dates or times, such as 2026-10-01 or 2026-10-01T18:00:00Z.';
// The produced kind a stored key belongs to, when that kind is a marker kind; else null.
function markerKindAt(moduleId, key) {
  const found = modules.enabled(moduleId);
  if (!found) return null;
  return found.manifest.refs.produces.find((p) => p.marker && key.startsWith(p.key.replace('{id}', ''))) || null;
}
// The modules (enabled, as enabled() answers) approved to show a marker kind produced by a change's module.
function markerConsumers(change, kind) {
  return modules.enabledAll().filter((m) => m.manifest.id !== change.module && consumerMayLink(m, change.module, kind.kind));
}
// The marker kinds one batch of changes touches, with the first change of each and who shows it: worked out once per batch (the batch
// object is shared by every open stream's listener), not once per stream, so a big Clear or Undo with many streams open
// costs the same as with one.
const batchMarkers = new WeakMap();
function markersOfBatch(batch) {
  let got = batchMarkers.get(batch);
  if (got) return got;
  got = new Map(); // kind name -> first change
  const producing = new Map(); // module id -> its marker kinds, or null
  for (const c of batch.changes) {
    if (!producing.has(c.module)) producing.set(c.module, modules.enabled(c.module)?.manifest.refs.produces.filter((p) => p.marker) || null);
    const list = producing.get(c.module);
    if (!list || !list.length) continue;
    const kind = list.find((p) => c.key.startsWith(p.key.replace('{id}', '')));
    if (kind && !got.has(kind.kind)) got.set(kind.kind, { change: c, kind, consumers: markerConsumers(c, kind) });
  }
  batchMarkers.set(batch, got);
  return got;
}
// Today's date where the server is, as YYYY-MM-DD: a day marker before it is past.
function todayIn(tz, now = Date.now()) {
  const got = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now))) got[p.type] = p.value;
  return `${got.year}-${got.month}-${got.day}`;
}
app.get('/api/modules/:id/markers', (req, res) => {
  if (moduleViewer(req)?.keyed) return res.status(403).json({ error: `Markers are for people signed in or a ${word('space')}'s ${word('guest', { many: true })}, not the access key.` });
  if (!askedScope(req.query.scope, res, ['environment', 'space'])) return;
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const { manifest, entry, who } = ctx;
  const consumer = { manifest, entry };
  if (!manifest.refs.consumes.some((c) => (entry.approved?.refs || []).includes(c))) {
    return res.status(403).json({ error: `This ${word('module')} has not been approved to link to other ${word('module', { many: true })}' ${word('object', { many: true })}.` });
  }
  const fromText = req.query.from;
  const toText = req.query.to;
  if (typeof fromText !== 'string' || typeof toText !== 'string' || !fromText || !toText) return res.status(400).json({ error: 'from and to are both needed, as dates or times, such as 2026-10-01 or 2026-10-01T18:00:00Z.' });
  const fromMs = externalWhen(fromText);
  const toMs = externalWhen(toText);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return res.status(400).json({ error: MARKER_WHEN });
  if (toMs < fromMs) return res.status(400).json({ error: 'to comes after from.' });
  // A date-only `to` takes in its whole day; a day marker counts when its day is between from's and to's, as written.
  // The 92 days are measured to that end, so a date-only `to` 92 days after `from` (93 days in all) is refused.
  const toEnd = /^\d{4}-\d{2}-\d{2}$/.test(toText) ? toMs + 86400000 : toMs;
  if (toEnd - fromMs > MARKER_DAYS * 86400000) return res.status(400).json({ error: `from and to can be at most ${MARKER_DAYS} days apart.` });
  const fromDay = fromText.slice(0, 10);
  const toDay = toText.slice(0, 10);
  // Where to read: the space the module is mounted in, or the environment and each space the viewer is a member of
  // (the spaces-data rule; refScope then checks each one, both modules on there and readable).
  const places = ctx.scope === 'space'
    ? [{ scope: 'space', space: ctx.spaceId }]
    : [{ scope: 'environment' }, ...store.spaces.filter((r) => r.members.includes(who.user.key)).map((r) => ({ scope: 'space', space: r.id }))];
  const tz = ics.serverZone();
  const now = Date.now();
  const today = todayIn(tz, now);
  const markers = [];
  for (const { manifest: producer } of modules.enabledAll()) {
    if (producer.id === manifest.id) continue;
    for (const kind of producer.refs.produces) {
      if (!kind.marker || !kind.dated || !consumerMayLink(consumer, producer.id, kind.kind)) continue;
      const prefix = kind.key.replace('{id}', '');
      for (const where of places) {
        let at;
        try {
          at = refScope(who, { provider: producer.id, kind: kind.kind, scope: where.scope, space: where.space, from: manifest.id });
        } catch (err) {
          if (!err.status) throw err;
          continue; // not on there, no scope of that kind, or not readable by this viewer
        }
        for (const stored of moduleData.list(producer.id, at.scopeKey, prefix)) {
          // Read without the fields this viewer may not see there (hiddenFor), its dates and title alike.
          const row = hideItem(stored, at.hide);
          const id = row.key.slice(prefix.length);
          if (!REF_ID_RE.test(id) || !row.value || typeof row.value !== 'object') continue;
          if (kind.summary.done && row.value[kind.summary.done] === true) continue; // done: off the grid
          const read = ics.readDated(row.value, kind.dated, tz);
          if (!read) continue; // no date, or a poll closed by hand (no closing time)
          if (read.allDay ? read.start < fromDay || read.start > toDay : read.start < fromMs || read.start >= toEnd) continue;
          const shown = shownModule(producer);
          // `due`: the kind is dated by a day it is due (dated.day: "Tasks due"), not by a moment (dated.start: "Polls
          // closing"), whether or not this one has a time. The module's tint (its manifest "color", one of the eight, or
          // null) and its icon as inline SVG: a module's frame cannot load the icon font, and a guest cannot ask
          // /api/icons, so the SVG comes with the marker.
          markers.push({
            ref: { ...at.ref, id },
            kind: kind.kind,
            title: String(read.title || '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 200) || 'Untitled',
            start: read.start,
            allDay: read.allDay,
            due: kind.dated.form === 'wall',
            past: read.allDay ? read.start < today : read.start < now,
            module: { id: producer.id, name: shown.name, icon: shown.icon, color: producer.color || null, svg: iconSvg(shown.icon) || null },
          });
        }
      }
    }
  }
  const sortMs = (m) => (m.allDay ? Date.parse(`${m.start}T00:00:00Z`) : m.start);
  markers.sort((a, b) => sortMs(a) - sortMs(b) || a.title.localeCompare(b.title));
  res.json({ markers: markers.slice(0, MARKER_CAP) });
});

// Links: a module tells the host which items one of its items points at, so the items pointed at can
// ask what points at them. `module` is the asking module, `from` one of its own items, `to` the items
// it now points at (the whole list: it replaces the last). Each target must be something the viewer
// can see and the module is approved to link to, and the viewer must be able to write to the module.
app.post('/api/objects/links', (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'sign in first' }); // the access key opens only a module's keyed page
  const asker = String(req.body?.module || '');
  const from = req.body?.from;
  const found = modules.enabled(asker);
  if (!found) return res.status(404).json({ error: `no such ${word('module')}` });
  if (!refShape(from) || from.module !== asker) return res.status(400).json({ error: `${word('module', { a: true })} can only say what its own ${word('object', { many: true })} point at` });
  if (from.scope === 'person') return res.status(400).json({ error: `personal ${word('object', { many: true })} are private, so they are not linked` });
  if (!found.manifest.refs.produces.some((p) => p.kind === from.kind)) return res.status(400).json({ error: `that ${word('module')} does not share that kind of ${word('object')}` });
  // The viewer must be allowed to change the asking module's data in that scope.
  let perms;
  if (from.scope === 'space') {
    const r = store.spaceById(String(from.space || ''));
    if (!r || !moduleSpaceAccess(found.entry, who, r)) return res.status(403).json({ error: `that ${word('module')} is not available in that ${word('space')} for you` });
    perms = modulePerms(who, r.id);
  } else {
    if (!who.user) return res.status(403).json({ error: `${word('guest', { many: true })} can only use ${word('module', { a: true })} in ${word('space', { a: true })}` });
    perms = modulePerms(who, null);
  }
  if (!moduleCan(found.manifest, perms, 'write')) return res.status(403).json({ error: `your role can't do that in this ${word('module')}` });
  // `kind`: replace only the links to objects of that kind (host.files.link keeps the object's other links as they are).
  const only = req.body?.kind === undefined || req.body?.kind === null || req.body?.kind === '' ? null : String(req.body.kind);
  if (only !== null && !/^[a-z][a-z0-9_-]{0,31}$/i.test(only)) return res.status(400).json({ error: `kind is a kind name` });
  // `op`: 'add' or 'remove' (with a kind) changes only those links, whatever else the object points at; the default replaces them all.
  const mode = req.body?.op === undefined || req.body?.op === null || req.body?.op === '' ? 'replace' : String(req.body.op);
  if (!['replace', 'add', 'remove'].includes(mode) || (mode !== 'replace' && only === null)) return res.status(400).json({ error: 'op is add or remove, with a kind' });
  const tos = [];
  const held = moduleLinks.from(from);
  for (const to of (Array.isArray(req.body?.to) ? req.body.to : []).slice(0, 20)) {
    if (to && to.scope === 'person') continue; // a shared link never points into someone's private data
    if (only !== null && !(to && to.kind === only)) return res.status(400).json({ error: `every link must be to a ${only}` });
    if (mode === 'remove') {
      // Taking a link out needs no sight of what it pointed at, except a library file hidden from this person: they can't
      // take out a link to it, and it is passed over as quietly as one the object doesn't hold, so the answer is the same
      // whether it is held or not (plan-vault-privacy.md). A link to a removed file ("File removed") can still be taken out.
      if (!refShape(to)) continue;
      if (isLibraryFileRef(to) && held.some((h) => objectKey(h) === objectKey(to)) && !refFileSeen(who, to, true)) continue;
      tos.push(to);
      continue;
    }
    try {
      resolveRef(who, to, asker);
      tos.push(to);
    } catch (err) {
      if (!err.status) throw err; // one that cannot be seen or is gone is left out
      // A file that was linked and is now removed keeps its link, which reads "File removed" (plan-attachments-vault.md, decision 2).
      if (err.status === 404 && refShape(to) && held.some((h) => objectKey(h) === objectKey(to)) && modules.enabled(to.module)?.manifest.library && to.kind === 'file') tos.push(to);
    }
  }
  // A link this person can't see (a file not shared with them) is not theirs to drop: replacing the object's links keeps
  // it, so a booking keeps the file someone else attached. Only someone who can see it, or names it in op remove, takes it out.
  if (mode === 'replace') {
    for (const h of held) {
      if ((only !== null && h.kind !== only) || tos.some((t) => refShape(t) && objectKey(t) === objectKey(h))) continue;
      try {
        resolveRef(who, h, asker);
      } catch (err) {
        if (!err.status) throw err;
        if (err.hiddenFile) tos.push(h);
      }
    }
  }
  moduleLinks.set(from, tos, who.user?.key || 'guest', only, mode);
  // Only the links this person can see are counted.
  const counted = mode === 'replace' ? tos : moduleLinks.from(from).filter((l) => l.kind === only);
  res.json({ links: counted.filter((l) => !isLibraryFileRef(l) || refFileSeen(who, l, true)).length });
});

// What points at an item (`dir=to`, for the module that owns it, if it shows backlinks) or what it
// points at (`dir=from`): summaries, each only for what the viewer may see.
app.get('/api/objects/links', (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'sign in first' }); // the access key opens only a module's keyed page
  let ref;
  try {
    ref = JSON.parse(String(req.query.ref || ''));
  } catch {
    return res.status(400).json({ error: 'that is not a valid reference' });
  }
  const asker = String(req.query.from || '');
  const found = modules.enabled(asker);
  if (!found) return res.status(404).json({ error: `no such ${word('module')}` });
  if (!refShape(ref) || ref.module !== asker) return res.status(400).json({ error: `${word('module', { a: true })} can only ask about its own ${word('object', { many: true })}` });
  const produce = found.manifest.refs.produces.find((p) => p.kind === ref.kind);
  if (!produce) return res.status(400).json({ error: `that ${word('module')} does not share that kind of ${word('object')}` });
  const dir = req.query.dir === 'from' ? 'from' : 'to';
  if (dir === 'to' && !produce.backlinks) return res.status(403).json({ error: `that kind of ${word('object')} does not show what links to it` });
  // The asking module's own item must itself be visible to the viewer.
  try {
    resolveRef(who, ref, null, { skipConsumer: true });
  } catch (err) {
    if (!err.status) throw err;
    return res.status(err.status).json({ error: err.message });
  }
  const summaries = [];
  for (const other of dir === 'to' ? moduleLinks.to(ref) : moduleLinks.from(ref)) {
    try {
      summaries.push(dir === 'to' ? resolveRef(who, other, null, { skipConsumer: true }) : resolveRef(who, other, asker));
    } catch (err) {
      if (!err.status) throw err; // gone, or not for this viewer
      // A link to a file that was removed is kept and said: the object it was on shows "File removed" (never for one this
      // person could not have seen: those are left out, as above).
      if (dir === 'from' && err.status === 404 && other.kind === 'file' && modules.enabled(other.module)?.manifest.library && !err.unseen) summaries.push({ ref: other, kind: 'file', title: 'File removed', removed: true, state: 'gone', icon: 'file-circle-xmark' });
    }
  }
  res.json({ summaries });
});

// What points at several of a module's items in one request (the list of places asks once, not once per place): the same
// answer as GET /api/objects/links with dir=to for each, for what the viewer may see. An item that cannot be asked about
// (not the module's own, not visible, a kind that shows no backlinks) is left out of the answer. Read only.
app.post('/api/objects/links/batch', (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'sign in first' });
  const asker = String(req.body?.module || '');
  const found = modules.enabled(asker);
  if (!found) return res.status(404).json({ error: `no such ${word('module')}` });
  const out = [];
  for (const ref of (Array.isArray(req.body?.refs) ? req.body.refs : []).slice(0, 200)) {
    if (!refShape(ref) || ref.module !== asker) continue;
    const produce = found.manifest.refs.produces.find((p) => p.kind === ref.kind);
    if (!produce || !produce.backlinks) continue;
    try {
      resolveRef(who, ref, null, { skipConsumer: true });
    } catch (err) {
      if (!err.status) throw err;
      continue;
    }
    const summaries = [];
    for (const other of moduleLinks.to(ref)) {
      try {
        summaries.push(resolveRef(who, other, null, { skipConsumer: true }));
      } catch (err) {
        if (!err.status) throw err;
      }
    }
    if (summaries.length) out.push({ ref, summaries });
  }
  res.json({ links: out });
});

// --- events and actions: modules reacting to and asking things of each other -------------------
// Like refs, the host is only the conduit. A module declares in module.json the events it publishes and
// the ones it wants to hear (`events`), and the actions it provides and the ones it wants to ask
// for (`actions`); an admin approves what a module hears and asks for; this code checks who may do
// what and carries the messages, and knows nothing of what any of them mean. An event is delivered
// live to the modules that may hear it and kept a while for those not open at the time. An action
// request waits in the providing module's queue until a person has that module open: its page claims
// the request (one page only), does it under its own rules, and reports back.

const busMay = (rules, approved, want) => (rules.includes('*') || rules.includes(want)) && (approved.includes('*') || approved.includes(want));
const mayHear = ({ manifest, entry }, publisher, name) => busMay(manifest.events.subscribes, entry.approved?.events || [], `${publisher}:${name}`);
const mayUse = ({ manifest, entry }, provider, action) => busMay(manifest.actions.uses, entry.approved?.actions || [], `${provider}:${action}`);

// Resolve one module's place (the environment, or a space) for this viewer with the permission needed.
function busPlace(who, moduleId, scope, space, need) {
  const found = modules.enabled(moduleId);
  if (!found) throw refError(404, `no such ${word('module')}`);
  const { manifest, entry } = found;
  let scopeKey;
  let perms;
  let spaceId = null;
  if (scope === 'space') {
    const r = store.spaceById(String(space || ''));
    if (!r) throw refError(404, `no such ${word('space')}`);
    if (!manifest.scope.includes('space')) throw refError(400, `that ${word('module')} has no space scope`);
    if (!moduleSpaceAccess(entry, who, r)) throw refError(403, `that ${word('module')} is not available in that ${word('space')} for you`);
    perms = modulePerms(who, r.id);
    scopeKey = scopeKeyOf('space', { spaceId: r.id });
    spaceId = r.id;
  } else {
    if (!who.user) throw refError(403, `${word('guest', { many: true })} can only use ${word('module', { a: true })} in ${word('space', { a: true })}`);
    if (!manifest.scope.includes('environment')) throw refError(400, `that ${word('module')} has no environment scope`);
    perms = modulePerms(who, null);
    scopeKey = 'environment';
  }
  if (!moduleCan(manifest, perms, need)) throw refError(403, `your role can't do that in this ${word('module')}`);
  return { found, scopeKey, spaceId, perms };
}

// The bus works in one place: the environment (also when none is named) or a space; any other scope is refused.
function busScope(v) {
  const scope = v === undefined || v === '' ? 'environment' : v;
  if (!SCOPE_NAMES.includes(scope)) throw refError(400, BAD_SCOPE);
  if (scope !== 'environment' && scope !== 'space') throw refError(400, 'scope must be environment or space here');
  return scope;
}

// An action about one of the provider's own objects is checked in that object's place, not the asker's
// (plan-calendar-destination, decision 21: each space's own permissions). This matters only for a page in the
// environment (the Calendar destination's parts): asking to change a task in a space takes the right to change the
// To-do in that space, whatever the viewer may do at environment level. A page in a space keeps its own place.
// Answers the space id of the provider's own objects named in the input, or null when none is in a space; refuses
// objects in more than one place.
const actionOwnKind = (providerId, type) => String(type).replace(/\?$/, '').startsWith(`ref:${providerId}:`);
const takesOwnObject = (providerId, def) => !def.local && Object.values(def.input || {}).some((t) => actionOwnKind(providerId, t));
function actionObjectSpace(providerId, def, input) {
  const given = input && typeof input === 'object' ? input : {};
  const places = new Set();
  for (const [field, type] of Object.entries(def.input || {})) {
    if (!actionOwnKind(providerId, type)) continue;
    const v = given[field];
    if (refShape(v) && v.module === providerId) places.add(v.scope === 'space' ? v.space : '');
  }
  if (places.size > 1) throw refError(400, `an action can change ${word('object', { many: true })} in only one place at a time`);
  const [only] = [...places];
  return only || null;
}
// Whether this viewer may change the provider where a waiting request's object is: in its space when it names one,
// else in the place the request waits in (as before).
function busMayDo(who, providerId, scope, space, request) {
  try {
    if (request && request.space) busPlace(who, providerId, 'space', request.space, 'write');
    else busPlace(who, providerId, scope, space, 'write');
    return true;
  } catch (err) {
    if (!err.status) throw err;
    return false;
  }
}
const busRoute = (fn) => (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'sign in first' }); // the access key opens only a module's keyed page
  try {
    res.json(fn(who, req));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
};
const publicEvent = (e) => ({ id: e.id, at: e.at, module: e.module, name: e.name, ref: e.ref, data: e.data });
const publicAction = (a) => ({ id: a.id, at: a.at, from: a.from, name: a.action, input: a.input, by: store.userByKey(a.by)?.displayName || 'someone' });

// A module says something happened. It must have declared the event, and the person must be able to
// change that module here (they are the reason it happened).
app.post('/api/bus/publish', busRoute((who, req) => {
  const { module: id, name, ref, data, scope, space } = req.body || {};
  const at = busPlace(who, String(id || ''), busScope(scope), space, 'write');
  if (overLimit(at.found.manifest.id, who.user?.key, 'event')) throw refError(429, limitMessage());
  if (!at.found.manifest.events.publishes.some((p) => p.name === name)) throw refError(400, `that ${word('module')} does not publish that event`);
  let pointer = null;
  if (ref !== undefined && ref !== null) {
    if (!refShape(ref) || ref.module !== id || !at.found.manifest.refs.produces.some((p) => p.kind === ref.kind) || refScopeKey(ref) !== at.scopeKey) {
      throw refError(400, `an event can only point at one of its ${word('module')}'s own ${word('object', { many: true })}, in the same place`);
    }
    pointer = plainRef(ref);
  }
  const event = moduleBus.publish({ module: id, name, ref: pointer, data, scopeKey: at.scopeKey, by: who.user?.key || 'guest' });
  if (!event) throw refError(400, 'the event\'s data is too large');
  return { id: event.id };
}));

// What a module missed, in its own place: the events it may hear (declared and approved) about
// modules the person can see. `after=now` says where things stand, to start listening from.
app.get('/api/bus/events', busRoute((who, req) => {
  const at = busPlace(who, String(req.query.module || ''), busScope(req.query.scope), req.query.space, 'read');
  if (req.query.after === 'now') return { events: [], latest: moduleBus.latestEvent(at.scopeKey) };
  const after = Number(req.query.after) || 0;
  const events = [];
  for (const e of moduleBus.eventsAfter(at.scopeKey, after)) {
    if (!mayHear(at.found, e.module, e.name)) continue;
    try {
      busPlace(who, e.module, busScope(req.query.scope), req.query.space, 'read');
    } catch {
      continue; // a module the person cannot see here
    }
    events.push(publicEvent(e));
    if (events.length >= 100) break;
  }
  return { events, latest: events.length ? events[events.length - 1].id : moduleBus.latestEvent(at.scopeKey) };
}));

// The actions the asking module may request here: every one, of every other module, it was approved for.
app.get('/api/bus/actions', busRoute((who, req) => {
  const from = String(req.query.from || '');
  const scope = busScope(req.query.scope);
  const asker = busPlace(who, from, scope, req.query.space, 'read');
  // `ref` (optional, a pointer as JSON): the object the actions would be about, such as the one just dropped. From a
  // page in the environment, an action on one of its provider's own objects is then listed by that object's place.
  let about = null;
  if (req.query.ref !== undefined && req.query.ref !== '') {
    try { about = JSON.parse(String(req.query.ref)); } catch { about = null; }
    if (!refShape(about)) throw refError(400, 'that is not a valid reference');
  }
  const can = (providerId, sc, sp, need) => {
    try { busPlace(who, providerId, sc, sp, need); return true; } catch (err) { if (!err.status) throw err; return false; }
  };
  // Whether the viewer could ask for this action from here (you can ask only for what you could do yourself).
  const mayAsk = (found, a) => {
    const id = found.manifest.id;
    if (scope !== 'environment' || !takesOwnObject(id, a)) return can(id, scope, req.query.space, a.local ? 'read' : 'write');
    if (!can(id, scope, req.query.space, 'read')) return false; // the request waits at environment level
    if (about && about.module === id) return about.scope === 'space' ? can(id, 'space', about.space, 'write') : can(id, scope, req.query.space, 'write');
    // No object named: listed when the viewer may change the provider at environment level or in one of their spaces;
    // the request itself is checked in its object's place.
    return can(id, scope, req.query.space, 'write') || Boolean(who.user && readableSpacesOf(found, who).some((r) => can(id, 'space', r.id, 'write')));
  };
  // `accepts=module:kind` keeps the actions that take a pointer to that kind of item; `self=1` also lists the
  // asking module's own, which it may always use.
  const accepts = String(req.query.accepts || '');
  const takes = (input) => !accepts || Object.values(input).some((t) => { const b = t.replace(/\?$/, ''); return b === 'ref' || b === `ref:${accepts}`; });
  const actions = [];
  // The viewer's role here, for an action's `takes` permissions (plan-object-handoff.md): an action whose every entry
  // they are refused is left out.
  const viewerPerms = modulePerms(who, asker.spaceId);
  for (const found of modules.enabledAll()) {
    const { manifest } = found;
    const own = manifest.id === from;
    if (own && req.query.self !== '1') continue;
    for (const a of manifest.actions.provides) {
      if (!takes(a.input)) continue;
      const taken = a.takes ? takesFor(manifest, a, viewerPerms) : null;
      if (taken && !taken.some((e) => e.may)) continue;
      if (!own) {
        if (!mayUse(asker.found, manifest.id, a.name)) continue;
        if (!mayAsk(found, a)) continue;
      }
      actions.push({ action: `${manifest.id}:${a.name}`, module: manifest.id, moduleName: shownModule(manifest).name, icon: shownModule(manifest).icon, name: a.name, label: a.label, input: a.input, ...(a.needs ? { needs: a.needs } : {}), ...(taken ? { takes: taken } : {}), ...(own ? { own: true } : {}) });
    }
  }
  return { actions };
}));

// An object's kind as a person reads it in a refusal: "a flight", "an event", or "an object with no kind".
const kindWords = (kind) => (kind ? `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}` : `${word('object', { a: true })} with no kind`);

// An action's `takes` as a caller sees it: each entry with `may`, whether they hold the entry's permission (true when it
// names none).
const takesFor = (manifest, a, perms) => a.takes.map((e) => ({ ...e, may: !e.permission || Boolean(perms[`module.${manifest.id}.${e.permission}`]) }));

// What busInput needs to check an `object` input: the action's `takes`, the module's shown name for a refusal, and
// whether the person holds one of the module's own permissions in the place the request is for.
function takerOf(who, manifest, def, spaceId) {
  let perms = null;
  return {
    takes: def.takes,
    moduleName: shownModule(manifest).name || manifest.name,
    has: (key) => Boolean((perms || (perms = modulePerms(who, spaceId || null)))[`module.${manifest.id}.${key}`]),
  };
}

// Whether text that starts with YYYY-MM-DD names a day that exists: Date rolls 2026-02-31 over to March 3, so the
// day is checked by hand. Text that doesn't start that way is left to the caller's own check.
function realDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!m) return true;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && new Date(Date.UTC(y, mo - 1, d)).getUTCDate() === d;
}

// Check an action's input against what the module said it takes; only those fields come out. An `object` field is cleaned
// by the objects format's checker (plan-object-handoff.md, "The bus's object type"); its kind must be one the action's
// `takes` (`taker`, from takerOf) takes, with that entry's permission when it names one.
function busInput(who, shape, input, taker) {
  const out = {};
  const given = input && typeof input === 'object' ? input : {};
  for (const [field, type] of Object.entries(shape)) {
    const optional = type.endsWith('?');
    const base = optional ? type.slice(0, -1) : type;
    const v = given[field];
    if (v === undefined || v === null || v === '') {
      if (!optional) throw refError(400, `${field} is needed`);
      continue;
    }
    if (base === 'string' || base === 'text') {
      if (typeof v !== 'string') throw refError(400, `${field} must be text`);
      out[field] = v.replace(/\p{Cc}/gu, ' ').trim().slice(0, base === 'string' ? 200 : 8000);
      if (!out[field] && !optional) throw refError(400, `${field} is needed`);
    } else if (base === 'date') {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !realDay(v)) throw refError(400, `${field} must be a date`);
      out[field] = v;
    } else if (base === 'datetime') {
      const d = new Date(v);
      if (typeof v !== 'string' || Number.isNaN(d.getTime()) || !realDay(v)) throw refError(400, `${field} must be a date and time`);
      out[field] = d.toISOString();
    } else if (base === 'boolean') {
      if (typeof v !== 'boolean') throw refError(400, `${field} must be true or false`);
      out[field] = v;
    } else if (base === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw refError(400, `${field} must be a number`);
      out[field] = v;
    } else if (base === 'object') {
      if (typeof v !== 'object' || Array.isArray(v)) throw refError(400, `${field} must be ${word('object', { a: true })}`);
      const kept = objectFormat.cleanHandoff(v);
      if (v.kind === 'image' && !(kept && kept.details && kept.details.upload)) throw refError(400, `${field} is a picture, so its details.upload must be the id of a file uploaded to the ${word('module')}`);
      if (!kept) throw refError(400, `${field} needs a title, and content or details`);
      const entries = objectFormat.takersOf(taker && taker.takes, kept.kind);
      if (!entries.length) throw refError(400, `${taker ? taker.moduleName : `that ${word('module')}`} cannot take ${kindWords(kept.kind)}`);
      if (!entries.some((e) => !e.permission || taker.has(e.permission))) throw refError(403, `you may not add ${kindWords(kept.kind)} to ${taker.moduleName} here`);
      out[field] = kept;
    } else if (base === 'ref' || base.startsWith('ref:')) {
      if (!refShape(v)) throw refError(400, `${field} must be a reference`);
      if (base !== 'ref' && base !== `ref:${v.module}:${v.kind}`) throw refError(400, `${field} must be a ${base.slice(4).replace(':', ' ')}`);
      resolveRef(who, v, null, { skipConsumer: true }); // the asker must be able to see what it points at
      out[field] = plainRef(v);
    }
  }
  return out;
}

// One module asks another to do something. Queued for the module that owns the action.
app.post('/api/bus/actions/request', busRoute((who, req) => {
  const { from, action, input, scope, space } = req.body || {};
  const [providerId, name] = String(action || '').split(':');
  const sc = busScope(scope);
  const asker = busPlace(who, String(from || ''), sc, space, 'read');
  if (overLimit(asker.found.manifest.id, who.user?.key, 'action')) throw refError(429, limitMessage());
  const provider = busPlace(who, String(providerId || ''), sc, space, 'read');
  const def = provider.found.manifest.actions.provides.find((a) => a.name === name);
  if (!def) throw refError(404, `that ${word('module')} does not offer that action`);
  if (!mayUse(asker.found, providerId, name)) throw refError(403, `that ${word('module')} has not been approved to ask for that`);
  // Asking for a change takes the right to make it: from a page in the environment, about an object in a space, the
  // right to change the module in that space (decision 21); otherwise in the place the asker is in, as before.
  const objectSpace = sc === 'environment' && takesOwnObject(providerId, def) ? actionObjectSpace(providerId, def, input) : null;
  if (objectSpace) busPlace(who, String(providerId), 'space', objectSpace, 'write');
  else if (!def.local) busPlace(who, String(providerId), sc, space, 'write');
  const request = moduleBus.request({ from, provider: providerId, action: name, input: busInput(who, def.input, input, takerOf(who, provider.found.manifest, def, objectSpace || provider.spaceId)), scopeKey: provider.scopeKey, by: who.user?.key || 'guest', local: def.local, askerOnly: def.askerOnly, space: objectSpace });
  return { id: request.id, status: request.status };
}));

// The providing module's page: what is waiting, take one, say how it went.
app.get('/api/bus/actions/pending', busRoute((who, req) => {
  const id = String(req.query.module || '');
  const scope = busScope(req.query.scope);
  const at = busPlace(who, id, scope, req.query.space, 'read');
  const canWrite = busMayDo(who, id, scope, req.query.space, null);
  // A view (`local`) is for the person who asked, from their own page; so is a request whose result is theirs
  // (`askerOnly`), which also takes write access. Anything else waits for a page that may make the change: in the
  // object's space when the request names one, else here.
  const me = who.user?.key || 'guest';
  const mayTake = (a) => (a.local ? a.by === me : (!a.askerOnly || a.by === me) && (a.space ? busMayDo(who, id, scope, req.query.space, a) : canWrite));
  return { actions: moduleBus.pending(id, at.scopeKey).filter(mayTake).map(publicAction) };
}));
// Someone else's request that only its asker's page may take (`askerOnly`): told no, as a request another page took is.
const notTheAsker = (who, request) => Boolean(request && request.askerOnly && request.by !== (who.user?.key || 'guest'));
app.post('/api/bus/actions/claim', busRoute((who, req) => {
  const { module: id, id: requestId, scope, space } = req.body || {};
  const at = busPlace(who, String(id || ''), busScope(scope), space, 'read');
  const waiting = moduleBus.actionById(Number(requestId));
  if (notTheAsker(who, waiting)) return { ok: false };
  if (waiting && waiting.local) { if (waiting.by !== (who.user?.key || 'guest')) return { ok: false }; } else if (waiting && waiting.space && waiting.provider === id && waiting.scopeKey === at.scopeKey) busPlace(who, String(id || ''), 'space', waiting.space, 'write'); else busPlace(who, String(id || ''), busScope(scope), space, 'write');
  const request = moduleBus.claim(Number(requestId), id, at.scopeKey);
  return request ? { ok: true, action: publicAction(request) } : { ok: false };
}));
app.post('/api/bus/actions/complete', busRoute((who, req) => {
  const { module: id, id: requestId, scope, space, result } = req.body || {};
  const at = busPlace(who, String(id || ''), busScope(scope), space, 'read');
  const done = moduleBus.actionById(Number(requestId));
  if (notTheAsker(who, done)) return { ok: false };
  if (done && done.local) { if (done.by !== (who.user?.key || 'guest')) return { ok: false }; } else if (done && done.space && done.provider === id && done.scopeKey === at.scopeKey) busPlace(who, String(id || ''), 'space', done.space, 'write'); else busPlace(who, String(id || ''), busScope(scope), space, 'write');
  const clean = { ok: Boolean(result?.ok) };
  if (typeof result?.error === 'string') clean.error = result.error.slice(0, 200);
  // A small piece of plain data may come back with the result (up to about 8 KB of JSON), for a view that asks a question.
  if (result?.data !== undefined) {
    try {
      const text = JSON.stringify(result.data);
      if (text && text.length <= 8000) clean.data = JSON.parse(text);
    } catch (err) { /* not plain data: left out */ }
  }
  if (refShape(result?.ref) && result.ref.module === id) clean.ref = plainRef(result.ref);
  return { ok: Boolean(moduleBus.complete(Number(requestId), id, at.scopeKey, clean)) };
}));
// The asking module: how did it go?
app.get('/api/bus/actions/status', busRoute((who, req) => {
  const from = String(req.query.from || '');
  const at = busPlace(who, from, busScope(req.query.scope), req.query.space, 'read');
  const request = moduleBus.actionById(Number(req.query.id));
  if (!request || request.from !== from || request.scopeKey !== at.scopeKey) throw refError(404, 'no such request');
  return { status: moduleBus.statusOf(request), result: request.result };
}));

// --- what modules have been doing ------------------------------------------------------------
// The last things modules did through the host (data they saved, events they published, actions they asked
// for), so an admin can see, above all for a module running in the page, what it has been up to. Only
// what passes through the host is seen: a module in the page can also do things the host never hears of.
// Kept across a restart (DATA_DIR/modules/activity.json, written a few seconds after a change and on exit).
// Built per environment in server/environment.js (moduleActivity, noteActivity); the event wiring below it
// (a change, a published event, an action asked for -> a line in the activity list) is wired there too.

// How often a module may do things through the host (see server/module-limits.js). Over the limit is a 429 and, the
// first time in a while, a line in the activity list so an admin can see which module is being slowed.
function overLimit(moduleId, by, kind) {
  const r = moduleLimits.take(moduleId, by || 'guest', kind);
  if (r.ok) return null;
  lastLimited = { moduleId, retrySeconds: r.retrySeconds };
  if (r.first) noteActivity(moduleId, `was slowed: too many ${kind === 'write' ? 'saves' : kind.startsWith('clear') ? 'clears' : kind.startsWith('library') ? 'files' : kind + 's'} in a minute`, by === '*' ? null : by, null);
  return r;
}
// The Vault's budget: a file or a small picture counts for the person and for the environment together; refused by either,
// the person's count is given back. Returns the refusal or null.
function overLibraryLimit(ctx, kind) {
  const mine = overLimit(ctx.manifest.id, ctx.by, kind);
  if (mine) return mine;
  const all = overLimit(ctx.manifest.id, '*', 'libraryAll');
  if (all) moduleLimits.refund(ctx.manifest.id, ctx.by, kind);
  return all;
}
// The sentence for the refusal overLimit just made (it is always built straight after, in the same turn): the module's own
// name and what to do, with the seconds to wait.
let lastLimited = null;
function limitMessage() {
  const l = lastLimited;
  lastLimited = null;
  const found = l && modules.enabled(l.moduleId);
  const name = found ? modules.shownName(found.manifest) : `This ${word('module')}`;
  const secs = l ? l.retrySeconds : 0;
  return secs ? `${name} is busy. Wait ${secs} ${secs === 1 ? 'second' : 'seconds'} and it will carry on.` : `${name} is busy. Wait a moment and it will carry on.`;
}
app.get('/api/modules/activity', requireOwner, (_req, res) => {
  res.json({
    activity: moduleActivity.slice(-100).reverse().map((a) => ({ ...a, moduleName: store.moduleDisplay(a.module).name || modules.enabled(a.module)?.manifest.name || a.module, byName: store.userByKey(a.by)?.displayName || (a.by === 'guest' ? word('guest', { a: true }) : a.by) })),
  });
});

// Modules with a page of their own that this viewer can open: the header nav.
// The pre-made backgrounds that ship with the app (see server/backgrounds.js), for the picker beside an image slot.
const backgrounds = new Backgrounds(path.join(publicDir, 'assets', 'images', 'backgrounds'));
app.get('/api/backgrounds', (req, res) => {
  if (!currentUser(req)) return res.status(401).json({ error: 'sign in first' });
  res.json({ backgrounds: backgrounds.all() });
});

// Every enabled module with a page of its own (surfaces.page, mounted for the environment) that this viewer may read,
// widget or not: the top bar's module menu, and public/module.js's way to find a module's page at all. A manifest's
// surfaces.page.nav is no longer read (plan-primary-nav.md, decision 12): every page is listed, so `nav` is always
// true, kept only for the pages that still filter on it until the bar is redrawn.
app.get('/api/modules/nav', (req, res) => {
  const who = moduleViewer(req);
  if (!who?.user) return res.json({ modules: [] });
  const perms = modulePerms(who, null);
  res.json({
    modules: modules.enabledAll()
      .filter(({ manifest }) => manifest.scope.includes('environment') && manifest.surfaces.page && moduleCan(manifest, perms, 'read'))
      .map(({ manifest, entry }) => ({ id: manifest.id, ...shownModule(manifest), version: manifest.version, scope: manifest.scope, runMode: modules.runModeOf(entry), page: manifest.surfaces.page.entry, widget: Boolean(manifest.surfaces.widget), nav: true })),
  });
});

// The widgets for the dashboard on the rooms page: enabled modules with a surfaces.widget that this person may
// read, in the order the modules ask for. A guest has no dashboard. `href`: where the tile's heading goes, the module's
// page, or the destination it is a part of while that is shown (plan-calendar-destination.md, decision 16), with
// #panel=<module id> for a panel.
app.get('/api/modules/widgets', (req, res) => {
  const who = moduleViewer(req);
  if (!who?.user) return res.json({ widgets: [] });
  const perms = modulePerms(who, null);
  const ctx = destinationContext(who);
  const widgets = modules.enabledAll()
    .filter(({ manifest }) => manifest.scope.includes('environment') && manifest.surfaces.widget && moduleCan(manifest, perms, 'read'))
    .map(({ manifest, entry }) => ({
      id: manifest.id, ...shownModule(manifest), version: manifest.version, scope: manifest.scope, runMode: modules.runModeOf(entry),
      // The widget's own title stays its own (plan decision 9: a display name replaces the module's name, not a widget's
      // label); a widget with none takes the module's name, as shown.
      title: manifest.surfaces.widget.title || shownModule(manifest).name, size: manifest.surfaces.widget.size, order: manifest.surfaces.widget.order, entry: manifest.surfaces.widget.entry,
      href: widgetHref(manifest.id, ctx),
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  res.json({ widgets });
});

// --- destinations (plan-calendar-destination.md, plan-map-destination.md; the rules are server/destinations.js) ------------
// A destination is a page of its own in the top bar, made of parts modules declare (surfaces.destination). Shown to a
// signed-in person while its environment option is on and its main part is enabled and readable at environment level.

// Whether a module's environment file settings name at least one file that is there (a destination that `needsFile`:
// the map's file, plan-map-destination.md, "Server"). A shared folder (the host's, with environments) gives every file
// in it; otherwise the ticked names count, each only if it is still a file. Read by name and stat only, never the
// files' headers, since the top bar asks on every page.
function moduleHasFile(manifest) {
  const values = moduleSettings.values(manifest, 'environment', {});
  return (manifest.settings || []).some((d) => {
    if (d.scope !== 'environment' || (d.type !== 'file' && d.type !== 'files')) return false;
    const dir = filesDirFor(manifest, d.folder);
    const isFile = (name) => {
      try { return FILE_NAME_RE.test(name) && fs.statSync(path.join(dir, name)).isFile(); } catch { return false; }
    };
    if (settingIsShared(manifest, d)) {
      try { return fs.readdirSync(dir).some(isFile); } catch { return false; }
    }
    const v = values[d.key];
    return (Array.isArray(v) ? v : v ? [v] : []).some((name) => typeof name === 'string' && isFile(name));
  });
}
// What server/destinations.js needs to know about one viewer (null: a guest or nobody signed in, who sees none).
function destinationContext(who) {
  if (!who?.user) return null;
  const perms = modulePerms(who, null);
  return { settings: store.settings, enabled: modules.enabledAll(), canRead: (manifest) => manifest.scope.includes('environment') && moduleCan(manifest, perms, 'read'), hasFile: moduleHasFile };
}
// For Manage's Top bar switches (GET /api/settings, `topBarReasons`): why each destination cannot show for anyone
// whatever its option, in one sentence, or null when nothing stands in its way. The module named is the one whose
// main part it is: the enabled one, else the installed one that is off.
function destinationReasons() {
  const enabled = modules.enabledAll();
  const installed = modules.list().map((m) => ({ manifest: m, entry: { source: m.source } }));
  const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
  return Object.fromEntries(destinations.DESTINATIONS.map((dest) => {
    const blocked = destinations.blockerOf(dest.id, { enabled, hasFile: moduleHasFile });
    if (!blocked) return [dest.id, null];
    if (blocked.why === 'no-main') {
      const off = destinations.mainOf(dest.id, installed);
      return [dest.id, off ? `Turn on ${shownModule(off.manifest).name} on the ${word('module', { many: true, cap: true })} tab first.` : `No installed ${word('module')} offers this page yet.`];
    }
    const name = shownModule(blocked.manifest).name;
    const def = (blocked.manifest.settings || []).find((d) => d.scope === 'environment' && (d.type === 'file' || d.type === 'files'));
    if (def && settingIsShared(blocked.manifest, def)) return [dest.id, `Ask the ${word('host')}'s ${word('admin')} for a file for ${name}.`];
    return [dest.id, `Choose a file for "${def?.label || 'Files'}" in ${possessive(name)} settings first.`];
  }));
}
// The page every destination is drawn on (experience-design's step 4). Until it exists, nothing leads to a destination:
// its address goes home, module pages stay where they are and the tiles keep their own links.
const destinationPageReady = () => fs.existsSync(page('destination.html'));
// Where a module's environment page leads while it is part of a shown destination: the destination's address, or null.
function destinationPathOf(moduleId, ctx) {
  if (!ctx || !destinationPageReady()) return null;
  return destinations.destinationOfModule(moduleId, ctx)?.dest.path || null;
}

// Where a tile's heading goes: the module's page; the destination while the module is part of a shown one, with
// #panel=<module id> when it is a panel there (not the main), so the page opens that panel or phone tab.
function widgetHref(moduleId, ctx) {
  const shown = ctx && destinationPageReady() ? destinations.destinationOfModule(moduleId, ctx) : null;
  if (!shown) return `/modules/${encodeURIComponent(moduleId)}`;
  return shown.main.manifest.id === moduleId ? shown.dest.path : `${shown.dest.path}#panel=${encodeURIComponent(moduleId)}`;
}

// The destinations shown for this viewer, for the top bar: [{ id, name, icon, href }], the name and icon its main
// module's as this environment shows it. Anyone else (a guest, nobody signed in) gets none.
app.get('/api/destinations', (req, res) => {
  const ctx = destinationContext(moduleViewer(req));
  res.json({
    destinations: ctx ? destinations.shownDestinations(ctx).map(({ dest, main }) => ({ id: dest.id, ...shownModule(main.manifest), href: dest.path })) : [],
  });
});

// A destination as a view of one space (plan-calendar-todo.md and plan-map-places.md, step 1; `?space=<id>`): the parts
// whose module is on in that space and readable by the viewer there, a guest with the space's token included. The
// environment option governs only the aggregate page, so it is not asked here. Answers { shown, space } or null when
// the space is not one the viewer is in (an aside, an unknown id or an outsider all read the same, so nothing says
// which spaces exist), or the destination has no readable main there.
function destinationInSpace(id, who, spaceId) {
  if (!who || who.keyed) return null;
  const space = store.spaceById(String(spaceId || ''));
  if (!space) return null;
  const inIt = who.user ? hasOwnerRights(who.user) || space.members.includes(who.user.key) : who.guestSpace.id === space.id;
  if (!inIt) return null;
  const perms = modulePerms(who, space.id);
  const enabled = modules.enabledAll();
  const canRead = (manifest) => {
    const found = enabled.find((m) => m.manifest.id === manifest.id);
    return Boolean(found) && manifest.scope.includes('space') && !refusedInLobby(manifest, space.id) && modules.isOnIn(found.entry.id, space.id) && moduleCan(manifest, perms, 'read');
  };
  const shown = destinations.resolveDestinationInSpace(id, { enabled, canRead, hasFile: moduleHasFile });
  return shown ? { shown, space } : null;
}
const destinationSpaceRefusal = () => `That page is not available in that ${word('space')} for you.`;

// One destination, for its page: its main part, its panels (in their order) and the spaces any of its parts reads, in
// the space list's order. A part is what mountModule() takes: { part, module: { id, version, scope, name, icon },
// entry, runMode, label }. 404 when it is not shown for this viewer. With ?space=<id>, the same destination as a view
// of that space (destinationInSpace above): `spaces` is empty and `space` names the one it is a view of.
app.get('/api/destinations/:id', (req, res) => {
  const who = moduleViewer(req);
  const describe = ({ manifest, entry, part }) => ({
    part: part.part,
    module: { id: manifest.id, version: manifest.version, scope: manifest.scope, ...shownModule(manifest) },
    entry: part.entry,
    runMode: modules.runModeOf(entry),
    label: part.label || shownModule(manifest).name,
  });
  if (req.query.space !== undefined) {
    const found = destinationInSpace(req.params.id, who, req.query.space);
    if (!found) return res.status(404).json({ error: destinationSpaceRefusal() });
    const { shown, space } = found;
    return res.json({
      id: shown.dest.id,
      ...shownModule(shown.main.manifest),
      main: describe(shown.main),
      panels: shown.panels.map(describe),
      spaces: [],
      space: spaceSummary(space),
    });
  }
  const ctx = destinationContext(who);
  const shown = ctx ? destinations.resolveDestination(req.params.id, ctx) : null;
  if (!shown) return res.status(404).json({ error: 'That page is not in this top bar.' });
  const parts = [shown.main, ...shown.panels];
  const inSome = new Set(parts.flatMap((p) => readableSpacesOf(p, who).map((r) => r.id)));
  res.json({
    id: shown.dest.id,
    ...shownModule(shown.main.manifest),
    main: describe(shown.main),
    panels: shown.panels.map(describe),
    spaces: store.spaces.filter((r) => inSome.has(r.id)).map(spaceSummary),
  });
});

// --- module settings -------------------------------------------------------------------------------------
// What a module declares (module.json `settings`) and what people choose (server/module-settings.js). A module reads
// the values that apply to the viewer; the forms that change them are drawn by the host on the Modules tab (the server's),
// a room's own page (the room's) and the profile page (a person's own). Who may change what: the server's, an admin; a
// room's, an admin or one of that room's moderators; a person's own, that person.

// --- AI, for the modules that ask ---------------------------------------------------------------------------------------------
// One server-wide setting (see ai.js); the key never leaves the server and is never sent back. A module asks through the `ai` hook:
// the server checks the person's role and the space, reads the chosen objects as that person, asks the service the admin set up, and
// returns text with any summaries the model wrote (each checked). A module's ask keeps nothing: no question, no answer, no object's text
// (Chat's own /ai keeps the person's question and answer as private messages). The activity list gets who, which module and task, and
// how many tokens.
app.get('/api/ai', requireOwner, (_req, res) => res.json({ ai: ai.view(), usage: ai.usageView(), dependents: modules.aiDependents() }));
// The AI usage view (plan-ai-integration.md, "Observability"), for owners: this month's tokens and calls by template, person
// and space, refusals by reason, errors and cut-short answers, and the last 50 call records (never any content).
app.get('/api/ai/usage', requireOwner, (_req, res) => res.json(ai.usageReport()));
// The write tools an AI may propose in one space for the person asking (plan-ai-integration.md, slice 2 step 12): the
// catalog made from the enabled manifests (server/action-catalog.js), narrowed to what this person could ask for there now --
// the AI rule for Chat's /ai (decision 16), the module on in the space and theirs to change (its write access), and the
// module not kept out by What AI may see. Proposing and Keep are step 13; this only lists.
const actionCatalog = require('./action-catalog');
const { moduleAllowed: aiModuleAllowed } = require('./ai-policy');
app.get('/api/ai/catalog', (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'Sign in first.' });
  const spaceId = typeof req.query.space === 'string' ? req.query.space : '';
  if (!spaceId) return res.status(400).json({ error: `Say which ${word('space')} the tools are for.` });
  const space = store.spaceById(spaceId);
  if (!space) return res.status(404).json({ error: `No such ${word('space')}.` });
  const allowed = aiPolicy.check(who, space, 'chat');
  if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.why });
  const sees = aiPolicy.sees(space);
  const enabled = modules.enabledAll().map(({ manifest }) => manifest);
  const names = new Map(enabled.map((m) => [m.id, shownModule(m).name || m.name]));
  const mayChange = new Map();
  const may = (id) => {
    if (!mayChange.has(id)) {
      try { busPlace(who, id, 'space', space.id, 'write'); mayChange.set(id, true); } catch (err) { if (!err.status) throw err; mayChange.set(id, false); }
    }
    return mayChange.get(id);
  };
  const tools = actionCatalog.buildCatalog(enabled).tools
    .filter((t) => aiModuleAllowed(sees, t.module) && may(t.module))
    .map((t) => ({ name: t.name, module: t.module, moduleName: names.get(t.module), action: t.action, label: t.label, description: t.description, effect: t.effect, schema: t.schema }));
  res.json({ tools });
});
app.post('/api/ai/models', requireOwner, async (req, res) => {
  try {
    await ai.checkAddress({ provider: req.body?.provider, address: req.body?.address });
    res.json({ models: await ai.listModels({ provider: String(req.body?.provider || ''), address: req.body?.address, key: req.body?.key, workspace: req.body?.workspace }) });
  } catch (err) {
    sendAiError(err, res);
  }
});
app.put('/api/ai', requireOwner, async (req, res) => {
  try {
    const before = ai.view();
    await ai.checkAddress(req.body || {});
    // Turning AI off (however the patch does it) while a module depends on it: the admin's page should have asked first (as it
    // does for a module others `requires`); a caller that skipped that, or forces past it, is handled the same way.
    if (before.enabled && !ai.previewEnabled(req.body || {}) && req.body?.force !== true) {
      const dependents = modules.aiDependents();
      if (dependents.length) throw new AiError(`${dependents.map((m) => m.name).join(' and ')} needs the AI service; turn ${dependents.length === 1 ? 'it' : 'them'} off too?`);
    }
    const after = ai.set(req.body || {});
    // The modules switched off with the service are remembered, and switched on again when the service is: turning AI off and on
    // again leaves everything as it was.
    if (before.enabled && !after.enabled) {
      const off = modules.aiDependents();
      ai.rememberCascade(off.map((m) => m.id));
      for (const m of off) { moduleHolds.expireModule(m.id); modules.update(m.id, { enabled: false, force: true }); } // a Clear waiting for its Undo is finished while the module is on
    } else if (!before.enabled && after.enabled) {
      for (const id of ai.takeCascade()) {
        try { if (modules.view(id) && !modules.enabled(id)) modules.update(id, { enabled: true }); } catch { /* left off: an owner can switch it on */ }
      }
    }
    noteActivity('host', `changed the AI setting (${after.provider}${after.keySet && !before.keySet ? ', key set' : ''})`, currentUser(req)?.key, null);
    res.json({ ai: after, usage: ai.usageView(), dependents: modules.aiDependents() });
  } catch (err) {
    sendAiError(err, res);
  }
});
// Whether this person has the module's write access in the scope asked. access.personWrite opens a person's own data and
// uploads only (moduleAccess's 'own'): asking the AI takes access.write in every scope.
const aiModuleWrite = (ctx) => moduleCan(ctx.manifest, ctx.perms, 'write');
// Whether AI is available to this person here, for a module's page to show or hide its buttons: the same check as the ask,
// write access included, so a viewer who can only read is told so rather than refused later.
app.get('/api/modules/:id/ai', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx || !requireHook(ctx, res, 'ai')) return;
  const space = ctx.spaceId ? store.spaceById(ctx.spaceId) : null;
  res.json(aiPolicy.availability(ctx.who, space, 'module', { write: aiModuleWrite(ctx) }));
});

// Whether this person may bring objects into this place with this module (decision 12: not AI use), and reading them out of
// a paste or file. The module's write access is moduleAccess's.
app.get('/api/modules/:id/objects/check', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx) return;
  const why = aiPolicy.importRefusal(ctx.who);
  res.json({ available: !why, why });
});
function objectsFileType(req, res, next) {
  const t = String(req.headers['content-type'] || '');
  if (!t.includes('text/plain') && !t.includes('application/octet-stream')) {
    return res.status(415).json({ error: 'send the text as plain text, or the file as it is' });
  }
  next();
}
// A text/plain body is one another site can send without asking first, so sameOriginOnly (see "the app", above) is
// named on the route as well as run for every write: this route must never lose it.
const objectsFileText = express.text({ type: 'text/plain', limit: objectFormat.MAX_IMPORT_BYTES });
const objectsFileRaw = express.raw({ type: 'application/octet-stream', limit: objectFormat.MAX_IMPORT_BYTES });
app.post('/api/spaces/:id/objects/check', sameOriginOnly, objectsFileType, objectsFileText, objectsFileRaw, (req, res) => {
  const found = importSpaceOf(req, res);
  if (!found) return;
  const why = aiPolicy.importRefusal(found.who);
  if (why) return res.status(403).json({ error: why });
  const limited = overLimit('chat', found.who.user.key, 'check');
  if (limited) return res.status(429).set('Retry-After', String(limited.retrySeconds)).json({ error: limitMessage() });
  const text = Buffer.isBuffer(req.body) ? objectFormat.decodeBytes(req.body) : String(req.body ?? '');
  try {
    const out = objectFormat.readObjects(text);
    res.json({ version: objectFormat.FORMAT_VERSION, ...out });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});
app.post('/api/modules/:id/objects/check', sameOriginOnly, objectsFileType, objectsFileText, objectsFileRaw, (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx) return;
  const why = aiPolicy.importRefusal(ctx.who);
  if (why) return res.status(403).json({ error: why });
  const limited = overLimit(ctx.manifest.id, ctx.by, 'check');
  if (limited) return res.status(429).set('Retry-After', String(limited.retrySeconds)).json({ error: limitMessage() });
  const text = Buffer.isBuffer(req.body) ? objectFormat.decodeBytes(req.body) : String(req.body ?? '');
  try {
    const out = objectFormat.readObjects(text);
    res.json({ version: objectFormat.FORMAT_VERSION, ...out });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});
// A module's ask (templates ask, summarise and tags; purpose module): the rollup but no history (a module's ask is not a
// conversation), and nothing kept but the call's record: no question, no answer, no object's text. `objects`: up to 12
// pointers, only this space's (or, as the owner's setting allows, the environment's); `question` for ask, or none with an
// object (the template's default question); `tz`: the asker's time zone.
app.post('/api/modules/:id/ai', async (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx || !requireHook(ctx, res, 'ai')) return;
  const space = ctx.spaceId ? store.spaceById(ctx.spaceId) : null;
  const allowed = aiPolicy.check(ctx.who, space, 'module', { write: aiModuleWrite(ctx) });
  if (!allowed.ok) return refuseAi(res, allowed, { who: ctx.who, space, purpose: 'module' });
  // Plan-names step 7: the objects to ask about are `objects`, no longer `items`; the old name is refused, not read.
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'items')) return res.status(400).json({ error: `items is an old name; send the ${word('object', { many: true })} to ask about as objects` });
  const task = String(req.body?.task || '');
  if (!prompts.TASKS.includes(task)) return res.status(400).json({ error: 'That task is not offered; ask for ask, summarise or tags.' });
  const template = prompts.template(task);
  const asked = task === 'ask' ? aiQuestionOf(req.body?.question) : { question: '' };
  if (asked.error) return res.status(400).json({ error: asked.error });
  const refs = aiRefsOf(req.body?.objects);
  if (task === 'ask' && !asked.question && !refs.length) return res.status(400).json({ error: 'Ask a question.' });
  if (task !== 'ask' && !refs.length) return res.status(400).json({ error: `Choose something to work on.` });
  const built = aiContext.build(ctx.who, space, { template, question: asked.question, refs, tz: req.body?.tz, history: false, from: ctx.manifest.id });
  if (template.needsMaterial && !built.material.length) return res.status(400).json({ error: `None of those ${word('object', { many: true })} can be sent to the AI.`, leftOut: built.leftOut });
  const question = task !== 'ask' ? '' : asked.question || (built.material.length ? template.defaultQuestion(built.material[0].title) : '');
  if (task === 'ask' && !question) return res.status(400).json({ error: `Ask a question: the ${word('object')} you chose can't be sent to the AI.`, leftOut: built.leftOut });
  const turn = aiPolicy.takeTurn(ctx.who);
  if (!turn.ok) return refuseAi(res, turn, { who: ctx.who, space, purpose: 'module' });
  const inputs = task === 'tags'
    ? { material: built.material, words: aiWords() }
    : task === 'summarise'
      ? { material: built.material, context: built.context, kinds: promptKinds(), words: aiWords() }
      : { question: aiPolicy.redact(question, aiPolicy.secrets()), material: built.material, context: built.context, history: [], kinds: promptKinds(), words: aiWords() };
  try {
    const out = await ai.run(task, inputs, aiUse(ctx.who, ctx.spaceId, 'module', built), { secrets: aiPolicy.secrets() });
    countAiCall();
    noteActivity(ctx.manifest.id, `asked the AI (${AI_TASK_WORDS[task]}, ${out.tokens} tokens)`, ctx.by, ctx.scopeKey);
    res.json({ text: out.text, summaries: aiSummaries(out.summaries, built.numbered), tags: out.tags, used: aiPointers(out.used, built.numbered), numbered: built.numbered, cut: out.cut, tokens: out.tokens, prompt: out.prompt, sent: built.sent, leftOut: built.leftOut, ...(task === 'ask' ? { question } : {}) });
  } catch (err) {
    if (!(err instanceof AiError) || err.refund) aiPolicy.giveBack(ctx.who); // failed before the service did any work, or on this server's side
    else if (err.paid) countAiCall(); // a billed answer that failed after: the same as Chat's /ai counts it, once
    sendAiError(err, res);
  }
});

// --- files a module's people upload ---------------------------------------------------------------------------------------
// A picture held in memory, checked and cleaned in the scan worker (server/vault-scan.js) so the main thread never walks
// its bytes: { clean, pixels } or { error } (a sentence).
async function cleanPictureOffThread(bytes, allowed, keepPosition) {
  // Only the picture's own bytes go to the worker, never the rest of a shared buffer it sits in.
  const picture = bytes.byteOffset === 0 && bytes.buffer.byteLength === bytes.length ? bytes : new Uint8Array(bytes);
  const r = await vaultScanner.scan({ picture, allowed, keepPosition });
  if (r.ok) return { clean: { ...r.clean, bytes: Buffer.from(r.clean.bytes.buffer, r.clean.bytes.byteOffset, r.clean.bytes.byteLength) }, pixels: r.pixels };
  if (r.refuse.code === 'picture') return { error: r.refuse.message };
  console.error(`A picture could not be checked: ${r.refuse.reason}`);
  return { error: 'We could not check that picture safely. Try saving it again from the program that made it.' };
}
// A module that declares `uploads` keeps pictures per scope (server, room, person), with the same read and write permissions as
// its data. The server checks what arrives from the bytes themselves and takes out what rides along (see image-clean.js).
const rawUpload = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 10 * 1024 * 1024 + 1024 });
function uploadAccess(req, res, need) {
  const ctx = moduleAccess(req, res, need);
  if (!ctx) return null;
  if (!ctx.manifest.uploads) { res.status(404).json({ error: `this ${word('module')} keeps no uploaded files` }); return null; }
  return ctx;
}
const uploadView = (f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, by: f.by, at: f.at, taken: f.taken, camera: f.camera, hasPosition: f.hasPosition, position: f.position, hasThumb: !!f.thumb });
app.get('/api/modules/:id/uploads', (req, res) => {
  const ctx = uploadAccess(req, res, 'read');
  if (!ctx) return;
  res.json({ files: moduleUploads.list(ctx.manifest.id, ctx.scopeKey).map(uploadView) });
});
app.post('/api/modules/:id/uploads', rawUpload, checkStorageCap, async (req, res) => {
  const ctx = uploadAccess(req, res, 'own');
  if (!ctx) return;
  if (overLimit(ctx.manifest.id, ctx.by, 'upload')) return res.status(429).json({ error: limitMessage() });
  if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'send the picture itself, as a JPEG, PNG or WebP' });
  const keepPosition = req.query.keepPosition === '1';
  const cleaned = req.body.length ? await cleanPictureOffThread(req.body, ctx.manifest.uploads.types, keepPosition) : null;
  if (cleaned && cleaned.error) return res.status(400).json({ error: cleaned.error });
  const file = moduleUploads.put(ctx.manifest.id, ctx.scopeKey, ctx.manifest.uploads, { bytes: req.body, name: req.query.name, by: ctx.by, keepPosition, cleaned: cleaned && cleaned.clean });
  res.status(201).json({ file: uploadView(file) });
});
// What the start of a picture says about itself, for a page that will resize it (a resize loses the picture's own facts): send its
// first ~256 KB. The answer goes only to the person who sent it.
app.post('/api/modules/:id/uploads/inspect', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 300 * 1024 }), (req, res) => {
  const ctx = uploadAccess(req, res, 'own');
  if (!ctx) return;
  if (overLimit(ctx.manifest.id, ctx.by, 'upload')) return res.status(429).json({ error: limitMessage() });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: 'send the start of the picture' });
  res.json(inspectHead(req.body));
});
app.put('/api/modules/:id/uploads/:fid/thumb', rawUpload, checkStorageCap, async (req, res) => {
  const ctx = uploadAccess(req, res, 'own');
  if (!ctx) return;
  const meta = moduleUploads.meta(ctx.manifest.id, ctx.scopeKey, req.params.fid);
  if (!meta) return res.status(404).json({ error: 'no such file' });
  if (meta.by !== ctx.by && !hasOwnerRights(ctx.who.user)) return res.status(403).json({ error: 'only the person who added it can do that' });
  if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'send the thumbnail itself, as a JPEG, PNG or WebP' });
  const cleaned = req.body.length && req.body.length <= 400 * 1024 ? await cleanPictureOffThread(req.body, ctx.manifest.uploads.types, false) : null;
  if (cleaned && cleaned.error) return res.status(400).json({ error: cleaned.error });
  res.json({ file: uploadView(moduleUploads.putThumb(ctx.manifest.id, ctx.scopeKey, ctx.manifest.uploads, req.params.fid, req.body, cleaned && cleaned.clean)) });
});
function sendUpload(req, res, thumb) {
  const ctx = uploadAccess(req, res, 'read');
  if (!ctx) return;
  const f = moduleUploads.read(ctx.manifest.id, ctx.scopeKey, req.params.fid, thumb);
  if (!f) return res.status(404).json({ error: 'no such file' });
  // A picture and nothing else, whatever it claims to be, and never run as a page; kept private to the person and their browser.
  res.set({ 'Content-Type': f.type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'private, max-age=3600' }).send(f.bytes);
}
app.get('/api/modules/:id/uploads/:fid', (req, res) => sendUpload(req, res, false));
app.get('/api/modules/:id/uploads/:fid/thumb', (req, res) => sendUpload(req, res, true));
app.delete('/api/modules/:id/uploads/:fid', (req, res) => {
  const ctx = uploadAccess(req, res, 'own');
  if (!ctx) return;
  const meta = moduleUploads.meta(ctx.manifest.id, ctx.scopeKey, req.params.fid);
  if (!meta) return res.status(404).json({ error: 'no such file' });
  // The person who added a file, or an administrator, removes it. (A module decides who may remove its items; this is the guard on the bytes.)
  if (meta.by !== ctx.by && !hasOwnerRights(ctx.who.user)) return res.status(403).json({ error: 'only the person who added it can remove it' });
  // A file a Clear holds for its Undo comes back with it, so it stays until that time is over.
  if (moduleHolds.holdsFile(ctx.manifest.id, ctx.scopeKey, req.params.fid)) return res.status(409).json({ error: 'That file can\'t be removed while the clear that took it can still be undone.' });
  moduleUploads.remove(ctx.manifest.id, ctx.scopeKey, req.params.fid);
  res.json({ ok: true });
});

// --- a module's library: a space's files (documentation/plans/plan-attachments-vault.md, step 1) ---------------------------
// A module that declares `library` (the Vault) keeps a space's files: the bytes under VAULT_DIR, the records beside its data
// (server/vault-store.js), each file's type decided from its own bytes (server/vault-types.js). The routes belong to that
// module, so the core names none. Every route decides, before a byte of the body is read: the session (401), that the asker
// is a person (never a guest pass or the access key), the space and the module on there, membership or owner rights, and
// the permission. A route about one file answers every refusal but 401 with 404, so a file's existence is not given away.
// Uploads stream to a part file, counted as they arrive, and reserve their Content-Length against the space's, the
// person's, the environment's (a hosted plan's storage cap) and the server's totals first; serving streams with ranges.
const NO_SUCH_FILE = 'There is no such file.';
// A record whose bytes are gone from the disk (a backup restored without them, a lost disk): said as a state, with `missing: true`.
const FILE_MISSING = 'File missing. Its content is gone from the server; remove it from the list.';
const PDF_DOWNLOAD_ONLY = 'This PDF can\'t be opened here. Download it.';
// A write that failed on the server's side: the detail goes to the log, never to the person (it can name a path).
const LIBRARY_NOT_SAVED = 'The file could not be saved. Try again, or ask the admin if it keeps happening.';
const vaultGb = (value, fallback) => {
  const gb = Number(value);
  return Math.floor((Number.isFinite(gb) && gb > 0 ? gb : fallback) * 1024 ** 3);
};
const vaultLimits = {
  total: vaultGb(VAULT_MAX_GB, 20),
  space: vaultGb(VAULT_SPACE_MAX_GB, 5),
  person: vaultGb(VAULT_PERSON_MAX_GB, 2),
  perMinute: megabytes(VAULT_MB_PER_MINUTE, 500),
};
// At most two uploads at once for one person and eight for one environment; open file streams (a player's range
// requests, a download) at most twelve for one person and a hundred for one environment.
const LIBRARY_UPLOADS = { person: 2, environment: 8 };
const LIBRARY_STREAMS = { person: 12, environment: 100 };
// An upload must keep arriving: after its first minute, one that brought less than VAULT_MIN_KB_PER_SECOND (16) in the
// last minute (or less than what it still had to send) is cut off, so a stalled or trickled one does not keep its place
// or what it reserved. Looked at every five seconds (server/arrival.js); only a moment the server itself stopped
// reading is taken out of the minute.
const libraryMinRate = (() => { const kb = Number(VAULT_MIN_KB_PER_SECOND); return Math.ceil((Number.isFinite(kb) && kb > 0 ? kb : 16) * 1024); })();
// After VAULT_SLOW_CUTOFFS (3) cut-offs in VAULT_SLOW_MINUTES (10) -- an upload too slow, or a small picture that did
// not arrive in time -- the same person's new uploads are refused until the oldest of them is that long ago.
const positive = (value, fallback) => { const v = Number(value); return Number.isFinite(v) && v > 0 ? v : fallback; };
const librarySlow = slowSenders({ most: Math.floor(positive(VAULT_SLOW_CUTOFFS, 3)), windowMs: positive(VAULT_SLOW_MINUTES, 10) * 60000 });
setInterval(() => librarySlow.sweep(), 60000).unref();
const slowRefusal = (keys) => {
  const wait = librarySlow.wait(keys.person);
  if (!wait) return null;
  const minutes = Math.ceil(wait / 60);
  return { error: `Your last few uploads stalled, so you can add files again in ${minutes === 1 ? 'a minute' : `${minutes} minutes`}.`, retry: wait };
};
// What another person's uploads still arriving hold against yours, at each level (the space, the environment's storage,
// the server's): at most half of what that level has free, so someone whose upload trickles in can never keep everyone
// else out. Your own count in full. A file is checked against what is really on disk again once it is in.
const LIBRARY_HOLD_SHARE = 0.5;
// What one person's, and (with environments) one environment's, uploads still arriving may reserve at once: a person the
// largest file there is, an environment a quarter of the server's total (never less than that file, never more than the
// total). Uploads still arriving in another environment are not counted against this one's room.
const LIBRARY_RESERVE = { person: vaultTypes.MAX_BYTES, environment: Math.min(vaultLimits.total, Math.max(Math.floor(vaultLimits.total / 4), vaultTypes.MAX_BYTES)) };
const OTHERS_ARRIVING = 'Other files are still arriving; try again in a minute.';
const LIBRARY_THUMB_BYTES = 300 * 1024;
// A small picture is sent at most two at a time by one person and eight in one environment, and must arrive whole within
// ten seconds and the time the floor (VAULT_MIN_KB_PER_SECOND) gives its size, or it is cut off.
const LIBRARY_THUMBS = { person: 2, environment: 8 };
const thumbDeadlineMs = (bytes) => 10000 + Math.ceil((bytes / libraryMinRate) * 1000);
const libraryKindSentence = 'That kind of file can\'t be added here. It takes pictures (JPEG, PNG, WebP, GIF), audio (MP3, OGG, WAV, M4A), video (MP4, WebM, MOV), PDF and Markdown.';
const librarySentence = (refusal) => (refusal === 'heic' ? 'HEIC pictures can\'t be added here. Save it as a JPEG.' : libraryKindSentence);
// Why a PDF is not taken (server/pdf-scan.js), in one sentence.
const PDF_HOLDS = { scripts: 'scripts', opens: 'links that open programs or files', sends: 'a form that sends what is typed in it', files: 'files of its own' };
const pdfSentence = (r) => {
  if (r.refuse === 'damaged') return 'That PDF is damaged or cut short.';
  return `That PDF holds ${PDF_HOLDS[r.what] || 'active content'}, so it can't be added.`;
};
// The check of a file that is in (vault-scan-worker.js), its refusal in one sentence.
const vaultScanner = createScanner({ seconds: (() => { const v = Number(VAULT_SCAN_SECONDS); return Number.isFinite(v) && v > 0 ? v : 5; })() });
const scanSentence = (r, type) => {
  if (r.code === 'unsafe') return 'We could not check that file safely. Try saving it again from the program that made it.'; // a PDF is kept as download only instead
  if (r.code === 'picture-damaged') return 'That picture is damaged or cut short.';
  if (r.code === 'picture-large') return 'That picture is too large to show.';
  if (r.code === 'pdf-damaged') return pdfSentence({ refuse: 'damaged' });
  if (r.code === 'pdf-active') return pdfSentence({ what: r.what });
  if (r.code === 'damaged') return 'That file is damaged or cut short.';
  return libraryKindSentence;
};
const overTypeLimit = (type) => { const l = vaultTypes.LIMITS[vaultTypes.TYPES[type].limit]; return `That file is over the ${sizeText(l.bytes)} limit for ${l.words}.`; };

// Who is asking, in which space, with which module: { manifest, entry, name, who, space, spaceId, by, can(key), owner },
// or null after the refusal is sent. `need` is one of the module's library permissions; `file` makes every refusal but
// 401 a 404. Signed out is 401 whatever the module, and a space someone is not in answers as one that is not there, so
// neither which modules are installed nor which space ids exist is given away.
function libraryAccess(req, res, need, { file = false } = {}) {
  const refuse = (status, error) => void res.status(file && status !== 401 ? 404 : status).json({ error: file && status !== 401 ? NO_SUCH_FILE : error });
  const who = moduleViewer(req);
  if (!who) return refuse(401, 'Sign in first.');
  const found = modules.enabled(req.params.id);
  if (!found || !found.manifest.library) return refuse(404, `There is no such ${word('module')}.`);
  const { manifest, entry } = found;
  const name = modules.shownName(manifest);
  if (who.keyed) return refuse(403, `The access key can't open ${name}.`);
  if (!who.user) return refuse(403, `${word('guest', { many: true, cap: true })} can't use ${name}.`);
  const space = store.spaceById(String(req.query.space || ''));
  if (!space) return refuse(404, `There is no such ${word('space')}.`);
  if (refusedInLobby(manifest, space.id)) return refuse(404, lobbyRefusal(manifest));
  if (!moduleSpaceAccess(entry, who, space)) return refuse(404, `There is no such ${word('space')}.`);
  const perms = modulePerms(who, space.id);
  const can = (key) => Boolean(perms[`module.${manifest.id}.${key}`]);
  if (need && !can(need)) return refuse(403, `Your role can't do that in ${name}.`);
  return { manifest, entry, name, who, space, spaceId: space.id, by: who.user.key, can, owner: hasOwnerRights(who.user), moderator: moderates(who.user, space), sees: fileSight(who, space.id, manifest.id) };
}

// --- who may see a library file (documentation/plans/plan-vault-privacy.md) --------------------------------------------
// The one place the rule is written. A record's `visibility` is 'everyone' (also when it has none), 'only-me' or
// 'people' (with `people`, user keys); anything else is read as 'only-me', so a damaged record shows to fewer people,
// never more. `fileSight(who, spaceId, moduleId)` answers the test for one viewer in one space, worked out once for a
// whole list; `fileVisible` asks it for one record. A file shows to:
//   1. the person who added it;
//   2. an owner or the admin (hasOwnerRights);
//   and, for a current member of the space only:
//   3. everyone, when it is 'everyone';
//   4. someone whose role there has the module's `see_all` ("See every file");
//   5. someone listed in `people`, when it is 'people' (a listed key that is not a member now grants nothing).
// Nobody else: a signed-out visitor, the access key and a guest see no file. Every route, the object chokepoint and the
// live streams ask this; a file someone can't see answers as one that is not there (library routes) or as hidden (objects).
const visibilityOf = (r) => (r.visibility === undefined || r.visibility === 'everyone' ? 'everyone' : r.visibility === 'people' ? 'people' : 'only-me');
function fileSight(who, spaceId, moduleId) {
  const user = who && !who.keyed ? who.user : null;
  if (!user) return () => false;
  if (hasOwnerRights(user)) return (r) => Boolean(r);
  const space = store.spaceById(String(spaceId || ''));
  const member = Boolean(space && space.members.includes(user.key));
  const seesAll = member && Boolean(store.spacePermissions(user.key, space.id)[`module.${moduleId}.see_all`]);
  return (r) => {
    if (!r) return false;
    if (r.by === user.key) return true;
    if (!member) return false;
    const vis = visibilityOf(r);
    if (vis === 'everyone' || seesAll) return true;
    return vis === 'people' && Array.isArray(r.people) && r.people.includes(user.key);
  };
}
const fileVisible = (who, spaceId, moduleId, r) => fileSight(who, spaceId, moduleId)(r);
// A pointer to a library file, and whether this viewer may know of it: they see the file's record as it is now. A file
// that is gone answers `whenGone` (a link to it reads "File removed" for those who could see it; a live tell leaves it out).
const isLibraryFileRef = (ref) => Boolean(ref) && ref.kind === 'file' && ref.scope === 'space' && Boolean(modules.enabled(ref.module)?.manifest.library);
function refFileSeen(who, ref, whenGone) {
  const r = vault.get(ref.module, ref.space, ref.id);
  return r ? fileVisible(who, ref.space, ref.module, r) : whenGone;
}
// Who may change who sees a file: the person who added it, an owner or the admin. Nobody else, whatever their role.
const fileManageable = (who, r) => Boolean(who && who.user && r && (r.by === who.user.key || hasOwnerRights(who.user)));
// The visibility a request asks for, checked: { visibility, people } or { error } (one sentence, a 400). `people` comes as
// a list of user keys or one text of keys split by commas; each must be a member of the space now, at most PEOPLE_MAX.
function askedVisibility(rawVisibility, rawPeople, space) {
  // Only a missing field means "not asked"; null, empty or any other shape is refused, never read as a default (a private
  // file is not published by a request that is merely odd). Only an exact word counts: no padding, no capitals.
  const visibility = rawVisibility === undefined ? 'everyone' : rawVisibility;
  if (typeof visibility !== 'string' || !VISIBILITIES.includes(visibility)) return { error: 'Who can see a file is everyone, only-me or people.' };
  const given = rawPeople === undefined ? [] : rawPeople;
  const list = typeof given === 'string' ? given.split(',').map((k) => k.trim()).filter(Boolean) : given;
  if (!Array.isArray(list) || list.some((k) => typeof k !== 'string') || (typeof given === 'string' && !given.trim())) return { error: 'People are a list of people\'s keys.' };
  if (visibility !== 'people') return list.length ? { error: 'People are chosen only when a file is shown to chosen people.' } : { visibility, people: [] };
  const people = [...new Set(list)];
  if (!people.length) return { error: 'Choose the people who can see it.' };
  if (people.length > PEOPLE_MAX) return { error: `A file can be shown to at most ${PEOPLE_MAX} people.` };
  if (people.some((k) => !space.members.includes(k))) return { error: `Everyone chosen must be in this ${word('space')}.` };
  return { visibility, people };
}
// Whether a share link's maker may still make it: they exist, are in the space (or an owner or the admin), and have each
// permission in `keys` of the module there. The public routes ask this on every open.
function shareMakerCan(userKey, spaceId, moduleId, keys) {
  const user = store.userByKey(userKey);
  const space = store.spaceById(spaceId);
  if (!user || !space) return false;
  if (!(hasOwnerRights(user) || space.members.includes(user.key))) return false;
  const perms = store.spacePermissions(user.key, spaceId);
  return keys.every((k) => Boolean(perms[`module.${moduleId}.${k}`]));
}
const fileRef = (ctx, fid) => ({ module: ctx.manifest.id, kind: 'file', id: fid, scope: 'space', space: ctx.spaceId });
// `viewable: false` only on a PDF kept as download only (decision 18): the app never opens it, only downloads it.
// `visibility` and `people` only for someone who may change them (fileManageable): nobody else learns who else sees a file.
const fileView = (ctx, r, present = null) => ({ id: r.id, name: r.name, type: r.type, group: r.group, size: r.size, by: r.by, at: r.at, ...(r.taken ? { taken: r.taken } : {}), hasThumb: Boolean(r.thumb), uses: moduleLinks.to(fileRef(ctx, r.id)).length, ...(r.viewable === false ? { viewable: false } : {}), ...((present ? !present.has(`${r.id}.bin`) : vault.isMissing(ctx.spaceId, r.id)) ? { missing: true } : {}), ...(fileManageable(ctx.who, r) ? { visibility: visibilityOf(r), ...(visibilityOf(r) === 'people' ? { people: [...(r.people || [])] } : {}) } : {}) });
// The owner's lower quotas, when the module declares them as `number` settings for the environment: spaceMaxGb and
// personMaxGb, in GB; 0 or unset leaves the server's.
function libraryQuotas(manifest) {
  const values = moduleSettings.values(manifest, 'environment', {});
  const lower = (key, most) => {
    const def = (manifest.settings || []).find((d) => d.key === key && d.type === 'number' && d.scope === 'environment');
    const gb = def ? Number(values[key]) : 0;
    return Number.isFinite(gb) && gb > 0 ? Math.min(most, Math.floor(gb * 1024 ** 3)) : most;
  };
  return { space: lower('spaceMaxGb', vaultLimits.space), person: lower('personMaxGb', vaultLimits.person) };
}

// What uploads still arriving have reserved: one entry each, { space, person, environment, bytes } ("<slug>|..." keys).
const vaultArriving = new Map();
let vaultArrivingSeq = 0;
function reserveVault(keys, bytes) {
  vaultArrivingSeq += 1;
  const id = vaultArrivingSeq;
  vaultArriving.set(id, { ...keys, bytes });
  return () => vaultArriving.delete(id);
}
// What uploads still arriving whose `field` is `value` hold against `me`: my own in full, each other person's at most
// `share`.
function heldAgainst(field, value, me, share) {
  const byPerson = new Map();
  for (const r of vaultArriving.values()) if (r[field] === value) byPerson.set(r.person, (byPerson.get(r.person) || 0) + r.bytes);
  let held = 0;
  for (const [person, bytes] of byPerson) held += person === me ? bytes : Math.min(bytes, share);
  return held;
}
function vaultHostBytes() {
  if (vaultHost.bytes === null) vaultHost.bytes = folderBytes(VAULT_ROOT);
  return vaultHost.bytes;
}
// The levels a file must fit: { onDisk, most, sentence, field, value } for the space, the person, the environment's
// storage (a hosted plan's cap) and the server. Uploads still arriving in another environment are not counted against
// this one's.
function vaultLevels(ctx, keys) {
  const used = vault.usage();
  const quota = libraryQuotas(ctx.manifest);
  const cap = planCap('storageBytes');
  const env = currentEnvironment();
  return [
    { onDisk: used.spaces.get(ctx.spaceId) || 0, most: quota.space, field: 'space', value: keys.space, sentence: `This ${word('space')}'s ${ctx.name} is full (${sizeText(quota.space)}). Remove some files to add more.` },
    { onDisk: used.people.get(ctx.by) || 0, most: quota.person, field: 'person', value: keys.person, sentence: `You have used your ${sizeText(quota.person)} in ${ctx.name}. Remove some of your files to add more.` },
    ...(cap !== null && cap !== undefined ? [{ onDisk: environmentStorageBytes(env.slug, env.dataDir), most: cap, field: 'environment', value: keys.environment, sentence: `This ${word('environment')} has used its ${sizeText(cap)} of storage.` }] : []),
    { onDisk: vaultHostBytes(), most: vaultLimits.total, field: 'environment', value: keys.environment, sentence: 'The server\'s file storage is full. Ask the admin.' },
  ];
}
// Whether `bytes` more fit on disk at every level: null, or { status: 413, error } for the first that is full.
function vaultFullOnDisk(ctx, keys, bytes) {
  for (const l of vaultLevels(ctx, keys)) if (l.onDisk + bytes > l.most) return { status: 413, error: l.sentence };
  return null;
}
// Whether `bytes` more fit this space, this person, this environment and the server: null, or { status, error, retry? }.
// What is on disk first: full is 413 with the sentence for the first that is. Then what uploads still arriving in this
// environment hold (LIBRARY_HOLD_SHARE): that is 429, since it is free again once they are in or cut off. Then the most
// one person's or one environment's uploads may reserve at once.
function vaultFullRefusal(ctx, keys, bytes) {
  const full = vaultFullOnDisk(ctx, keys, bytes);
  if (full) return full;
  const arriving = { status: 429, error: OTHERS_ARRIVING, retry: 60 };
  for (const l of vaultLevels(ctx, keys)) {
    const share = Math.floor(Math.max(0, l.most - l.onDisk) * LIBRARY_HOLD_SHARE);
    if (l.onDisk + heldAgainst(l.field, l.value, keys.person, share) + bytes > l.most) return arriving;
  }
  if (heldAgainst('person', keys.person, keys.person, 0) + bytes > LIBRARY_RESERVE.person) return { status: 429, error: 'Another upload is still running. Wait for it to finish.', retry: 5 };
  if (BASE_DOMAIN && heldAgainst('environment', keys.environment, keys.person, Math.floor(LIBRARY_RESERVE.environment * LIBRARY_HOLD_SHARE)) + bytes > LIBRARY_RESERVE.environment) return arriving;
  return null;
}

// How much one person may send in a minute (VAULT_MB_PER_MINUTE): an upload counts its Content-Length when it starts,
// and one larger than the minute's allowance counts as all of it, so it can still go when nothing else was sent.
const vaultSent = new Map(); // "<slug>|<person>" -> [[at, bytes], ...] in the last minute
function vaultMinuteWait(key, bytes) {
  const now = Date.now();
  const recent = (vaultSent.get(key) || []).filter(([at]) => now - at < 60000);
  if (recent.length) vaultSent.set(key, recent); else vaultSent.delete(key);
  let total = recent.reduce((sum, [, b]) => sum + b, 0) + bytes;
  if (total <= vaultLimits.perMinute) return 0;
  for (const [at, b] of recent) {
    total -= b;
    if (total <= vaultLimits.perMinute) return Math.max(1, Math.ceil((at + 60000 - now) / 1000));
  }
  return 60;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, sent] of vaultSent) if (!sent.some(([at]) => now - at < 60000)) vaultSent.delete(key);
}, 60000).unref();

// Counts of what is running, across environments: uploads, open file streams and small pictures arriving, per person
// and per environment.
const libraryRunning = { uploads: new Map(), streams: new Map(), thumbs: new Map() };
function takeSlot(map, keys, most) {
  if ((map.get(keys.person) || 0) >= most.person) return 'person';
  if ((map.get(keys.environment) || 0) >= most.environment) return 'environment';
  for (const k of [keys.person, keys.environment]) map.set(k, (map.get(k) || 0) + 1);
  let freed = false;
  return () => {
    if (freed) return;
    freed = true;
    for (const k of [keys.person, keys.environment]) { const v = (map.get(k) || 0) - 1; if (v > 0) map.set(k, v); else map.delete(k); }
  };
}
const libraryKeys = (ctx) => {
  const slug = currentEnvironment().slug || '';
  return { space: `${slug}|${ctx.spaceId}`, person: `${slug}|${ctx.by}`, environment: slug };
};

// A library module's uploads in flight, per environment and module ("<slug>|<module id>" -> a Set of { stopped, stop() }),
// so uninstalling the module stops them (stopLibraryUploads): one still arriving is answered and its part removed, one
// being checked is refused before it is kept.
const libraryInFlight = new Map();
function trackLibraryUpload(moduleId) {
  const key = `${currentEnvironment().slug || ''}|${moduleId}`;
  const handle = { stopped: false, onStop: null, stop() { handle.stopped = true; if (handle.onStop) handle.onStop(); } };
  if (!libraryInFlight.has(key)) libraryInFlight.set(key, new Set());
  libraryInFlight.get(key).add(handle);
  handle.done = () => { const set = libraryInFlight.get(key); if (!set) return; set.delete(handle); if (!set.size) libraryInFlight.delete(key); };
  return handle;
}
function stopLibraryUploads(moduleId) {
  const set = libraryInFlight.get(`${currentEnvironment().slug || ''}|${moduleId}`);
  if (set) for (const handle of [...set]) handle.stop();
}

// Throws away what is still arriving after a refusal (so the sender reads the answer rather than a broken connection),
// and drops the connection if it goes on for more than 20 seconds.
function dropUploadBody(req) {
  req.resume();
  setTimeout(() => { if (!req.complete) req.destroy(); }, 20000).unref();
}

// Streams the body to `part` with a running count, never holding it: its first 4 KB are looked at as they arrive
// (`onHead(head)` answers a refusal to stop at, or null), the SHA-256 is taken on the way, and an upload slower than the
// floor (server/arrival.js) is cut off, and `onSlow()` told. Answers { size, sha256 } or { refused } / { over } / { aborted } / { failed }; the
// part is closed by then, so the caller removes it.
function receiveUpload(req, part, declared, onHead, onSlow = () => {}, handle = null) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(part, { mode: 0o600 });
    const hash = crypto.createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    let headDone = false;
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      watch.stop();
      req.removeListener('data', onData);
      if (r.size !== undefined) return resolve(r);
      // A write stream opens its file asynchronously: wait for its close, so the caller's removal is the last thing to
      // touch the part.
      if (out.closed) return resolve(r);
      out.once('close', () => resolve(r));
      out.destroy();
    };
    const watch = watchArrival(declared, () => { onSlow(); finish({ aborted: true }); req.destroy(); }, { minRate: libraryMinRate });
    if (handle) handle.onStop = () => finish({ stopped: true });
    const look = () => {
      headDone = true;
      const refused = onHead(head);
      if (refused) { finish({ refused }); return false; }
      return true;
    };
    function onData(chunk) {
      if (settled) return;
      watch.got(chunk.length);
      size += chunk.length;
      if (size > declared) return finish({ over: true });
      if (!headDone) {
        head = Buffer.concat([head, chunk.subarray(0, vaultTypes.HEAD_BYTES - head.length)]);
        if (head.length >= vaultTypes.HEAD_BYTES && !look()) return;
      }
      hash.update(chunk);
      if (!out.write(chunk)) { req.pause(); watch.waiting(true); out.once('drain', () => { watch.waiting(false); req.resume(); }); }
    }
    req.on('data', onData);
    req.on('end', () => {
      if (settled) return;
      if (!headDone && !look()) return;
      if (size !== declared) return finish({ aborted: true });
      watch.stop();
      settled = true;
      req.removeListener('data', onData);
      out.end(() => resolve({ size, sha256: hash.digest('hex') }));
    });
    req.on('error', () => finish({ aborted: true }));
    req.on('close', () => { if (!req.complete) finish({ aborted: true }); });
    out.on('error', (err) => finish({ failed: err.message }));
  });
}

// GET /api/modules/:id/library?space= -- the space's files this person may see, and what those use of the space's quota
// (the bytes of the files they see only: a file hidden from them moves no number they are shown; the quota itself is
// still kept on the space's real total).
app.get('/api/modules/:id/library', (req, res) => {
  const ctx = libraryAccess(req, res, 'view');
  if (!ctx) return;
  const present = vault.present(ctx.spaceId);
  // `shared` (in a share link that still opens) only for someone who may make share links.
  const shared = ctx.can('share') ? vault.sharedFileIds(ctx.manifest.id, ctx.spaceId) : null;
  const seen = vault.list(ctx.manifest.id, ctx.spaceId).filter(ctx.sees);
  const files = seen.map((r) => (shared ? { ...fileView(ctx, r, present), shared: shared.has(r.id) } : fileView(ctx, r, present)));
  res.json({ files, usage: { bytes: seen.reduce((sum, r) => sum + vault.bytesOf(r), 0), maxBytes: libraryQuotas(ctx.manifest).space } });
});

// POST /api/modules/:id/library?space=&name=[&keepPosition=1][&visibility=everyone|only-me|people&people=<key>,<key>] --
// add one file, the raw body with its Content-Length. A picture loses where it was taken unless keepPosition=1 (the
// person's choice, "Remove where it was taken", on by default). Who may see it is everyone unless `visibility` says
// otherwise (askedVisibility; `people` members of the space, at most 200).
app.post('/api/modules/:id/library', async (req, res) => {
  const refuse = (status, error, headers = {}) => { if (!res.headersSent) res.set(headers).status(status).json({ error }); dropUploadBody(req); };
  const ctx = libraryAccess(req, res, 'add');
  if (!ctx) return dropUploadBody(req);
  const name = cleanName(req.query.name);
  if (!name) return refuse(400, 'Name the file in ?name=.');
  const sight = askedVisibility(req.query.visibility, req.query.people, ctx.space);
  if (sight.error) return refuse(400, sight.error);
  if (req.headers['transfer-encoding'] || !/^\d{1,15}$/.test(String(req.headers['content-length'] || ''))) return refuse(411, 'Send the file with its size (Content-Length).');
  const declared = Number(req.headers['content-length']);
  if (!declared) return refuse(400, 'There is no file in that.');
  const sentType = req.headers['content-type'];
  const claimRefused = vaultTypes.claimRefusal(name, sentType);
  if (claimRefused) return refuse(400, librarySentence(claimRefused));
  const claimed = vaultTypes.claimedType(name, sentType);
  if (claimed && declared > vaultTypes.LIMITS[vaultTypes.TYPES[claimed].limit].bytes) return refuse(413, overTypeLimit(claimed));
  if (declared > vaultTypes.MAX_BYTES) return refuse(413, `That file is over the ${sizeText(vaultTypes.MAX_BYTES)} limit for video.`);
  const limited = overLibraryLimit(ctx, 'library');
  if (limited) return refuse(429, limitMessage(), { 'Retry-After': String(limited.retrySeconds) });
  const keys = libraryKeys(ctx);
  const slow = slowRefusal(keys);
  if (slow) return refuse(429, slow.error, { 'Retry-After': String(slow.retry) });
  const wait = vaultMinuteWait(keys.person, Math.min(declared, vaultLimits.perMinute));
  if (wait) return refuse(429, `You have sent a lot in the last minute. Wait ${wait} seconds and try again.`, { 'Retry-After': String(wait) });
  const full = vaultFullRefusal(ctx, keys, declared);
  if (full) return refuse(full.status, full.error, full.retry ? { 'Retry-After': String(full.retry) } : {});
  const slot = takeSlot(libraryRunning.uploads, keys, LIBRARY_UPLOADS);
  if (slot === 'person') return refuse(429, 'Another upload is still running. Wait for it to finish.', { 'Retry-After': '5' });
  if (slot === 'environment') return refuse(429, 'Other uploads are still running here. Try again in a moment.', { 'Retry-After': '5' });
  const release = reserveVault(keys, declared);
  const flight = trackLibraryUpload(ctx.manifest.id);
  const removedWhileArriving = `${ctx.name} was removed while the file was arriving, so it wasn't added.`;
  vaultSent.set(keys.person, [...(vaultSent.get(keys.person) || []), [Date.now(), Math.min(declared, vaultLimits.perMinute)]]);
  let part = null;
  const dropPart = () => { if (part) fs.rmSync(part, { force: true }); };
  try {
    try {
      part = vault.newPart(ctx.spaceId);
    } catch (err) {
      console.error(`A library upload could not start: ${err.message}`);
      return refuse(500, LIBRARY_NOT_SAVED);
    }
    let type = null;
    const got = await receiveUpload(req, part, declared, (head) => {
      const found = vaultTypes.sniff(head, name);
      if (found.refuse) return { status: 400, error: librarySentence(found.refuse) };
      if (vaultTypes.mismatch(found.type, name, sentType)) return { status: 400, error: 'That file\'s name or type doesn\'t match what is in it.' };
      if (declared > vaultTypes.LIMITS[vaultTypes.TYPES[found.type].limit].bytes) return { status: 413, error: overTypeLimit(found.type) };
      type = found.type;
      return null;
    }, () => librarySlow.note(keys.person), flight);
    if (got.stopped || flight.stopped) { dropPart(); return refuse(404, removedWhileArriving); }
    if (got.refused) { dropPart(); return refuse(got.refused.status, got.refused.error); }
    if (got.over) { dropPart(); return refuse(413, 'That file is longer than its Content-Length.'); }
    if (got.aborted) { dropPart(); return; } // the sender went: nobody to answer
    if (got.failed) { dropPart(); console.error(`A library upload could not be written: ${got.failed}`); return refuse(500, LIBRARY_NOT_SAVED); }
    const group = vaultTypes.TYPES[type].group;
    let kept = { size: got.size, sha256: got.sha256, taken: null, camera: '' };
    let viewable = true;
    // The whole file's check, in a worker (server/vault-scan.js): the main thread only waits for it.
    if (group === 'image' || type === 'application/pdf' || vaultTypes.STRUCTURED.includes(type)) {
      const checked = await vaultScanner.scan({ file: part, type, keepPosition: req.query.keepPosition === '1' });
      // A PDF the scan could not judge (pdf-unchecked: encrypted, a part it can't read within its bounds) or could not
      // finish (unsafe: over its time or memory) is kept as download only (decision 18): never sent inline, never shown.
      // What it positively finds, and a damaged PDF, are still refused.
      if (checked.refuse && type === 'application/pdf' && (checked.refuse.code === 'pdf-unchecked' || checked.refuse.code === 'unsafe')) {
        if (checked.refuse.code === 'unsafe') console.error(`A library PDF could not be checked, so it is kept for download only: ${checked.refuse.reason}`);
        viewable = false;
      } else if (checked.refuse) {
        dropPart();
        fs.rmSync(`${part}.clean`, { force: true });
        if (checked.refuse.code === 'unsafe') console.error(`A library file could not be checked: ${checked.refuse.reason}`);
        return refuse(400, scanSentence(checked.refuse, type));
      }
      if (group === 'image') {
        try {
          await fs.promises.rename(`${part}.clean`, part);
        } catch (err) {
          dropPart();
          console.error(`A library picture could not be kept: ${err.message}`);
          return refuse(500, LIBRARY_NOT_SAVED);
        }
        kept = { size: checked.size, sha256: checked.sha256, taken: checked.taken || null, camera: checked.camera || '' };
      }
    }
    // What others' uploads still arriving hold counts for only part of a level (LIBRARY_HOLD_SHARE), and uploads still
    // arriving in other environments not at all, so every level's real use is checked again now that the file is in
    // (Thomas, 2026-10-30: that overshoot is accepted).
    const fullNow = vaultFullOnDisk(ctx, keys, kept.size);
    if (fullNow) { dropPart(); return refuse(413, fullNow.error); }
    const record = { id: vault.newId(), name: nameForType(name, vaultTypes.TYPES[type].exts), type, group, size: kept.size, sha256: kept.sha256, by: ctx.by, at: new Date().toISOString(), ...(kept.taken ? { taken: kept.taken } : {}), ...(kept.camera ? { camera: kept.camera } : {}), ...(viewable ? {} : { viewable: false }), thumb: null, ...(sight.visibility !== 'everyone' ? { visibility: sight.visibility } : {}), ...(sight.visibility === 'people' ? { people: sight.people } : {}) };
    if (flight.stopped) { dropPart(); return refuse(404, removedWhileArriving); }
    try {
      vault.commit(ctx.manifest.id, ctx.spaceId, part, record);
    } catch (err) {
      dropPart();
      console.error(`A library file could not be kept: ${err.message}`);
      return refuse(500, LIBRARY_NOT_SAVED);
    }
    part = null;
    // A file not everyone may see writes no activity line: the line alone would tell the others something was added.
    if (sight.visibility === 'everyone') noteActivity(ctx.manifest.id, `added a file to ${ctx.name}`, ctx.by, `space:${ctx.spaceId}`);
    res.status(201).json({ file: fileView(ctx, record) });
  } finally {
    flight.done();
    release();
    slot();
  }
});

// Content-Disposition for a file's name: a cleaned ASCII filename and the UTF-8 one (RFC 6266).
function contentDisposition(kind, name) {
  const ascii = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_') || 'file';
  const utf8 = encodeURIComponent(String(name)).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
// The headers every library file is sent with: its stored type only (Markdown as plain text, never HTML), never sniffed,
// never kept by a shared cache, never run as a page: `sandbox; default-src 'none'` on every type, a PDF too, since the
// browser's own PDF viewer is not used (decision 18). A PDF is always sent as an attachment, also to the app's own
// viewer (GET /viewer/pdf), which is handed its bytes by the page that fetched them: nothing opens one in the browser at
// this site's origin.
function libraryHeaders(type, name, kind) {
  return {
    'Content-Type': type === 'text/markdown' ? 'text/plain; charset=utf-8' : type,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': contentDisposition(type === 'application/pdf' ? 'attachment' : kind, name),
    'Cache-Control': 'private, no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  };
}
// Streams a file (or its thumbnail) with range requests (206, Content-Range, Accept-Ranges, 416, ETag, Last-Modified,
// If-Range), from disk through the response with its backpressure: a slow reader is sent only as fast as it reads.
function sendLibraryFile(req, res, thumb) {
  const download = !thumb && req.query.download === '1';
  const found = libraryFile(req, res);
  if (!found) return;
  const { ctx, r } = found;
  if ((thumb && !r.thumb) || (download && !ctx.can('download'))) return res.status(404).json({ error: NO_SUCH_FILE });
  // A PDF kept as download only (decision 18) is sent only as a download (download=1, with `download`); asked for inline
  // it answers 404, with the note the viewer shows, to someone who may see the file at all.
  if (!thumb && !download && r.viewable === false) return res.status(404).json({ error: PDF_DOWNLOAD_ONLY });
  if (vault.isMissing(ctx.spaceId, r.id)) return res.status(404).json({ error: FILE_MISSING, missing: true });
  const file = vault.filePath(ctx.spaceId, r.id, thumb);
  let slot = null;
  if (!thumb) {
    slot = takeSlot(libraryRunning.streams, libraryKeys(ctx), LIBRARY_STREAMS);
    if (typeof slot === 'string') return res.status(429).set('Retry-After', '2').json({ error: 'Too many files are open at once. Close some and try again.' });
    res.once('close', slot);
  }
  const headers = thumb ? libraryHeaders(r.thumb.type, r.name, 'inline') : libraryHeaders(r.type, r.name, download ? 'attachment' : 'inline');
  res.sendFile(file, { acceptRanges: true, etag: true, lastModified: true, cacheControl: false, dotfiles: 'allow', headers }, (err) => {
    if (!err || res.headersSent) return; // sent, or the connection broke part way
    res.removeHeader('Content-Disposition');
    res.type('application/json');
    if (err.status === 416) {
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* gone */ }
      res.removeHeader('Content-Range');
      return res.status(416).set('Content-Range', `bytes */${size}`).json({ error: 'That part of the file is out of range.' });
    }
    if (err.status === 404 || err.code === 'ENOENT') return res.status(404).json({ error: NO_SUCH_FILE });
    return res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({ error: 'The file could not be read.' });
  });
}
// GET /api/modules/:id/library/:fid/content?space=[&download=1] -- the bytes, inline, or as a download for someone with
// `download`. GET .../thumb -- the small picture.
app.get('/api/modules/:id/library/:fid/content', (req, res) => sendLibraryFile(req, res, false));
app.get('/api/modules/:id/library/:fid/thumb', (req, res) => sendLibraryFile(req, res, true));

// PUT /api/modules/:id/library/:fid/thumb?space= -- the small picture the page made for a picture or a video it added:
// a JPEG, PNG or WebP of at most 300 KB, from the person who added the file. Checked and cleaned like a picture.
app.put('/api/modules/:id/library/:fid/thumb', async (req, res) => {
  const refuse = (status, error, headers = {}) => { if (!res.headersSent) res.set(headers).status(status).json({ error }); dropUploadBody(req); };
  const found = libraryFile(req, res, 'add');
  if (!found) return dropUploadBody(req);
  const { ctx, r } = found;
  if (r.by !== ctx.by) return refuse(403, 'Only the person who added it can give it a small picture.');
  if (r.group !== 'image' && r.group !== 'video') return refuse(400, 'Only pictures and videos have a small picture.');
  if (req.headers['transfer-encoding'] || !/^\d{1,15}$/.test(String(req.headers['content-length'] || ''))) return refuse(411, 'Send the picture with its size (Content-Length).');
  const declared = Number(req.headers['content-length']);
  if (!declared) return refuse(400, 'There is no picture in that.');
  if (declared > LIBRARY_THUMB_BYTES) return refuse(413, 'That small picture is over 300 KB.');
  const limited = overLibraryLimit(ctx, 'libraryThumb');
  if (limited) return refuse(429, limitMessage(), { 'Retry-After': String(limited.retrySeconds) });
  const keys = libraryKeys(ctx);
  const slow = slowRefusal(keys);
  if (slow) return refuse(429, slow.error, { 'Retry-After': String(slow.retry) });
  const full = vaultFullRefusal(ctx, keys, declared);
  if (full) return refuse(full.status, full.error, full.retry ? { 'Retry-After': String(full.retry) } : {});
  const slot = takeSlot(libraryRunning.thumbs, keys, LIBRARY_THUMBS);
  if (typeof slot === 'string') return refuse(429, 'Another small picture is still being sent. Wait for it to finish.', { 'Retry-After': '5' });
  let bytes;
  try {
    // Read as it arrives, never past its Content-Length, and cut off when it is too slow.
    bytes = await new Promise((resolve) => {
      const chunks = [];
      let size = 0;
      let done = false;
      const end = (value) => { if (done) return; done = true; clearTimeout(deadline); req.removeListener('data', onData); resolve(value); };
      const deadline = setTimeout(() => { librarySlow.note(keys.person); end(null); req.destroy(); }, thumbDeadlineMs(declared));
      function onData(c) {
        size += c.length;
        if (size > declared) return end('over');
        chunks.push(c);
      }
      req.on('data', onData);
      req.on('end', () => end(size === declared ? Buffer.concat(chunks) : null));
      req.on('error', () => end(null));
      req.on('close', () => { if (!req.complete) end(null); });
    });
  } finally {
    slot();
  }
  if (bytes === 'over') return refuse(413, 'That small picture is longer than its Content-Length.');
  if (!bytes) return;
  const cleaned = await cleanPictureOffThread(bytes, ['image/jpeg', 'image/png', 'image/webp'], false);
  if (cleaned.error || cleaned.pixels === null || cleaned.pixels > 4 * 1000 * 1000) return res.status(400).json({ error: 'A small picture must be a whole JPEG, PNG or WebP.' });
  const { clean } = cleaned;
  res.json({ file: fileView(ctx, vault.putThumb(ctx.manifest.id, ctx.spaceId, r.id, clean.bytes, clean.type)) });
});

// The one door of every route that names a file (`:fid`): the file, for someone who may use the library with `need` and may
// see that file (fileVisible), and whether they may rename or remove it (its adder, or someone with remove_any) and change
// who sees it (fileManageable); null after the refusal. A file that is not there and a file hidden from this person get the
// same answer, byte for byte (404, NO_SUCH_FILE). No route reads a record any other way (tools/check-vault-visibility.mjs).
function libraryFile(req, res, need = 'view') {
  const ctx = libraryAccess(req, res, need, { file: true });
  if (!ctx) return null;
  const r = vault.get(ctx.manifest.id, ctx.spaceId, req.params.fid);
  if (!r || !ctx.sees(r)) return void res.status(404).json({ error: NO_SUCH_FILE });
  return { ctx, r, mayChange: r.by === ctx.by || ctx.can('remove_any'), manageable: fileManageable(ctx.who, r) };
}
// PATCH /api/modules/:id/library/:fid?space= { name?, visibility?, people? } -- rename it (the adder, or remove_any; the
// name keeps the type's extension), and change who may see it (the adder, an owner or the admin: askedVisibility). Its
// JSON body is read only once the file is found; nothing changes unless all of it may.
app.patch('/api/modules/:id/library/:fid', (req, res, next) => {
  const found = libraryFile(req, res);
  if (!found) return dropUploadBody(req);
  if (!found.mayChange && !found.manageable) { res.status(403).json({ error: `Only the person who added it, or someone who may remove other people's files, can change it.` }); return dropUploadBody(req); }
  req.libraryFile = found;
  next();
}, express.json({ limit: '16kb' }), (req, res) => {
  const { ctx, r, mayChange, manageable } = req.libraryFile;
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const renaming = b.name !== undefined;
  const showing = b.visibility !== undefined || b.people !== undefined;
  if (!renaming && !showing) return res.status(400).json({ error: 'Give the file a name.' });
  const name = renaming ? cleanName(b.name) : '';
  if (renaming && !name) return res.status(400).json({ error: 'Give the file a name.' });
  if (renaming && !mayChange) return res.status(403).json({ error: `Only the person who added it, or someone who may remove other people's files, can rename it.` });
  if (showing && !manageable) return res.status(403).json({ error: `Only the person who added it, ${word('owner', { a: true })} or the admin can change who can see it.` });
  const sight = showing ? askedVisibility(b.visibility === undefined ? visibilityOf(r) : b.visibility, b.people, ctx.space) : null;
  if (sight && sight.error) return res.status(400).json({ error: sight.error });
  if (renaming) vault.rename(ctx.manifest.id, ctx.spaceId, r.id, nameForType(name, vaultTypes.TYPES[r.type].exts));
  if (sight) vault.setVisibility(ctx.manifest.id, ctx.spaceId, r.id, sight);
  res.json({ file: fileView(ctx, vault.get(ctx.manifest.id, ctx.spaceId, r.id)) });
});
// DELETE /api/modules/:id/library/:fid?space= -- remove it: its record, bytes and small picture (the adder, or remove_any).
// Links to it stay on the objects that hold them, and read "File removed".
app.delete('/api/modules/:id/library/:fid', (req, res) => {
  const found = libraryFile(req, res);
  if (!found) return;
  const { ctx, r, mayChange } = found;
  if (!mayChange) return res.status(403).json({ error: 'Only the person who added it, or someone who may remove other people\'s files, can remove it.' });
  const holders = moduleLinks.to(fileRef(ctx, r.id));
  const was = { ...r };
  vault.remove(ctx.manifest.id, ctx.spaceId, r.id);
  // The objects that link to it are told, so their chips read "File removed" at once; their links stay. `file` (never
  // sent) lets each stream tell only the viewers who could see the file.
  if (holders.length) moduleLinks.emit('change', { refs: [fileRef(ctx, r.id), ...holders.map((h) => ({ ...h }))], file: { module: ctx.manifest.id, spaceId: ctx.spaceId, record: was } });
  if (visibilityOf(was) === 'everyone') noteActivity(ctx.manifest.id, `removed a file from ${ctx.name}`, ctx.by, `space:${ctx.spaceId}`);
  res.json({ ok: true });
});
// GET /api/modules/:id/library/:fid/uses?space= -- where it is linked: the summaries of the objects this person may see,
// and how many others there are.
app.get('/api/modules/:id/library/:fid/uses', (req, res) => {
  const found = libraryFile(req, res);
  if (!found) return;
  const { ctx, r } = found;
  const uses = [];
  let hidden = 0;
  for (const from of moduleLinks.to(fileRef(ctx, r.id))) {
    try {
      uses.push(resolveRef(ctx.who, from, null, { skipConsumer: true }));
    } catch (err) {
      if (!err.status) throw err;
      hidden += 1;
    }
  }
  res.json({ uses, hidden, ...(vault.isMissing(ctx.spaceId, r.id) ? { missing: true } : {}) });
});

// --- place search, from the server -----------------------------------------------------------------------------------------
// A module that declares `geocoder` in its manifest has its searches for places answered here: from the saved places first, then
// (when there are too few) from the service its settings name, keeping what comes back if the admin allows it. See geocode.js.
function geocodeAccess(req, res, need) {
  const ctx = moduleAccess(req, res, need);
  if (!ctx) return null;
  if (!ctx.manifest.geocoder) { res.status(404).json({ error: `this ${word('module')} has no place search` }); return null; }
  return ctx;
}
// Where this module's search goes now: { name, address, credit } or null when none is chosen.
function geocodeSetup(manifest) {
  const g = manifest.geocoder;
  const values = moduleSettings.values(manifest, 'environment', {});
  const chosen = values[g.provider];
  const known = g.providers[chosen];
  if (known) return { name: known.name, address: known.address, credit: known.credit, save: g.save ? values[g.save] === true : false };
  if (chosen === g.custom && typeof values[g.address] === 'string' && /^https?:\/\//i.test(values[g.address])) return { name: 'the search service', address: values[g.address], credit: '', save: g.save ? values[g.save] === true : false };
  return null;
}
// A link someone is adding: the server reads that page's title, description and image. Fetched only while the
// module's linkPreviews setting resolves true (the manifest default applies when nothing is saved), because the request leaves this server for an address the person typed.
// The picture from a link preview, fetched here and sent to the card. A browser asking the other site for it is often refused.
// Only for a signed-in person, and only a picture this place already knows: one a link here holds in the field the
// module's guards declare for its picture (a rule's `linkImage`), or one a link preview here offered in the last while
// (the editor shows it before the link is saved). A module that declares no such field has only the offered ones. This
// narrows what is fetched; it doesn't make an address safe, since anyone who may write a link may name any picture: the
// fetch's own guards (server/link-preview.js: public addresses, the web's ports, the deadline) are what hold.
const OFFERED_IMAGE_MS = 30 * 60 * 1000;
const OFFERED_IMAGE_MAX = 500;
const offeredImages = new Map(); // `${environment slug} ${module} ${scopeKey} ${url}` -> when offered
function offerImage(ctx, url) {
  if (!url) return;
  const key = `${currentEnvironment().slug || ''} ${ctx.manifest.id} ${ctx.scopeKey} ${url}`;
  offeredImages.delete(key);
  if (offeredImages.size >= OFFERED_IMAGE_MAX) offeredImages.delete(offeredImages.keys().next().value);
  offeredImages.set(key, Date.now());
}
function imageKnownHere(ctx, url) {
  const at = offeredImages.get(`${currentEnvironment().slug || ''} ${ctx.manifest.id} ${ctx.scopeKey} ${url}`);
  if (at && Date.now() - at < OFFERED_IMAGE_MS) return true;
  const guards = ctx.manifest.guards;
  if (!guards?.keys?.some((r) => r.linkImage)) return false;
  return moduleData.list(ctx.manifest.id, ctx.scopeKey).some((item) => moduleGuards.linkImageOf(guards, item.key, item.value) === url);
}
app.get('/api/modules/:id/link-image', async (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  if (!(ctx.manifest.settings || []).some((s) => s.key === 'linkPreviews')) return res.status(404).end();
  const values = moduleSettings.values(ctx.manifest, 'environment', {});
  if (values.linkPreviews !== true) return res.status(404).end();
  if (!ctx.who.user) return res.status(403).json({ error: `${word('guest', { many: true, cap: true })} can't load link pictures.` });
  const asked = String(req.query.url || '');
  if (!asked || !imageKnownHere(ctx, asked)) return res.status(404).json({ error: 'That picture isn\'t on a link here.' });
  try {
    let image = cachedImage(asked);
    if (!image) {
      if (overLimit(ctx.manifest.id, ctx.by, 'search')) return res.status(429).end();
      image = await fetchImage(asked);
    }
    res.set('Content-Type', image.type);
    res.set('Cache-Control', 'private, max-age=600');
    res.send(image.body);
  } catch {
    res.status(404).end();
  }
});
app.post('/api/modules/:id/link-preview', async (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx) return;
  if (!(ctx.manifest.settings || []).some((s) => s.key === 'linkPreviews')) return res.status(404).json({ error: `this ${word('module')} does not read link previews` });
  const values = moduleSettings.values(ctx.manifest, 'environment', {});
  if (values.linkPreviews !== true) return res.json({ enabled: false });
  if (overLimit(ctx.manifest.id, ctx.by, 'search')) return res.status(429).json({ error: limitMessage() });
  try {
    const preview = await fetchPreview(String(req.body?.url || ''));
    offerImage(ctx, preview.image);
    res.json({ enabled: true, ...preview });
  } catch (err) {
    const message = err instanceof PreviewError ? err.message : 'that page could not be read';
    res.status(400).json({ error: message });
  }
});
app.get('/api/modules/:id/geocode', async (req, res) => {
  const ctx = geocodeAccess(req, res, 'read');
  if (!ctx) return;
  // A picture map is an invented world: the outside service knows only the real one, so it is not asked and the saved
  // places of the real world are neither read nor added to.
  if (pictureMapOf()) return res.json({ results: [], configured: false, pictureMap: true, message: PICTURE_MAP_SEARCH_OFF });
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q.length < 2) return res.json({ results: [], configured: true });
  const setup = geocodeSetup(ctx.manifest);
  if (!setup) return res.json({ results: [], configured: false });
  if (overLimit(ctx.manifest.id, ctx.who.user?.key, 'search')) return res.status(429).json({ error: limitMessage() });
  const near = req.query.lat !== undefined ? { lat: Number(req.query.lat), lon: Number(req.query.lon) } : null;
  const id = ctx.manifest.id;
  // `osm`: the result's OpenStreetMap tag ("amenity:cafe"), so the module that saves it can pick a type (plan-places-library.md, step 4).
  const pick = (r, source, from) => ({ key: r.key, title: r.name, sub: r.address, lat: r.lat, lng: r.lng, ...(r.category ? { osm: r.category } : {}), source, from });
  // Saved places first: enough of them and the outside service is not asked.
  const saved = setup.save ? geocodeCache.search(id, q, near, 10).map((r) => pick(r, 'server', 'Saved on this server')) : [];
  if (saved.length >= ENOUGH) return res.json({ results: saved.slice(0, 8), configured: true, credit: setup.credit });
  try {
    const found = await askService(setup.address, q, near);
    const kept = setup.save ? geocodeCache.remember(id, found) : found.map((p) => ({ ...p, key: keyOfPlace(p) }));
    const fromService = kept.map((r) => pick(r, 'service', `From ${setup.name}`));
    const seen = new Set(saved.map((r) => r.key));
    res.json({ results: [...saved, ...fromService.filter((r) => !seen.has(r.key))].slice(0, 8), configured: true, credit: setup.credit });
  } catch (err) {
    if (saved.length) return res.json({ results: saved, configured: true, credit: setup.credit });
    res.status(502).json({ error: 'search is not available right now' });
  }
});
// Someone picked a result (or saved it as a place): mark it used, which protects it from being purged. Read is enough, as for
// the search: it reveals nothing a search does not and changes only that mark, and the place may have been saved into a space
// the person may write to while they only read the module here (the Map page, at environment level).
app.post('/api/modules/:id/geocode/use', (req, res) => {
  const ctx = geocodeAccess(req, res, 'read');
  if (!ctx) return;
  res.json({ ok: geocodeCache.markUsed(ctx.manifest.id, String(req.body?.key || '')) });
});
// For the admin: how many places are saved, and removing them by their mark.
app.get('/api/modules/:id/geocode/stats', requireOwner, (req, res) => {
  const found = modules.enabled(req.params.id);
  if (!found || !found.manifest.geocoder) return res.status(404).json({ error: 'no such place search' });
  res.json(geocodeCache.stats(found.manifest.id));
});
app.post('/api/modules/:id/geocode/purge', requireOwner, (req, res) => {
  const found = modules.enabled(req.params.id);
  if (!found || !found.manifest.geocoder) return res.status(404).json({ error: 'no such place search' });
  const what = req.body?.what === 'all' ? 'all' : req.body?.what === 'unused' ? 'unused' : null;
  if (!what) return res.status(400).json({ error: 'say what to remove: unused or all' });
  const days = Number(req.body?.olderThanDays);
  res.json({ removed: geocodeCache.purge(found.manifest.id, what, Number.isFinite(days) && days > 0 ? days : 0), ...geocodeCache.stats(found.manifest.id) });
});
// --- flight lookup, from the server -----------------------------------------------------------------------------------------
// A module that declares `"lookups": ["flight"]` in its manifest (the Planner) may look a flight number up in the schedule this
// server has learned from saved flights, look an airport up by its code, and teach the schedule a saved flight. One schedule for
// the whole server (flightSchedule, above; documentation/plans/plan-flight-lookup.md). The module's `write` access: in the
// Planner, `edit` -- members and moderators by default, never a guest. An environment with a `suggestFlights` setting off
// ("Suggest flights from earlier trips") neither suggests nor contributes; the airport list still answers.
function flightLookupAccess(req, res) {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx) return null;
  if (!ctx.manifest.lookups || !ctx.manifest.lookups.includes('flight')) { res.status(404).json({ error: `This ${word('module')} has no flight lookup.` }); return null; }
  return ctx;
}
// Whether this environment suggests flights and adds to the schedule. The choice is the environment's, not one module's: off
// when any module installed here (on or off) that declares the flight lookup has its `suggestFlights` setting off, so turning
// the Planner's setting off also stops every other module's lookups. On when none has it off, including when none declares it.
function flightSuggestionsOn() {
  for (const { id, version } of modules.list()) {
    const manifest = modules.manifestOf(id, version);
    if (!manifest || !(manifest.lookups || []).includes('flight')) continue;
    if (!(manifest.settings || []).some((d) => d.key === 'suggestFlights')) continue;
    if (moduleSettings.values(manifest, 'environment', {}).suggestFlights !== true) return false;
  }
  return true;
}
app.get('/api/modules/:id/flight-lookup', async (req, res) => {
  const ctx = flightLookupAccess(req, res);
  if (!ctx) return;
  const on = flightSuggestionsOn();
  // An airport by its code: the airport list only, so it answers with the setting off too.
  if (req.query.code !== undefined) {
    if (overLimit(ctx.manifest.id, ctx.by, 'search')) return res.status(429).json({ error: limitMessage() });
    const a = typeof req.query.code === 'string' ? airportList.airport(req.query.code.trim()) : null;
    if (!a) return res.status(404).json({ error: 'There is no airport with that code.' });
    return res.json({ airport: { code: a.code, name: airportList.displayName(a), city: a.city || '', tz: a.tz || '' } });
  }
  // Neither a number nor a code: whether the page should offer the lookup at all.
  if (req.query.number === undefined && req.query.date === undefined) return res.json({ available: on });
  if (overLimit(ctx.manifest.id, ctx.by, 'search')) return res.status(429).json({ error: limitMessage() });
  try {
    // With the setting off the number and date are still checked, so the page's messages are the same; the schedule is not read.
    const flights = await findFlights({ number: req.query.number, date: req.query.date, schedule: on ? flightSchedule : null });
    res.json({ flights: on ? flights : [] });
  } catch (err) {
    if (err instanceof FlightLookupError) return res.status(400).json({ error: err.message });
    console.error('The flight lookup failed:', err.message);
    res.status(500).json({ error: 'server error' });
  }
});
// A flight someone saved, in the objects format ({ object }): the schedule keeps its schedule part only (flight-lookup.js says
// what, and what never). 204 whether or not anything was kept, so a person never sees a failure from it.
app.post('/api/modules/:id/flight-lookup/remember', (req, res) => {
  const ctx = flightLookupAccess(req, res);
  if (!ctx) return;
  if (overLimit(ctx.manifest.id, ctx.by, 'write')) return res.status(429).json({ error: limitMessage() });
  if (flightSuggestionsOn()) {
    try { flightSchedule.remember(req.body?.object); } catch (err) { console.error('Remembering a flight failed:', err.message); }
  }
  res.status(204).end();
});
// For the admin: how many flights the schedule knows, forgetting one number, or clearing it all. On a hosted server the schedule
// is every environment's, so these are the host console's (/api/host/flight-schedule); on a single install, the owner's
// (/api/flight-schedule). Each answers 404 on the other kind of install.
function flightScheduleCounts(_req, res) { res.json(flightSchedule.stats()); }
function flightScheduleClear(req, res) {
  if (req.query.number === undefined) {
    const removed = flightSchedule.clear();
    if (removed === null) return res.status(500).json({ error: 'The flight schedule could not be cleared; the server log says why.' });
    return res.json({ removed, ...flightSchedule.stats() });
  }
  const number = typeof req.query.number === 'string' ? parseFlightNumber(req.query.number) : null;
  if (!number) return res.status(400).json({ error: 'That is not a flight number; enter the airline code and number, like WN 2483.' });
  if (!flightSchedule.forget(number.key)) return res.status(404).json({ error: `No flight ${number.shown} is saved on this server.` });
  res.json({ removed: 1, ...flightSchedule.stats() });
}
const hostedFlightSchedule = (_req, res, next) => (hostRegistry ? res.status(404).json({ error: `On a hosted server the flight schedule is shared by every ${word('environment')}, so only the host console can see or clear it.` }) : next());
app.get('/api/flight-schedule', hostedFlightSchedule, requireOwner, flightScheduleCounts);
app.delete('/api/flight-schedule', hostedFlightSchedule, requireOwner, flightScheduleClear);
// (The host console's two, /api/host/flight-schedule, are registered with the rest of the host's routes, above.)
// Reached here only off the host console: a single install has none, and an environment's address is not it.
const noHostFlightSchedule = (_req, res) => res.status(404).json({ error: hostRegistry ? 'The flight schedule is cleared from the host console.' : 'This server has no host console; its flight schedule is at /api/flight-schedule.' });
app.get('/api/host/flight-schedule', noHostFlightSchedule);
app.delete('/api/host/flight-schedule', noHostFlightSchedule);
// --- cutting a region out of a larger PMTiles file, from the server -----------------------------------------------------------
// A module that declares `regionSource` (see server/region-cut.js and documentation/plans/plan-map-region-download.md) offers
// "Add a region" in its Module Configuration: cut a piece of a world file into one of its own file folders. Admin only, since
// it can take a while and reads a server setting (the world file's address).
function sendRegionCutError(err, res) {
  if (err instanceof RegionCutError) return res.status(err.status).json({ error: err.message });
  throw err;
}
// Where this module's world file is, from its own settings: { address, folder }, or null when nothing is set up.
function regionSourceOf(manifest) {
  const r = manifest.regionSource;
  if (!r) return null;
  const address = moduleSettings.values(manifest, 'environment', {})[r.address];
  return typeof address === 'string' && address ? { address, folder: r.folder } : null;
}
function regionCutSetup(req, res) {
  const found = modules.enabled(req.params.id);
  if (!found) { res.status(404).json({ error: `no such ${word('module')}` }); return null; }
  if (found.manifest.regionSource && folderIsShared(found.manifest, found.manifest.regionSource.folder)) {
    res.status(403).json({ error: 'managed by the host' });
    return null;
  }
  const setup = regionSourceOf(found.manifest);
  if (!setup) { res.status(404).json({ error: `this ${word('module')} has no world file set up to cut from` }); return null; }
  return { manifest: found.manifest, setup };
}
const boxFromBody = (b) => ({ minLon: Number(b?.minLon), minLat: Number(b?.minLat), maxLon: Number(b?.maxLon), maxLat: Number(b?.maxLat) });
// A place's rough rectangle, from whichever enabled module has a place search configured (never named here: found the same
// way any other generic conduit is, by what a module declares, not by which one it happens to be). Places is the one that
// offers this today; anything with a `geocoder` in its manifest would be found the same way.
// Returns null when no enabled module has a configured search, otherwise `{ name, box }` (box null when nothing matched).
async function findRegionBox(q) {
  for (const { manifest } of modules.enabledAll()) {
    if (!manifest.geocoder) continue;
    const setup = geocodeSetup(manifest);
    if (!setup) continue;
    const found = await askService(setup.address, q, null);
    const best = found.find((p) => p.extent);
    return best ? { name: best.name, box: best.extent } : { name: null, box: null };
  }
  return null;
}
// "Add a region": type a place's name, get back its rough rectangle to cut, before anything is fetched for real.
app.get('/api/modules/:id/region-cut/find', requireOwner, async (req, res) => {
  const ctx = regionCutSetup(req, res);
  if (!ctx) return;
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q.length < 2) return res.status(400).json({ error: 'type a place name first' });
  try {
    const found = await findRegionBox(q);
    if (found === null) return res.status(404).json({ error: `no place search is set up on this server (${word('module', { a: true })} with one, such as Places, names where to look)` });
    res.json(found.box ? { found: true, name: found.name, box: found.box } : { found: false });
  } catch (err) {
    res.status(502).json({ error: 'search is not available right now' });
  }
});
// How big a cut would be, without downloading it: the admin confirms before "Add a region" commits to anything.
app.post('/api/modules/:id/region-cut/estimate', requireOwner, async (req, res) => {
  const ctx = regionCutSetup(req, res);
  if (!ctx) return;
  try {
    res.json(await regionCutJobs.estimate({ source: ctx.setup.address, box: boxFromBody(req.body), maxZoom: Number(req.body?.maxZoom), minZoom: req.body?.minZoom !== undefined ? Number(req.body.minZoom) : undefined }));
  } catch (err) {
    sendRegionCutError(err, res);
  }
});
// Start the real cut; the job runs in the background, followed over the stream route below.
app.post('/api/modules/:id/region-cut', requireOwner, async (req, res) => {
  const ctx = regionCutSetup(req, res);
  if (!ctx) return;
  try {
    const out = await regionCutJobs.start({
      moduleId: ctx.manifest.id,
      scopeKey: 'environment',
      source: ctx.setup.address,
      folder: ctx.setup.folder,
      name: String(req.body?.name || ''),
      box: boxFromBody(req.body),
      minZoom: req.body?.minZoom !== undefined ? Number(req.body.minZoom) : undefined,
      maxZoom: Number(req.body?.maxZoom),
      by: currentUser(req)?.key,
      replace: Boolean(req.body?.replace),
    });
    res.status(202).json(out);
  } catch (err) {
    sendRegionCutError(err, res);
  }
});
// Progress, in words and a percentage, over server-sent events; a late subscriber gets the job's current state first, and
// one already finished (or one the host has never heard of) is told so at once rather than hanging.
app.get('/api/modules/:id/region-cut/:jobId/stream', requireOwner, (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  const found = modules.enabled(req.params.id);
  if (!found || !found.manifest.regionSource) return res.status(404).json({ error: `no such ${word('module')}` });
  const job = regionCutJobs.view(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'that cut is not running (it may have finished a while ago)' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  sseWrite(res, 'retry: 3000\n\n');
  sseWrite(res, `event: progress\ndata: ${JSON.stringify({ percent: job.percent, message: job.message })}\n\n`);
  if (job.status !== 'running') {
    sseWrite(res, `event: ${job.status}\ndata: ${JSON.stringify(job.status === 'done' ? { name: job.name } : { error: job.error })}\n\n`);
    return res.end();
  }
  const { jobId } = req.params;
  const cleanup = () => { regionCutJobs.off('progress', onProgress); regionCutJobs.off('done', onDone); regionCutJobs.off('error', onErr); };
  // Told from the cutting process, outside this request: cleanup() reads this environment's jobs (listenIn).
  const onProgress = listenIn(env, (id, p) => { if (id === jobId) sseWrite(res, `event: progress\ndata: ${JSON.stringify(p)}\n\n`); });
  const onDone = listenIn(env, (id, d) => { if (id !== jobId) return; sseWrite(res, `event: done\ndata: ${JSON.stringify(d)}\n\n`); cleanup(); res.end(); });
  const onErr = listenIn(env, (id, error) => { if (id !== jobId) return; sseWrite(res, `event: error\ndata: ${JSON.stringify({ error })}\n\n`); cleanup(); res.end(); });
  regionCutJobs.on('progress', onProgress);
  regionCutJobs.on('done', onDone);
  regionCutJobs.on('error', onErr);
  req.on('close', () => envContext.run(env, cleanup));
});
// A settings change -> a line in the activity list: wired per environment in server/environment.js, on that
// environment's own real moduleSettings (this used to be one top-level listener; now it's one per environment).
function sendSettingError(err, res) {
  if (err instanceof SettingError) return res.status(err.status).json({ error: err.message });
  throw err;
}

// --- files an admin placed for a module ---------------------------------------------------------------------
// Some modules need a large file that cannot be uploaded through a page (a map's tile archive, gigabytes): the operator
// copies it into the folder the module's `file` setting names inside its own folder, the admin picks it in the
// module's settings, and the module reads it here, by range, like any static file. Nothing else in that folder
// is reachable, and only by name. Uninstalling and updating never touch it.
//
// A folder declared `shared: "host"` (documentation/plans/plan-environments.md, "Shared files: the host's map") is
// the host's, one for every environment, rather than each environment's own -- but only with a base domain;
// without one there is no separate host, so the declaration has no effect and an environment keeps its files
// and region cutting exactly as it always has.
function folderIsShared(manifest, folder) {
  return Boolean(BASE_DOMAIN) && (manifest.settings || []).some((d) => (d.type === 'file' || d.type === 'files') && d.folder === folder && d.shared === 'host');
}
// Whether one specific setting is shared right now: a shared files/file setting itself, or the url setting
// that is its regionSource's own address (a shared folder's world file is the host's to set, not the
// environment's).
function settingIsShared(manifest, def) {
  if (def.type === 'file' || def.type === 'files') return folderIsShared(manifest, def.folder);
  return Boolean(manifest.regionSource && def.key === manifest.regionSource.address && folderIsShared(manifest, manifest.regionSource.folder));
}
// Where a module's file-setting folder actually lives: the host's own (DATA_DIR/shared/<id>/<folder>/) for one
// shared right now; this environment's own otherwise (its own dataDir/modules/<id>/<folder>/ -- with no
// BASE_DOMAIN that is DATA_DIR itself, exactly where files have always lived).
function filesDirFor(manifest, folder) {
  if (folderIsShared(manifest, folder)) return path.resolve(DATA_DIR, 'shared', manifest.id, folder);
  return path.resolve(currentEnvironment().dataDir, 'modules', manifest.id, folder);
}
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const UPLOAD_PART_PREFIX = '.upload-';
// What is in a folder: the usable files, and each thing skipped with the reason, so an admin whose file does not
// show up is told why. A link to a file (a NAS shortcut) counts as the file. The lower-level scan, so the
// host's own listing of a shared folder (GET /api/host/shared, no manifest or environment in view) can use it
// the same way inspectModuleFiles does.
function inspectDir(folder) {
  const out = { folder, exists: false, files: [], sizes: {}, zooms: {}, kinds: {}, skipped: [] };
  let names;
  try {
    names = fs.readdirSync(folder);
    out.exists = true;
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (name.startsWith(UPLOAD_PART_PREFIX)) continue; // an upload still arriving (or left by one that was cut off): not a file yet
    if (!FILE_NAME_RE.test(name)) {
      out.skipped.push({ name: name.slice(0, 100), reason: 'a name may use letters, digits, dot, dash and underscore, and must start with a letter or digit, up to 100 characters' });
      continue;
    }
    let st = null;
    try { st = fs.statSync(path.join(folder, name)); } catch { /* a broken link */ }
    if (st && st.isFile()) {
      out.files.push(name);
      out.sizes[name] = st.size;
      // How detailed a map file is (street-level or not), read from its own header -- the file's own truth, so this
      // works whether it was cut with "Add a region" or dropped in by hand.
      if (/\.pmtiles$/i.test(name)) {
        const info = pmtilesInfo(path.join(folder, name));
        if (info) {
          out.zooms[name] = { minZoom: info.minZoom, maxZoom: info.maxZoom };
          // 'vector' (map data) or 'picture' (raster tiles); a file whose header names no type has none here.
          if (info.kind !== 'unknown') out.kinds[name] = info.kind;
        }
      }
    } else out.skipped.push({ name, reason: st ? 'not a regular file (a folder or something else)' : 'a link that leads nowhere' });
  }
  return out;
}
const inspectModuleFiles = (manifest, sub) => inspectDir(filesDirFor(manifest, sub));
const listModuleFiles = (manifest, sub) => inspectModuleFiles(manifest, sub).files;
// The path of a file a module's file settings can name, or null.
// `folder` (optional) says which of the module's file folders to look in, for a name that two folders share; without it
// the first folder that has the name answers, as it always has.
const moduleFilePath = (manifest, name, folder) => {
  if (!FILE_NAME_RE.test(name)) return null;
  for (const d of manifest.settings || []) if ((d.type === 'file' || d.type === 'files') && (!folder || d.folder === folder) && listModuleFiles(manifest, d.folder).includes(name)) return path.join(filesDirFor(manifest, d.folder), name);
  return null;
};
// The same, in words, for the log and for the picker.
function describeModuleFiles(manifest, sub) {
  const f = inspectModuleFiles(manifest, sub);
  if (!f.exists) return `${f.folder} does not exist yet`;
  const skipped = f.skipped.map((s) => `${s.name} (${s.reason})`).join('; ');
  return `${f.folder} has ${f.files.length} usable file${f.files.length === 1 ? '' : 's'}${f.files.length ? ': ' + f.files.join(', ') : ''}${f.skipped.length ? `; ignored ${f.skipped.length}: ${skipped}` : ''}`;
}
// A file for a module page, with range requests (what a map archive is read with). Needs the same access as reading
// the module's data in that place.
app.get('/api/modules/:id/files/:name', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const name = req.params.name;
  const file = moduleFilePath(ctx.manifest, name, typeof req.query.folder === 'string' ? req.query.folder : '');
  if (!file) return res.status(404).json({ error: 'no such file' });
  res.sendFile(file, { acceptRanges: true, headers: { 'Cache-Control': 'private, max-age=3600', 'Content-Type': 'application/octet-stream' } }, (err) => {
    if (!err || res.headersSent) return; // sent, or the connection broke part way
    // A range that cannot be met (the send library's 416): say so, with the file's size.
    if (err.status === 416) {
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* gone */ }
      res.removeHeader('Content-Range');
      return res.status(416).set('Content-Range', `bytes */${size}`).json({ error: 'That part of the file is out of range.' });
    }
    if (err.status === 404 || err.code === 'ENOENT') return res.status(404).json({ error: 'no such file' });
    return res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({ error: 'server error' });
  });
});
// Remove a file an admin placed for the module (a `file`/`files` setting) -- gone for good, so admin only. Also
// un-ticks it from any `files` setting that had it, and clears a `file` setting that pointed to it, so nothing on
// the module's own settings keeps naming a file that is no longer there.
app.delete('/api/modules/:id/files/:name', requireOwner, (req, res) => {
  const found = modules.enabled(req.params.id);
  if (!found) return res.status(404).json({ error: `no such ${word('module')}` });
  const name = req.params.name;
  if (req.query.folder !== undefined && typeof req.query.folder !== 'string') return res.status(400).json({ error: 'Name one folder in ?folder=.' });
  const folder = typeof req.query.folder === 'string' ? req.query.folder : ''; // optional: which folder, for a name two folders share
  const def =(found.manifest.settings || []).find((d) => (d.type === 'file' || d.type === 'files') && (!folder || d.folder === folder) && listModuleFiles(found.manifest, d.folder).includes(name));
  if (!def) return res.status(404).json({ error: 'no such file' });
  if (settingIsShared(found.manifest, def)) return res.status(403).json({ error: 'managed by the host' });
  const file = moduleFilePath(found.manifest, name, def.folder);
  if (!file) return res.status(404).json({ error: 'no such file' });
  try {
    fs.unlinkSync(file);
  } catch (err) {
    return res.status(500).json({ error: `the file could not be removed: ${err.message}` });
  }
  const by = currentUser(req)?.key || null;
  const values = moduleSettings.values(found.manifest, 'environment', {});
  for (const d of found.manifest.settings || []) {
    if (d.folder !== def.folder) continue;
    if (d.type === 'files' && Array.isArray(values[d.key]) && values[d.key].includes(name)) {
      moduleSettings.set(found.manifest, 'environment', {}, { [d.key]: values[d.key].filter((n) => n !== name) }, by);
    } else if (d.type === 'file' && values[d.key] === name) {
      moduleSettings.set(found.manifest, 'environment', {}, { [d.key]: '' }, by);
    }
  }
  res.json({ ok: true });
});

// --- a picture map (documentation/plans/plan-map-image.md) -----------------------------------------------------------------
// A module that declares `pictureMap` (Maps: its `imageMap` setting) lets the owner put one raster PMTiles file in for the
// whole environment: a picture of an invented world, made into tiles beforehand. While it is set the module draws only the
// picture, every module is told (the context's `environment.pictureMap`) and the outside place search is off.
const PICTURE_IN_MAP_FILES = 'That file is a picture map. Choose it under Picture map instead.';
const MAP_DATA_IN_PICTURE = 'That file is map data, not a picture. Choose it under Map files instead.';
const PICTURE_MAP_SEARCH_OFF = 'Place search is off while the map is a picture of an invented world.';
const pictureMapLimitBytes = () => {
  const mb = Number(MAP_IMAGE_MAX_MB);
  return Math.floor((Number.isFinite(mb) && mb > 0 ? mb : 100) * 1024 * 1024);
};
const uploadsRunning = new Set();
// The picture map this environment has, { file, minZoom, maxZoom, tileType }, or null: the setting names a file that is
// there and its header says picture tiles.
function pictureMapOf() {
  for (const { manifest } of modules.enabledAll()) {
    const pm = manifest.pictureMap;
    if (!pm) continue;
    const def = (manifest.settings || []).find((d) => d.key === pm.setting);
    const file = moduleSettings.values(manifest, 'environment', {})[pm.setting];
    if (!def || typeof file !== 'string' || !FILE_NAME_RE.test(file)) continue;
    const info = pmtilesInfo(path.join(filesDirFor(manifest, def.folder), file));
    if (info && info.kind === 'picture') return { file, minZoom: info.minZoom, maxZoom: info.maxZoom, tileType: info.tileType };
  }
  return null;
}
// Put a file in a `file` setting that declares `upload`: the body is the file itself (application/octet-stream), streamed to
// a part file in the folder with a running count (never held in memory), checked from its header, then renamed into place;
// the setting names it and the one it replaces goes. Any failure leaves the previous file and setting as they were.
app.put('/api/modules/:id/files/:folder', requireOwner, async (req, res) => {
  const found = modules.enabled(req.params.id);
  if (!found) return res.status(404).json({ error: `no such ${word('module')}` });
  const manifest = found.manifest;
  const def = (manifest.settings || []).find((d) => d.type === 'file' && d.folder === req.params.folder && d.upload);
  if (!def) return res.status(404).json({ error: `this ${word('module')} takes no upload there` });
  if (settingIsShared(manifest, def)) return res.status(403).json({ error: 'managed by the host' });
  const name = String(req.query.name || '');
  if (!FILE_NAME_RE.test(name) || !/\.pmtiles$/i.test(name)) return res.status(400).json({ error: 'Name the file in ?name=, ending in .pmtiles, with letters, digits, dot, dash and underscore.' });
  if (!req.is('application/octet-stream')) return res.status(415).json({ error: 'Send the file itself, as application/octet-stream.' });
  const limit = pictureMapLimitBytes();
  const tooBig = () => {
    res.set('Connection', 'close');
    res.status(413).json({ error: `That file is over the limit of ${Math.round((limit / 1048576) * 100) / 100} MB.` });
    req.resume(); // what is still arriving is thrown away, not kept
    setTimeout(() => req.destroy(), 20000).unref();
  };
  if (Number(req.headers['content-length']) > limit) return tooBig();
  for (const d of manifest.settings || []) {
    if ((d.type === 'file' || d.type === 'files') && d.folder !== def.folder && listModuleFiles(manifest, d.folder).includes(name)) return res.status(409).json({ error: `A file called ${name} is already in ${d.label}. Choose another name.` });
  }
  const lock = `${currentEnvironment().dataDir}|${manifest.id}|${def.folder}`;
  if (uploadsRunning.has(lock)) return res.status(409).json({ error: 'Another upload is still running. Wait for it to finish.' });
  uploadsRunning.add(lock);
  const dir = filesDirFor(manifest, def.folder);
  const part = path.join(dir, `${UPLOAD_PART_PREFIX}${crypto.randomBytes(8).toString('hex')}.part`);
  const dropPart = () => { try { fs.rmSync(part, { force: true }); } catch { /* already gone */ } };
  try {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // A part left by an upload that was cut off by a restart goes after an hour.
      for (const n of fs.readdirSync(dir)) if (n.startsWith(UPLOAD_PART_PREFIX) && Date.now() - fs.statSync(path.join(dir, n)).mtimeMs > 3600000) fs.rmSync(path.join(dir, n), { force: true });
    } catch (err) {
      return res.status(500).json({ error: `The file could not be saved: ${err.message}` });
    }
    const got = await new Promise((resolve) => {
      const out = fs.createWriteStream(part);
      let size = 0;
      let settled = false;
      const settle = (r) => { if (!settled) { settled = true; resolve(r); } };
      // A write stream opens its file asynchronously, so destroying it at once can leave the file created a moment
      // AFTER the part is removed. Every failure path therefore waits for the stream's 'close' (the file is open and
      // closed by then) before it answers, so the caller's unlink is the last thing to touch the part.
      const settleClosed = (r) => {
        if (settled) return;
        settled = true;
        if (out.closed) return resolve(r);
        out.once('close', () => resolve(r));
        out.destroy();
      };
      req.on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > limit) { req.removeAllListeners('data'); return settleClosed({ over: true }); }
        if (!out.write(chunk)) { req.pause(); out.once('drain', () => req.resume()); }
      });
      req.on('end', () => { if (!settled) out.end(() => settle({ size })); });
      req.on('error', () => settleClosed({ aborted: true }));
      req.on('close', () => { if (!req.complete) settleClosed({ aborted: true }); });
      out.on('error', (err) => settleClosed({ failed: err.message }));
    });
    if (got.over) { dropPart(); return tooBig(); }
    if (got.aborted) { dropPart(); return; }
    if (got.failed) { dropPart(); return res.status(500).json({ error: `The file could not be saved: ${got.failed}` }); }
    const info = got.size ? pmtilesInfo(part) : null;
    if (!info) {
      const why = got.size ? pmtilesWhyNot(part) : 'format';
      dropPart();
      if (why === 'zoom') return res.status(422).json({ error: 'That PMTiles file\'s zoom range is not valid.' });
      return res.status(415).json({ error: 'That is not a PMTiles file.' });
    }
    if (info.kind === 'unknown') { dropPart(); return res.status(422).json({ error: 'That PMTiles file\'s tile type is not one the map can draw.' }); }
    if (info.kind !== 'picture') { dropPart(); return res.status(422).json({ error: 'That PMTiles file holds map data, not a picture.' }); }
    if (info.maxZoom > 22) { dropPart(); return res.status(422).json({ error: 'The zoom range is out of range.' }); }
    if (info.rootDirEnd > got.size) { dropPart(); return res.status(422).json({ error: 'That PMTiles file looks cut short.' }); }
    const before = moduleSettings.values(manifest, 'environment', {})[def.key];
    const final = path.join(dir, name);
    // A file already there under this name is set aside first, so a failure after the rename puts it back.
    const aside = `${part}.old`;
    let hadOld = false;
    let placed = false;
    try {
      if (fs.existsSync(final)) { fs.renameSync(final, aside); hadOld = true; }
      fs.renameSync(part, final);
      placed = true;
      moduleSettings.set(manifest, 'environment', {}, { [def.key]: name }, currentUser(req)?.key || null);
    } catch (err) {
      dropPart();
      if (placed) { try { fs.rmSync(final, { force: true }); } catch { /* already gone */ } }
      if (hadOld) { try { fs.renameSync(aside, final); } catch { /* nothing more to do */ } }
      return res.status(500).json({ error: `The file could not be saved: ${err.message}` });
    }
    if (hadOld) { try { fs.rmSync(aside, { force: true }); } catch { /* left for the hourly clean-up */ } }
    if (typeof before === 'string' && before && before !== name && FILE_NAME_RE.test(before)) fs.rmSync(path.join(dir, before), { force: true });
    res.json({ name, size: got.size, minZoom: info.minZoom, maxZoom: info.maxZoom });
  } finally {
    uploadsRunning.delete(lock);
  }
});

// The values that apply to the viewer, for the module itself.
// A shared setting's real value is the host's, not whatever this environment's own (unused) copy holds --
// every file in the shared folder (nothing to tick), or the host's own saved region source address. Shared by
// GET /api/modules/:id/settings/values (a module reading its own settings) and withValues (the admin's own
// settings form) below, so both ever answer the same thing for it.
function sharedValue(manifest, def) {
  if (def.type === 'files') return listModuleFiles(manifest, def.folder);
  if (def.type === 'file') return listModuleFiles(manifest, def.folder)[0] || '';
  return hostRegistry.sharedFolderAddress(manifest.id, manifest.regionSource.folder);
}
app.get('/api/modules/:id/settings/values', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const values = moduleSettings.effective(ctx.manifest, { spaceId: ctx.spaceId, userKey: ctx.who.user?.key || null });
  for (const d of ctx.manifest.settings || []) if (settingIsShared(ctx.manifest, d)) values[d.key] = sharedValue(ctx.manifest, d);
  res.json({ values });
});

// Who may change the settings of a scope, and where they are kept; sends the error itself and returns null when not.
function settingsPlace(req, res, scope) {
  const user = currentUser(req);
  if (!user) return void res.status(401).json({ error: 'sign in first' });
  if (scope === 'environment') {
    if (!hasOwnerRights(user)) return void res.status(403).json({ error: `only ${word('owner', { a: true })} changes the ${word('environment')}'s settings` });
    return { user, ctx: {} };
  }
  if (scope === 'person') return { user, ctx: { userKey: user.key } };
  if (scope === 'space') {
    const space = store.spaceById(String(req.query.space || req.body?.space || ''));
    if (!space) return void res.status(404).json({ error: `no such ${word('space')}` });
    // A moderator is a member ticked as one in that space (an owner ticks it on the member's profile).
    if (!(hasOwnerRights(user) || (space.members.includes(user.key) && store.spaceFlags(user.key, space.id).moderator))) return void res.status(403).json({ error: `only ${word('owner', { a: true })} or the ${word('space')}'s ${word('moderator', { many: true })} change its settings` });
    return { user, ctx: { spaceId: space.id }, space };
  }
  return void res.status(404).json({ error: 'no such kind of setting' });
}
const withValues = (manifest, scope, ctx) => {
  const values = moduleSettings.values(manifest, scope, ctx);
  return manifest.settings.filter((d) => d.scope === scope).map((d) => {
    const shared = settingIsShared(manifest, d);
    const { shared: _manifestFlag, ...own } = d; // the manifest's "host" string is not an answer: `shared` below is true or absent
    return {
      ...own,
      value: shared ? sharedValue(manifest, d) : values[d.key],
      ...(shared ? { shared: true } : {}),
      // `folder` stays the manifest's folder NAME; the scan's full path goes under `path`.
      ...(d.type === 'file' || d.type === 'files' ? (({ files, folder, ...rest }) => ({ available: files, path: folder, ...rest }))(inspectModuleFiles(manifest, d.folder)) : {}),
    };
  });
};

// The modules that have settings of a scope here, each with its settings and their values.
app.get('/api/module-settings/:scope', (req, res) => {
  const place = settingsPlace(req, res, req.params.scope);
  if (!place) return;
  const scope = req.params.scope;
  const out = modules.enabledAll()
    .filter(({ manifest, entry }) => manifest.settings.some((d) => d.scope === scope) && (scope !== 'space' || modules.isOnIn(entry.id, place.space.id)))
    .map(({ manifest }) => ({ id: manifest.id, ...shownModule(manifest), settings: withValues(manifest, scope, place.ctx) }));
  res.json({ modules: out });
});
app.put('/api/modules/:id/settings/:scope', (req, res) => {
  const place = settingsPlace(req, res, req.params.scope);
  if (!place) return;
  const found = modules.enabled(req.params.id);
  if (!found) return res.status(404).json({ error: `no such ${word('module')}` });
  try {
    // A shared setting (its files, or the world address that cuts into them) is the host's while there is
    // one; ignored here rather than refusing the whole save, so a page saving several settings together still
    // saves the ones that are its own.
    const values = { ...(req.body?.values || {}) };
    for (const d of found.manifest.settings) if (settingIsShared(found.manifest, d)) delete values[d.key];
    for (const [key, v] of Object.entries(values)) {
      const def = found.manifest.settings.find((d) => d.key === key);
      if (def && def.type === 'files' && Array.isArray(v)) {
        const seen = inspectModuleFiles(found.manifest, def.folder);
        const gone = v.find((n) => !seen.files.includes(n));
        if (gone) throw new SettingError(`${def.label}: there is no file called ${gone} for this ${word('module')}`);
        // A module with a picture map keeps picture files out of its map data list: they would be drawn as nothing.
        const had = moduleSettings.values(found.manifest, 'environment', {})[def.key]; // only a file newly ticked is refused, so saving other settings is never blocked by an old tick
        if (found.manifest.pictureMap && v.some((n) => seen.kinds[n] === 'picture' && !(Array.isArray(had) && had.includes(n)))) throw new SettingError(PICTURE_IN_MAP_FILES);
      }
      if (def && def.type === 'file' && v) {
        const seen = inspectModuleFiles(found.manifest, def.folder);
        if (!seen.files.includes(v)) throw new SettingError(`${def.label}: there is no file called ${v} for this ${word('module')}`);
        if (found.manifest.pictureMap && found.manifest.pictureMap.setting === def.key && seen.kinds[v] !== 'picture') throw new SettingError(MAP_DATA_IN_PICTURE);
      }
    }
    moduleSettings.set(found.manifest, req.params.scope, place.ctx, values, place.user.key);
    res.json({ settings: withValues(found.manifest, req.params.scope, place.ctx) });
  } catch (err) {
    sendSettingError(err, res);
  }
});

// Who is looking and what they may do in this module, for the frame's hello.
app.get('/api/modules/:id/context', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const { manifest, perms, who } = ctx;
  const here = ctx.scope === 'space' ? store.spaceById(ctx.spaceId) : null;
  const phases = Array.isArray(store.templatePhases) ? store.templatePhases : [];
  res.json({
    user: who.keyed ? { key: 'viewer', name: 'Viewer', role: 'viewer' } : who.user ? { key: who.user.key, name: who.user.displayName, role: who.user.role } : { key: 'guest', name: word('guest', { cap: true }), role: 'guest' },
    permissions: Object.fromEntries(manifest.permissions.map((p) => [p.key, Boolean(perms[`module.${manifest.id}.${p.key}`])])),
    // `nav`: the admin allowed this module into the primary nav (surfaces.page.nav), which is what lets a system-wide
    // tool of its own into that bar (host.nav.set; see api-module-sdk.md, "Registering into the nav bars").
    // `name` and `icon`: what this environment calls the module and shows it as (its display name and icon, else its own).
    module: { id: manifest.id, ...shownModule(manifest), version: manifest.version, nav: Boolean(manifest.surfaces.page && manifest.surfaces.page.nav) },
    // How the server shows language, time and money (Manage > Settings), for every module to follow.
    // `currencies`: the codes the server takes (as GET /api/currencies), for a module's currency picker.
    // `words`: every level's and role's words in this environment, as branding()'s (server/words.js), for host.locale().words.
    locale: { language: store.settings.language || 'en', clock: store.settings.clock === '24' ? '24' : '12', currency: store.settings.currency || 'USD', currencies: currencyCodes(store.settings.currency), words: store.resolvedWords() },
    // The space this read is in, or null outside one; its `phases` are the dates set on it ({} while none; plan-one-bar.md
    // step 1). The top-level `phases` is the template's, live, or [] when there is none. `budget` is the space's budget
    // target, { amount?, currency? } (#216; set in Set up by an owner, the admin or a moderator of the space), or null
    // while none is set. This is how a member reads it (plan-budget-module.md, decision 3): through the module, never
    // the general space lists. Always null for a guest (moduleAccess has already refused anyone not in the space or
    // without the module's read permission). `guestsSeeHidden`: true while an owner lets this space's guests see the fields
    // modules keep from guests (costs and booking codes), so a page can say what a guest sees.
    space: here ? { id: here.id, name: here.name, createdAt: here.createdAt, phases: here.phases, budget: (who.user && here.budget) || null, guestsSeeHidden: here.guestsSeeHidden === true } : null,
    phases: phases.map((p) => ({ id: p.id, label: p.label, ...(p.main ? { main: true } : {}), ...(p.icon ? { icon: p.icon } : {}) })),
    // Facts about the environment every module may need. `pictureMap`: { file, minZoom, maxZoom, tileType } while the
    // environment's map is a picture of an invented world (a module that declares `pictureMap` names the file), else null.
    environment: { pictureMap: pictureMapOf() },
  });
});

// Modules on one space's canvas, for the call's Modules menu.
app.get('/api/modules/for-space', (req, res) => {
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'sign in first' }); // the access key opens only a module's keyed page
  const space = store.spaceById(String(req.query.space || ''));
  if (!space) return res.status(404).json({ error: `no such ${word('space')}` });
  const perms = modulePerms(who, space.id);
  res.json({
    modules: modules.enabledAll()
      .filter(({ manifest, entry }) => manifest.scope.includes('space') && manifest.surfaces.canvas && moduleSpaceAccess(entry, who, space) && moduleCan(manifest, perms, 'read'))
      .map(({ manifest, entry }) => ({ id: manifest.id, ...shownModule(manifest), color: manifest.color || null, ...(manifest.description ? { description: manifest.description } : {}), version: manifest.version, budget: manifest.budget === true, scope: manifest.scope, runMode: modules.runModeOf(entry), canvas: manifest.surfaces.canvas, commands: manifest.commands || [], permissions: manifest.permissions.map((p) => `module.${manifest.id}.${p.key}`).filter((k) => perms[k]), clear: mayClearHere(manifest, who, perms, space.id), undoSeconds: moduleHolds.seconds })),
    // The built-in modules' names and icons as this environment shows them (the canvas's Conference and Chat switches).
    builtin: BUILTIN_MODULES.map((b) => ({ id: b.id, ...shownModule(b), ...(b.description ? { description: fillWords(b.description) } : {}) })),
    // What this space opens with, or null when it has no list of its own. The environment's list is what a new space
    // opens with when the space itself has none.
    opensWith: Array.isArray(space.opensWith) && space.opensWith.length ? [...space.opensWith] : null,
    spaceDefaultsOpensWith: Array.isArray(store.settings.spaceDefaults?.opensWith) && store.settings.spaceDefaults.opensWith.length ? [...store.settings.spaceDefaults.opensWith] : null,
    // The space's default layout, whole (as GET /api/spaces/:id/layouts lists it), or null: what a first visit opens,
    // with its places, when Opens with is the space's own list (plan-saved-layouts.md, decision 4).
    defaultLayout: store.defaultLayoutOf(space.id),
    // What a first visit shows for this viewer, resolved (firstVisitFor): { layout, opensWith }.
    firstVisit: firstVisitFor({ who, space }),
  });
});

// One module's own page, for its full-width server page: the shell page
// (public/module.html) reads the module id from the address.
// A module on a space's canvas popped out into its own window opens the same page with the
// space in the query, ?space=<id> (and a guest's link token, if that is who is looking).
app.get('/modules/:id', (req, res) => {
  // Framed by this site only (the overlay and the canvas hold it), unless the address carries the access key (?s=) or
  // the module serves a keyed page (an OBS or stream module): those are left as they were, for whatever embeds them.
  const keyedModule = modules.enabled(req.params.id)?.manifest?.surfaces?.keyed;
  if (req.query.s === undefined && !keyedModule) res.set(FRAMED_HERE);
  if (!currentUser(req) && !hasGuestAccess(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  // A module's environment page (no space, not a pop-out) leads to the destination it is a part of while that is shown
  // (plan-calendar-destination.md, decision 16). For the main the browser keeps the address's #day= or #ref= across the redirect,
  // and the query goes with it (?from=space&spaceName=... is the page's "Back to" link). Only the query is taken from
  // the request: the path is the destination's own, so the redirect never leaves this site.
  if (req.query.space === undefined && req.query.popout === undefined && req.query.guest === undefined) {
    const dctx = destinationContext(moduleViewer(req));
    const to = destinationPathOf(req.params.id, dctx);
    if (to && /^\/[A-Za-z0-9/_-]*$/.test(to) && !to.startsWith('//')) {
      const asked = new URL(req.originalUrl, 'http://same.origin');
      // A panel (not the main) is named, so the destination opens on it: #panel=<module id>, as a tile's heading does.
      // The main keeps the bare address, and with it the browser keeps the address's own #day= or #ref=.
      const partHash = widgetHref(req.params.id, dctx).slice(to.length);
      return res.redirect(`${to}${asked.search}${/^#panel=[A-Za-z0-9_%-]+$/.test(partHash) ? partHash : ''}`);
    }
  }
  // A module popped out of the Lobby that the Lobby doesn't allow: the sentence, not its page.
  const found = req.query.space === LOBBY ? modules.enabled(req.params.id) : null;
  if (found && refusedInLobby(found.manifest, LOBBY)) return res.status(404).type('text').send(lobbyRefusal(found.manifest));
  res.sendFile(page('module.html'));
});

// A destination's page (/calendar; /map once Map is built): the one host page, public/destination.html, for a signed-in
// person it is shown for. Anyone else signed in goes home, and so does everyone while the page is not built yet.
for (const dest of destinations.DESTINATIONS) {
  app.get(dest.path, (req, res) => {
    // As a view of one space (?space=<id>): the same page, for anyone in that space the destination has a readable
    // main for there, a guest with the space's token included; anyone else goes home as below.
    if (req.query.space !== undefined && destinationPageReady() && destinationInSpace(dest.id, moduleViewer(req), req.query.space)) {
      return res.sendFile(page('destination.html'));
    }
    if (!currentUser(req)) {
      // A guest (a space's guest link, no session) goes home: back to their space by its link, or / for a dead link.
      // Framed (a composite's frame), never redirected into a page that refuses frames: a plain page that says so.
      if (req.query.guest !== undefined) {
        if (framedRefusal(req, res, 401, 'Sign in again.')) return;
        const guestSpace = typeof req.query.guest === 'string' ? store.spaceByGuestToken(req.query.guest) : null;
        return res.redirect(guestSpace ? `/guest/${encodeURIComponent(req.query.guest)}` : '/');
      }
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    const ctx = destinationContext(moduleViewer(req));
    if (!destinationPageReady() || !destinations.resolveDestination(dest.id, ctx)) {
      if (framedRefusal(req, res, 403, 'This page is not shown here any more. Reload the page.')) return;
      return res.redirect('/');
    }
    res.sendFile(page('destination.html'));
  });
}

// The module's own files. Sandboxed by header, so even opened directly they
// run with no access to the app's pages or cookies, and can only load their own files.
app.get('/m/:id/:version/*path', (req, res) => {
  const rel = [].concat(req.params.path).join('/');
  const file = modules.resolveFile(req.params.id, req.params.version, rel);
  if (!file) return res.status(404).end();
  // A module that runs in the page (not in a frame) is loaded in parts: its styles, its markup and its
  // script, taken from its single HTML file, each for the page to place in the module's own container.
  const part = req.query.part;
  if (part === 'css' || part === 'body' || part === 'js') {
    const found = modules.enabled(req.params.id);
    if (!found || modules.runModeOf(found.entry) !== 'page' || !/\.html?$/i.test(file)) return res.status(403).json({ error: `that ${word('module')} does not run in the page` });
    const html = fs.readFileSync(file, 'utf8');
    const grab = (re) => [...html.matchAll(re)].map((m) => m[1]).join('\n');
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    if (part === 'css') return res.type('text/css').send(grab(/<style\b[^>]*>([\s\S]*?)<\/style>/gi));
    if (part === 'js') return res.type('application/javascript').send(grab(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi));
    const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
    return res.type('text/html').send((body ? body[1] : html).replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, ''));
  }
  res.set({
    'Content-Security-Policy': "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff',
    // A sandboxed frame has an opaque origin, so its own scripts and fonts load as cross-origin.
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'no-cache',
  });
  if (!/\.html?$/i.test(file)) return res.sendFile(file, { dotfiles: 'deny' });
  // A module's HTML pages get the SDK and the base styles inline, so a module
  // needs no <script> or <link> for them (and works even where a sandboxed
  // frame is not allowed to load its own subresources). A page that already
  // includes /sdk/host.js keeps what it has; <meta name="sdk-base"
  // content="none"> leaves the base styles out.
  let html = fs.readFileSync(file, 'utf8');
  if (!html.includes('/sdk/host.js')) {
    const sdk = fs.readFileSync(path.join(publicDir, 'sdk', 'host.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
    const css = /<meta[^>]+name=["']sdk-base["'][^>]+content=["']none["']/i.test(html) ? '' : ['system.css', 'host.css'].map((f) => fs.readFileSync(path.join(publicDir, 'sdk', f), 'utf8')).join('\n'); // system.css first: the shared pieces (switches, buttons), host.css on top
    const inject = `${css ? `<style id="sdk-base">${css}</style>` : ''}<script id="sdk-script">${sdk}</script>`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
  }
  res.type('html').send(html);
});

// The data routes hold every write to the module's guards (server/module-guards.js: who may write which keys, the
// shape of values, who may clear everything) and keep a module's hidden fields from guests (hiddenFor).
app.get('/api/modules/:id/data', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  res.json({ items: moduleData.list(ctx.manifest.id, ctx.scopeKey, typeof req.query.prefix === 'string' ? req.query.prefix : '').map((item) => hideItem(item, ctx.hide)) });
});
app.get('/api/modules/:id/data/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const item = moduleData.get(ctx.manifest.id, ctx.scopeKey, req.params.key);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json({ item: hideItem(item, ctx.hide) });
});
function sendModuleConflict(err, res, hide = []) {
  if (err.status === 409) return res.status(409).json({ error: err.message, current: hideItem(err.current || null, hide) });
  throw err;
}
app.put('/api/modules/:id/data/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'own');
  if (!ctx) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'write');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage() });
  try {
    const had = moduleData.get(ctx.manifest.id, ctx.scopeKey, req.params.key);
    // A writer who can't see the hidden fields leaves them as they were, and can't replace a value that holds any.
    const hiddenRefused = moduleGuards.hiddenPutRefusal(req.body?.value, had ? had.value : null, ctx.hide);
    if (hiddenRefused) return res.status(hiddenRefused.status).json({ error: hiddenRefused.error });
    let value = moduleGuards.keepHidden(req.body?.value, had ? had.value : null, ctx.hide);
    const guards = guardsAt(ctx);
    if (guards) {
      const keys = () => moduleData.list(ctx.manifest.id, ctx.scopeKey).map((item) => item.key);
      const checked = moduleGuards.checkPut(guards, { key: req.params.key, before: had ? had.value : null, value, who: guardWho(ctx), read: storedValue(ctx), keys, personal: personalAt(ctx) });
      if (checked.error) return res.status(checked.status).json({ error: checked.error });
      value = checked.value;
    }
    const item = moduleData.put(ctx.manifest.id, ctx.scopeKey, req.params.key, value, { expected: Number.isInteger(req.body?.version) ? req.body.version : null, by: ctx.by });
    objectSync.afterWrite({ module: ctx.manifest.id, scopeKey: ctx.scopeKey, key: req.params.key, before: had ? had.value : null, after: item.value, by: ctx.by, tz: req.body?.tz });
    // A file swapped for another (a photo's picture): the old one goes when nothing stored here names it any more.
    if (had && guards) {
      const was = moduleGuards.fileOf(guards, req.params.key, had.value);
      if (was && was !== moduleGuards.fileOf(guards, req.params.key, item.value)) removeFilesOf(ctx, [{ key: req.params.key, value: had.value }]);
    }
    res.json({ item: hideItem(item, ctx.hide) });
  } catch (err) {
    sendModuleConflict(err, res, ctx.hide);
  }
});
// Clear: everything the module holds in the scope, in one write, held for its Undo (server/module-holds.js) for 30 seconds
// (CLEAR_UNDO_SECONDS): the values leave at once, the files they name wait, and so does what the clear does to other
// modules. The answer's restoreToken undoes it (POST .../data/restore) until undoUntil; another Clear here is refused (409)
// while it waits. The guards' `clear` decides who may (checkClear); a writer who can't see the hidden fields can't clear
// what holds any. A module is cleared at most five times a minute in an environment, by everyone together (429).
// `cleared` and `restored` count objects: the module's bookkeeping keys ("_...", isBookkeeping) go and come back uncounted.
function clearRefusal(ctx) {
  if (ctx.manifest.library) return { status: 400, error: libraryClearRefusal(ctx.manifest) };
  const guards = guardsAt(ctx);
  // A person clears their own data; guards that don't read still refuse it.
  return guards && (!personalAt(ctx) || guards.invalid) ? moduleGuards.checkClear(guards, guardWho(ctx)) : null;
}
// The clear budget (server/module-limits.js): five a minute for a module in an environment, but one person takes at most
// three of them (clearPerson) and a member or guest, with the others like them, at most three (clearOrdinary), so the
// last two are always there for an owner, admin or moderator of the space. A refusal gives back what it had counted.
function clearBudget(ctx) {
  const id = ctx.manifest.id;
  const user = ctx.who.user;
  const space = ctx.scopeKey.startsWith('space:') ? store.spaceById(ctx.scopeKey.slice(6)) : null;
  const trusted = Boolean(user) && (hasOwnerRights(user) || (space ? chatModerator(ctx.who, space) : false));
  const taken = [];
  for (const [who, kind] of [[ctx.by, 'clearPerson'], ...(trusted ? [] : [['*', 'clearOrdinary']]), ['*', 'clear']]) {
    const slow = overLimit(id, who, kind);
    if (slow) {
      for (const [w, k] of taken) moduleLimits.refund(id, w, k);
      return slow;
    }
    taken.push([who, kind]);
  }
  return null;
}
app.delete('/api/modules/:id/data', (req, res) => {
  const ctx = moduleAccess(req, res, 'own');
  if (!ctx) return;
  const refused = clearRefusal(ctx);
  if (refused) return res.status(refused.status).json({ error: refused.error });
  const waiting = moduleHolds.peek(ctx.manifest.id, ctx.scopeKey);
  if (waiting) {
    // Retry-After is when the hold is over (the grace included); the sentence counts to undoUntil, the time the toast shows.
    const retry = Math.max(1, Math.ceil((Date.parse(waiting.expiresAt) - Date.now()) / 1000));
    const left = Math.ceil((Date.parse(waiting.undoUntil) - Date.now()) / 1000);
    const name = modules.shownName(ctx.manifest);
    return void res.set('Retry-After', String(retry)).status(409).json({ error: left > 0 ? `${name} was just cleared. You can undo that for ${left} more ${left === 1 ? 'second' : 'seconds'}, or clear it again after that.` : `${name} was just cleared. You can clear it again in ${retry} ${retry === 1 ? 'second' : 'seconds'}.` });
  }
  const slow = overLimit(ctx.manifest.id, ctx.by, 'write');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage() });
  const items = moduleData.list(ctx.manifest.id, ctx.scopeKey);
  // A writer who can't see the hidden fields can't remove what holds any.
  const hiddenRefused = moduleGuards.hiddenClearRefusal(items.map((item) => item.value), ctx.hide);
  if (hiddenRefused) return res.status(hiddenRefused.status).json({ error: hiddenRefused.error });
  if (!items.some((item) => !isBookkeeping(item.key))) return res.json({ cleared: 0 }); // no objects: nothing to clear
  const often = clearBudget(ctx);
  if (often) return void res.set('Retry-After', String(often.retrySeconds)).status(429).json({ error: `${modules.shownName(ctx.manifest)} was cleared too often just now. Try again in ${often.retrySeconds} ${often.retrySeconds === 1 ? 'second' : 'seconds'}.` });
  // Held first, then cleared: a stop between the two leaves the data where it was.
  const held = moduleHolds.hold(ctx.manifest.id, ctx.scopeKey, {
    items: items.map(({ key, value, version, updatedAt, by }) => ({ key, value, version, updatedAt, by })),
    files: filesNamedBy(ctx.manifest, items),
    by: ctx.by,
    tz: typeof req.query.tz === 'string' ? req.query.tz : null,
  });
  moduleData.removeAll(ctx.manifest.id, ctx.scopeKey, { by: ctx.by });
  res.json({ cleared: items.filter((item) => !isBookkeeping(item.key)).length, restoreToken: held.token, undoSeconds: held.seconds, undoUntil: held.undoUntil });
});
// Undo of a Clear: puts back exactly what that clear held (each value with its writer and time, its files kept), in one
// write and one 'changes' event; it counts as one save against the write limit. The same permission as the clear. A key
// that holds something now keeps it and is named in `taken` (a bookkeeping key keeps it unnamed); the rest come back.
// Answers { restored, skipped, taken }, counting objects only. A token that undoes nothing is a 410 that says why.
app.post('/api/modules/:id/data/restore', (req, res) => {
  const ctx = moduleAccess(req, res, 'own');
  if (!ctx) return;
  const refused = clearRefusal(ctx);
  if (refused) return res.status(refused.status).json({ error: refused.error });
  const token = req.body?.restoreToken;
  if (typeof token !== 'string' || !token) return res.status(400).json({ error: 'Say which clear to undo: send the restoreToken its answer gave.' });
  const hold = moduleHolds.peek(ctx.manifest.id, ctx.scopeKey);
  if (!hold || hold.token !== token) return res.status(410).json({ error: UNDO_GONE[moduleHolds.why(ctx.manifest.id, ctx.scopeKey, token)] });
  const hiddenRefused = moduleGuards.hiddenClearRefusal(hold.items.map((item) => item.value), ctx.hide);
  if (hiddenRefused) return res.status(hiddenRefused.status).json({ error: hiddenRefused.error });
  const slow = overLimit(ctx.manifest.id, ctx.by, 'write');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage() });
  let result;
  try {
    result = moduleData.restoreMany(ctx.manifest.id, ctx.scopeKey, hold.items, { by: ctx.by });
  } catch (err) {
    moduleLimits.refund(ctx.manifest.id, ctx.by, 'write'); // nothing came back, so it was not a save
    if (err instanceof StoreError && err.status === 413) return res.status(413).json({ error: `${modules.shownName(ctx.manifest)}'s storage is full, so nothing came back. Remove something and press Undo again.` });
    throw err;
  }
  moduleHolds.drop(ctx.manifest.id, ctx.scopeKey, 'undone');
  // What did not come back is cleared for good: other modules hear of it (unless its key now holds the object they
  // follow) and its files go, as when a hold runs out.
  if (result.taken.length) {
    const left = new Set(result.taken);
    finishHold({ ...hold, items: hold.items.filter((item) => left.has(item.key)) });
  }
  res.json({ restored: result.restored.filter((key) => !isBookkeeping(key)).length, skipped: result.taken.length, taken: result.taken.slice(0, 50) });
});
// Why a restoreToken undoes nothing (moduleHolds.why), as the 410 says it.
const UNDO_GONE = {
  undone: 'That clear was already undone.',
  replaced: 'A later clear replaced it.',
  over: 'The time to undo that clear is over.',
};
app.delete('/api/modules/:id/data/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'own');
  if (!ctx) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'write');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage() });
  try {
    const expected = req.query.version !== undefined ? Number(req.query.version) : null;
    const had = moduleData.get(ctx.manifest.id, ctx.scopeKey, req.params.key);
    const guards = guardsAt(ctx);
    // A person removes their own data; guards that don't read still refuse it.
    const refused = guards && (!personalAt(ctx) || guards.invalid) ? moduleGuards.checkDelete(guards, { key: req.params.key, before: had ? had.value : null, who: guardWho(ctx), read: storedValue(ctx) }) : null;
    if (refused) return res.status(refused.status).json({ error: refused.error });
    // What belongs to it (a rule's `parent`: a poll's votes) goes with it, closed or not.
    const all = had && guards ? moduleData.list(ctx.manifest.id, ctx.scopeKey) : [];
    const children = new Set(moduleGuards.childrenOf(guards, req.params.key, all.map((item) => item.key)));
    const childItems = all.filter((item) => children.has(item.key));
    // A writer who can't see the hidden fields can't remove what holds any, nor what goes with it.
    const hiddenRefused = had ? moduleGuards.hiddenDeleteRefusal(had.value, ctx.hide, childItems.map((item) => item.value)) : null;
    if (hiddenRefused) return res.status(hiddenRefused.status).json({ error: hiddenRefused.error });
    const removed = moduleData.remove(ctx.manifest.id, ctx.scopeKey, req.params.key, { expected: Number.isInteger(expected) ? expected : null, by: ctx.by });
    if (had) {
      objectSync.afterWrite({ module: ctx.manifest.id, scopeKey: ctx.scopeKey, key: req.params.key, before: had.value, after: null, by: ctx.by, tz: req.query.tz });
      for (const child of childItems) {
        moduleData.remove(ctx.manifest.id, ctx.scopeKey, child.key, { by: ctx.by });
        objectSync.afterWrite({ module: ctx.manifest.id, scopeKey: ctx.scopeKey, key: child.key, before: child.value, after: null, by: ctx.by, tz: req.query.tz });
      }
      removeFilesOf(ctx, [{ key: req.params.key, value: had.value }, ...all.filter((item) => children.has(item.key))]);
    }
    res.json(removed);
  } catch (err) {
    sendModuleConflict(err, res, ctx.hide);
  }
});

// Live changes to one module's data in one scope, pushed as server-sent events.
// The page hosting the module's frame listens and forwards them into the frame.
// Hooks: schedule something for later, or tell people now. The module must
// have declared the hook in its manifest (enabling it approved that).
function requireHook(ctx, res, hook) {
  if (ctx.manifest.hooks[hook]) return true;
  res.status(403).json({ error: `this ${word('module')} did not ask for the ${hook} hook` });
  return false;
}
function sendHookError(err, res) {
  if (err instanceof StoreError) return res.status(err.status).json({ error: err.message });
  throw err;
}
app.post('/api/modules/:id/schedule', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx || !requireHook(ctx, res, 'schedule')) return;
  if (req.body?.notify && typeof req.body.notify === 'object' && refuseNotifyTo(req.body.notify.to, res)) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'schedule');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage() });
  try {
    res.json(moduleHooks.schedule(ctx, req.body || {}));
  } catch (err) {
    sendHookError(err, res);
  }
});
app.delete('/api/modules/:id/schedule/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx || !requireHook(ctx, res, 'schedule')) return;
  res.json(moduleHooks.cancel(ctx, req.params.key));
});
app.post('/api/modules/:id/notify', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx || !requireHook(ctx, res, 'notify')) return;
  if (refuseNotifyTo(req.body?.to, res)) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'notify');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage() });
  try {
    const to = typeof req.body?.to === 'string' ? req.body.to : ctx.scope === 'space' ? 'space' : 'environment';
    res.json({ delivered: moduleHooks.deliver({ module: ctx.manifest.id, scopeKey: ctx.scopeKey, spaceId: ctx.spaceId }, { ...req.body, to }, { by: ctx.by }) });
  } catch (err) {
    sendHookError(err, res);
  }
});

// A signed-in person's own notifications: the list, marking them read, and a
// live stream so a toast can appear the moment one arrives.
// Who a notice is from, as the bell shows it: the module's name and icon in this environment's words, or for the host's
// own notices (about the bundled modules) the word for a module, with the puzzle piece.
function sourceOf(id) {
  if (id === HOST_SOURCE) return { moduleName: word('module', { many: true, cap: true }), icon: 'puzzle-piece' };
  const { manifest } = modules.enabled(id);
  return { moduleName: shownModule(manifest).name, icon: shownModule(manifest).icon };
}
app.get('/api/notifications', requireUser, (req, res) => {
  // Each with its module's name and icon as this environment shows them, as the live stream sends them.
  const list = moduleHooks.list(currentUser(req).key).filter((n) => n.module === HOST_SOURCE || modules.enabled(n.module))
    .map((n) => ({ ...n, ...sourceOf(n.module) }));
  const byModule = {};
  for (const n of list) if (!n.read) byModule[n.module] = (byModule[n.module] || 0) + 1;
  res.json({ notifications: list, byModule, unread: Object.values(byModule).reduce((a, b) => a + b, 0) });
});
app.post('/api/notifications/read', requireUser, (req, res) => {
  moduleHooks.markRead(currentUser(req).key, { module: typeof req.body?.module === 'string' ? req.body.module : null, id: typeof req.body?.id === 'string' ? req.body.id : null });
  res.json({ ok: true });
});
app.get('/api/notifications/stream', requireUser, (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  const key = currentUser(req).key;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  sseWrite(res, 'retry: 5000\n\n');
  const onNote = listenIn(env, ({ userKey, notification }) => {
    if (userKey !== key || (notification.module !== HOST_SOURCE && !modules.enabled(notification.module))) return;
    sseWrite(res, `event: notification\ndata: ${JSON.stringify({ ...notification, ...sourceOf(notification.module) })}\n\n`);
  });
  moduleHooks.on('notification', onNote);
  const onInvite = listenIn(env, (invite) => {
    if (invite.to !== key || Date.now() - invite.at > INVITE_MS) return;
    sseWrite(res, `event: invite\ndata: ${JSON.stringify({ id: invite.id, spaceId: invite.spaceId, fromName: invite.fromName })}\n\n`);
  });
  inviteEvents.on('invite', onInvite);
  // GitHub #62: the owner's theme changed (everyone re-fetches /theme.css), or this person picked light or dark on
  // another page or device (this page sets <html data-theme-mode> to match).
  const onTheme = listenIn(env, (t) => sseWrite(res, `event: theme\ndata: ${JSON.stringify(t)}\n\n`));
  const onMode = listenIn(env, ({ userKey, themeMode }) => { if (userKey === key) sseWrite(res, `event: mode\ndata: ${JSON.stringify({ themeMode })}\n\n`); });
  themeEvents.on('theme', onTheme);
  themeEvents.on('mode', onMode);
  // The module list changed: a bare event; the page asks again for the modules this person may use here.
  const onModules = listenIn(env, () => sseWrite(res, `event: modules\ndata: {}\n\n`));
  moduleEvents.on('modules', onModules);
  const beat = setInterval(() => sseWrite(res, ': ping\n\n'), 25000);
  req.on('close', () => envContext.run(env, () => {
    clearInterval(beat);
    moduleHooks.off('notification', onNote);
    inviteEvents.off('invite', onInvite);
    themeEvents.off('theme', onTheme);
    themeEvents.off('mode', onMode);
    moduleEvents.off('modules', onModules);
  }));
});

// One live stream for every module on a page. A browser allows only a handful of long-lived
// connections to one site (six over HTTP/1.1), and a stream per module (two for a space's panel) used
// up all of them with three modules open, so nothing else could load. This carries every module's
// changes and fired schedules, each labelled with its module and where it happened, and filtered
// to what the viewer may read:
//   with ?space=<id>   scope 'space' (that space) and 'environment'   -- a space's panes
//   without a space    scope 'environment' and 'spaces' (the viewer's own spaces) -- a module's environment page
// ?space=<id>&page=1 carries both on one connection (the space page, whose Home dashboard reads the second while its
// canvas reads the first; health audit MP-01): each event of the second view says so with `"view": "page"`, and the
// same change may then come once for each view. `page` without a space changes nothing.
// Every event has an `id:` line, the same on every stream for the same thing that happened (eventIdOf), so a page that
// moves from one stream to another (public/module-stream.js) hears each thing once while both are open. The id starts
// with this start's own token, so ids after a restart never match ones a page remembers from before it.
const streamEventIds = new WeakMap(); // what happened (the object its emitter sent) -> its id
const streamEventStart = crypto.randomBytes(4).toString('hex');
let lastStreamEventId = 0;
function eventIdOf(happened) {
  if (!happened || typeof happened !== 'object') return `${streamEventStart}.${++lastStreamEventId}`;
  let id = streamEventIds.get(happened);
  if (!id) {
    id = `${streamEventStart}.${++lastStreamEventId}`;
    streamEventIds.set(happened, id);
  }
  return id;
}
// A batch's changes as the stream sends them to a viewer who has nothing hidden: written out once per batch.
const batchTexts = new WeakMap();
function changesText(batch) {
  let text = batchTexts.get(batch);
  if (text === undefined) {
    text = JSON.stringify(batch.changes.map((c) => ({ key: c.key, ...('value' in c ? { value: c.value } : {}), version: c.version, deleted: c.deleted, by: c.by })));
    batchTexts.set(batch, text);
  }
  return text;
}
// A viewer's permissions in a space (or none), worked out once per person for everything done in the same turn of the event
// loop, by every open stream together: a big Clear or Undo asks for them for each stream and each kind, and they cannot change
// in between. Dropped at the end of the turn.
const permsTurns = new Map(); // environment -> "user|space" -> permissions
// What a library change (vault-store's tell) is to one viewer, by whether they could see the file before it and can see it
// after (fileVisible, plan-vault-privacy.md): its own op when both, 'removed' when they lose sight of it, 'added' when they
// gain it, and null -- nothing is sent -- when they could see it neither before nor after, so nobody hears of a hidden
// file's id, its arrival or its change.
function libraryOpFor(who, c) {
  const sight = c.sight || {};
  const sees = fileSight(who, c.spaceId, c.module);
  const before = Boolean(sight.before) && sees(sight.before);
  const after = Boolean(sight.after) && sees(sight.after);
  if (before && after) return c.op;
  if (before) return 'removed';
  if (after) return 'added';
  return null;
}
function permsThisTurn(env, who, spaceId) {
  let turn = permsTurns.get(env);
  if (!turn) {
    turn = new Map();
    permsTurns.set(env, turn);
    queueMicrotask(() => permsTurns.delete(env));
  }
  const k = `${who.user ? who.user.key : '-'}|${spaceId || ''}`;
  if (!turn.has(k)) turn.set(k, modulePerms(who, spaceId));
  return turn.get(k);
}
app.get('/api/modules/stream', (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  const who = moduleViewer(req);
  if (!who || who.keyed) return res.status(401).json({ error: 'sign in first' }); // the access key opens only a module's keyed page
  const space = req.query.space ? store.spaceById(String(req.query.space)) : null;
  if (req.query.space && !space) return res.status(404).json({ error: `no such ${word('space')}` });
  // The views this connection carries: the space's (or, without a space, the page's), and with page=1 the page's too.
  const views = [{ space, view: null }];
  if (space && req.query.page === '1') views.push({ space: null, view: 'page' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  sseWrite(res, 'retry: 3000\n\n');
  const send = (v, type, happened, data) => sseWrite(res, `id: ${eventIdOf(happened)}\nevent: ${type}\ndata: ${JSON.stringify(v.view ? { ...data, view: v.view } : data)}\n\n`);
  const permsHere = (spaceId) => permsThisTurn(env, who, spaceId);
  // Where a change belongs for this viewer in view `v`, or null if they may not see it there.
  const place = (v, moduleId, scopeKey, known = null) => {
    const found = known || modules.enabled(moduleId);
    if (!found) return null;
    const { manifest, entry } = found;
    if (scopeKey === 'environment') {
      return who.user && moduleCan(manifest, permsHere(null), 'read') ? { scope: 'environment', spaceId: null } : null;
    }
    if (scopeKey.startsWith('person:')) {
      // Someone's own data: told only to that person, on whatever page of theirs shows the module.
      return who.user && scopeKey === `person:${who.user.key}` && moduleCan(manifest, permsHere(null), 'read') ? { scope: 'person', spaceId: null } : null;
    }
    if (!scopeKey.startsWith('space:')) return null;
    const r = store.spaceById(scopeKey.slice(6));
    if (!r) return null;
    if (v.space) {
      return r.id === v.space.id && moduleSpaceAccess(entry, who, r) && moduleCan(manifest, permsHere(r.id), 'read') ? { scope: 'space', spaceId: r.id } : null;
    }
    const mine = who.user && r.members.includes(who.user.key) && modules.isOnIn(entry.id, r.id);
    return mine && moduleCan(manifest, permsHere(r.id), 'read') ? { scope: 'spaces', spaceId: r.id } : null;
  };
  const onChange = listenIn(env, (change) => {
    for (const v of views) {
      const at = place(v, change.module, change.scopeKey);
      if (!at) continue;
      // What a guest may not receive goes from the value (hiddenFor); a guest only ever hears their own space.
      const changed = modules.enabled(change.module)?.manifest;
      if (changed && shutFromGuests(who, changed, at.spaceId)) continue;
      const hide = at.spaceId && changed ? hiddenFor(who, changed, at.spaceId) : [];
      send(v, 'change', change, { ...hideItem(change, hide), ...at });
    }
  });
  // Many keys at once (a Clear, its Undo: moduleData.removeAll, restoreMany): one 'changes' event, so a page draws once.
  const onChanges = listenIn(env, (batch) => {
    for (const v of views) {
      const at = place(v, batch.module, batch.scopeKey);
      if (!at) continue;
      const changed = modules.enabled(batch.module)?.manifest;
      if (changed && shutFromGuests(who, changed, at.spaceId)) continue;
      const hide = at.spaceId && changed ? hiddenFor(who, changed, at.spaceId) : [];
      // A big batch comes without values (`reload: true`, server/module-data.js emitBatch): the page reads the data again.
      const head = { module: batch.module, by: batch.by, ...(batch.cleared ? { cleared: true } : {}), ...(batch.restored ? { restored: true } : {}), ...(batch.reload ? { reload: true } : {}) };
      if (!hide.length) {
        // Nothing hidden from this viewer: the batch's changes are written out once and shared by every stream that hears it.
        const text = changesText(batch);
        const body = JSON.stringify(v.view ? { ...head, changes: 0, ...at, view: v.view } : { ...head, changes: 0, ...at }).replace('"changes":0', () => `"changes":${text}`);
        sseWrite(res, `id: ${eventIdOf(batch)}\nevent: changes\ndata: ${body}\n\n`);
        continue;
      }
      send(v, 'changes', batch, { ...head, changes: batch.changes.map((c) => { const h = hideItem(c, hide); return { key: h.key, ...('value' in h ? { value: h.value } : {}), version: h.version, deleted: h.deleted, by: h.by }; }), ...at });
    }
  });
  const onFire = listenIn(env, (fire) => {
    for (const v of views) {
      const at = place(v, fire.module, fire.scopeKey);
      if (at && at.scope !== 'spaces') send(v, 'schedule', fire, { module: fire.module, key: fire.key, payload: fire.payload, ...at });
    }
  });
  // What points at (or from) an item changed: only the pointers go, and the module asks again for what it may see.
  const onLinks = listenIn(env, ({ refs, file }) => {
    // A removed file's links: told only to a viewer who could see that file (plan-vault-privacy.md).
    if (file && !fileVisible(who, file.spaceId, file.module, file.record)) return;
    // A pointer to a library file goes only to a viewer who can see that file as it is now (plan-vault-privacy.md); the
    // holder's own pointer goes as before.
    for (const ref of refs) {
      // (A removed file's own pointer was checked against its last record above.)
      const removed = file && ref.module === file.module && ref.space === file.spaceId && ref.id === file.record.id;
      if (!removed && isLibraryFileRef(ref) && !refFileSeen(who, ref, false)) continue;
      for (const v of views) {
        const at = place(v, ref.module, refScopeKey(ref));
        if (at) send(v, 'links', ref, { module: ref.module, ref, ...at });
      }
    }
  });
  // A module said something happened: sent to every module here that may hear it (the host delivers it to those frames).
  const onBus = listenIn(env, (ev) => {
    for (const v of views) {
      const at = place(v, ev.module, ev.scopeKey);
      if (!at) continue;
      const subscribers = modules.enabledAll().filter((m) => m.manifest.id !== ev.module && mayHear(m, ev.module, ev.name) && place(v, m.manifest.id, ev.scopeKey)).map((m) => m.manifest.id);
      if (subscribers.length) send(v, 'bus', ev, { ...publicEvent(ev), scope: at.scope, subscribers });
    }
  });
  // A request for a module to do something: the providing module's frames are told; one claims it.
  const onAction = listenIn(env, (r) => {
    if ((r.local || r.askerOnly) && r.by !== (who.user?.key || 'guest')) return; // a view, or what is the asker's, is for the person who asked
    for (const v of views) {
      const at = place(v, r.provider, r.scopeKey);
      if (at) send(v, 'action', r, { ...publicAction(r), provider: r.provider, scope: at.scope });
    }
  });
  // A setting of a module changed: its pages here read their values again.
  // The person's other calendars changed on a read (plan-google-calendar.md, Part 2): only their own streams hear it,
  // naming the modules with the approved `external` hook, which ask again for what they show.
  if (who.user) externalCalendars.noteSeen(who.user.key);
  const onExternal = listenIn(env, (seen) => {
    if (!who.user || seen.userKey !== who.user.key || !store.otherCalendarsOn()) return;
    const hearing = externalModules().map(({ manifest }) => manifest.id);
    if (hearing.length) for (const v of views) send(v, 'external', seen, { modules: hearing });
  });
  externalCalendars.on('change', onExternal);
  const onSettings = listenIn(env, (c) => {
    if (c.scope === 'person' && c.userKey !== who.user?.key) return;
    for (const v of views) {
      // A space's setting goes only to a view that may read that module there (the same rule as its data's changes), so
      // opening another space's stream as a non-member or another space's guest tells nothing of it.
      if (c.scope === 'space' && !place(v, c.module, `space:${c.spaceId}`)) continue;
      send(v, 'settings', c, { module: c.module, scope: c.scope, spaceId: c.spaceId });
    }
  });
  moduleSettings.on('change', onSettings);
  // An object of a marker kind was written or deleted where this viewer reads it (plan-calendar-markers.md): the
  // modules here approved to show that kind, and on and readable there, are named, and ask again. No object data goes.
  // A space's page hears its space only; a page without a space hears the environment and the viewer's own spaces.
  const onMarkers = listenIn(env, (change, known) => {
    if (!change.scopeKey.startsWith('space:') && change.scopeKey !== 'environment') return;
    const kind = known ? known.kind : markerKindAt(change.module, change.key);
    if (!kind) return;
    const consumers = known ? known.consumers : markerConsumers(change, kind);
    for (const v of views) {
      const at = place(v, change.module, change.scopeKey);
      if (!at || (v.space && at.scope !== 'space')) continue;
      const hearing = consumers.filter((m) => place(v, m.manifest.id, change.scopeKey, m)).map((m) => m.manifest.id);
      if (hearing.length) send(v, 'markers', change, { modules: hearing });
    }
  });
  // A batch tells the marker modules once per kind it touched.
  const onMarkersBatch = (batch) => {
    for (const known of markersOfBatch(batch).values()) onMarkers(known.change, known);
  };
  moduleData.on('change', onMarkers);
  moduleData.on('change', onChange);
  moduleData.on('changes', onMarkersBatch);
  moduleData.on('changes', onChanges);
  moduleHooks.on('fire', onFire);
  // A linked object changed: only the modules that point at it are told, and only a viewer who may see that module here.
  const onRefChange = listenIn(env, (ev) => {
    for (const v of views) {
      const hearing = [];
      for (const holder of ev.holders) {
        const at = place(v, holder.module, refScopeKey(holder));
        if (at && !hearing.includes(holder.module)) hearing.push(holder.module);
      }
      if (hearing.length) send(v, 'refchange', ev, { ref: ev.ref, change: ev.change, modules: hearing });
    }
  });
  // A library's file was added, renamed, removed or given a thumbnail (plan-attachments-vault.md, step 4): told to the viewers who
  // may read that library in that space, and to the modules there that are the library or approved to link to its files, which
  // look again. Only ids and the kind of change go: no name, since a file's name is for those who may read the library.
  const onLibrary = listenIn(env, (c) => {
    if (!who.user) return;
    const op = libraryOpFor(who, c);
    if (!op) return;
    const scopeKey = `space:${c.spaceId}`;
    for (const v of views) {
      const at = place(v, c.module, scopeKey);
      if (!at) continue;
      const hearing = [c.module, ...modules.enabledAll().filter((m) => m.manifest.id !== c.module && consumerMayLink(m, c.module, 'file') && place(v, m.manifest.id, scopeKey)).map((m) => m.manifest.id)];
      send(v, 'library', c, { module: c.module, spaceId: c.spaceId, op, id: c.id, modules: hearing, scope: at.scope });
    }
  });
  vault.on('change', onLibrary);
  moduleLinks.on('change', onLinks);
  const stopRefChange = objectSync.listen(env, onRefChange); // this environment's links only: the bus is shared on a hosted server
  moduleBus.on('event', onBus);
  moduleBus.on('action', onAction);
  const beat = setInterval(() => sseWrite(res, ': ping\n\n'), 25000);
  req.on('close', () => envContext.run(env, () => {
    clearInterval(beat);
    moduleSettings.off('change', onSettings);
    moduleData.off('change', onMarkers);
    moduleData.off('change', onChange);
    moduleData.off('changes', onMarkersBatch);
    moduleData.off('changes', onChanges);
    moduleHooks.off('fire', onFire);
    vault.off('change', onLibrary);
    moduleLinks.off('change', onLinks);
    stopRefChange();
    moduleBus.off('event', onBus);
    moduleBus.off('action', onAction);
    externalCalendars.off('change', onExternal);
  }));
});

app.get('/api/modules/:id/events', (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  // scope=spaces: changes in any of the viewer's spaces (a module's page showing them all).
  const all = req.query.scope === 'spaces' ? moduleSpacesFor(req, res) : null;
  if (req.query.scope === 'spaces' && !all) return;
  const ctx = all ? { manifest: all.manifest, scopeKey: null } : moduleAccess(req, res, 'read');
  if (!ctx) return;
  const spaceIds = all ? new Set(all.spaces.map((r) => r.id)) : null;
  const viewer = ctx.who || moduleViewer(req); // who is listening, for which library files they may hear of
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  sseWrite(res, 'retry: 3000\n\n');
  const onChange = listenIn(env, (change) => {
    if (change.module !== ctx.manifest.id) return;
    if (spaceIds) {
      const spaceId = change.scopeKey.startsWith('space:') ? change.scopeKey.slice(6) : null;
      if (!spaceIds.has(spaceId)) return;
      return void sseWrite(res, `event: change\ndata: ${JSON.stringify({ ...change, spaceId })}\n\n`);
    }
    if (change.scopeKey !== ctx.scopeKey) return;
    sseWrite(res, `event: change\ndata: ${JSON.stringify(hideItem(change, ctx.hide))}\n\n`);
  });
  const onChanges = listenIn(env, (batch) => {
    if (batch.module !== ctx.manifest.id) return;
    if (spaceIds) {
      const spaceId = batch.scopeKey.startsWith('space:') ? batch.scopeKey.slice(6) : null;
      if (!spaceIds.has(spaceId)) return;
      return void sseWrite(res, `event: changes\ndata: ${JSON.stringify({ ...batch, spaceId })}\n\n`);
    }
    if (batch.scopeKey !== ctx.scopeKey) return;
    sseWrite(res, `event: changes\ndata: ${JSON.stringify({ ...batch, changes: batch.changes.map((c) => hideItem(c, ctx.hide)) })}\n\n`);
  });
  const onFire = listenIn(env, (fire) => {
    if (spaceIds || fire.module !== ctx.manifest.id || fire.scopeKey !== ctx.scopeKey) return;
    sseWrite(res, `event: schedule\ndata: ${JSON.stringify({ key: fire.key, payload: fire.payload })}\n\n`);
  });
  // A library module's page hears its own space's files change (the same event the shared stream carries).
  const onLibrary = listenIn(env, (c) => {
    if (c.module !== ctx.manifest.id || (ctx.who && !ctx.who.user)) return;
    if (spaceIds ? !spaceIds.has(c.spaceId) : `space:${c.spaceId}` !== ctx.scopeKey) return;
    const op = libraryOpFor(viewer, c);
    if (!op) return;
    sseWrite(res, `event: library\ndata: ${JSON.stringify({ module: c.module, spaceId: c.spaceId, op, id: c.id })}\n\n`);
  });
  moduleData.on('change', onChange);
  moduleData.on('changes', onChanges);
  moduleHooks.on('fire', onFire);
  if (ctx.manifest.library) vault.on('change', onLibrary);
  const beat = setInterval(() => sseWrite(res, ': ping\n\n'), 25000);
  req.on('close', () => envContext.run(env, () => {
    clearInterval(beat);
    moduleData.off('change', onChange);
    moduleData.off('changes', onChanges);
    moduleHooks.off('fire', onFire);
    vault.off('change', onLibrary);
  }));
});

app.get('/api/roles', requireOwner, (_req, res) => res.json({ permissions: store.allPermissions(), roles: store.roles() }));
app.patch('/api/roles/:role', requireOwner, (req, res) => res.json({ roles: store.setRolePermissions(req.params.role, req.body || {}) }));

// The currencies the server takes (see server/currencies.js): what a currency picker offers, in Manage or a module.
// Codes only; the page names them in the viewer's language. Anyone signed in; nothing in it is private.
app.get('/api/currencies', requireUser, (_req, res) => res.json({ currencies: currencyCodes(store.settings.currency) }));
// For the owner, beside branding()'s resolved `words`: `ownWords`, the owner's own words as stored, so Manage can tell
// an owner's word from the template's or the default.
// `template`: the template the environment was made from and what was skipped (templateView), or null; `ownHomeIcon` the
// owner's own home icon (null: the template's or the default).
// `templateWords` and `templateHomeIcon`: the template's own (null for none), whatever the owner has set over them;
// `spaceDefaults`: what a new space starts with ({ profile?, opensWith? }, or null for the built-in default).
// `ownVerbs` and `templateVerbs` (addendum 4): the same for the verbs beside branding()'s resolved `verbs`.
// `showCalendar` and `showMap`: the top bar's Calendar and Map (plan-calendar-destination.md, plan-map-destination.md),
// off unless an owner or a template turned them on. `calendarFeeds`, `otherCalendars` and `publishedCalendar`: Calendar
// sharing's three switches (plan-space-calendars.md, decision 7); `otherCalendars` as it reads (store.otherCalendarsOn:
// calendarFeeds until an owner sets it); `publishedCalendarFeed`: { on, made, readAt }, the published calendar's one
// address as it stands (plan-space-calendars.md, section 2), never its hash. `topBarReasons`: { calendar, map }, why
// each cannot show whatever its switch (one sentence), or null.
const ownerSettings = () => ({ ...branding(), ownWords: store.ownWords(), ownVerbs: store.ownVerbs(), templateVerbs: store.templateVerbsView(), ownHomeIcon: store.settings.homeIcon || null, template: templateView(store, currentEnvironment()), templateWords: store.templateWordsView(), templateHomeIcon: store.templateHomeIcon || null, spaceDefaults: store.settings.spaceDefaults || null, showCalendar: store.settings.showCalendar === true, showMap: store.settings.showMap === true, calendarFeeds: store.settings.calendarFeeds === true, otherCalendars: store.otherCalendarsOn(), publishedCalendar: store.settings.publishedCalendar === true, publishedCalendarFeed: feedView(store.publishedCalendarFeed), topBarReasons: destinationReasons() });
app.get('/api/settings', requireOwner, (_req, res) => res.json({ settings: ownerSettings(), streamKey: store.streamKey }));
// `template` ("none" for none) switches the environment's template (the switching addendum): taken out of the body
// before the settings; an unknown one refuses the whole change. With it, the answer also carries `template` and `offer`.
app.patch('/api/settings', requireOwner, async (req, res) => {
  const { template, ...rest } = req.body || {};
  // The Conference can't be switched on without a call service (its card says so); switching it off, or sending it
  // as it already is, goes through.
  if (rest.conferenceEnabled === true && store.settings.conferenceEnabled === false && !HAS_CALL_SERVICE) return res.status(503).json({ error: NO_CALL_SERVICE });
  if (template !== undefined) {
    const problem = templateSwitchProblem(currentEnvironment(), template);
    if (problem) return res.status(400).json({ error: problem });
  }
  if (template === undefined || Object.keys(rest).length) watchTheme(() => store.updateSettings(rest));
  if (template === undefined) return res.json({ settings: ownerSettings() });
  const env = currentEnvironment();
  await switchTemplate(env, env.slug, template, currentUser(req).key);
  res.json({ settings: ownerSettings(), ...templateAnswer(env, env.slug) });
});

// The Template tab (addendum 2): what the environment was made from (name, source, version), the version applied, what
// was left out, the open offer if any, and the templates it could switch to. Hosted and single installs alike.
app.get('/api/environment/template', requireOwner, (req, res) => {
  const env = currentEnvironment();
  res.json({
    ...templateAnswer(env, env.slug),
    choices: templateChoices(env, env.store.templateRecord?.id),
  });
});

// A single install's own templates (addendum 2): imported from files, exported (any it can see, bundled included), and
// an imported one deleted once this environment no longer uses it. On a hosted server the host manages templates.
const HOST_MANAGES_TEMPLATES = 'On a hosted server, the host manages templates.';
app.post('/api/templates/import', requireOwner, sameOriginOnly, templateFileText, (req, res) => {
  if (BASE_DOMAIN) return res.status(403).json({ error: HOST_MANAGES_TEMPLATES });
  const env = currentEnvironment();
  const read = readTemplateUpload(req, env);
  if (read.error) return res.status(read.status).json(read.error);
  env.store.putImportedTemplate({ ...read.raw, version: Number.isInteger(read.raw.version) ? read.raw.version : 1, importedAt: new Date().toISOString() });
  res.status(201).json({ template: fullTemplate(templateFor(env, read.raw.id)), dropped: read.dropped });
});
// On a hosted server an owner may export only their environment's own template (read-only); import and delete stay
// the host's.
app.get('/api/templates/:id/export', requireOwner, (req, res) => {
  const env = currentEnvironment();
  if (BASE_DOMAIN && env.store.templateRecord?.id !== req.params.id) return res.status(403).json({ error: HOST_MANAGES_TEMPLATES });
  sendTemplateFile(res, templateFor(env, req.params.id), req.params.id);
});
app.delete('/api/templates/:id', requireOwner, (req, res) => {
  if (BASE_DOMAIN) return res.status(403).json({ error: HOST_MANAGES_TEMPLATES });
  const env = currentEnvironment();
  const t = templateFor(env, req.params.id);
  if (!t) return res.status(404).json({ error: `There is no template called ${req.params.id.slice(0, 40)}.` });
  if (t.source === 'bundled') return res.status(403).json({ error: "Bundled templates can't be deleted." });
  if (env.store.templateRecord?.id === t.id) return res.status(409).json({ error: `This ${word('environment')} uses this template. Switch to another one first.` });
  env.store.removeImportedTemplate(t.id);
  res.json({ ok: true });
});
// Confirms the open offer: { modules: [ids], lobby: boolean, spaceDefaults: boolean }; 409 with no template or one
// already applied.
app.post('/api/environment/template/apply', requireOwner, async (req, res) => {
  const env = currentEnvironment();
  res.json(await applyTemplateOffer(env, env.slug, req.body));
});

// This environment's own view of itself: its plan and how it stands against each cap (plan-environments.md, "Phase
// 2: the owner role and the split"). Only with a base domain -- a self-hosted install is on no host's plan,
// so it has no plan or usage of its own to show.
app.get('/api/environment', requireOwner, async (req, res) => {
  if (!BASE_DOMAIN) return res.status(404).json({ error: 'not hosted' });
  const env = currentEnvironment();
  const environment = hostRegistry.findEnvironment(env.slug);
  if (!environment) return res.status(404).json({ error: 'not hosted' }); // defensive: every resolved environment has a registry entry
  res.json({
    slug: environment.slug,
    name: environment.name,
    baseDomain: BASE_DOMAIN,
    status: environment.status,
    pastDueSince: environment.pastDueSince,
    graceEndsAt: environment.pastDueSince ? new Date(new Date(environment.pastDueSince).getTime() + 14 * 86400000).toISOString() : null,
    deleteRequestedAt: environment.deleteRequestedAt,
    deleteRequestReason: environment.deleteRequestReason,
    // The template it was made from, with what was skipped (templateView), or null: for the Environment panel.
    template: templateView(store, currentEnvironment()),
    plan: { name: environment.plan.name || null, modules: environment.plan.modules, members: environment.plan.members, storageBytes: environment.plan.storageBytes, aiCallsPerMonth: environment.plan.aiCallsPerMonth, calls: environment.plan.calls },
    usage: {
      members: store.users.length,
      storageBytes: environmentStorageBytes(env.slug, env.dataDir),
      aiCallsThisMonth: hostRegistry.aiCallsThisMonth(env.slug),
      callsNow: await liveCallCount(),
    },
  });
});
// The environment's own copy of its data (plan-environments.md, "Phase 2": Download a copy): the host console's backup
// built from allow-lists, so no sign-in secret, link, sealed value or other person's private chat is in it
// (server/environment-export.js says what goes in); an owner may ask for it.
app.get('/api/environment/export', requireOwner, (req, res) => {
  if (!BASE_DOMAIN) return res.status(404).json({ error: 'not hosted' });
  const env = currentEnvironment();
  flushEnvironment(env); // every debounced write on disk before it is zipped
  // The folders each installed module declares for the files an owner places (its manifest's file settings).
  const declared = (id) => {
    try {
      const manifest = env.modules.manifestOf(id, env.modules.get(id).version);
      return (manifest?.settings || []).filter((d) => d.type === 'file' || d.type === 'files').map((d) => d.folder);
    } catch { return []; }
  };
  const zip = zipFiles(exportEntries(fs.existsSync(env.dataDir) ? walkFiles(env.dataDir) : [], env.store.data, { declared }));
  // Personal data: never kept by a browser or a proxy on the way.
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${env.slug}-export.zip"`, 'Cache-Control': 'private, no-store' });
  res.send(zip);
});
// Asked for by the environment's own admin, carried out by a host admin on the console (the existing Delete) --
// never by itself. DELETE withdraws the request.
app.post('/api/environment/delete-request', requireOwner, (req, res) => {
  if (!BASE_DOMAIN) return res.status(404).json({ error: 'not hosted' });
  try {
    res.json(hostRegistry.requestEnvironmentDeletion(currentEnvironment().slug, req.body?.reason));
  } catch (err) {
    sendHostError(err, res);
  }
});
app.delete('/api/environment/delete-request', requireOwner, (req, res) => {
  if (!BASE_DOMAIN) return res.status(404).json({ error: 'not hosted' });
  try {
    hostRegistry.withdrawEnvironmentDeletion(currentEnvironment().slug);
    res.json({ ok: true });
  } catch (err) {
    sendHostError(err, res);
  }
});
// Saved themes: named sets of the same seven colors /theme.css can render --
// switching just repoints activeThemeId (see PATCH /api/settings above),
// no re-picking needed. See store.js's "themes" section for the shape.
app.get('/api/themes', requireOwner, (_req, res) => res.json({ themes: store.themes, defaultTheme: store.defaultTheme, activeThemeId: store.settings.activeThemeId || null, themeMode: store.settings.themeMode }));
app.post('/api/themes', requireOwner, (req, res) => res.json({ theme: store.addTheme(req.body || {}) }));
app.patch('/api/themes/:id', requireOwner, (req, res) => res.json({ theme: watchTheme(() => store.updateTheme(req.params.id, req.body || {})) }));
app.delete('/api/themes/:id', requireOwner, (req, res) => {
  watchTheme(() => store.removeTheme(req.params.id));
  res.json({ ok: true });
});
// A theme as a file (documentation/plans/plan-themes.md; server/theme-file.js). Export: any theme, or `default` for
// Strong Coffee with its dark palette written out, as a download. Import: the file's JSON as the body (sent as JSON,
// or as the file's own text with any other type), checked and added as a new theme -- never applied.
app.get('/api/themes/:id/export', requireOwner, (req, res) => {
  const theme = req.params.id === 'default' ? null : store.themes.find((t) => t.id === req.params.id);
  if (theme === undefined) return res.status(404).json({ error: 'no such theme' });
  const file = themeFile.themeToFile(theme);
  res.set('Content-Disposition', `attachment; filename="${themeFile.themeFileName(file.name)}"`);
  res.type('application/json').send(`${JSON.stringify(file, null, 2)}\n`);
});
// Any body type is read here, so sameOriginOnly (see "the app", above) is named on the route as well as run for every
// write: this route must never lose it.
app.post('/api/themes/import', requireOwner, sameOriginOnly, themeFileText, (req, res) => {
  try {
    const given = typeof req.body === 'string' ? req.body : req.body === undefined ? '' : req.body;
    const read = themeFile.readThemeFile(given, (t) => store.sanitizeTheme(t), { byteLength: req.rawBody ? req.rawBody.length : null });
    const { dropped, ...fields } = read;
    res.json({ theme: store.importTheme(fields), dropped });
  } catch (err) {
    if (err instanceof themeFile.ThemeFileError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});
// Site images: icon, background.
const siteImage = (req, res, next) => (req.params.image === 'icon' || req.params.image === 'background' ? next() : res.status(404).json({ error: 'unknown image' }));
app.put('/api/settings/:image', requireOwner, siteImage, rawImage, checkStorageCap, (req, res) => {
  store.setSiteImage(req.params.image, req.body, req.get('content-type'));
  res.json({ settings: branding() });
});
app.delete('/api/settings/:image', requireOwner, siteImage, (req, res) => {
  store.removeSiteImage(req.params.image);
  res.json({ settings: branding() });
});
// Shared by both the guest and the default Participant picture sets below.
const participantImageSlot = (req, res, next) => (PARTICIPANT_SLOTS.includes(req.params.slot) ? next() : res.status(404).json({ error: 'unknown image slot' }));
app.put('/api/settings/guest-images/:slot', requireOwner, participantImageSlot, rawImage, checkStorageCap, (req, res) => {
  store.setGuestImage(req.params.slot, req.body, req.get('content-type'));
  res.json({ ok: true });
});
app.delete('/api/settings/guest-images/:slot', requireOwner, participantImageSlot, (req, res) => {
  store.removeGuestImage(req.params.slot);
  res.json({ ok: true });
});
// The server-wide Default Images set (see /img/default/:slot above).
app.put('/api/settings/default-images/:slot', requireOwner, participantImageSlot, rawImage, checkStorageCap, (req, res) => {
  store.setDefaultImage(req.params.slot, req.body, req.get('content-type'));
  res.json({ ok: true });
});
app.delete('/api/settings/default-images/:slot', requireOwner, participantImageSlot, (req, res) => {
  store.removeDefaultImage(req.params.slot);
  res.json({ ok: true });
});
app.post('/api/stream-key/regenerate', requireOwner, (_req, res) => {
  res.json({ streamKey: store.regenerateStreamKey() });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// A module's keyed page: what /view/<key> used to be, generalized so any bundled module can claim a path
// (surfaces.keyed.path) instead of the host hard-coding one -- the Stream module claims "view" (see
// plan-stream-module.md), so /view/<key> answers exactly as it always did, now served by that module. Registered
// last, right before the error handler, so nothing earlier and more specific is ever shadowed. A path nothing
// has ever claimed, installed or bundled, falls through to the ordinary 404 rather than this route claiming it.
app.get('/:path/:key', (req, res, next) => {
  if (!/^[a-z0-9-]{2,20}$/.test(req.params.path)) return next();
  const bundled = () => bundledModules(BUNDLED_DIR).find((m) => m.surfaces?.keyed?.path === req.params.path);
  const claimant = modules.keyedClaimant(req.params.path) || bundled();
  if (!claimant) return next();
  if (!hasStreamAccess(req)) return res.status(403).send('This page needs the access key (?s=...).');
  const claimed = modules.keyedFor(req.params.path);
  if (!claimed) return res.status(404).send(`The ${shownModule(claimant).name} ${word('module')} serves this page and is not enabled.`);
  if (!store.userByKey(req.params.key)) return res.status(404).send('No such user.');
  res.sendFile(page('keyed.html'));
});

// Errors ---------------------------------------------------------------------

app.use((err, _req, res, _next) => {
  if (err instanceof StoreError) return res.status(err.status).json({ error: err.message });
  // An environment built after startup whose Names migration could not finish, or whose data is from a newer
  // the product (see server/migrate-names.js): that environment is refused until its data is seen to; the file and
  // the reason go to the log, never to the person asking.
  if (err instanceof MigrationError) {
    if (err.slug !== undefined) logRefusalOnce(err.slug); else console.error(err.message);
    const sentence = refusalSentence(err);
    // A browser asking for a page gets a plain page with the sentence; everything else the JSON answer.
    if (!_req.path.startsWith('/api/') && _req.accepts(['json', 'html']) === 'html') {
      return res.status(503).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeXml(PRODUCT_NAME)}</title></head><body style="font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 32rem; padding: 0 1rem;"><p>${sentence}</p></body></html>`);
    }
    return res.status(503).json({ error: sentence });
  }
  // A theme file too big, not JSON, or a body the parser can't read at all (an unknown charset or content-encoding,
  // bytes that don't unzip): the one sentence the import gives for anything that isn't a theme file.
  if (/^\/api\/(themes\/import|host\/themes\/check)$/.test(_req.path) && (typeof err.type === 'string' || (err.status >= 400 && err.status < 500))) {
    return res.status(400).json({ error: themeFile.NOT_A_THEME_FILE });
  }
  // The same for a template file (the host's import and a single install's).
  if (/^\/api\/(host\/)?templates\/import$/.test(_req.path) && (typeof err.type === 'string' || (err.status >= 400 && err.status < 500))) {
    return res.status(400).json({ error: templateFile.NOT_A_TEMPLATE_FILE });
  }
  if (err.type === 'entity.too.large') {
    if (/^\/api\/(modules\/[^/]+|spaces\/[^/]+)\/objects\/check$/.test(_req.path)) return res.status(413).json({ error: 'that is over 256 KB; bring it in in parts' });
    if (/^\/api\/modules\/[^/]+\/uploads/.test(_req.path)) return res.status(413).json({ error: 'that file is over the size limit' });
    if (/^\/api\/spaces\/[^/]+\/chat\/pictures$/.test(_req.path)) return res.status(413).json({ error: `that picture is over ${chatPictureMaxSaid}` });
    if (/^\/api\/(spaces\/[^/]+\/(action|command)|bus\/.+)$/.test(_req.path)) return res.status(413).json({ error: 'that request is over 64 KB' });
    // Any other JSON body (a space's PATCH, a module's settings) is a request over the JSON limit, not an image or a zip.
    if (_req.is('json')) return res.status(413).json({ error: `that request is over ${Math.round((Number(err.limit) || 65536) / 1024)} KB` });
    const limit = _req.path.startsWith('/api/modules') ? MODULE_LIMITS.zipBytes : MAX_IMAGE_BYTES;
    return res.status(413).json({ error: `${_req.path.startsWith('/api/modules') ? 'the zip' : 'image'} is larger than ${limit / (1024 * 1024)} MB` });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad JSON' });
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

// The grace: an environment pastDue for 14 days is degraded to the free plan once an hour, never deleted
// (plan-environments.md, "Phase 5"). Only with a base domain -- a self-hosted install has no environments to sweep.
// It also runs once at start, so a server restarted more often than hourly still sweeps.
function sweepStalePastDue() {
  try { hostRegistry.degradeStalePastDue(); } catch (e) { console.error('past-due sweep failed:', e.message); }
}
if (BASE_DOMAIN) {
  sweepStalePastDue();
  setInterval(sweepStalePastDue, 3600000);
}
// Other calendars (plan-google-calendar.md, Part 2): every five minutes, each environment reads again those of its
// calendars last tried 30 minutes ago or more, for people seen in the last 14 days, while the switch allows it.
setInterval(() => {
  for (const env of environments.values()) {
    try {
      envContext.run(env, () => { if (externalAllowed()) externalCalendars.refreshDue().catch(() => {}); });
    } catch (err) {
      console.error(`${env.slug ? `[${env.slug}] ` : ''}Reading other calendars failed: ${err.message}`);
    }
  }
}, 5 * 60 * 1000).unref();

// Regaining access (documentation/plans/plan-mfa.md, "Regaining access"): the lockout bypass excuses every
// admin from the code step and the enrol requirement for as long as it is set -- worth a loud warning on
// every start, the same way a server running with no LiveKit secret or an open registration would be.
if (adminMfaLockoutBypass) console.warn(`The lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is on: ${BASE_DOMAIN ? 'every owner and host admin' : "every owner and the server's admin"} skips two-step sign-in entirely. Turn it off once you are back in.`);

// The port it really listens on is logged, so PORT=0 (any free port, for a check) says which one it got.
// Express 5 hands a listen error (the port taken, no right to it) to this same callback, so it is told apart first.
const listener = app.listen(Number(PORT), (listenError) => {
  if (listenError) {
    const why = listenError.code === 'EADDRINUSE'
      ? `Port ${PORT} is already in use. Another copy of the server may still be running: close its window or stop it, then start this one again.\nTo find it: Windows \`netstat -ano | findstr :${PORT}\` then \`taskkill /PID <id> /F\`; Mac or Linux \`lsof -i :${PORT}\` then \`kill <id>\`.`
      : listenError.code === 'EACCES'
        ? `The server may not use port ${PORT}. Set PORT to a free port above 1024, then start it again.`
        : `The server could not listen on port ${PORT}: ${listenError.message}`;
    console.error(why);
    process.exit(1);
  }
  const port = listener.address().port;
  const fillTwins = () => {
    try {
      const n = objectSync.backfill();
      if (n) console.log(`Made ${n} dated twin${n === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error(err);
    }
  };
  if (!BASE_DOMAIN) {
    envContext.run(environmentFor(DEFAULT_SLUG), () => {
      fillTwins();
      console.log(`${store.settings.environmentName} ${VERSION} listening on :${port}, ${HAS_CALL_SERVICE ? `LiveKit at ${LIVEKIT_HOST}` : 'no LiveKit'}, data in ${DATA_DIR}`);
      // A module that takes a file the operator supplies: say where it looks and what it found, once.
      for (const m of modules.list()) for (const d of m.settings || []) if (d.type === 'file' || d.type === 'files') console.log(`${m.name}: looks for "${d.label}" in ${describeModuleFiles(m, d.folder)}`);
      if (fs.existsSync(path.join(DATA_DIR, 'module-files'))) console.warn(`Note: ${path.join(DATA_DIR, 'module-files')} is no longer used. A module's files belong in its own folder, DATA_DIR/modules/<module id>/<folder>/ (see the module's settings).`);
    });
    return;
  }
  console.log(`${PRODUCT_NAME} ${VERSION} listening on :${port}, ${HAS_CALL_SERVICE ? `LiveKit at ${LIVEKIT_HOST}` : 'no LiveKit'}, base domain ${BASE_DOMAIN}, ${environments.size} environment${environments.size === 1 ? '' : 's'}, host console at ${CONSOLE_HOST}, product pages at ${PRODUCT_HOST}`);
  // The developer's escape hatches for an environment's own AI address (server/ai-http.js, guardFrom): said out loud, since on
  // a real host they let any owner make this server call plain http or its own network.
  if (process.env.AI_ALLOW_HTTP === '1') console.warn('[ai] AI_ALLOW_HTTP=1: owners may point their AI service at a plain http address. Unset it on a real host.');
  if (process.env.AI_ALLOW_PRIVATE_ADDRESSES === '1') console.warn('[ai] AI_ALLOW_PRIVATE_ADDRESSES=1: owners may point their AI service at this server\'s own network. Unset it on a real host.');
  for (const env of environments.values()) envContext.run(env, fillTwins);
});
// A library file of 2 GB takes longer than Node's own five minutes for a whole request on most connections, so a request
// may take two hours to arrive. An upload slower than VAULT_MIN_KB_PER_SECOND is cut off by its own route
// (watchArrival); the headers still have to arrive within Node's own minute.
listener.requestTimeout = 2 * 60 * 60 * 1000;
