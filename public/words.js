// The words a person reads for each level and role, in this environment (plan-environment-templates.md, "The
// vocabulary"). The same API as the server's server/words.js, so both read alike:
//
//   word('space')                          "space"
//   word('space', { many: true, cap: true }) "Spaces"
//   word('aside', { a: true })             "an aside"  (the singular with its article; cap: true gives "An aside")
//   fill('Make {a space}')                 fixed text with {space}, {spaces}, {Space}, {Spaces}, {a space}, {A space}
//                                          placeholders, each replaced by this environment's word in the same form
//   verb('enter')                          "Enter": an action as it reads at the start of a button (addendum 4); in
//                                          fill() as {enter}
//
// In a page's markup:
//
//   <span data-word="space"></span>                          the word, filled in ("space")
//   <span data-word="space" data-word-form="many cap"></span> any of many, cap and a, space-separated ("Spaces")
//   <p data-fill>Each {space} has a {guest} link.</p>        every text in the element, and its title, placeholder,
//                                                            aria-label, alt and data-title, through fill()
//   <span data-verb="enter"></span>                          the verb, filled in ("Enter")
//
// The words come from /api/branding's `words` (loadBranding() in brand.js calls setWords), and are kept in the browser
// so the next page reads them before its own fetch answers. Until then, and when a key is missing, the defaults below:
// today's words. The code names never change; only what a person reads does.
//
// A space may read another template's words (plan-space-templates.md, step 2). Inside one space a page calls
// setSpaceLook(look) with the `look` the server sent for it, and clearSpaceLook() when the person goes Home, to another
// space or out; in between, word(), words(), verb() and fill() read the space's words for SPACE_WORDS and SPACE_VERBS and
// the environment's for every other key. The scoped set is never written to localStorage: the kept set stays the
// environment's. envWord() always reads the environment's (the switcher, the bell, Home).

export const KEYS = ['host', 'environment', 'space', 'home', 'aside', 'canvas', 'module', 'object', 'admin', 'owner', 'moderator', 'member', 'guest'];
// The two the host keeps: neither an owner nor a template changes them.
export const FIXED = ['host', 'admin'];
export const CHANGEABLE = KEYS.filter((k) => !FIXED.includes(k));

const capital = (text) => (text ? text.charAt(0).toLocaleUpperCase('en') + text.slice(1) : text);

// The home word when nobody set one, from a resolved space word: its plural with a capital, as both forms (today's
// space word's when none is given).
export function homeDefault(space) {
  const many = capital((space && space.many) || 'spaces');
  return { one: many, many };
}

