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
  //   R2 a trash keeps them (flushed like a switch, retried in memory, the entry kept until accepted); wbDropPending(store,
  //      space, id) removes a board's entries only when its keys are PURGED;
  //   R3 wbSweepPending(...) removes entries whose board is neither listed nor in the trash (never before the list is read);
  //   R4 replay only into the entry's own board prefix, never into another: the board opened replays its own at its open;
  //      after the list is read replayOthers() replays every other listed or trashed board's, each by its own short-lived
  //      writer, without switching the page. An entry's age counts only after its first replay (lib-c).
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

  // A board's name as it is kept: control and direction characters out (they can hide or reorder the words), spaces folded, cut.
  const wbCleanBoardName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, WB_BOARD_NAME_MAX).trim() : '');
  // The record as it is held, or null when it is not a board. Unknown fields are dropped, the name cleaned (control
  // characters out, spaces folded) and cut, the order a finite number, the trash fields plain.
  function wbCleanBoardRecord(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (typeof v.id !== 'string' || !WB_BOARD_ID_RE.test(v.id)) return null;
    if (typeof v.name !== 'string') return null;
    const name = wbCleanBoardName(v.name);
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

  // ---- the switcher's rules (pure) ----------------------------------------------------------------------------------------
  // Why a name is not allowed ('' when it is): empty after trimming, longer than the limit, or the same as another visible
  // board's (letters of either case alike). `exceptId`: the board being renamed (its own name may stay).
  function wbBoardNameProblem(name, list, exceptId = '') {
    const raw = typeof name === 'string' ? name : '';
    const clean = wbCleanBoardName(raw);
    if (!clean) return 'Give the board a name.';
    if (raw.trim().length > WB_BOARD_NAME_MAX) return `Use ${WB_BOARD_NAME_MAX} characters or fewer.`;
    const low = clean.toLocaleLowerCase();
    if ((Array.isArray(list) ? list : []).some((b) => b && b.id !== exceptId && String(b.name).toLocaleLowerCase() === low)) return 'A board with that name is here already.';
    return '';
  }
  // The name a new board starts with: "Board N" for the first N not used.
  function wbDefaultBoardName(list) {
    const used = new Set((Array.isArray(list) ? list : []).map((b) => String(b.name).toLocaleLowerCase()));
    for (let n = (Array.isArray(list) ? list.length : 0) + 1; n < 1000; n += 1) if (!used.has(`board ${n}`)) return `Board ${n}`;
    return 'New board';
  }
  // The board selector in the title bar (host.header.set, kind 'select'): shown to someone who may edit (even for one board,
  // so they can add a second) and to anyone when there are several boards; a viewer of a single board sees none.
  const wbShowSelect = ({ canEdit, count }) => Boolean(canEdit) || count > 1;
  // The manage entries (the menu's Manage boards… flyout) for this person: none for a viewer; New is off at the limit, Delete when this is the last board.
  function wbBoardsMenu({ canEdit, count, trashed = 0, max = WB_BOARD_MAX, more = 0 }) {
    if (!canEdit) return [];
    return [
      ...(more > 0 ? [{ id: 'more', label: more === 1 ? '1 more board exists' : `${more} more boards exist`, disabled: true }] : []),
      { id: 'new', label: 'New board…', icon: 'plus', ...(count >= max ? { disabled: true, hint: `${max} boards at most` } : {}) },
      { id: 'rename', label: 'Rename board…', icon: 'pen' },
      { id: 'delete', label: 'Delete board…', icon: 'trash', ...(count <= 1 ? { disabled: true, hint: 'The last board stays' } : {}) },
      { id: 'deleted', label: 'Deleted boards…', icon: 'trash-can-arrow-up', ...(trashed ? { hint: String(trashed) } : {}) },
    ];
  }

  // The boards the selector lists. At most WB_BOARD_MAX boards are shown (the first by order); when the active board is beyond
  // them it takes the last place. The rest stay stored. `more` is how many live boards are not shown.
  function wbVisibleBoards(list, activeId) {
    const l = Array.isArray(list) ? list : [];
    if (l.length <= WB_BOARD_MAX) return { shown: l, more: 0 };
    const shown = l.slice(0, WB_BOARD_MAX);
    const cur = l.slice(WB_BOARD_MAX).find((b) => b.id === activeId);
    if (cur) shown[WB_BOARD_MAX - 1] = cur;
    return { shown, more: l.length - WB_BOARD_MAX };
  }
  // The selector: { show, label, rows, more }. `label` is the current board's name (the first board's for an unknown id), `rows`
  // the boards listed in its menu with the current one marked, `more` how many live boards are not listed.
  function wbBoardsSelect(list, activeId, canEdit) {
    const l = Array.isArray(list) ? list : [];
    if (!wbShowSelect({ canEdit, count: l.length })) return { show: false, label: '', rows: [], more: 0 };
    const { shown, more } = wbVisibleBoards(l, activeId);
    const cur = shown.find((b) => b.id === activeId) || shown[0];
    return { show: Boolean(cur), label: cur ? cur.name : '', rows: shown.map((b) => ({ id: b.id, label: b.name, current: cur ? b.id === cur.id : false })), more };
  }

  // ---- the trash, and the purge ------------------------------------------------------------------------------------------
  const WB_TRASH_DAYS = 7;
  const WB_TRASH_MS = WB_TRASH_DAYS * 24 * 3600 * 1000;
  const WB_PURGE = { perTick: 25, everyMs: 15000, lock: '_purge:lock', stale: 120000, skew: 30000 }; // 25 deletes every 15 s: at most 100 a minute
  const wbTrashedAtMs = (r) => { const t = r && typeof r.trashedAt === 'string' ? Date.parse(r.trashedAt) : NaN; return Number.isFinite(t) ? t : NaN; };
  // The deleted boards a person may bring back, newest first, with the whole days left (a board past its 7 days is being purged
  // and is not offered).
  function wbTrashedBoards(records, now) {
    return (Array.isArray(records) ? records : []).map((r) => wbCleanBoardRecord(r)).filter((r) => r && r.deleted)
      .map((r) => { const t = wbTrashedAtMs(r); return { id: r.id, name: r.name, record: r, at: t, left: Number.isFinite(t) ? Math.ceil((t + WB_TRASH_MS - now) / 86400000) : WB_TRASH_DAYS }; })
      .filter((r) => !Number.isFinite(r.at) || r.at + WB_TRASH_MS > now)
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .map(({ id, name, record, left }) => ({ id, name, record, left }));
  }
  const wbDaysLeftWord = (n) => (n <= 1 ? '1 day left' : `${n} days left`);
  // The boards to purge: in the trash for 7 days or more (a record with no valid time is never purged), oldest first.
  function wbPurgePlan(records, now) {
    return (Array.isArray(records) ? records : []).map((r) => wbCleanBoardRecord(r)).filter((r) => r && r.deleted && Number.isFinite(wbTrashedAtMs(r)) && now - wbTrashedAtMs(r) >= WB_TRASH_MS)
      .sort((a, b) => wbTrashedAtMs(a) - wbTrashedAtMs(b) || (a.id < b.id ? -1 : 1)).map((r) => r.id);
  }
  // Every key a purge may delete for one board, and nothing else.
  const wbPurgeOwns = (id, key) => typeof key === 'string' && WB_BOARD_ID_RE.test(id) && (key.startsWith(wbBlockPrefix(id)) || key.startsWith(wbSettingsPrefix(id)) || key === wbPresentKey(id) || key === `${WB_BOARD_LIST_PREFIX}${id}`);
  // The purge: one page at a time (a claim in `_purge:lock`, taken with the version read, stale after 2 minutes), at most
  // `perTick` deletes a tick, a board's blocks first and its record last (so a purge that stops half way is found again). It
  // reads the board's record again before every tick: a board restored meanwhile, or the one shown, is left alone.
  function createBoardPurge({ host, me = '', now = Date.now, perTick = WB_PURGE.perTick, random = Math.random }) {
    const holder = `${String(me).slice(0, 40)}.${Math.floor(random() * 1e9).toString(36)}`;
    let work = null; // { id, keys }
    let running = false;
    const exact = async (key) => { const l = await host.storage.list(key); return (Array.isArray(l) ? l : []).find((e) => e && e.key === key) || null; };
    async function claim() {
      const e = await exact(WB_PURGE.lock);
      const v = e && e.value;
      const t = v && typeof v.at === 'string' ? Date.parse(v.at) : NaN;
      const age = now() - t; // a lock stamped in the future (a forged or skewed clock) beyond a little skew is stale, so it cannot block forever
      if (v && v.holder !== holder && Number.isFinite(t) && age < WB_PURGE.stale && age >= -WB_PURGE.skew) return false;
      try { await host.storage.set(WB_PURGE.lock, { id: 'lock', holder, at: new Date(now()).toISOString() }, { version: e ? e.version : 0 }); return true; } catch { return false; }
    }
    return {
      get holder() { return holder; },
      get working() { return work ? work.id : ''; },
      // status: 'idle' | 'busy' | 'skipped' | 'working' | 'done' | 'error'
      async tick(records, activeId) {
        if (running) return { status: 'busy', deleted: 0 };
        running = true;
        try {
          const due = wbPurgePlan(records, now()).filter((id) => id !== activeId);
          if (work && (work.id === activeId || !due.includes(work.id))) work = null;
          const id = work ? work.id : due[0];
          if (!id) return { status: 'idle', deleted: 0 };
          if (!(await claim())) return { status: 'busy', deleted: 0 };
          const fresh = await exact(`${WB_BOARD_LIST_PREFIX}${id}`);
          const r = fresh ? wbCleanBoardRecord(fresh.value) : null;
          if (!r || !r.deleted || !(now() - wbTrashedAtMs(r) >= WB_TRASH_MS)) { work = null; return { status: 'skipped', deleted: 0 }; }
          if (!work) {
            const keys = [];
            for (const p of [wbBlockPrefix(id), wbSettingsPrefix(id), wbPresentKey(id)]) for (const e of await host.storage.list(p)) if (wbPurgeOwns(id, e.key) && !keys.includes(e.key)) keys.push(e.key);
            work = { id, keys };
          }
          let n = 0;
          try {
            while (n < perTick && work.keys.length) {
              const key = work.keys[0];
              if (!wbPurgeOwns(id, key)) { work.keys.shift(); continue; }
              try { await host.storage.delete(key); } catch (err) { if (!err || err.status !== 404) throw err; }
              work.keys.shift(); n += 1;
            }
            if (!work.keys.length && n < perTick) {
              if (id === WB_BOARD_FIRST) {
                // main is never deleted: its record is written again live and empty, under its old name, so there is one main and
                // the implicit "Board 1" does not come back as a second (an 11th) board. Written only if the record is as read.
                await host.storage.set(`${WB_BOARD_LIST_PREFIX}${id}`, { id: r.id, type: 'board-record', name: r.name, order: r.order, by: r.by, at: r.at, deleted: false, trashedAt: '' }, { version: fresh.version });
              } else await host.storage.delete(`${WB_BOARD_LIST_PREFIX}${id}`).catch((err) => { if (!err || err.status !== 404) throw err; });
              n += 1; work = null; return { status: 'done', id, deleted: n };
            }
          } catch { return { status: 'error', deleted: n }; }
          return { status: 'working', id, deleted: n, left: work.keys.length };
        } finally { running = false; }
      },
    };
  }

  // ---- a save that finishes after a switch (a picture's upload) ---------------------------------------------------------
  // `home` = { board, epoch } taken when the work began. 'here': the board is still shown (the block is drawn and saved as
  // any); 'there': another board is shown now and the first one is still listed, so the block is written under ITS keys and not
  // drawn; 'drop': that board is gone, nothing is written. Never a key of the board shown now.
  function wbLateHome(home, session) {
    if (!home || typeof home.board !== 'string') return 'here';
    if (home.epoch === session.epoch || home.board === session.id) return 'here'; // (switched away and back: the board is shown again)
    return session.visible().some((b) => b.id === home.board) ? 'there' : 'drop';
  }
  // A stroke or a drag still going at the moment of a switch: finished at the last point it reached (the tool's up, so it is
  // saved through the old board's sync, which the switch sends first), else cancelled. `tool` is the tool following the press
  // (the one lent to Select, if any), `point` its last point. Returns 'up', 'cancel' or 'none'.
  function wbEndGesture({ tool, point, ctx }) {
    if (!tool) return 'none';
    if (point && typeof tool.up === 'function') { tool.up(point, ctx); return 'up'; }
    if (typeof tool.cancel === 'function') { tool.cancel(ctx); return 'cancel'; }
    return 'none';
  }
  const wbWriteThere = (host, home, block) => host.storage.set(`${wbBlockPrefix(home.board)}${block.id}`, block);

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
      // R2: a board's kept writes are thrown away, in memory (its syncs, shown or switched away from) and in this browser (the
      // entries). Only when its keys are purged: a trash keeps them (they go on being sent, under the board's own keys).
      dropPending(boardId) {
        for (const s of retired.get(boardId) || []) s.discard();
        retired.delete(boardId);
        if (boardId === id) { if (sync) sync.discard(); if (boardSync) boardSync.discard(); }
        return wbDropPending(store, scope, boardId);
      },
      // R4: after the list is read, replay this person's kept writes of every other listed or trashed board, each into its own
      // prefix by a writer of its own (kept in `retired` while it works, so it retries a 429 and the page still counts it). The
      // board shown replays at its open. Nothing is drawn, nothing of the board shown is touched. Returns the board ids tried.
      replayOthers() {
        if (!listRead) return [];
        const due = new Set(wbPurgePlan([...records.values()], Date.now()));
        const done = [];
        for (const bid of wbKnownBoardIds([...records.values()])) {
          if (bid === id || due.has(bid) || retired.has(bid) || !WB_BOARD_ID_RE.test(bid)) continue;
          const mk = (prefix, cl) => createSync({ host, board: bid, prefix, scope, clean: cl, me, store, clock, onRemote: noop, onReload: noop, onRefused: noop, onBusy: noop, ...extra });
          const a = mk(wbBlockPrefix(bid), clean);
          const b = mk(wbSettingsPrefix(bid), cleanSettings);
          a.replay(); b.replay();
          if (a.pending() || b.pending()) { retired.set(bid, [a, b]); done.push(bid); }
        }
        return done;
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
      // Writes not accepted yet, of the board shown, the list AND the boards switched away from (they go on under their own keys).
      pending() {
        let n = listSync.pending() + (sync ? sync.pending() : 0) + (boardSync ? boardSync.pending() : 0);
        for (const list of retired.values()) for (const s of list) n += s.pending();
        return n;
      },
      // 'beforeunload': the browser's own prompt while anything waits (a closed page right after a switch still warns).
      beforeUnload(e) {
        if (!e || session.pending() <= 0) return false;
        if (typeof e.preventDefault === 'function') e.preventDefault();
        e.returnValue = '';
        return true;
      },
      // A change this page makes to the board list (create, rename, trash, restore): held at once, written through the list
      // sync, and reported as a list change. Returns the cleaned record, or null when it is not one.
      saveRecord(r) {
        const c = wbCleanBoardRecord(r);
        if (!c) return null;
        records.set(c.id, c);
        listSync.save(c);
        h.onList(visible());
        return c;
      },
    };
    return session;
  }
