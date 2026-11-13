// Saved layouts (documentation/plans/plan-saved-layouts.md, step 2): the arithmetic of saving a canvas as a layout and
// placing a layout on a canvas, apart from the page so tools/check-canvas.mjs can run it. No DOM in here; canvas.js
// measures the canvas and its modules (captureLayout) and opens and moves them (loadLayout).
//
// A layout is { modules: [{ id, mode, dockW?, box?, stack?, at?, h?, folded? }], snap: { all, pitch } }, the shape
// server/layouts.js keeps: modules in column order (docked first, in their columns' order, then floating, in the order
// they were opened), a docked module's width in pixels (none for the flexible column, the conference when docked: its
// size is what the others leave it), a floating module's box as fractions of the canvas (0 to 1, so it scales to another
// window), and the canvas-level snap switch with the grid's pitch in pixels. A module's own `snap`, which an older version
// saved, is read without error and ignored: the canvas-level switch is the only one (Thomas, 2026-10-13).
//
// A stack (plan-panel-stacking.md, "How a stack is saved"): two or three docked modules sharing one column, one above the
// other. Each of them carries `stack` (the column's id, 1 to 32 of a-z and 0-9, the same in each), `at` (its place in the
// stack from the top: 0, 1, 2, with no gap), `h` (its share of the column's height, 0.1 to 0.9, the stack's shares
// summing to 1) and `folded` (true while the person has collapsed it). They are listed one after the other, top first,
// where the column is in the column order; the column's width is each one's `dockW`. A module with no `stack` is a column
// of its own. The person's own remembered layout (canvas.js, `app.canvas.<space>`) keeps the same four keys on each
// module's record. The stack's arithmetic (grouping, heights, the divider, the short canvas) is here too.

import { MIN_W, MIN_H, DOCK_MIN, gridFor, cellBox, resettle } from '/snap-grid.js';

// The server's limits (server/layouts.js, LAYOUT_LIMITS), so the page says what the server would refuse before asking.
// A stack: at most stackMax modules in one column, each one's share of the column's height from stackHMin to stackHMax,
// the shares adding up to 1 within stackHSum.
export const LAYOUT_LIMITS = Object.freeze({ personal: 10, shared: 10, name: 40, modules: 20, dockWMin: 160, dockWMax: 2000, pitchMin: 50, pitchMax: 320, stackMax: 3, stackHMin: 0.1, stackHMax: 0.9, stackHSum: 0.01 });
// A stack's id (the server's rule too): 1 to 32 of a-z and 0-9.
export const STACK_ID = /^[a-z0-9]{1,32}$/;
// A stack's sizes (Thomas, on the Prototype): a section never has less than its title bar (36 px, --mf-title-h) and 120 px
// under it, 156 in all; a collapsed section is its title bar alone.
export const STACK = Object.freeze({ max: LAYOUT_LIMITS.stackMax, titleH: 36, contentMin: 120, sectionMin: 156 });
// The conference and the chat live in the always-on column (plan-one-bar.md, step 6), not on the canvas: a layout
// neither saves nor places them. A layout saved before (or by a phone) may still name them; they are accepted and
// left alone, never "left out".
export const COLUMN_IDS = Object.freeze(['conference', 'chat']);
const inColumn = (id) => COLUMN_IDS.includes(id);
// `aliases` (composites.js's aliasesFor; plan-calendar-todo.md and plan-map-places.md, step 3): a module id in a stored
// layout read as another ({ calendar: 'dest:calendar', todo: 'dest:calendar' } while the Calendar is on in the space;
// { maps: 'dest:map' } while the space's Map is shown), or as a list of others.
// A layout naming both parts places the composite once, where the first is named; the layout itself is never rewritten.
const aliasOf = (id, aliases) => (aliases && Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : id);
const PITCH_DEFAULT = 130;

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// Four places: a fraction of a 4000 px canvas is still within half a pixel.
const frac = (v) => Math.round(clamp(v, 0, 1) * 10000) / 10000;
const pitchOf = (p) => clamp(Math.round(num(p, PITCH_DEFAULT)), LAYOUT_LIMITS.pitchMin, LAYOUT_LIMITS.pitchMax);
const stackIdOf = (p) => (p && typeof p.stack === 'string' && STACK_ID.test(p.stack) ? p.stack : null);

