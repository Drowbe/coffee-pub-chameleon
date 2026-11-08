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
  // for that key is this page's own echo or a repeat, and is skipped; after this page deletes a block, nothing for it is
  // taken until the delete itself comes back (a late echo of an older write does not bring it back), and once a delete is
  // heard the key starts afresh, so a block brought back with the same id (an undo) is taken, whatever its version; a change that arrives while this page is writing
  // the same key waits until the write is done and is then judged the same way; a value that is not a block is left out.
  // A write the server turns away for now (429: too many saves in a minute, as when many blocks move at once) is sent
  // again after the wait it names, unless a newer one for that key has come meanwhile; onBusy hears it once per refusal.
  // Two writes to one block at once: the last write wins (no version is sent). Conflict handling, when it comes, sends the
  // version this page saw ({ version } on set) and resolves a 409 here.
  function createSync({ host, board, clean, onRemote, onReload, onRefused, onBusy = () => {} }) {
    const PREFIX = `block:${board}:`;
    const keyOf = (id) => PREFIX + id;
    const idOf = (key) => key.slice(PREFIX.length);
    const GONE = Symbol('gone');
    const seen = new Map(); // key -> the newest version this page knows of (Infinity: deleted here, until that is heard back)
    const lanes = new Map(); // key -> { busy, next, soon, timer, deferred }
    const lane = (key) => {
      let l = lanes.get(key);
      if (!l) { l = { busy: false, next: undefined, soon: undefined, timer: 0, deferred: null }; lanes.set(key, l); }
      return l;
    };
    const active = (l) => Boolean(l && (l.busy || l.timer || l.next !== undefined));

    async function load() {
      const list = await host.storage.list(PREFIX);
      seen.clear();
      const out = [];
      for (const entry of Array.isArray(list) ? list : []) {
        const b = clean(entry.value);
        if (!b || keyOf(b.id) !== entry.key) continue;
        seen.set(entry.key, Number.isFinite(entry.version) ? entry.version : 0);
        out.push(b);
      }
      return out;
    }

    // What the server holds for one key, put on the page as it is (after a refused write, or a change with no value).
    async function refetch(key) {
      try {
        const got = await host.storage.get(key);
        if (!got) { seen.delete(key); onRemote({ op: 'remove', id: idOf(key) }); return; }
        seen.set(key, Number.isFinite(got.version) ? got.version : 0);
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
            await host.storage.delete(key);
            seen.set(key, Infinity);
          } else {
            const r = await host.storage.set(key, value);
            if (r && Number.isFinite(r.version)) seen.set(key, Math.max(seen.get(key) || 0, r.version));
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
          await refetch(key);
        } finally {
          l.busy = false;
        }
      }
      if (l.timer) return;
      if (l.deferred) { const d = l.deferred; l.deferred = null; accept(d); }
      if (!active(l) && !l.deferred) lanes.delete(key);
    }

    function accept(e) {
      const have = seen.get(e.key);
      if (have === Infinity && !e.deleted) return; // deleted here; a late echo of an older write does not bring it back
      if (e.deleted) { seen.delete(e.key); if (have !== Infinity) onRemote({ op: 'remove', id: idOf(e.key) }); return; }
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
          if (v) queue(key, v);
        }
      },
      // A 'change' event.
      handle(e) {
        if (!e || typeof e.key !== 'string' || !e.key.startsWith(PREFIX)) return;
        if (e.scope && e.scope !== 'space') return;
        const l = lanes.get(e.key);
        if (active(l)) { l.deferred = e; return; } // judged once this page's own write is done
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
