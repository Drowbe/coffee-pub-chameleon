// Saved layouts (documentation/plans/plan-saved-layouts.md, step 1): named arrangements of a space's canvas, kept on
// the server so a person's own follow them to any browser and a space's shared ones reach everyone in it. One file per
// environment, DATA_DIR/layouts.json (so the environment's export and the host console's backup, which zip the whole
// data folder, carry it):
//
//   { "spaces": { "<space id>": { "shared": [layout], "people": { "<user key>": [layout] },
//                                  "favorites": { "<user key>": [layout id] } } } }
//
// favorites (documentation/plans/plan-favorite-layouts.md, step 1): each person's own favorites in a space, layout ids
// in the order they were favorited. Only a layout the person can see can be one, each id once, and there is no limit
// (Thomas, 2026-10-13, plan-layout-views.md decision 13: the limit of 3 was part of a legacy system). remove() and
// forgetPerson() keep it clean; the key is left out of a space's entry while nobody there has a favorite.
//
// system (documentation/plans/plan-layout-views.md, step 1): the system layouts `workspace`, `calendar` and `map` are
// never stored; server/index.js makes them per space from what is on. What is stored is each person's own choices for
// them, per space, like favorites: "system": { "<user key>": { "<system id>": { "name"?, "icon"?, "tab"?: false } } }.
// A user layout may carry an `icon`; one stored without reads as kind `user` with the default icon.
//
// A layout is { id, name, by, at, modules: [{ id, mode, dockW?, box?, snap?, stack?, at?, h?, folded? }], snap?: { all, pitch } }. cleanLayout()
// is the one shape check, pure; the Layouts class keeps the lists, their limits and the clean-up when a space or a
// person is removed (server/store.js calls forgetSpace and forgetPerson). The browser's own remembered layout
// (app.canvas.<space id>) is unchanged and separate. An aside has no layouts: index.js only finds spaces.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const words = require('./words');

const LAYOUT_LIMITS = Object.freeze({
  personal: 10, // per person per space
  shared: 10, // per space
  name: 40, // characters, after trimming
  modules: 20, // entries in a layout's modules, the same count as a space's opensWith
  dockWMin: 160,
  dockWMax: 2000,
  pitchMin: 50, // the snap grid's pitch in pixels, as the canvas's SNAP_PITCH
  pitchMax: 320,
  stackMax: 3, // modules in one stack (plan-panel-stacking.md decision 3)
  stackHMin: 0.1, // a section's share of its column's height
  stackHMax: 0.9,
  stackHSum: 0.01, // the shares must add up to 1, within this
});
// Never stacked (plan-panel-stacking.md decision 2): the conference, Chat and the composites (dest:*; their ':' fails
// MODULE_ID, so they never reach a layout, but the rule is kept here in words).
const NEVER_STACKED = Object.freeze(['conference', 'chat']);
const stackable = (id) => !NEVER_STACKED.includes(id) && !id.startsWith('dest:');
const STACK_ID = /^[a-z0-9]{1,32}$/;
// The system layouts' stable ids (a user layout's is `l` and six characters, so they never collide) and their default
// icons; a user layout's default icon is the Layout button's.
const SYSTEM_IDS = Object.freeze(['workspace', 'calendar', 'map']);
const SYSTEM_ICONS = Object.freeze({ workspace: 'columns', calendar: 'calendar-days', map: 'map-location-dot' });
const USER_ICON = 'object-group';
const ICON_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// A module id: the same rule as a space's opensWith (server/store.js).
const MODULE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const MODES = ['dock', 'float'];
const TOP_KEYS = ['name', 'shared', 'modules', 'snap', 'icon'];
const MODULE_KEYS = ['id', 'mode', 'dockW', 'box', 'snap', 'stack', 'at', 'h', 'folded'];
const BOX_KEYS = ['x', 'y', 'w', 'h'];
const SNAP_KEYS = ['all', 'pitch'];
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isFraction = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const many = (key) => words.word(key, { many: true });

