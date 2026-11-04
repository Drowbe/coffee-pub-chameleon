// The links between modules' objects: "this task points at that event". A module stores its own
// pointers; this registry is where the host learns of them, so that the item pointed at can ask what
// points at it (backlinks) without the host knowing anything about tasks, events or polls. It holds
// only pointers ({ module, kind, id, scope, space? }), never an item's content, and every answer is
// filtered to what the asking person may see. Persists to DATA_DIR/modules/links.json.

'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const LIMITS = { perItem: 20, total: 20000 };

const key = (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|');
const plain = (r) => ({ module: r.module, kind: r.kind, id: r.id, scope: r.scope, ...(r.scope === 'space' ? { space: r.space } : {}) });

class ModuleLinks extends EventEmitter {
  constructor(modulesDir) {
    super();
    this.setMaxListeners(0);
    this.file = path.join(modulesDir, 'links.json');
    this.items = [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(raw)) this.items = raw.filter((l) => l && l.from && l.to);
    } catch {
      // none yet
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.items));
    fs.renameSync(tmp, this.file);
  }

  // Replace everything `from` points at with `tos`. Returns every pointer whose links changed.
  // With `kind`, only the links to objects of that kind are replaced (a module telling the host its files, whatever else the
  // object points at stays): every link of `from` to another kind is kept.
  // `mode` 'add' or 'remove' (with a kind): add `tos` to the links of that kind, or take them out, leaving the rest.
  set(from, tos, by, kind = null, mode = 'replace') {
    const fk = key(from);
    if (kind && mode !== 'replace') {
      const now = this.items.filter((l) => key(l.from) === fk && !l.pair && l.to.kind === kind).map((l) => l.to);
      tos = mode === 'add' ? [...now, ...tos] : now.filter((c) => !tos.some((t) => key(t) === key(c)));
    }
    // A pair is the server's, not the module's. Replacing what `from` points at leaves it in place.
    const pairs = this.items.filter((l) => key(l.from) === fk && (l.pair === 'active' || l.pair === 'detached'));
    const before = this.items.filter((l) => key(l.from) === fk && !l.pair && (!kind || l.to.kind === kind));
    const kept = this.items.filter((l) => key(l.from) !== fk);
    // With a kind, what `from` points at of other kinds stays, and counts against its 20.
    const others = kind ? this.items.filter((l) => key(l.from) === fk && !l.pair && l.to.kind !== kind) : [];
    const seen = new Set();
    const added = [];
    for (const to of tos.slice(0, Math.max(0, LIMITS.perItem - others.length))) {
      const tk = key(to);
      if (seen.has(tk) || tk === fk) continue;
      seen.add(tk);
      added.push({ from: plain(from), to: plain(to), by, at: Date.now() });
    }
    if (kept.length + others.length + added.length + pairs.length > LIMITS.total) return [];
    const same = before.length === added.length && before.every((l) => seen.has(key(l.to)));
    if (same) return [];
    this.items = [...kept, ...others, ...added, ...pairs];
    this.save();
    // Fresh copies, never the stored pointers: the stream gives each emitted object its own event id (index.js,
    // eventIdOf), so emitting a stored `l.to` twice (linked, unlinked, linked again) would give two events one id and
    // the page would drop the second as already heard.
    const changed = [plain(from), ...before.map((l) => plain(l.to)), ...added.map((l) => plain(l.to))];
    this.emit('change', { refs: changed });
    return changed;
  }

  // What points at `ref`, and what `ref` points at.
  to(ref) {
    const k = key(ref);
    return this.items.filter((l) => key(l.to) === k).map((l) => l.from);
  }

  from(ref) {
    const k = key(ref);
    return this.items.filter((l) => key(l.from) === k).map((l) => l.to);
  }

  // Pairs are links the server keeps between a dated object and its twin. `to` and `from` include them.
  pairsFrom(ref) {
    const k = key(ref);
    return this.items.filter((l) => l.pair && key(l.from) === k).map((l) => ({ pair: l.pair, from: plain(l.from), to: plain(l.to) }));
  }

  pairTo(ref) {
    const k = key(ref);
    const found = this.items.find((l) => l.pair && key(l.to) === k);
    return found ? { pair: found.pair, from: plain(found.from), to: plain(found.to) } : null;
  }

  // Who is whose copy, for flagging summaries: `copyOf(ref)` the original an object is the active copy of (or null),
  // `copiesOf(ref)` the copies an original has. A detached pair is a hidden copy, so it is neither.
  pairIndex() {
    const originals = new Map();
    const copies = new Map();
    for (const l of this.items) {
      if (l.pair !== 'active') continue;
      originals.set(key(l.to), plain(l.from));
      const k = key(l.from);
      if (!copies.has(k)) copies.set(k, []);
      copies.get(k).push(plain(l.to));
    }
    return { copyOf: (ref) => originals.get(key(ref)) || null, copiesOf: (ref) => copies.get(key(ref)) || [] };
  }

  addPair(from, to, by) {
    const fk = key(from);
    const rest = this.items.filter((l) => !(l.pair && key(l.from) === fk && l.to.module === to.module && l.to.kind === to.kind));
    if (rest.length + 1 > LIMITS.total) return;
    this.items = [...rest, { from: plain(from), to: plain(to), by, at: Date.now(), pair: 'active' }];
    this.save();
    this.emit('change', { refs: [plain(from), plain(to)] });
  }

  detachPair(ref) {
    const k = key(ref);
    let hit = null;
    this.items = this.items.map((l) => {
      if (l.pair === 'active' && key(l.to) === k) { hit = l; return { ...l, pair: 'detached' }; }
      return l;
    });
    if (!hit) return;
    this.save();
    this.emit('change', { refs: [plain(hit.from), plain(hit.to)] });
  }

  // Every pair `ref` sends. With `keepDetached`, a detached one (a copy hidden on purpose) stays as the record of it.
  removePairs(ref, keepDetached = false) {
    const fk = key(ref);
    const dies = (l) => l.pair && key(l.from) === fk && !(keepDetached && l.pair === 'detached');
    const gone = this.items.filter(dies);
    if (!gone.length) return;
    this.items = this.items.filter((l) => !dies(l));
    this.save();
    const refs = [plain(ref)];
    for (const l of gone) refs.push(plain(l.to));
    this.emit('change', { refs });
  }

  // The object is gone: every link it held, and every link that pointed at it, goes too.
  drop(ref) {
    const k = key(ref);
    const left = this.items.filter((l) => key(l.from) !== k && key(l.to) !== k);
    if (left.length === this.items.length) return;
    const gone = this.items.filter((l) => key(l.from) === k || key(l.to) === k);
    this.items = left;
    this.save();
    const refs = [];
    for (const l of gone) refs.push(plain(l.from), plain(l.to));
    this.emit('change', { refs });
  }

  // A deleted space: every pointer in it, and every link that has one end in it, goes.
  forgetSpace(spaceId) {
    const inSpace = (r) => r && r.scope === 'space' && r.space === spaceId;
    const left = this.items.filter((l) => !inSpace(l.from) && !inSpace(l.to));
    if (left.length === this.items.length) return 0;
    const gone = this.items.length - left.length;
    this.items = left;
    this.save();
    return gone;
  }

  // A module was uninstalled with its data: its links, both ways, go too.
  dropModule(id) {
    const left = this.items.filter((l) => l.from.module !== id && l.to.module !== id);
    if (left.length === this.items.length) return;
    this.items = left;
    this.save();
  }
}

module.exports = { ModuleLinks, objectKey: key };
