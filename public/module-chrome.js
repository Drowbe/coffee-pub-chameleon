// The pure rules of a module window's bands: cleaning what a module sends (host.add.set, host.status.set, host.header.set,
// host.toolbar.set), whether the "+" runs its one action or opens a menu, the menu's entries in the shared menu's shape
// (public/host-menu.js, with categories as flyouts), the status bar's polite, debounced read-out, the standard actions a
// module handles (host.standard.set: cleanStandardActions, cleanShareResult), and how each of them maps onto the module
// frame (public/module-frame.js: frameAdd, statusFrame, titlebarActions, frameToolbar).
// No DOM and no imports: public/module-host.js draws with these, and tools/check-module-chrome.mjs tests them.
// See documentation/plans/plan-module-titlebar-add.md, "The contract".

export const ADD_LIMITS = { top: 8, perCategory: 12, leaves: 40, label: 40 };
export const STATUS_LIMITS = { items: 4, text: 60, title: 200 };
export const STATUS_QUIET_MS = 1500;

const ICON = /^[a-z0-9-]{1,40}$/;
const TINT = /^(gold|blue|green|teal|purple|red|orange|pink)$/;
const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// What host.add.set sent, cleaned: a leaf { id, label, icon?, tint?, hint?, disabled }, a category
// { label, icon?, items: [leaf...] } (one level; a category inside one is dropped), or { divider: true }. At most 8
// top-level entries, 12 per category and 40 leaves in all; the rest is dropped. A category with one leaf is that leaf;
// an empty one is dropped. No divider first, last or twice in a row.
// The same add twice in one list (the same label and icon, at the top or inside one category) is one: the first stays.
export const addKey = (e) => `${String((e && e.label) || '').trim().toLowerCase()}|${(e && e.icon) || ''}`;
export function cleanAddEntries(entries) {
  let leaves = 0;
  const leaf = (e, seen) => {
    if (!e || typeof e !== 'object' || e.items || e.divider) return null;
    const id = str(e.id, 40);
    const label = str(e.label, ADD_LIMITS.label);
    if (!id || !label || leaves >= ADD_LIMITS.leaves || seen.has(addKey(e))) return null;
    seen.add(addKey(e));
    leaves += 1;
    const out = { id, label, disabled: Boolean(e.disabled) };
    if (ICON.test(e.icon || '')) out.icon = e.icon;
    if (TINT.test(e.tint || '')) out.tint = e.tint;
    const hint = str(e.hint, 40);
    if (hint) out.hint = hint;
    return out;
  };
  const out = [];
  const seenTop = new Set();
  const counted = () => out.filter((x) => !x.divider).length;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (counted() >= ADD_LIMITS.top) break;
    if (!e || typeof e !== 'object') continue;
    if (e.divider) {
      if (out.length && !out[out.length - 1].divider) out.push({ divider: true });
      continue;
    }
    if (Array.isArray(e.items)) {
      const label = str(e.label, ADD_LIMITS.label);
      if (!label) continue;
      const items = [];
      const seenIn = new Set();
      for (const s of e.items) {
        if (items.length >= ADD_LIMITS.perCategory) break;
        const l = leaf(s, seenIn);
        if (l) items.push(l);
      }
      if (!items.length) continue;
      if (items.length === 1) { out.push(items[0]); continue; }
      const cat = { label, items };
      if (ICON.test(e.icon || '')) cat.icon = e.icon;
      out.push(cat);
      continue;
    }
    const l = leaf(e, seenTop);
    if (l) out.push(l);
  }
  while (out.length && out[out.length - 1].divider) out.pop();
  return out;
}

