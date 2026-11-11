  // ---- documents-lib-c-lock.js: the edit lock, the rules (no page, no host) ------------------------------------------------
  //
  // One record (_lock:<id>) written with compare-and-set. The lock is a courtesy; the compare-and-set on the document's own
  // record is the safety. Stale means no change seen on THIS page's clock for 35 s; an old record read at load is given 12 s.
  const DL_LOCK = Object.freeze({ beat: 10000, stale: 35000, wait: 12000 });

  function dlLockSeenAt(now, ageMs) {
    if (Number.isFinite(ageMs) && ageMs <= DL_LOCK.stale) return now - Math.max(0, ageMs);
    return now - DL_LOCK.stale + DL_LOCK.wait;
  }
  const dlLockStale = (seenAt, now) => !Number.isFinite(seenAt) || now - seenAt >= DL_LOCK.stale;

  // Pressing Edit: 'denied' (cannot edit, or no key), 'other-window' (a live lock of this same person that this page does not
  // hold), 'busy' (someone else holds a live lock), 'take' (none or stale: write with the version read, 0 when none).
  function dlLockTakePlan({ canEdit, me, rec, fresh, mine }) {
    if (!canEdit || !me) return 'denied';
    if (!rec || !fresh) return 'take';
    if (rec.holder === me) return mine ? 'take' : 'other-window';
    return 'busy';
  }
  // The write was turned away: 409 means someone holds it; anything else did not happen.
  const dlLockTakeResult = (err) => (err && err.status === 409 ? 'busy' : 'failed');
  // A refresh was turned away: 409 means someone took it (the editor has lost the lock); other refusals are tried at the next beat.
  const dlLockRefreshResult = (err) => (err && err.status === 409 ? 'lost' : 'retry');
  // The record for a take or a refresh: the sequence one on.
  const dlLockNext = (doc, me, name, at, prev) => ({ id: 'lock', type: 'lock', doc, holder: me, name, at, seq: prev ? prev.seq + 1 : 0, by: me });
  // The editor hears the record (or its absence): 'lost' when another person holds it.
  const dlLockHear = ({ rec, fresh, me, editing }) => (editing && rec && fresh && rec.holder !== me ? 'lost' : 'none');
  // Whether the Edit button is on, and why not.
  function dlLockEditState({ canEdit, me, rec, fresh, mine }) {
    const plan = dlLockTakePlan({ canEdit, me, rec, fresh, mine });
    if (plan === 'take') return { enabled: true, reason: '' };
    if (plan === 'busy') return { enabled: false, reason: `${rec.name} is editing this. You can read it as it changes.` };
    if (plan === 'other-window') return { enabled: false, reason: 'You are editing this in another window.' };
    return { enabled: false, reason: '' };
  }