// --- stacks (plan-panel-stacking.md) ------------------------------------------------------------------------------------

// The columns a set of docked modules make. `items` is each module wanting a column, { id, order, stack?, at? }, in any
// order. The answer is the columns in column order (a column is where its first module is in `order`), each
// { key, stack, ids }: a stack's modules top first (by `at`), at most `max` of them, its key `stack:<id>`; any other
// module alone, its key its id. A stack id only one module carries is no stack (decision 8: an ordinary column), and a
// stack's modules past `max` are columns of their own.
export function groupColumns(items, max = LAYOUT_LIMITS.stackMax) {
  const list = (Array.isArray(items) ? items : []).filter((p) => p && p.id != null).slice().sort((a, b) => num(a.order) - num(b.order));
  const bySid = new Map();
  for (const p of list) {
    const sid = stackIdOf(p);
    if (!sid) continue;
    if (!bySid.has(sid)) bySid.set(sid, []);
    bySid.get(sid).push(p);
  }
  const members = new Map(); // sid -> the stack's modules, top first, at most max
  for (const [sid, group] of bySid) {
    const top = group.slice().sort((a, b) => num(a.at, 99) - num(b.at, 99) || num(a.order) - num(b.order)).slice(0, Math.max(1, max));
    if (top.length > 1) members.set(sid, top);
  }
  const cols = [];
  const placed = new Set();
  for (const p of list) {
    if (placed.has(p.id)) continue;
    const sid = stackIdOf(p);
    const top = sid ? members.get(sid) : null;
    if (top && top.includes(p)) {
      cols.push({ key: `stack:${sid}`, stack: sid, ids: top.map((x) => x.id) });
      for (const x of top) placed.add(x.id);
      continue;
    }
    cols.push({ key: String(p.id), stack: null, ids: [p.id] });
    placed.add(p.id);
  }
  return cols;
}

// Equal shares for `n` sections (decision 6: a new stack starts with equal heights).
export const evenShares = (n) => Array.from({ length: Math.max(0, n) }, () => 1 / n);

// `n` shares of a column's height as they may be kept: each from stackHMin to stackHMax, together 1, to four places. A
// share missing or not above 0 is taken as an equal one.
export function cleanShares(h, n = Array.isArray(h) ? h.length : 0) {
  if (n < 1) return [];
  if (n === 1) return [1];
  const lo = LAYOUT_LIMITS.stackHMin;
  const hi = LAYOUT_LIMITS.stackHMax;
  let v = Array.from({ length: n }, (_, i) => { const x = num(Array.isArray(h) ? h[i] : undefined, NaN); return x > 0 ? x : 1 / n; });
  const sum = v.reduce((a, x) => a + x, 0);
  v = v.map((x) => x / sum);
  for (let pass = 0; pass < 8; pass += 1) {
    const fixed = v.map((x) => (x < lo ? lo : x > hi ? hi : null));
    if (fixed.every((x) => x === null)) break;
    const fixedSum = fixed.reduce((a, x) => a + (x ?? 0), 0);
    const free = v.map((x, i) => (fixed[i] === null ? x : 0));
    const freeSum = free.reduce((a, x) => a + x, 0);
    const freeCount = fixed.filter((x) => x === null).length;
    v = v.map((x, i) => (fixed[i] !== null ? fixed[i] : freeSum > 0 ? (x * (1 - fixedSum)) / freeSum : (1 - fixedSum) / Math.max(1, freeCount)));
  }
  const out = v.map((x) => Math.round(clamp(x, lo, hi) * 10000) / 10000);
  // The rounding's rest goes to the largest, so the shares add up to 1.
  const rest = Math.round((1 - out.reduce((a, x) => a + x, 0)) * 10000) / 10000;
  if (rest) { const big = out.indexOf(Math.max(...out)); out[big] = Math.round((out[big] + rest) * 10000) / 10000; }
  return out;
}