// The old action bar (host.bar.set), folded into the "+": each button a plain leaf, the primary ones first and the rest in
// their order (10 at most, as the bar took). A quick-add item is a leaf too (its label, else its placeholder, else "Add";
// icon `plus` unless it gave one); `quick` lists their ids, whose pick sends { id, value: '' }. `overflow` and `iconOnly`
// mean nothing in a menu and are dropped. Returns { entries, quick }; entries go through cleanAddEntries as any others.
// The adds of several parts of one page (a composite's Map and its Places panel), each a list as host.add.set sent it: an
// add another part already offers (the same label and icon) is left out of the later one. Returns the lists, same order.
export function dropRepeatedAdds(lists) {
  const seen = new Set();
  const fresh = (e) => { const k = addKey(e); if (seen.has(k)) return false; seen.add(k); return true; };
  return lists.map((list) => (Array.isArray(list) ? list : [])
    .map((e) => (e && e.items ? { ...e, items: e.items.filter(fresh) } : e))
    .filter((e) => !e || e.divider || (e.items ? e.items.length : fresh(e))));
}
export function foldBarItems(items) {
  const clean = (Array.isArray(items) ? items : []).slice(0, 10).map((i) => {
    const quick = i?.type === 'quickadd';
    const icon = ICON.test(i?.icon || '') ? i.icon : quick ? 'plus' : '';
    const label = str(i?.label, ADD_LIMITS.label) || (quick ? str(i?.placeholder, ADD_LIMITS.label) || 'Add' : '');
    return { id: str(i?.id, 40), label, icon, primary: Boolean(i?.primary), disabled: Boolean(i?.disabled), quick };
  }).filter((i) => i.id && i.label);
  const ordered = [...clean.filter((i) => i.primary), ...clean.filter((i) => !i.primary)];
  return {
    entries: ordered.map(({ id, label, icon, disabled }) => ({ id, label, disabled, ...(icon ? { icon } : {}) })),
    quick: new Set(ordered.filter((i) => i.quick).map((i) => i.id)),
  };
}

// What the "+" does with cleaned entries: { kind: 'none' } (no "+"), { kind: 'direct', leaf } (exactly one leaf and no
// category: it runs at once, its label the tooltip and the accessible name) or { kind: 'menu', label: 'Add' }.
export function addPlan(clean) {
  const real = (clean || []).filter((x) => !x.divider);
  if (!real.length) return { kind: 'none' };
  if (real.length === 1 && !real[0].items) return { kind: 'direct', leaf: real[0] };
  return { kind: 'menu', label: 'Add' };
}

// The menu's entries in the shared menu's shape: a category's `items` open as a flyout (a drill-in on a phone).
// `onPick(id)` runs for a leaf.
export function addMenuItems(clean, onPick) {
  const leafItem = (l) => ({
    label: l.label,
    ...(l.icon ? { icon: l.icon } : {}),
    ...(l.tint ? { tint: l.tint } : {}),
    ...(l.hint ? { hint: l.hint } : {}),
    disabled: l.disabled,
    onPick: () => onPick(l.id),
  });
  return (clean || []).map((e) => {
    if (e.divider) return { divider: true };
    if (e.items) return { label: e.label, ...(e.icon ? { icon: e.icon } : {}), items: e.items.map(leafItem) };
    return leafItem(e);
  });
}

// The "+" as the frame's title bar draws it (module-frame.js, titlebar.add): none, one action (its event carries the
// leaf's id as `value`) or a menu of them (`onPick(id)` for a leaf).
export function frameAdd(clean, onPick) {
  const plan = addPlan(clean);
  if (plan.kind === 'none') return null;
  if (plan.kind === 'direct') return { label: plan.leaf.label, disabled: plan.leaf.disabled, value: plan.leaf.id };
  return { label: plan.label, items: () => addMenuItems(clean, onPick) };
}

