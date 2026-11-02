// A module's data guards: what its manifest declares under `guards` so that the server, not only the module's page,
// holds people to the module's finer permissions on its data routes, checks the shape of what is stored, and keeps some
// fields from guests. Without `guards` a module's data is guarded as before: `access.read` and `access.write` only.
//
//   "guards": {
//     "clear": "owner" | "<permission>",  who may clear everything the module holds in a place (DELETE .../data): the
//                                          environment's owners (and the admin), or whoever holds that permission. Needed
//                                          as soon as there are `keys`, so a rule on one key can't be undone by clearing all.
//     "hidden": ["cost", ...],             top-level fields of every stored value a guest never receives (data routes,
//                                          live changes, summaries) unless the space's owner opened them (the space's
//                                          `guestsSeeHidden`). A guest's write keeps them as they were.
//     "keys": [ {                          rules for the keys that match `key`; the first that matches is used
//       "key": "vote:{poll}:{person}",     a stored key: letters and the like, with {name} parts (no ":" or "/" in a part).
//                                          {person} is a person's key: only that person may write it.
//       "personName": "name",              with {person}: this field is set to the writer's own name by the server
//       "parent": "poll:{poll}",           with "parentOpen": true, the key is written only while that object is there
//       "parentOpen": true,                and not closed (the parent's rule says what closed means); its managers
//                                          (who may delete it) may still delete this key, closed or not
//       "owner": "byKey",                  the field naming who added the object, a person's key: set by the server when
//                                          left out, never changed after, and naming someone else only for a manager
//       "ownerName": "by",                 with owner: the field with their name, set by the server for the person adding it
//       "need": "create",                  a permission needed to add an object, and by whoever added it to change or
//                                          remove it (without it they are treated as anyone else)
//       "others": {                        what someone who did not add it may do
//         "change": "manage_any",          change it (without: anyone who may write); always with `need` too
//         "delete": "manage_any",          remove it (without: anyone who may write)
//         "may": ["announced",             fields anyone who may write still changes without `change`; an object entry
//                 { "field": "options", "append": true, "when": "addable", "open": true }]  may only add to the end of a
//                                          list, only while the field named by `when` is true, only while it is open
//       },
//       "closed": { "flag": "closed", "at": "closesAt" },  closed: the flag is true, or the time (ms) in `at` has passed
//       "fields": { "planned": { "type": "number", "null": true, "above": 0, "below": 1e12 } }  the shape of the value
//     } ]
//   }
//
// cleanGuards checks a manifest's guards when a module is installed (and again on every read of a stored manifest; one
// that no longer reads is kept as { invalid: true }, which refuses every write, rather than dropping the guards). The
// rest answers { value } (what to store, perhaps with the server's own fields set) or { status, error }, one sentence.
// Nothing here knows any module.

const { word } = require('./words');

const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const PART_RE = /\{([a-z][A-Za-z0-9]{0,19})\}/g;
const KEY_PATTERN_RE = /^[A-Za-z](?:[A-Za-z0-9_.:/-]|\{[a-z][A-Za-z0-9]{0,19}\}){0,127}$/;
const PART_VALUE = '([A-Za-z0-9_.-]{1,128})';
const TYPES = ['number', 'string', 'boolean', 'array', 'object'];
const MAX_KEYS = 20;
const MAX_FIELDS = 30;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const partsOf = (pattern) => [...pattern.matchAll(PART_RE)].map((m) => m[1]);
// A pattern with its parts' names left out ("poll:{}"), so "poll:{poll}" and "poll:{id}" name the same keys.
const shapeOf = (pattern) => pattern.replace(PART_RE, '{}');

// --- reading a manifest's guards -------------------------------------------------------------------------------------

