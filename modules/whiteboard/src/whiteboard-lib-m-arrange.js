  // ---- whiteboard-lib-m-arrange.js: align, distribute, guides, locks and groups ----------------------------------------
  //
  // Plain work on blocks and boxes, no page: what lines the picked blocks up (align, distribute), where a dragged box
  // snaps to the blocks near it (guides), and which blocks a lock, a group, an ungroup or a delete changes. The page
  // (whiteboard.js) hands it the blocks and each one's box as drawn, and puts what it answers through its one path for
  // changes, every block changed by one command in one undo step.
  //
  // A box here is { id, x0, y0, x1, y1 } in board units: the block type's box (lib-a), its height measured where the words
  // set it. A connector (an attached block) has no box of its own and is never lined up: it follows its blocks. A locked
  // block is never moved: align and distribute leave it out (it neither moves nor counts in the box they line up to).

  // The commands, in the order the menus show them, with the words a person reads.
  const WB_ARRANGE = [
    { id: 'left', label: 'Align left', icon: 'align-left' },
    { id: 'center', label: 'Align centre', icon: 'align-center' },
    { id: 'right', label: 'Align right', icon: 'align-right' },
    { id: 'top', label: 'Align top', icon: 'arrows-up-to-line' },
    { id: 'middle', label: 'Align middle', icon: 'arrow-down-up-across-line' },
    { id: 'bottom', label: 'Align bottom', icon: 'arrows-down-to-line' },
    { id: 'horizontal', label: 'Distribute horizontally', icon: 'grip-lines-vertical', distribute: true },
    { id: 'vertical', label: 'Distribute vertically', icon: 'grip-lines', distribute: true },
  ];
  const WB_ARRANGE_BY_ID = new Map(WB_ARRANGE.map((a) => [a.id, a]));
  // (wbTenth, a number to one decimal, is lib-e-block-table's.)

  // A block's box on the board, or null for a block with none of its own (a connector). measure(block) -> the height as
  // drawn, for a block whose height follows its words (box h null).
  function wbRect(b, measure = () => 0) {
    const def = blockTypes.get(b.type);
    if (!def || def.attached) return null;
    const box = def.box(b);
    const h = box.h === null ? Number(measure(b)) || 0 : box.h;
    const x0 = (b.x || 0) + box.x;
    const y0 = (b.y || 0) + box.y;
    return { id: b.id, x0, y0, x1: x0 + box.w, y1: y0 + h };
  }

  // How far each box moves to line up: [{ id, dx, dy }], only those that move. how: an align id (left, center, right,
  // top, middle, bottom): to the edge or the middle of the box round them all (two or more boxes).
  function wbAlignMoves(rects, how) {
    if (rects.length < 2) return [];
    const x0 = Math.min(...rects.map((r) => r.x0));
    const x1 = Math.max(...rects.map((r) => r.x1));
    const y0 = Math.min(...rects.map((r) => r.y0));
    const y1 = Math.max(...rects.map((r) => r.y1));
    const out = [];
    for (const r of rects) {
      let dx = 0;
      let dy = 0;
      if (how === 'left') dx = x0 - r.x0;
      else if (how === 'center') dx = (x0 + x1) / 2 - (r.x0 + r.x1) / 2;
      else if (how === 'right') dx = x1 - r.x1;
      else if (how === 'top') dy = y0 - r.y0;
      else if (how === 'middle') dy = (y0 + y1) / 2 - (r.y0 + r.y1) / 2;
      else if (how === 'bottom') dy = y1 - r.y1;
      dx = wbTenth(dx);
      dy = wbTenth(dy);
      if (dx || dy) out.push({ id: r.id, dx, dy });
    }
    return out;
  }

  // Equal gaps between three or more boxes, across (horizontal) or down (vertical): taken in the order of their middles,
  // the first and the last stay where they are and the others are spaced evenly between them.
  function wbDistributeMoves(rects, axis) {
    if (rects.length < 3) return [];
    const [lo, hi] = axis === 'vertical' ? ['y0', 'y1'] : ['x0', 'x1'];
    const list = rects.slice().sort((a, b) => (a[lo] + a[hi]) - (b[lo] + b[hi]) || (a.id < b.id ? -1 : 1));
    const first = list[0];
    const last = list[list.length - 1];
    const sizes = list.reduce((n, r) => n + (r[hi] - r[lo]), 0);
    const gap = (last[hi] - first[lo] - sizes) / (list.length - 1);
    const out = [];
    let at = first[lo];
    for (const r of list) {
      const d = wbTenth(at - r[lo]);
      at += r[hi] - r[lo] + gap;
      if (d) out.push(axis === 'vertical' ? { id: r.id, dx: 0, dy: d } : { id: r.id, dx: d, dy: 0 });
    }
    return out;
  }

  // What a command (WB_ARRANGE id) changes on these blocks: { changes: [{ id, fields }], locked: how many were left
  // out because they are locked, enough: whether there were enough blocks to do it }. Connectors are left out (they follow
  // their blocks); the fields are each block type's move (lib-a, wbMoved).
  function wbArrangeChanges(blocks, how, { measure = () => 0 } = {}) {
    const def = WB_ARRANGE_BY_ID.get(how);
    const placed = blocks.filter((b) => { const d = blockTypes.get(b.type); return d && !d.attached; });
    const free = placed.filter((b) => b.locked !== true);
    const locked = placed.length - free.length;
    const rects = free.map((b) => wbRect(b, measure));
    const need = def && def.distribute ? 3 : 2;
    if (!def || rects.length < need) return { changes: [], locked, enough: false };
    const moves = def.distribute ? wbDistributeMoves(rects, how) : wbAlignMoves(rects, how);
    const byId = new Map(free.map((b) => [b.id, b]));
    return { changes: moves.map((m) => ({ id: m.id, fields: wbMoved(byId.get(m.id), m.dx, m.dy) })), locked, enough: true };
  }

  // Guides: a box being dragged (moving, where it would be now) lines up with the boxes near it. Each axis on its own: of
  // its left edge, middle and right edge (top, middle, bottom), the one nearest an edge or the middle of another box,
  // within tol board units, goes onto it (the nearest wins; of two as near, the first found: the candidates' order, then
  // left, middle, right). Answers { dx, dy } to add to the drag and the lines to draw, [{ axis: 'x' (a line down, at x)
  // | 'y' (across, at y), at, from, to }]: one for each place the box lines up with another after the snap, running past
  // both boxes. No candidates, or none near: { dx: 0, dy: 0, lines: [] }.
  function wbGuideSnap(moving, candidates, tol) {
    const EPS = 0.01;
    const lines = (box, lo, hi) => [box[lo], (box[lo] + box[hi]) / 2, box[hi]];
    function nearest(lo, hi) {
      let best = null;
      for (const c of candidates) {
        for (const t of lines(c, lo, hi)) {
          for (const m of lines(moving, lo, hi)) {
            const d = t - m;
            if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best) - 1e-9)) best = d;
          }
        }
      }
      return best;
    }
    const sx = nearest('x0', 'x1');
    const sy = nearest('y0', 'y1');
    const dx = sx === null ? 0 : sx;
    const dy = sy === null ? 0 : sy;
    const moved = { x0: moving.x0 + dx, x1: moving.x1 + dx, y0: moving.y0 + dy, y1: moving.y1 + dy };
    const out = [];
    const add = (axis, at, from, to) => {
      const was = out.find((l) => l.axis === axis && Math.abs(l.at - at) < EPS);
      if (was) { was.from = Math.min(was.from, from); was.to = Math.max(was.to, to); } else out.push({ axis, at, from, to });
    };
    for (const c of candidates) {
      if (sx !== null) {
        for (const t of lines(c, 'x0', 'x1')) if (lines(moved, 'x0', 'x1').some((m) => Math.abs(m - t) < EPS)) add('x', t, Math.min(c.y0, moved.y0), Math.max(c.y1, moved.y1));
      }
      if (sy !== null) {
        for (const t of lines(c, 'y0', 'y1')) if (lines(moved, 'y0', 'y1').some((m) => Math.abs(m - t) < EPS)) add('y', t, Math.min(c.x0, moved.x0), Math.max(c.x1, moved.x1));
      }
    }
    return { dx, dy, lines: out };
  }

  // The blocks with every block of the groups of these ids (the ids given first, in their order).
  function wbExpandGroups(ids, blocks) {
    const groups = wbGroupsOf(blocks);
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const out = [];
    const seen = new Set();
    const put = (id) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };
    for (const id of ids) {
      put(id);
      const g = wbGroupOf(byId.get(id));
      if (g && groups.has(g)) for (const other of groups.get(g)) put(other);
    }
    return out;
  }

  // Group: the picked blocks, with every block of any group one of them is in, become one new group (newGroup() -> its
  // id). Locked blocks are left as they are. { changes, locked } (no changes: fewer than two blocks to group, or they are
  // one group already).
  function wbGroupChanges(ids, blocks, { newGroup = () => wbGroupId() } = {}) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const all = wbExpandGroups(ids, blocks).map((id) => byId.get(id)).filter(Boolean);
    const free = all.filter((b) => b.locked !== true);
    const locked = all.length - free.length;
    const one = new Set(free.map((b) => wbGroupOf(b)));
    const whole = one.size === 1 && !one.has(null) && (wbGroupsOf(blocks).get([...one][0]) || []).every((id) => free.some((b) => b.id === id));
    if (free.length < 2 || whole) return { changes: [], locked };
    const g = newGroup();
    return { changes: free.map((b) => ({ id: b.id, fields: { group: g } })), locked };
  }
  // Ungroup: every block of the groups the picked blocks are in leaves its group (locked ones stay in it).
  function wbUngroupChanges(ids, blocks) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const groups = new Set(ids.map((id) => wbGroupOf(byId.get(id))).filter(Boolean));
    const all = blocks.filter((b) => groups.has(wbGroupOf(b)));
    const free = all.filter((b) => b.locked !== true);
    return { changes: free.map((b) => ({ id: b.id, fields: { group: undefined } })), locked: all.length - free.length };
  }

  // Lock or unlock: when any of them is unlocked, lock them all; else unlock them all. { on: true to lock, changes }.
  function wbLockChanges(ids, blocks) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const list = ids.map((id) => byId.get(id)).filter(Boolean);
    const on = list.some((b) => b.locked !== true);
    return { on, changes: list.filter((b) => (b.locked === true) !== on).map((b) => ({ id: b.id, fields: { locked: on ? true : undefined } })) };
  }

  // What a delete of these ids takes away: every one that may be deleted (canDelete), and every connector attached to one
  // of those (refsOf(block) -> the ids it is attached to), locked or not: a connector never stays pointing at nothing.
  // { ids, locked: how many were left because they are locked }.
  function wbDeleteSet(ids, blocks, { canDelete = (b) => b.locked !== true, refsOf = () => [] } = {}) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const out = new Set();
    let locked = 0;
    for (const id of ids) {
      const b = byId.get(id);
      if (!b || out.has(id)) continue;
      if (!canDelete(b)) { if (b.locked === true) locked += 1; continue; }
      out.add(id);
    }
    for (const c of blocks) if (!out.has(c.id) && refsOf(c).some((r) => out.has(r))) out.add(c.id);
    return { ids: [...out], locked };
  }

  // What the person is told when locked blocks were left as they were: n of them, of `of` the command was for.
  function wbLockedNote(n, of = n) {
    if (!n) return '';
    if (n === of) return n === 1 ? 'This block is locked.' : 'These blocks are locked.';
    return n === 1 ? 'Left a locked block as it is.' : `Left ${n} locked blocks as they are.`;
  }