// What host.status.set sent, cleaned: up to 4 items { text, icon?, title, quiet, end }, text up to 60 characters,
// `title` (the tooltip) the text unless given. At most one `end` item (the first marked), and it goes last.
export function cleanStatusItems(items, limit = STATUS_LIMITS.items) {
  const out = [];
  let end = null;
  for (const i of Array.isArray(items) ? items : []) {
    if (out.length + (end ? 1 : 0) >= limit) break;
    if (!i || typeof i !== 'object') continue;
    const text = str(i.text, STATUS_LIMITS.text);
    if (!text) continue;
    const item = { text, title: str(i.title, STATUS_LIMITS.title) || text, quiet: Boolean(i.quiet), end: false };
    if (ICON.test(i.icon || '')) item.icon = i.icon;
    if (i.end && !end) { item.end = true; end = item; } else out.push(item);
  }
  return end ? [...out, end] : out;
}

// The same items as last time draw nothing.
export const statusKey = (clean) => JSON.stringify(clean || []);
// The bar's own tooltip: every item's text. What a screen reader hears: the items that are not quiet.
export const statusTitle = (clean) => (clean || []).map((i) => i.text).join(' · ');
export const statusSpoken = (clean) => (clean || []).filter((i) => !i.quiet).map((i) => i.text).join(' · ');
// The cleaned items as the frame's status bar draws them (module-frame.js, setStatus): the words at the start, a dot
// between, cut with an ellipsis when the bar is too narrow; the `end` item at the end, never cut.
export function statusFrame(clean) {
  const part = (i) => ({ text: i.text, ...(i.icon ? { icon: i.icon } : {}), title: i.title });
  return {
    lead: (clean || []).filter((i) => !i.end).map(part),
    items: (clean || []).filter((i) => i.end).map(part),
    title: statusTitle(clean),
  };
}