// The heights in pixels of a stack's sections in a column `total` px tall. `col` is { h, folded, keep }: each section's
// share, whether the person collapsed it, and the index of the one the person opened last (or -1). A collapsed section is
// its title bar (`titleH`); the open ones share the rest by their shares, none under `min`. When the column cannot give
// every open one `min`, the lowest open one collapses by itself, then the next, never the one opened last and never the
// last one open (Thomas: the last section stays open). The person's own collapse is never undone here, except that a
// stack with every section collapsed keeps its last open. Answers { px, auto, open }: the heights (whole pixels), which
// sections collapsed by themselves, and the indexes of the open ones.
export function splitHeights(total, col = {}, { titleH = STACK.titleH, min = STACK.sectionMin } = {}) {
  const n = Array.isArray(col.h) ? col.h.length : 0;
  const T = Math.max(0, num(total));
  const folded = Array.from({ length: n }, (_, i) => Boolean(col.folded && col.folded[i]));
  if (n && folded.every(Boolean)) folded[num(col.keep, -1) >= 0 && num(col.keep, -1) < n ? num(col.keep) : n - 1] = false;
  const auto = Array.from({ length: n }, () => false);
  const shut = (i) => folded[i] || auto[i];
  const openNow = () => Array.from({ length: n }, (_, i) => i).filter((i) => !shut(i));
  for (;;) {
    const open = openNow();
    const rest = T - (n - open.length) * titleH;
    if (open.length <= 1 || rest >= open.length * min) break;
    const next = [...open].reverse().find((i) => i !== col.keep);
    auto[next ?? open[open.length - 1]] = true;
  }
  const open = openNow();
  const rest = Math.max(0, T - (n - open.length) * titleH);
  const shares = cleanShares(col.h, n);
  const sum = open.reduce((a, i) => a + shares[i], 0) || 1;
  const px = Array.from({ length: n }, (_, i) => (shut(i) ? titleH : (rest * shares[i]) / sum));
  if (open.length > 1 && rest >= open.length * min) {
    for (let pass = 0; pass < 4; pass += 1) {
      const low = open.filter((i) => px[i] < min - 0.01);
      if (!low.length) break;
      const need = low.reduce((a, i) => a + (min - px[i]), 0);
      const give = open.filter((i) => px[i] > min);
      const spare = give.reduce((a, i) => a + (px[i] - min), 0) || 1;
      for (const i of low) px[i] = min;
      for (const i of give) px[i] -= (need * (px[i] - min)) / spare;
    }
  }
  // Whole pixels that still fill the column: the rounding's rest goes to the last open section.
  const whole = px.map((v) => Math.round(v));
  const left = Math.round(T) - whole.reduce((a, v) => a + v, 0);
  if (left && open.length && whole.reduce((a, v) => a + v, 0) > 0) whole[open[open.length - 1]] += left;
  return { px: whole, auto, open };
}

// A divider moved: the section above it (`i`) is to be `upper` px tall. `px` are the sections' heights now and `h` their
// shares; only the two beside the divider change, the upper one kept from `min` to the pair's height less `min` (when the
// pair is shorter than two `min`, it stays at half). Answers { h, upper }: the new shares and the upper section's height.
export function dragShares({ px, h, i, upper, min = STACK.sectionMin }) {
  const total = num(px[i]) + num(px[i + 1]);
  const share = num(h[i]) + num(h[i + 1]);
  const out = h.slice();
  if (!(total > 0) || !(share > 0)) return { h: out, upper: num(px[i]) };
  const x = clamp(num(upper), Math.min(min, total / 2), Math.max(total - min, total / 2));
  out[i] = (share * x) / total;
  out[i + 1] = share - out[i];
  return { h: out, upper: x };
}

// Why a module cannot go into a column as a section, or '' when it can: 'mover' (it cannot be in a stack: the conference,
// the chat, a composite), 'target' (the column cannot hold a stack), 'full' (it holds `max` already), 'short' (the column,
// `height` px tall, cannot give every section `min`). `n` is how many the column holds now, `inIt` whether the module is
// already one of them (moving within its own stack is always allowed).
export function stackRefusal({ mover = true, target = true, n = 1, inIt = false, height = Infinity, max = STACK.max, min = STACK.sectionMin } = {}) {
  if (!mover) return 'mover';
  if (!target) return 'target';
  if (inIt) return '';
  if (n >= max) return 'full';
  if ((n + 1) * min > num(height, Infinity)) return 'short';
  return '';
}