function cleanGuards(raw, permissionKeys, Err) {
  if (raw === undefined || raw === null) return null;
  const fail = (text) => { throw new Err(`module.json: ${text}`); };
  if (!isObject(raw)) fail('"guards" must be an object, such as { "clear": "owner", "keys": [...] }.');
  const perm = (value, where) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || !permissionKeys.includes(value)) fail(`${where} must name one of the module's own permissions.`);
    return value;
  };
  const field = (value, where) => {
    if (typeof value !== 'string' || !FIELD_RE.test(value)) fail(`${where} must name a stored field: a letter, then letters, digits or _.`);
    return value;
  };
  const out = { clear: null, hidden: [], keys: [] };

  if (raw.hidden !== undefined) {
    if (!Array.isArray(raw.hidden) || raw.hidden.length > MAX_FIELDS) fail(`guards.hidden must be a list of at most ${MAX_FIELDS} stored fields.`);
    for (const f of raw.hidden) if (!out.hidden.includes(field(f, 'each guards.hidden entry'))) out.hidden.push(f);
  }

  if (raw.keys !== undefined) {
    if (!Array.isArray(raw.keys) || raw.keys.length > MAX_KEYS) fail(`guards.keys must be a list of at most ${MAX_KEYS} rules.`);
    raw.keys.forEach((r, i) => {
      const at = `guards.keys[${i}]`;
      if (!isObject(r)) fail(`${at} must be an object with a "key".`);
      const key = typeof r.key === 'string' ? r.key : '';
      if (!KEY_PATTERN_RE.test(key)) fail(`${at}.key must be a stored key such as "poll:{id}": a letter first, then letters, digits, . _ : / - and {name} parts.`);
      const names = partsOf(key);
      if (new Set(names).size !== names.length) fail(`${at}.key names a part twice.`);
      if (names.length > 4) fail(`${at}.key has more than 4 {name} parts.`);
      if (out.keys.some((x) => shapeOf(x.key) === shapeOf(key))) fail(`${at}.key is listed twice.`);
      const rule = { key, parts: names };
      if (names.includes('person')) {
        rule.person = true;
        if (r.personName !== undefined) rule.personName = field(r.personName, `${at}.personName`);
      } else if (r.personName !== undefined) fail(`${at}.personName needs a {person} part in the key.`);
      if (r.owner !== undefined) {
        if (rule.person) fail(`${at} can't have both a {person} part and an "owner".`);
        rule.owner = field(r.owner, `${at}.owner`);
        if (r.ownerName !== undefined) rule.ownerName = field(r.ownerName, `${at}.ownerName`);
      } else if (r.ownerName !== undefined) fail(`${at}.ownerName needs an "owner".`);
      rule.need = perm(r.need, `${at}.need`);
      if (r.others !== undefined) {
        if (!rule.owner) fail(`${at}.others needs an "owner".`);
        if (!isObject(r.others)) fail(`${at}.others must be an object.`);
        const others = { change: perm(r.others.change, `${at}.others.change`), delete: perm(r.others.delete, `${at}.others.delete`), may: [] };
        if (r.others.may !== undefined) {
          if (!Array.isArray(r.others.may) || r.others.may.length > MAX_FIELDS) fail(`${at}.others.may must be a list of at most ${MAX_FIELDS} fields.`);
          if (!others.change) fail(`${at}.others.may needs others.change: without it anyone who may write changes every field.`);
          for (const m of r.others.may) {
            const entry = typeof m === 'string' ? { field: field(m, `each ${at}.others.may entry`) } : isObject(m) ? { field: field(m.field, `${at}.others.may field`) } : fail(`each ${at}.others.may entry must be a field, or an object with a "field".`);
            if (isObject(m)) {
              if (m.append !== undefined && typeof m.append !== 'boolean') fail(`${at}.others.may "${entry.field}" append must be true or false.`);
              if (m.append) entry.append = true;
              if (m.when !== undefined) entry.when = field(m.when, `${at}.others.may "${entry.field}" when`);
              if (m.open !== undefined && typeof m.open !== 'boolean') fail(`${at}.others.may "${entry.field}" open must be true or false.`);
              if (m.open) entry.open = true;
            }
            if (others.may.some((x) => x.field === entry.field)) fail(`${at}.others.may lists "${entry.field}" twice.`);
            if (entry.field === rule.owner || entry.field === rule.ownerName) fail(`${at}.others.may can't list the owner's fields.`);
            others.may.push(entry);
          }
        }
        rule.others = others;
      }
      if (r.closed !== undefined) {
        if (!isObject(r.closed) || (r.closed.flag === undefined && r.closed.at === undefined)) fail(`${at}.closed must name a "flag" field, an "at" field, or both.`);
        rule.closed = {};
        if (r.closed.flag !== undefined) rule.closed.flag = field(r.closed.flag, `${at}.closed.flag`);
        if (r.closed.at !== undefined) rule.closed.at = field(r.closed.at, `${at}.closed.at`);
      }
      if (rule.others && rule.others.may.some((m) => m.open) && !rule.closed) fail(`${at}.others.may uses "open", which needs "closed".`);
      if (r.parent !== undefined) {
        const parent = typeof r.parent === 'string' ? r.parent : '';
        if (!KEY_PATTERN_RE.test(parent)) fail(`${at}.parent must be a stored key such as "poll:{poll}".`);
        if (partsOf(parent).some((p) => !names.includes(p))) fail(`${at}.parent may only use the key's own {name} parts.`);
        rule.parent = parent;
        if (r.parentOpen !== undefined && typeof r.parentOpen !== 'boolean') fail(`${at}.parentOpen must be true or false.`);
        if (r.parentOpen) rule.parentOpen = true;
      } else if (r.parentOpen !== undefined) fail(`${at}.parentOpen needs a "parent".`);
      if (r.fields !== undefined) {
        if (!isObject(r.fields) || Object.keys(r.fields).length > MAX_FIELDS) fail(`${at}.fields must be an object of at most ${MAX_FIELDS} fields.`);
        rule.fields = {};
        for (const [name, f] of Object.entries(r.fields)) {
          field(name, `${at}.fields name "${name}"`);
          if (!isObject(f) || !TYPES.includes(f.type)) fail(`${at}.fields.${name}.type must be ${TYPES.join(', ')}.`);
          const spec = { type: f.type };
          for (const flag of ['null', 'required']) {
            if (f[flag] !== undefined && typeof f[flag] !== 'boolean') fail(`${at}.fields.${name}.${flag} must be true or false.`);
            if (f[flag]) spec[flag] = true;
          }
          for (const bound of ['above', 'below', 'min', 'max']) {
            if (f[bound] === undefined) continue;
            if (f.type !== 'number' || typeof f[bound] !== 'number' || !Number.isFinite(f[bound])) fail(`${at}.fields.${name}.${bound} must be a number, on a number field.`);
            spec[bound] = f[bound];
          }
          if (f.maxLength !== undefined) {
            if (!['string', 'array'].includes(f.type) || !Number.isInteger(f.maxLength) || f.maxLength < 1 || f.maxLength > 100000) fail(`${at}.fields.${name}.maxLength must be a whole number from 1 to 100000, on a string or array field.`);
            spec.maxLength = f.maxLength;
          }
          rule.fields[name] = spec;
        }
      }
      out.keys.push(rule);
    });
    for (const [i, rule] of out.keys.entries()) {
      if (!rule.parentOpen) continue;
      const parentRule = out.keys.find((x) => shapeOf(x.key) === shapeOf(rule.parent));
      if (!parentRule || !parentRule.closed) fail(`guards.keys[${i}].parentOpen needs a rule for "${rule.parent}" that says when it is "closed".`);
    }
  }

  if (raw.clear !== undefined && raw.clear !== null) {
    out.clear = raw.clear === 'owner' ? 'owner' : perm(raw.clear, 'guards.clear');
    if (!out.clear) fail('guards.clear must be "owner" or one of the module\'s own permissions.');
  }
  if (out.keys.length && !out.clear) fail('guards.clear is needed with guards.keys: say who may clear everything, "owner" or one of the module\'s own permissions.');
  if (!out.keys.length && !out.hidden.length && !out.clear) return null;
  return out;
}

