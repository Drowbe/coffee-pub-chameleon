// The module frame (Thomas, 2026-10-22; approved on the Prototype page, 2026-10-24): one function draws the whole frame a
// module sits in, in four levels, top down: the title bar, the toolbar (one row), the content area and the status bar. Its
// styles are the moduleframe block of public/sdk/system.css; every size there is a named token at the top of the block.
// Every module window draws it: a window on a space's canvas, docked or floating (canvas.js), a module's own page and its
// popped-out window (module.js), a destination's page (destination.js) and the composite on the canvas that holds one.
// module-host.js turns what a module asks for through the SDK (host.toolbar.set, host.header.set, host.add.set,
// host.status.set) into the entries below.
//
//   const frame = createModuleFrame({
//     title, icon, tint,                             // the title bar's words, its Font Awesome icon and the module's tint
//     variant,                                       // 'window' (the default: edge, corner, shadow), 'docked' (a column of
//                                                    // the canvas: its left edge only) or 'page' (fills a page: no edge)
//     bands: { titlebar, status },                   // false leaves that band out (a destination's page in a composite)
//     titlebar: {                                    // the title bar's actions (below)
//       add,                                         // the "+": true, { label, disabled?, value? } (one action: its event
//                                                    // carries `value`), { label, items } (host-menu.js entries, or a
//                                                    // function giving them) or { label, entries: [{ id, label, icon }] }
//       actions: [{ id, label, icon, regular?, placement: 'bar' | 'menu', danger?, on?, disabled? }],  // the module's own
//       standard: { dock, window, popout, clear },  // the window's: or a function giving it, asked as the menu opens;
//                                                    // each true, false or { label?, hint?, disabled?, tip? }
//       moduleStandard: { settings, share, print, onPick(id, el) }, // the module's own handlers (host.standard.set): each
//                                                    // true or { hint?, disabled? }; only those given are drawn, with the
//                                                    // host's words and icons; a pick calls onPick, not onAction
//       close,                                       // true: a close button at the end
//       onAction(event),                             // the title bar's events; else the frame's onAction
//     },
//     toolbar: [ ...entries ],                        // see below
//     content, flush, empty: { icon, title, text },   // a Node, or nothing (empty is drawn); flush: no padding
//     status: { text, lead, items },                 // see setStatus
//     onAction(event),                               // { area, id, value?, on?, submit?, el? } for every control
//   });
//   frame.el                                         // the <section>, ready to append
//   frame.titlebar                                   // the title bar's element (a floating window's handle)
//   frame.setToolbar(list), frame.setTitlebar(patch), frame.setStatus(s), frame.setContent(node), frame.setTitle(t),
//   frame.announce(text), frame.fit(), frame.destroy()
//   frame.titlebarMenu()                             // the title bar menu's entries as they are now (host-menu.js items)
//
// The title bar, start to end: the icon, the title, the module's 'bar' actions (icon buttons), the "+", the menu button
// (More, whenever the menu has anything in it) and the close button. The menu: the module's own actions, a line, the
// standard actions that apply (Dock as a panel, Open as a window, Open in its own window: the window's; Settings, Share,
// Print: the module's, when it handles them), then the destructive actions last, red, after a line of their own (the
// module's, then the host's Clear). A title bar event is { area: 'titlebar', id, standard?: true, on?, value?, el }; the
// window's standard ids are dock, window, popout and clear; `el` is the button the person used (a confirm opens under it).
// Settings, Share and Print go to moduleStandard.onPick(id, el) instead. Narrow, the bar icons fold into the menu (the
// last first) before the title is cut, so nothing is clipped. On a phone (640 px and narrower, or a touch screen) every
// button in the title bar and the toolbar has a tap area of 44 px by at least 36 px around it, drawn by system.css and
// invisible: nothing moves and no two overlap.
//
// A toolbar entry is one of:
//   { type: 'switch', id, label, value, options: [{ id, label, icon, regular?, iconOnly? }] }   a segmented switch; too wide for the row,
//       only its last choices fold into "More" (the chosen one always stays in the row), the whole switch only when no more than the chosen one fits
//   { type: 'tabs', id, label, value, options: [{ id, label, count? }] }  a tab strip, for switching between different pages
//   { type: 'quickset', id, label, value, options: [{ id, label, count? }] }  quick sets: one filter chip chosen at a time, with counts
//   { type: 'search', id, label, placeholder, value? }
//   { type: 'chips', id, label, options: [{ id, label, on }] }            filter chips
//   { type: 'filters', id, label, groups: [{ id, heading, single?, value?, options: [{ id, label, count?, on?, default?,
//       icon?, tint?, note? }] }] }  one Filters button with a count; its menu has Clear filters and the groups. A single
//       group is applied while its value is not its first option; a switch is applied while `on` is not its `default`
//       (false unless given), and Clear filters puts each back
//   { type: 'button', id, label, icon?, regular?, kind: 'primary' | 'secondary' | 'icon', tip?, on?, disabled?, more? }
//       `on` a pressed state; `more` always in the "More" menu
//   { type: 'title', text }                                               words in the row
//   { type: 'text', text }                                                quieter words in the row (a short note)
//   (a 'spacer' is no longer needed: the row's end group is always search, then Filters, at the same place from the right edge)
// The search field and the Filters button are kept between draws, so typing, focus and an open Filters menu survive a
// module drawing its row again; the search shows the entry's `value` only when it differs from the last one given.
//
// The overflow rule, one row, nothing ever cut. While the row is wider than its room, these steps are taken in this
// order, each only if the row still does not fit: the chips fold into one Filters button; the view switch shows only its
// icons; a secondary button with an icon shows only its icon; the tab strip folds into one button with the current tab;
// the search becomes a magnifier (it opens over the row); a primary button with an icon shows only its icon. Then, if it
// still does not fit, whole controls go into the "More" menu one at a time, in MOVE order below, until it fits. A word
// folded away is the control's tooltip and its name.
import { openHostMenu, closeHostMenu, hostMenuOpen, refreshHostMenu } from '/host-menu.js';
import '/tooltip.js';

