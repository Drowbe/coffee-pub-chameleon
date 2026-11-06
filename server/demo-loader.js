'use strict';

// The demo loader (documentation/plans/plan-demo-space.md, slice 1). One generic loader fills ONE marked space, and its
// own marked demo people, from the demo data file of an environment's template: templates/demo/<template id>.json.
//
// It reaches the product the way a browser does: requests to the server's own address (`base`), each as a signed-in
// person, so every module's real rules, permissions and validation run. It calls no function of a route directly.
//
// It NEVER changes an environment-wide setting: it installs or turns on no module, sets no calendar or map option, no
// place search, no template. A module in the file that the environment does not already have on is skipped, and the
// report names it. It touches only the space whose description starts with MARKER and the people whose login AND display
// name are the file's; a space or an account that merely has the same name is refused and left alone.
//
// THE DATA FILE (read by readDemoFile). One JSON object; a key that starts with "_" (`_about`) is a note and is ignored.
//   template, name, description, anchor (days after today that the story's first day, "start", falls on), tz,
//   guestLink (make the guest link), budget ({ amount, currency }), phases ({ "<phase id>": { start, end } }),
//   people ([{ login, displayName, role, moderator }]), modules ({ "<module id>": block }).
// A module block is { as?, tz?, what?, count?: [key prefixes], steps: [{ as?, data: { "<key>": <value> } }] } (or
// { as?, data } for one step); the values are in that module's own format, and each step is written in order by the
// person it names (`as`, else the block's, else the first moderator). The built-in "chat" block is { messages: [{ as,
// text }] }. `count` names the key prefixes the report counts (default: every key written); `what` is the plural noun
// in the "skipped" sentence ("costs").
//
// DATES ARE OFFSETS, never absolute, so the same file is right on any day. A string that is exactly:
//   today+N / today-N     N days from the day the loader is run            -> "YYYY-MM-DD"
//   start+N / start-N     N days from the story's first day (today + anchor) -> "YYYY-MM-DD"
//   ...T09:30             a time of day after it                            -> "YYYY-MM-DDT09:30"
//   ...T09:30Z            and a trailing Z gives a full timestamp           -> "YYYY-MM-DDT09:30:00.000Z"
//   ms:today+2T10:00      "ms:" in front gives milliseconds since 1970 (a number); "ms:now" is the time of the run.
// A base the loader does not know ("tomorrow+1") refuses the whole file, naming where it is, before anything is made.
// Other markers, anywhere in a string: "@login" (the whole string, or one part of a key) is that person's key; "{space}"
// and "{base}" are the space's id and the server address. Phases are named by their id in the template, never by position.
//
// THE API: loadDemo({ base, templateId, today, session, headers?, say?, fetchImpl? }) -> report (below). `session` is an
// owner's or admin's { cookie } (the request's own, when called from inside the server) or { login, password }.
// `headers` are added to every request (a hosted environment's Host header). The passwords of the demo people are random
// on every run and are only returned (report.people), never stored or printed here.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { word: defaultWord, format } = require('./words');

const DEMO_DIR = path.join(__dirname, '..', 'templates', 'demo');
// The first line of the demo space's description: how the loader knows a space is its own.
const MARKER = 'Demo data from npm run seed:demo.';
const TEMPLATE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const MODULE_ID_RE = /^[a-z0-9-]+$/;
const TOP_KEYS = ['template', 'name', 'description', 'anchor', 'tz', 'guestLink', 'budget', 'phases', 'people', 'modules'];

class DemoError extends Error {}

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const dayPlus = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const password = () => crypto.randomBytes(12).toString('base64url');