// A stack (plan-panel-stacking.md, decision 4): a column of the canvas holding 2 or 3 docked modules one above the
// other. It is carried on the members' own entries in `modules`, with four optional keys:
//   stack   the stack's id, 1 to 32 characters of [a-z0-9]; members with the same id share one column
//   at      the member's place in the stack, 0 (top) to 2
//   h       the member's share of the column's height, 0.1 to 0.9; the members' shares add up to 1 (within 0.01)
//   folded  true when the member is collapsed
// A stack's width is the `dockW` of its members as for any docked module. An entry with none of the four is an
// ordinary column, so layouts saved before stacks are unchanged. Stack keys are cleaned, never refused (cleanStacks):
// a stack key on a float, the conference, Chat or a composite is dropped; a stack of one member, and members past the
// third, become ordinary columns; members are put in `at` order (list order where `at` is missing or repeats), kept
// together at the place of the stack's first member, and renumbered 0, 1, 2; `h` is kept (clamped to 0.1 to 0.9, rounded
// to 4 places) only when every member has one and they add up to 1 within 0.01, else all are dropped (equal heights);
// `folded` is kept only as true or false. The 20 entry limit counts every member (Opens with names every module too);
// the server knows no column limit, so a stack being one column against the docked limit is the page's.
function cleanStacks(entries) {
  const groups = new Map();
  entries.forEach((e, i) => {
    const { stack } = e.raw;
    if (e.kept.mode !== 'dock' || !stackable(e.kept.id) || typeof stack !== 'string' || !STACK_ID.test(stack)) return;
    if (!groups.has(stack)) groups.set(stack, []);
    groups.get(stack).push(i);
  });
  const placed = new Map(); // index of a stack's first member -> its cleaned, ordered members
  const inStack = new Set();
  for (const idx of groups.values()) {
    const stack = entries[idx[0]].raw.stack;
    const atOf = (i) => { const a = entries[i].raw.at; return Number.isInteger(a) && a >= 0 && a < LAYOUT_LIMITS.stackMax ? a : Infinity; };
    const order = idx.map((i, n) => ({ i, n, at: atOf(i) }));
    order.sort((a, b) => (a.at === b.at ? a.n - b.n : a.at - b.at));
    const members = order.slice(0, LAYOUT_LIMITS.stackMax).map((o) => o.i);
    if (members.length < 2) continue;
    const hs = members.map((i) => entries[i].raw.h);
    const heights = hs.every((h) => typeof h === 'number' && Number.isFinite(h))
      ? hs.map((h) => Math.round(Math.min(LAYOUT_LIMITS.stackHMax, Math.max(LAYOUT_LIMITS.stackHMin, h)) * 10000) / 10000) : null;
    const sound = heights && Math.abs(heights.reduce((a, b) => a + b, 0) - 1) <= LAYOUT_LIMITS.stackHSum + 1e-9;
    members.forEach((i, at) => {
      const k = entries[i].kept;
      k.stack = stack;
      k.at = at;
      if (sound) k.h = heights[at];
      if (typeof entries[i].raw.folded === 'boolean') k.folded = entries[i].raw.folded;
      inStack.add(i);
    });
    placed.set(Math.min(...idx), members);
  }
  const out = [];
  entries.forEach((e, i) => {
    if (placed.has(i)) placed.get(i).forEach((m) => out.push(entries[m].kept));
    else if (!inStack.has(i)) out.push(e.kept);
  });
  return out;
}

// A layout's name as it is kept: control characters out, whitespace collapsed, trimmed.
function cleanName(value) {
  return typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim() : '';
}

