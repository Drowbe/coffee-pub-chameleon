  // ---- whiteboard-lib-a-core.js: the block format, the board's state and the two registries ----------------------------
  //
  // Everything placed on the board is a block. A block is plain data, saved whole under its own key:
  //   { id, type, x, y, z, ...its colours (fill, stroke, ink) and weight, ...the type's own fields, by, at }
  // x and y are where it sits on the board (board units: one unit is one pixel at 100%), z its place in the stack (higher is
  // on top; any number, see wbBetween), by the key of whoever saved it last and at when (ISO). The type's own fields are
  // named by its block type.
  //
  // A block's colours are three roles, each set on its own: fill (its background), stroke (its border, or the line itself
  // for a line or a drawing) and ink (its words). Which roles a type has, and the extra choices each takes ('none': not
  // drawn; 'auto': a little darker than the fill, a note's border), are its block type's `paint`. weight is the width of
  // its line or border in board units, for a type with `weight: true`. wbClean (below) fills in any of these a stored
  // block lacks from the type's create(), so an older block still draws.
  //
  // A block type is one file (whiteboard-lib-e-block-*.js) that ends with blockTypes.register({...}); a tool is one file
  // (whiteboard-lib-f-tool-*.js) that ends with tools.register({...}). Neither holds storage, sync or permission code:
  // storage and live changes are the sync manager's (lib-c), who may do what is the policy's (lib-b).

  // One board per space today. Its id is part of every key, so several named boards is a list of ids and a switch.
  const WB_BOARD = 'main';

  // The colours a person can give a role: the theme's text colour (ink) and the eight fixed tints. Stored as the name,
  // never as a colour, so a block follows the theme and both modes (the renderer hands the token to whiteboard.css).
  const WB_PALETTE = [
    { id: 'ink', label: 'Ink', token: 'var(--text-primary)' },
    { id: 'gold', label: 'Yellow', token: 'var(--tint-gold)' },
    { id: 'orange', label: 'Orange', token: 'var(--tint-orange)' },
    { id: 'red', label: 'Red', token: 'var(--tint-red)' },
    { id: 'pink', label: 'Pink', token: 'var(--tint-pink)' },
    { id: 'purple', label: 'Purple', token: 'var(--tint-purple)' },
    { id: 'blue', label: 'Blue', token: 'var(--tint-blue)' },
    { id: 'teal', label: 'Teal', token: 'var(--tint-teal)' },
    { id: 'green', label: 'Green', token: 'var(--tint-green)' },
  ];
  const WB_PALETTE_BY_ID = new Map(WB_PALETTE.map((c) => [c.id, c]));
  // The colour roles, in the order a menu offers them, with the words a person reads. A type may name a role its own way
  // (a line's stroke is its "Line").
  const WB_ROLES = [
    { id: 'stroke', label: 'Border' },
    { id: 'fill', label: 'Background' },
    { id: 'ink', label: 'Words' },
  ];
  // The widths a line or a border can have, in board units.
  const WB_WEIGHTS = [1, 2, 3, 4, 8, 12];
  // The words a menu shows for them.
  const WB_WEIGHT_NAMES = { 1: 'Hairline', 2: 'Thin', 3: 'Medium', 4: 'Thick', 8: 'Heavy', 12: 'Extra heavy' };
  const wbWeightName = (w) => WB_WEIGHT_NAMES[w] || `${w}`;
  const WB_LIMITS = { coord: 1000000, size: 4000, text: 4000, numbers: 6000 };
  // Small checks every block type uses to clean what it reads.
  const wb = {
    // A finite number in [-max, max] rounded to one decimal, or null.
    num(v, max = WB_LIMITS.coord) {
      const n = typeof v === 'number' ? v : NaN;
      if (!Number.isFinite(n) || Math.abs(n) > max) return null;
      return Math.round(n * 10) / 10;
    },
    // A size in [min, WB_LIMITS.size], or the fallback.
    size(v, min, fallback) {
      const n = wb.num(v, WB_LIMITS.size);
      return n === null ? fallback : Math.max(min, n);
    },
    text(v) { return typeof v === 'string' ? v.slice(0, WB_LIMITS.text) : ''; },
    // A role's colour: a palette name, or one of the role's extra choices ('none', 'auto'), or the fallback.
    paint(v, extra, fallback) { return WB_PALETTE_BY_ID.has(v) || (extra && extra.includes(v)) ? v : fallback; },
    // One of the widths, or the fallback.
    weight(v, fallback) { return WB_WEIGHTS.includes(v) ? v : fallback; },
    id(v) { return typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : null; },
    svg(tag, attrs = {}) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, val] of Object.entries(attrs)) el.setAttribute(k, String(val));
      return el;
    },
  };

  // A registry: definitions by a key, each checked for what it must have when it is registered.
  function wbRegistry(kind, key, needs) {
    const defs = new Map();
    return {
      register(def) {
        if (!def || typeof def[key] !== 'string') throw new Error(`a ${kind} needs a ${key}`);
        for (const n of needs) if (def[n] === undefined) throw new Error(`the ${kind} "${def[key]}" needs ${n}`);
        if (defs.has(def[key])) throw new Error(`the ${kind} "${def[key]}" is registered twice`);
        defs.set(def[key], def);
        return def;
      },
      get: (k) => defs.get(k) || null,
      list: () => [...defs.values()].sort((a, b) => (a.order || 500) - (b.order || 500)),
    };
  }

  // A block type: { type, label, create(at) -> its own fields with its usual colours and weight, clean(raw) -> its own
  // fields or null (not the colours or the weight: wbClean does those), box(block) -> the box it is drawn in relative to
  // x, y ({ x, y, w, h }, h null for a block whose height follows its words), render(block, el) -> draws it into its
  // element, describe(block) -> words for a screen reader, noun?(block) -> what a person calls it ("arrow"; else the
  // label in lower case), paint?: { role: { label?, extra?: ['none', 'auto'] } } (the
  // colour roles it has, see the top of this file), weight?: true (it has a line or border width), edit?: 'text' |
  // 'colour' (what opening it does), and for 'text' textOf(el) -> the element the words are edited over, resize?: how it
  // changes size when it is the one block picked:
  // { handles: 'corners', min: { w, h }, height?: false } (x, y, w, h; height false: only w, the words set the height) or
  // { handles: 'ends' } (a line: x, y, dx, dy); no resize, no handles }, and, for a block that points at other blocks (a
  // connector, later), refs?(block) -> the ids it points at and remap?(block, idMap) -> the fields to change when it is
  // copied along with them (lib-h; idMap: old id -> the copy's id). A block's delete takes away only the block: what it
  // points at or uses (another block, an upload) stays, so an undo can bring it back whole. Hit-testing is the browser's: what render draws with
  // pointer events on (see whiteboard.css, .wb-hit) is what a click finds.
  const blockTypes = wbRegistry('block type', 'type', ['create', 'clean', 'box', 'render', 'describe']);

  // A tool: { id, label, icon, order, key?, edits (it changes the board), makes? (the block type it puts on the board, for
  // the colour and width menus' "new blocks"), cursor?, down(p, ctx), move?(p, ctx), up?(p, ctx),
  // cancel?(ctx), activate?(ctx), deactivate?(ctx) }. p is the pointer on the board: { x, y } in board units, { sx, sy }
  // on the screen, id (the block under it, or null), handle (the selected block's handle under it, or null), pointerType
  // and event.
  const tools = wbRegistry('tool', 'id', ['label', 'icon', 'down']);

  // A block read from anywhere (storage, a change from someone else) made safe to draw, or null when it is not a block.
  function wbClean(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const def = blockTypes.get(raw.type);
    const id = wb.id(raw.id);
    const x = wb.num(raw.x);
    const y = wb.num(raw.y);
    if (!def || !id || x === null || y === null) return null;
    const own = def.clean(raw);
    if (!own) return null;
    const usual = def.create();
    for (const [role, spec] of Object.entries(def.paint || {})) own[role] = wb.paint(raw[role], spec.extra, usual[role]);
    if (def.weight) own.weight = wb.weight(raw.weight, usual.weight);
    // z is kept as it is (not rounded), so a block put between two neighbours keeps its place; see wbBetween.
    const z = typeof raw.z === 'number' && Number.isFinite(raw.z) && Math.abs(raw.z) <= 1e9 ? raw.z : 0;
    return {
      ...own,
      id,
      type: def.type,
      x,
      y,
      z,
      by: typeof raw.by === 'string' ? raw.by.slice(0, 64) : '',
      at: typeof raw.at === 'string' ? raw.at.slice(0, 40) : '',
    };
  }

  // The board's state: the blocks by id. It draws nothing and saves nothing.
  function createBoard() {
    const blocks = new Map();
    return {
      get: (id) => blocks.get(id) || null,
      has: (id) => blocks.has(id),
      put(block) { blocks.set(block.id, block); },
      remove(id) { return blocks.delete(id); },
      clear() { blocks.clear(); },
      all: () => [...blocks.values()].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1)),
      get size() { return blocks.size; },
      topZ() { let z = 0; for (const b of blocks.values()) z = Math.max(z, b.z); return z; },
      bottomZ() { let z = 0; for (const b of blocks.values()) z = Math.min(z, b.z); return z; },
    };
  }

  // The z for a block moved one layer, or to an end, so the move is one write: a number between its new neighbours.
  // `order` is every block bottom to top (board.all()), `id` the block moved, `to` 'front' | 'forward' | 'backward' |
  // 'back', `overlaps(a, b)` whether two blocks cover each other. Forward and backward step past the next block that
  // overlaps it (a step past one it does not touch would change nothing to see). Returns { z } or { z, renumber: true }
  // when the gap is too small to split (the caller then numbers every block 1, 2, 3 ... in order first), or null when
  // there is nothing to move past.
  function wbBetween(order, id, to, overlaps) {
    const i = order.findIndex((b) => b.id === id);
    if (i < 0) return null;
    const me = order[i];
    const top = order[order.length - 1];
    const bottom = order[0];
    if (to === 'front') return top.id === id ? null : { z: Math.floor(top.z) + 1 };
    if (to === 'back') return bottom.id === id ? null : { z: Math.ceil(bottom.z) - 1 };
    const up = to === 'forward';
    let j = i;
    do j += up ? 1 : -1; while (j >= 0 && j < order.length && !overlaps(me, order[j]));
    if (j < 0 || j >= order.length) return null;
    const past = order[j];
    const beyond = order[j + (up ? 1 : -1)];
    const beyondZ = beyond ? beyond.z : past.z + (up ? 1 : -1);
    const z = (past.z + beyondZ) / 2;
    if (Math.abs(beyondZ - past.z) < 1e-6 || z === past.z || z === beyondZ) return { z, renumber: true };
    return { z };
  }
