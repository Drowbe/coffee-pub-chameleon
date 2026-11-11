// The shared tags (documentation/plans/plan-tags.md, "The contract"): one list of tags per space, that every module
// that opts in (`"tags": true` in its manifest) tags its objects from. An object holds tag ids; names and colours live
// only here, so a rename reaches every use. One file per environment, DATA_DIR/tags.json (so the environment's export and
// the host console's backup carry it, and deleting a space removes its list: server/space-erase.js):
//
//   { "spaces": { "<space id>": [ { id, name, color, by, at } ] } }
//
// The rules live in this file and nowhere else (the routes, the move helper and loading the file all call them):
//   name   1 to 24 characters (as a person counts them), letters of any language, digits and dashes, lower case, NFKC.
//          Whitespace becomes a dash. Zero-width, direction and other invisible characters are taken out. `<`, `>`, `&`
//          and quotes are not letters, so a stored name carries no HTML (pages still use textContent). Unique in its list.
//   color  a tone name from TONES, or '' (plain). Never a free colour.
//   id     10 lower-case letters and digits, made here from crypto, unique across every space of the environment (so an
//          id from one space is simply not a tag in another) and checked as ID_RE wherever one is read.
//   limits 8 tags to an object, 200 to a list.
// The maps are made without a prototype and a stored `__proto__` key is skipped, so a damaged file cannot reach
// Object.prototype (the same care as server/facts.js).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const LIMITS = { name: 24, perObject: 8, perList: 200, rawName: 200 };
// The tones a tag may wear: the theme's eight tints by name (--tint-<name>; public/sdk/system.css draws them, and
// public/module-chrome.js's TINT is the same eight). Plain is ''. Not decided in the plan, so one list here.
const TONES = ['gold', 'blue', 'green', 'teal', 'purple', 'red', 'orange', 'pink'];
const ID_LENGTH = 10;
const ID_RE = /^[a-z0-9]{8,12}$/;
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

class TagError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Characters that show nothing yet change what is shown or how it sorts: the format characters (zero-width, direction
// marks and overrides, joiners, the soft hyphen, the byte order mark, tag characters), controls, the combining grapheme
// joiner, the Hangul and Khmer fillers, and variation selectors.
const INVISIBLE = /[\p{Cf}\p{Cc}͏ᅟᅠ឴឵᠋-᠏ㅤ︀-️ﾠ\u{E0100}-\u{E01EF}]/gu;
const NAME_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*$/u;
const chars = (s) => [...s].length; // code points: a character outside the basic plane counts as one

// The one cleaning function for a name: { name } (normalised) or { error } (one plain sentence).
function cleanName(raw) {
  if (typeof raw !== 'string') return { error: 'A tag needs a name.' };
  if (raw.length > LIMITS.rawName) return { error: `A tag can be at most ${LIMITS.name} characters.` };
  const name = raw
    .normalize('NFKC')
    .replace(/[\s\p{Z}]+/gu, '-')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!name) return { error: 'A tag needs a name.' };
  if (!NAME_SHAPE.test(name)) return { error: 'A tag can hold letters, digits and dashes only.' };
  if (chars(name) > LIMITS.name) return { error: `A tag can be at most ${LIMITS.name} characters.` };
  // Whatever is left must not change if cleaned again, or two spellings of one name could slip in as two tags.
  if (name.toLowerCase().normalize('NFKC') !== name) return { error: 'A tag can hold letters, digits and dashes only.' };
  return { name };
}

