  // ---- whiteboard-lib-q-present.js: presenting to everyone, the rules (no page, no host) ---------------------------------
  //
  // One person presents and the others follow. The state is ONE record in the module's storage, a bookkeeping key (leading
  // "_", so it is not an object of the board, and not under the blocks' or the settings' prefix: neither sync hears it):
  //   _present:<board>:state = { id:'state', type:'present', presenter, name, frame, move, dim, seq, at, by }
  // `presenter` is the presenter's user key (host.user.key; a guest has none and can only follow). Storage is the truth: a
  // late joiner reads it, everyone else hears its changes; nothing here depends on host.live.
  //
  // Who is presenting is settled by compare-and-set (set with the version read): the first write wins, the loser follows.
  // The presenter rewrites the record every 10 s (a heartbeat); a record nobody has seen change for 35 s is stale and
  // counts as nobody presenting. "Seen" is the time on THIS page's clock that the change arrived, never a comparison of a
  // stored time with a clock of another computer; only the first read of an old record uses the server's stamp (its age).
  //
  // The functions here are plain, tested on their own (test/check-whiteboard-present.mjs); whiteboard.js draws and listens.
  // The record's key is one for each board: wbPresentKey(<board id>) in lib-s, `_present:<id>:state`.
  const WB_PRESENT = Object.freeze({
    beat: 10000, // the presenter rewrites the record this often (ms)
    stale: 35000, // a record nobody has seen change for this long is nobody's
    wait: 12000, // an old record read at load: how long to wait for it to change before it counts as stale
    coalesce: 150, // rapid Next and Back, a slider: one write, this long after the last
    nameMax: 40,
  });

  // The record as it is held, or null when it is not one. Unknown fields are dropped, the name cut, the ids plain, the move
  // one of the three (else Pan), the dim 0 to 100 in steps of 5 (else the usual).
  function wbCleanPresent(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (v.id !== 'state' || v.type !== 'present') return null;
    const key = (s) => (typeof s === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(s) ? s : null);
    const presenter = key(v.presenter);
    const frame = key(v.frame);
    if (!presenter || !frame) return null;
    const name = typeof v.name === 'string' ? v.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, WB_PRESENT.nameMax) : '';
    const seq = Number.isInteger(v.seq) && v.seq >= 0 && v.seq <= 1e9 ? v.seq : 0;
    const at = typeof v.at === 'string' && v.at.length <= 40 && Number.isFinite(Date.parse(v.at)) ? v.at : '';
    return {
      id: 'state',
      type: 'present',
      presenter,
      name: name || 'Someone',
      frame,
      move: wbMoveValue(v.move),
      dim: wbDimValue(v.dim),
      seq,
      at,
      by: key(v.by) || presenter,
    };
  }

  // Seen-time of a record read at load: its age by the server's stamp when that is known and within the limit (then it was
  // seen that long ago), else it is given one heartbeat period (WB_PRESENT.wait) to change before it is stale.
  function wbPresentSeenAt(now, ageMs) {
    if (Number.isFinite(ageMs) && ageMs <= WB_PRESENT.stale) return now - Math.max(0, ageMs);
    return now - WB_PRESENT.stale + WB_PRESENT.wait;
  }
  // Stale: no change seen for the limit. (No record seen: stale.)
  const wbPresentStale = (seenAt, now) => !Number.isFinite(seenAt) || now - seenAt >= WB_PRESENT.stale;

  // What to do on asking to present to everyone: 'denied' (cannot edit, or no key), 'follow' (someone is presenting and is
  // alive), or 'start' (nobody, or a stale record: write with the version read).
  function wbPresentStartPlan({ canEdit, me, rec, fresh }) {
    if (!canEdit || !me) return 'denied';
    return rec && fresh ? 'follow' : 'start';
  }
  // The write for it was turned away: a 409 means someone wrote first, so follow; anything else did not start.
  const wbPresentStartResult = (err) => (err && err.status === 409 ? 'follow' : 'failed');
  // Whether Take over is offered and allowed: an editor, while someone else's live record is there.
  const wbPresentCanTakeOver = ({ canEdit, me, rec, fresh }) => Boolean(canEdit && me && rec && fresh && rec.presenter !== me);
  // A live message is a hint only if it is from the presenter the stored record names. (Not used to start, stop or take over.)
  const wbPresentAcceptLive = (rec, from) => Boolean(rec && from && typeof from.key === 'string' && from.key && from.key === rec.presenter);

  // What a page does when the record (or its absence) is heard. `mode`: this page's presenting, 'none' | 'personal' | 'follow';
  // `sending`: this page is the presenter; `left`: the person left this presentation; `offered`: the offer was made already.
  //   'follow' start following, 'update' follow the new state, 'end' leave the following, 'offer' tell a personal presenter,
  //   'none' nothing.
  function wbPresentHear({ rec, fresh, me, mode, sending, left, offered }) {
    if (!rec || !fresh) return mode === 'follow' ? 'end' : 'none';
    if (sending && rec.presenter === me) return 'none';
    if (mode === 'follow') return 'update';
    if (left) return 'none';
    if (mode === 'personal') return offered ? 'none' : 'offer';
    return 'follow';
  }

  // The record for a presenter's next write: the fields that changed, the sequence one on only when something did.
  function wbPresentNext(rec, fields, at, by) {
    const next = { ...rec, at, by };
    let changed = false;
    for (const k of ['frame', 'move', 'dim']) {
      if (fields && fields[k] !== undefined && fields[k] !== rec[k]) { next[k] = fields[k]; changed = true; }
    }
    if (changed) next.seq = rec.seq + 1;
    return next;
  }

  // The presenter's writer: changes are coalesced (one write WB_PRESENT.coalesce ms after the last), and a heartbeat is
  // written every WB_PRESENT.beat ms after the last write. Every write carries the version this writer last wrote, one at
  // a time. A 409 ends it (onLost with what is stored now, `err.current`); other refusals (too many saves: 429) are tried
  // again at the next beat. put(value, version) -> Promise<{ version }>; later/cancel are the timers; stamp() the time.
  function createWbPresentSender({ put, later, cancel, stamp, by, onLost, onError = () => {} }) {
    let rec = null;
    let version = 0;
    let want = null;
    let soon = 0;
    let beat = 0;
    let busy = false;
    const arm = () => { cancel(beat); beat = later(() => send(), WB_PRESENT.beat); };
    async function send() {
      if (!rec) return;
      cancel(soon);
      soon = 0;
      if (busy) { soon = later(() => send(), WB_PRESENT.coalesce); return; }
      busy = true;
      const fields = want;
      want = null;
      const next = wbPresentNext(rec, fields, stamp(), by);
      try {
        const r = await put(next, version);
        if (!rec) return; // stopped meanwhile
        rec = next;
        version = r && Number.isFinite(r.version) ? r.version : version + 1;
        arm();
      } catch (err) {
        if (!rec) return;
        if (err && err.status === 409) {
          const current = err.current && typeof err.current === 'object' ? err.current : null;
          const theirs = wbCleanPresent(current && current.value);
          if (theirs && theirs.presenter === by && Number.isFinite(current.version)) { // this person's other page wrote: carry on from it
            version = current.version;
            rec = theirs;
            want = { ...(want || {}), ...(fields || {}) };
            soon = later(() => send(), WB_PRESENT.coalesce);
          } else { sender.stop(); onLost(theirs, current); }
        } else {
          if (fields) want = { ...fields, ...(want || {}) };
          onError(err);
          if (!err || err.status === 403) { sender.stop(); onLost(null, null); } else arm();
        }
      } finally {
        busy = false;
      }
    }
    const sender = {
      // Begin from the record just written (its version as the server answered).
      start(first, v) { rec = first; version = v; want = null; arm(); },
      change(fields) { if (!rec) return; want = { ...(want || {}), ...fields }; cancel(soon); soon = later(() => send(), WB_PRESENT.coalesce); },
      stop() { rec = null; want = null; cancel(soon); cancel(beat); soon = 0; beat = 0; },
      get active() { return Boolean(rec); },
      get version() { return version; },
      get record() { return rec; },
    };
    return sender;
  }