// The standard title bar actions, drawn by the host the same in every module, in this order. The window's (Dock as a panel,
// Open as a window, Open in its own window, Clear) come from titlebar.standard: Open as a window and Open in its own window
// are on unless switched off, Dock as a panel and Clear only when given. The module's (Settings, Share, Print: `module`)
// come from titlebar.moduleStandard and are drawn only when the module handles them (host.standard.set). The words and
// icons are the canvas's own (public/canvas.js) and never the module's.
const STANDARD = [
  { id: 'dock', label: 'Dock as a panel', icon: 'table-columns', tip: 'Dock beside the video', off: true },
  { id: 'window', label: 'Open as a window', icon: 'window-restore', regular: true, tip: 'Float over the call' },
  { id: 'popout', label: 'Open in its own window', icon: 'up-right-from-square', tip: 'Pop out of this page' },
  { id: 'settings', label: 'Settings', icon: 'gear', module: true },
  { id: 'share', label: 'Share', icon: 'share-nodes', module: true },
  { id: 'print', label: 'Print', icon: 'print', module: true },
  { id: 'clear', label: 'Clear', icon: 'trash', danger: true, off: true },
];
const FOLDS = ['chips', 'switch', 'secondary', 'tabs', 'search', 'primary'];
// Which control goes into "More" first: the lowest number first, then the one furthest along the row.
const MOVE = { icon: 1, secondary: 2, chips: 3, quickset: 3, title: 4, text: 4, primary: 5, switch: 6, tabs: 7, search: 8 };
const TINT = /^(gold|blue|green|teal|purple|red|orange|pink)$/;

let seq = 0;

// Whether a band's controls reach past its padding (the end padding is room, never for a control).
function overflows(band) {
  if (band.scrollWidth > band.clientWidth + 1) return true;
  const r = band.getBoundingClientRect();
  const end = r.right - parseFloat(getComputedStyle(band).paddingRight) - (band.clientLeft || 0);
  let right = -Infinity;
  for (const c of band.children) {
    if (!c.getClientRects().length) continue;
    right = Math.max(right, c.getBoundingClientRect().right);
  }
  return right > end + 0.5;
}