// --- the file --------------------------------------------------------------------------------------------------------
function problemsOf(raw, templateId, word = defaultWord) {
  const out = [];
  if (!isObject(raw)) return ['the file must be a JSON map'];
  for (const k of Object.keys(raw)) if (!k.startsWith('_') && !TOP_KEYS.includes(k)) out.push(`"${k}" is not a field of a demo file`);
  if (raw.template !== templateId) out.push(`"template" must be "${templateId}"`);
  if (typeof raw.name !== 'string' || !raw.name.trim()) out.push('"name" must be text');
  if (typeof raw.description !== 'string') out.push('"description" must be text');
  if (!Number.isInteger(raw.anchor) || raw.anchor < 0) out.push('"anchor" must be a whole number of days, 0 or more');
  if (!Array.isArray(raw.people) || !raw.people.length) out.push('"people" must be a list of people');
  else {
    raw.people.forEach((p, i) => { if (!isObject(p) || typeof p.login !== 'string' || typeof p.displayName !== 'string') out.push(`people[${i}] needs a login and a displayName`); });
    if (new Set(raw.people.map((p) => p && p.login)).size !== raw.people.length) out.push('"people" has the same login twice');
  }
  if (!isObject(raw.modules)) out.push(`the ${word('module', { many: true })} part must be a map from ${word('module')} id to what it holds`);
  else {
    for (const [id, b] of Object.entries(raw.modules)) {
      if (!MODULE_ID_RE.test(id)) { out.push(`modules.${id} is not a ${word('module')} id (lower-case letters, digits and hyphens)`); continue; }
      if (!isObject(b)) { out.push(`modules.${id} must be a map`); continue; }
      if (id === 'chat') { if (!Array.isArray(b.messages)) out.push('modules.chat needs a list of messages'); continue; }
      const steps = b.steps || (b.data ? [b] : null);
      if (!Array.isArray(steps) || !steps.length || steps.some((s) => !isObject(s) || !isObject(s.data))) out.push(`modules.${id} needs steps, each with data`);
    }
  }
  return out;
}

// The demo file of a template, parsed and checked; null when the template has none (or its id cannot name a file).
function readDemoFile(templateId, { dir = DEMO_DIR, words = defaultWord } = {}) {
  if (typeof templateId !== 'string' || !TEMPLATE_ID_RE.test(templateId)) return null;
  const file = path.join(dir, `${templateId}.json`);
  if (!fs.existsSync(file)) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new DemoError(`The demo file for ${templateId} is not valid JSON (${e.message}).`); }
  const problems = problemsOf(raw, templateId, words);
  if (problems.length) throw new DemoError(`The demo file for ${templateId} is not valid: ${problems.join('; ')}.`);
  return raw;
}
const hasDemo = (templateId, opts) => Boolean(readDemoFile(templateId, opts));

// --- offsets ---------------------------------------------------------------------------------------------------------
const OFFSET_RE = /^(ms:)?([a-z]+)([+-])(\d+)(?:T(\d\d):(\d\d))?(Z)?$/;
// `ctx`: { today, start, keys: { login: key }, space, base, now }. `where` names the place for a refusal.
function resolveString(s, ctx, where) {
  if (s === 'ms:now') return ctx.now;
  const m = OFFSET_RE.exec(s);
  if (m) {
    const [, ms, word, sign, digits, hh, mm, z] = m;
    const baseDay = word === 'today' ? ctx.today : word === 'start' ? ctx.start : null;
    if (!baseDay) throw new DemoError(`The demo file has a date the loader does not know ("${s}" at ${where}); a date is today+N or start+N.`);
    const day = dayPlus(baseDay, (sign === '-' ? -1 : 1) * Number(digits));
    const time = hh === undefined ? null : `${hh}:${mm}`;
    if (ms) return Date.parse(`${day}T${time || '00:00'}:00Z`);
    if (z) return `${day}T${time || '00:00'}:00.000Z`;
    return time ? `${day}T${time}` : day;
  }
  if (/^@[a-z0-9_.-]+$/i.test(s) && ctx.keys[s.slice(1)]) return ctx.keys[s.slice(1)];
  return s.split('{space}').join(ctx.space).split('{base}').join(ctx.base);
}
function resolveValue(v, ctx, where) {
  if (typeof v === 'string') return resolveString(v, ctx, where);
  if (Array.isArray(v)) return v.map((x, i) => resolveValue(x, ctx, `${where}[${i}]`));
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [resolveKey(k, ctx), resolveValue(x, ctx, `${where}.${k}`)]));
  return v;
}
// A key may hold "@login" as one of its ":" parts ("vote:q1:@mia").
const resolveKey = (key, ctx) => key.split(':').map((part) => (part.startsWith('@') && ctx.keys[part.slice(1)] ? ctx.keys[part.slice(1)] : part)).join(':');

