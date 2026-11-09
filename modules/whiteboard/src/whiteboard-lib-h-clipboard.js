  // ---- whiteboard-lib-h-clipboard.js: copy, cut, paste and duplicate ---------------------------------------------------
  //
  // The clipboard is this page's own memory: whole copies of the blocks as they were when copied, never the browser's
  // clipboard (a module page may not use it). It goes when the page goes. It saves nothing and asks nobody's leave: the
  // page decides who may copy and paste (lib-b) and puts the copies on the board through its one path for changes.
  //
  // A copy gets a new id, and a block that points at other blocks (a connector's two ends, later) has those pointers moved
  // to the new copies: its block type says which ids it points at, refs(block) -> [ids], and puts new ones in,
  // remap(block, idMap) -> the fields that change, where idMap is a Map of every copied block's old id to its copy's id. A
  // pointer to a block that was not copied is not in idMap; the block type decides what that end becomes.
  const WB_PASTE_STEP = 24; // board units each paste moves along, so copies never hide one another

  // Copies of `blocks` (plain blocks, any order) with new ids from newId(), moved by dx, dy, pointers among them remapped,
  // stacked in the order the originals were. z, by and at are the caller's to set.
  function wbCopies(blocks, { newId, dx = 0, dy = 0 }) {
    const list = blocks.slice().sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    const idMap = new Map(list.map((b) => [b.id, newId()]));
    return list.map((b) => {
      const copy = { ...JSON.parse(JSON.stringify(b)), id: idMap.get(b.id), x: b.x + dx, y: b.y + dy };
      const def = blockTypes.get(b.type);
      if (def && def.remap && (!def.refs || def.refs(b).length)) Object.assign(copy, def.remap(copy, idMap));
      return copy;
    });
  }

  function createClipboard() {
    let held = null; // { blocks, pastes }: what was copied, and how many times it has been pasted
    return {
      has: () => Boolean(held && held.blocks.length),
      // Keep whole copies of these blocks. After a cut the first paste lands where they were; after a copy, a step along.
      copy(blocks, { cut = false } = {}) {
        held = blocks.length ? { blocks: blocks.map((b) => JSON.parse(JSON.stringify(b))), pastes: cut ? 0 : 1 } : null;
      },
      // Fresh copies to put on the board: each paste a step further along, or, given `at` (a point on the board), with
      // the middle of what was copied there. bounds(blocks) -> { x0, y0, x1, y1 } is the page's (it knows each box).
      take({ newId, at = null, bounds = null }) {
        if (!held) return [];
        let dx = WB_PASTE_STEP * held.pastes;
        let dy = dx;
        if (at && bounds) {
          const r = bounds(held.blocks);
          dx = at.x - (r.x0 + r.x1) / 2;
          dy = at.y - (r.y0 + r.y1) / 2;
        } else held.pastes += 1;
        return wbCopies(held.blocks, { newId, dx, dy });
      },
    };
  }
