/*
 * vendored-lib.mjs -- shared code for the three vendored-library checks (not a check itself):
 *   tools/check-third-party-licences.mjs   tools/check-no-outside-urls.mjs   tools/check-vendored-hashes.mjs
 * (plan-documents.md decisions 8 and 9; plan-documents-rich-editor.md "Vendoring").
 *
 * WHERE THE FACTS LIVE. A module's THIRD-PARTY.md holds one machine-readable table, the one whose header row has the columns
 *   Name | Version | SPDX | File | SHA-256 | Licence file | Source
 * (File and Licence file are paths relative to the module folder; backticks around a cell are ignored). The table is in the
 * Markdown, not in a JSON beside it, because the person who audits a module reads THIRD-PARTY.md and the hash then sits next to
 * the name, version and licence it belongs to; one file cannot drift from the other. An optional fenced block labelled
 * "innerhtml-exemptions" (a JSON array) holds the named exemptions of safety rule 1 (see checkExemptions).
 * WHICH MODULES. tools/vendored-scope.json: "covered" modules are checked; every other module folder must be listed under
 * "notCovered" with a reason, so a new module cannot be forgotten.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWED = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0'];
const COLUMNS = ['name', 'version', 'spdx', 'file', 'sha-256', 'licence file', 'source'];

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const norm = (s) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ');

// --- scope ------------------------------------------------------------------------------------------------------------
export function loadScope(root = ROOT) {
  const scope = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'vendored-scope.json'), 'utf8'));
  const problems = [];
  const dirs = fs.existsSync(path.join(root, 'modules'))
    ? fs.readdirSync(path.join(root, 'modules'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  for (const id of dirs) {
    const inCovered = scope.covered.includes(id), inNot = id in scope.notCovered;
    if (!inCovered && !inNot) problems.push(`modules/${id} is in neither "covered" nor "notCovered" in tools/vendored-scope.json`);
    if (inCovered && inNot) problems.push(`modules/${id} is in both lists in tools/vendored-scope.json`);
  }
  for (const id of scope.covered) if (!dirs.includes(id)) problems.push(`"covered" lists modules/${id}, which does not exist`);
  for (const [id, why] of Object.entries(scope.notCovered)) if (!String(why).trim()) problems.push(`"notCovered" ${id} has no reason`);
  return { covered: scope.covered, notCovered: scope.notCovered, problems };
}

// --- THIRD-PARTY.md ---------------------------------------------------------------------------------------------------
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().replace(/^`+|`+$/g, '').trim());

// Returns { entries, exemptions, problems }. An entry: { module, name, version, spdx, file, sha256, licenceFile, source, row }.
export function readThirdParty(root, id) {
  const md = path.join(root, 'modules', id, 'THIRD-PARTY.md');
  const out = { entries: [], exemptions: [], problems: [], exists: fs.existsSync(md) };
  if (!out.exists) return out;
  const text = fs.readFileSync(md, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const head = cells(lines[i]).map((c) => c.toLowerCase());
    if (!COLUMNS.every((c, k) => head[k] === c)) continue;
    let j = i + 2; // skip the |---| row
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const c = cells(lines[j]);
      out.entries.push({ module: id, name: c[0] || '', version: c[1] || '', spdx: c[2] || '', file: c[3] || '', sha256: (c[4] || '').toLowerCase(),
        licenceFile: c[5] || '', source: c[6] || '', row: j + 1 });
    }
    i = j;
  }
  const block = text.match(/```innerhtml-exemptions\n([\s\S]*?)\n```/);
  if (block) {
    try { const v = JSON.parse(block[1]); if (!Array.isArray(v)) throw new Error('not an array'); out.exemptions = v; }
    catch (e) { out.problems.push(`modules/${id}/THIRD-PARTY.md: the innerhtml-exemptions block is not a JSON array (${e.message})`); }
  }
  return out;
}

// A path an entry names, kept inside its module folder.
export function inModule(root, id, rel) {
  if (!rel || path.isAbsolute(rel)) return null;
  const base = path.join(root, 'modules', id);
  const full = path.resolve(base, rel);
  return full === base || !full.startsWith(base + path.sep) ? null : full;
}

export function walk(dir, keep = () => true) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(p, keep)); else if (keep(p)) out.push(p);
  }
  return out;
}
export const isLicenceName = (f) => /^(licen[cs]e|copying|notice)([.\-_].*)?$/i.test(path.basename(f)) || /^(licen[cs]e|copying)/i.test(path.basename(f));

// --- (1) licences -----------------------------------------------------------------------------------------------------
// What a licence file's own text says. Returns { allowed: [spdx...], forbidden: [name...] }.
export function detectLicences(raw) {
  const t = norm(raw), low = t.toLowerCase();
  const allowed = [], forbidden = [];
  const hasAll = (...s) => s.every((x) => low.includes(x.toLowerCase()));
  if (hasAll('Permission is hereby granted, free of charge, to any person obtaining a copy', 'without restriction', 'THE SOFTWARE IS PROVIDED "AS IS"')) allowed.push('MIT');
  if (hasAll('Apache License', 'Version 2.0, January 2004', 'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION')) allowed.push('Apache-2.0');
  if (/mozilla public license,? (version|v\.?) ?2\.0/i.test(t) && hasAll('Covered Software')) allowed.push('MPL-2.0');
  if (hasAll('Permission to use, copy, modify,', 'distribute this software for any purpose with or without fee is permitted')) allowed.push('ISC');
  if (hasAll('Redistribution and use in source and binary forms, with or without modification, are permitted provided that')) {
    if (/neither the name of|endorse or promote products/i.test(t)) allowed.push('BSD-3-Clause'); else allowed.push('BSD-2-Clause');
  }
  if (/GNU AFFERO GENERAL PUBLIC LICENSE|under the terms of the GNU Affero/i.test(t)) forbidden.push('AGPL');
  if (/GNU LESSER GENERAL PUBLIC LICENSE|GNU LIBRARY GENERAL PUBLIC LICENSE|under the terms of the GNU (Lesser|Library)/i.test(t)) forbidden.push('LGPL');
  if (/GNU GENERAL PUBLIC LICENSE|under the terms of the GNU General Public License/i.test(t)) forbidden.push('GPL');
  if (/PYTHON SOFTWARE FOUNDATION LICENSE|PSF LICENSE AGREEMENT/i.test(t)) forbidden.push('PSF');
  if (/Server Side Public License|Commons Clause|Creative Commons[^.]{0,40}NonCommercial|Business Source License/i.test(t)) forbidden.push('source-available');
  return { allowed, forbidden };
}

// Problems in every entry's licence, and in vendor/ folders. `ids` are the module ids to read.
export function checkLicences(root, ids) {
  const out = [];
  for (const id of ids) {
    const tp = readThirdParty(root, id);
    const at = `modules/${id}`;
    out.push(...tp.problems);
    const vendorDir = path.join(root, 'modules', id, 'vendor');
    const vendorFiles = walk(vendorDir);
    if (!tp.exists) { if (vendorFiles.length) out.push(`${at}/THIRD-PARTY.md is missing, but ${at}/vendor/ holds files`); continue; }
    const listedFiles = new Set(), listedLicences = new Set();
    for (const e of tp.entries) {
      const who = `${at}/THIRD-PARTY.md line ${e.row} (${e.name || 'no name'})`;
      for (const k of ['name', 'version', 'spdx', 'file', 'source']) if (!e[k]) out.push(`${who}: the ${k} is empty`);
      if (e.spdx && !ALLOWED.includes(e.spdx)) out.push(`${who}: licence "${e.spdx}" is not allowed (allowed: ${ALLOWED.join(', ')})`);
      const f = inModule(root, id, e.file);
      if (e.file && !f) out.push(`${who}: "${e.file}" is not a path inside the module`);
      else if (f) { if (!fs.existsSync(f) || !fs.statSync(f).isFile()) out.push(`${who}: the file ${e.file} does not exist`); else listedFiles.add(f); }
      if (!e.licenceFile) { out.push(`${who}: there is no licence file (a LICENSE file must be kept beside the library)`); continue; }
      const lf = inModule(root, id, e.licenceFile);
      if (!lf) { out.push(`${who}: "${e.licenceFile}" is not a path inside the module`); continue; }
      if (!isLicenceName(lf)) out.push(`${who}: "${e.licenceFile}" is not named like a licence file (LICENSE, LICENSE.name, COPYING)`);
      if (!fs.existsSync(lf) || !fs.statSync(lf).isFile()) { out.push(`${who}: the licence file ${e.licenceFile} is missing`); continue; }
      listedLicences.add(lf);
      if (f && path.dirname(lf) !== path.dirname(f) && path.dirname(lf) !== vendorDir) out.push(`${who}: the licence file must sit in ${at}/vendor/ or beside the library`);
      const found = detectLicences(fs.readFileSync(lf, 'utf8'));
      if (found.forbidden.length) out.push(`${who}: the text of ${e.licenceFile} is ${found.forbidden.join(' and ')}, which is not allowed`);
      else if (!found.allowed.length) out.push(`${who}: the text of ${e.licenceFile} is not a licence this check knows (allowed: ${ALLOWED.join(', ')})`);
      else if (e.spdx && ALLOWED.includes(e.spdx) && !found.allowed.includes(e.spdx)) out.push(`${who}: the entry says ${e.spdx} but the text of ${e.licenceFile} is ${found.allowed.join(' and ')}`);
    }
    for (const f of vendorFiles) {
      if (isLicenceName(f)) { if (!listedLicences.has(f)) out.push(`${at}/${path.relative(path.join(root, 'modules', id), f)} is a licence file no THIRD-PARTY.md entry names`); }
      else if (!listedFiles.has(f)) out.push(`${at}/${path.relative(path.join(root, 'modules', id), f)} is vendored but has no THIRD-PARTY.md entry`);
    }
  }
  return out;
}

// --- (2) outside URLs -------------------------------------------------------------------------------------------------
// Every http:, https:, ws:, wss: address, and every protocol-relative address that opens a string, a url( ) or an attribute.
// This is stricter than "what would load": a URL in a comment, a namespace or a licence line is found too and must be named
// in the allow list with a reason, so a URL built into fetch(), import() or new URL() cannot hide by looking like text.
// (Not caught: an address assembled from pieces at run time; the read of a new vendored file covers that.)
const ABS = /(?<![A-Za-z0-9_$.])(?:https?|wss?):\/\/[^\s'"`<>()\\^|{}[\]]*/g;
const REL = /(?<=["'`(=])\/\/[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}[^\s'"`<>()\\]*/g;
export function findUrls(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const re of [ABS, REL]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) out.push({ url: m[0].replace(/[.,;:!?]+$/, ''), line: i + 1 });
    }
  });
  return out;
}
export const URL_FILES = /\.(js|mjs|cjs|css|html|htm|svg)$/i;
const SKIP_DIRS = /(^|\/)(test|node_modules|design)(\/|$)/;

export function checkOutsideUrls(root, ids, allow) {
  const out = [];
  const used = new Set();
  for (const id of ids) {
    const base = path.join(root, 'modules', id);
    for (const f of walk(base, (p) => URL_FILES.test(p) && !SKIP_DIRS.test(path.relative(base, p).split(path.sep).join('/')))) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      const entry = allow[rel] || [];
      const ok = new Map(entry.map((a) => [a.url, a]));
      const seen = new Set();
      for (const { url, line } of findUrls(fs.readFileSync(f, 'utf8'))) {
        if (ok.has(url)) { used.add(`${rel}\n${url}`); continue; }
        if (seen.has(url)) continue;
        seen.add(url);
        out.push(`${rel}:${line} holds the address ${url.length > 90 ? url.slice(0, 90) + '...' : url}, which is not in tools/check-no-outside-urls-allow.json (a page must not load from outside)`);
      }
    }
  }
  for (const [rel, list] of Object.entries(allow)) {
    if (!ids.includes(rel.split('/')[1])) continue;
    for (const a of list) {
      if (!a || typeof a.url !== 'string' || !a.url) out.push(`allow list: ${rel} has an entry with no url`);
      else if (!String(a.reason || '').trim()) out.push(`allow list: ${rel} ${a.url} has no reason`);
      else if (!used.has(`${rel}\n${a.url}`)) out.push(`allow list: ${rel} ${a.url} is no longer in the file; remove the entry`);
    }
  }
  return out;
}

// --- (3) hashes and exemptions ----------------------------------------------------------------------------------------
export function checkHashes(root, ids) {
  const out = [];
  for (const id of ids) {
    const tp = readThirdParty(root, id);
    const at = `modules/${id}`;
    out.push(...tp.problems);
    if (!tp.exists) { out.push(`${at}/THIRD-PARTY.md is missing`); continue; }
    for (const e of tp.entries) {
      const who = `${at}/THIRD-PARTY.md line ${e.row} (${e.name || e.file || 'no name'})`;
      if (!e.sha256) { out.push(`${who}: no SHA-256 is pinned for ${e.file}`); continue; }
      if (!/^[0-9a-f]{64}$/.test(e.sha256)) { out.push(`${who}: the SHA-256 is not 64 hex digits`); continue; }
      const f = inModule(root, id, e.file);
      if (!f || !fs.existsSync(f)) { out.push(`${who}: the file ${e.file} does not exist`); continue; }
      const got = sha256(fs.readFileSync(f));
      if (got !== e.sha256) out.push(`${who}: ${e.file} is not the pinned file (pinned ${e.sha256.slice(0, 12)}..., found ${got.slice(0, 12)}...); updating a library means replacing the file and the pin together, on purpose`);
    }
    out.push(...checkExemptions(root, id, tp));
  }
  return out;
}

// NAMED EXEMPTIONS from safety rule 1 (nothing reaches innerHTML), for a vendored file whose own innerHTML line was read and
// judged safe. An exemption is { file, sha256, line, reason }: the vendored file (path in the module), the SHA-256 of that exact
// file, the exact text of the line (one full line of the file, without its line break) and why it is safe. It is valid only
// while the file's hash equals the pinned hash in the table AND the exemption's own hash; change the bundle and it lapses until
// someone reads the line again and writes the new hash.
export function checkExemptions(root, id, tp = readThirdParty(root, id)) {
  const out = [];
  const at = `modules/${id}/THIRD-PARTY.md`;
  tp.exemptions.forEach((x, k) => {
    const who = `${at}: exemption ${k + 1}${x && x.file ? ` (${x.file})` : ''}`;
    if (!x || typeof x !== 'object') { out.push(`${who} is not an object`); return; }
    for (const key of ['file', 'sha256', 'line', 'reason']) if (typeof x[key] !== 'string' || !x[key].trim()) out.push(`${who}: "${key}" is missing`);
    if (typeof x.file !== 'string' || !x.file || typeof x.sha256 !== 'string') return;
    const entry = tp.entries.find((e) => e.file === x.file);
    const f = inModule(root, id, x.file);
    if (!entry) { out.push(`${who}: ${x.file} is not a vendored file in the table`); return; }
    if (!f || !fs.existsSync(f)) { out.push(`${who}: the file does not exist`); return; }
    const got = sha256(fs.readFileSync(f));
    if (got !== entry.sha256 || got !== x.sha256.toLowerCase()) {
      out.push(`${who} no longer applies: ${x.file} is not the file it was read for (the exemption needs re-reading, then its sha256 and the table's updated together)`);
      return;
    }
    if (typeof x.line === 'string' && x.line && !fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n').includes(x.line)) out.push(`${who}: the line text is not a line of ${x.file}`);
  });
  return out;
}

// The hook for tools/check-documents-safety.mjs (when it exists): is this vendored line exempt from the innerHTML rule?
// `file` is the path inside the module, `line` the line's exact text. True only while the exemption is valid (see above).
export function isExemptFromInnerHtml(root, id, file, line) {
  const tp = readThirdParty(root, id);
  if (checkExemptions(root, id, tp).length) return false;
  return tp.exemptions.some((x) => x && x.file === file && x.line === line);
}
