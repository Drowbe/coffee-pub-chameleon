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
  // After this page deletes a block, the key waits for that delete to be heard back. Meanwhile no change heard for the key
  // is drawn as it is, because the server numbers a key afresh after a delete (from 1): a change heard now may be older
  // than this page's delete (still on its way, a late echo of an older write, someone else's life of the block before)
  // or later (this page's echo was missed: the stream can reconnect without what it missed), and its version cannot
  // tell which. Instead each one is answered by reading the key (refetch): this page's delete was answered already, so
  // what the server holds now is never older than it. The page shows that, unless it shows it already (this page's own
  // block back by an undo), so it is never blind to the key and never shows an older life of it. The wait ends on:
  //   - a delete whose version is this page's oldest delete not heard yet (`at`), made by this person (`me`; the change's
  //     `by`): its own (with several, the wait goes on for the next); the key starts afresh, and if this page has written
  //     the block again meanwhile, the version that write got is what it has seen, else nothing (the key is read once more
  //     when something else was drawn while waiting);
  //   - the echo of this page's own write since the delete (the same version and the very same block): the delete came
  //     before it, heard or missed;
  //   - a refused delete of the key: the block is read again and put back, and nothing is waited for (an earlier delete's
  //     echo, missed, could otherwise hold the key for good).
  // Neither does a successful write of the key (an undo bringing the block back with the same id: its version says
  // nothing about what is still on its way), nor load() (what is still on its way may be older than what it read). A
  // delete answered with version 0 found the key gone already: there is no delete of this page's to wait for. A read
  // answered after something newer for the key was taken, or while this page is writing it, is not used (the newer
  // change, or the write, is what the page shows).
  //
  // A write the server turns away for now (429: too many saves in a minute, as when many blocks move at once) is sent
  // again after the wait it names, unless a newer one for that key has come meanwhile; onBusy hears it once per refusal.
  // Two writes to one block at once: the last write wins (no version is sent). Conflict handling, when it comes, sends the
  // version this page saw ({ version } on set) and resolves a 409 here.
  function createSync({ host, board, clean, me = '', onRemote, onReload, onRefused, onBusy = () => {} }) {
    const PREFIX = `block:${board}:`;
    const keyOf = (id) => PREFIX + id;
    const idOf = (key) => key.slice(PREFIX.length);
    const GONE = Symbol('gone');
    const seen = new Map(); // key -> the newest version this page knows of
    // key -> { pending, mine, shows, drawn } while a delete of the block by this page is not heard back: `pending` this
    // page's deletes not heard yet, oldest first, each { at: its version, writes: this page's own writes after it (version
    // -> the block as sent, as JSON), to know their echo }, `mine` the newest version this page has seen for the key since
    // its last delete (its own writes, a read; 0: none), `shows` what the page shows for the key (JSON, or null: nothing),
    // `drawn` whether a read put something else there meanwhile
    const gone = new Map();
    const tickets = new Map(); // key -> a number that grows with each read asked for and each change taken (refetch)
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
      if (value !== undefined) { g.pending[g.pending.length - 1].writes.set(version, JSON.stringify(value)); g.shows = JSON.stringify(value); }
    };
    const bump = (key) => { const t = (tickets.get(key) || 0) + 1; tickets.set(key, t); return t; };
    const active = (l) => Boolean(l && (l.busy || l.timer || l.next !== undefined));

    // The board as the server holds it, with this page's own writes that have not gone yet laid over it (they will land
    // after the read, and their echo is this page's own, so it would not be drawn).
    async function load() {
      const list = await host.storage.list(PREFIX);
      seen.clear();
      const out = new Map();
      for (const g of gone.values()) g.shows = null;
      for (const entry of Array.isArray(list) ? list : []) {
        const b = clean(entry.value);
        if (!b || keyOf(b.id) !== entry.key) continue;
        const version = Number.isFinite(entry.version) ? entry.version : 0;
        const g = gone.get(entry.key);
        // A key still waiting for this page's delete goes on waiting (what is still on its way may be older than this
        // read); it shows what was read.
        if (g) { g.mine = Math.max(g.mine, version); g.shows = JSON.stringify(entry.value); g.drawn = true; } else seen.set(entry.key, version);
        out.set(entry.key, b);
      }
      for (const [key, l] of lanes) {
        const v = l.soon !== undefined ? l.soon : l.next;
        if (v === GONE) out.delete(key);
        else if (v !== undefined) { const b = clean(v); if (b) out.set(key, b); }
      }
      return [...out.values()];
    }

    // What the server holds for one key, put on the page as it is (after a refused write, a change with no value, a change
    // heard while waiting for this page's delete). Not used when a newer read was asked for or a change for the key taken
    // since, or (unless it is the write's own read, `writing`) while this page is writing the key. `shows`: what the page
    // shows for the key, when known (JSON, or null: nothing), so the same is not drawn again.
    async function refetch(key, writing = false, shows = undefined) {
      const t = bump(key);
      try {
        const got = await host.storage.get(key);
        if (tickets.get(key) !== t || (!writing && active(lanes.get(key)))) return;
        const version = got && Number.isFinite(got.version) ? got.version : 0;
        const b = got ? clean(got.value) : null;
        const block = b && keyOf(b.id) === key ? b : null;
        const g = gone.get(key);
        if (g) {
          // Waiting for this page's delete: drawn only when it is not what the page shows already.
          g.mine = Math.max(g.mine, version);
          const shows = block ? JSON.stringify(got.value) : null;
          if (shows === g.shows) return;
          g.shows = shows;
          g.drawn = true;
          onRemote(block ? { op: 'put', block } : { op: 'remove', id: idOf(key) });
          return;
        }
        if (!got) { seen.delete(key); if (shows !== null) onRemote({ op: 'remove', id: idOf(key) }); return; }
        seen.set(key, version);
        if (block && (shows === undefined || shows !== JSON.stringify(got.value))) onRemote({ op: 'put', block });
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
            if (at > 0) { // 0: it was gone already, nothing to wait for
              const g = gone.get(key) || { pending: [], drawn: false };
              g.pending.push({ at, writes: new Map() });
              Object.assign(g, { mine: 0, shows: null });
              gone.set(key, g);
            }
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
          await refetch(key, true);
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
        // Deleted here, and the delete not heard back yet (see the top of this file).
        const v = Number.isFinite(e.version) ? e.version : null;
        const json = e.deleted ? null : JSON.stringify(e.value);
        // This page's oldest delete not heard yet, or the echo of a write of its own made after one of them (those deletes
        // came before it): heard. Its deletes' echoes come in the order they were made.
        const mineToo = !me || typeof e.by !== 'string' || !e.by || e.by === me; // a delete by someone else is not this page's
        const upTo = e.deleted ? (v !== null && v === g.pending[0].at && mineToo ? 0 : -1) : g.pending.findIndex((d) => v !== null && d.writes.get(v) === json);
        if (upTo < 0) { refetch(e.key); return; } // older or later, the version cannot tell: what the server holds now
        g.pending.splice(0, upTo + 1);
        if (g.pending.length) return; // a later delete of this page's still to come
        gone.delete(e.key); // the wait is over
        const was = Math.max(g.mine, e.deleted ? 0 : v);
        if (was > 0) seen.set(e.key, was); else seen.delete(e.key);
        if (g.drawn) refetch(e.key, false, g.shows); // a read drew something meanwhile: read once more, now heard as usual
        return;
      }
      const have = seen.get(e.key);
      if (e.deleted) { bump(e.key); seen.delete(e.key); onRemote({ op: 'remove', id: idOf(e.key) }); return; }
      if (have !== undefined && Number.isFinite(e.version) && e.version <= have) return; // our own echo, or a repeat
      if (Number.isFinite(e.version)) seen.set(e.key, e.version);
      const id = idOf(e.key);
      if (e.value === undefined) { refetch(e.key); return; }
      const b = clean(e.value);
      if (!b || b.id !== id) return; // not a block this page can draw
      bump(e.key);
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
