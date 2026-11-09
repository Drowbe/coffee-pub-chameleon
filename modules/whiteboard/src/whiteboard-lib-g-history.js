  // ---- whiteboard-lib-g-history.js: undo and redo, for this person's own changes ----------------------------------------
  //
  // What this person changed on this page, newest last, kept in memory only (it goes when the page goes). It never holds a
  // change from anyone else: it hears only what the page's one path for changes (commit -> persist, and a delete) tells
  // it, which is only ever this page's own. It reads and writes nothing itself.
  //
  // A step is one gesture: a drag, a stroke, a resize, a colour picked, a paste, a delete of several blocks. Every change
  // told to it in one turn of the page's script is one step (they are joined until the turn ends), so a drop that saves
  // ten blocks is one step; a run of changes tagged the same within a moment (the arrow keys nudging) is one step too.
  // Each change in a step keeps a block's whole state before and after it ({ id, before, after }; null: no block); what a
  // change put back is worked out from them field by field: a create and a delete are the whole block, any other change
  // only the fields it changed (a move: x and y; a colour: that colour; a move in the stack: z).
  //
  // undo(apply) and redo(apply) hand the step's changes to apply as [{ id, target, source, fields }], the last change first
  // for an undo: put the block as target (null: take it away), where source is what this person left it as; `fields`
  // (null for a create or a delete) are the fields to put back, each only where the block still holds what this person
  // left there (wbMergeBack): a field someone else has changed since keeps their value. Fields a block type names as
  // linked (lib-a: a line's x, y, dx and dy; a box's x, y, w and h) go back together or not at all: when someone else has
  // changed any of them since, the rest stay as they are too, so an undo never makes a shape neither person made (a line
  // whose start this person dragged and someone else then moved does not get its far end back on its own). The page
  // writes the whole merged block as a new change (wbApplyChanges), the same way as any other, so everyone else sees it
  // like any edit; while it does, what it writes is not recorded as a new step. A new step clears what could be redone.
  // The oldest steps go past `cap`.
  const wbSameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // The fields two states of a block differ in, leaving aside who saved it and when.
  function wbFieldsChanged(a, b) {
    const out = [];
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) if (f !== 'by' && f !== 'at' && !wbSameValue(a[f], b[f])) out.push(f);
    return out;
  }
  // The block as undo or redo leaves it, given the block as it is now: each of the change's fields goes to target where
  // now still holds source there and in every field linked with it that the change changed; a field someone else changed
  // since stays theirs, and so do the fields linked with it. `linked`: the block type's lists of linked fields. null: no
  // field to put back (someone else changed them all), so the block is left as it is.
  function wbMergeBack(now, { target, source, fields }, linked = []) {
    const out = { ...now };
    const theirs = (f) => !wbSameValue(now[f], source[f]);
    const withIt = (f) => (linked.find((g) => g.includes(f)) || [f]).filter((g) => fields.includes(g));
    let any = false;
    for (const f of fields) {
      if (withIt(f).some(theirs)) continue; // someone else's since, or a field it goes with is
      if (target[f] === undefined) delete out[f]; else out[f] = JSON.parse(JSON.stringify(target[f]));
      any = true;
    }
    return any ? out : null;
  }
  // Put a step's changes (as undo and redo hand them) on the board. What it needs from the page: get(id) -> the block or
  // null, remove(id), put(block) (saved as a new change), canChange(block), canCreate(), clean(raw) -> a block or null,
  // linkedOf(block) -> its type's linked fields. Answers { left: blocks someone else deleted since (left out), kept:
  // blocks whose every field to put back someone else changed (left as they are), touched: the ids put back }.
  function wbApplyChanges(list, { get, remove, put, canChange, canCreate, clean, linkedOf }) {
    let left = 0;
    let kept = 0;
    const touched = [];
    for (const { id, target, source, fields } of list) {
      const now = get(id);
      if (!target) { if (now) remove(id); continue; }
      if (!now && source) { left += 1; continue; } // someone else deleted it since
      const merged = now && fields ? wbMergeBack(now, { target, source, fields }, linkedOf(now)) : target;
      if (!merged) { kept += 1; continue; } // someone else changed all of it since
      const b = clean(merged);
      if (!b || (now && !canChange(now)) || (!now && !canCreate())) continue;
      put(b);
      touched.push(id);
    }
    return { left, kept, touched };
  }
  // What the person is told after an undo or a redo that could not put everything back ('' : nothing to tell). Both, when
  // both happened.
  function wbUndoNote(r) {
    const parts = [];
    if (r && r.left > 0) parts.push(`Left out ${r.left === 1 ? 'a block' : `${r.left} blocks`} someone else deleted.`);
    if (r && r.kept > 0) parts.push(r.kept === 1 ? 'Left a block as it is: someone else changed it since.' : `Left ${r.kept} blocks as they are: someone else changed them since.`);
    return parts.join(' ');
  }
  function createHistory({ cap = 100, onChange = () => {} } = {}) {
    const undos = [];
    const redos = [];
    let open = null; // the step being gathered in this turn: { changes: Map(id -> change), tag, at }
    let tag = null; // the tag for the step being gathered
    let quiet = 0; // > 0 while a step is being undone or redone
    const MERGE_MS = 1500;
    const copy = (b) => (b ? JSON.parse(JSON.stringify(b)) : null);
    // The same block, leaving aside who saved it and when.
    const same = (a, b) => {
      if (!a || !b) return a === b;
      const { by: _a, at: _b, ...x } = a;
      const { by: _c, at: _d, ...y } = b;
      return JSON.stringify(x) === JSON.stringify(y);
    };

    function close() {
      const step = open;
      open = null;
      const t = tag;
      tag = null;
      if (!step) return;
      for (const [id, c] of step.changes) if (same(c.before, c.after)) step.changes.delete(id);
      if (!step.changes.size) return;
      const last = undos[undos.length - 1];
      if (t && last && last.tag === t && step.at - last.at < MERGE_MS) {
        for (const [id, c] of step.changes) {
          const was = last.changes.get(id);
          if (was) was.after = c.after; else last.changes.set(id, c);
        }
        last.at = step.at;
      } else {
        undos.push({ changes: step.changes, tag: t, at: step.at });
        while (undos.length > cap) undos.shift();
      }
      redos.length = 0;
      onChange();
    }

    function run(from, to, which) {
      close();
      const step = from.pop();
      if (!step) return null;
      const list = [...step.changes.values()].map((c) => {
        const fields = c.before && c.after ? wbFieldsChanged(c.before, c.after) : null;
        return which === 'undo' ? { id: c.id, target: copy(c.before), source: copy(c.after), fields } : { id: c.id, target: copy(c.after), source: copy(c.before), fields };
      });
      if (which === 'undo') list.reverse();
      return { step, list, to };
    }

    return {
      // This page changed one block: before and after (null: there was none, or there is none now).
      record(id, before, after) {
        if (quiet) return;
        if (!open) { open = { changes: new Map(), at: Date.now() }; queueMicrotask(close); }
        const was = open.changes.get(id);
        if (was) was.after = copy(after); else open.changes.set(id, { id, before: copy(before), after: copy(after) });
      },
      // Join the step being gathered with the last one when they carry the same tag and follow within a moment.
      tag(t) {
        if (quiet) return;
        if (!open) { open = { changes: new Map(), at: Date.now() }; queueMicrotask(close); }
        tag = t;
      },
      // End the step being gathered now, rather than when the turn ends.
      close,
      undo(apply) { return this.replay(run(undos, redos, 'undo'), apply); },
      redo(apply) { return this.replay(run(redos, undos, 'redo'), apply); },
      replay(r, apply) {
        if (!r) return null;
        quiet += 1;
        let out;
        try { out = apply(r.list); } finally { quiet -= 1; }
        r.to.push(r.step);
        onChange();
        return out === undefined ? true : out;
      },
      canUndo: () => undos.length > 0 || Boolean(open),
      canRedo: () => redos.length > 0,
      clear() { undos.length = 0; redos.length = 0; open = null; tag = null; onChange(); },
      get size() { return undos.length; },
    };
  }