export const DEFAULTS = Object.freeze({
  host: { one: 'host', many: 'hosts' },
  environment: { one: 'environment', many: 'environments' },
  space: { one: 'space', many: 'spaces' },
  // What the home page, the list of spaces, is called (plan-primary-nav.md, decision 13). With no word of its own it
  // follows the space word, as the server's: its plural with a capital ("Spaces", "Trips"); see homeDefault().
  home: homeDefault(null),
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

const STORED = 'app.words';
const usualArticle = (one) => `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`;

// A set as the server sends it ({ <key>: { one, many, a } }), made whole: a key missing or malformed reads its default,
// and host and admin always do.
function resolve(set) {
  const out = {};
  for (const key of KEYS) {
    const w = set && typeof set === 'object' && !FIXED.includes(key) ? set[key] : null;
    const good = w && typeof w.one === 'string' && w.one && typeof w.many === 'string' && w.many;
    const fallback = key === 'home' ? homeDefault(out.space) : DEFAULTS[key]; // `space` comes before `home` in KEYS
    const one = good ? w.one : fallback.one;
    const many = good ? w.many : fallback.many;
    out[key] = { one, many, a: good && typeof w.a === 'string' && w.a ? w.a : usualArticle(one) };
  }
  return out;
}

let current = resolve(null);
try {
  const kept = JSON.parse(localStorage.getItem(STORED) || 'null');
  if (kept) current = resolve(kept);
} catch {
  // no storage, or nothing kept: the defaults
}

// --- one space's own words (plan-space-templates.md, decisions 1 and 2b) ---------------------------------------------------
// The keys a space's template changes. `environment`, `owner`, `home` and the `enter` verb name things above a space and
// stay the environment's. Held in memory only.
export const SPACE_WORDS = ['space', 'aside', 'canvas', 'module', 'object', 'moderator', 'member', 'guest'];
export const SPACE_VERBS = ['layout'];
let scoped = null; // { words: { <key>: { one, many, a } }, verbs: { layout } } while inside a space whose look was read
let mixed = null; // `current` with the scoped keys over it, kept until either changes
const reading = () => {
  if (!scoped) return current;
  if (!mixed) mixed = { ...current, ...scoped.words };
  return mixed;
};

// --- verbs (plan-environment-templates.md, addendum 4) ----------------------------------------------------------------
// The actions a person reads on a button, beside the words: one string each, as it reads at the start of a label
// ("Enter", "Go to"), never lower-cased or conjugated. From /api/branding's `verbs` (loadBranding() calls setVerbs),
// kept in the browser like the words. The key is a code name and never changes.
// `layout` is the space bar's Layout button (the one that shows and hides modules on the canvas); in fill() as {layout}.
export const VERBS = ['enter', 'layout'];
export const DEFAULT_VERBS = Object.freeze({ enter: 'Enter', layout: 'Layout' });
const STORED_VERBS = 'app.verbs';

function resolveVerbs(set) {
  const out = {};
  for (const key of VERBS) {
    const v = set && typeof set === 'object' ? set[key] : null;
    out[key] = typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_VERBS[key];
  }
  return out;
}

let currentVerbs = resolveVerbs(null);
try {
  const kept = JSON.parse(localStorage.getItem(STORED_VERBS) || 'null');
  if (kept) currentVerbs = resolveVerbs(kept);
} catch {
  // no storage, or nothing kept: the defaults
}

// The whole resolved set of verbs, as this page reads them now (the space's `layout` while inside one).
export const verbs = () => (scoped ? { ...currentVerbs, ...scoped.verbs } : currentVerbs);

// One verb, as it reads at the start of a button. An unknown key is a mistake in the code, so it throws.
export function verb(key) {
  const v = verbs()[key];
  if (!v) throw new Error(`There is no verb called ${key}.`);
  return v;
}

// This environment's verbs, from /api/branding. Kept for the next page, then every data-verb, and every {enter} in a
// data-fill, is filled again. Answers whether anything changed.
export function setVerbs(set) {
  const next = resolveVerbs(set);
  const changed = JSON.stringify(next) !== JSON.stringify(currentVerbs);
  currentVerbs = next;
  try {
    const own = Object.fromEntries(VERBS.filter((k) => next[k] !== DEFAULT_VERBS[k]).map((k) => [k, next[k]]));
    if (Object.keys(own).length) localStorage.setItem(STORED_VERBS, JSON.stringify(own));
    else localStorage.removeItem(STORED_VERBS);
  } catch {
    // no storage: the next page waits for its own fetch
  }
  if (typeof document !== 'undefined') applyWords(document);
  return changed;
}

// The whole resolved set as this page reads it now, for a page that hands it on (a module's frame gets it through its
// context, which the server answers for the frame's own space).
export const words = () => reading();

// The words of one space, from the `look` the server sent for it ({ words, verbs }). Only SPACE_WORDS and SPACE_VERBS are
// taken; nothing is kept in the browser. Every data-word and data-fill is filled again.
export function setSpaceLook(look) {
  const given = look && typeof look === 'object' ? look : {};
  const set = resolve(given.words);
  const own = resolveVerbs(given.verbs);
  scoped = { words: Object.fromEntries(SPACE_WORDS.map((k) => [k, set[k]])), verbs: Object.fromEntries(SPACE_VERBS.map((k) => [k, own[k]])) };
  mixed = null;
  if (typeof document !== 'undefined') applyWords(document);
}

// Back to the environment's words (Home, another space, out of a space).
export function clearSpaceLook() {
  if (!scoped) return;
  scoped = null;
  mixed = null;
  if (typeof document !== 'undefined') applyWords(document);
}

// Whether a space's words are in force.
export const hasSpaceLook = () => scoped !== null;

// One key's word in the environment's own set, whatever space the page is in: for what is above a space (the switcher's
// heading, the bell, Home, New space).
export function envWord(key, { many = false, cap = false, a = false } = {}) {
  const w = current[key];
  if (!w) throw new Error(`There is no word called ${key}.`);
  const text = a ? w.a : many ? w.many : w.one;
  return cap ? capital(text) : text;
}

// This environment's words, from /api/branding. Kept for the next page, then every data-word and data-fill in the
// document is filled again. Answers whether anything changed.
export function setWords(set) {
  const next = resolve(set);
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  current = next;
  mixed = null;
  try {
    // Kept: each word that is not what it reads with nothing set (home's, from the space word kept beside it).
    const base = (k) => (k === 'home' ? homeDefault(next.space) : DEFAULTS[k]);
    const own = Object.fromEntries(CHANGEABLE.filter((k) => next[k].one !== base(k).one || next[k].many !== base(k).many || next[k].a !== usualArticle(base(k).one)).map((k) => [k, next[k]]));
    if (Object.keys(own).length) localStorage.setItem(STORED, JSON.stringify(own));
    else localStorage.removeItem(STORED);
  } catch {
    // no storage: the next page waits for its own fetch
  }
  if (typeof document !== 'undefined') applyWords(document);
  return changed;
}

// One key's word: the singular, `many` the plural, `a` the singular with its article; `cap` gives it a capital first
// letter. An unknown key is a mistake in the code, so it throws.
export function word(key, { many = false, cap = false, a = false } = {}) {
  const w = reading()[key];
  if (!w) throw new Error(`There is no word called ${key}.`);
  const text = a ? w.a : many ? w.many : w.one;
  return cap ? capital(text) : text;
}

// Fixed text with its level and role words as placeholders in their default form, each replaced by this environment's
// word in the same form: {space}, {spaces}, {Space}, {Spaces}, {a space}, {A space} ({an aside}: either article reads the
// word's own). A verb's key ({enter}) reads the verb. Anything else in braces is left as it is.
// `home` has none: its default is the space word's ("Spaces"), which reads the space word.
const BY_DEFAULT = new Map(KEYS.filter((k) => k !== 'home').flatMap((k) => [[DEFAULTS[k].one, { key: k, many: false }], [DEFAULTS[k].many, { key: k, many: true }]]));
const PLACEHOLDER = /\{((?:a|an|A|An) )?([A-Za-z]+)\}/g;
export function fill(text) {
  return String(text).replace(PLACEHOLDER, (whole, article, name) => {
    if (!article && VERBS.includes(name)) return verb(name);
    const found = BY_DEFAULT.get(name.toLowerCase());
    if (!found || (article && found.many)) return whole;
    const cap = article ? article.charAt(0) === 'A' : name.charAt(0) !== name.charAt(0).toLowerCase();
    return word(found.key, { many: found.many, a: Boolean(article), cap });
  });
}

// --- the markup -------------------------------------------------------------------------------------------------------
const FILL_ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-title', 'data-tip'];
// What each filled text or attribute read before it was filled, so a second fill (new words) starts from the
// placeholders again. When the page's own code has since changed it, what it holds now is the text.
const TEXTS = new WeakMap();
const ATTRS = new WeakMap();

function fillText(node) {
  const seen = TEXTS.get(node);
  const source = seen && node.nodeValue === seen.shown ? seen.source : node.nodeValue;
  if (!source.includes('{')) return;
  const shown = fill(source);
  TEXTS.set(node, { source, shown });
  if (node.nodeValue !== shown) node.nodeValue = shown;
}

function fillAttrs(el) {
  let kept = ATTRS.get(el);
  for (const name of FILL_ATTRS) {
    if (!el.hasAttribute(name)) continue;
    const now = el.getAttribute(name);
    const seen = kept && kept[name];
    const source = seen && now === seen.shown ? seen.source : now;
    if (!source.includes('{')) continue;
    const shown = fill(source);
    if (!kept) ATTRS.set(el, (kept = {}));
    kept[name] = { source, shown };
    if (now !== shown) el.setAttribute(name, shown);
  }
}

// Fill every data-word, data-verb and data-fill in `root` (a document, an element, or a shadow root). A page calls it after it
// draws markup of its own with these attributes in it; loadBranding() does the whole document.
export function applyWords(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const all = (sel) => [...(root.matches && root.matches(sel) ? [root] : []), ...root.querySelectorAll(sel)];
  for (const el of all('[data-word]')) {
    const key = el.dataset.word;
    if (!current[key]) continue;
    const form = ` ${el.dataset.wordForm || ''} `;
    const text = word(key, { many: form.includes(' many '), cap: form.includes(' cap '), a: form.includes(' a ') });
    if (el.textContent !== text) el.textContent = text;
  }
  for (const el of all('[data-verb]')) {
    const text = verbs()[el.dataset.verb];
    if (text && el.textContent !== text) el.textContent = text;
  }
  for (const el of all('[data-fill]')) {
    fillAttrs(el);
    for (const inner of el.querySelectorAll('*')) fillAttrs(inner);
    const walker = (el.ownerDocument || document).createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) fillText(n);
  }
}

// The page's own markup, as soon as this is loaded (before the fetch answers, from the words kept last time).
if (typeof document !== 'undefined') applyWords(document);
