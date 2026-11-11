  // ---- documents-lib-j-resync.js: catching up after a dropped connection, the rules (no page, no host) ----------------------------
  //
  // After the live stream comes back (or the browser is online again, or the page shows after a long while hidden) the page reads
  // its data again. What it then does depends on the state: the list is redrawn; a text being read is redrawn only when the
  // stored rev is higher than the one shown; a text being edited is NEVER replaced (only the lock is looked at again).
  // A read that failed changes nothing.
  //   state: 'list' | 'reading' | 'editing'; shownRev: the rev on the screen (reading); rec: the cleaned small record read now, or
  //   null when it is gone; ok: whether every read worked.
  // -> { apply, redrawList, redrawReading, closeReading, checkLock, touchText }. touchText is always false.
  function dlResyncPlan({ state, shownRev, rec, ok }) {
    const none = { apply: false, redrawList: false, redrawReading: false, closeReading: false, checkLock: false, touchText: false };
    if (!ok) return none;
    if (state === 'editing') return { ...none, apply: true, checkLock: true };
    if (state === 'reading') {
      if (!rec) return { ...none, apply: true, closeReading: true };
      return { ...none, apply: true, redrawReading: Number.isFinite(rec.rev) && rec.rev > (Number(shownRev) || 0) };
    }
    return { ...none, apply: true, redrawList: true };
  }
  // Hidden for how long before it counts as a gap (the Whiteboard's 30 s).
  const DL_RESYNC_HIDDEN_MS = 30000;
  const dlResyncAfterHidden = (hiddenAt, now) => Boolean(hiddenAt) && now - hiddenAt > DL_RESYNC_HIDDEN_MS;
