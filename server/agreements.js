// Agreements (documentation/plans/plan-access-bundle.md, step 1): the terms of service and the beta NDA a person agrees
// to before entering, once per person and per version of each text.
//
//   The texts    TERMS_FILE and NDA_FILE name two files on the server. Each is read once, at start (readTexts): UTF-8
//                text, plain or Markdown, at most 256 KB. A version is the first 16 hex characters of the text's
//                SHA-256, so changing a text asks everyone again. With neither set there is no agreement step.
//                A file that is set and cannot be used stops the start: a server meant to ask never starts not asking.
//   An account   holds `agreed: [{ doc, version, at }]` in the environment's app.json (cleanAgreed, Store#recordAgreement).
//   A guest      has no account: GuestAgreements keeps `{ guest, name, doc, version, at }` in the environment's own
//                agreements.json, added to only. Nothing writes to it until a guest session exists (the plan's step 4).
//
// The texts are the host's: one pair for every environment on the server. The records are each environment's own.
// Nothing here reads a request, and no path ever comes from one.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { word } = require('./words');

// The two texts, in the order a person reads them.
const DOCS = [
  { id: 'terms', variable: 'TERMS_FILE', title: 'Terms of service' },
  { id: 'nda', variable: 'NDA_FILE', title: 'Beta NDA' },
];
const DOC_IDS = DOCS.map((d) => d.id);
const MAX_TEXT_BYTES = 256 * 1024;
const VERSION_RE = /^[0-9a-f]{16}$/;
// The most an account's own list may hold (two entries a change of text; older ones go first), and the most guests'
// agreements one environment keeps: past it nobody new can be recorded, and nothing kept is dropped.
const MAX_ACCOUNT_RECORDS = 200;
const MAX_GUEST_RECORDS = 100000;
const GUEST_ID_RE = /^guest-[A-Za-z0-9_-]{4,40}$/;
const GUEST_NAME_MAX = 40;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const versionOf = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

// A text that is set and cannot be used: `message` is the one sentence the server says before it stops.
class AgreementTextError extends Error {}

// One text from its file, as people will read it: no byte order mark, line ends as \n. Throws AgreementTextError.
function readText(variable, file) {
  const stop = (why) => { throw new AgreementTextError(`${variable}=${file} ${why}. Fix the file, or remove ${variable} to ask nobody.`); };
  let stat;
  try { stat = fs.statSync(file); } catch { return stop('is not a file this server can read'); }
  if (!stat.isFile()) return stop('is not a file');
  if (stat.size > MAX_TEXT_BYTES) return stop(`is over ${MAX_TEXT_BYTES / 1024} KB`);
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { return stop('is not a file this server can read'); }
  if (bytes.length > MAX_TEXT_BYTES) return stop(`is over ${MAX_TEXT_BYTES / 1024} KB`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes); } catch { return stop('is not text (UTF-8)'); }
  text = text.replace(/\r\n?/g, '\n');
  if (text.includes('\u0000')) return stop('is not text (UTF-8)');
  if (!text.trim()) return stop('is empty');
  return text;
}

// The texts this server asks people to agree to, from the environment variables: { required, docs, versions }.
// docs: [{ id, title, version, text }], only the ones that are set, in DOCS' order. Throws AgreementTextError.
function readTexts(env = process.env) {
  const docs = [];
  for (const { id, variable, title } of DOCS) {
    const file = String(env[variable] || '').trim();
    if (!file) continue;
    const text = readText(variable, path.resolve(file));
    docs.push(Object.freeze({ id, title, version: versionOf(text), text }));
  }
  const versions = Object.freeze(Object.fromEntries(docs.map((d) => [d.id, d.version])));
  return Object.freeze({ required: docs.length > 0, docs: Object.freeze(docs), versions });
}

// An account's agreements as stored: [{ doc, version, at }], one per text and version, oldest first. Anything that is
// not one is dropped.
function cleanAgreed(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw) {
    if (!isObject(a) || !DOC_IDS.includes(a.doc) || typeof a.version !== 'string' || !VERSION_RE.test(a.version)) continue;
    if (typeof a.at !== 'string' || Number.isNaN(Date.parse(a.at))) continue;
    if (out.some((x) => x.doc === a.doc && x.version === a.version)) continue;
    out.push({ doc: a.doc, version: a.version, at: a.at });
  }
  return out.slice(-MAX_ACCOUNT_RECORDS);
}

// Whether a list of agreements ([{ doc, version }]) covers the current version of every text asked for.
function hasAgreed(agreed, docs) {
  const list = Array.isArray(agreed) ? agreed : [];
  return docs.every((d) => list.some((a) => isObject(a) && a.doc === d.id && a.version === d.version));
}

// Whether the versions a person sends ({ terms: "<version>", nda: "<version>" }) are exactly the current ones: every
// text asked for, each at its current version, and nothing else.
function versionsMatch(given, docs) {
  if (!isObject(given)) return false;
  const keys = Object.keys(given);
  return keys.length === docs.length && docs.every((d) => Object.prototype.hasOwnProperty.call(given, d.id) && given[d.id] === d.version);
}

