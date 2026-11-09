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
  // The board's dot grid, in board units: the dots the renderer draws sit on its multiples, and Snap to grid puts blocks
  // on them (wbSnap).
  const WB_GRID = 24;
  const wbSnap = (v) => Math.round(v / WB_GRID) * WB_GRID;
  const WB_LIMITS = { coord: 1000000, size: 4000, text: 4000, numbers: 6000 };
  // The words of a note, a text block and a shape (a block type with `markup: true`) are stored as written, in the small
  // markup chat uses (**bold**, *italic*, `code`, - and 1. lists, # headings, [words](https://...) links) and drawn
  // through the host's markdown (lib-d, wbShowWords). They have a size and an alignment of their own: a closed list of
  // the theme's type tokens, and three ways to line the words up. A block that has neither reads as its type's usual.
  const WB_SIZES = [
    { id: 'small', label: 'Small', token: 'var(--text-14)' },
    { id: 'medium', label: 'Medium', token: 'var(--text-16)' },
    { id: 'large', label: 'Large', token: 'var(--text-22)' },
    { id: 'huge', label: 'Huge', token: 'var(--text-28)' },
  ];
  const WB_SIZE_BY_ID = new Map(WB_SIZES.map((x) => [x.id, x]));
  const WB_ALIGNS = [
    { id: 'left', label: 'Left', icon: 'align-left' },
    { id: 'center', label: 'Centre', icon: 'align-center' },
    { id: 'right', label: 'Right', icon: 'align-right' },
  ];
  const WB_ALIGN_BY_ID = new Map(WB_ALIGNS.map((x) => [x.id, x]));
  // What the page hands the board for markup: html(text) -> the host's markdown (escaped first), plain(text, { line })
  // -> the host's plain text of it. Until the page sets them, words are shown and read as they are.
  const wbMarkup = { html: null, plain: null };
  // A block's words as plain text, on one line: what a screen reader is told, never the markup.
  const wbPlain = (text) => {
    const t = typeof text === 'string' ? text : '';
    const out = wbMarkup.plain ? wbMarkup.plain(t, { line: true }) : t;
    return String(out).replace(/\s+/g, ' ').trim();
  };
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
    // One of a closed list's ids (a Map by id), or the fallback.
    choice(v, byId, fallback) { return typeof v === 'string' && byId.has(v) ? v : fallback; },
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
  // 'colour' (what opening it does), markup?: true (its `text` is markup, drawn with wbShowWords, edited with the
  // formatting bar, and it has a size and an align: its create() gives their usual, wbClean cleans them), and for 'text' textOf(el) -> the element the words are edited over, textField? (the
  // field edited, 'text' unless named: a picture's 'alt'), textLine? (one line: Enter keeps it), textLabel? (the field's
  // name for a screen reader), textMax? (most characters), editLabel? (the menu's word for it, else "Edit"), resize?: how it
  // changes size when it is the one block picked:
  // { handles: 'corners', min: { w, h }, height?: false, keep?: true } (x, y, w, h; height false: only w, the words set the
  // height; keep: a corner always keeps the block's shape, as Shift does for the others) or
  // { handles: 'ends', attach?: true } (a line: x, y, dx, dy; attach: a connector, whose ends are re-attached); no resize,
  // no handles }, linked?: [[field, ...], ...] (fields that only make sense together, such as a box's x, y, w and h: an
  // undo puts them back together or leaves them all, see lib-g), anchorIn?(block) -> how far in from its box a
  // connector's end goes on a side ({ left, right, top, bottom }, for a side whose middle is not on the outline),
  // move?(block, dx, dy) -> the fields to change when it is moved by dx, dy (else x and y; see wbMoved), and
  // copied?(block) -> the fields a copy of it changes (a timer's copy is not started; lib-h).
  // A block that draws outside its box (a note's pointer) has reach?(block) -> the box of all it draws, relative to x, y
  // ({ x, y, w, h }): the group frame, "Show everything", the rectangle that picks blocks, layers and a paste's middle use
  // it; the box stays what is resized and what a connector attaches to. grips?(block) -> more handles for the one block
  // picked, beside its resize handles ([{ id, x, y }], each a point relative to the box's top left corner), and
  // grip(block, id, at) -> the fields to change while one of them is dragged to `at` (a point on the board); saved once,
  // on the drop. actions?(block) -> entries of its own for the right-click menu ([{ id, label, icon, fields }]): a choice
  // sets those fields, one save. exported?(block, el, ctx) -> changes the copy of its element (el) that is saved as a
  // picture or printed (lib-l), and may answer a promise: a picture puts its upload in as a data URL, a timer leaves out
  // its controls, a table its active cell. ctx: { live (printing: the copy stays in the page), scale (pixels per board
  // unit), picture(upload, thumb) -> a promise of a data URL, or null }. Without it the copy is drawn as it is shown.
  // A block made of cells (a table, lib-e-block-table.js) has edit: 'cells' (the page edits one cell at a time, see
  // whiteboard.js "cells"), role (its element's role: 'group', round a table of its own, rather than 'button'), and more of
  // the hooks above: grips(block, el) (its element, to measure what is drawn; a grip may have kind 'col' | 'row' (a grab
  // bar len units long) | 'add' (a +), and ox, oy to push it out from the box), gripBase?(block, id, el) -> what a grip's
  // drag starts from (handed to grip as a 4th argument), tap?(block, id) -> the fields a press on a grip without a drag
  // changes (one save), actions(block, cell) (the cell pressed, { r, c }; an entry may be { refuse: words } in its fields
  // for a short note instead of a save, and current, ariaLabel, disabled), and in resize: minOf?(block) -> its least
  // { w, h }, measure?(block, el) -> what a corner's drag starts from beside the block ({ h, ... } as drawn), and
  // scale?(start, box) -> the fields a corner's drag changes for the new box (else the box itself).
  //
  // A block that points at other blocks (a connector) has refs(block) -> the ids it points at, remap(block, idMap) -> the
  // fields to change when it is copied along with them (lib-h; idMap: old id -> the copy's id) and loosen(block, keep,
  // pointOf) -> the fields to change when it is copied without some of them (an end on a block not in `keep`, a Set of ids,
  // becomes a free point where it is drawn now, pointOf(end) -> { x, y }). Such a block is `attached`: it has no x, y of its
  // own and is drawn from the boxes of the blocks it points at, never stored: layout(block, boxOf) -> what to draw
  // ({ points, box, ... } in board units) or null while a block it points at is not on the board (then it is not drawn at
  // all), where boxOf(id) -> that block's box on the board ({ x, y, w, h, in? }) or null; render(block, el, layout) and
  // describe(block, find) (find(id) -> another block, for its words). A block's delete takes away only the block and the
  // connectors attached to it (the page does that, in the same undo step): what it uses (an upload) stays, so an undo can
  // bring it back whole. Hit-testing is the browser's: what render draws with pointer events on (see whiteboard.css,
  // .wb-hit) is what a click finds.
  //
  // Later, not built: a note's pointer that locks onto another block, so its tip follows it. The stored shape stays
  // pointer: { dx, dy } (the tip's offset from the note's middle, lib-e-block-note.js) and gains an optional
  // target: { block, side }, resolved when it is drawn as a connector's end is (boxOf(target.block), wbSidePoint): the tip
  // goes to that side's middle while the block is on the board, and falls back to dx, dy while it is not. The note then has
  // refs, remap and loosen like a connector (loosen writes the drawn tip back into dx, dy), and is redrawn with the block
  // it points at (the renderer's deps); it stays a placed block with its own x, y, so it is not `attached`.
  // Later too: a highlight (lib-e-block-highlight.js) that locks onto what it highlights, so it moves with that block. It
  // gains an optional target: { block, dx, dy }, its x, y's offset from that block's top left corner; when it is drawn,
  // x, y become boxOf(target.block) + dx, dy (as a connector's ends are resolved), and it keeps its own x, y as they were
  // last drawn for while the block is not on the board. refs, remap and loosen as for the pointer above; a move of the
  // highlight alone changes dx, dy (its type's move).
  const blockTypes = wbRegistry('block type', 'type', ['create', 'clean', 'box', 'render', 'describe']);
  // A block a connector can be attached to: one with a box of its own (four corners to resize), not a line, a drawing or
  // another connector.
  const wbAttachable = (def) => Boolean(def && !def.attached && def.resize && def.resize.handles === 'corners');
  // The fields that change when a block is moved by dx, dy: its type's move, else x and y.
  function wbMoved(b, dx, dy) {
    const def = blockTypes.get(b.type);
    return def && def.move ? def.move(b, dx, dy) : { x: b.x + dx, y: b.y + dy };
  }

  // A tool: { id, label, icon, order, key?, apart? (its own on/off button beside the tool switch), group? (one of the
  // choices in a toolbar button's menu, by the group's id: 'flowchart'), edits (it changes the board), makes? (the block
  // type it puts on the board, for the colour and width menus' "new blocks"), usual? (fields its new blocks get unless the
  // person picked otherwise: a marker's brush and width), paints? (the colour role it gives a block it is clicked on: the
  // Fill tool's 'fill'; the Colour menu then sets that colour), cursor?, down(p, ctx), move?(p, ctx),
  // up?(p, ctx), hover?(p, ctx) (a mouse or a pen over the board with nothing pressed; p null when it leaves),
  // cancel?(ctx), activate?(ctx), deactivate?(ctx) }. p is the pointer on the board: { x, y } in board units, { sx, sy }
  // on the screen, id (the block under it, or null), handle (the selected block's handle under it, or null), pointerType
  // and event.
  const tools = wbRegistry('tool', 'id', ['label', 'icon', 'down']);

  // A block read from anywhere (storage, a change from someone else) made safe to draw, or null when it is not a block.
  function wbClean(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const def = blockTypes.get(raw.type);
    const id = wb.id(raw.id);
    // An attached block (a connector) has no place of its own: it is drawn from the blocks it points at.
    const placed = !(def && def.attached);
    const x = placed ? wb.num(raw.x) : 0;
    const y = placed ? wb.num(raw.y) : 0;
    if (!def || !id || x === null || y === null) return null;
    const own = def.clean(raw);
    if (!own) return null;
    const usual = def.create();
    for (const [role, spec] of Object.entries(def.paint || {})) own[role] = wb.paint(raw[role], spec.extra, usual[role]);
    if (def.weight) own.weight = wb.weight(raw.weight, usual.weight);
    if (def.markup) {
      own.size = wb.choice(raw.size, WB_SIZE_BY_ID, usual.size);
      own.align = wb.choice(raw.align, WB_ALIGN_BY_ID, usual.align);
    }
    // z is kept as it is (not rounded), so a block put between two neighbours keeps its place; see wbBetween.
    const z = typeof raw.z === 'number' && Number.isFinite(raw.z) && Math.abs(raw.z) <= 1e9 ? raw.z : 0;
    return {
      ...own,
      id,
      type: def.type,
      ...(placed ? { x, y } : {}),
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
