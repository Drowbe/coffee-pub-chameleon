// The AI service of an environment: one setting an owner makes (its own service, or one the host offers), never a module's.
// The server holds the key and the address; a page never sees either. What is said to a model lives in the prompt registry
// (server/prompts/), who may ask and what may be sent in the policy layer (server/ai-policy.js), the context in
// server/ai-context.js, and the request shapes in the provider adapters (server/ai-providers.js). This file keeps the
// setting, the key, the month's usage, the call records and `run`: render, then the adapter, then parse, then record
// (plan-ai-integration.md, "Slice 1").
//
// The model is given no tools and its answer is only text or JSON: nothing it says is run.
//
// Files: DATA_DIR/ai.json (the setting, kept private to the server's user), DATA_DIR/ai-usage.json (this month's tokens and
// calls, by task, template version, person and space) and DATA_DIR/ai-log.jsonl (a record per call, no content, kept 30 days).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { encryptSecret, decryptSecret } = require('./auth');
const { assertAddressAllowed, guardFrom, AiNetError } = require('./ai-http');
const { AiError, HOSTS, DEFAULT_MODELS, ADDRESS_UNUSABLE, checkTypedKey, listModelsFor, complete } = require('./ai-providers');
const prompts = require('./prompts');
const { cleanSees, readSees, PolicyError, SEES_DEFAULTS, cleanAnswerText, cleanAnswerObject } = require('./ai-policy');
const { CHAT_LIMITS } = require('./chat-history');

// A key kept at rest is encrypted (AES-256-GCM, server/auth.js's encryptSecret: 'aesgcm$...'). The sentence shown
// when a saved one can't be read with this server's key -- data restored onto a different host, say, which has a
// different secrets key: the key has to be set again, the way a two-step sign-in has to be enrolled again.
const ENCRYPTED = 'aesgcm$';
const isEncrypted = (v) => typeof v === 'string' && v.startsWith(ENCRYPTED);
const KEY_UNREADABLE = "the saved AI key can't be read on this server; enter the key again";
// The stored form of a key: encrypted with `buf` when there is one and it is not already; '' stays ''.
function sealKey(value, buf) {
  if (!value || !buf || isEncrypted(value)) return value || '';
  return encryptSecret(value, buf);
}
// The usable form of a stored key: { key, unreadable }. A plain value (saved before keys were encrypted, or with
// no secrets key to encrypt with) is used as it is; an encrypted one that won't decrypt is '' and unreadable.
function openKey(stored, buf) {
  if (!stored) return { key: '', unreadable: false };
  if (!isEncrypted(stored)) return { key: stored, unreadable: false };
  const plain = buf ? decryptSecret(stored, buf) : null;
  return plain === null ? { key: '', unreadable: true } : { key: plain, unreadable: false };
}

// none; openai and anthropic are those companies (the host knows their addresses, so nobody types them); compatible is any other
// service that speaks the OpenAI chat interface (a model server on the admin's network, or another company), whose address is typed.
const PROVIDERS = ['none', 'openai', 'anthropic', 'compatible'];
const SOURCES = ['managed', 'custom'];
// The companies the host may offer a managed service for (documentation/plans/plan-environments.md, "Managed AI,
// per company") -- PROVIDERS minus 'none', in the order a fresh environment picks its first offered one.
const MANAGED_PROVIDERS = ['openai', 'anthropic', 'compatible'];
const TASKS = prompts.TASKS;
const MAX_ITEMS = prompts.MAX_MATERIAL;
const LOG_DAYS = 30;
// The longest answer text, with its cut-off note, that is returned and kept: what a stored AI message may hold.
const MAX_ANSWER_TEXT = CHAT_LIMITS.MAX_AI_TEXT;
const NO_ANSWER = 'The AI service gave no answer.';