export function createModuleFrame(opts = {}) {
  const doc = opts.document || document;
  const win = doc.defaultView || window;
  const uid = `mf${++seq}`;
  const onAction = typeof opts.onAction === 'function' ? opts.onAction : () => {};
  const bands = { titlebar: true, status: true, ...(opts.bands || {}) };
  let tbOpts = { ...(opts.titlebar || {}) };
  let entries = [];
  let searching = false;
  let observer = null;
  let frameReq = 0;
  const kept = new Map(); // 'search:<id>' and 'filters' -> their elements, kept between draws

  const el = (tag, cls, attrs = {}) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    return e;
  };
  const icon = (name, cls = '', regular = false) => el('i', `fa-${regular ? 'regular' : 'solid'} fa-${name} fa-fw${cls ? ` ${cls}` : ''}`, { 'aria-hidden': 'true' });
  const word = (text) => el('span', 'mf-word', { text });
  // A button: its kind's class, an optional icon, optional words. With no words its label is its name and tooltip.
  const button = (cls, { label, iconName, regular = false, words = true, tip = null }) => {
    const b = el('button', cls, { type: 'button' });
    if (iconName) b.append(icon(iconName, '', regular));
    if (label && words) b.append(word(label));
    b.setAttribute('aria-label', label || iconName || '');
    if (!words || tip) b.dataset.tip = tip || label;
    return b;
  };

  // ---- the frame ----
  const variant = ['docked', 'page'].includes(opts.variant) ? opts.variant : 'window';
  const root = el('section', `mf${variant === 'window' ? '' : ` mf-${variant}`}`, { 'aria-labelledby': bands.titlebar ? `${uid}-title` : null });
  const head = el('header', 'mf-titlebar');
  const toolbar = el('div', 'mf-toolbar', { role: 'group', 'aria-label': 'Tools' });
  const content = el('div', 'mf-content', { id: `${uid}-content`, tabindex: '-1' });
  const status = el('footer', 'mf-status', { role: 'region' });
  const live = el('span', 'visually-hidden', { 'aria-live': 'polite' });
  root.append(...(bands.titlebar ? [head] : []), toolbar, content, ...(bands.status ? [status] : []), live);
  if (!bands.titlebar && opts.title) root.setAttribute('aria-label', opts.title);

  // ---- 1. the title bar ----
  const headIcon = el('span', 'mf-titlebar-icon', { 'aria-hidden': 'true' });
  const headTitle = el('h2', 'mf-titlebar-title', { id: `${uid}-title`, tabindex: '0', 'data-tip-if-truncated': '' });
  const headTools = el('div', 'mf-titlebar-tools');
  head.append(headIcon, headTitle, headTools);
  function setTitle(text, iconName = opts.icon) {
    headTitle.textContent = text || '';
    headTitle.dataset.tip = text || '';
    headIcon.textContent = '';
    if (iconName) headIcon.append(icon(iconName));
    headIcon.hidden = !iconName;
    if (!bands.titlebar && text) root.setAttribute('aria-label', text);
    status.setAttribute('aria-label', text ? `${text} status` : 'Status');
  }
  if (TINT.test(opts.tint || '')) headIcon.dataset.tint = opts.tint;
  // The title bar's actions (Thomas, 2026-10-24). Three kinds, one menu: the module's own actions (each 'bar', an icon
  // button beside the menu, or 'menu'), the "+" (the host's, always shown beside the menu), and the standard actions the
  // host draws the same in every module (STANDARD above; the window says which apply). The menu (the host's own,
  // host-menu.js): the module's actions first (any bar icons folded away, then its menu actions), a line, the standard
  // actions, then the destructive ones last, in red, after a line of their own. The menu button is there whenever the menu
  // has anything in it.
  const tbFire = (data) => {
    (typeof tbOpts.onAction === 'function' ? tbOpts.onAction : onAction)({ area: 'titlebar', ...data });
  };
  let tbFold = null;
  const standardNow = () => (typeof tbOpts.standard === 'function' ? tbOpts.standard() : tbOpts.standard) || {};
  function titlebarMenu() {
    const actions = Array.isArray(tbOpts.actions) ? tbOpts.actions : [];
    const std = standardNow();
    const mod = tbOpts.moduleStandard && typeof tbOpts.moduleStandard === 'object' ? tbOpts.moduleStandard : {};
    const menuEl = tbFold ? tbFold.menu : null;
    const entry = (a) => ({
      label: a.label, icon: a.icon, ...(a.regular ? { regular: true } : {}), ...(a.danger ? { danger: true } : {}),
      ...(a.disabled ? { disabled: true } : {}),
      ...(typeof a.on === 'boolean' ? { checked: a.on } : {}),
      onPick: () => pickAction(a, menuEl),
    });
    const own = [];
    if (tbFold) for (const { a, b } of tbFold.bar) if (b.hidden) own.push(entry(a));
    for (const a of actions) if (!a.danger && a.placement !== 'bar') own.push(entry(a));
    const standard = [];
    const hostDanger = [];
    for (const s of STANDARD) {
      const v = s.module ? (typeof mod.onPick === 'function' ? mod[s.id] : false) : std[s.id] === undefined ? !s.off : std[s.id];
      if (!v) continue;
      const o = typeof v === 'object' ? v : {};
      const item = {
        label: (!s.module && o.label) || s.label, icon: s.icon, ...(s.regular ? { regular: true } : {}), ...(s.danger ? { danger: true } : {}),
        ...(o.tip || s.tip ? { tip: o.tip || s.tip } : {}), ...(o.hint ? { hint: o.hint } : {}), ...(o.disabled ? { disabled: true } : {}),
        onPick: s.module ? () => mod.onPick(s.id, menuEl) : () => tbFire({ id: s.id, standard: true, el: menuEl }),
      };
      (s.danger ? hostDanger : standard).push(item);
    }
    const danger = [...actions.filter((a) => a.danger).map(entry), ...hostDanger];
    const runs = [own, standard, danger].filter((r) => r.length);
    return runs.flatMap((r, at) => (at ? [{ divider: true }, ...r] : r));
  }
  function pickAction(a, from) {
    if (typeof a.on === 'boolean') {
      a.on = !a.on;
      const bar = tbFold && tbFold.bar.find((x) => x.a === a);
      if (bar) { bar.b.setAttribute('aria-pressed', String(a.on)); bar.b.classList.toggle('is-on', a.on); }
    }
    tbFire({ id: a.id, ...(typeof a.on === 'boolean' ? { on: a.on } : {}), el: from || null });
  }
  function drawTitlebar() {
    if (!bands.titlebar) return;
    if (hostMenuOpen() && head.contains(doc.activeElement)) closeHostMenu();
    const focusKey = head.contains(doc.activeElement) ? doc.activeElement.dataset.key : null;
    headTools.textContent = '';
    const actions = Array.isArray(tbOpts.actions) ? tbOpts.actions : [];
    // The bar icons: a destructive action is never one (it is always last in the menu).
    const bar = [];
    for (const a of actions) {
      if (a.placement !== 'bar' || a.danger) continue;
      const b = button('mf-icon-btn mf-titlebar-btn', { label: a.label, iconName: a.icon || 'circle', regular: a.regular, words: false });
      b.dataset.key = `action:${a.id}`;
      if (typeof a.on === 'boolean') { b.setAttribute('aria-pressed', String(a.on)); b.classList.toggle('is-on', a.on); }
      b.disabled = Boolean(a.disabled);
      b.addEventListener('click', () => pickAction(a, b));
      bar.push({ a, b });
      headTools.append(b);
    }
    if (tbOpts.add) {
      const add = typeof tbOpts.add === 'object' ? tbOpts.add : {};
      const b = button('mf-icon-btn mf-titlebar-btn mf-add-btn', { label: add.label || 'Add', iconName: 'plus', words: false });
      b.dataset.key = 'add';
      b.disabled = Boolean(add.disabled);
      const items = add.items || (Array.isArray(add.entries) && add.entries.length
        ? add.entries.map((e) => ({ label: e.label, icon: e.icon, onPick: () => tbFire({ id: 'add', value: e.id, el: b }) }))
        : null);
      if (items) {
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        b.addEventListener('click', () => openHostMenu(b, items));
      } else b.addEventListener('click', () => tbFire({ id: 'add', ...(add.value !== undefined ? { value: add.value } : {}), el: b }));
      headTools.append(b);
    }
    const menu = button('mf-icon-btn mf-titlebar-btn mf-titlebar-menu', { label: 'More', iconName: 'ellipsis-vertical', words: false });
    menu.dataset.key = 'menu';
    menu.setAttribute('aria-haspopup', 'menu');
    menu.setAttribute('aria-expanded', 'false');
    menu.addEventListener('click', () => openHostMenu(menu, titlebarMenu));
    headTools.append(menu);
    tbFold = { bar, menu };
    if (tbOpts.close) {
      const b = button('mf-icon-btn mf-titlebar-btn mf-close-btn', { label: 'Close', iconName: 'xmark', words: false });
      b.dataset.key = 'close';
      b.addEventListener('click', () => tbFire({ id: 'close', el: b }));
      headTools.append(b);
    }
    showMenuButton();
    if (focusKey) {
      const again = headTools.querySelector(`[data-key="${focusKey}"]`);
      if (again && !again.hidden) again.focus();
    }
  }
  function showMenuButton() {
    if (tbFold) tbFold.menu.hidden = titlebarMenu().length === 0;
  }
  // Narrow: the bar icons fold into the menu, the last first, before the title is cut or anything is clipped.
  function fitTitlebar() {
    if (!tbFold) return;
    for (const { b } of tbFold.bar) b.hidden = false;
    const cut = () => headTitle.scrollWidth > headTitle.clientWidth + 1;
    for (let at = tbFold.bar.length - 1; at >= 0; at -= 1) {
      showMenuButton();
      if (!overflows(head) && !cut()) break;
      tbFold.bar[at].b.hidden = true;
    }
    showMenuButton();
  }

  // ---- 2. the toolbar ----
  const fire = (data) => onAction({ area: 'toolbar', ...data });
  function drawSwitch(it) {
    // A radio group (the keyboard is the SDK's: public/sdk/host.js, hostSwitch): one Tab stop, the arrows move and choose.
    const seg = el('div', 'mf-switch', { role: 'radiogroup', 'aria-label': it.label || 'Tools' });
    const stop = it.options.some((o) => o.id === it.value) ? it.value : it.options[0]?.id;
    for (const o of it.options) {
      const b = el('button', 'mf-switch-btn', { type: 'button', role: 'radio', 'aria-checked': String(o.id === it.value), tabindex: o.id === stop ? '0' : '-1', 'aria-label': o.label || o.icon });
      b.dataset.key = `switch:${it.id}:${o.id}`;
      if (o.icon) b.append(icon(o.icon, '', o.regular));
      if (o.label && !(o.iconOnly && o.icon)) b.append(word(o.label));
      else if (o.label) b.dataset.tip = o.label;
      if (o.count !== undefined && o.count !== null) b.append(el('span', 'sdk-badge', { text: String(o.count) })); // stays when the words fold away
      b.addEventListener('click', () => { it.value = o.id; fire({ id: it.id, value: o.id, el: b }); redraw(); });
      seg.append(b);
    }
    return [seg];
  }
  function tabsMenu(it, b) {
    openHostMenu(b, it.options.map((o) => ({ label: o.label, radio: true, checked: o.id === it.value, badge: o.count, onPick: () => { it.value = o.id; fire({ id: it.id, value: o.id }); redraw(); } })));
  }
  function drawTabs(it) {
    const strip = el('div', 'mf-tabs', { role: 'tablist', 'aria-label': it.label || 'Tabs' });
    const tabs = it.options.map((o) => {
      const on = o.id === it.value;
      const t = el('button', 'mf-tab', { type: 'button', role: 'tab', 'aria-selected': String(on), 'aria-controls': `${uid}-content`, tabindex: on ? '0' : '-1' });
      t.append(word(o.label));
      if (o.count !== undefined && o.count !== null) t.append(el('span', 'sdk-badge', { text: String(o.count) }));
      t.addEventListener('click', () => { it.value = o.id; fire({ id: it.id, value: o.id }); redraw(`tab:${it.id}`); });
      strip.append(t);
      return t;
    });
    // Arrow keys move between the tabs and choose (the tab pattern).
    strip.addEventListener('keydown', (e) => {
      const at = tabs.indexOf(doc.activeElement);
      if (at < 0) return;
      let to = null;
      if (e.key === 'ArrowRight') to = (at + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') to = (at - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = tabs.length - 1;
      if (to === null) return;
      e.preventDefault();
      tabs[to].click();
    });
    const current = it.options.find((o) => o.id === it.value) || it.options[0];
    const menu = el('button', 'mf-tabs-menu', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': `${it.label || 'Tabs'}: ${current ? current.label : ''}` });
    menu.append(word(current ? current.label : ''), icon('caret-down', 'mf-caret'));
    menu.addEventListener('click', () => tabsMenu(it, menu));
    return [strip, menu];
  }
  // Quick sets: a single-choice group of chips with counts. The chosen one is filled, the others outlined; narrow, the whole group goes into More.
  function drawQuickset(it) {
    const group = el('div', 'mf-quickset', { role: 'radiogroup', 'aria-label': it.label || 'Show' });
    const chips = it.options.map((o) => {
      const on = o.id === it.value;
      const c = el('button', `mf-chip${on ? ' is-on' : ''}`, { type: 'button', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1' });
      c.append(word(o.label));
      if (o.count !== undefined && o.count !== null) c.append(el('span', 'sdk-badge', { text: String(o.count) }));
      c.dataset.key = `chip:${it.id}:${o.id}`;
      c.addEventListener('click', () => { it.value = o.id; fire({ id: it.id, value: o.id }); redraw(`chip:${it.id}:${o.id}`); });
      group.append(c);
      return c;
    });
    group.addEventListener('keydown', (e) => {
      const at = chips.indexOf(doc.activeElement);
      if (at < 0) return;
      let to = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (at + 1) % chips.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (at - 1 + chips.length) % chips.length;
      if (to === null) return;
      e.preventDefault();
      chips[to].click();
    });
    return [group];
  }
  // The search: kept between draws (typing and focus survive the module drawing its row again); the entry's value goes
  // into the field only when it differs from the value given last time, never under the person's typing.
  function drawSearch(it) {
    const key = `search:${it.id}`;
    let k = kept.get(key);
    if (!k) {
      const form = el('form', 'mf-search', { role: 'search' });
      const input = el('input', 'mf-search-input', { type: 'search', autocomplete: 'off', enterkeyhint: 'search', maxlength: '200' });
      input.dataset.key = key;
      form.append(icon('magnifying-glass', 'mf-search-glyph'), input);
      k = { form, input, given: null, it };
      form.addEventListener('submit', (e) => { e.preventDefault(); fire({ id: k.it.id, value: input.value, submit: true }); });
      input.addEventListener('input', () => { k.it.value = input.value; fire({ id: k.it.id, value: input.value }); });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (input.value) { input.value = ''; k.it.value = ''; fire({ id: k.it.id, value: '' }); e.preventDefault(); e.stopPropagation(); return; }
        if (searching) { e.preventDefault(); stopSearching(); }
      });
      // Folded: a magnifier that opens the field over the whole row, with a button to close it again.
      k.open = button('mf-icon-btn mf-search-open', { label: it.label || 'Search', iconName: 'magnifying-glass', words: false });
      k.open.addEventListener('click', () => startSearching(input));
      const shut = button('mf-icon-btn mf-search-close', { label: 'Close search', iconName: 'xmark', words: false });
      shut.addEventListener('click', () => stopSearching());
      form.append(shut);
      kept.set(key, k);
    }
    k.it = it;
    k.input.placeholder = it.placeholder || 'Search';
    k.input.setAttribute('aria-label', it.label || 'Search');
    k.open.setAttribute('aria-label', it.label || 'Search');
    k.open.dataset.tip = it.label || 'Search';
    const value = it.value || '';
    if (k.given !== value) { k.given = value; if (k.input.value !== value) k.input.value = value; }
    return [k.form, k.open];
  }
  function chipsMenu(it, b) {
    openHostMenu(b, () => [
      { heading: it.label || 'Filters' },
      ...it.options.map((o) => ({ label: o.label, checked: Boolean(o.on), toggle: true, onPick: () => { o.on = !o.on; fire({ id: it.id, value: o.id, on: o.on }); redraw(); } })),
    ]);
  }
  function drawChips(it) {
    const group = el('div', 'mf-chips', { role: 'group', 'aria-label': it.label || 'Filters' });
    for (const o of it.options) {
      const c = el('button', `mf-chip${o.on ? ' is-on' : ''}`, { type: 'button', 'aria-pressed': String(Boolean(o.on)) });
      c.append(icon(o.on ? 'check' : 'plus', 'mf-chip-mark'), word(o.label));
      c.addEventListener('click', () => { o.on = !o.on; fire({ id: it.id, value: o.id, on: o.on }); redraw(`chip:${it.id}:${o.id}`); });
      c.dataset.key = `chip:${it.id}:${o.id}`;
      group.append(c);
    }
    const on = it.options.filter((o) => o.on).length;
    const menu = el('button', 'mf-chips-menu', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': `${it.label || 'Filters'}${on ? `, ${on} on` : ''}` });
    menu.append(icon('filter'), word(it.label || 'Filters'));
    if (on) menu.append(el('span', 'sdk-badge', { text: String(on) }));
    menu.addEventListener('click', () => chipsMenu(it, menu));
    return [group, menu];
  }
  // Filters: ONE button with a count of what is applied; its menu holds Clear filters, then the groups, each under a heading.
  // A group is single (one choice; the first option is "nothing applied") or switches (any number; each applied while it
  // is not its `default`, off unless given). The menu stays open. The button is kept between draws, so an open menu
  // stays under it while the module draws its row again; it reads the newest entry as it opens and as it is drawn again.
  const isOn = (o) => Boolean(o.on);
  const applied = (g) => (g.single ? (g.options.length && g.value !== g.options[0].id ? 1 : 0) : g.options.filter((o) => isOn(o) !== Boolean(o.default)).length);
  const filterCount = (it) => it.groups.reduce((n, g) => n + applied(g), 0);
  // A pick acts on the entry shown now (the module may have drawn its row again since the menu was drawn: the newest entry
  // is what the menu reads) and is kept until the menu closes, so an answer still on its way with an older state never shows
  // the previous choice as chosen.
  const nowGroup = (g) => { const k = kept.get('filters'); return (k && k.it.groups.find((x) => x.id === g.id)) || g; };
  const pick = (key, value) => { const k = kept.get('filters'); if (k) k.picks.set(key, value); };
  function filterItems(it) {
    const list = [{ label: 'Clear filters', icon: 'xmark', disabled: filterCount(it) === 0, keepOpen: true, onPick: () => {
      for (const g0 of it.groups) {
        const g = nowGroup(g0);
        if (g.single) { if (applied(g)) { g.value = g.options[0].id; pick(g.id, g.value); fire({ id: g.id, value: g.value }); } continue; }
        for (const o of g.options) if (isOn(o) !== Boolean(o.default)) { o.on = Boolean(o.default); pick(`${g.id}\n${o.id}`, o.on); fire({ id: g.id, value: o.id, on: o.on }); }
      }
      refreshCount();
    } }];
    for (const g of it.groups) {
      if (g.heading) list.push({ heading: g.heading });
      for (const o of g.options) {
        const look = { ...(o.icon ? { icon: o.icon } : {}), ...(TINT.test(o.tint || '') ? { tint: o.tint } : {}), ...(o.note ? { hint: o.note } : {}) };
        list.push(g.single
          ? { label: o.label, ...look, radio: true, checked: o.id === g.value, badge: o.count, keepOpen: true, onPick: () => { const n = nowGroup(g); n.value = o.id; pick(n.id, o.id); fire({ id: n.id, value: o.id }); refreshCount(); } }
          : { label: o.label, ...look, checked: isOn(o), toggle: true, badge: o.count, onPick: () => {
            const n = nowGroup(g);
            const on = n.options.find((x) => x.id === o.id) || o;
            on.on = !isOn(on);
            pick(`${n.id}\n${on.id}`, on.on);
            fire({ id: n.id, value: on.id, on: on.on });
            refreshCount();
          } });
      }
    }
    return list;
  }
  function refreshCount() {
    const k = kept.get('filters');
    if (!k) return;
    const n = filterCount(k.it);
    const c = k.b.querySelector('.sdk-badge');
    if (c) c.remove();
    if (n) k.b.append(el('span', 'sdk-badge', { text: String(n) }));
    k.b.setAttribute('aria-label', `${k.it.label || 'Filters'}${n ? `, ${n} applied` : ''}`);
  }
  function drawFilters(it) {
    let k = kept.get('filters');
    if (!k) {
      const b = el('button', 'mf-chips-menu mf-filters', { type: 'button', 'aria-haspopup': 'menu' });
      b.dataset.key = 'filters';
      b.append(icon('filter'), word(it.label || 'Filters'));
      k = { b, it, picks: new Map() };
      b.addEventListener('click', () => { k.picks.clear(); openHostMenu(b, () => filterItems(k.it)); });
      kept.set('filters', k);
    }
    // While the menu is open, the picks made in it hold over an entry drawn from an older state, and the menu is drawn again.
    const open = hostMenuOpen(k.b);
    if (open) {
      for (const [key, value] of k.picks) {
        const [gid, oid] = key.split('\n');
        const g = it.groups.find((x) => x.id === gid);
        if (!g) continue;
        if (oid === undefined) { if (g.single) g.value = value; } else { const o = g.options.find((x) => x.id === oid); if (o) o.on = value; }
      }
    } else k.picks.clear();
    k.it = it;
    k.b.querySelector('.mf-word').textContent = it.label || 'Filters';
    refreshCount();
    if (open) refreshHostMenu();
    return [k.b];
  }
  function drawButton(it) {
    const kind = it.kind === 'primary' || it.kind === 'icon' ? it.kind : 'secondary';
    const cls = kind === 'icon' ? 'mf-icon-btn' : `mf-btn mf-btn-${kind}`;
    const b = button(cls, { label: it.label, iconName: it.icon, regular: it.regular, words: kind !== 'icon', tip: kind === 'icon' ? it.tip || it.label : it.tip || null });
    b.dataset.key = `btn:${it.id}`;
    if (kind !== 'icon' && it.icon && it.label) b.dataset.tipFolded = it.label;
    if (kind !== 'icon' && it.tip) b.dataset.tipOwn = '';
    if (typeof it.on === 'boolean') { b.setAttribute('aria-pressed', String(it.on)); b.classList.toggle('is-on', it.on); }
    b.disabled = Boolean(it.disabled);
    b.addEventListener('click', (e) => { fire({ id: it.id, el: b }); if (e.detail === 0) keepFocusOn(b.dataset.key); });
    return [b];
  }
  // A button pressed with the keyboard whose module answers in its own place (a menu of choices, say: Budget's By day) gets the keyboard back when that
  // closes and the focus would fall to the page: while the person is in the button, the row or the module, then is nowhere,
  // the button (drawn again, found by its key) takes it. Given up once the focus goes anywhere else, or after a minute.
  let focusWatch = 0;
  function keepFocusOn(key) {
    const until = Date.now() + 60000;
    const id = ++focusWatch;
    const look = () => {
      if (id !== focusWatch || !root.isConnected || Date.now() > until) return;
      const a = doc.activeElement;
      if (!a || a === doc.body) {
        const b = toolbar.querySelector(`[data-key="${key}"]`);
        if (b && b.offsetParent && !b.disabled) b.focus({ preventScroll: true });
        return;
      }
      if (!root.contains(a)) return; // the person went elsewhere
      win.setTimeout(look, 100);
    };
    win.setTimeout(look, 100);
  }
  // The entries one control gives the "More" menu.
  function moreEntries(it, only) {
    if (it.type === 'button') return [{ label: it.label || it.tip, icon: it.icon, ...(it.regular ? { regular: true } : {}), ...(it.disabled ? { disabled: true } : {}), ...(typeof it.on === 'boolean' ? { checked: it.on } : {}), onPick: () => fire({ id: it.id, el: moreBtn }) }];
    if (it.type === 'title' || it.type === 'text') return [{ heading: it.text }];
    if (it.type === 'search') return [{ label: it.label || 'Search', icon: 'magnifying-glass', onPick: () => win.setTimeout(() => startSearching(it._input), 0) }];
    if (it.type === 'switch' || it.type === 'tabs' || it.type === 'quickset') {
      return [{ heading: it.label || (it.type === 'switch' ? 'Tools' : it.type === 'quickset' ? 'Show' : 'Tabs') }, ...it.options.filter((o) => !only || only.includes(o.id)).map((o) => ({
        label: o.label, ...(o.icon ? { icon: o.icon } : {}), ...(o.regular ? { regular: true } : {}), radio: true, checked: o.id === it.value, badge: o.count,
        onPick: () => { it.value = o.id; fire({ id: it.id, value: o.id }); redraw(); },
      }))];
    }
    if (it.type === 'filters') return filterItems(it);
    if (it.type === 'chips') {
      return [{ heading: it.label || 'Filters' }, ...it.options.map((o) => ({
        label: o.label, checked: Boolean(o.on), toggle: true,
        onPick: () => { o.on = !o.on; fire({ id: it.id, value: o.id, on: o.on }); redraw(); },
      }))];
    }
    return [];
  }
  const moreBtn = button('mf-icon-btn mf-more', { label: 'More', iconName: 'ellipsis', words: false });
  moreBtn.dataset.key = 'more';
  moreBtn.setAttribute('aria-haspopup', 'menu');
  moreBtn.addEventListener('click', () => openHostMenu(moreBtn, () => {
    const list = [];
    for (const it of entries) if (it._els && it._els[0].classList.contains('is-moved')) list.push(...moreEntries(it)); else if (it._folded && it._folded.length) list.push(...moreEntries(it, it._folded));
    return list;
  }));
  const spacer = el('span', 'mf-spacer', { 'aria-hidden': 'true' });

  function startSearching(input) {
    if (!input) return;
    searching = true;
    toolbar.classList.add('is-searching');
    input.focus();
  }
  function stopSearching() {
    searching = false;
    toolbar.classList.remove('is-searching');
    fit();
    const open = toolbar.querySelector('.mf-search-open');
    if (open && open.offsetParent) open.focus();
    else if (moreBtn.offsetParent) moreBtn.focus();
  }

  function drawToolbar() {
    const active = doc.activeElement;
    if (hostMenuOpen() && toolbar.contains(active) && !(active && active.closest('.mf-search, .mf-filters'))) closeHostMenu();
    // The row has two regions. The start group: everything but search and filters, left-aligned in the order given. The end
    // group: search, then the Filters button, always last, in those slots, at the same distance from the right edge. A
    // 'spacer' entry is not needed (the gap between the groups is drawn here) and is ignored.
    const start = [];
    const end = [];
    const tail = []; // the right zone (`zone: 'end'`, the host page's own items): after the search and Filters, at the far right
    const used = new Set();
    for (const it of entries) {
      let els = [];
      if (it.type === 'switch') els = drawSwitch(it);
      else if (it.type === 'tabs') els = drawTabs(it);
      else if (it.type === 'search') { els = drawSearch(it); it._input = els[0].querySelector('input'); used.add(`search:${it.id}`); }
      else if (it.type === 'chips') els = drawChips(it);
      else if (it.type === 'filters') { els = drawFilters(it); used.add('filters'); }
      else if (it.type === 'quickset') els = drawQuickset(it);
      else if (it.type === 'button') els = drawButton(it);
      else if (it.type === 'title') els = [el('span', 'mf-tb-title', { text: it.text, 'data-tip': it.text, 'data-tip-if-truncated': '', tabindex: '0' })];
      else if (it.type === 'text') els = [el('span', 'mf-tb-text', { text: it.text })];
      it._els = els;
      if (!els.length) continue;
      (it.zone === 'end' ? tail : it.type === 'search' || it.type === 'filters' ? end : start).push({ it, els });
    }
    end.sort((x, y) => (x.it.type === 'search' ? 0 : 1) - (y.it.type === 'search' ? 0 : 1));
    for (const [key, k] of kept) {
      if (used.has(key)) continue;
      const elsOf = key === 'filters' ? [k.b] : [k.form, k.open];
      if (hostMenuOpen(elsOf[0])) closeHostMenu();
      for (const e of elsOf) e.remove();
      kept.delete(key);
    }
    // In order; a kept element is moved only when it is not already where it goes (moving a focused field would blur it).
    for (const g of tail) for (const e of g.els) e.classList.add('mf-zone-end'); // the right zone: the row's last controls (tools/check-conformance.mjs)
    const parts = [...start.flatMap((g) => g.els), moreBtn, spacer, ...end.flatMap((g) => g.els), ...tail.flatMap((g) => g.els)];
    const keep = new Set(parts);
    for (const child of [...toolbar.childNodes]) if (!keep.has(child)) child.remove();
    parts.forEach((p, at) => { if (toolbar.childNodes[at] !== p) toolbar.insertBefore(p, toolbar.childNodes[at] || null); });
    toolbar.hidden = entries.length === 0;
    if (searching) toolbar.classList.add('is-searching');
  }
  // A switch too wide for the row folds only its last choices into "More": as many as fit stay, the chosen one always stays, the
  // folded ones are chosen from More (which shows the current one). Nothing fits but the chosen one: false, and the caller moves
  // the whole switch.
  function unfoldChoices(it) {
    it._folded = [];
    for (const e of it._els || []) for (const b of e.querySelectorAll ? e.querySelectorAll('.mf-switch-btn.is-folded') : []) { b.classList.remove('is-folded'); b.hidden = false; }
  }
  function foldChoices(it, over) {
    const group = it._els && it._els[0];
    const parts = group && group.querySelectorAll ? [...group.querySelectorAll('.mf-switch-btn')] : [];
    if (parts.length < 2) return false;
    for (let at = parts.length - 1; at >= 0; at -= 1) {
      const b = parts[at];
      if (b.getAttribute('aria-checked') === 'true') continue;
      b.classList.add('is-folded');
      b.hidden = true;
      it._folded.unshift(it.options[at].id);
      if (!over()) return true;
    }
    unfoldChoices(it);
    return false;
  }
  // Fit the row: the fold steps in order, then whole controls into "More", until nothing is cut.
  function fit() {
    frameReq = 0;
    if (!root.isConnected) return;
    fitTitlebar();
    if (toolbar.hidden) return;
    for (const f of FOLDS) toolbar.classList.remove(`mf-fold-${f}`);
    for (const it of entries) for (const e of it._els || []) e.classList.remove('is-moved');
    for (const it of entries) unfoldChoices(it);
    moreBtn.classList.remove('is-shown');
    // A button that asks for it is always in "More".
    for (const it of entries) {
      if (it.type !== 'button' || !it.more) continue;
      for (const e of it._els || []) e.classList.add('is-moved');
      moreBtn.classList.add('is-shown');
    }
    const over = () => overflows(toolbar);
    const wasSearching = toolbar.classList.contains('is-searching');
    toolbar.classList.remove('is-searching');
    for (const f of FOLDS) {
      if (!over()) break;
      toolbar.classList.add(`mf-fold-${f}`);
    }
    // The words a folded control lost are its tooltip.
    const iconic = (b) => {
      const w = b.querySelector('.mf-word');
      return Boolean(w && b.querySelector('i') && w.offsetParent === null);
    };
    for (const b of toolbar.querySelectorAll('.mf-btn, .mf-switch-btn')) {
      if (b.classList.contains('mf-switch-btn') && !b.querySelector('.mf-word')) continue; // an icon-only choice keeps its tooltip
      const name = b.getAttribute('aria-label');
      if (b.dataset.tipOwn !== undefined) continue; // its own tooltip, folded or not
      if (iconic(b)) b.dataset.tip = name; else delete b.dataset.tip;
    }
    if (over()) {
      moreBtn.classList.add('is-shown');
      const order = entries
        .map((it, at) => ({ it, at, rank: it.type === 'button' ? MOVE[it.kind === 'primary' || it.kind === 'icon' ? it.kind : 'secondary'] : MOVE[it.type] }))
        .filter((x) => x.rank && !x.it.pin && x.it._els && x.it._els.length) // a pinned item (the right zone's switch) is never moved
        .sort((a, b) => a.rank - b.rank || b.at - a.at);
      for (const { it } of order) {
        if (!over()) break;
        if (it.type === 'switch' && foldChoices(it, over)) continue; // only its last choices go into More
        for (const e of it._els) e.classList.add('is-moved');
      }
    }
    if (wasSearching) toolbar.classList.add('is-searching');
  }
  const later = () => { if (!frameReq) frameReq = win.requestAnimationFrame(fit); };
  function redraw(focusKey = null) {
    const active = doc.activeElement;
    const key = focusKey || (active && toolbar.contains(active) ? active.dataset.key : null);
    drawToolbar();
    fit();
    if (key && !(active && active.isConnected && toolbar.contains(active) && active.dataset.key === key)) {
      const again = key.startsWith('tab:')
        ? toolbar.querySelector('.mf-tab[aria-selected="true"]')
        : toolbar.querySelector(`[data-key="${key}"]`);
      if (again && again.offsetParent && !again.disabled) again.focus({ preventScroll: true });
    }
  }

  // ---- 3. the content ----
  function setContent(node, { flush = opts.flush, empty = opts.empty } = {}) {
    content.textContent = '';
    content.classList.toggle('mf-content-flush', Boolean(flush));
    if (node) { content.append(node); return; }
    const e = empty || {};
    const box = el('div', 'mf-empty');
    if (e.icon) box.append(el('span', 'mf-empty-icon', { 'aria-hidden': 'true' }));
    if (e.icon) box.firstChild.append(icon(e.icon));
    box.append(el('p', 'mf-empty-title', { text: e.title || 'Nothing here yet' }));
    if (e.text) box.append(el('p', 'mf-empty-text', { text: e.text }));
    content.append(box);
  }

  // ---- 4. the status bar ----
  // { text, lead, items, title }: the words at the start (`text`, or `lead`, its parts [{ text, icon?, title?, tone? }] with
  // a dot between), cut with an ellipsis when the bar is too narrow, and the items at the end [{ text, icon?, tone?, title? }],
  // never cut. `title` is the bar's tooltip (else the words). Nothing in it is a button. Hidden while it holds nothing.
  function setStatus(s) {
    status.textContent = '';
    const st = s || {};
    const items = Array.isArray(st.items) ? st.items : [];
    const lead = Array.isArray(st.lead) ? st.lead : [];
    status.hidden = !st.text && items.length === 0 && lead.length === 0;
    const words = lead.length ? lead.map((p) => p.text).join(' · ') : st.text || '';
    const left = el('span', 'mf-status-text', { 'data-tip': st.title || words, 'data-tip-if-truncated': '' });
    if (lead.length) {
      lead.forEach((p, at) => {
        if (at) left.append(el('span', 'mf-status-sep', { text: ' · ', 'aria-hidden': 'true' }));
        const part = el('span', `mf-status-part${p.tone ? ` mf-tone-${p.tone}` : ''}`, { title: p.title && p.title !== p.text ? p.title : null });
        if (p.icon) part.append(icon(p.icon), ' ');
        part.append(p.text);
        left.append(part);
      });
    } else left.textContent = words;
    const right = el('span', 'mf-status-items');
    for (const it of items) {
      const s1 = el('span', `mf-status-item${it.tone ? ` mf-tone-${it.tone}` : ''}`, { title: it.title && it.title !== it.text ? it.title : null });
      if (it.icon) s1.append(icon(it.icon));
      s1.append(el('span', '', { text: it.text }));
      right.append(s1);
    }
    status.append(left, right);
  }

  setTitle(opts.title, opts.icon);
  drawTitlebar();
  entries = Array.isArray(opts.toolbar) ? opts.toolbar : [];
  drawToolbar();
  setContent(opts.content || null);
  setStatus(opts.status);
  if (typeof win.ResizeObserver === 'function') {
    observer = new win.ResizeObserver(later);
    observer.observe(root);
  }

  return {
    el: root,
    content,
    titlebar: head,
    setTitle,
    titlebarMenu,
    // The title bar's options, changed in part ({ actions }, { add }, ...) and drawn again.
    setTitlebar(patch) { tbOpts = { ...tbOpts, ...(patch || {}) }; drawTitlebar(); fit(); },
    setToolbar(list) { entries = Array.isArray(list) ? list : []; redraw(); },
    setContent,
    setStatus,
    // A polite read-out for a screen reader (the status bar's words once they have been still a moment: module-host.js).
    announce(text) { live.textContent = String(text || ''); },
    fit,
    destroy() {
      if (observer) observer.disconnect();
      observer = null;
      if (hostMenuOpen() && root.contains(doc.activeElement)) closeHostMenu();
      for (const k of kept.values()) if (hostMenuOpen(k.b || k.form)) closeHostMenu();
    },
  };
}
