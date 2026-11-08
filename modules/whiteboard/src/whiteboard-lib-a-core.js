  // ---- whiteboard-lib-a-core.js: the block format, the board's state and the two registries ----------------------------
  //
  // Everything placed on the board is a block. A block is plain data, saved whole under its own key:
  //   { id, type, x, y, z, ...the type's own fields (most have a tint), by, at }
  // x and y are where it sits on the board (board units: one unit is one pixel at 100%), z its place in the stack (higher is
  // on top), by the key of whoever saved it last and at when (ISO). The type's own fields are named by its block type.
  //
  // A block type is one file (whiteboard-lib-e-block-*.js) that ends with blockTypes.register({...}); a tool is one file
  // (whiteboard-lib-f-tool-*.js) that ends with tools.register({...}). Neither holds storage, sync or permission code:
  // storage and live changes are the sync manager's (lib-c), who may do what is the policy's (lib-b).

  // One board per space today. Its id is part of every key, so several named boards is a list of ids and a switch.
  const WB_BOARD = 'main';

  // The colours a person can give a block (its `tint`): the theme's text colour (ink) and the eight fixed tints. Stored as
  // the name, never as a colour, so a block follows the theme and both modes (whiteboard.css maps each name to its token).
  const WB_TINTS = [
    { id: 'ink', label: 'Ink' },
    { id: 'gold', label: 'Yellow' },
    { id: 'orange', label: 'Orange' },
    { id: 'red', label: 'Red' },
    { id: 'pink', label: 'Pink' },
    { id: 'purple', label: 'Purple' },
    { id: 'blue', label: 'Blue' },
    { id: 'teal', label: 'Teal' },
    { id: 'green', label: 'Green' },
  ];
  const WB_TINT_IDS = new Set(WB_TINTS.map((c) => c.id));
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
    tint(v, fallback = 'ink') { return WB_TINT_IDS.has(v) ? v : fallback; },
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

  // A block type: { type, label, create(at) -> its own fields, clean(raw) -> its own fields or null, box(block) -> the
  // box it is drawn in relative to x, y ({ x, y, w, h }, h null for a block whose height follows its words), render(block, el)
  // -> draws it into its element, describe(block) -> words for a screen reader, edit?: 'text' | 'tint', and for 'text'
  // textOf(el) -> the element the words are edited over, resize?: how it changes size when it is the one block picked:
  // { handles: 'corners', min: { w, h }, height?: false } (x, y, w, h; height false: only w, the words set the height) or
  // { handles: 'ends' } (a line: x, y, dx, dy); no resize, no handles }. Hit-testing is the browser's: what render draws with
  // pointer events on (see whiteboard.css, .wb-hit) is what a click finds.
  const blockTypes = wbRegistry('block type', 'type', ['create', 'clean', 'box', 'render', 'describe']);

  // A tool: { id, label, icon, order, key?, edits (it changes the board), cursor?, down(p, ctx), move?(p, ctx), up?(p, ctx),
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
    const z = wb.num(raw.z, 1e9);
    return {
      ...own,
      id,
      type: def.type,
      x,
      y,
      z: z === null ? 0 : z,
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
    };
  }