// A list of layout entries with their stacks made whole: a stack is only docked modules with a good id, two to stackMax of
// them (the rest are columns of their own, a stack left with one is none), their `at` 0, 1, 2 in their old order, their
// shares cleaned (cleanShares), `folded` true or false and never every one, and one width, the top one's `dockW`. The entries keep their order; an entry not in
// a stack has none of the four keys. Nothing given is changed.
export function tidyStacks(entries) {
  const list = (Array.isArray(entries) ? entries : []).map((e) => {
    const { stack, at, h, folded, ...rest } = e || {};
    return rest.mode === 'dock' && typeof stack === 'string' && STACK_ID.test(stack) ? { ...rest, stack, at, h, folded } : rest;
  });
  const cols = groupColumns(list.filter((e) => e.stack).map((e, i) => ({ id: e.id, order: i, stack: e.stack, at: e.at })));
  const member = new Map();
  for (const c of cols) if (c.ids.length > 1) c.ids.forEach((id, at) => member.set(id, { c, at }));
  const shares = new Map(cols.filter((c) => c.ids.length > 1).map((c) => [c.key, cleanShares(c.ids.map((id) => list.find((e) => e.id === id).h), c.ids.length)]));
  return list.map((e) => {
    if (!e.stack) return e;
    const m = member.get(e.id);
    if (!m) { const { stack, at, h, folded, ...rest } = e; return rest; }
    const all = m.c.ids.map((id) => Boolean(list.find((x) => x.id === id).folded));
    const keepOpen = all.every(Boolean) && m.at === m.c.ids.length - 1;
    // One column, one width: every module of a stack takes the top one's dockW (where it has one).
    const topW = list.find((x) => x.id === m.c.ids[0]).dockW;
    return { ...e, ...(topW !== undefined ? { dockW: topW } : {}), at: m.at, h: shares.get(m.c.key)[m.at], folded: Boolean(e.folded) && !keepOpen };
  });
}

// --- saving and placing --------------------------------------------------------------------------------------------------

// The layout a canvas makes. `modules` is every open module, as canvas.js reads them:
//   { id, mode: 'dock' | 'float' | 'window', order, was?, canDock?, flex?, width?, box?, stack?, at?, h?, folded? }
// `mode` what it is now (a module waiting for a column is 'dock': it wants one), `order` its place in the column order
// (and, floating, the order it was opened), `was` its remembered mode (for one in a window of its own), `canDock`
// whether it can be a column, `flex` the flexible column, `width` its own docked width in pixels, `box` a floating
// box in pixels in the same coordinates as `area`, and a docked module's stack as remembered. `area` is the canvas: { x, y, w, h }.
// `snap` is the canvas-level { all, pitch }. A module in a window of its own is saved as the mode it had on the canvas
// before (`was`), else docked where it can dock. A stack is saved top first where its column is, with an id of its own in
// this layout (s1, s2, ...).
export function layoutOf(modules, area, snap = {}, aliases = {}) {
  const A = { x: num(area?.x), y: num(area?.y), w: Math.max(1, num(area?.w, 1)), h: Math.max(1, num(area?.h, 1)) };
  const list = (Array.isArray(modules) ? modules : []).filter((p) => p && typeof p.id === 'string' && p.id && !inColumn(p.id))
    .map((p) => { const to = aliasOf(p.id, aliases); return typeof to === 'string' ? (to === p.id ? p : { ...p, id: to }) : null; }).filter(Boolean);
  const modeOf = (p) => {
    if (p.mode === 'dock' || p.mode === 'float') return p.mode;
    if (p.was === 'dock' || p.was === 'float') return p.was;
    return p.canDock === false ? 'float' : 'dock';
  };
  const byOrder = (a, b) => num(a.order) - num(b.order);
  const seen = new Set();
  const take = (p) => (seen.has(p.id) ? false : (seen.add(p.id), true));
  const docked = list.filter((p) => modeOf(p) === 'dock').sort(byOrder).filter(take);
  const floating = list.filter((p) => modeOf(p) === 'float').sort(byOrder).filter(take);
  const byId = new Map(docked.map((p) => [p.id, p]));
  const out = [];
  let stacks = 0;
  for (const col of groupColumns(docked.map((p) => ({ id: p.id, order: p.order, stack: stackIdOf(p), at: p.at })))) {
    const sid = col.ids.length > 1 ? `s${++stacks}` : null;
    col.ids.forEach((id, at) => {
      const p = byId.get(id);
      const entry = { id: p.id, mode: 'dock' };
      const w = Math.round(num(p.width, 0));
      if (!p.flex && w > 0) entry.dockW = clamp(w, LAYOUT_LIMITS.dockWMin, LAYOUT_LIMITS.dockWMax);
      if (sid) Object.assign(entry, { stack: sid, at, h: num(p.h, 0), folded: p.folded === true });
      out.push(entry);
    });
  }
  for (const p of floating) {
    const entry = { id: p.id, mode: 'float' };
    const b = p.box;
    if (b && num(b.w) > 0 && num(b.h) > 0) {
      const w = clamp(num(b.w) / A.w, 0.0001, 1);
      const h = clamp(num(b.h) / A.h, 0.0001, 1);
      entry.box = { x: frac((num(b.x) - A.x) / A.w), y: frac((num(b.y) - A.y) / A.h), w: Math.max(0.0001, frac(w)), h: Math.max(0.0001, frac(h)) };
    }
    out.push(entry);
  }
  // A stack cut by the limit on modules is made whole again (one left is a column of its own).
  return { modules: tidyStacks(out.slice(0, LAYOUT_LIMITS.modules)), snap: { all: Boolean(snap?.all), pitch: pitchOf(snap?.pitch) } };
}

