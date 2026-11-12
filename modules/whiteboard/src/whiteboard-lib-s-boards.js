  // ---- whiteboard-lib-s-boards.js: several boards in one space -------------------------------------------------------------
  //
  // A board is a record `board:<id>` = { id, type: 'board-record', name, order, by, at, deleted, trashedAt } in the module's
  // space storage; its blocks are block:<id>:<block id>, its settings _board:<id>:settings, its presentation _present:<id>:state.
  // Today's one board keeps the id `main` and its keys. A space with no `board:main` record reads as one board named
  // "Board 1" (an implicit first board; opening a space writes nothing). `deleted` / `trashedAt` mark a board in the trash (the
  // blocks stay where they are). No page, no host: the pure rules are here, and createBoardSession, which owns the syncs of
  // the board being shown and switches them, is run in the checks with a fake host.
  //
  // The kept writes (lib-c, localStorage `wb-pending:<space>:<prefix>`) belong to a board by their prefix:
  //   R1 a switch flushes the old board's syncs first (what waits is sent under the old board's keys, and kept until accepted);
  //   R2 wbDropPending(store, space, id) removes a deleted board's entries;
  //   R3 wbSweepPending(...) removes entries whose board is neither listed nor in the trash (never before the list is read);
  //   R4 replay (lib-c) reads the entry of its own prefix only, so only the board being opened is replayed.
  const WB_BOARD_FIRST = 'main'; // the reserved first board's id; never given to a new board
  const WB_BOARD_MAX = 10; // boards in a space (the page's rule; the server does not check it)
  const WB_BOARD_NAME_MAX = 40;
  const WB_BOARD_ID_RE = /^[a-z0-9]{1,16}$/;
  const WB_BOARD_LIST_PREFIX = 'board:';
  const WB_BOARD_LAST = (space) => `wb-board:${space}`; // this browser's last board (localStorage)

  // The keys of one board, so no other file builds one by hand.
  const wbBlockPrefix = (id) => `block:${id}:`;
  const wbSettingsPrefix = (id) => `_board:${id}:`;
  const wbPresentKey = (id) => `_present:${id}:state`;

  // The record as it is held, or null when it is not a board. Unknown fields are dropped, the name cleaned (control
  // characters out, spaces folded) and cut, the order a finite number, the trash fields plain.
  function wbCleanBoardRecord(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (typeof v.id !== 'string' || !WB_BOARD_ID_RE.test(v.id)) return null;
    if (typeof v.name !== 'string') return null;
    const name = v.name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, WB_BOARD_NAME_MAX).trim();
    if (!name) return null;
    if (typeof v.order !== 'number' || !Number.isFinite(v.order)) return null;
    const trashedAt = typeof v.trashedAt === 'string' ? v.trashedAt.slice(0, 40) : '';
    return {
      id: v.id,
      type: 'board-record',
      name,
      order: Math.max(-1e9, Math.min(1e9, v.order)),
      by: typeof v.by === 'string' ? v.by.slice(0, 64) : '',
      at: typeof v.at === 'string' ? v.at.slice(0, 40) : '',
      deleted: v.deleted === true || Boolean(trashedAt),
      trashedAt,
    };
  }
  const wbBoardTrashed = (r) => Boolean(r && r.deleted);
  // The boards a person sees, in order (order, then when made, then id), trashed ones out. With no record for `main`, an
  // implicit first board is the first entry ("Board 1"). More than WB_BOARD_MAX stand (two people can pass the limit at once).
  function wbBoardList(records) {
    const recs = (Array.isArray(records) ? records : []).map((r) => wbCleanBoardRecord(r)).filter(Boolean);
    const out = recs.filter((r) => !wbBoardTrashed(r));
    if (!recs.some((r) => r.id === WB_BOARD_FIRST)) out.push({ id: WB_BOARD_FIRST, type: 'board-record', name: 'Board 1', order: 0, by: '', at: '', deleted: false, trashedAt: '', implicit: true });
    const seen = new Set();
    return out
      .sort((a, b) => a.order - b.order || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
  }
  // Every board id this space knows: listed, in the trash, and the implicit main. A kept write for any other board is stale.
  function wbKnownBoardIds(records) {
    const ids = new Set((Array.isArray(records) ? records : []).map((r) => wbCleanBoardRecord(r)).filter(Boolean).map((r) => r.id));
    ids.add(WB_BOARD_FIRST); // the implicit board, or its record (listed or trashed)
    return ids;
  }
  // A new board's id: 8 random lowercase letters and digits (`random` returns [0, 1)), never `main`, never in `taken`.
  function wbNewBoardId(random = Math.random, taken = []) {
    const used = new Set(taken);
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let tries = 0; tries < 100; tries += 1) {
      let id = '';
      for (let i = 0; i < 8; i += 1) id += chars[Math.min(chars.length - 1, Math.max(0, Math.floor(Number(random()) * chars.length) || 0))];
      if (id !== WB_BOARD_FIRST && !used.has(id)) return id;
    }
    return `b${Date.now().toString(36)}`.slice(0, 16);
  }
  // The order for a board made now: after the last.
  function wbNextOrder(list) {
    let top = -1;
    for (const r of Array.isArray(list) ? list : []) if (r && Number.isFinite(r.order)) top = Math.max(top, r.order);
    return top + 1;
  }
  const wbCanCreateBoard = (list) => (Array.isArray(list) ? list.length : 0) < WB_BOARD_MAX;
  // The board to open: the one used last in this browser if it is listed (not in the trash), else the first.
  function wbLanding(list, last) {
    const l = Array.isArray(list) ? list : [];
    if (typeof last === 'string' && l.some((r) => r.id === last)) return last;
    return l.length ? l[0].id : WB_BOARD_FIRST;
  }

  // ---- the kept writes of a board (localStorage, see lib-c) ---------------------------------------------------------
  // Entries are `wb-pending:<space>:block:<id>:` (blocks) and `wb-pending:<space>:_board:<id>:` (settings). The board of an
  // entry is read from its key; an entry of another shape (the board list's own) belongs to no board.
  function wbPendingBoardOf(storeKey, space) {
    const head = `wb-pending:${space}:`;
    if (typeof storeKey !== 'string' || !storeKey.startsWith(head)) return null;
    const m = /^(?:block|_board):([a-z0-9]+):$/.exec(storeKey.slice(head.length));
    return m ? m[1] : null;
  }
  function wbPendingKeys(store, space) {
    const out = [];
    if (!store || typeof store.key !== 'function') return out;
    try { for (let i = 0; i < store.length; i += 1) { const k = store.key(i); if (wbPendingBoardOf(k, space) !== null) out.push(k); } } catch { /* none */ }
    return out;
  }
  // R2: remove the entries of one board (a deleted board's). Returns how many.
  function wbDropPending(store, space, id) {
    let n = 0;
    for (const k of wbPendingKeys(store, space)) if (wbPendingBoardOf(k, space) === id) { try { store.removeItem(k); n += 1; } catch { /* none */ } }
    return n;
  }
  // R3: remove the entries of boards that are neither in the list nor in the trash. `ids`: wbKnownBoardIds(records).
  function wbSweepPending(store, space, ids) {
    let n = 0;
    for (const k of wbPendingKeys(store, space)) if (!ids.has(wbPendingBoardOf(k, space))) { try { store.removeItem(k); n += 1; } catch { /* none */ } }
    return n;
  }

  // One thing for each board, made when first asked for and kept while the page is open (the history of each board).
  function wbPerBoard(make) {
    const m = new Map();
    return { get(id) { if (!m.has(id)) m.set(id, make(id)); return m.get(id); }, has: (id) => m.has(id), drop: (id) => m.delete(id), size: () => m.size };
  }

  // The syncs of the board being shown (blocks, settings) and of the board list, and the switch from one board to another.
  //   handlers: { onRemote, onReload, onSettings, onSettingsReload, onList (the visible boards, after any change to the
  //   list), onRefused, onBusy, onSyncs (called with the new syncs: the page keeps its own `sync` and `boardSync` names) }
  // use(id) closes the old board's syncs (their waiting writes are sent first: R1; what is on its way, or parked by a 429,
  // goes on under the old keys), makes new ones for `id`, and bumps `epoch`; everything the old syncs report afterwards is
  // dropped (each report is wrapped with the epoch it was made in), and a late 'change' is judged by prefix. The caller
  // clears the screen, then load()s and replay()s. A late answer of the page's own reads is dropped by `current(epoch)`.
  function createBoardSession({ host, scope = '', me = '', store = wbPendingStore(), clean, cleanSettings, handlers = {}, clock = createServerClock(), parkMs }) {
    const noop = () => {};
    const h = { onRemote: noop, onReload: noop, onSettings: noop, onSettingsReload: noop, onList: noop, onRefused: noop, onBusy: noop, onSyncs: noop, ...handlers };
    let epoch = 0;
    let id = WB_BOARD_FIRST;
    let sync = null;
    let boardSync = null;
    let listRead = false;
    const retired = new Map(); // board id -> its syncs closed by a switch (a write may still be on its way)
    const records = new Map(); // id -> the cleaned record
    const extra = parkMs === undefined ? {} : { parkMs };
    const guard = (mine, fn) => (...args) => { if (mine === epoch) return fn(...args); return undefined; };
    const visible = () => wbBoardList([...records.values()]);
    const listSync = createSync({
      host, board: 'list', prefix: WB_BOARD_LIST_PREFIX, scope, clean: wbCleanBoardRecord, me, store, clock, ...extra,
      onRemote: (c) => { if (c.op === 'put') records.set(c.block.id, c.block); else records.delete(c.id); h.onList(visible()); },
      onReload: () => { loadList().catch(noop); },
      onRefused: (...a) => h.onRefused(...a),
      onBusy: (...a) => h.onBusy(...a),
    });
    function build(boardId) {
      const mine = epoch;
      sync = createSync({ host, board: boardId, scope, clean, me, store, clock, ...extra, onRemote: guard(mine, h.onRemote), onReload: guard(mine, h.onReload), onRefused: guard(mine, (...a) => h.onRefused(...a)), onBusy: guard(mine, (...a) => h.onBusy(...a)) });
      boardSync = createSync({ host, board: boardId, prefix: wbSettingsPrefix(boardId), scope, clean: cleanSettings, me, store, clock, ...extra, onRemote: guard(mine, h.onSettings), onReload: guard(mine, h.onSettingsReload), onRefused: guard(mine, (...a) => h.onRefused(...a)), onBusy: guard(mine, (...a) => h.onBusy(...a)) });
      h.onSyncs(sync, boardSync);
    }
    // The board list, read from storage; kept current by listSync after that. The sweep (R3) runs only now that it is known.
    async function loadList() {
      const got = await listSync.load();
      records.clear();
      for (const r of got) records.set(r.id, r);
      listRead = true;
      sweep();
      h.onList(visible());
      return visible();
    }
    function sweep() { return listRead ? wbSweepPending(store, scope, wbKnownBoardIds([...records.values()])) : 0; }
    const session = {
      get id() { return id; },
      get epoch() { return epoch; },
      get sync() { return sync; },
      get boardSync() { return boardSync; },
      get listSync() { return listSync; },
      get listRead() { return listRead; },
      visible,
      records: () => [...records.values()],
      current: (e) => e === epoch,
      loadList,
      sweep,
      // R2: a deleted board's writes not accepted yet are thrown away, in memory (its syncs, shown or switched away from) and
      // in this browser (the kept entries). Nothing is sent for it afterwards.
      dropPending(boardId) {
        for (const s of retired.get(boardId) || []) s.discard();
        retired.delete(boardId);
        if (boardId === id) { if (sync) sync.discard(); if (boardSync) boardSync.discard(); }
        return wbDropPending(store, scope, boardId);
      },
      // Start on a board (the first one, or the landing).
      start(boardId = WB_BOARD_FIRST) { if (!WB_BOARD_ID_RE.test(boardId)) throw new Error('not a board id'); id = boardId; build(id); return epoch; },
      // Switch to another board. false when it is the one shown (or not an id).
      use(boardId) {
        if (typeof boardId !== 'string' || !WB_BOARD_ID_RE.test(boardId) || boardId === id) return false;
        sync.close(); // R1: sends what waits first
        boardSync.close();
        retired.set(id, [...(retired.get(id) || []), sync, boardSync]);
        epoch += 1;
        id = boardId;
        build(id);
        return true;
      },
      // A 'change' event: the board list, and the board shown (each by its own prefix; a late one of another board is not heard).
      handle(e) { listSync.handle(e); if (sync) sync.handle(e); if (boardSync) boardSync.handle(e); },
      handleMany(e) { listSync.handleMany(e); if (sync) sync.handleMany(e); if (boardSync) boardSync.handleMany(e); },
      flush() { listSync.flush(); if (sync) sync.flush(); if (boardSync) boardSync.flush(); },
      pending: () => listSync.pending() + (sync ? sync.pending() : 0) + (boardSync ? boardSync.pending() : 0),
    };
    return session;
  }