// An answer's text cut to fit MAX_ANSWER_TEXT, never in the middle of a {{summary:N}} place or a surrogate pair. `cut`: the
// answer was cut (here, by the provider or mid-object); the page says so from it, so no note is added to the text.
function fitAnswer(text, cut) {
  let t = String(text || '');
  if (t.length > MAX_ANSWER_TEXT) {
    t = t.slice(0, MAX_ANSWER_TEXT);
    if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
    t = t.replace(/\{\{[^}]*$/, '').trimEnd();
    cut = true;
  }
  return { text: t, cut: Boolean(cut) };
}
const oneLine = (s, n) => String(s == null ? '' : s).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const month = () => new Date().toISOString().slice(0, 7);
const OVER_CAP = 'This server has used its AI allowance for the month.';
const emptyUsage = () => ({ month: month(), tokens: 0, calls: 0, byTask: {}, byTemplate: {}, byPerson: {}, bySpace: {} });
// The service a structured-output refusal is remembered for: provider, address and model (never the key).
const fingerprint = (c) => crypto.createHash('sha256').update(`${c.provider}|${c.address || ''}|${c.model || ''}`).digest('hex').slice(0, 16);
// The fields a call record may hold (Ai.log); nothing else is ever written to ai-log.jsonl.
const LOG_FIELDS = ['at', 'environment', 'space', 'person', 'purpose', 'template', 'provider', 'model', 'mode', 'tokensIn', 'tokensOut', 'finish', 'ms', 'outcome', 'reason', 'error', 'cut', 'sent', 'leftOut'];
// An organisation-level Anthropic key needs an anthropic-workspace-id header naming the workspace (an id, not a
// secret -- fine to show on a page). Other providers ignore it.
const WORKSPACE_RE = /^[A-Za-z0-9_-]{1,100}$/;
function cleanWorkspace(raw) {
  const w = String(raw ?? '').trim().slice(0, 100);
  if (!w) return '';
  if (!WORKSPACE_RE.test(w)) throw new AiError('a workspace id is letters, digits, underscore and dash only');
  return w;
}

// A provider, an address, a model and a key made to fit together -- the part of a setting shared by an
// environment's own (Ai.set, its custom slot) and the host's managed service (HostRegistry.setManagedAi): same
// rules, since the same four fields mean the same thing in both places. `key` is replaced only when a
// non-empty string is sent (a page that shows "set" sends nothing); `clearKey` removes it.
function applyAiFields(current, patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  checkTypedKey(p.key);
  const next = { provider: current.provider, address: current.address, model: current.model, key: current.key, workspace: current.workspace || '' };
  if (p.provider !== undefined) {
    if (!PROVIDERS.includes(p.provider)) throw new AiError('choose none, an OpenAI-compatible service or Anthropic');
    next.provider = p.provider;
  }
  if (p.address !== undefined) {
    const a = String(p.address || '').trim();
    if (a) {
      let u;
      try { u = new URL(a); } catch { throw new AiError('that address is not valid'); }
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new AiError('the address must be http or https, without a user name or password');
      next.address = u.href.replace(/\/$/, '');
    } else next.address = '';
  }
  if (p.model !== undefined) next.model = oneLine(p.model, 100);
  if (typeof p.key === 'string' && p.key.trim()) next.key = p.key.trim().slice(0, 300);
  if (p.clearKey === true) next.key = '';
  if (p.workspace !== undefined) next.workspace = cleanWorkspace(p.workspace);
  if (next.provider === 'openai' || next.provider === 'anthropic') next.address = ''; // the company's own address, already known here
  // A saved key belongs to the service and address it was saved for: change either and it is dropped, never sent somewhere new.
  // A key typed in the same request is the person's choice for the new address.
  const typedKey = typeof p.key === 'string' && p.key.trim();
  if ((next.provider !== current.provider || next.address !== (current.address || '')) && !typedKey) next.key = '';
  if (next.provider === 'compatible' && !next.address) throw new AiError('another service needs its address');
  if ((next.provider === 'openai' || next.provider === 'anthropic') && !next.key) throw new AiError('this service needs a key');
  if (next.provider !== 'none' && !next.model) throw new AiError('say which model to use');
  return next;
}

// One company's own slot in the host's managed AI (documentation/plans/plan-environments.md, "Managed AI, per
// company"): openai and anthropic keep a model and a key (their address is always the company's own, never
// stored); compatible keeps an address too. `key` replaces only when a non-empty string is sent; `clearKey`
// removes it. Used by HostRegistry.setManagedAi -- the validation an environment's own custom slot has,
// scoped to one company at a time.
function applyManagedFields(provider, current, patch) {
  if (!MANAGED_PROVIDERS.includes(provider)) throw new AiError('choose openai, anthropic or compatible');
  const p = patch && typeof patch === 'object' ? patch : {};
  checkTypedKey(p.key);
  const next = { model: current.model || '', key: current.key || '', ...(provider === 'compatible' ? { address: current.address || '' } : {}), ...(provider === 'anthropic' ? { workspace: current.workspace || '' } : {}) };
  if (provider === 'compatible' && p.address !== undefined) {
    const a = String(p.address || '').trim();
    if (a) {
      let u;
      try { u = new URL(a); } catch { throw new AiError('that address is not valid'); }
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new AiError('the address must be http or https, without a user name or password');
      next.address = u.href.replace(/\/$/, '');
    } else next.address = '';
    if (next.address !== (current.address || '') && !(typeof p.key === 'string' && p.key.trim())) next.key = ''; // a saved key stays with its address
  }
  if (p.model !== undefined) next.model = oneLine(p.model, 100);
  if (typeof p.key === 'string' && p.key.trim()) next.key = p.key.trim().slice(0, 300);
  if (p.clearKey === true) next.key = '';
  if (provider === 'anthropic' && p.workspace !== undefined) next.workspace = cleanWorkspace(p.workspace);
  return next;
}

// Whether a company's slot -- its saved model/key/address plus a live environment-variable key -- is offered
// right now: a key (or, for compatible, an address) and a model, falling back to DEFAULT_MODELS when a key is
// set but no model has been saved yet (a key alone is enough to get going). `slot`: { model, key, address },
// whatever applies right now (server/index.js's managedSlot combines what is saved with the live env vars
// before calling this); `envKey`: the live override, already resolved, winning over a saved key when set.
// Returns the real offer -- including the key, for making calls -- or null.
function managedOffer(provider, slot, envKey) {
  const key = envKey || (slot && slot.key) || '';
  const address = provider === 'compatible' ? ((slot && slot.address) || '') : '';
  if (provider === 'compatible' ? !address : !key) return null;
  const model = (slot && slot.model) || DEFAULT_MODELS[provider] || '';
  if (!model) return null;
  return { provider, model, address, key, workspace: provider === 'anthropic' ? ((slot && slot.workspace) || '') : '' };
}

class Ai {
  // `managed` is a function returning the host's offered companies -- [{ provider, address, model, key }]
  // (real keys, for making calls; never exposed by view()), in offer order, or null when the host offers none.
  // AI_KEY moved to the host: an environment's own custom slot no longer has an environment-variable fallback
  // of its own.
  // `secretsKey`: a function returning (or a Buffer that is) the 32-byte key this environment's own AI key is
  // encrypted with in ai.json (server/index.js's secretsKeyBuf). Without one (a test) the key is kept as given.
  constructor(dataDir, env = process.env, hosts = HOSTS, managed = () => null, secretsKey = null) {
    this.hosts = { ...HOSTS, ...hosts };
    this.managed = managed;
    this.secretsKey = secretsKey;
    this.file = path.join(dataDir, 'ai.json');
    this.usageFile = path.join(dataDir, 'ai-usage.json');
    this.logFile = path.join(dataDir, 'ai-log.jsonl');
    this.env = env;
    // On a host with environments an owner types this environment's address, so requests to it are guarded (server/ai-http.js);
    // a single-environment install's admin is trusted with their own network. The host's managed services are never guarded.
    this.hosted = Boolean(env && env.BASE_DOMAIN);
    this.config = { source: undefined, managedProvider: '', provider: 'none', address: '', model: '', key: '', workspace: '', monthlyTokens: 0 };
    this.usage = emptyUsage();
    let loaded = false;
    try { Object.assign(this.config, JSON.parse(fs.readFileSync(this.file, 'utf8'))); loaded = true; } catch { /* not set up */ }
    // Kept private to the server's user on every load, whatever mode an older install, a restore or a copy left it with.
    if (loaded) { try { fs.chmodSync(this.file, 0o600); } catch { /* not ours to change */ } }
    try { const u = JSON.parse(fs.readFileSync(this.usageFile, 'utf8')); if (u && u.month === month()) this.usage = { ...this.usage, ...u }; } catch { /* nothing used yet */ }
    if (!PROVIDERS.includes(this.config.provider)) this.config.provider = 'none';
    // Before there were companies to choose, `openai` meant any OpenAI-compatible address: one that is not OpenAI's own is `compatible`.
    if (this.config.provider === 'openai') {
      if (this.config.address && !/^https:\/\/api\.openai\.com(\/|$)/.test(this.config.address)) this.config.provider = 'compatible';
      else this.config.address = '';
    }
    if (this.config.provider === 'anthropic') this.config.address = '';
    // A setting saved before there was an enable step, with a service chosen, counts as enabled; nothing else does.
    if (typeof this.config.enabled !== 'boolean') this.config.enabled = this.config.provider !== 'none';
    // The managed/custom choice, decided once and saved: a file from before it existed, with its own saved
    // provider and model but no saved key (it worked only through the old per-environment AI_KEY), becomes
    // managed, landing in that same company's own slot -- migrationSeed() below is read once by index.js to
    // give the host's managed service a starting point there if it has nothing saved yet for it. A file with
    // its own saved key stays custom. A brand-new environment (no file at all) starts managed on the first
    // offered company (managed() returns them in offer order), else custom.
    this._migrationSeed = null;
    if (!SOURCES.includes(this.config.source)) {
      if (!loaded) {
        const offers = this.managed();
        if (offers && offers.length) { this.config.source = 'managed'; this.config.managedProvider = offers[0].provider; }
        else this.config.source = 'custom';
      } else if (this.config.provider !== 'none' && this.config.model && !this.config.key) {
        this._migrationSeed = { provider: this.config.provider, address: this.config.address, model: this.config.model };
        this.config.source = 'managed';
        this.config.managedProvider = this.config.provider;
      } else {
        this.config.source = 'custom';
      }
      this.saveConfig();
    }
    if (this.config.source === 'custom' && this.config.provider === 'none') this.config.enabled = false;
    // A key saved in the clear (before keys were encrypted at rest) is encrypted now and saved straight away, so
    // ai.json never holds a plain key once this server has loaded it.
    if (typeof this.config.key !== 'string') this.config.key = '';
    if (this.config.key && !isEncrypted(this.config.key) && this.keyBuf()) {
      this.config.key = sealKey(this.config.key, this.keyBuf());
      this.saveConfig();
    }
    // What AI may see (`sees`): only the keys that clean are kept; absent means the defaults (server/ai-policy.js).
    this.config.sees = readSees(this.config.sees);
    this.timer = null;
    // The tokens reserved by asks on their way (ai-29) and how many are on their way, in memory.
    this.reserved = 0;
    this.pending = 0;
    this.pruneLog();
  }

  // The secrets key as a Buffer, or null when this instance was given none.
  keyBuf() {
    const k = typeof this.secretsKey === 'function' ? this.secretsKey() : this.secretsKey;
    return k || null;
  }

  // Read once by index.js right after construction, to seed the host's managed service from an environment
  // that just migrated to it -- see the constructor. Never used again by the Ai instance itself.
  migrationSeed() {
    return this._migrationSeed;
  }

  // Whichever the host currently offers for the chosen managedProvider, or null. Takes a company to check
  // instead of this.config's own when given, so set()/previewEnabled() can ask "would this candidate config
  // have an offer" before committing to it.
  managedOffer(managedProvider = this.config.managedProvider) {
    return (this.managed() || []).find((o) => o.provider === managedProvider) || null;
  }

  // The active provider, address, model and key: the host's chosen managed offer when that is the source, this
  // environment's own custom slot otherwise. { provider: 'none', ... } when managed is chosen but the host no
  // longer offers that company (an admin turned it off, or removed its key, after this environment chose it).
  // Takes a candidate config instead of this.config's own for the same reason managedOffer does.
  effective(config = this.config) {
    if (config.source === 'managed') {
      const o = this.managedOffer(config.managedProvider);
      return o ? { provider: o.provider, address: o.address || '', model: o.model, key: o.key || '', workspace: o.workspace || '' } : { provider: 'none', address: '', model: '', key: '', workspace: '' };
    }
    const { key, unreadable } = openKey(config.key, this.keyBuf());
    return { provider: config.provider, address: config.address, model: config.model, key, workspace: config.workspace || '', ...(unreadable ? { keyUnreadable: true } : {}) };
  }

  // Whether a config names an active, key-ready service -- same as ready() minus the enabled flag itself,
  // since set() needs to know this about a candidate config before deciding what its own enabled should
  // become (see set()'s own comment: a source/company/provider change only turns AI off when the result
  // would not be ready, not on every change).
  hasActiveService(config = this.config) {
    const c = this.effective(config);
    if (c.provider === 'none') return false;
    // A saved key this server can't read is still a key: the service stays chosen (and AI stays on) while an owner
    // saves other fields; only ready() refuses to use it, and the one complaint is the key sentence.
    if (c.keyUnreadable) return true;
    if (c.provider === 'anthropic' || c.provider === 'openai') return !!c.key;
    return true; // another service may need no key (a local model)
  }

  // The active key: whichever source is chosen, resolved through effective().
  key() {
    return this.effective().key;
  }

  // What the admin's page may see: never a key, only whether the active source has one. `provider`/`address`/
  // `model`/`keySet` describe this environment's own custom slot (kept even while managed is chosen, so
  // switching back to custom does not lose it); `managed` describes the host's offer (every company it has,
  // never a key); `managedProvider` is which one this environment has chosen. `keyFromEnvironment` is always
  // false now: AI_KEY (and AI_OPENAI_KEY/AI_ANTHROPIC_KEY) seed the host's managed service, not an
  // environment's own custom one. `active` is the service actually in use, whichever the source: provider
  // 'none' when nothing is (a page deciding "set up or not" reads this, not the custom slot's provider).
  view() {
    const c = this.config;
    const offers = this.managed() || [];
    const active = this.effective();
    const unreadable = openKey(c.key, this.keyBuf()).unreadable;
    return {
      source: c.source,
      active: { provider: active.provider, model: active.model },
      managedProvider: c.managedProvider,
      managed: { available: offers.length > 0, services: offers.map((o) => ({ provider: o.provider, model: o.model })) },
      provider: c.provider,
      address: c.address,
      model: c.model,
      workspace: c.workspace || '', // an id, not a secret -- fine to show
      monthlyTokens: c.monthlyTokens,
      keySet: !!c.key && !unreadable, // a saved key this server can't read counts as none: it has to be entered again
      keyUnreadable: unreadable,
      keyProblem: unreadable ? KEY_UNREADABLE : null, // one plain sentence for the AI settings to show, or null
      keyFromEnvironment: false,
      enabled: c.enabled,
      // What AI may see, the environment's choice (server/ai-policy.js): every key, the defaults where none is saved.
      sees: { ...SEES_DEFAULTS, ...readSees(c.sees) },
    };
  }

  // Change the setting. `key` is replaced only when a non-empty string is sent (a page that shows "set" sends nothing); `clearKey`
  // removes it. An address must be http or https, without a user name or password. `source` picks managed
  // (refused when the host offers none) or custom; changing it, like changing the custom provider, switches AI
  // off until the admin enables it again, since a different source can mean a different company entirely.
  set(patch) {
    const p = patch || {};
    const next = { ...this.config };
    // Whether this patch changes source, company or provider at all -- used below to decide what happens to
    // `enabled`, not to force it off on the spot the way this used to (the author's testing: switching between
    // two already-working services, Managed Anthropic to Managed OpenAI say, should not need re-enabling).
    const sourceOrProviderChanged = (p.source !== undefined && p.source !== next.source) || (p.managedProvider !== undefined && p.managedProvider !== next.managedProvider) || (p.provider !== undefined && p.provider !== next.provider);
    if (p.source !== undefined) {
      if (!SOURCES.includes(p.source)) throw new AiError('source must be "managed" or "custom"');
      next.source = p.source;
    }
    if (p.managedProvider !== undefined) {
      if (!MANAGED_PROVIDERS.includes(p.managedProvider)) throw new AiError('choose openai, anthropic or compatible');
      next.managedProvider = p.managedProvider;
    }
    // Choosing managed with a company -- naming the source, or the company, while managed -- needs that company
    // actually offered right now; saving something unrelated (the monthly cap, say) while an already-chosen
    // company quietly stopped being offered is not an error, only a silent drop to no effective provider (see
    // effective()).
    if (next.source === 'managed' && (p.source !== undefined || p.managedProvider !== undefined) && !(this.managed() || []).some((o) => o.provider === next.managedProvider)) {
      throw new AiError('the host does not offer that company');
    }
    Object.assign(next, applyAiFields(next, p));
    next.key = sealKey(next.key, this.keyBuf()); // a key just typed is kept encrypted, never in the clear
    // What AI may see: the keys sent replace those saved; null goes back to the defaults. A bad key or value is a 400.
    if (p.sees !== undefined) {
      if (p.sees === null) next.sees = {};
      else {
        try { next.sees = { ...readSees(next.sees), ...cleanSees(p.sees) }; } catch (err) { if (err instanceof PolicyError) throw new AiError(err.message, 400); throw err; }
      }
    }
    if (p.monthlyTokens !== undefined) {
      const n = Number(p.monthlyTokens);
      if (!Number.isFinite(n) || n < 0 || n > 1e10) throw new AiError('the monthly limit must be a number of tokens, 0 for none');
      next.monthlyTokens = Math.floor(n);
    }
    // A source/company/provider change keeps `enabled` as it was whenever the result is ready to answer with
    // (a managed company the host offers, or a custom provider with its key); it only turns `enabled` off when
    // the result is not ready (provider none, an unoffered managed company, a keyless custom provider).
    // "Setting a service up does not turn AI on" still holds: an environment that has never enabled stays off.
    if (sourceOrProviderChanged && !this.hasActiveService(next)) next.enabled = false;
    if (p.enabled !== undefined) {
      if (p.enabled === true && !this.config.enabled && this.effective(next).keyUnreadable) throw new AiError(KEY_UNREADABLE); // turning on with a key it can't use
      if (p.enabled === true && !this.hasActiveService(next)) throw new AiError('choose a service and save it before enabling AI');
      next.enabled = p.enabled === true;
    }
    if (next.source === 'custom' && next.provider === 'none') next.enabled = false;
    if (next.source === 'managed' && !(this.managed() || []).some((o) => o.provider === next.managedProvider)) next.enabled = false;
    this.config = next;
    this.saveConfig();
    return this.view();
  }

  saveConfig() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.config), { mode: 0o600 });
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      throw new AiError('the setting could not be saved', 500);
    }
  }

  // Whether a patch, if applied, would leave AI enabled: for a caller (a module's enable check, the cascade when the admin turns
  // AI off) that needs to know before committing to it. Mirrors set()'s own enabled rules without changing anything -- built the
  // same way, over a candidate config, rather than duplicating the rule by hand; applyAiFields may throw on a bad patch, which
  // previews as "would not end up ready" here rather than raising, since set() itself is what actually refuses it.
  previewEnabled(patch) {
    const p = patch || {};
    const next = { ...this.config };
    const sourceOrProviderChanged = (p.source !== undefined && p.source !== next.source) || (p.managedProvider !== undefined && p.managedProvider !== next.managedProvider) || (p.provider !== undefined && p.provider !== next.provider);
    if (p.source !== undefined && SOURCES.includes(p.source)) next.source = p.source;
    if (p.managedProvider !== undefined && MANAGED_PROVIDERS.includes(p.managedProvider)) next.managedProvider = p.managedProvider;
    try {
      Object.assign(next, applyAiFields(next, p));
    } catch {
      // A patch set() would actually refuse (openai with no key, say) never saves at all -- conservatively
      // not ready, rather than judging readiness by whatever the untouched, pre-patch fields still say.
      return false;
    }
    if (sourceOrProviderChanged && !this.hasActiveService(next)) next.enabled = false;
    if (p.enabled !== undefined) next.enabled = p.enabled === true;
    if (!this.hasActiveService(next)) next.enabled = false;
    return next.enabled;
  }

  // Ready to answer: the active source has a provider chosen, this environment has it enabled, and, for a
  // hosted provider, there is a key.
  ready() {
    return this.config.enabled && this.hasActiveService() && !this.effective().keyUnreadable;
  }

  // This month's usage: tokens and calls, and tokens by task, by template version, by person and by space.
  usageView() {
    this.rollMonth();
    const u = this.usage;
    return { month: u.month, tokens: u.tokens, calls: u.calls, byTask: u.byTask, byTemplate: u.byTemplate, byPerson: u.byPerson, bySpace: u.bySpace, monthlyTokens: this.config.monthlyTokens };
  }

  rollMonth() {
    if (this.usage.month !== month()) this.usage = emptyUsage();
  }

  // Over the month's allowance, counting what asks on their way have reserved (ai-29) and, when given, the estimate of the
  // ask about to be sent: an ask is sent only when it fits beside those already on their way.
  overCap(estimate = 0) {
    this.rollMonth();
    if (!(this.config.monthlyTokens > 0)) return false;
    const used = this.usage.tokens + this.reserved;
    return estimate > 0 ? used + estimate > this.config.monthlyTokens : used >= this.config.monthlyTokens;
  }

  // How many asks are on their way (the host's calls cap counts them, so two at once can't pass it together).
  inFlight() {
    return this.pending;
  }

  // Reserves `tokens` of the allowance for an ask about to be sent; the answer settles it (release, then record).
  reserve(tokens) {
    const n = Math.max(0, Math.floor(tokens) || 0);
    this.reserved += n;
    this.pending += 1;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.reserved = Math.max(0, this.reserved - n);
      this.pending = Math.max(0, this.pending - 1);
    };
  }

  // Counts one call's tokens: `use` is { task, template, person, space } (each optional but task).
  record(use, tokens) {
    const u = typeof use === 'string' ? { task: use } : use || {};
    this.rollMonth();
    const n = Math.max(0, Math.floor(tokens) || 0);
    this.usage.tokens += n;
    this.usage.calls += 1;
    const add = (map, key) => { if (key) map[key] = (map[key] || 0) + n; };
    add(this.usage.byTask, u.task);
    add(this.usage.byTemplate, u.template);
    add(this.usage.byPerson, u.person);
    add(this.usage.bySpace, u.space);
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 3000);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try { fs.writeFileSync(this.usageFile, JSON.stringify(this.usage)); } catch { /* a convenience */ }
  }

  // --- the call records (plan-ai-integration.md, "Observability") --------------------------------------------------------
  // One line per call in ai-log.jsonl, kept 30 days: when, the environment, space, person, purpose, template and version,
  // provider and model, tokens, the finish reason, how long it took, the outcome and the counts of what was sent. Never the
  // key, a header, the question, the material or the answer: only the fields named in LOG_FIELDS are written.
  log(record) {
    const line = { at: new Date().toISOString() };
    for (const k of LOG_FIELDS) if (record[k] !== undefined && record[k] !== null && record[k] !== '') line[k] = record[k];
    try { fs.appendFileSync(this.logFile, `${JSON.stringify(line)}\n`, { mode: 0o600 }); } catch { /* a convenience */ }
  }

  // The records of the last 30 days, oldest first.
  records() {
    let text = '';
    try { text = fs.readFileSync(this.logFile, 'utf8'); } catch { return []; }
    const since = Date.now() - LOG_DAYS * 864e5;
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { const r = JSON.parse(line); if (Date.parse(r.at) >= since) out.push(r); } catch { /* a torn line */ }
    }
    return out;
  }

  // Drops records older than 30 days (on start, and at most once a day after).
  pruneLog() {
    this.prunedAt = Date.now();
    let text;
    try { text = fs.readFileSync(this.logFile, 'utf8'); } catch { return; }
    const kept = this.records();
    if (kept.length === text.split('\n').filter(Boolean).length) return;
    try {
      fs.writeFileSync(`${this.logFile}.tmp`, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''), { mode: 0o600 });
      fs.renameSync(`${this.logFile}.tmp`, this.logFile);
    } catch { /* a convenience */ }
  }

  // The owner's usage view: this month's counts, refusals by reason, errors and cut-short answers, and the last 50 records.
  usageReport() {
    if (Date.now() - (this.prunedAt || 0) > 864e5) this.pruneLog();
    const m = month();
    const all = this.records();
    const thisMonth = all.filter((r) => String(r.at).slice(0, 7) === m);
    const count = (list, key) => list.reduce((o, r) => { const k = r[key]; if (k) o[k] = (o[k] || 0) + 1; return o; }, {});
    const answered = thisMonth.filter((r) => r.outcome === 'answered');
    return {
      usage: this.usageView(),
      callsByTemplate: count(answered, 'template'),
      refusals: count(thisMonth.filter((r) => r.outcome === 'refused'), 'reason'),
      errors: count(thisMonth.filter((r) => r.outcome === 'error'), 'error'),
      cutShort: answered.filter((r) => r.cut).length,
      recent: all.slice(-50).reverse(),
    };
  }

  // Whether the saved setting in use answers with structured output: not when a compatible service refused the schema
  // for exactly this provider, address and model (decision 13: remembered until the setting changes).
  modeFor(c) {
    return this.config.schemaRefused && this.config.schemaRefused === fingerprint(c) ? 'text' : 'structured';
  }

  // One answer through a template (plan-ai-integration.md: render, then the adapter, then parse, then record).
  // `inputs`: the template's typed inputs (from the context builder); `use`: { purpose, person, space, environment, counts,
  // leftOut } for the usage and the record. Answers { text, summaries, used, tags, cut, finish, tokens, prompt, mode } (`used`
  // and `sources` as numbers; the route maps them to pointers). Throws AiError: `refund` when the service did no work.
  // `secrets`: the exact values no answer may carry back (the policy's secrets()), taken out of the answer with the rest.
  async run(templateId, inputs, use = {}, { secrets = [] } = {}) {
    const t = prompts.template(templateId);
    const name = prompts.nameOf(t);
    const started = Date.now();
    const base = { purpose: use.purpose, environment: use.environment, space: use.space, person: use.person, template: name, sent: use.counts };
    // Refused before anything is sent: the turn is given back.
    const refused = (err, reason) => { this.log({ ...base, outcome: 'refused', reason }); return err; };
    if (this.config.enabled && this.effective().keyUnreadable) throw refused(new AiError(KEY_UNREADABLE, 503, { refund: true }), 'not-set-up');
    if (!this.ready()) throw refused(new AiError('AI is not set up here.', 503, { refund: true }), 'not-set-up');
    if (this.overCap()) throw refused(new AiError(OVER_CAP, 429, { refund: true }), 'allowance');
    const c = this.effective();
    const mode = this.modeFor(c);
    const structuredRendered = prompts.render(t, inputs, { structured: true });
    const textRendered = prompts.render(t, inputs, { structured: false });
    if (this.env && this.env.AI_LOG_PROMPTS === '1' && !this.hosted) {
      // Full prompts only on purpose, never on a hosted install, never the key: the rendered messages, whose objects, chat,
      // history and question the routes and the context builder have already redacted (server/ai-policy.js redactText).
      console.log(`[ai] prompt ${name} (${mode}): ${JSON.stringify((mode === 'structured' ? structuredRendered : textRendered).messages)}`);
    }
    const estimate = Math.ceil(textRendered.messages.reduce((n, m) => n + m.content.length, 0) / 4) + t.budget.answer;
    // The allowance with this ask in it: refused (and given back) when it would not fit beside those on their way.
    if (this.overCap(estimate)) throw refused(new AiError(OVER_CAP, 429, { refund: true }), 'allowance');
    const release = this.reserve(estimate);
    const record = { ...base, provider: c.provider, model: c.model };
    let out;
    try {
      const guard = this.config.source === 'custom' && c.provider === 'compatible' ? this.guard() : null;
      out = await complete(c, { structuredRendered, textRendered, mode }, { hosts: this.hosts, guard });
    } catch (err) {
      release();
      // A failed ask the service reported tokens for (a blank answer, say) is still counted against the month's allowance.
      if (err instanceof AiError && err.tokens > 0) this.record({ task: t.id, template: name, person: use.person, space: use.space }, err.tokens);
      this.log({ ...record, outcome: 'error', error: (err instanceof AiError && err.kind) || 'error', ms: Date.now() - started, tokensIn: (err && err.tokens) || 0 });
      throw err;
    }
    release();
    if (out.schemaRefused && c.provider === 'compatible') { this.config.schemaRefused = fingerprint(c); try { this.saveConfig(); } catch { /* remembered for this run */ } }
    else if (out.mode === 'structured' && this.config.schemaRefused) { delete this.config.schemaRefused; try { this.saveConfig(); } catch { /* forgotten for this run */ } }
    const total = out.tokens.in + out.tokens.out;
    const usage = { task: t.id, template: name, person: use.person, space: use.space };
    this.record(usage, total);
    const parsed = prompts.parse(t, out, inputs);
    const answered = (extra) => this.log({ ...record, model: out.model || c.model, outcome: 'answered', mode: out.mode, finish: out.finish, tokensIn: out.tokens.in, tokensOut: out.tokens.out, ms: Date.now() - started, leftOut: use.leftOut, ...extra });
    if (t.output === 'tags') {
      answered({ cut: parsed.cut || undefined });
      return { tags: parsed.tags, text: '', summaries: [], used: [], cut: parsed.cut, finish: out.finish, tokens: total, prompt: name, mode: out.mode };
    }
    // What a page could run or follow, and every secret, taken out of the answer and its objects before it is kept or shown.
    const summaries = (parsed.summaries || []).map((sm) => cleanAnswerObject(sm, secrets));
    let body = cleanAnswerText(parsed.text, secrets).replace(/\n{3,}/g, '\n\n').trim();
    // Objects with no words around them: their places in the text, so the answer is kept and drawn like any other.
    if (!body && summaries.length) body = summaries.map((_, i) => `{{summary:${i}}}`).join('\n');
    // No text and no objects (a list or a number where the answer goes, an empty answer): the service gave no answer. Its
    // tokens still count against the allowance, as a blank answer's do; it is not an answered call.
    if (!body) {
      this.log({ ...record, model: out.model || c.model, outcome: 'error', error: 'empty', mode: out.mode, finish: out.finish, tokensIn: out.tokens.in, tokensOut: out.tokens.out, ms: Date.now() - started });
      throw new AiError(NO_ANSWER, 502, { tokens: total, kind: 'empty' });
    }
    const fitted = fitAnswer(body, parsed.cut);
    answered({ cut: fitted.cut || undefined });
    return { text: fitted.text, summaries, used: parsed.used, cut: fitted.cut, finish: out.finish, tokens: total, prompt: name, mode: out.mode };
  }

  // The models a service offers, from its own list, for the admin's choice: [{ id, name }]. Uses the typed key
  // when given, otherwise the saved one on this environment's own custom slot (never the managed key -- the
  // host lists the managed service's own models itself, via listModelsFor directly). The saved key is tried only at the service
  // and address it was saved for: anywhere else a key has to be typed in the same request.
  async listModels({ provider, address, key, workspace }) {
    const typed = typeof key === 'string' && key.trim();
    const asked = String(address || '').trim() || this.config.address;
    const sameAddress = (a) => { try { return new URL(a).href.replace(/\/$/, '') === this.config.address; } catch { return false; } };
    const sameService = provider === this.config.provider && (provider !== 'compatible' || sameAddress(asked));
    const saved = typed || !sameService ? { key: '' } : openKey(this.config.key, this.keyBuf());
    if (!typed && sameService && saved.unreadable) throw new AiError(KEY_UNREADABLE);
    const useKey = typed || saved.key;
    const useWorkspace = (typeof workspace === 'string' && workspace.trim()) || (provider === this.config.provider ? this.config.workspace : '') || '';
    return listModelsFor({ provider, address: asked, key: useKey, workspace: useWorkspace }, this.hosts, this.guard());
  }

  // The modules switched off along with the service (index.js's PUT /api/ai): remembered here, taken back when it is switched on.
  rememberCascade(ids) {
    this.config.cascaded = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string');
    this.saveConfig();
  }

  takeCascade() {
    const ids = Array.isArray(this.config.cascaded) ? this.config.cascaded : [];
    if (ids.length) { this.config.cascaded = []; this.saveConfig(); }
    return ids;
  }

  // The guard on requests to an address an owner typed (see the constructor), or null.
  guard() {
    return guardFrom(this.env, this.hosted);
  }

  // Refuses (AiError 400) an address a hosted owner may not have the server call, before it is saved. The same check runs again
  // on every connection, so this is the early, plain answer. Nothing to check for a company's own address, managed, or off a host.
  async checkAddress(patch) {
    const p = patch || {};
    const guard = this.guard();
    if (!guard) return;
    const source = p.source !== undefined ? p.source : this.config.source;
    const provider = p.provider !== undefined ? p.provider : this.config.provider;
    const address = p.address !== undefined ? String(p.address || '').trim() : this.config.address;
    if (source !== 'custom' || provider !== 'compatible' || !address) return;
    try { await assertAddressAllowed(address, guard); } catch (err) {
      if (!(err instanceof AiNetError)) throw err;
      throw new AiError(ADDRESS_UNUSABLE);
    }
  }

}
module.exports = { Ai, AiError, OVER_CAP, MAX_ANSWER_TEXT, NO_ANSWER, fitAnswer, sealKey, openKey, KEY_UNREADABLE, applyAiFields, applyManagedFields, managedOffer, listModelsFor, PROVIDERS, MANAGED_PROVIDERS, DEFAULT_MODELS, HOSTS, TASKS, MAX_ITEMS, LOG_FIELDS };
