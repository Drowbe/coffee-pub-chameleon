// The words a person reads for each level and role (documentation/plans/plan-environment-templates.md, "The
// vocabulary"; documentation/plans/plan-templates-redesign.md, decisions 5, 6 and 32). The code names never change;
// only what a person reads does, and only for three of them. Each key has a singular (`one`), a plural (`many`) and,
// when the usual "a"/"an" is wrong for it, its singular with its article (`a`, such as "an hour").
//
// Most words are locked: they read the same everywhere, and neither an owner nor a template can change them (decision
// 5: environment, canvas, module, object, owner, moderator and guest; decision 32: aside; and the host's own words,
// host and admin). Only `space`, `member` and `home` may be changed (decision 6). Where one of those comes from, in
// order: the owner's own (settings.words.<key>), else the template's, else the default below. Resolved per request, so
// a change is live on the next one.
//
// `home` (plan-primary-nav.md, decision 13) is what the home page, the list of spaces, is called: it is not always the
// plural of space ("Campaigns" against "Game"). With no word of its own (the owner's, else the template's), it follows
// the resolved space word: both its forms are the space word's plural with a capital ("Spaces", "Trips"). Its entry in
// DEFAULTS is that for today's space word, and fill() has no placeholder for it. Home is the environment's, so only the
// environment's default template gives it (a template's `home` field), never a space's own template.
//
// The server's sentences that name a level or role go through word() (or fill(), for fixed text such as a
// permission's label), never a typed word: tools/check-names.mjs --words holds them to it.

const KEYS = ['host', 'environment', 'space', 'home', 'aside', 'canvas', 'module', 'object', 'admin', 'owner', 'moderator', 'member', 'guest'];
// The host's own words: always their defaults.
const FIXED = ['host', 'admin'];
// The words that may be changed, by the owner or by a template (decision 6). Every other key is locked.
const CHANGEABLE = ['space', 'home', 'member'];
const LOCKED = KEYS.filter((k) => !CHANGEABLE.includes(k));
// The words a space's own template changes inside that space: home is the environment's, so it stays the environment's.
const SPACE_KEYS = ['space', 'member'];

const capital = (text) => (text ? text.charAt(0).toLocaleUpperCase('en') + text.slice(1) : text);

// The home word when nobody set one: a resolved space word's plural, with a capital, as both its forms (today's
// space word's when none is given).
function homeDefault(space) {
  const many = capital((space && space.many) || 'spaces');
  return { one: many, many };
}

// Today's words. `a` is left out here: every default takes the usual article, worked out from its first letter.
const DEFAULTS = Object.freeze({
  host: { one: 'host', many: 'hosts' },
  environment: { one: 'environment', many: 'environments' },
  space: { one: 'space', many: 'spaces' },
  home: homeDefault(null), // worked out from the space word: see homeDefault() and resolve()
  aside: { one: 'aside', many: 'asides' },
  canvas: { one: 'canvas', many: 'canvases' },
  module: { one: 'module', many: 'modules' },
  object: { one: 'object', many: 'objects' },
  admin: { one: 'admin', many: 'admins' },
  owner: { one: 'owner', many: 'owners' },
  moderator: { one: 'moderator', many: 'moderators' },
  member: { one: 'member', many: 'members' },
  guest: { one: 'guest', many: 'guests' },
});

const MAX_LENGTH = 30;
// Plain text only: letters (any alphabet), with single spaces, hyphens and apostrophes between them.
const WORD_RE = /^\p{L}[\p{L}\p{M}]*(?:(?: |-|'|’)\p{L}[\p{L}\p{M}]*)*$/u;
const ARTICLE_RE = /^\p{L}{1,10}$/u; // the article itself: one word of up to ten letters

const tidy = (v) => String(v).trim().replace(/\s+/g, ' ');
const usualArticle = (one) => `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`;

// What a refusal calls a key: its code name, except home, which is named for the page ("the word for the home page").
const SAID = { home: 'the home page' };

// One word as given ({ one, many, a? }), checked: { word } (tidied, `a` kept only when given) or { error }, one sentence.
function cleanWord(code, raw) {
  const key = SAID[code] || code;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `The word for ${key} must be its singular and plural, or null to use the default.` };
  const extra = Object.keys(raw).find((f) => !['one', 'many', 'a'].includes(f));
  if (extra) return { error: `The word for ${key} takes only one, many and a.` };
  if (typeof raw.one !== 'string' || typeof raw.many !== 'string' || !tidy(raw.one) || !tidy(raw.many)) return { error: `The word for ${key} needs both its singular and its plural.` };
  const one = tidy(raw.one);
  const many = tidy(raw.many);
  if (one.length > MAX_LENGTH || many.length > MAX_LENGTH) return { error: `The word for ${key} can be at most ${MAX_LENGTH} characters.` };
  if (!WORD_RE.test(one) || !WORD_RE.test(many)) return { error: `The word for ${key} can use only letters, spaces, hyphens and apostrophes.` };
  const word = { one, many };
  if (raw.a !== undefined && raw.a !== null && tidy(raw.a) !== '') {
    const a = typeof raw.a === 'string' ? tidy(raw.a) : '';
    const article = a.endsWith(` ${one}`) ? a.slice(0, -(one.length + 1)) : '';
    if (!ARTICLE_RE.test(article)) {
      return { error: `The word for ${key} with its article must be its singular with the article in front, such as "a ${one}".` };
    }
    word.a = a;
  }
  return { word };
}

// The sentence for a locked word (decisions 5 and 32).
const lockedWord = (key) => `The ${key} word reads the same everywhere, so it can't be changed.`;

// The owner's words after a change: `patch` is { <key>: { one, many, a? } | null }, null returning that key to the
// template's word or the default. Answers { words } (the whole new set, keys in vocabulary order; {} when none are the
// owner's own) or { error }, one sentence; on an error nothing is changed.
function applyPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'Words must be given by name, each with its singular and plural.' };
  const next = { ...ownOnly(current) };
  for (const [key, raw] of Object.entries(patch)) {
    if (FIXED.includes(key)) return { error: `The ${key} word is the host's own and can't be changed.` };
    if (LOCKED.includes(key)) return { error: lockedWord(key) };
    if (!CHANGEABLE.includes(key)) return { error: `There is no word called ${String(key).slice(0, 40)}; the words you can change are ${CHANGEABLE.join(', ')}.` };
    if (raw === null) { delete next[key]; continue; }
    const { word, error } = cleanWord(key, raw);
    if (error) return { error };
    next[key] = word;
  }
  return { words: Object.fromEntries(CHANGEABLE.filter((k) => next[k]).map((k) => [k, next[k]])) };
}

