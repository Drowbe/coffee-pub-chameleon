  // ---- documents-lib-g-save.js: planning a save, the commit's outcome, autosave timing (no page, no host) ------------------
  //
  // The page does the writes; this decides what to write and when. A save is: write the changed chunks, then the small record
  // with rev + 1 under the version read (the commit). 409 on that means someone else committed first.
  const DL_SAVE = Object.freeze({ gap: 3000, perMinute: 200, window: 60000 }); // 200 of the 240 saves a minute; the rest is for the lock

  // -> { ok:false, reason:'title'|'long' } or { ok:true, chunks:[{ id, text, write }], writes:[...those with write], dropped:[ids], record }.
  // `old` = [{ id, text }] in order (what the small record lists); `rec` the cleaned small record read with the lock.
  function dlPlanSave({ old, text, title, paper, rec, me, name, now, fresh, lex }) {
    const t = dlCleanLine(title, DL.titleMax);
    if (!t) return { ok: false, reason: 'title' };
    const clean = dlCleanText(text);
    const split = dlSplit(clean);
    if (!split.ok) return { ok: false, reason: 'long' };
    const chunks = dlPlanChunks(old, split.chunks, fresh);
    const ids = chunks.map((c) => c.id);
    const record = {
      ...rec, title: t, rev: rec.rev + 1, paper: dlCleanPaper(paper === undefined ? rec.paper : paper), chunks: ids, size: clean.length, excerpt: dlExcerpt(clean, lex), preview: dlPreview(clean),
      editedBy: me, editedByName: dlCleanLine(name, DL.nameMax) || 'Someone', editedAt: now,
    };
    return { ok: true, chunks, writes: chunks.filter((c) => c.write), dropped: dlDroppedChunks(old.map((o) => o.id), ids), record };
  }
  // Whether anything differs from what was last saved.
  const dlIsDirty = (saved, now) => saved.text !== now.text || saved.title !== now.title || saved.paper !== now.paper;

  // The commit was turned away or not: 409 means someone else committed first (stop editing, keep the text); anything else did
  // not happen and is tried again.
  const dlCommitResult = (err) => (!err ? 'saved' : err.status === 409 ? 'conflict' : 'failed');

  // Milliseconds until the next save may run (null: nothing to save). 3 s after the last key, and never less than 3 s after the
  // last save. `force` (Done, the page hidden) skips the wait for a key, never the gap between saves.
  function dlAutosaveDelay({ now, lastKey, lastSave, dirty, force }) {
    if (!dirty) return null;
    const key = force || !Number.isFinite(lastKey) ? 0 : Math.max(0, lastKey + DL_SAVE.gap - now);
    const gap = Number.isFinite(lastSave) ? Math.max(0, lastSave + DL_SAVE.gap - now) : 0;
    return Math.max(key, gap);
  }
  // Writes made in the last minute (`log` = times) keep a save under the cap: 0 when `cost` more writes fit now, else the
  // milliseconds until enough old ones fall out of the minute.
  function dlWriteWait(log, now, cost) {
    const live = log.filter((t) => now - t < DL_SAVE.window).sort((a, b) => a - b);
    const over = live.length + cost - DL_SAVE.perMinute;
    if (over <= 0) return 0;
    return Math.max(0, live[Math.min(live.length - 1, over - 1)] + DL_SAVE.window - now);
  }
  // The word in the status line.
  const dlSaveWord = ({ dirty, saving, failed }) => (saving ? 'Saving' : failed ? 'Not saved' : dirty ? 'Not saved yet' : 'Saved');
