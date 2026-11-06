'use strict';

// An owner's copy of their environment (GET /api/environment/export): the environment's data folder, as the host
// console's backup zips it, less everything that lets someone sign in, open a link or read a sealed value. People,
// spaces, chat, module data and uploaded files stay. The host admin's backup (POST /api/host/environments/:slug/backup)
// is not filtered: it stays complete. What leaves the copy, and what a restore of it makes again:
//   app.json   secrets (session signing key and stream key: made again on load), invites (sign-up links), and on each
//              person passwordHash, linkToken (personal link), mfa (two-step secret, pending secret and recovery-code
//              hashes) and externalCalendars (addresses sealed with a key the copy does not carry); on each space
//              guestToken (guest link: a new one is made when asked for).
//   ai.json    key (sealed with the same key): emptied, so the AI service has to be given its key again.
//   secrets.key (the key a single install sealed with, kept after its move to a host), pre-names/ (copies of the data
//              from before the Names migration, which hold the same secrets), share links of a library module
//              (modules/<id>/library/*.shares.json: password hashes and link hashes) and any half-written *.tmp file
//              are left out whole.
// The zip's layout is otherwise the backup's, so the host console's restore reads it the same way.

const { ENVIRONMENT_COPY_DIR, LEGACY_ENVIRONMENT_RECORD } = require('./migrate-names');

const EXCLUDED_FILES = [
  (name) => name === 'secrets.key',
  (name) => name.startsWith(`${ENVIRONMENT_COPY_DIR}/`),
  (name) => /^modules\/[^/]+\/library\/[^/]+\.shares\.json$/.test(name),
  (name) => name.endsWith('.tmp'),
];
const APP_FILE = 'app.json';
const OLD_APP_FILE = LEGACY_ENVIRONMENT_RECORD; // never beside a loaded environment's app.json; left out so only app.json speaks
const AI_FILE = 'ai.json';

// app.json for the copy, from the live data: a deep copy with the fields above deleted. The live data is never changed.
function exportApp(data) {
  const app = JSON.parse(JSON.stringify(data || {}));
  delete app.secrets;
  delete app.invites;
  for (const u of Array.isArray(app.users) ? app.users : []) {
    if (!u || typeof u !== 'object') continue;
    delete u.passwordHash;
    delete u.linkToken;
    delete u.mfa;
    delete u.externalCalendars;
  }
  for (const s of Array.isArray(app.spaces) ? app.spaces : []) {
    if (s && typeof s === 'object') delete s.guestToken;
  }
  return app;
}

// ai.json for the copy: the same settings with the key emptied. A file that cannot be read is left out.
function exportAi(buffer) {
  let ai;
  try { ai = JSON.parse(Buffer.from(buffer).toString('utf8')); } catch { return null; }
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return null;
  if ('key' in ai) ai.key = '';
  return ai;
}

// The entries of an owner's copy, from the folder's files ([name, Buffer], as walkFiles gives them) and the live
// app.json data.
function exportEntries(files, appData) {
  const out = [];
  for (const [name, data] of files) {
    if (name === APP_FILE || name === OLD_APP_FILE) continue;
    if (EXCLUDED_FILES.some((left) => left(name))) continue;
    if (name === AI_FILE) {
      const ai = exportAi(data);
      if (ai) out.push([name, Buffer.from(`${JSON.stringify(ai, null, 2)}\n`)]);
      continue;
    }
    out.push([name, data]);
  }
  out.unshift([APP_FILE, Buffer.from(`${JSON.stringify(exportApp(appData), null, 2)}\n`)]);
  return out;
}

module.exports = { exportEntries, exportApp, exportAi };