// { color } ('' is plain) or { error }.
function cleanColor(raw) {
  if (raw === undefined || raw === null || raw === '') return { color: '' };
  if (typeof raw === 'string' && TONES.includes(raw)) return { color: raw };
  return { error: `A tag's colour must be one of ${TONES.join(', ')}, or left plain.` };
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const publicTag = (t) => ({ id: t.id, name: t.name, color: t.color });
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

class Tags extends EventEmitter {
  constructor(dir, now = () => Date.now()) {
    super();
    this.setMaxListeners(0);
    this.dir = dir;
    this.file = path.join(dir, 'tags.json');
    this.now = now;
    this.spaces = Object.create(null); // space id -> [tag]
    this.ids = new Set(); // every id in use, in every space
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      // nothing yet, or a damaged file: no tags
    }
    for (const [spaceId, list] of Object.entries(isObject(raw?.spaces) ? raw.spaces : {})) {
      if (UNSAFE_KEYS.has(spaceId) || !Array.isArray(list)) continue;
      const kept = [];
      const names = new Set();
      for (const t of list) {
        if (kept.length >= LIMITS.perList) break;
        if (!isObject(t) || typeof t.id !== 'string' || !ID_RE.test(t.id) || this.ids.has(t.id)) continue;
        const { name } = cleanName(t.name);
        if (!name || names.has(name)) continue;
        names.add(name);
        this.ids.add(t.id);
        kept.push({ id: t.id, name, color: cleanColor(t.color).color || '', by: typeof t.by === 'string' ? t.by.slice(0, 64) : '', at: typeof t.at === 'string' ? t.at.slice(0, 32) : '' });
      }
      if (kept.length) this.spaces[spaceId] = kept;
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ spaces: this.spaces })}\n`);
    fs.renameSync(tmp, this.file);
  }

  // Replace a space's list and write it; the old list comes back when the write fails.
  commit(spaceId, next) {
    const before = this.spaces[spaceId];
    if (next.length) this.spaces[spaceId] = next;
    else delete this.spaces[spaceId];
    try {
      this.save();
    } catch (err) {
      if (before) this.spaces[spaceId] = before;
      else delete this.spaces[spaceId];
      throw err;
    }
  }

  // The space's tags as a page sees them, in name order: [{ id, name, color }].
  list(spaceId) {
    return (this.spaces[spaceId] || []).map(publicTag).sort(byName);
  }

  // One tag of this space as a page sees it, or null. An id of another space is not found here.
  get(spaceId, id) {
    const t = typeof id === 'string' && ID_RE.test(id) ? (this.spaces[spaceId] || []).find((x) => x.id === id) : null;
    return t ? publicTag(t) : null;
  }

  count(spaceId) {
    return (this.spaces[spaceId] || []).length;
  }

  newId() {
    for (let tries = 0; tries < 50; tries += 1) {
      let id = '';
      for (const b of crypto.randomBytes(ID_LENGTH)) id += ID_CHARS[b % ID_CHARS.length];
      if (!this.ids.has(id)) return id;
    }
    throw new TagError('A tag could not be made. Try again.', 500);
  }

  // Find the tag of this name in the space, or make it: { tag, made }. The colour is used only when made. Throws TagError:
  // 400 for a bad name or colour, 409 when the list holds 200.
  add(spaceId, rawName, rawColor, by) {
    const n = cleanName(rawName);
    if (n.error) throw new TagError(n.error);
    const c = cleanColor(rawColor);
    if (c.error) throw new TagError(c.error);
    if (UNSAFE_KEYS.has(spaceId)) throw new TagError('There is no such tag list.', 404);
    const list = this.spaces[spaceId] || [];
    const found = list.find((t) => t.name === n.name);
    if (found) return { tag: publicTag(found), made: false };
    if (list.length >= LIMITS.perList) throw new TagError(`This list already holds ${LIMITS.perList} tags. Delete one first.`, 409);
    const tag = { id: this.newId(), name: n.name, color: c.color, by: typeof by === 'string' ? by.slice(0, 64) : '', at: new Date(this.now()).toISOString() };
    this.commit(spaceId, [...list, tag]);
    this.ids.add(tag.id);
    this.emit('change', { spaceId, op: 'added', tag: publicTag(tag) });
    return { tag: publicTag(tag), made: true };
  }

  // Rename and/or recolour. Throws TagError: 400 (nothing to change, bad name or colour), 404, 409 (the name is taken).
  update(spaceId, id, patch) {
    const has = isObject(patch) && (patch.name !== undefined || patch.color !== undefined);
    if (!has) throw new TagError('Send a new name or a new colour.');
    let name;
    let color;
    if (patch.name !== undefined) {
      const n = cleanName(patch.name);
      if (n.error) throw new TagError(n.error);
      name = n.name;
    }
    if (patch.color !== undefined) {
      const c = cleanColor(patch.color);
      if (c.error) throw new TagError(c.error);
      color = c.color;
    }
    const list = this.spaces[spaceId] || [];
    const at = typeof id === 'string' && ID_RE.test(id) ? list.findIndex((t) => t.id === id) : -1;
    if (at < 0) throw new TagError('There is no such tag.', 404);
    if (name !== undefined && list.some((t, i) => i !== at && t.name === name)) throw new TagError('Another tag already has that name.', 409);
    const next = { ...list[at], ...(name !== undefined ? { name } : {}), ...(color !== undefined ? { color } : {}) };
    if (next.name === list[at].name && next.color === list[at].color) return publicTag(next);
    this.commit(spaceId, list.map((t, i) => (i === at ? next : t)));
    this.emit('change', { spaceId, op: 'changed', tag: publicTag(next) });
    return publicTag(next);
  }

  // Delete. Throws TagError 404. Objects keep the dead id; resolve() and cleanIds() drop it wherever it is read.
  remove(spaceId, id) {
    const list = this.spaces[spaceId] || [];
    const at = typeof id === 'string' && ID_RE.test(id) ? list.findIndex((t) => t.id === id) : -1;
    if (at < 0) throw new TagError('There is no such tag.', 404);
    const gone = list[at];
    this.commit(spaceId, list.filter((_, i) => i !== at));
    this.ids.delete(gone.id);
    this.emit('change', { spaceId, op: 'removed', tag: publicTag(gone) });
    return publicTag(gone);
  }

  // Delete a space's list with the space (server/space-erase.js). Answers how many tags went.
  forgetSpace(spaceId) {
    const list = this.spaces[spaceId];
    if (!list) return 0;
    this.commit(spaceId, []);
    for (const t of list) this.ids.delete(t.id);
    return list.length;
  }

  // What an object's tag ids stand for in this space: [{ id, name, color }] in the object's order, each once, with ids that
  // are not tags of this space (deleted, from another space, made up) left out, at most 8. Read, not trusted, whatever the
  // object holds.
  resolve(spaceId, ids) {
    const out = [];
    const seen = new Set();
    for (const id of Array.isArray(ids) ? ids : []) {
      if (out.length >= LIMITS.perObject) break;
      if (typeof id !== 'string' || seen.has(id)) continue;
      seen.add(id);
      const t = this.get(spaceId, id);
      if (t) out.push(t);
    }
    return out;
  }

  // The ids of resolve(), for a module cleaning an object's `tags` on writing or reading it.
  cleanIds(spaceId, ids) {
    return this.resolve(spaceId, ids).map((t) => t.id);
  }
}

// Moving or copying an object to another space (plan-tags.md, decision 10 and "Moving an object to another space"; step 5b).
// A pure server function; nothing calls it yet. The caller has already decided the person may move the object, and says
// whether they may create tags in the destination (`mayCreate`: the same check as the create route there). Never trusts
// names from a client: it takes the object's tag ids and reads each name from the source space's own list.
//   ids         the object's tag ids (any value; only ids that are tags of `fromSpace` count)
//   fromSpace   the space the object leaves; toSpace the one it goes to
//   mayCreate   true when the person has the create right in toSpace
//   by          the person's key, kept as the new tags' maker
// Answers { ids, dropped }: the object's tag ids in toSpace, at most 8, and what did not fit as [{ name, why }], `why` one of
// 'no-right' (a new tag was needed and the person may not make one), 'list-full' (the destination holds 200) or
// 'too-many' (the object already has 8) or 'invalid' (the name no longer passes the one rule). Names are from the source
// list, re-validated, so they are safe to show. A tag that is gone from the source is not reported: it was never shown.
function moveTagIds(tags, { ids, fromSpace, toSpace, mayCreate, by } = {}) {
  if (fromSpace === toSpace) return { ids: tags.cleanIds(fromSpace, ids), dropped: [] };
  const out = [];
  const dropped = [];
  // Every live tag the object names (not only the first 8), so extras are reported as dropped rather than lost silently.
  const all = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids.slice(0, 100) : []) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const t = tags.get(fromSpace, id);
    if (t) all.push(t);
  }
  for (const t of all) {
    const n = cleanName(t.name);
    if (n.error || n.name !== t.name) { dropped.push({ name: n.name || '', why: 'invalid' }); continue; }
    if (out.length >= LIMITS.perObject) { dropped.push({ name: n.name, why: 'too-many' }); continue; }
    const there = tags.list(toSpace).find((x) => x.name === n.name);
    if (there) { if (!out.includes(there.id)) out.push(there.id); continue; }
    if (!mayCreate) { dropped.push({ name: n.name, why: 'no-right' }); continue; }
    try {
      out.push(tags.add(toSpace, n.name, cleanColor(t.color).color || '', by).tag.id);
    } catch (err) {
      if (!(err instanceof TagError) || err.status !== 409) throw err;
      dropped.push({ name: n.name, why: 'list-full' });
    }
  }
  return { ids: out, dropped };
}

module.exports = { Tags, TagError, cleanName, cleanColor, moveTagIds, LIMITS, TONES, ID_RE };
