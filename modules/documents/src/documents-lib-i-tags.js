
// ---- tags on a record: ids from the space's shared tags (no page, no host) ---------------------------------------------------
//
//   tags:<id>   { id:<record id>, type:'tags', tags:[tag id, ...], by, at }
// The tags are kept apart from the small text record, so a tag change and a text save never write the same key: neither can
// answer the other with a 409 or write the other's change away. Only ids are stored (never a name); the names and colours live in
// the space's tag list. An id is the shape the server makes (8 to 12 lower-case letters and digits); at most 8 to a record.
const DL_TAGS_MAX = 8;
const DL_TAG_ID = /^[a-z0-9]{8,12}$/;
const dlTagsKey = (id) => `tags:${id}`;
// A list of ids -> only the ids of the right shape, each once, in order, the first 8.
function dlCleanTagIds(v) {
  const out = [];
  if (!Array.isArray(v)) return out;
  for (const t of v) {
    if (typeof t === 'string' && DL_TAG_ID.test(t) && !out.includes(t)) out.push(t);
    if (out.length >= DL_TAGS_MAX) break;
  }
  return out;
}
// The tags record, or null.
function dlCleanTags(v, id) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.type !== 'tags' || v.id !== id) return null;
  return { id, type: 'tags', tags: dlCleanTagIds(v.tags), by: dlUserKey(v.by) || '', at: dlTime(v.at) || '' };
}
// Only the ids that are tags of the space now (a deleted tag leaves a dead id; it is not shown and not kept). `known` is a Set or Map.
const dlKnownTagIds = (ids, known) => dlCleanTagIds(ids).filter((t) => known.has(t));
// What changed between two tick lists: { add, remove }.
function dlTagsDelta(before, after) {
  const a = dlCleanTagIds(before);
  const b = dlCleanTagIds(after);
  return { add: b.filter((t) => !a.includes(t)), remove: a.filter((t) => !b.includes(t)) };
}
// A change applied to whatever is stored now (never replacing the stored list): the removals out, the additions in, dead ids dropped,
// the first 8 kept. -> { ids, full } where full says an addition did not fit.
function dlTagsApply(stored, delta, known) {
  const gone = new Set(dlCleanTagIds(delta && delta.remove));
  const keep = dlKnownTagIds(stored, known).filter((t) => !gone.has(t));
  const ids = [];
  let full = false;
  for (const t of [...keep, ...dlKnownTagIds(delta && delta.add, known)]) {
    if (ids.includes(t)) continue;
    if (ids.length >= DL_TAGS_MAX) { full = true; continue; }
    ids.push(t);
  }
  return { ids, full };
}
// Saves a tag change under the version read: read, apply the change to what is stored, write with that version; on a 409 (another
// person tagged first) read again and apply the same change once more, up to `tries` times. `store` is { get(key) -> { value, version } | null,
// set(key, value, { version }) }; the 409 is an error with status 409. -> { ids, full }. Nothing here touches the text record.
async function dlTagsCommit({ store, id, delta, known, me, now, tries = 4 }) {
  for (let n = 0; ; n += 1) {
    const cur = await store.get(dlTagsKey(id));
    const rec = cur ? dlCleanTags(cur.value, id) : null;
    const out = dlTagsApply(rec ? rec.tags : [], delta, known);
    const next = { id, type: 'tags', tags: out.ids, by: me, at: now };
    try {
      await store.set(dlTagsKey(id), next, { version: cur ? cur.version : 0 });
      return out;
    } catch (err) {
      if (!err || err.status !== 409 || n + 1 >= tries) throw err;
    }
  }
}
// How many records have each tag: Map tag id -> number, over `lists` (arrays of ids), counting only known tags.
function dlTagCounts(lists, known) {
  const counts = new Map();
  for (const ids of lists) for (const t of dlKnownTagIds(ids, known)) counts.set(t, (counts.get(t) || 0) + 1);
  return counts;
}
// The tag filter: a record passes when it has every chosen tag (no choice passes all). A chosen tag that no longer exists is ignored.
function dlTagsMatch(ids, chosen, known) {
  const want = dlCleanTagIds(chosen).filter((t) => known.has(t));
  if (!want.length) return true;
  const have = dlKnownTagIds(ids, known);
  return want.every((t) => have.includes(t));
}
