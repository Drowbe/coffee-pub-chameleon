  // ---- whiteboard-lib-r-resync.js: reading the board again after a missed stream, without losing local work ------------
  //
  // A page whose connection dropped may have missed changes, and nothing tells it. This works out what to do with a fresh
  // read of the board, as a merge rather than reload()'s full clear: nothing the person is doing here is touched.
  //   known:      the versions this page last saw, id -> version (a Map or an object; a block shown with no version: 0)
  //   remoteList: the board as the server holds it, the entries of a storage list ({ value, version }); each value is
  //               cleaned by wbClean before use, an entry that is not a block is left out
  //   pending:    ids that are being edited, dragged, held, drafted, waiting to be saved or waiting for a delete to be heard
  //               (a Set or an array): never put and never removed here
  // It returns { put: [{ block, version }], remove: [id] }: a remote block newer than the page's version (or not known)
  // is put; a block the server no longer holds is removed; equal or older ones are left as they are. Pure: no page, no host.
  function wbResyncPlan(known, remoteList, pending) {
    const have = known instanceof Map ? known : new Map(Object.entries(known && typeof known === 'object' ? known : {}));
    const busy = new Set(pending instanceof Set ? pending : Array.isArray(pending) ? pending : []);
    const out = { put: [], remove: [] };
    const present = new Set(); // every id the server holds, a block this page cannot read included (never removed on a guess)
    for (const entry of Array.isArray(remoteList) ? remoteList : []) {
      if (!entry || typeof entry !== 'object') continue;
      const raw = entry.value;
      if (raw && typeof raw === 'object' && typeof raw.id === 'string') present.add(raw.id);
      const b = wbClean(raw);
      if (!b) continue;
      present.add(b.id);
      if (busy.has(b.id)) continue;
      const version = Number.isFinite(entry.version) ? entry.version : 0;
      const had = have.has(b.id) ? Number(have.get(b.id)) || 0 : -1; // -1: not shown here
      if (had >= 0 && version <= had) continue;
      out.put.push({ block: b, version });
    }
    for (const id of have.keys()) if (!present.has(id) && !busy.has(id)) out.remove.push(id);
    return out;
  }