// The one shape check, pure. `input` is what a request sends ({ name, shared?, modules, snap?, icon? }); with `partial`
// (a PUT) any of name, modules and snap may be left out, and shared is not taken. `icons`, when given, is the list of
// icon ids an `icon` must come from. Returns { layout } with only the
// fields given, cleaned (numbers of pixels rounded), or { error } with one sentence saying what is wrong; anything
// wrong refuses the whole layout.
function cleanLayout(input, { partial = false, icons = null } = {}) {
  if (!isObject(input)) return { error: `Send the layout as JSON: a name and the ${many('module')} it opens.` };
  const allowed = partial ? TOP_KEYS.filter((k) => k !== 'shared') : TOP_KEYS;
  const extra = Object.keys(input).find((k) => !allowed.includes(k));
  if (extra) return { error: partial && extra === 'shared' ? 'A saved layout cannot be moved between your own and the shared ones; save it again instead.' : `A layout does not take "${extra}".` };
  const out = {};

  if (!partial || input.name !== undefined) {
    if (input.name !== undefined && typeof input.name !== 'string') return { error: 'A layout\'s name must be text.' };
    const name = cleanName(input.name);
    if (!name) return { error: 'Give the layout a name.' };
    if ([...name].length > LAYOUT_LIMITS.name) return { error: `A layout's name can be at most ${LAYOUT_LIMITS.name} characters.` };
    out.name = name;
  }

  if (!partial && input.shared !== undefined) {
    if (typeof input.shared !== 'boolean') return { error: 'Say whether the layout is shared with true or false.' };
    out.shared = input.shared;
  }

  if (!partial || input.modules !== undefined) {
    if (!Array.isArray(input.modules) || input.modules.length === 0) return { error: `List the ${many('module')} the layout opens.` };
    if (input.modules.length > LAYOUT_LIMITS.modules) return { error: `A layout can hold at most ${LAYOUT_LIMITS.modules} ${many('module')}.` };
    const seen = new Set();
    const entries = [];
    for (const entry of input.modules) {
      if (!isObject(entry)) return { error: `Each ${words.word('module')} in a layout needs an id and a mode.` };
      const id = entry.id;
      if (typeof id !== 'string' || !MODULE_ID.test(id)) return { error: `${JSON.stringify(id ?? null)} is not ${words.word('module', { a: true })} id.` };
      if (seen.has(id)) return { error: `"${id}" is listed twice in the layout.` };
      seen.add(id);
      const unknown = Object.keys(entry).find((k) => !MODULE_KEYS.includes(k));
      if (unknown) return { error: `"${id}": a layout does not keep "${unknown}".` };
      if (!MODES.includes(entry.mode)) return { error: `"${id}": mode must be dock or float.` };
      const kept = { id, mode: entry.mode };
      if (entry.dockW !== undefined) {
        const w = entry.dockW;
        if (typeof w !== 'number' || !Number.isFinite(w) || w < LAYOUT_LIMITS.dockWMin || w > LAYOUT_LIMITS.dockWMax) {
          return { error: `"${id}": dockW must be a width in pixels from ${LAYOUT_LIMITS.dockWMin} to ${LAYOUT_LIMITS.dockWMax}.` };
        }
        kept.dockW = Math.round(w);
      }
      if (entry.box !== undefined) {
        const b = entry.box;
        const bad = !isObject(b) || Object.keys(b).some((k) => !BOX_KEYS.includes(k)) || !BOX_KEYS.every((k) => isFraction(b[k])) || b.w === 0 || b.h === 0;
        if (bad) return { error: `"${id}": box must be { x, y, w, h }, each a fraction of the ${words.word('canvas')} from 0 to 1, with w and h above 0.` };
        kept.box = { x: b.x, y: b.y, w: b.w, h: b.h };
      }
      if (entry.snap !== undefined) {
        if (typeof entry.snap !== 'boolean') return { error: `"${id}": snap must be true or false.` };
        kept.snap = entry.snap;
      }
      entries.push({ kept, raw: entry });
    }
    out.modules = cleanStacks(entries);
  }

  if (input.icon !== undefined) {
    const bad = typeof input.icon !== 'string' || !ICON_RE.test(input.icon) || (Array.isArray(icons) && !icons.includes(input.icon));
    if (bad) return { error: 'Pick an icon from the list.' };
    out.icon = input.icon;
  }

  if (input.snap !== undefined) {
    const s = input.snap;
    const pitch = s?.pitch;
    const bad = !isObject(s) || Object.keys(s).some((k) => !SNAP_KEYS.includes(k)) || typeof s.all !== 'boolean'
      || typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch < LAYOUT_LIMITS.pitchMin || pitch > LAYOUT_LIMITS.pitchMax;
    if (bad) return { error: `A layout's snap must be { all, pitch }, with all true or false and pitch from ${LAYOUT_LIMITS.pitchMin} to ${LAYOUT_LIMITS.pitchMax} pixels.` };
    out.snap = { all: s.all, pitch: Math.round(pitch) };
  }
  return { layout: out };
}

