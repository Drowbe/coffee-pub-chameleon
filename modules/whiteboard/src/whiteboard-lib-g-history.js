  // ---- whiteboard-lib-g-history.js: undo and redo, for this person's own changes ----------------------------------------
  //
  // What this person changed on this page, newest last, kept in memory only (it goes when the page goes). It never holds a
  // change from anyone else: it hears only what the page's one path for changes (commit -> persist, and a delete) tells
  // it, which is only ever this page's own. It reads and writes nothing itself.
  //
  // A step is one gesture: a drag, a stroke, a resize, a colour picked, a paste, a delete of several blocks. Every change
  // told to it in one turn of the page's script is one step (they are joined until the turn ends), so a drop that saves
  // ten blocks is one step; a run of changes tagged the same within a moment (the arrow keys nudging) is one step too.
  // Each change in a step is a block's whole state before and after it ({ id, before, after }; null: no block), so a
  // create, a change, a move in the stack (z) and a delete are all the same thing.
  //
  // undo(apply) and redo(apply) hand the step's changes to apply as [{ id, target, source }]: put the block as target
  // (null: take it away), where source is what this person left it as. The page writes them as new changes, the same way
  // as any other, so everyone else sees them like any edit; while it does, what it writes is not recorded as a new step.
  // A new step clears what could be redone. The oldest steps go past `cap`.
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
      const list = [...step.changes.values()].map((c) => (which === 'undo' ? { id: c.id, target: copy(c.before), source: copy(c.after) } : { id: c.id, target: copy(c.after), source: copy(c.before) }));
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