// Where a layout's modules go on a canvas `area` ({ x, y, w, h }). `canOpen(id)` says whether this person may open a
// module here (on in the space, installed, readable): the others are left out, named in `left`, and the stored layout
// is not changed, so it comes back whole when the module is on again. The answer:
//   modules  [{ id, mode, dockW?, box?, cell?, snap, stack?, at?, h?, folded? }] in the layout's order: a docked width
//            clamped as the canvas's clampDock() does (DOCK_MIN to 60% of the canvas), a floating box in pixels, scaled
//            from the fractions, at least MIN_W by MIN_H and inside the area; with the canvas-level snap on, each
//            floating one with the grid cells it settles in at the saved pitch, by snap-grid.js's resettle(), none on
//            another where there is room, and its box the cells' box; a stack's modules with their stack, closed up
//            where one was left out (tidyStacks: a stack left with one module is an ordinary column);
//   left     the ids left out, in the layout's order;
//   snap     the canvas-level { all, pitch }.
export function placeLayout(layout, area, canOpen = () => true, aliases = {}) {
  const A = { x: num(area?.x), y: num(area?.y), w: Math.max(1, num(area?.w, 1)), h: Math.max(1, num(area?.h, 1)) };
  const snap = { all: Boolean(layout?.snap?.all), pitch: pitchOf(layout?.snap?.pitch) };
  const left = [];
  const modules = [];
  const seen = new Set();
  const maxDock = Math.max(DOCK_MIN, Math.round(A.w * 0.6));
  const least = { w: Math.min(MIN_W, A.w), h: Math.min(MIN_H, A.h) };
  // Each stored entry read through the aliases: one entry per id it reads as, with the stored entry's mode and places.
  const entries = (Array.isArray(layout?.modules) ? layout.modules : []).flatMap((entry) => {
    if (!entry || typeof entry.id !== 'string') return [];
    const to = aliasOf(entry.id, aliases);
    return (Array.isArray(to) ? to : [to]).filter((id) => typeof id === 'string' && id).map((id) => (id === entry.id ? entry : { ...entry, id }));
  });
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    if (inColumn(entry.id)) continue; // the column's: accepted in an older layout, never placed, never left out
    if (!canOpen(entry.id)) { left.push(entry.id); continue; }
    const mode = entry.mode === 'float' ? 'float' : 'dock';
    const placed = { id: entry.id, mode, snap: mode === 'float' && snap.all };
    if (mode === 'dock' && entry.dockW !== undefined) placed.dockW = clamp(Math.round(num(entry.dockW, DOCK_MIN)), DOCK_MIN, maxDock);
    if (mode === 'dock' && stackIdOf(entry)) Object.assign(placed, { stack: entry.stack, at: num(entry.at, 0), h: num(entry.h, 0), folded: entry.folded === true });
    if (mode === 'float' && entry.box) {
      const b = entry.box;
      const w = Math.round(clamp(num(b.w) * A.w, least.w, A.w));
      const h = Math.round(clamp(num(b.h) * A.h, least.h, A.h));
      const x = Math.round(clamp(A.x + num(b.x) * A.w, A.x, A.x + A.w - w));
      const y = Math.round(clamp(A.y + num(b.y) * A.h, A.y, A.y + A.h - h));
      placed.box = { x, y, w, h };
    }
    modules.push(placed);
  }
  // The snapped ones, settled together onto the grid at the saved pitch from their scaled boxes.
  const snapped = modules.filter((p) => p.snap && p.box);
  if (snapped.length) {
    const g = gridFor({ left: A.x, top: A.y, width: A.w, height: A.h }, snap.pitch);
    const cells = resettle(g, snapped.map((p) => ({ id: p.id, box: p.box })));
    for (const p of snapped) {
      p.cell = cells.get(p.id);
      const c = cellBox(g, p.cell);
      p.box = { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) };
    }
  }
  return { modules: tidyStacks(modules), left, snap };
}