// A person's change to a system layout, pure: { name?, icon?, tab? }. `name` and `icon` null go back to the default;
// `tab` is true or false. Returns { patch } cleaned or { error } with one sentence. Whether `tab: false` is allowed
// for that layout (never for the Workspace) is the route's.
function cleanSystemPatch(input, { icons = null } = {}) {
  if (!isObject(input)) return { error: 'Send the change as JSON: a name, an icon or whether it is a tab.' };
  const extra = Object.keys(input).find((k) => !['name', 'icon', 'tab'].includes(k));
  if (extra) return { error: `A system layout does not take "${extra}".` };
  const patch = {};
  if (input.name !== undefined) {
    if (input.name === null) patch.name = null;
    else {
      if (typeof input.name !== 'string') return { error: 'A layout\'s name must be text.' };
      const name = cleanName(input.name);
      if (!name) return { error: 'Give the layout a name.' };
      if ([...name].length > LAYOUT_LIMITS.name) return { error: `A layout's name can be at most ${LAYOUT_LIMITS.name} characters.` };
      patch.name = name;
    }
  }
  if (input.icon !== undefined) {
    if (input.icon === null) patch.icon = null;
    else if (typeof input.icon !== 'string' || !ICON_RE.test(input.icon) || (Array.isArray(icons) && !icons.includes(input.icon))) return { error: 'Pick an icon from the list.' };
    else patch.icon = input.icon;
  }
  if (input.tab !== undefined) {
    if (typeof input.tab !== 'boolean') return { error: 'Say whether the layout is a tab with true or false.' };
    patch.tab = input.tab;
  }
  if (!Object.keys(patch).length) return { error: 'Send a new name, an icon, or whether it is a tab.' };
  return { patch };
}

// One person's stored choices for the system layouts, as read from the file: only what this version knows, cleaned.
function storedSystem(raw) {
  const out = {};
  if (!isObject(raw)) return out;
  for (const id of SYSTEM_IDS) {
    const r = raw[id];
    if (!isObject(r)) continue;
    const kept = {};
    const name = typeof r.name === 'string' ? cleanName(r.name) : '';
    if (name && [...name].length <= LAYOUT_LIMITS.name) kept.name = name;
    if (typeof r.icon === 'string' && ICON_RE.test(r.icon)) kept.icon = r.icon;
    if (r.tab === false && id !== 'workspace') kept.tab = false;
    if (Object.keys(kept).length) out[id] = kept;
  }
  return out;
}

class LayoutError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// A stored layout as read from the file: kept as it is when it has an id and a name (a later version's extra fields
// survive a roll back), else dropped.
const storedLayout = (l) => isObject(l) && typeof l.id === 'string' && l.id && typeof l.name === 'string' && Array.isArray(l.modules);
const storedList = (list) => (Array.isArray(list) ? list.filter(storedLayout) : []);
const copy = (l) => structuredClone(l);