// --- matching ----------------------------------------------------------------------------------------------------------

const compiled = new Map(); // pattern -> RegExp
function patternRe(pattern) {
  let re = compiled.get(pattern);
  if (!re) {
    const src = pattern.split(/(\{[a-z][A-Za-z0-9]{0,19}\})/).map((piece) => (/^\{.+\}$/.test(piece) ? PART_VALUE : piece.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'))).join('');
    re = new RegExp(`^${src}$`);
    compiled.set(pattern, re);
  }
  return re;
}
// The parts of `key` by name when it matches `pattern`, else null.
function matchKey(pattern, key) {
  const m = patternRe(pattern).exec(String(key));
  if (!m) return null;
  return Object.fromEntries(partsOf(pattern).map((name, i) => [name, m[i + 1]]));
}
// The first rule whose key matches, with its parts; null when none does.
function ruleFor(guards, key) {
  for (const rule of guards?.keys || []) {
    const params = matchKey(rule.key, key);
    if (params) return { rule, params };
  }
  return null;
}
// The fixed start of a pattern, before its first {name} part ("vote:" for "vote:{poll}:{person}").
const literalPrefix = (pattern) => pattern.split('{')[0];
const fillKey = (pattern, params) => pattern.replace(PART_RE, (_, name) => params[name]);

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// Nothing there: left out, null, '' or an empty list (a page that writes '' where it once left a field out changes nothing).
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

// Closed by its flag, or by its time (milliseconds) having passed.
function closedNow(closed, value, now = Date.now()) {
  if (!closed || !isObject(value)) return false;
  if (closed.flag && value[closed.flag] === true) return true;
  return Boolean(closed.at) && typeof value[closed.at] === 'number' && Number.isFinite(value[closed.at]) && now >= value[closed.at];
}

// --- the sentences -----------------------------------------------------------------------------------------------------

const refuse = (status, error) => ({ status, error });
const roleRefusal = () => refuse(403, `Your role can't do that in this ${word('module')}.`);
const guestRefusal = () => refuse(403, `${word('guest', { many: true, cap: true })} can't do that in this ${word('module')}.`);
const theirsRefusal = () => refuse(403, 'That belongs to someone else, so you can\'t change it.');
const closedRefusal = () => refuse(403, 'That is closed, so it can\'t be changed.');
const goneRefusal = () => refuse(404, 'What that belongs to is no longer there.');

const TYPE_WORDS = { number: 'a number', string: 'text', boolean: 'true or false', array: 'a list', object: 'an object' };
function fieldSentence(name, spec) {
  const bounds = [];
  if (spec.above !== undefined) bounds.push(`above ${spec.above}`);
  if (spec.min !== undefined) bounds.push(`at least ${spec.min}`);
  if (spec.below !== undefined) bounds.push(`below ${spec.below}`);
  if (spec.max !== undefined) bounds.push(`at most ${spec.max}`);
  if (spec.maxLength !== undefined) bounds.push(`at most ${spec.maxLength} ${spec.type === 'array' ? 'long' : 'characters'}`);
  return `${name} must be ${TYPE_WORDS[spec.type]}${bounds.length ? ` ${bounds.join(' and ')}` : ''}${spec.null ? ', or empty' : ''}.`;
}
// The first field of `value` that is not as its rule says, as a sentence; null when all are.
function fieldProblem(fields, value) {
  for (const [name, spec] of Object.entries(fields || {})) {
    const v = value[name];
    if (v === undefined) { if (spec.required) return `${name} is needed.`; continue; }
    if (v === null) { if (spec.null && !spec.required) continue; return fieldSentence(name, spec); }
    const typeOk = spec.type === 'array' ? Array.isArray(v) : spec.type === 'object' ? isObject(v) : spec.type === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === spec.type;
    if (!typeOk) return fieldSentence(name, spec);
    if (spec.type === 'number' && ((spec.above !== undefined && !(v > spec.above)) || (spec.below !== undefined && !(v < spec.below)) || (spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max))) return fieldSentence(name, spec);
    if (spec.maxLength !== undefined && v.length > spec.maxLength) return fieldSentence(name, spec);
  }
  return null;
}

// --- who may ---------------------------------------------------------------------------------------------------------
// `who`: { key (a person's key; null for a guest), name, can(permission) -> boolean, owner (the environment's owner
// rights) }. `read(key)`: the value stored under that key in the same place, or null.

// May `who` remove the object under `rule` that holds `before`? (Also: may they remove what belongs to it.)
function mayDelete(rule, before, who) {
  if (!who.key) return false;
  if (rule.need && !who.can(rule.need)) return false;
  if (!rule.owner) return true;
  const mine = isObject(before) && before[rule.owner] === who.key;
  return mine || !rule.others?.delete || who.can(rule.others.delete);
}

// What to store for a PUT, or a refusal.
function checkPut(guards, { key, before, value, who, read, now = Date.now() }) {
  if (guards?.invalid) return refuse(403, `This ${word('module')}'s rules can't be read, so nothing in it can be changed. Ask the ${word('admin')} to update it.`);
  const found = ruleFor(guards, key);
  // A key that starts as a rule's key does but is not one ("vote:q1:mia:x" beside "vote:{poll}:{person}") is refused,
  // so nothing slips past a rule by its shape.
  if (!found) return (guards?.keys || []).some((r) => String(key).startsWith(literalPrefix(r.key))) ? refuse(400, `That key isn't one this ${word('module')} keeps.`) : { value };
  const { rule, params } = found;
  if (!who.key && (rule.person || rule.owner)) return guestRefusal();
  if (rule.person || rule.owner || rule.fields) {
    if (!isObject(value)) return refuse(400, 'That value must be an object.');
  }
  let next = value;
  if (rule.person) {
    if (params.person !== who.key) return theirsRefusal();
    if (rule.personName) next = { ...next, [rule.personName]: who.name };
  }
  if (rule.parent) {
    const parentKey = fillKey(rule.parent, params);
    const parent = read(parentKey);
    if (!parent) return goneRefusal();
    if (rule.parentOpen) {
      const parentRule = ruleFor(guards, parentKey)?.rule;
      if (closedNow(parentRule?.closed, parent, now)) return closedRefusal();
    }
  }
  if (rule.owner) {
    const given = next[rule.owner];
    const manager = Boolean(rule.others?.change) && who.can(rule.others.change);
    if (!isObject(before)) {
      if (rule.need && !who.can(rule.need)) return roleRefusal();
      if (given === undefined || given === null || given === '') next = { ...next, [rule.owner]: who.key };
      else if (given !== who.key && !manager) return refuse(403, 'You can only add it in your own name.');
      if (rule.ownerName && next[rule.owner] === who.key) next = { ...next, [rule.ownerName]: who.name };
    } else {
      const had = before[rule.owner];
      if (given === undefined) { if (had !== undefined) next = { ...next, [rule.owner]: had }; } else if (given !== had) return refuse(403, 'Who added it can\'t be changed.');
      if (rule.ownerName && before[rule.ownerName] !== undefined) next = { ...next, [rule.ownerName]: before[rule.ownerName] };
      const mine = had === who.key;
      const full = (!rule.need || who.can(rule.need)) && (mine || !rule.others?.change || manager);
      if (!full) {
        // Someone who may only make the changes `others.may` lists: every field that differs must be one of them.
        const may = rule.others?.may || [];
        const fields = new Set([...Object.keys(before), ...Object.keys(next)]);
        for (const f of fields) {
          if (deepEqual(before[f], next[f]) || (isEmpty(before[f]) && isEmpty(next[f]))) continue;
          const entry = may.find((m) => m.field === f);
          if (!entry) return refuse(403, mine ? `Your role can't do that in this ${word('module')}.` : `Your role can't change what someone else added in this ${word('module')}.`);
          if (entry.when && before[entry.when] !== true) return refuse(403, `That can't be changed here.`);
          if (entry.open && closedNow(rule.closed, before, now)) return closedRefusal();
          if (entry.append) {
            const was = before[f];
            const is = next[f];
            if (!Array.isArray(was) || !Array.isArray(is) || is.length <= was.length || !was.every((x, i) => deepEqual(x, is[i]))) return refuse(403, `You can only add to ${f}, not change what is there.`);
          }
        }
      }
    }
  } else if (rule.need && !who.can(rule.need)) {
    return roleRefusal();
  }
  if (rule.fields) {
    const problem = fieldProblem(rule.fields, next);
    if (problem) return refuse(400, problem);
  }
  return { value: next };
}

// Whether a DELETE of one key may go ahead: null, or a refusal. Deleting what is not there is always fine.
function checkDelete(guards, { key, before, who, read, now = Date.now() }) {
  if (guards?.invalid) return refuse(403, `This ${word('module')}'s rules can't be read, so nothing in it can be changed. Ask the ${word('admin')} to update it.`);
  const found = ruleFor(guards, key);
  if (!found || before === null || before === undefined) return null;
  const { rule, params } = found;
  if (!who.key && (rule.person || rule.owner)) return guestRefusal();
  if (rule.person || rule.parent) {
    const parentKey = rule.parent ? fillKey(rule.parent, params) : null;
    const parent = parentKey ? read(parentKey) : null;
    const parentRule = parentKey ? ruleFor(guards, parentKey)?.rule : null;
    // Whoever may remove the object it belongs to may remove this (a poll's votes go with the poll), closed or not.
    if (parent && parentRule && mayDelete(parentRule, parent, who)) return null;
    if (rule.person && params.person !== who.key) return theirsRefusal();
    if (parent && rule.parentOpen && closedNow(parentRule?.closed, parent, now)) return closedRefusal();
  }
  if (rule.owner) {
    if (rule.need && !who.can(rule.need)) return roleRefusal();
    if (!mayDelete(rule, before, who)) return refuse(403, `Your role can't remove what someone else added in this ${word('module')}.`);
  } else if (rule.need && !who.can(rule.need)) {
    return roleRefusal();
  }
  return null;
}

// Whether clearing everything in a place may go ahead: null, or a refusal.
function checkClear(guards, who) {
  if (guards?.invalid) return refuse(403, `This ${word('module')}'s rules can't be read, so nothing in it can be changed. Ask the ${word('admin')} to update it.`);
  if (!guards?.clear) return null;
  if (guards.clear === 'owner') return who.owner ? null : refuse(403, `Only ${word('owner', { many: true })} can clear everything in this ${word('module')}.`);
  return who.key && who.can(guards.clear) ? null : refuse(403, `Your role can't clear everything in this ${word('module')}.`);
}
const mayClear = (guards, who) => checkClear(guards, who) === null;

// --- hidden fields ---------------------------------------------------------------------------------------------------
// A stored value without the hidden fields (a copy; anything that is not an object is as it was).
function hide(value, fields) {
  if (!fields || !fields.length || !isObject(value)) return value;
  if (!fields.some((f) => f in value)) return value;
  const out = { ...value };
  for (const f of fields) delete out[f];
  return out;
}
// What a writer who can't see the hidden fields sends, with those fields as they were stored (none when there was nothing).
function keepHidden(value, before, fields) {
  if (!fields || !fields.length || !isObject(value)) return value;
  const out = { ...value };
  for (const f of fields) {
    if (isObject(before) && before[f] !== undefined) out[f] = before[f];
    else delete out[f];
  }
  return out;
}

module.exports = { cleanGuards, matchKey, ruleFor, closedNow, checkPut, checkDelete, checkClear, mayClear, hide, keepHidden, deepEqual, fieldProblem };