// The one line a load says about what it left out, by the modules' names: "Map isn't on in this space, so it was left
// out." `nameOf(id)` gives a module's name, `space` the environment's word for a space. '' when nothing was left out.
export function leftOutNote(ids, nameOf = (id) => id, space = 'space') {
  const names = (Array.isArray(ids) ? ids : []).map((id) => nameOf(id) || id);
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} isn't on in this ${space}, so it was left out.`;
  const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} aren't on in this ${space}, so they were left out.`;
}

// Whether two arrangements differ, for the Modified mark on the current layout. Each is a layout's shape (a stored layout
// or canvas.captureLayout()): the modules in column order with their mode and, as stored, width, box, snap and stack;
// the arrangement mode (`arrange`; absent reads as Window when every module floats, else Panel); the canvas snap. Small
// differences are noise (a width within 2 pixels, a box edge or a stack share within half a percent: a load fitted to
// the window rounds them). Z-order, scroll, zoom and a module's own content are not part of the shape, so they never
// count. Pure; compared on arrangement changes, not on every mouse move.
const arrangeOf = (l) => (l?.arrange === 'window' || l?.arrange === 'dock' ? l.arrange
  : Array.isArray(l?.modules) && l.modules.length && l.modules.every((m) => m?.mode === 'float') ? 'window' : 'dock');
export function layoutDiffers(a, b) {
  const A = Array.isArray(a?.modules) ? a.modules : [];
  const B = Array.isArray(b?.modules) ? b.modules : [];
  if (A.length !== B.length || arrangeOf(a) !== arrangeOf(b)) return true;
  if (Boolean(a?.snap?.all) !== Boolean(b?.snap?.all) || (a?.snap?.all && Math.round(num(a.snap.pitch)) !== Math.round(num(b.snap.pitch)))) return true;
  const near = (x, y, tol) => Math.abs(num(x) - num(y)) <= tol;
  return A.some((m, i) => {
    const n = B[i];
    if (!m || !n || m.id !== n.id || m.mode !== n.mode) return true;
    if (m.mode === 'dock' && (m.dockW !== undefined || n.dockW !== undefined) && !(m.dockW !== undefined && n.dockW !== undefined && near(m.dockW, n.dockW, 2))) return true;
    if (m.mode === 'float' && (m.box || n.box) && !(m.box && n.box && ['x', 'y', 'w', 'h'].every((k) => near(m.box[k], n.box[k], 0.005)))) return true;
    if ((m.stack || null) !== (n.stack || null) || num(m.at) !== num(n.at) || Boolean(m.folded) !== Boolean(n.folded)) return true;
    return Boolean(m.stack) && !near(m.h, n.h, 0.005);
  });
}