// Every module block as a list of steps.
const stepsOf = (block) => block.steps || [block];

// --- the run ---------------------------------------------------------------------------------------------------------
// Answers the report:
//   { demo: true, space: { id, name, members }, start, created: { <module>: n }, skipped: [{ module, why }],
//     refused: [{ module, key, why }], people: [{ login, displayName, password }], guestUrl }
// or, for a template with no demo file, { demo: false, message, created: {}, skipped: [], refused: [], people: [] } and
// nothing is made. Throws a DemoError (one plain sentence) when it cannot start or must not touch what it found.
async function loadDemo({ base, templateId, today, session = {}, headers = {}, say = () => {}, fetchImpl = fetch, dir = DEMO_DIR, now = Date.now(), words = null }) {
  base = String(base || '').replace(/\/+$/, '');
  // The words every sentence below uses: the caller's (inside the server, its word()), else the environment's own as its
  // /api/branding answers them, else the product's defaults (before that answer is read).
  let word = words || defaultWord;
  const file = readDemoFile(templateId, { dir, words: (...a) => word(...a) });
  if (!file) return { demo: false, message: 'There is no demo for this template.', created: {}, skipped: [], refused: [], people: [] };
  if (!isDay(today)) throw new DemoError('The day must be given as YYYY-MM-DD.');
  const start = dayPlus(today, file.anchor);
  const logins = file.people.map((p) => p.login);
  // The whole file is read once, with stand-in keys, so a bad date stops the run before anything is made.
  const trial = { today, start, keys: Object.fromEntries(logins.map((l) => [l, l])), space: 'space', base, now };
  for (const [id, b] of Object.entries(file.modules)) {
    if (id === 'chat') b.messages.forEach((m, i) => resolveValue(m, trial, `modules.chat.messages[${i}]`));
    else stepsOf(b).forEach((s, i) => resolveValue(s.data, trial, `modules.${id}.steps[${i}]`));
  }
  resolveValue(file.phases || {}, trial, 'phases');

  const jars = {};
  const call = async (as, method, url, body) => {
    const h = { accept: 'application/json', ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (jars[as]) h.cookie = jars[as];
    // A module may be asked for 240 writes a minute by one person (server/module-limits.js): when told to wait, wait as told
    // (a minute at most) and ask again, a few times, so two runs close together still finish.
    for (let attempt = 0; ; attempt += 1) {
      let r;
      try { r = await fetchImpl(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); } catch { throw new DemoError(`No server answered at ${base}.`); }
      let json = null; try { json = await r.json(); } catch { /* none */ }
      if (r.status === 429 && attempt < 4) {
        const told = Number(r.headers.get('retry-after')) || Number(/Wait (\d+) second/.exec((json && json.error) || '')?.[1]) || 5;
        await new Promise((done) => setTimeout(done, Math.min(61, told + 1) * 1000));
        continue;
      }
      return { status: r.status, json, res: r };
    }
  };
  const ok = async (as, method, url, body) => {
    const r = await call(as, method, url, body);
    if (r.status >= 300) throw new DemoError(`${method} ${url} answered ${r.status}: ${r.json && r.json.error ? r.json.error : JSON.stringify(r.json)}`);
    return r.json;
  };
  const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const signIn = async (as, login, pass) => {
    const r = await call(as, 'POST', '/api/login', { login, password: pass });
    if (r.status !== 200 || !r.json || !r.json.user) throw new DemoError(`Could not sign in as ${login} (${r.status}${r.json && r.json.error ? `: ${r.json.error}` : ''}).`);
    jars[as] = cookieOf(r.res);
    return r.json.user;
  };

  // --- the environment's words (the branding answers without a sign-in) ---
  if (!words) {
    const b = await call('caller', 'GET', '/api/branding');
    if (b.status === 200 && b.json && b.json.words) word = (key, opts) => format(b.json.words, key, opts);
  }

  // --- who is calling: an owner or admin ---
  if (session.cookie) jars.caller = session.cookie;
  else if (session.login && session.password) await signIn('caller', session.login, session.password);
  else throw new DemoError(`The loader needs the ${word('owner')}'s or ${word('admin')}'s session or sign-in.`);
  const me = await call('caller', 'GET', '/api/me');
  if (me.status !== 200 || !me.json || !me.json.user) throw new DemoError('The session is not signed in.');
  const callerKey = me.json.user.key;
  const branding = await ok('caller', 'GET', '/api/branding');
  const phaseIds = new Set((branding.phases || []).map((p) => p.id));

  // --- what is already there, and what must be left alone: all checked before anything is changed ---
  const existing = (await ok('caller', 'GET', '/api/users')).users || [];
  for (const p of file.people) {
    const found = existing.find((u) => u.login === p.login);
    if (found && found.displayName !== p.displayName) throw new DemoError(`An account called "${p.login}" already exists and is not a demo person (its name is not ${p.displayName}), so it is left alone. Rename or remove it first.`);
  }
  const old = [];
  for (const sp of (await ok('caller', 'GET', '/api/spaces')).spaces || []) {
    if (sp.name !== file.name) continue;
    const full = (await ok('caller', 'GET', `/api/spaces/${sp.id}`)).space;
    if (!String(full.description || '').startsWith(MARKER)) throw new DemoError(`A ${word('space')} called "${file.name}" exists but is not the demo (its description lacks the marker), so it is left alone.`);
    old.push(sp.id);
  }

  // --- which modules are on (never changed here) ---
  const listed = await ok('caller', 'GET', '/api/modules');
  const installed = new Map((listed.modules || []).map((m) => [m.id, m]));
  const bundled = new Map((listed.bundled || []).map((m) => [m.id, m]));
  const nameOf = (id) => { const m = installed.get(id) || bundled.get(id); return (m && (m.displayName || m.name)) || id; };
  const skipped = []; const refused = []; const created = {};
  const countOf = (id, b) => {
    const prefixes = b.count || null;
    const keys = id === 'chat' ? b.messages : stepsOf(b).flatMap((s) => Object.keys(s.data));
    return prefixes ? keys.filter((k) => prefixes.some((pre) => String(k).startsWith(pre))).length : keys.length;
  };
  const off = new Set();
  for (const [id, b] of Object.entries(file.modules)) {
    if (id === 'chat') continue;
    const m = installed.get(id);
    if (!m || !m.enabled) {
      off.add(id);
      skipped.push({ module: id, why: `${nameOf(id)} is off in this ${word('environment')}, so the ${countOf(id, b)} demo ${b.what || word('object', { many: true })} were not made.` });
    }
  }
  for (const [id, b] of Object.entries(file.modules)) {
    if (id === 'chat' || off.has(id)) continue;
    const needs = ((installed.get(id) || {}).requires || []).filter((r) => !(installed.get(r) || {}).enabled);
    if (needs.length) { off.add(id); skipped.push({ module: id, why: `${nameOf(id)} needs ${needs.map(nameOf).join(' and ')}, which ${needs.length === 1 ? 'is' : 'are'} off in this ${word('environment')}, so the ${countOf(id, b)} demo ${b.what || word('object', { many: true })} were not made.` }); }
  }

  // --- the demo people ---
  const keys = {}; const pass = {}; const people = [];
  for (const p of file.people) {
    pass[p.login] = password();
    const found = existing.find((u) => u.login === p.login);
    if (found) { await ok('caller', 'PATCH', `/api/users/${found.key}`, { password: pass[p.login] }); keys[p.login] = found.key; }
    else keys[p.login] = (await ok('caller', 'POST', '/api/users', { login: p.login, displayName: p.displayName, role: p.role || 'member', password: pass[p.login] })).user.key;
    people.push({ login: p.login, displayName: p.displayName, key: keys[p.login], password: pass[p.login] });
  }
  for (const p of file.people) await signIn(p.login, p.login, pass[p.login]);
  const moderator = (file.people.find((p) => p.moderator) || file.people[0]).login;

  // --- reset only the demo space, then make it ---
  for (const id of old) { await ok('caller', 'DELETE', `/api/spaces/${id}`); say(`Removed the old demo ${word('space')}.`); }
  const members = [...new Set([...logins.map((l) => keys[l]), callerKey].filter(Boolean))];
  const space = (await ok('caller', 'POST', '/api/spaces', { name: file.name, description: `${MARKER} ${file.description}`.trim(), members })).space;
  for (const p of file.people.filter((x) => x.moderator)) await ok('caller', 'PATCH', `/api/users/${keys[p.login]}/spaces/${space.id}`, { permissions: { moderator: true } });
  const ctx = { today, start, keys, space: space.id, base, now };

  const patch = {};
  if (file.phases) {
    const dates = {};
    for (const [id, range] of Object.entries(file.phases)) {
      if (phaseIds.has(id)) dates[id] = resolveValue(range, ctx, `phases.${id}`);
      else skipped.push({ module: 'phases', why: `This ${word('environment')}'s template has no phase "${id}", so its dates were not set.` });
    }
    if (Object.keys(dates).length) patch.phases = dates;
  }
  if (file.budget) patch.budget = file.budget;
  if (Object.keys(patch).length) await ok('caller', 'PATCH', `/api/spaces/${space.id}`, patch);

  // --- the objects, each written as the person who owns it, through the module's own route ---
  const written = {};
  for (const [id, block] of Object.entries(file.modules)) {
    if (id === 'chat' || off.has(id)) continue;
    written[id] = 0;
    for (const [n, step] of stepsOf(block).entries()) {
      const as = step.as || block.as || moderator;
      if (!jars[as]) throw new DemoError(`The demo file names "${as}" as a writer, who is not one of its people.`);
      for (const [rawKey, rawValue] of Object.entries(step.data)) {
        const key = resolveKey(rawKey, ctx);
        const value = resolveValue(rawValue, ctx, `modules.${id}.steps[${n}].${rawKey}`);
        if (isObject(value) && typeof value.phase === 'string' && !phaseIds.has(value.phase)) {
          refused.push({ module: id, key, why: `This ${word('environment')}'s template has no phase "${value.phase}", so the ${word('object')} was left out.` });
          continue;
        }
        const r = await call(as, 'PUT', `/api/modules/${encodeURIComponent(id)}/data/${encodeURIComponent(key)}?scope=space&space=${space.id}`, { value, tz: step.tz || block.tz || file.tz });
        if (r.status >= 300) refused.push({ module: id, key, why: (r.json && r.json.error) || `answered ${r.status}` });
        else written[id] += 1;
      }
    }
  }

  // --- the chat, each message from its own session ---
  const chat = file.modules.chat;
  if (chat) {
    created.chat = 0;
    for (const [n, m] of chat.messages.entries()) {
      const as = m.as || moderator;
      if (!jars[as]) throw new DemoError(`The demo file names "${as}" as a writer, who is not one of its people.`);
      const r = await call(as, 'POST', `/api/spaces/${space.id}/chat`, { text: resolveString(m.text, ctx, `modules.chat.messages[${n}]`) });
      if (r.status >= 300) refused.push({ module: 'chat', key: String(n + 1), why: (r.json && r.json.error) || `answered ${r.status}` });
      else created.chat += 1;
    }
  }

  // --- the guest link, then what each module now holds (the server adds some objects of its own: the Calendar's twins) ---
  let guestUrl = '';
  if (file.guestLink) {
    const g = await call('caller', 'POST', `/api/spaces/${space.id}/guest-link`, {});
    if (g.status < 300 && g.json) guestUrl = g.json.guestUrl || '';
    else refused.push({ module: 'guest-link', key: '', why: (g.json && g.json.error) || `answered ${g.status}` });
  }
  for (const [id, block] of Object.entries(file.modules)) {
    if (id === 'chat' || off.has(id)) continue;
    const prefixes = block.count || [''];
    let total = 0;
    for (const pre of prefixes) total += (((await ok('caller', 'GET', `/api/modules/${encodeURIComponent(id)}/data?scope=space&space=${space.id}&prefix=${encodeURIComponent(pre)}`)).items) || []).length;
    created[id] = total;
  }
  return { demo: true, space, start, created, skipped, refused, people, guestUrl };
}

module.exports = { loadDemo, readDemoFile, hasDemo, problemsOf, resolveString, resolveValue, DemoError, MARKER, DEMO_DIR, dayPlus };
