// The AI policy layer (plan-ai-integration.md, "The policy layer" and "What AI may see"): who may ask, which objects may be
// sent, redaction, the refusal sentences, availability, the rate limit and the reserved cap. Every AI route and every
// availability route asks it, so a page is never offered what the server then refuses.
//
// One rule for AI everywhere (decision 1): signed in, not a guest, the role's Use AI (`useAi`; an owner always has it), the
// space's AI switch on; then the door's own rule (Chat: a member of the space who may chat; a module: its write access and
// approved `ai` hook); then the service (set up, its key readable, within the month's allowance and, on a host, its calls);
// then the rate limit, six a minute per person for all AI together, counted only once a question is valid and given back
// when the provider did no work. Bringing in pasted objects is not AI use (decision 12): signed in, not a guest, and the
// module's write access (importRefusal).
//
// What is sent is the narrowest of three: the person's own read rights now, the current space (never another, decision 4),
// and the owner's setting What AI may see (`sees` in DATA_DIR/ai.json, `aiSees` on a space), which can only narrow.
//
// The pure parts (the setting's keys, defaults and cleaning, the redaction list, the sentences) need nothing else; the
// rest is made per server by createAiPolicy with the services it reads through.
'use strict';

const { word } = require('./words');

// --- What AI may see -----------------------------------------------------------------------------------------------------
const SEES_SWITCHES = ['attached', 'relevant', 'linked', 'history', 'chat', 'members'];
const SEES_KEYS = [...SEES_SWITCHES, 'environment', 'modules'];
const ENVIRONMENT_VALUES = ['never', 'attached', 'readable'];
const SEES_DEFAULTS = Object.freeze({ attached: true, relevant: true, linked: true, history: true, chat: false, members: false, environment: 'attached', modules: 'all' });
const MODULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

class PolicyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const listOr = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`);
const listAnd = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

// A What AI may see value as sent (PUT /api/ai's `sees`, PATCH /api/spaces/:id's `aiSees`): an object of some of the keys,
// each checked. Answers only the keys given; an unknown key or value is refused (400) with a sentence naming the allowed ones.
function cleanSees(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PolicyError(`What AI may see takes ${listAnd(SEES_KEYS)}, each with its value.`);
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!SEES_KEYS.includes(key)) throw new PolicyError(`What AI may see has no ${String(key).slice(0, 40)}; its keys are ${listAnd(SEES_KEYS)}.`);
    if (SEES_SWITCHES.includes(key)) {
      if (typeof value !== 'boolean') throw new PolicyError(`${key} is true or false.`);
      out[key] = value;
    } else if (key === 'environment') {
      if (!ENVIRONMENT_VALUES.includes(value)) throw new PolicyError(`${key} is ${listOr(ENVIRONMENT_VALUES)}.`);
      out[key] = value;
    } else {
      if (value === 'all') { out[key] = 'all'; continue; }
      if (!Array.isArray(value) || value.length > 200 || value.some((id) => typeof id !== 'string' || !MODULE_ID.test(id))) throw new PolicyError(`${key} is "all" or a list of ${word('module')} ids.`);
      out[key] = [...new Set(value)];
    }
  }
  return out;
}

// The same value read from a file: what does not clean is dropped, never an error.
function readSees(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of SEES_KEYS) {
    if (!(key in raw)) continue;
    try { Object.assign(out, cleanSees({ [key]: raw[key] })); } catch { /* dropped */ }
  }
  return out;
}

// The effective setting: the defaults, then the environment's choice, then the space's own (when it has one). A module id
// no longer enabled is dropped (`enabledIds`).
function effectiveSees(envSees, spaceSees, enabledIds) {
  const out = { ...SEES_DEFAULTS, ...readSees(envSees), ...(spaceSees ? readSees(spaceSees) : {}) };
  if (Array.isArray(out.modules)) out.modules = out.modules.filter((id) => !enabledIds || enabledIds.includes(id));
  return out;
}

const moduleAllowed = (sees, moduleId) => sees.modules === 'all' || (Array.isArray(sees.modules) && sees.modules.includes(moduleId));

// --- Redaction -----------------------------------------------------------------------------------------------------------
// The fields of an object's summary that never reach a model (people's keys, the spaces it is marked into, pointers and how
// the page draws it); everything else that is sent is in SENT_FIELDS. One list, checked field by field by
// tools/check-prompts.mjs.
const REDACTED_FIELDS = Object.freeze(['ref', 'module', 'open', 'paidBy', 'sharedBy', 'spaces', 'twins', 'twinOf', 'copy', 'icon', 'color', 'visit']);
const SENT_FIELDS = Object.freeze(['kind', 'kindName', 'title', 'subtitle', 'when', 'end', 'allDay', 'done', 'category', 'amount', 'planned', 'place', 'text']);
// Patterns taken out of any text sent: a link's secret query values (a guest link, the OBS access key, an invitation or a
// sign-in token), a bearer header, and the shapes of the providers' keys.
const SECRET_PATTERNS = Object.freeze([
  /([?&#](?:guest|s|token|key|invite|code|access_token|api_key|apikey|sig|signature)=)[^&\s#"'<>)]+/gi,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g,
  /\b(sk-(?:ant-)?)[A-Za-z0-9_-]{12,}/g,
]);
const REMOVED = '[removed]';

// A text with every known secret (`secrets`: exact values, such as this server's access key and its spaces' guest tokens)
// and every secret-shaped value taken out.
function redactText(text, secrets = []) {
  let out = String(text == null ? '' : text);
  for (const s of secrets) if (typeof s === 'string' && s.length >= 8) out = out.split(s).join(REMOVED);
  for (const re of SECRET_PATTERNS) out = out.replace(re, (_m, keep) => `${keep}${REMOVED}`);
  return out;
}

// A summary (server/index.js objectSummary) as a model may read it: only SENT_FIELDS, each text redacted.
function redactSummary(summary, secrets = []) {
  const out = {};
  for (const key of SENT_FIELDS) {
    if (summary[key] === undefined) continue;
    const v = summary[key];
    if (key === 'place') { if (v && typeof v.name === 'string' && v.name) out.place = redactText(v.name, secrets); continue; }
    out[key] = typeof v === 'string' ? redactText(v, secrets) : v;
  }
  return out;
}

// --- The sentences ---------------------------------------------------------------------------------------------------------
// One set, plain and capitalised, in the template's words. `word` is server/words.js's.
function sentences(word) {
  return {
    signin: 'Sign in first.',
    guest: `${word('guest', { many: true, cap: true })} can't use AI.`,
    role: "Your role can't use AI.",
    'space-off': `AI is turned off in this ${word('space')}.`,
    member: `You are not in this ${word('space')}.`,
    chat: `Your role can't chat in this ${word('space')}, so it can't ask the AI there.`,
    module: `Your role can't do that in this ${word('module')}.`,
    'not-set-up': 'AI is not set up here.',
    'key-unreadable': `The saved AI key can't be read on this server; ${word('owner', { a: true })} needs to enter it again.`,
    allowance: `This ${word('environment')} has used its AI allowance for the month.`,
    limit: 'You have asked the AI too many times in a minute. Try again in a moment.',
    'import-guest': `${word('guest', { many: true, cap: true })} can't bring in ${word('object', { many: true })}.`,
  };
}

