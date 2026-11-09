  // ---- whiteboard-lib-c-sync.js: storage and live changes, all of it ----------------------------------------------------
  //
  // The only code that reads or writes host.storage or hears 'change'. Each block is saved whole under its own key,
  // block:<board>:<id>, so two people changing different blocks never overwrite each other, and what is sent is the whole
  // block as it is now (a stroke's every point, a moved block's final place), never a step the other side must work out.
  //
  // Writes go one at a time per key, the newest last: a write asked for while one is on its way waits and replaces any
  // other waiting one. saveSoon waits a moment first (nudging with the arrow keys saves once, after the last press).
  //
  // What comes in is checked before anyone draws it: a change whose version is not newer than the one this page last saw
  // for that key is this page's own echo or a repeat, and is skipped. Changes that arrive while this page is writing the
  // same key wait, in the order they came, until the write is done, and are then judged one by one the same way; a value
  // that is not a block is left out.
  //
  // After this page deletes a block, the key waits for that delete to be heard back: nothing but a delete is taken for it
  // meanwhile, so a late echo of an older write does not bring the block back. The server numbers a key afresh after a
  // delete (from 1), so an old echo can carry the same version as a write made since; that is why a successful write of
  // the key (an undo bringing the block back with the same id) does not end the wait: its version says nothing about what
  // is still on its way. The wait ends on:
  //   - a delete whose version is this page's delete's (`at`): its own; the key starts afresh, and if this page has written
  //     the block again meanwhile, the version that write got is what it has seen, else nothing;
  //   - a delete with a higher version: a later one, someone else's, heard after this page's own was missed (the stream
  //     can reconnect without what it missed); it is taken like any delete. One with a lower version is older: ignored;
  //   - the echo of this page's own write since the delete (the same version and the very same block): the delete came
  //     before it, heard or missed;
  //   - load(), which reads the board again;
  //   - a refused delete of the key: the block is read again and put back, and nothing is waited for (an earlier delete's
  //     echo, missed, could otherwise hold the key for good).
  // A delete answered with version 0 found the key gone already: there is no delete of this page's to wait for.
  //
  // A write the server turns away for now (429: too many saves in a minute, as when many blocks move at once) is sent
  // again after the wait it names, unless a newer one for that key has come meanwhile; onBusy hears it once per refusal.
  // Two writes to one block at once: the last write wins (no version is sent). Conflict handling, when it comes, sends the
  // version this page saw ({ version } on set) and resolves a 409 here.
  function createSync({ host, board, clean, onRemote, onReload, onRefused, onBusy = () => {} }) {
    const PREFIX = `block:${board}:`;
    const keyOf = (id) => PREFIX + id;
    const idOf = (key) => key.slice(PREFIX.length);
    const GONE = Symbol('gone');
    const seen = new Map(); // key -> the newest version this page knows of
    // key -> { at, mine, writes } while this page's delete of the block is not heard back: `at` the delete's version, `mine`
    // the newest version this page has seen for the key since (its own writes, a read; 0: none), `writes` this page's own
    // writes since (version -> the block as sent, as JSON), to know their echo
    const gone = new Map();
    const lanes = new Map(); // key -> { busy, next, soon, timer, deferred: [changes heard meanwhile, oldest first] }
    const lane = (key) => {
      let l = lanes.get(key);
      if (!l) { l = { busy: false, next: undefined, soon: undefined, timer: 0, deferred: [] }; lanes.set(key, l); }
      return l;
    };
    // What this page has seen for a key: its own write's version goes aside while its delete is not heard yet.
    const saw = (key, version, value) => {
      const g = gone.get(key);
      if (!g) { seen.set(key, Math.max(seen.get(key) || 0, version)); return; }
      g.mine = Math.max(g.mine, version);
      if (value !== undefined) g.writes.set(version, JSON.stringify(value));
    };
    const active = (l) => Boolean(l && (l.busy || l.timer || l.next !== undefined));

    // The board as the server holds it, with this page's own writes that have not gone yet laid over it (they will land
    // after the read, and their echo is this page's own, so it would not be drawn).
    async function load() {
      const list = await host.storage.list(PREFIX);
      seen.clear();
      gone.clear();
      const out = new Map();
      for (const entry of Array.isArray(list) ? list : []) {
        const b = clean(entry.value);
        if (!b || keyOf(b.id) !== entry.key) continue;
        seen.set(entry.key, Number.isFinite(entry.version) ? entry.version : 0);
        out.set(entry.key, b);
      }
      for (const [key, l] of lanes) {
        const v = l.soon !== undefined ? l.soon : l.next;
        if (v === GONE) out.delete(key);
        else if (v !== undefined) { const b = clean(v); if (b) out.set(key, b); }
      }
      return [...out.values()];
    }

    // What the server holds for one key, put on the page as it is (after a refused write, or a change with no value).
    async function refetch(key) {
      try {
        const got = await host.storage.get(key);
        if (!got) { seen.delete(key); onRemote({ op: 'remove', id: idOf(key) }); return; }
        if (gone.has(key)) gone.get(key).mine = Number.isFinite(got.version) ? got.version : 0;
        else seen.set(key, Number.isFinite(got.version) ? got.version : 0);
        const b = clean(got.value);
        if (b && keyOf(b.id) === key) onRemote({ op: 'put', block: b });
      } catch { /* the next change or a reload puts it right */ }
    }

    function queue(key, value) {
      const l = lane(key);
      if (l.timer) { clearTimeout(l.timer); l.timer = 0; l.soon = undefined; }
      l.next = value;
      if (!l.busy) pump(key);
    }

    async function pump(key) {
      const l = lane(key);
      let tries = 0;
      while (l.next !== undefined) {
        const value = l.next;
        l.next = undefined;
        l.busy = true;
        try {
          if (value === GONE) {
            const r = await host.storage.delete(key);
            seen.delete(key);
            const at = r && Number.isFinite(r.version) ? r.version : 0;
            if (at > 0) gone.set(key, { at, mine: 0, writes: new Map() }); // 0: it was gone already, nothing to wait for
          } else {
            const r = await host.storage.set(key, value);
            if (r && Number.isFinite(r.version)) saw(key, r.version, value);
          }
        } catch (err) {
          if (err && err.status === 429 && tries < 8) {
            tries += 1;
            onBusy(err);
            await new Promise((r) => { setTimeout(r, Math.max(1, Number(err.retryAfter) || 5) * 1000); });
            if (l.next === undefined) l.next = value; // nothing newer came: send this one again
            continue;
          }
          onRefused(err, idOf(key));
          if (value === GONE) gone.delete(key); // not deleted: no delete of this page's to wait for
          await refetch(key);
        } finally {
          l.busy = false;
        }
      }
      drain(key, l);
    }

    // The changes heard while the key was being written, in the order they came, each judged as if it came now.
    function drain(key, l) {
      while (l.deferred.length && !active(l)) accept(l.deferred.shift());
      if (!active(l) && !l.deferred.length) lanes.delete(key);
    }

    function accept(e) {
      const g = gone.get(e.key);
      if (g) {
        // Deleted here, and the delete not heard back yet (see the top of this file). The block is already off this page,
        // or back on it by this page's own write.
        const v = Number.isFinite(e.version) ? e.version : null;
        if (!e.deleted) {
          const own = v !== null ? g.writes.get(v) : undefined;
          if (own === undefined || own !== JSON.stringify(e.value)) return; // a late echo of an older write
          gone.delete(e.key); // this page's own write since: its delete came before it
          seen.set(e.key, Math.max(g.mine, v));
          return;
        }
        if (v !== null && v < g.at) return; // an older delete; this page's is to come
        gone.delete(e.key);
        if (v !== null && v > g.at) { seen.delete(e.key); onRemote({ op: 'remove', id: idOf(e.key) }); return; } // a later one
        if (g.mine > 0) seen.set(e.key, g.mine); else seen.delete(e.key);
        return;
      }
      const have = seen.get(e.key);
      if (e.deleted) { seen.delete(e.key); onRemote({ op: 'remove', id: idOf(e.key) }); return; }
      if (have !== undefined && Number.isFinite(e.version) && e.version <= have) return; // our own echo, or a repeat
      if (Number.isFinite(e.version)) seen.set(e.key, e.version);
      const id = idOf(e.key);
      if (e.value === undefined) { refetch(e.key); return; }
      const b = clean(e.value);
      if (!b || b.id !== id) return; // not a block this page can draw
      onRemote({ op: 'put', block: b });
    }

    return {
      keyOf,
      load,
      save(block) { queue(keyOf(block.id), block); },
      saveSoon(block, ms = 600) {
        const key = keyOf(block.id);
        const l = lane(key);
        l.soon = block;
        if (l.timer) clearTimeout(l.timer);
        l.timer = setTimeout(() => { l.timer = 0; const v = l.soon; l.soon = undefined; if (v) queue(key, v); }, ms);
      },
      remove(id) { queue(keyOf(id), GONE); },
      // Send whatever is waiting now (the page is going away).
      flush() {
        for (const [key, l] of lanes) {
          if (!l.timer) continue;
          clearTimeout(l.timer);
          l.timer = 0;
          const v = l.soon;
          l.soon = undefined;
          if (v) queue(key, v); // a timer always has its block, and the write drains the lane when it is done
        }
      },
      // A 'change' event.
      handle(e) {
        if (!e || typeof e.key !== 'string' || !e.key.startsWith(PREFIX)) return;
        if (e.scope && e.scope !== 'space') return;
        const l = lanes.get(e.key);
        // Judged once this page's own write is done. (A lane with changes waiting is always active: every write drains its
        // lane when it ends, and stops only for another write or a wait, which drains it in turn.)
        if (l && active(l)) { l.deferred.push(e); return; }
        accept(e);
      },
      // A 'changes' event (a Clear, its Undo): read the board again.
      handleMany(e) {
        if (!e || (e.scope && e.scope !== 'space')) return;
        const list = Array.isArray(e.changes) ? e.changes : [];
        if (e.cleared || e.restored || list.some((c) => !c.deleted && c.value === undefined)) { onReload(); return; }
        for (const c of list) this.handle({ ...c, scope: e.scope });
      },
    };
  }