// The polite read-out: `write(text)` gets the spoken text only after `delay` without a change, never for the first
// draw, and only when it differs from what was last read out. `setTimer` and `clearTimer` are the window's (or a test's).
export function createAnnouncer({ write, delay = STATUS_QUIET_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let first = true;
  let last = '';
  let timer = null;
  return {
    update(text) {
      const t = String(text || '');
      if (first) { first = false; last = t; return; }
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        if (!t || t === last) return; // nothing to say (the bar went away), or already said
        last = t;
        write(t);
      }, delay);
    },
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

// Which module is on top at a point (issue #60). Each candidate is { id, rect, z, order, visible, blocks }: a module
// frame, or a `blocks` cover (a module window's own titlebar, toolbar or status bar, a composite page's frame) that
// takes a drop without passing it on. `z` is how high it paints at that point (the host reads it from the page's own
// stacking, document.elementsFromPoint); `order` breaks a tie, the later one on top. A hidden one, or one the point
// is not inside, never wins. Answers the topmost candidate, or null when nothing is there.
export function topmostAt(candidates, x, y) {
  let best = null;
  for (const c of candidates || []) {
    if (!c || c.visible === false || !c.rect) continue;
    const r = c.rect;
    if (!(x >= r.left && x < r.right && y >= r.top && y < r.bottom)) continue;
    if (!best || c.z > best.z || (c.z === best.z && (c.order || 0) > (best.order || 0))) best = c;
  }
  return best;
}

// What host.toolbar.set sent, cleaned (plan-unified-layout.md, "The contract"): at most 16 items, each one of
//   { type: 'title', text }                                 the row's title (Calendar's "October 2026")
//   { type: 'text', text }                                  a quieter note in the row
//   { type: 'tabs', id, value, options: [{ id, label?, icon?, regular?, iconOnly? }] }   a segmented view switch
//   { type: 'search', id, value?, placeholder?, label? }    the row's search, in its fixed place at the end
//   { type: 'chips', id, label?, single?, value?, options: [{ id, label, icon?, tint?, note?, count?, on?, default? }] }
//                                                           a group of filters in the row's one Filters menu, under
//                                                           `label`: switches (each `on`; applied while it is not its
//                                                           `default`, which is on unless given), or with `single` one
//                                                           choice (`value`; the first option is "nothing applied")
//   { type: 'button', id, label?, title?, icon?, regular?, on?, primary?, disabled?, overflow?, placement? }  (the default type)
//                                                           `placement`: 'titlebar' (an icon beside the title bar's menu)
//                                                           or 'menu' (in the title bar's menu); else in the row, and
//                                                           `overflow` always in the row's "More"
// Anything else is dropped. A function `send` on an item (the host page's own items, never a module's: a module's go through
// postMessage or this cleaning first) is kept, so the page can mix its own items into a part's row.
export const TOOLBAR_LIMITS = { items: 16, tabs: 8, chips: 24, text: 80, title: 80, label: 30, placeholder: 80, value: 200 };
// `zone` (exactly 'start' or 'end'; anything else is left out): a module's toolbar item goes in the row's left zone ('start',
// the default) or its right zone ('end', after the search and Filters, at the far right). A module's right-zone item is held
// in place when the row is narrow (the left zone folds and goes into "More" first); `pin` is the host page's alone, only an
// item with a `send` function keeps it (the Calendar destination's panel switch and the panel's items), and a host page's
// right-zone item is moved into "More" only when it is not pinned. A page's item with any zone also makes the page's order
// the row's: its items are kept in the order given, not sorted switches first (a module's zone never does).
const pageZone = (i) => {
  const page = typeof i.send === 'function';
  const zone = i.zone === 'end' ? { zone: 'end' } : i.zone === 'start' ? { zone: 'start' } : {};
  return { ...zone, ...(page ? (i.pin === true ? { pin: true } : {}) : zone.zone === 'end' ? { pin: true } : {}) };
};
export function cleanToolbarItems(items) {
  const s = (v, n) => String(v ?? '').slice(0, n);
  const id = (v) => s(v, 40);
  const icon = (v) => (ICON.test(v || '') ? v : '');
  const out = [];
  for (const i of (Array.isArray(items) ? items : []).slice(0, TOOLBAR_LIMITS.items)) {
    if (!i || typeof i !== 'object') continue;
    const own = typeof i.send === 'function' ? { send: i.send } : {};
    const type = ['tabs', 'text', 'title', 'search', 'chips', 'button', undefined].includes(i.type) ? i.type || 'button' : null;
    if (!type) continue;
    if (type === 'text' || type === 'title') { const text = s(i.text, TOOLBAR_LIMITS[type]); if (text) out.push({ type, text, ...own, ...pageZone(i) }); continue; }
    if (type === 'tabs') {
      const options = (Array.isArray(i.options) ? i.options : []).slice(0, TOOLBAR_LIMITS.tabs).map((o) => ({
        id: id(o?.id), label: s(o?.label, TOOLBAR_LIMITS.label), icon: icon(o?.icon), regular: Boolean(o?.regular), iconOnly: Boolean(o?.iconOnly),
        ...(Number.isInteger(o?.count) && o.count >= 0 ? { count: o.count } : {}), // a number that stays visible when the words fold away
      })).filter((o) => o.id && (o.label || o.icon));
      if (id(i.id) && options.length) out.push({ type, id: id(i.id), value: id(i.value), options, ...own, ...pageZone(i) });
      continue;
    }
    if (type === 'search') {
      if (!id(i.id)) continue;
      const placeholder = s(i.placeholder, TOOLBAR_LIMITS.placeholder);
      out.push({ type, id: id(i.id), value: s(i.value, TOOLBAR_LIMITS.value), placeholder, label: s(i.label, TOOLBAR_LIMITS.placeholder) || placeholder || 'Search', ...own });
      continue;
    }
    if (type === 'chips') {
      const single = Boolean(i.single);
      const options = (Array.isArray(i.options) ? i.options : []).slice(0, TOOLBAR_LIMITS.chips).map((o) => {
        const opt = { id: id(o?.id), label: s(o?.label, 40) };
        if (!single) { opt.default = o?.default !== false; opt.on = o?.on === undefined ? opt.default : Boolean(o.on); }
        const note = s(o?.note, 20);
        if (note) opt.note = note;
        if (Number.isInteger(o?.count) && o.count >= 0) opt.count = o.count;
        if (icon(o?.icon)) opt.icon = o.icon;
        if (TINT.test(o?.tint || '')) opt.tint = o.tint;
        return opt;
      }).filter((o) => o.id && o.label);
      if (!id(i.id) || !options.length) continue;
      const chips = { type, id: id(i.id), label: s(i.label, 60) || 'Filter', single, options, ...own };
      if (single) chips.value = options.some((o) => o.id === id(i.value)) ? id(i.value) : options[0].id;
      out.push(chips);
      continue;
    }
    const b = {
      type: 'button',
      id: id(i.id),
      label: s(i.label, TOOLBAR_LIMITS.label),
      title: s(i.title, 40),
      icon: icon(i.icon),
      regular: Boolean(i.regular),
      on: typeof i.on === 'boolean' ? i.on : null, // null: not a toggle, so no pressed state
      primary: Boolean(i.primary),
      disabled: Boolean(i.disabled),
      overflow: Boolean(i.overflow),
      placement: i.placement === 'titlebar' || i.placement === 'menu' ? i.placement : 'row',
      ...own,
      ...pageZone(i),
    };
    if (b.id && (b.label || b.icon)) out.push(b);
  }
  return out;
}

// The titlebar's own icons (host.header.set), cleaned: at most 10 of { id, title, icon, regular, on, disabled, overflow,
// danger }. `overflow` puts one in the title bar's menu; `danger` (a destructive action) is always last in that menu, red.
export function cleanHeaderItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 10).map((i) => ({
    id: String(i?.id ?? '').slice(0, 40),
    title: String(i?.title ?? '').slice(0, 40),
    icon: ICON.test(i?.icon || '') ? i.icon : '',
    regular: Boolean(i?.regular),
    on: Boolean(i?.on),
    disabled: Boolean(i?.disabled),
    overflow: Boolean(i?.overflow),
    danger: Boolean(i?.danger),
  })).filter((i) => i.id && i.icon);
}