// A guest's typed name as kept: one line, no control characters and none that hide or reorder text, at most 40
// characters as a person counts them. It is text and is kept as text: "<b>" stays "<b>" for a page to draw as text.
function cleanGuestName(value) {
  if (typeof value !== 'string') return '';
  const line = value.slice(0, 2000)
    .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
    .replace(/[\u200B-\u200F\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...line].slice(0, GUEST_NAME_MAX).join('').trim();
}

// A refusal to record a guest's agreement: one plain sentence and its status.
class AgreementError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Guests' agreements in one environment: <its data folder>/agreements.json, { "agreements": [{ guest, name, doc,
// version, at }] }, added to only and written whole each time (a temporary file, then a rename), private to the
// server's own user. A file that is there and cannot be read is never written over: it is set aside under another name,
// said once, and a new one begun.
class GuestAgreements {
  constructor(dir, { max = MAX_GUEST_RECORDS, log = console.warn } = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'agreements.json');
    this.max = max;
    this.log = log;
    this.records = [];
    this.seen = new Set();
    this.load();
  }

  load() {
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err; // there, and not readable: never treated as empty
    }
    let raw = null;
    try { raw = JSON.parse(text); } catch { raw = null; }
    if (!isObject(raw) || !Array.isArray(raw.agreements)) {
      const aside = path.join(this.dir, `agreements.unreadable-${Date.now()}.json`);
      fs.renameSync(this.file, aside);
      this.log(`${this.file} could not be read as agreements, so it was kept as ${aside} and a new one begun.`);
      return;
    }
    for (const a of raw.agreements) {
      const kept = cleanGuestRecord(a);
      if (!kept || this.seen.has(recordKey(kept))) continue;
      this.records.push(kept);
      this.seen.add(recordKey(kept));
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ agreements: this.records }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.file);
  }

  // Whether this guest has agreed to the current version of every text.
  has(guest, docs) {
    return typeof guest === 'string' && docs.every((d) => this.seen.has(recordKey({ guest, doc: d.id, version: d.version })));
  }

  // What one guest has agreed to, oldest first.
  of(guest) {
    return this.records.filter((a) => a.guest === guest).map((a) => ({ ...a }));
  }

  // Records that this guest, under this typed name, agrees to the current version of each text. One record per guest,
  // text and version: a second one for the same three adds nothing. Returns the records added. Throws AgreementError.
  record({ guest, name, docs, at = new Date().toISOString() }) {
    if (typeof guest !== 'string' || !GUEST_ID_RE.test(guest)) throw new AgreementError(`That is not ${word('guest', { a: true })}.`);
    const typed = cleanGuestName(name);
    if (!typed) throw new AgreementError('A name is required.');
    if (!Array.isArray(docs) || !docs.length) throw new AgreementError('There is nothing to agree to here.', 404);
    const fresh = [];
    for (const d of docs) {
      const kept = cleanGuestRecord({ guest, name: typed, doc: d.id, version: d.version, at });
      if (!kept) throw new AgreementError('That is not one of the texts.');
      if (!this.seen.has(recordKey(kept))) fresh.push(kept);
    }
    if (!fresh.length) return [];
    if (this.records.length + fresh.length > this.max) throw new AgreementError('The record of agreements is full, so nobody new can agree. Tell whoever runs this server.', 503);
    for (const a of fresh) {
      this.records.push(a);
      this.seen.add(recordKey(a));
    }
    try {
      this.save();
    } catch (err) {
      // Not kept on disk, so not kept at all: a guest is never let in on an agreement the server could lose.
      for (const a of fresh) this.seen.delete(recordKey(a));
      this.records.length -= fresh.length;
      throw err;
    }
    return fresh.map((a) => ({ ...a }));
  }
}

const recordKey = (a) => `${a.guest}|${a.doc}|${a.version}`;
function cleanGuestRecord(a) {
  if (!isObject(a) || typeof a.guest !== 'string' || !GUEST_ID_RE.test(a.guest)) return null;
  if (!DOC_IDS.includes(a.doc) || typeof a.version !== 'string' || !VERSION_RE.test(a.version)) return null;
  if (typeof a.at !== 'string' || Number.isNaN(Date.parse(a.at))) return null;
  const name = cleanGuestName(a.name);
  if (!name) return null;
  return { guest: a.guest, name, doc: a.doc, version: a.version, at: a.at };
}

module.exports = {
  DOCS, DOC_IDS, MAX_TEXT_BYTES, MAX_ACCOUNT_RECORDS, MAX_GUEST_RECORDS, GUEST_NAME_MAX,
  readTexts, versionOf, cleanAgreed, hasAgreed, versionsMatch, cleanGuestName,
  GuestAgreements, AgreementError, AgreementTextError,
};
