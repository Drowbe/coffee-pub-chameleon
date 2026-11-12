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

  // Several boards in a space (lib-s): the board's id is part of every key (wbBlockPrefix, wbSettingsPrefix, wbPresentKey);
  // the first board, and today's one, is `main` (WB_BOARD_FIRST).

  // The colours a person can give a role: the theme's text colour (id 'ink', read as Charcoal) and the eight tints. Stored as the name,
  // never as a colour, so a block follows the theme and both modes (the renderer hands the token to whiteboard.css).
  const WB_PALETTE = [
    { id: 'ink', label: 'Charcoal', token: 'var(--text-primary)' },
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
  // The board's own settings: one value for the whole board, shared by everyone who sees it, saved whole under one key
  // next to the blocks: _board:<board>:settings, { id: 'settings', type: 'board', background, by, at }. The key starts
  // with "_" (the module's bookkeeping, not an object): a Clear takes it and its Undo puts it back without counting it,
  // and a board with only a background has nothing to clear. background is 'default' (the theme's own board colour), a
  // palette id (WB_PALETTE: a wash of that tint, following the theme) or a fixed id (WB_FIXED_BACKGROUNDS: the same colour
  // in light and dark mode); a key that is missing, or holds anything else, reads as 'default' (wbCleanBoard). The page
  // keeps it in the undo history under WB_BOARD_STEP, an id no block can have (lib-a's wb.id refuses ':').
  // Fixed backgrounds: `family` says whether the colour is light or dark, which chooses the board's usual ink and dots
  // (whiteboard.css, [data-ground]); `css` is the custom property in whiteboard.css that holds the colour (read by name).
  const WB_FIXED_BACKGROUNDS = [
    { id: 'light-white', label: 'Pure White', family: 'light', css: '--wb-fixed-light-white' },
    { id: 'light-creme', label: 'Creme', family: 'light', css: '--wb-fixed-light-creme' },
    { id: 'light-grey', label: 'Light Grey', family: 'light', css: '--wb-fixed-light-grey' },
    { id: 'light-blue', label: 'Light Blue', family: 'light', css: '--wb-fixed-light-blue' },
    { id: 'light-green', label: 'Light Green', family: 'light', css: '--wb-fixed-light-green' },
    { id: 'light-yellow', label: 'Light Yellow', family: 'light', css: '--wb-fixed-light-yellow' },
    { id: 'light-pink', label: 'Light Pink', family: 'light', css: '--wb-fixed-light-pink' },
    { id: 'dark-black', label: 'Black', family: 'dark', css: '--wb-fixed-dark-black' },
    { id: 'dark-slate', label: 'Slate', family: 'dark', css: '--wb-fixed-dark-slate' },
    { id: 'dark-grey', label: 'Dark Grey', family: 'dark', css: '--wb-fixed-dark-grey' },
    { id: 'dark-blue', label: 'Dark Blue', family: 'dark', css: '--wb-fixed-dark-blue' },
    { id: 'dark-green', label: 'Dark Green', family: 'dark', css: '--wb-fixed-dark-green' },
    { id: 'dark-wine', label: 'Wine', family: 'dark', css: '--wb-fixed-dark-wine' },
    { id: 'dark-purple', label: 'Dark Purple', family: 'dark', css: '--wb-fixed-dark-purple' },
  ];
  const WB_FIXED_BY_ID = new Map(WB_FIXED_BACKGROUNDS.map((c) => [c.id, c]));
  // A block's colour menus (fill, border, words, line) offer the same groups as the background menu: the role's own rows
  // (`specials`, opaque entries the page builds: Default, None...), Light colours and Dark colours (fixed: the same in both
  // modes), Tinted colours (follow the theme), then the disabled Custom row. Returns the entries in order:
  // { kind: 'special', row }, { kind: 'heading', label }, { kind: 'fixed', id, label }, { kind: 'tint', id, label }, { kind: 'custom', label }.
  function wbColourMenuModel(specials) {
    const out = (specials || []).map((row) => ({ kind: 'special', row }));
    for (const family of ['light', 'dark']) {
      out.push({ kind: 'heading', label: family === 'light' ? 'Light colours' : 'Dark colours' });
      for (const f of WB_FIXED_BACKGROUNDS) if (f.family === family) out.push({ kind: 'fixed', id: f.id, label: f.label });
    }
    out.push({ kind: 'heading', label: 'Tinted colours' });
    for (const c of WB_PALETTE) out.push({ kind: 'tint', id: c.id, label: c.label });
    out.push({ kind: 'custom', label: 'Custom colour (coming with the colour picker)' });
    return out;
  }
  // The settings' key is wbSettingsPrefix(<board>) + WB_BOARD_ID (lib-s).
  const WB_BOARD_ID = 'settings';
  const WB_BOARD_STEP = ':board';
  function wbCleanBoard(raw) {
    if (!raw || typeof raw !== 'object' || raw.id !== WB_BOARD_ID) return null;
    return {
      id: WB_BOARD_ID,
      type: 'board',
      background: WB_PALETTE_BY_ID.has(raw.background) || WB_FIXED_BY_ID.has(raw.background) ? raw.background : 'default',
      by: typeof raw.by === 'string' ? raw.by.slice(0, 64) : '',
      at: typeof raw.at === 'string' ? raw.at.slice(0, 40) : '',
    };
  }
  const WB_BOARD_USUAL = Object.freeze(wbCleanBoard({ id: WB_BOARD_ID }));
  // How the board is drawn on a background: `ground` its colour, `dot` its grid's dots, `family` 'light', 'dark' or
  // 'themed' (the board's data-ground), the colours as CSS (theme tokens, or the fixed custom property). A tinted
  // colour is a wash of its tint on the page's colour, never the tint itself: a block in that colour, or in Charcoal,
  // stays readable on it. The dots are the words' colour, stronger on a wash than on the plain page, strongest on
  // Charcoal. A fixed colour ignores the theme: its dots are the fixed ink of its family. An unknown id is 'default'.
  const WB_WASH = 18; // per cent of the tint in a background
  const WB_DOT = { default: 16, tint: 26, ink: 34, fixed: 24 }; // per cent of the words' colour in a dot
  function wbBackdrop(id) {
    const dot = (n, tok = 'var(--text-primary)') => `color-mix(in srgb, ${tok} ${n}%, transparent)`;
    const f = WB_FIXED_BY_ID.get(id);
    if (f) return { id: f.id, family: f.family, ground: `var(${f.css})`, dot: dot(WB_DOT.fixed, `var(--wb-fixed-ink-${f.family})`), ink: `var(--wb-fixed-ink-${f.family})`, strength: WB_DOT.fixed };
    const c = WB_PALETTE_BY_ID.get(id);
    if (!c) return { id: 'default', family: 'themed', ground: 'var(--surface-page)', dot: dot(WB_DOT.default), ink: 'var(--text-primary)', strength: WB_DOT.default };
    const strength = c.id === 'ink' ? WB_DOT.ink : WB_DOT.tint;
    return { id: c.id, family: 'themed', ground: `color-mix(in srgb, ${c.token} ${WB_WASH}%, var(--surface-page))`, dot: dot(strength), ink: 'var(--text-primary)', strength };
  }
  // Contrast (WCAG): the ratio of two colours given as [r, g, b] (0-255), 1 to 21.
  function wbLuminance(rgb) {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function wbContrast(a, b) {
    const x = wbLuminance(a);
    const y = wbLuminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  // 'dark' or 'light': whichever of the two candidate text colours reads better on `fill` (the first when they tie), or
  // null when a colour is not three numbers. The page maps the answer to a colour.
  function wbContrastInk(fill, dark, light) {
    const ok = (c) => Array.isArray(c) && c.length >= 3 && c.slice(0, 3).every((n) => Number.isFinite(n));
    if (!ok(fill) || !ok(dark) || !ok(light)) return null;
    return wbContrast(fill, dark) >= wbContrast(fill, light) ? 'dark' : 'light';
  }
  // The widths a line or a border can have, in board units.
  const WB_WEIGHTS = [1, 2, 3, 4, 8, 12];
  // The words a menu shows for them.
  const WB_WEIGHT_NAMES = { 1: 'Hairline', 2: 'Thin', 3: 'Medium', 4: 'Thick', 8: 'Heavy', 12: 'Extra heavy' };
  const wbWeightName = (w) => WB_WEIGHT_NAMES[w] || `${w}`;
  // The board's dot grid, in board units: the dots the renderer draws sit on its multiples, and Snap to grid puts blocks
  // on them (wbSnap).
  const WB_GRID = 24;
  // This person's grid (the Grid button): its style ('dots', 'lines' for graph paper, or 'off'), pitch, colour and opacity.
  // `wbGrid` is the live one; its size is the pitch both the drawn grid and Snap to grid use. Kept in this browser, never
  // in the board's data; anything unreadable is the usual: dots, 24, automatic colour and strength.
  const WB_GRID_KEY = 'whiteboard-grid';
  const WB_GRID_STYLES = ['dots', 'lines', 'off'];
  const WB_GRID_COLOURS = [
    { id: 'auto', label: 'Automatic' },
    { id: 'muted', label: 'Muted', token: 'var(--text-muted)' },
    { id: 'accent', label: 'Accent', token: 'var(--accent)' },
    ...WB_PALETTE.filter((c) => c.id !== 'ink'),
  ];
  const WB_GRID_USUAL = Object.freeze({ style: 'dots', size: WB_GRID, color: 'auto', opacity: null });
  const wbGrid = { ...WB_GRID_USUAL };
  function wbGridClean(v) {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const u = WB_GRID_USUAL;
    return {
      style: WB_GRID_STYLES.includes(o.style) ? o.style : u.style,
      size: Number.isInteger(o.size) && o.size >= 8 && o.size <= 96 ? o.size : u.size,
      color: WB_GRID_COLOURS.some((c) => c.id === o.color) ? o.color : u.color,
      opacity: typeof o.opacity === 'number' && o.opacity >= 0 && o.opacity <= 1 ? o.opacity : u.opacity,
    };
  }
  function wbGridLoad(store) {
    try { return wbGridClean(JSON.parse(store().getItem(WB_GRID_KEY))); } catch { return wbGridClean(null); }
  }
  function wbGridSave(store, g) {
    try { store().setItem(WB_GRID_KEY, JSON.stringify(wbGridClean(g))); return true; } catch { return false; }
  }
  // The grid's colour as CSS on a background `d` (wbBackdrop): automatic is the background's own dot colour (its strength
  // unless an opacity is set); a chosen colour is its token at the set opacity, else the background's strength.
  function wbGridPaint(d, g) {
    if (g.color === 'auto' && g.opacity === null) return d.dot;
    const c = WB_GRID_COLOURS.find((x) => x.id === g.color);
    const tok = c && c.token ? c.token : d.ink;
    const pct = g.opacity === null ? d.strength : Math.round(g.opacity * 100);
    return `color-mix(in srgb, ${tok} ${pct}%, transparent)`;
  }
  // Where the tiles of the drawn grid start so the grid sits on the multiples of the pitch: a dot is drawn in the middle
  // of its tile (half a step back); a line is drawn at the tile's start (whole pixels, so it stays crisp).
  function wbGridOffset(style, view, step) {
    return style === 'lines' ? { x: Math.round(view.x), y: Math.round(view.y) } : { x: view.x - step / 2, y: view.y - step / 2 };
  }
  const wbSnap = (v, pitch = wbGrid.size) => Math.round(v / pitch) * pitch;
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
  // Where the words sit from top to bottom, for the block types that have room above or below them (a block type's
  // `valign` is its usual: what a block without the field looks like). A text block's height is its words', so it has none.
  const WB_VALIGNS = [
    { id: 'top', label: 'Top', icon: 'arrows-up-to-line' },
    { id: 'middle', label: 'Middle', icon: 'up-down' },
    { id: 'bottom', label: 'Bottom', icon: 'arrows-down-to-line' },
  ];
  const WB_VALIGN_BY_ID = new Map(WB_VALIGNS.map((x) => [x.id, x]));
  // How a block's words sit now: its own choice, else its type's usual (null: the type has none). `def` is the block type.
  const wbValignOf = (block, def) => (!def || !def.valign ? null : WB_VALIGN_BY_ID.has(block.valign) ? block.valign : def.valign);
  // The one value every block has for a words field (size, align, valign), undefined when they differ, null when none has
  // the field. get(block) gives the block's value.
  function wbAgreedWords(list, get) {
    const vals = new Set(list.map(get).filter((v) => v !== null));
    return vals.size === 0 ? null : vals.size === 1 ? [...vals][0] : undefined;
  }
  // The remembered size and align a new block of this type starts with (next: { size, align }, null for none): a new table
  // always starts centred (its create()), whatever was picked before.
  const wbNextWords = (def, next) => Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== null && !(def.type === 'table' && k === 'align')));
  // Whether a block type bears words that take a size and an alignment (a note, text, a shape with a box, a table): not a
  // stroke, a line, an arrow, a highlight, a connector, a picture or a frame (its title is plain).
  const wbBearsWords = (def) => Boolean(def && def.markup);
  // What the strip holds when a tool is chosen and nothing is picked, from the tool and the block type it makes (null: the
  // Hand has no strip; Select has the selection group only): { selection: Single, Many, Select all, Clear selection, fonts: size and alignment, line: line style and arrowheads, present: the Present
  // button, colours: the colour buttons }. The Fill tool has its colour only.
  function wbStripPlan(tool, def, family = null) {
    if (!tool || tool.mode || tool.id === 'eraser') return null; // the Hand and the Eraser have no strip
    if (tool.id === 'select') return { selection: true, fonts: false, line: false, present: false, colours: false };
    return { selection: false, fonts: wbBearsWords(def), line: tool.id === 'connector' || family === 'flowchart', present: tool.id === 'frame', colours: true };
  }
  // What the colour strip's fonts group shows: size and horizontal align for the picked blocks whose words take markup
  // (else for the active tool's type: size and align), vertical align only where a picked block's type has it. Pure: blocks and their
  // types in, { size, align, valign } out (each: the value, undefined for Mixed, null to hide), or null for no group.
  function wbFontsShown(blocks, defOfBlock, toolDef, next = {}) {
    const worded = blocks.filter((b) => wbBearsWords(defOfBlock(b)));
    if (blocks.length) {
      if (!worded.length) return null;
      const tall = worded.filter((b) => defOfBlock(b).valign);
      return {
        size: wbAgreedWords(worded, (b) => b.size),
        align: wbAgreedWords(worded, (b) => b.align),
        valign: tall.length ? wbAgreedWords(tall, (b) => wbValignOf(b, defOfBlock(b))) : null,
      };
    }
    if (!wbBearsWords(toolDef)) return null;
    const usual = toolDef.create();
    return { size: next.size || usual.size, align: (!wbNextWords(toolDef, next).align ? null : next.align) || usual.align, valign: null }; // a new block's vertical align is its type's own: not shown until it is picked
  }
  // Flowchart auto-connect: whether a shape just placed (box `next`) is clearly in line with the one placed before it (box
  // `last`), each { x, y, w, h }. In line: the new centre is within 45 degrees of the horizontal or vertical axis from the
  // old centre (exactly 45 counts as across), the boxes do not touch, and the gap between them is at most 4 times the larger
  // width (across) or height (down). Answers null, or the sides a connector uses: { from, to } ('right' then 'left' for a new
  // shape to the right, and so on).
  function wbAutoConnect(last, next) {
    if (!last || !next) return null;
    const dx = next.x + next.w / 2 - (last.x + last.w / 2);
    const dy = next.y + next.h / 2 - (last.y + last.h / 2);
    if (!dx && !dy) return null;
    const across = Math.abs(dx) >= Math.abs(dy);
    const gap = across ? Math.abs(dx) - (last.w + next.w) / 2 : Math.abs(dy) - (last.h + next.h) / 2;
    if (gap <= 0 || gap > 4 * (across ? Math.max(last.w, next.w) : Math.max(last.h, next.h))) return null;
    if (across) return dx > 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
    return dy > 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
  }
  // What the Table properties menu shows for the picked tables (or, with none, for new ones: `next`): { align, valign, head,
  // size }, each the one value they all have, undefined when they differ.
  function wbTableProps(tables, next) {
    if (!tables.length) return { align: next.align, valign: next.valign, head: next.head, size: next.size };
    const one = (get) => { const v = new Set(tables.map(get)); return v.size === 1 ? [...v][0] : undefined; };
    return { align: one((b) => b.align), valign: one((b) => wbValignOf(b, blockTypes.get('table'))), head: one((b) => Boolean(b.head)), size: one((b) => b.size) };
  }
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
    // A fixed colour (WB_FIXED_BACKGROUNDS, the board background's own list) is a palette name too.
    paint(v, extra, fallback) { return WB_PALETTE_BY_ID.has(v) || WB_FIXED_BY_ID.has(v) || (extra && extra.includes(v)) ? v : fallback; },
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
  // floating?: true (the timer: held by the board but drawn by the type itself through float(block) and floatGone(id), see
  // lib-d; never drawn on the board, picked, copied or saved as a picture), copied?(block) -> the fields a copy of it
  // changes (lib-h), and container?: true (a
  // frame, lib-e-block-frame.js: it sits under the other blocks, is picked by its tab and border only, holds the blocks
  // inside it when it is moved or copied, and takes no connector).
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
  // A block a connector can be attached to: one with a box of its own (four corners to resize), not a line, a drawing,
  // another connector or a frame (a container).
  const wbAttachable = (def) => Boolean(def && !def.attached && !def.container && def.resize && def.resize.handles === 'corners');
  // The fields that change when a block is moved by dx, dy: its type's move, else x and y.
  function wbMoved(b, dx, dy) {
    const def = blockTypes.get(b.type);
    return def && def.move ? def.move(b, dx, dy) : { x: b.x + dx, y: b.y + dy };
  }

  // A tool: { id, label, icon, order, key?, apart? (its own on/off button after the tool switch), mode? (a
  // choice in the tool switch whose key pressed again goes back to the tool before it: the Hand), edits (it changes the board), makes? (the block
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
      // valign: only a valid choice is kept; anything else is absent, which reads as the type's usual (def.valign).
      if (def.valign && WB_VALIGN_BY_ID.has(raw.valign)) own.valign = raw.valign;
    }
    // z is kept as it is (not rounded), so a block put between two neighbours keeps its place; see wbBetween.
    const z = typeof raw.z === 'number' && Number.isFinite(raw.z) && Math.abs(raw.z) <= 1e9 ? raw.z : 0;
    const group = wbGroupOf(raw);
    return {
      ...own,
      id,
      type: def.type,
      ...(placed ? { x, y } : {}),
      z,
      // Any block may be locked (it stays where it is and as it is) and be in a group; a block that is neither has
      // neither field (see "locks and groups" below).
      ...(raw.locked === true ? { locked: true } : {}),
      ...(group ? { group } : {}),
      by: typeof raw.by === 'string' ? raw.by.slice(0, 64) : '',
      at: typeof raw.at === 'string' ? raw.at.slice(0, 40) : '',
    };
  }

  // Locks and groups, two fields any block may have, each stored with the block like its colours:
  //   locked: true   the block stays where it is and as it is: no move, resize, delete, edit, colour, layer or cut (lib-b
  //                  refuses them; lib-m's arrange and delete skip it). It can still be picked, copied (the copy is not
  //                  locked), saved as a picture, and unlocked by anyone who may change the board.
  //   group: '<id>'  a short id ([a-z0-9], at most 24) its group's members share: picking one picks them all, and what is
  //                  done to the picked blocks is done to each. A group of fewer than two blocks on the board is no group
  //                  (nothing is rewritten: it is just not one when read, wbGroupsOf).
  const WB_GROUP_RE = /^[a-z0-9]{1,24}$/;
  const wbGroupOf = (b) => (b && typeof b.group === 'string' && WB_GROUP_RE.test(b.group) ? b.group : null);
  // A new group's id: 12 letters and digits.
  function wbGroupId(random = Math.random) {
    let out = '';
    while (out.length < 12) out += Math.floor(random() * 36).toString(36);
    return out;
  }
  // The groups among some blocks: group id -> the ids of its members, only those with two or more.
  function wbGroupsOf(blocks) {
    const all = new Map();
    for (const b of blocks) {
      const g = wbGroupOf(b);
      if (!g) continue;
      if (!all.has(g)) all.set(g, []);
      all.get(g).push(b.id);
    }
    for (const [g, ids] of all) if (ids.length < 2) all.delete(g);
    return all;
  }

  // The board's state: the blocks by id. It draws nothing and saves nothing.
  // A block type marked `floating` (the timer) is held here but is not part of the board's drawing: all(), size, topZ()
  // and bottomZ() leave it out, so nothing that lists, orders, picks, arranges, finds or saves the blocks sees it. get(),
  // has() and ofType() do.
  function createBoard() {
    const blocks = new Map();
    const floats = (b) => { const d = blockTypes.get(b.type); return Boolean(d && d.floating); };
    return {
      ofType: (type) => [...blocks.values()].filter((b) => b.type === type),
      get: (id) => blocks.get(id) || null,
      has: (id) => blocks.has(id),
      put(block) { blocks.set(block.id, block); },
      remove(id) { return blocks.delete(id); },
      clear() { blocks.clear(); },
      all: () => [...blocks.values()].filter((b) => !floats(b)).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1)),
      get size() { let n = 0; for (const b of blocks.values()) if (!floats(b)) n += 1; return n; },
      topZ() { let z = 0; for (const b of blocks.values()) if (!floats(b)) z = Math.max(z, b.z); return z; },
      bottomZ() { let z = 0; for (const b of blocks.values()) if (!floats(b)) z = Math.min(z, b.z); return z; },
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