// The standard actions a module handles itself (host.standard.set): Settings, Share and Print, the engine's, drawn by the
// host the same in every module (module-frame.js, titlebar.moduleStandard) and only for the ones the module declared. Each
// is true, or { disabled?, hint? } (`hint` up to 40 characters: why it is off, or a word beside it); anything else, or a
// module that has no handler for it, leaves it out. The words, icons and order are the host's, never the module's.
export const MODULE_STANDARD = ['settings', 'share', 'print'];
export function cleanStandardActions(spec) {
  const out = {};
  const s = spec && typeof spec === 'object' ? spec : {};
  for (const id of MODULE_STANDARD) {
    const v = s[id];
    if (v === true) out[id] = {};
    else if (v && typeof v === 'object') {
      const o = {};
      if (v.disabled) o.disabled = true;
      const hint = str(v.hint, 40);
      if (hint) o.hint = hint;
      out[id] = o;
    }
  }
  return out;
}

// What the module's share handler answered, cleaned for the host's share dialog: { url, title, message }. `url` an https or
// http address, or a path on this server (made whole against `origin`); `title` up to 80 characters (else "Share"),
// `message` up to 300. Null when there is no address to share.
export function cleanShareResult(r, origin) {
  if (!r || typeof r !== 'object') return null;
  const raw = String(r.url ?? '').trim();
  if (!raw || raw.length > 2000) return null;
  let url;
  try {
    url = raw.startsWith('/') && !raw.startsWith('//') ? new URL(raw, origin) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return { url: url.href, title: str(r.title, 80) || 'Share', message: String(r.message ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, 300) };
}

// What the frame's title bar shows for a module (module-frame.js, titlebar.actions): its header icons (host.header.set),
// then the toolbar buttons placed in the title bar or its menu. Each keeps where it came from (`from`: 'header' or
// 'toolbar'), so its click goes back as that event. More than five icons beside the menu: the rest go into the menu.
export function titlebarActions(header, toolbar) {
  const out = [];
  for (const h of header || []) {
    out.push({ id: h.id, from: 'header', label: h.title || h.id, icon: h.icon, ...(h.regular ? { regular: true } : {}),
      placement: h.overflow ? 'menu' : 'bar', ...(h.on ? { on: true } : {}), ...(h.disabled ? { disabled: true } : {}), ...(h.danger ? { danger: true } : {}),
      ...(h.send ? { send: h.send } : {}) });
  }
  for (const b of toolbar || []) {
    if (b.type !== 'button' || b.placement === 'row') continue;
    out.push({ id: b.id, from: 'toolbar', label: b.title || b.label || b.id, icon: b.icon || 'circle', ...(b.regular ? { regular: true } : {}),
      placement: b.placement === 'titlebar' ? 'bar' : 'menu', ...(typeof b.on === 'boolean' ? { on: b.on } : {}), ...(b.disabled ? { disabled: true } : {}),
      ...(b.send ? { send: b.send } : {}) });
  }
  let bar = 0;
  for (const a of out) if (a.placement === 'bar' && !a.danger && (bar += 1) > 5) a.placement = 'menu';
  return out;
}

// The cleaned toolbar items as the frame's one row draws them (module-frame.js): the start group in Thomas's order (the
// view switches, then the title and notes, then the buttons, each kind in the order given), then the search and one
// Filters button that holds every chips item as a group. Title bar buttons are not here (titlebarActions).
const ROW_ORDER = { tabs: 0, title: 1, text: 1, button: 2 };
export function frameToolbar(clean) {
  const start = [];
  const end = [];
  const tail = []; // the right zone: items the page gave `zone: 'end'`
  const groups = [];
  const zoned = (clean || []).some((i) => i.zone && i.send); // only a host page's zones fix the order
  const place = (e, i) => (i.zone === 'end' ? tail : start).push(i.zone === 'end' ? { ...e, zone: 'end', ...(i.pin ? { pin: true } : {}) } : e);
  for (const i of clean || []) {
    if (i.type === 'tabs') place({ type: 'switch', id: i.id, label: 'View', value: i.value, options: i.options.map((o) => ({ ...o })), ...(i.send ? { send: i.send } : {}) }, i);
    else if (i.type === 'title' || i.type === 'text') place({ type: i.type, text: i.text }, i);
    else if (i.type === 'search') end.push({ type: 'search', id: i.id, label: i.label, placeholder: i.placeholder, value: i.value, ...(i.send ? { send: i.send } : {}) });
    else if (i.type === 'chips') groups.push({ id: i.id, heading: i.label, single: i.single, ...(i.single ? { value: i.value } : {}), options: i.options.map((o) => ({ ...o })), ...(i.send ? { send: i.send } : {}) });
    else if (i.type === 'button' && i.placement === 'row') {
      place({
        type: 'button', id: i.id, label: i.label || i.title, icon: i.icon || undefined, ...(i.regular ? { regular: true } : {}),
        kind: i.primary ? 'primary' : i.icon && !i.label ? 'icon' : 'secondary',
        ...(i.title && i.title !== i.label ? { tip: i.title } : {}), ...(typeof i.on === 'boolean' ? { on: i.on } : {}),
        ...(i.disabled ? { disabled: true } : {}), ...(i.overflow ? { more: true } : {}), ...(i.send ? { send: i.send } : {}),
      }, i);
    }
  }
  const ordered = zoned ? start : start.map((e, at) => ({ e, at })).sort((a, b) => (ROW_ORDER[a.e.type === 'switch' ? 'tabs' : a.e.type] - ROW_ORDER[b.e.type === 'switch' ? 'tabs' : b.e.type]) || a.at - b.at).map((x) => x.e);
  if (groups.length) end.push({ type: 'filters', id: 'filters', label: 'Filters', groups });
  return [...ordered, ...end, ...tail];
}