class Layouts {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'layouts.json');
    this.spaces = {};
    // None yet is the usual case. One that is there but cannot be read is never written over: the lists read as
    // empty and every change is refused, until the file is fixed or restored and the server started again.
    this.unreadable = false;
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') this.unreadable = true;
    }
    for (const [spaceId, entry] of Object.entries(isObject(raw?.spaces) ? raw.spaces : {})) {
      if (!isObject(entry)) continue;
      const people = {};
      for (const [key, list] of Object.entries(isObject(entry.people) ? entry.people : {})) {
        const kept = storedList(list);
        if (kept.length) people[key] = kept;
      }
      const shared = storedList(entry.shared);
      // A file from before favorites has no key: it reads as none. Ids that are not text, or listed twice, are dropped.
      // Ids of a layout that person cannot see (gone, dropped above as malformed, or hand-edited in) are dropped too,
      // so a space whose favorites name nothing left keeps no entry.
      const sharedIds = new Set(shared.map((l) => l.id));
      const favorites = {};
      for (const [key, list] of Object.entries(isObject(entry.favorites) ? entry.favorites : {})) {
        const own = new Set((people[key] || []).map((l) => l.id));
        const ids = Array.isArray(list)
          ? [...new Set(list.filter((id) => typeof id === 'string' && id && (sharedIds.has(id) || own.has(id))))]
          : [];
        if (ids.length) favorites[key] = ids;
      }
      const system = {};
      for (const [key, record] of Object.entries(isObject(entry.system) ? entry.system : {})) {
        const kept = storedSystem(record);
        if (Object.keys(kept).length) system[key] = kept;
      }
      if (shared.length || Object.keys(people).length || Object.keys(favorites).length || Object.keys(system).length) {
        this.spaces[spaceId] = { shared, people, ...(Object.keys(favorites).length ? { favorites } : {}), ...(Object.keys(system).length ? { system } : {}) };
      }
    }
  }

  // Before any change: refused whole while layouts.json cannot be read.
  mustWrite() {
    if (this.unreadable) throw new LayoutError('The saved layouts file cannot be read, so nothing can be saved until it is fixed.', 500);
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ spaces: this.spaces }, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
  }

  // The list a layout belongs in: the space's shared list, or one person's own there. Made when `create`.
  listOf(spaceId, userKey, create = false) {
    let entry = this.spaces[spaceId];
    if (!entry) {
      if (!create) return [];
      entry = this.spaces[spaceId] = { shared: [], people: {} };
    }
    if (userKey === null) return entry.shared;
    if (!entry.people[userKey]) {
      if (!create) return [];
      entry.people[userKey] = [];
    }
    return entry.people[userKey];
  }

  // Drops empty lists and spaces, so the file holds only what someone saved.
  tidy(spaceId) {
    const entry = this.spaces[spaceId];
    if (!entry) return;
    for (const [key, list] of Object.entries(entry.people)) if (!list.length) delete entry.people[key];
    if (entry.favorites) {
      for (const [key, list] of Object.entries(entry.favorites)) if (!list.length) delete entry.favorites[key];
      if (!Object.keys(entry.favorites).length) delete entry.favorites;
    }
    if (entry.system) {
      for (const [key, record] of Object.entries(entry.system)) if (!Object.keys(record).length) delete entry.system[key];
      if (!Object.keys(entry.system).length) delete entry.system;
    }
    if (!entry.shared.length && !Object.keys(entry.people).length && !entry.favorites && !entry.system) delete this.spaces[spaceId];
  }

  // { mine, shared } in a space: `userKey` null (a guest) has none of their own. Each is a copy with `kind: 'user'` and
  // its `icon` (the default one when none was stored); nothing stored is changed.
  list(spaceId, userKey) {
    const shown = (l) => ({ ...copy(l), kind: 'user', icon: typeof l.icon === 'string' && l.icon ? l.icon : USER_ICON });
    return {
      mine: userKey ? this.listOf(spaceId, userKey).map(shown) : [],
      shared: this.listOf(spaceId, null).map(shown),
    };
  }

  // `userKey`'s own choices for the system layouts in a space: { <system id>: { name?, icon?, tab? } }, only what they
  // changed. A guest (`userKey` null) has none.
  systemOf(spaceId, userKey) {
    return userKey ? structuredClone(this.spaces[spaceId]?.system?.[userKey] || {}) : {};
  }

  // Sets or clears (`null`) a person's name or icon for one system layout, or its tab (`false` stored; `true` clears it).
  // `patch` is cleanSystemPatch's answer; the caller has checked the id and that the Workspace keeps its tab. Returns
  // that layout's choices after, as systemOf().
  setSystem(spaceId, userKey, systemId, patch) {
    this.mustWrite();
    const now = this.systemOf(spaceId, userKey)[systemId] || {};
    const next = { ...now };
    for (const key of ['name', 'icon']) {
      if (patch[key] === undefined) continue;
      if (patch[key] === null) delete next[key]; else next[key] = patch[key];
    }
    if (patch.tab === false) next.tab = false;
    else if (patch.tab === true) delete next.tab;
    if (JSON.stringify(next) === JSON.stringify(now)) return next;
    const entry = this.spaces[spaceId] || (this.spaces[spaceId] = { shared: [], people: {} });
    entry.system = entry.system || {};
    entry.system[userKey] = { ...(entry.system[userKey] || {}) };
    if (Object.keys(next).length) entry.system[userKey][systemId] = next; else delete entry.system[userKey][systemId];
    this.tidy(spaceId);
    this.save();
    return next;
  }

  // `userKey`'s favorites in a space: the ids, in the order favorited, of the saved layouts that still exist and that
  // they can see, with no limit. The system layouts' tabs are not in this list (systemOf()). A guest (`userKey` null)
  // has none.
  favorites(spaceId, userKey) {
    if (!userKey) return [];
    const stored = this.spaces[spaceId]?.favorites?.[userKey] || [];
    return stored.filter((id) => this.find(spaceId, id, userKey));
  }

  // Makes a layout `userKey` can see one of their favorites (`on`), appended at the end, or stops it being one.
  // Doing what is already so changes nothing. A change writes back the visible list (as favorites()) with it, so ids
  // they cannot see are dropped. Returns their favorites (as favorites()), or null when they cannot see that layout.
  setFavorite(spaceId, layoutId, userKey, on) {
    this.mustWrite();
    if (!userKey || !this.find(spaceId, layoutId, userKey)) return null;
    const entry = this.spaces[spaceId];
    const visible = this.favorites(spaceId, userKey);
    const has = visible.includes(layoutId);
    if (on && !has) {
      entry.favorites = entry.favorites || {};
      entry.favorites[userKey] = [...visible, layoutId];
    } else if (!on && has) {
      entry.favorites[userKey] = visible.filter((id) => id !== layoutId);
      this.tidy(spaceId);
    } else {
      return visible;
    }
    this.save();
    return this.favorites(spaceId, userKey);
  }

  // A layout by id that `userKey` can see in a space: the shared one, else their own. { layout, shared } or null.
  find(spaceId, layoutId, userKey) {
    const shared = this.listOf(spaceId, null).find((l) => l.id === layoutId);
    if (shared) return { layout: copy(shared), shared: true };
    const mine = userKey ? this.listOf(spaceId, userKey).find((l) => l.id === layoutId) : null;
    return mine ? { layout: copy(mine), shared: false } : null;
  }

  newId(spaceId) {
    const entry = this.spaces[spaceId];
    const taken = new Set(entry ? [...entry.shared, ...Object.values(entry.people).flat()].map((l) => l.id) : []);
    let id;
    do id = `l${Array.from({ length: 6 }, () => ID_ALPHABET[crypto.randomInt(ID_ALPHABET.length)]).join('')}`;
    while (taken.has(id));
    return id;
  }

  // Saves a new layout, already cleaned by cleanLayout: in the shared list when `shared`, else in `by`'s own. Throws
  // a LayoutError (409) when the name is taken in that list (with the id of the one that has it) or the list is full.
  add(spaceId, by, { name, shared = false, modules, snap, icon }) {
    this.mustWrite();
    const owner = shared ? null : by;
    const current = this.listOf(spaceId, owner);
    const same = current.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (same) throw new LayoutError(`There is already a layout called ${same.name}.`, 409, { id: same.id });
    const cap = shared ? LAYOUT_LIMITS.shared : LAYOUT_LIMITS.personal;
    if (current.length >= cap) {
      throw new LayoutError(shared
        ? `This ${words.word('space')} has ${cap} shared layouts. Delete one first.`
        : `You have ${cap} saved layouts here. Delete one first.`, 409);
    }
    const layout = { id: this.newId(spaceId), name, by, at: new Date().toISOString(), modules, ...(snap ? { snap } : {}), ...(icon ? { icon } : {}) };
    this.listOf(spaceId, owner, true).push(layout);
    this.save();
    return copy(layout);
  }

  // Renames or replaces a layout `userKey` can see (found by find()); `patch` is cleanLayout's partial answer. The
  // caller has already decided whether this person may change it. `at` moves to now; `by` stays who first saved it.
  update(spaceId, layoutId, userKey, patch) {
    this.mustWrite();
    const found = this.find(spaceId, layoutId, userKey);
    if (!found) return null;
    const list = this.listOf(spaceId, found.shared ? null : userKey);
    const layout = list.find((l) => l.id === layoutId);
    if (patch.name !== undefined) {
      const same = list.find((l) => l.id !== layoutId && l.name.toLowerCase() === patch.name.toLowerCase());
      if (same) throw new LayoutError(`There is already a layout called ${same.name}.`, 409, { id: same.id });
      layout.name = patch.name;
    }
    if (patch.modules !== undefined) layout.modules = patch.modules;
    if (patch.snap !== undefined) layout.snap = patch.snap;
    if (patch.icon !== undefined) layout.icon = patch.icon;
    layout.at = new Date().toISOString();
    this.save();
    return copy(layout);
  }

  // Deletes a layout `userKey` can see, and takes it out of every person's favorites in the space. true when there
  // was one.
  remove(spaceId, layoutId, userKey) {
    this.mustWrite();
    const found = this.find(spaceId, layoutId, userKey);
    if (!found) return false;
    const owner = found.shared ? null : userKey;
    const list = this.listOf(spaceId, owner);
    list.splice(list.findIndex((l) => l.id === layoutId), 1);
    const favorites = this.spaces[spaceId].favorites || {};
    for (const key of Object.keys(favorites)) favorites[key] = favorites[key].filter((id) => id !== layoutId);
    this.tidy(spaceId);
    this.save();
    return true;
  }

  // A removed space takes its layouts, shared and personal.
  forgetSpace(spaceId) {
    if (this.unreadable || !this.spaces[spaceId]) return;
    delete this.spaces[spaceId];
    this.save();
  }

  // A removed person takes their own layouts and their favorites in every space. Shared layouts they saved stay: they
  // are the space's.
  forgetPerson(userKey) {
    if (this.unreadable) return;
    let changed = false;
    for (const spaceId of Object.keys(this.spaces)) {
      const entry = this.spaces[spaceId];
      if (entry.people[userKey] || entry.favorites?.[userKey] || entry.system?.[userKey]) {
        delete entry.people[userKey];
        if (entry.favorites) delete entry.favorites[userKey];
        if (entry.system) delete entry.system[userKey];
        this.tidy(spaceId);
        changed = true;
      }
    }
    if (changed) this.save();
  }
}

module.exports = { Layouts, LayoutError, cleanLayout, cleanSystemPatch, LAYOUT_LIMITS, SYSTEM_IDS, SYSTEM_ICONS, USER_ICON };