// A stored set, keeping only the changeable keys whose words are still good (a hand-edited file reads as far as it can).
function ownOnly(set) {
  if (!set || typeof set !== 'object' || Array.isArray(set)) return {};
  const out = {};
  for (const key of CHANGEABLE) {
    if (set[key] === undefined || set[key] === null) continue;
    const { word } = cleanWord(key, set[key]);
    if (word) out[key] = word;
  }
  return out;
}

// Every key's words, resolved: the owner's, else the template's, else the default, for the changeable keys; every
// locked key always its default. Each is { one, many, a }, `a` filled in with the usual article when the word did not give its own.
function resolve(ownerWords, templateWords) {
  const owner = ownOnly(ownerWords);
  const template = ownOnly(templateWords);
  const out = {};
  for (const key of KEYS) {
    const fallback = key === 'home' ? homeDefault(out.space) : DEFAULTS[key]; // `space` comes before `home` in KEYS
    const w = (CHANGEABLE.includes(key) && (owner[key] || template[key])) || fallback;
    out[key] = { one: w.one, many: w.many, a: w.a || usualArticle(w.one) };
  }
  return out;
}

const DEFAULT_RESOLVED = resolve(null, null);

// One key's word from a resolved set: the singular, `many` the plural, `a` the singular with its article; `cap` gives
// it a capital first letter. An unknown key is a mistake in the code, so it throws.
function format(resolved, key, { many = false, cap = false, a = false } = {}) {
  const w = (resolved && resolved[key]) || DEFAULT_RESOLVED[key];
  if (!w) throw new Error(`There is no word called ${key}.`);
  const text = a ? w.a : many ? w.many : w.one;
  return cap ? capital(text) : text;
}

// Whose words word() reads: set once by the server to the current request's environment (null outside one, which
// reads the defaults).
let current = () => null;
function useCurrent(fn) { current = typeof fn === 'function' ? fn : () => null; }

// The word for a level or role in the current environment's words: word('space'), word('space', { many: true, cap:
// true }), word('aside', { a: true }).
function word(key, options) {
  return format(current() || DEFAULT_RESOLVED, key, options);
}

// Fixed text (a permission's label, a built-in module's description) with its level and role words as placeholders
// in their default form: {space}, {spaces}, {Space}, {Spaces}, {a space}, {A space} ({an aside}: either article reads the
// word's own). Each is replaced by the current
// environment's word, in the same form; anything else in braces is left as it is.
// `home` has none: its default is the space word's ("Spaces"), which reads the space word.
const BY_DEFAULT = new Map(KEYS.filter((k) => k !== 'home').flatMap((k) => [[DEFAULTS[k].one, { key: k, many: false }], [DEFAULTS[k].many, { key: k, many: true }]]));
const PLACEHOLDER = /\{((?:a|an|A|An) )?([A-Za-z]+)\}/g;
function fill(text, resolved) {
  const set = resolved || current() || DEFAULT_RESOLVED;
  return String(text).replace(PLACEHOLDER, (whole, article, name) => {
    const found = BY_DEFAULT.get(name.toLowerCase());
    if (!found || (article && found.many)) return whole;
    const cap = article ? article.charAt(0) === 'A' : name.charAt(0) !== name.charAt(0).toLowerCase();
    return format(set, found.key, { many: found.many, a: Boolean(article), cap });
  });
}

// --- verbs (addendum 4; plan-templates-redesign.md, decisions 5 and 32) --------------------------------------------
// The actions a person reads on a button: the space's Enter and the space bar's Layout. Both are locked: they read the
// same everywhere, and neither an owner nor a template changes them. A verb is not a level or role, so it is kept out of
// `words` and the Names vocabulary. The key is a code name and never changes.
const VERBS = ['enter', 'layout'];
const DEFAULT_VERBS = Object.freeze({ enter: 'Enter', layout: 'Layout' });
const LOCKED_VERBS = 'The enter and layout verbs read the same everywhere, so they can\'t be changed.';

// Every verb: the defaults. { enter: "Enter", layout: "Layout" }.
function resolveVerbs() {
  return { ...DEFAULT_VERBS };
}

module.exports = {
  KEYS, FIXED, LOCKED, SPACE_KEYS, CHANGEABLE, DEFAULTS, MAX_LENGTH, homeDefault, cleanWord, applyPatch, ownOnly, resolve, format, word, fill, useCurrent, lockedWord,
  VERBS, DEFAULT_VERBS, LOCKED_VERBS, resolveVerbs,
};