// --- The policy, per server ------------------------------------------------------------------------------------------------
// deps: { store, ai, modules, word, resolveRef, limits, aiCallsRefusal, hasOwnerRights }. Each is read at call time (the
// server's per-environment proxies).
function createAiPolicy(deps) {
  const { store, ai, modules, word, resolveRef, limits, aiCallsRefusal, hasOwnerRights } = deps;
  const LIMIT_KEY = '#ai'; // one count for all AI together, under a key no module id can take
  const refuse = (status, reason, why) => ({ ok: false, status, reason, why: why || sentences(word)[reason] });

  // The service itself, whoever asks: { ok } or a refusal (503 not set up or the key unreadable, 429 the allowance).
  function service() {
    if (!ai.ready()) {
      const v = ai.view();
      if (v.keyUnreadable && v.enabled) return refuse(503, 'not-set-up', sentences(word)['key-unreadable']);
      return refuse(503, 'not-set-up');
    }
    if (ai.overCap()) return refuse(429, 'allowance');
    const calls = aiCallsRefusal(ai.inFlight());
    if (calls) return refuse(429, 'allowance', calls);
    return { ok: true };
  }

  // Whether `who` may use AI here. `space`: the space asked in, or null (a module's environment-wide or personal page).
  // `purpose`: 'chat' or 'module'. `door`: for 'module', { write } -- whether the person has the module's write access in this
  // scope (its approved `ai` hook is the route's to check first). { ok: true } or { ok: false, status, reason, why }.
  function check(who, space, purpose, door = {}) {
    if (!who) return refuse(401, 'signin');
    if (!who.user) return refuse(403, 'guest');
    const owner = hasOwnerRights(who.user);
    const perms = space ? store.spacePermissions(who.user.key, space.id) : store.roleSet(who.user.role);
    if (!owner && !perms.useAi) return refuse(403, 'role');
    if (space && space.aiOff) return refuse(403, 'space-off');
    if (purpose === 'chat') {
      if (!space) return refuse(404, 'member', `No such ${word('space')}.`);
      if (!owner && !space.members.includes(who.user.key)) return refuse(403, 'member');
      if (!perms.chat) return refuse(403, 'chat');
    } else if (purpose === 'module') {
      if (!door.write) return refuse(403, 'module');
    } else {
      throw new Error(`no AI purpose ${purpose}`);
    }
    return service();
  }

  // What a page shows before anything is asked: { available, why, reason } from the same check.
  function availability(who, space, purpose, door) {
    const r = check(who, space, purpose, door);
    return r.ok ? { available: true, why: '', reason: '' } : { available: false, why: r.why, reason: r.reason };
  }

  // The person's turn at the rate limit, taken once a question is valid: { ok } or a 429 refusal with retrySeconds.
  function takeTurn(who) {
    const r = limits.take(LIMIT_KEY, who.user.key, 'ai');
    return r.ok ? { ok: true } : { ...refuse(429, 'limit'), retrySeconds: r.retrySeconds };
  }
  const giveBack = (who) => limits.refund(LIMIT_KEY, who.user.key, 'ai');

  // The setting in force for an ask in `space` (null: no space).
  function sees(space) {
    const enabled = modules.enabledAll().map(({ manifest }) => manifest.id);
    return effectiveSees(ai.config.sees, space && space.aiSees ? space.aiSees : null, enabled);
  }

  // The exact secrets this server holds that no prompt may carry: the OBS access key, every space's guest token, the AI key.
  function secrets() {
    const out = [];
    try { out.push(store.streamKey); } catch { /* none */ }
    for (const s of store.spaces) if (s.guestToken) out.push(s.guestToken);
    try { const k = ai.key(); if (k) out.push(k); } catch { /* none */ }
    return out.filter((s) => typeof s === 'string' && s.length >= 8);
  }

  // One object, admitted or not, for one part of the context (`part`: attached, relevant or linked). Answers
  // { ok: true, summary } (redacted; with its text when `withText`) or { ok: false, why, module? }: `why` is 'other-space' (an
  // object of another space, or of a person: never sent, whatever the setting), 'setting' (the owner's setting keeps it out)
  // or 'unreadable' (gone, or the person can't read it now: left out and never named). `from`: the module asking (purpose
  // module), which may only send its own objects and those it was approved to link to, as it may only read those.
  function admit(who, space, ref, { sees: setting, part, withText = false, secretList, from = null } = {}) {
    if (!ref || typeof ref !== 'object') return { ok: false, why: 'unreadable' };
    const moduleId = typeof ref.module === 'string' && MODULE_ID.test(ref.module) ? ref.module : '';
    const inSpace = ref.scope === 'space' && space && ref.space === space.id;
    const wide = ref.scope === 'environment';
    if (!inSpace && !wide) return { ok: false, why: 'other-space', module: moduleId };
    if (!moduleId) return { ok: false, why: 'unreadable' };
    if (!setting[part]) return { ok: false, why: 'setting', module: ref.module };
    if (wide && (setting.environment === 'never' || (setting.environment === 'attached' && part !== 'attached'))) return { ok: false, why: 'setting', module: ref.module, environment: true };
    if (!moduleAllowed(setting, ref.module)) return { ok: false, why: 'setting', module: ref.module };
    let summary;
    try {
      const own = !from || ref.module === from;
      summary = resolveRef(who, ref, own ? null : from, { withText, skipConsumer: own });
    } catch {
      return { ok: false, why: 'unreadable' };
    }
    return { ok: true, ref: summary.ref, moduleName: summary.module && summary.module.name, summary: redactSummary(summary, secretList || secrets()) };
  }

  // Bringing in pasted objects: '' or the sentence. The module's write access is the caller's (moduleAccess) to check.
  function importRefusal(who) {
    if (!who || !who.user) return sentences(word)['import-guest'];
    return '';
  }

  return { check, availability, takeTurn, giveBack, sees, admit, secrets, redact: redactText, importRefusal, sentences: () => sentences(word), service };
}

module.exports = {
  createAiPolicy, cleanSees, readSees, effectiveSees, moduleAllowed, redactText, redactSummary, sentences, PolicyError,
  SEES_KEYS, SEES_SWITCHES, SEES_DEFAULTS, ENVIRONMENT_VALUES, REDACTED_FIELDS, SENT_FIELDS, SECRET_PATTERNS,
};
