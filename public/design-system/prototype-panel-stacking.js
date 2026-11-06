// The Panel stacking section of the Prototype (plan-panel-stacking.md, step 0; GitHub #387): two or three docked modules sharing one
// column of the canvas, one above the other, each in its own frame, with a divider between them and a collapse on each (Option B,
// Thomas's decision 1). Drawn for Thomas to judge and lock before anything is built. Design-process only: nothing here ships, nothing is
// fetched, every module's content is made up. The modules are the real module frame (createModuleFrame, docked and floating), their
// menus the host's own (openHostMenu, with the frame's own entries from titlebarMenu()), the docked limit the real dockLimit
// (public/snap-grid.js). What is new (the stack, the divider, the drop zones, the new menu entries) is drawn here, and what is real
// in this drawing is the drag of a title bar, the drag and the keys of a divider, the collapse buttons and every menu entry.
import { createModuleFrame } from '/module-frame.js';
import { openHostMenu } from '/host-menu.js';
import { dockLimit, FLEX_MIN } from '/snap-grid.js';

const D = document;
const TITLE_H = 36; // --mf-title-h
const CONTENT_MIN = 120; // decision 3's number: a section never gets less than its title bar plus this
const SECTION_MIN = TITLE_H + CONTENT_MIN;
const DIV_H = 8; // the divider's band
const MAX = 3; // decision 3
const STEP = 16;
const BIG_STEP = 64;
const THRESHOLD = 6; // the title bar drag's threshold, as wireReorder()
const COL_W = 300;

const h = (tag, cls, text) => { const e = D.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fa = (name, regular = false) => { const i = h('i', `fa-${regular ? 'regular' : 'solid'} fa-${name} fa-fw`); i.setAttribute('aria-hidden', 'true'); return i; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const listWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ---- the sample modules: short ones (Polls with two open polls, To-do with four tasks, Budget's summary) and tall ones ----
function todoBody() {
  const ul = h('ul', 'pps-list');
  for (const [words, note, done] of [['Book the ferry to Hydra', 'Fri', false], ['Pay the hotel deposit', 'Done', true], ['Pick up the hire car', 'Sat', false], ['Buy travel insurance', 'Mon', false]]) {
    const li = h('li', `pps-task${done ? ' is-done' : ''}`);
    li.append(fa(done ? 'square-check' : 'square', !done), h('span', 'pps-task-words', words), h('span', 'pps-small', note));
    ul.append(li);
  }
  return ul;
}
function pollsBody() {
  const box = h('div', 'pps-polls');
  for (const p of [
    { q: 'Dinner on Saturday?', opts: [['The grill by the port', 4], ['The fish place', 2]], note: '6 votes, closes Friday' },
    { q: 'Boat trip: morning or afternoon?', opts: [['Morning', 3], ['Afternoon', 2]], note: '5 votes, closes Thursday' },
  ]) {
    const poll = h('div', 'pps-poll');
    poll.append(h('p', 'pps-poll-q', p.q));
    const total = p.opts.reduce((a, o) => a + o[1], 0);
    for (const [words, n] of p.opts) {
      const row = h('div', 'pps-opt');
      const meter = h('span', 'pps-meter'); const fill = h('span'); fill.style.width = `${Math.round((100 * n) / total)}%`; meter.append(fill);
      row.append(h('span', 'pps-row-words', words), h('span', 'pps-small', `${n}`), meter);
      poll.append(row);
    }
    poll.append(h('span', 'pps-small', p.note));
    box.append(poll);
  }
  return box;
}
function budgetBody() {
  const box = h('div', 'pps-budget');
  box.append(h('p', 'pps-big', '€1,240 spent of €2,000'));
  const meter = h('span', 'pps-meter'); const fill = h('span'); fill.style.width = '62%'; meter.append(fill);
  box.append(meter);
  const ul = h('ul', 'pps-list');
  for (const [icon, words, n] of [['bed', 'Lodging', '€640'], ['plane', 'Travel', '€420'], ['utensils', 'Food', '€180']]) {
    const li = h('li', 'pps-row'); li.append(fa(icon), h('span', 'pps-row-words', words), h('span', 'pps-small', n)); ul.append(li);
  }
  box.append(ul);
  return box;
}
const rowsBody = (rows) => () => {
  const ul = h('ul', 'pps-list');
  for (const [icon, words, note] of rows) { const li = h('li', 'pps-row'); li.append(fa(icon), h('span', 'pps-row-words', words), h('span', 'pps-small', note)); ul.append(li); }
  return ul;
};
const DAYS = [['plane-arrival', 'Arrive in Athens', 'Fri 12'], ['ship', 'Ferry to Hydra', 'Sat 13'], ['person-hiking', 'Walk to Kamini', 'Sun 14'], ['umbrella-beach', 'Beach day', 'Mon 15'], ['ship', 'Ferry to Poros', 'Tue 16'], ['utensils', 'Cooking class', 'Wed 17'], ['plane-departure', 'Fly home', 'Thu 18']];
const EVENTS = [['clock', 'Ferry check-in', '08:30'], ['clock', 'Lunch at the harbour', '13:00'], ['clock', 'Sunset walk', '19:30'], ['clock', 'Dinner booking', '21:00']];
const RESEARCH = [['link', 'Hydra ferry times', 'Link'], ['note-sticky', 'No cars on the island', 'Note'], ['link', 'Best beaches on Poros', 'Link']];
const PLACES = [['utensils', 'The grill by the port', 'Food'], ['umbrella-beach', 'Vlychos beach', 'Nature'], ['landmark', 'Historical Archives', 'Sights']];
const quick = (a, b) => [{ type: 'quickset', id: 'show', label: 'Show', value: 'a', options: [{ id: 'a', label: a[0], count: a[1] }, { id: 'b', label: b[0], count: b[1] }] }];
const MODS = {
  todo: { name: 'To-do', icon: 'list-check', tint: 'green', stack: true, add: 'Add a to-do', body: todoBody, toolbar: () => quick(['Open', 3], ['Done', 1]), status: { text: '4 tasks, 1 done' } },
  polls: { name: 'Polls', icon: 'square-poll-vertical', tint: 'purple', stack: true, add: 'Start a poll', body: pollsBody, toolbar: () => quick(['Open', 2], ['Closed', 3]), status: { text: '2 open' } },
  budget: { name: 'Budget', icon: 'wallet', tint: 'gold', stack: true, add: 'Add a cost', body: budgetBody, toolbar: () => [{ type: 'switch', id: 'view', label: 'View', value: 's', options: [{ id: 's', label: 'Summary', icon: 'chart-pie' }, { id: 'l', label: 'Costs', icon: 'list' }] }], status: { text: '62% spent' } },
  planner: { name: 'Planner', icon: 'suitcase-rolling', tint: 'blue', stack: true, add: 'Add a stop', body: rowsBody(DAYS), toolbar: () => [{ type: 'switch', id: 'view', label: 'View', value: 'd', options: [{ id: 'd', label: 'Days', icon: 'list' }, { id: 'w', label: 'Week', icon: 'calendar-week' }] }, { type: 'title', text: '12 to 18 June' }], status: { text: '7 days' } },
  research: { name: 'Research', icon: 'book-open', tint: 'teal', stack: true, add: 'Add a research note', body: rowsBody(RESEARCH), toolbar: () => [], status: { text: '3 saved' } },
  places: { name: 'Places', icon: 'location-dot', tint: 'orange', stack: true, add: 'Add a place', body: rowsBody(PLACES), toolbar: () => [], status: { text: '3 places' } },
  calendar: { name: 'Calendar', icon: 'calendar-days', tint: 'red', stack: false, composite: true, add: 'Add an event', body: rowsBody(EVENTS), toolbar: () => [{ type: 'switch', id: 'view', label: 'View', value: 'd', options: [{ id: 'd', label: 'Day', icon: 'calendar-day' }, { id: 'w', label: 'Week', icon: 'calendar-week' }] }], status: { text: 'Saturday 13 June' } },
};
const nameOf = (id) => MODS[id].name;

// ---- the arithmetic (would be pure functions in public/layouts.js) ----
// The heights of a stack's sections in a column `total` pixels tall: the collapsed ones (the person's, `folded`, and those the short
// canvas collapsed by itself, `auto`) are their title bar; the open ones share what is left by their shares `h`, none under SECTION_MIN.
// When the open ones cannot all have SECTION_MIN, the lowest open one collapses by itself, then the next, never the one the person opened
// last (`keep`), and never the last one open.
function splitHeights(total, col) {
  const n = col.ids.length;
  const avail = total - DIV_H * (n - 1);
  const auto = col.ids.map(() => false);
  const shut = (i) => col.folded[i] || auto[i];
  for (;;) {
    const open = col.ids.map((_, i) => i).filter((i) => !shut(i));
    const rest = avail - (n - open.length) * TITLE_H;
    if (open.length <= 1 || rest >= open.length * SECTION_MIN) break;
    const next = [...open].reverse().find((i) => i !== col.keep);
    auto[next ?? open[open.length - 1]] = true;
  }
  const open = col.ids.map((_, i) => i).filter((i) => !shut(i));
  const rest = avail - (n - open.length) * TITLE_H;
  const sum = open.reduce((a, i) => a + col.h[i], 0) || 1;
  const px = col.ids.map((_, i) => (shut(i) ? TITLE_H : (rest * col.h[i]) / sum));
  if (open.length > 1 && rest >= open.length * SECTION_MIN) {
    for (let pass = 0; pass < 4; pass += 1) {
      const low = open.filter((i) => px[i] < SECTION_MIN);
      if (!low.length) break;
      const need = low.reduce((a, i) => a + (SECTION_MIN - px[i]), 0);
      const give = open.filter((i) => px[i] > SECTION_MIN);
      const spare = give.reduce((a, i) => a + (px[i] - SECTION_MIN), 0) || 1;
      for (const i of low) px[i] = SECTION_MIN;
      for (const i of give) px[i] -= (need * (px[i] - SECTION_MIN)) / spare;
    }
  }
  return { px: px.map((v) => Math.round(v)), auto, open };
}
const equalize = (col) => { col.h = col.ids.map(() => 1 / col.ids.length); };
const clone = (cols) => cols.map((c) => ({ ids: [...c.ids], w: c.w, h: c.h ? [...c.h] : c.ids.map(() => 1 / c.ids.length), folded: c.folded ? [...c.folded] : c.ids.map(() => false), keep: c.keep }));

// ---- the host's menu, held open in a picture (host-menu.js's classes and rows, static) ----
function heldMenu(items, { openRow = null } = {}) {
  const menu = h('div', 'host-menu pps-held');
  menu.setAttribute('aria-hidden', 'true');
  menu.inert = true;
  for (const it of items) {
    if (it.divider) { menu.append(h('div', 'host-menu-divider')); continue; }
    if (it.heading) { menu.append(h('div', 'host-menu-heading', it.heading)); continue; }
    if (it.element) { const r = h('div', 'host-menu-row'); r.append(it.element); menu.append(r); continue; }
    const b = h('button', 'host-menu-item');
    b.type = 'button'; b.tabIndex = -1; b.disabled = Boolean(it.disabled);
    if (it.danger) b.classList.add('danger');
    if (typeof it.checked === 'boolean') { b.setAttribute('role', it.radio ? 'menuitemradio' : 'menuitemcheckbox'); b.setAttribute('aria-checked', String(it.checked)); }
    if (it.icon) b.append(fa(String(it.icon).replace(/^fa-solid fa-/, ''), it.regular));
    b.append(h('span', 'host-menu-label', it.label));
    if (it.toggle) b.append(h('span', 'host-menu-switch'));
    if (it.items) { b.classList.add('host-menu-category'); if (it.label === openRow) b.classList.add('open'); const c = fa('chevron-right'); c.classList.add('host-menu-caret'); b.append(c); }
    if (it.hint) b.append(h('span', 'host-menu-hint', it.hint));
    menu.append(b);
  }
  return menu;
}
// A menu and the flyout of one of its rows, side by side, the flyout level with that row.
function heldPair(items, rowLabel, flyItems) {
  const box = h('div', 'pps-menus');
  const a = heldMenu(items, { openRow: rowLabel });
  const b = heldMenu(flyItems);
  box.append(a, b);
  requestAnimationFrame(() => {
    const row = [...a.querySelectorAll('.host-menu-item')].find((x) => x.textContent.startsWith(rowLabel));
    if (row) b.style.marginTop = `${Math.max(0, row.getBoundingClientRect().top - a.getBoundingClientRect().top - 4)}px`;
  });
  return box;
}

// ---- one drawing: a canvas (and maybe the call and chat column beside it) ----
// spec: { w, h, cols: [{ ids, w?, h?, folded? }], floats: [{ id, x, y, w, h }], side, styles: { divider, fold, zones, pick }, drag (title bars
// can be dragged), note (a <p> for the note line), readout (a <p>), menus (the stack entries in the frames' menus) }.
function stackCanvas(spec) {
  const v = {
    w: spec.w, h: spec.h, side: spec.side || 0, cols: clone(spec.cols), floats: (spec.floats || []).map((f) => ({ ...f })),
    styles: { divider: 'A', fold: 'A', zones: 'A', pick: 'A', ...(spec.styles || {}) },
    frames: [], secs: new Map(), colEls: [], divs: [],
  };
  const start = { cols: clone(spec.cols), floats: (spec.floats || []).map((f) => ({ ...f })) };
  const wrap = h('div', 'pps-wrap');
  const screen = h('div', 'pps-screen');
  const canvas = h('div', 'pps-canvas');
  canvas.style.width = `${v.w}px`;
  canvas.style.height = `${v.h}px`;
  const zones = h('div', 'pps-zones');
  zones.setAttribute('aria-hidden', 'true');
  screen.append(canvas);
  wrap.append(screen);
  if (v.side) screen.append(sideColumn(v.side, v.h));
  const limit = () => dockLimit(v.w);
  const colOf = (id) => v.cols.findIndex((c) => c.ids.includes(id));
  const say = (text) => { if (spec.note) spec.note.textContent = text; };

  // Why `id` cannot go into column `c` as a section, or ''.
  function refusal(id, c) {
    const col = v.cols[c];
    if (!MODS[id].stack) return `${nameOf(id)} can't be in a stack.`;
    if (!MODS[col.ids[0]].stack) return `${nameOf(col.ids[0])} can't hold a stack.`;
    if (colOf(id) === c) return '';
    if (col.ids.length >= MAX) return 'A stack holds three modules at most.';
    if ((col.ids.length + 1) * SECTION_MIN + col.ids.length * DIV_H > v.h) return 'The canvas is too short to stack here.';
    return '';
  }

  // Why `id` cannot have a column of its own now, or ''.
  function ownWhy(id) {
    const c = colOf(id);
    const extra = c < 0 || v.cols[c].ids.length > 1 ? 1 : 0;
    return v.cols.length + extra > limit() ? 'The window is too narrow for another column.' : '';
  }

  // ---- drawing ----
  function render() {
    for (const f of v.frames) f.destroy?.();
    v.frames = []; v.secs.clear(); v.colEls = []; v.divs = [];
    canvas.textContent = '';
    canvas.style.gridTemplateColumns = v.cols.map((c, i) => (i === 0 ? `minmax(${FLEX_MIN}px, 1fr)` : `${c.w || COL_W}px`)).join(' ') || '1fr';
    v.cols.forEach((col, c) => {
      const el = h('div', 'pps-col');
      el.dataset.col = String(c);
      if (col.ids.length === 1) {
        const f = docked(col.ids[0]);
        el.append(f.el);
        v.secs.set(col.ids[0], el);
      } else {
        const st = h('div', 'pps-stack');
        st.setAttribute('role', 'group');
        st.setAttribute('aria-label', `Stacked: ${col.ids.map(nameOf).join(', ')}`);
        col.ids.forEach((id, i) => {
          if (i) { const dv = divider(col, i - 1); st.append(dv); v.divs.push({ dv, col, i: i - 1 }); }
          const sec = h('div', 'pps-sec');
          sec.dataset.id = id;
          sec.dataset.fold = v.styles.fold;
          const f = docked(id, { col, i });
          sec.append(f.el);
          st.append(sec);
          v.secs.set(id, sec);
        });
        el.append(st);
      }
      canvas.append(el);
      v.colEls.push(el);
    });
    if (!v.cols.length) canvas.append(h('div', 'pps-empty-col', 'Nothing docked'));
    for (const fl of v.floats) {
      const box = h('div', 'pps-float');
      Object.assign(box.style, { left: `${fl.x}px`, top: `${fl.y}px`, width: `${fl.w}px`, height: `${fl.h}px` });
      const f = frame(fl.id, { variant: 'window', std: () => ({ dock: v.cols.length >= limit() ? { disabled: true, hint: 'The window is too narrow for another column' } : true, window: false, popout: true }) });
      box.append(f.el);
      canvas.append(box);
    }
    canvas.append(zones);
    relayout();
  }
  // The heights, the collapse state and the dividers' values, without drawing the frames again (a divider drag calls this per move).
  function relayout() {
    const words = [];
    for (const col of v.cols) {
      if (col.ids.length < 2) continue;
      const { px, auto } = splitHeights(v.h, col);
      col.px = px; col.auto = auto;
      col.ids.forEach((id, i) => {
        const sec = v.secs.get(id);
        if (!sec) return;
        const shut = col.folded[i] || auto[i];
        sec.style.height = `${px[i]}px`;
        sec.classList.toggle('pps-folded', shut);
        const b = sec.querySelector('.pps-fold');
        if (b) {
          if (!shut && openCount(col) === 1) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
          b.setAttribute('aria-expanded', String(!shut));
          const t = `${shut ? 'Expand' : 'Collapse'} ${nameOf(id)}`;
          b.setAttribute('aria-label', t); b.title = t;
          b.querySelector('i').className = `fa-solid fa-${shut ? 'chevron-right' : 'chevron-down'} fa-fw`;
        }
        words.push(shut ? `${nameOf(id)} collapsed${auto[i] && !col.folded[i] ? ' by itself (too short)' : ''}` : `${nameOf(id)} ${px[i]} px${Math.abs(px[i] - SECTION_MIN) <= 1 ? ' (the least: title bar 36 + 120 of the section; about 56 of content once toolbar and status are counted)' : px[i] < SECTION_MIN ? ' (under the least: the last one open, which cannot collapse)' : ''}`);
      });
    }
    for (const { dv, col, i } of v.divs) {
      const a = col.px[i]; const b = col.px[i + 1];
      const off = col.folded[i] || col.auto[i] || col.folded[i + 1] || col.auto[i + 1];
      dv.classList.toggle('pps-div-off', Boolean(off));
      // Next to a collapsed section the divider moves nothing: it is a plain line, with no value (a value there would be outside its range).
      if (off) { for (const k of ['tabindex', 'aria-disabled', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow']) dv.removeAttribute(k); continue; }
      dv.tabIndex = 0;
      const lo = Math.round((100 * SECTION_MIN) / (a + b));
      dv.setAttribute('aria-valuemin', String(Math.min(lo, 50)));
      dv.setAttribute('aria-valuemax', String(Math.max(100 - lo, 50)));
      dv.setAttribute('aria-valuenow', String(Math.round((100 * a) / (a + b))));
    }
    if (spec.readout) spec.readout.textContent = words.length ? words.join(' · ') : 'No stack here.';
  }

  // ---- a frame ----
  function frame(id, { variant = 'docked', std = { window: true, popout: true }, col = null, i = -1 } = {}) {
    const m = MODS[id];
    const f = createModuleFrame({
      variant, title: m.name, icon: m.icon, tint: m.tint,
      titlebar: { add: { label: m.add }, close: true, standard: std },
      toolbar: m.toolbar(), content: m.body(), status: m.status,
      onAction: (e) => onAction(id, e),
    });
    f.el.dataset.id = id;
    v.frames.push(f);
    if (spec.menus !== false) {
      f.el.addEventListener('click', (e) => {
        const b = e.target.closest('.mf-titlebar-menu');
        if (!b || !f.el.contains(b)) return;
        e.stopPropagation(); e.preventDefault();
        openHostMenu(b, () => menuFor(id, f, b));
      }, true);
    }
    if (col) {
      const fb = h('button', 'mf-icon-btn mf-titlebar-btn pps-fold');
      fb.type = 'button';
      fb.append(fa('chevron-down'));
      fb.addEventListener('click', () => { const r = toggleFold(id); if (r !== null) say(''); });
      f.titlebar.prepend(fb);
      const sum = h('span', 'pps-fold-sum', m.status.text);
      f.titlebar.querySelector('.mf-titlebar-title')?.after(sum);
    }
    return f;
  }
  function docked(id, place) {
    const f = frame(id, place);
    if (spec.drag) wireDrag(f, id);
    return f;
  }
  function onAction(id, e) {
    if (e.area !== 'titlebar') return;
    if (e.id === 'close') closeModule(id);
    else if (e.id === 'window') { const c = colOf(id); if (c < 0) return; takeOut(id); v.floats.push({ id, x: Math.max(8, v.w - 340), y: 40, w: 300, h: 280 }); render(); say(`${nameOf(id)} is a window now.`); }
    else if (e.id === 'dock') {
      if (v.cols.length >= limit()) { say('The window is too narrow for another column.'); return; }
      v.floats = v.floats.filter((x) => x.id !== id); v.cols.push({ ids: [id], w: COL_W, h: [1], folded: [false] }); render(); say(`${nameOf(id)} has its own column.`);
    } else if (e.id === 'popout') say(`${nameOf(id)} would open in its own window and leave the stack (not drawn here).`);
  }
  // Take `id` out of its column; a column left empty goes, a stack left with one module is an ordinary column (decision 8).
  function takeOut(id) {
    const c = colOf(id);
    if (c < 0) { v.floats = v.floats.filter((x) => x.id !== id); return { c: -1, gone: false, left: null }; }
    const col = v.cols[c];
    const i = col.ids.indexOf(id);
    col.ids.splice(i, 1); col.h.splice(i, 1); col.folded.splice(i, 1);
    if (col.keep !== undefined) col.keep = undefined;
    const s = col.h.reduce((a, x) => a + x, 0) || 1;
    col.h = col.h.map((x) => x / s);
    if (!col.ids.length) { v.cols.splice(c, 1); return { c, gone: true, left: null }; }
    return { c, gone: false, left: col.ids.length === 1 ? col.ids[0] : null };
  }
  function closeModule(id) {
    const r = takeOut(id);
    render();
    say(r.left ? `${nameOf(id)} was closed. ${nameOf(r.left)} has its own column again.` : `${nameOf(id)} was closed.`);
  }
  // Put `id` into column `c`, above or below `target`.
  function stackInto(id, c, target, pos) {
    const why = refusal(id, c);
    if (why) { say(why); return false; }
    const targetCol = v.cols[c];
    const r = takeOut(id);
    const tc = v.cols.indexOf(targetCol);
    const col = v.cols[tc];
    col.ids.splice(col.ids.indexOf(target) + (pos === 'below' ? 1 : 0), 0, id);
    col.folded = col.ids.map((x) => (x === id ? false : col.folded[col.ids.filter((y) => y !== id).indexOf(x)] || false));
    equalize(col); // decision 6: a new stack starts with equal heights
    render();
    say(`${nameOf(id)} was stacked ${pos === 'above' ? 'above' : 'under'} ${nameOf(target)}.${r.left && r.left !== target ? ` ${nameOf(r.left)} has its own column again.` : ''}`);
    return true;
  }
  // Give `id` a column of its own at `index` (in the columns as they are before it is taken out).
  function ownColumn(id, index) {
    const c = colOf(id);
    const wasStacked = c >= 0 && v.cols[c].ids.length > 1;
    const why = ownWhy(id);
    if (why) { say(why); return false; }
    const before = v.cols[index] || null;
    const r = takeOut(id);
    let at = before ? v.cols.indexOf(before) : v.cols.length;
    if (at < 0) at = v.cols.length;
    v.cols.splice(at, 0, { ids: [id], w: COL_W, h: [1], folded: [false] });
    render();
    say(wasStacked || c < 0 ? `${nameOf(id)} has its own column again.${r.left ? ` So has ${nameOf(r.left)}.` : ''}` : '');
    return true;
  }
  // Proposal: the last section open in a stack cannot be collapsed (the rest of the column would be empty).
  const openCount = (col) => col.ids.filter((_, k) => !(col.folded[k] || (col.auto && col.auto[k]))).length;
  const LAST_OPEN = 'The last open one stays open.';
  function toggleFold(id) {
    const c = colOf(id); const col = v.cols[c]; const i = col.ids.indexOf(id);
    const shut = col.folded[i] || (col.auto && col.auto[i]);
    if (!shut && openCount(col) === 1) { say(`${nameOf(id)} can't be collapsed. ${LAST_OPEN}`); return null; }
    if (shut) { col.folded[i] = false; col.keep = i; } else col.folded[i] = true;
    relayout();
    return !shut;
  }
  function unstackAll() {
    const flat = [];
    for (const col of v.cols) for (const id of col.ids) flat.push({ ids: [id], w: col.ids.length > 1 ? COL_W : col.w, h: [1], folded: [false] });
    const n = limit();
    const waiting = flat.slice(n);
    v.cols = flat.slice(0, n);
    waiting.forEach((c, k) => v.floats.push({ id: c.ids[0], x: Math.max(8, v.w - 330 - k * 24), y: 30 + k * 28, w: 300, h: 260 }));
    render();
    const names = waiting.map((c) => nameOf(c.ids[0]));
    say(names.length ? `The window is too narrow for another column, so ${listWords(names)} ${names.length === 1 ? 'is' : 'are'} floating. ${names.length === 1 ? 'It docks' : 'They dock'} when the window is wide enough.` : 'Every module has its own column again.');
  }
  function reset() { v.cols = clone(start.cols); v.floats = start.floats.map((f) => ({ ...f })); render(); say(''); }
  const focusMenuOf = (id) => requestAnimationFrame(() => canvas.querySelector(`.mf[data-id="${id}"] .mf-titlebar-menu`)?.focus());

  // ---- the menus: the frame's own entries, then the stack's group after the window's (Dock as a panel's siblings) ----
  function stackTargets(id) {
    const own = colOf(id);
    return v.cols.map((col, c) => ({ col, c })).filter(({ col, c }) => c !== own && MODS[col.ids[0]].stack);
  }
  function positions(id, c) {
    const col = v.cols[c];
    const act = (target, pos) => () => { if (stackInto(id, v.cols.indexOf(col), target, pos)) focusMenuOf(id); };
    return [
      { label: `Above ${nameOf(col.ids[0])}`, icon: 'arrow-up', onPick: act(col.ids[0], 'above') },
      ...col.ids.map((s) => ({ label: `Below ${nameOf(s)}`, icon: 'arrow-down', onPick: act(s, 'below') })),
    ];
  }
  function stackWithItems(id, trigger) {
    const targets = stackTargets(id);
    if (v.styles.pick === 'A') {
      const out = [];
      for (const { col, c } of targets) {
        out.push({ heading: listWords(col.ids.map(nameOf)) });
        const why = refusal(id, c);
        if (why) out.push({ label: why === 'A stack holds three modules at most.' ? 'Full: three modules' : 'Too short here', disabled: true });
        else out.push(...positions(id, c));
      }
      return out;
    }
    return targets.map(({ col, c }) => {
      const why = refusal(id, c);
      return {
        label: listWords(col.ids.map(nameOf)), icon: MODS[col.ids[0]].icon, disabled: Boolean(why), hint: why ? (why.startsWith('A stack') ? 'Full: three modules' : 'Too short here') : undefined,
        onPick: () => setTimeout(() => openHostMenu(trigger, [{ heading: `Stack ${nameOf(id)} with ${listWords(col.ids.map(nameOf))}` }, ...positions(id, c)]), 0),
      };
    });
  }
  function stackGroup(id, trigger) {
    const c = colOf(id);
    const out = [];
    if (MODS[id].stack) {
      const targets = stackTargets(id);
      out.push(targets.length ? { label: 'Stack with...', icon: 'layer-group', items: () => stackWithItems(id, trigger) } : { label: 'Stack with...', icon: 'layer-group', disabled: true, hint: 'No column here can hold it' });
    }
    if (c >= 0 && v.cols[c].ids.length > 1) {
      const col = v.cols[c]; const i = col.ids.indexOf(id); const n = col.ids.length;
      const shut = col.folded[i] || (col.auto && col.auto[i]);
      const swap = (j) => () => {
        [col.ids[i], col.ids[j]] = [col.ids[j], col.ids[i]]; [col.h[i], col.h[j]] = [col.h[j], col.h[i]]; [col.folded[i], col.folded[j]] = [col.folded[j], col.folded[i]];
        render(); say(`${nameOf(id)} moved ${j < i ? 'up' : 'down'}.`); focusMenuOf(id);
      };
      if (i > 0) out.push({ label: 'Move up', icon: 'arrow-up', onPick: swap(i - 1) });
      if (i < n - 1) out.push({ label: 'Move down', icon: 'arrow-down', onPick: swap(i + 1) });
      out.push({ label: 'Move out of the stack', icon: 'object-ungroup', onPick: () => { if (ownColumn(id, c + 1)) focusMenuOf(id); } });
      out.push({ label: shut ? 'Expand' : 'Collapse', icon: shut ? 'chevron-down' : 'chevron-up', disabled: !shut && openCount(col) === 1, hint: !shut && openCount(col) === 1 ? 'The last one open' : undefined, onPick: () => { toggleFold(id); say(`${nameOf(id)} ${shut ? 'expanded' : 'collapsed'}.`); focusMenuOf(id); } });
      out.push({ label: 'Equal heights', icon: 'equals', onPick: () => { equalize(col); relayout(); say(`${listWords(col.ids.map(nameOf))} have equal heights.`); focusMenuOf(id); } });
    }
    return out;
  }
  function menuFor(id, f, trigger) {
    const base = f.titlebarMenu();
    const group = stackGroup(id, trigger);
    if (!group.length) return base;
    const at = base.findIndex((x) => x.label === 'Open in its own window');
    const cut = at < 0 ? base.length : at + 1;
    return [...base.slice(0, cut), { divider: true }, ...group, ...(base.slice(cut).length ? base.slice(cut) : [])];
  }

  // ---- the divider ----
  function divider(col, i) {
    const dv = h('div', 'pps-div');
    dv.dataset.style = v.styles.divider;
    dv.setAttribute('role', 'separator');
    dv.setAttribute('aria-orientation', 'horizontal');
    dv.setAttribute('aria-label', `Resize ${nameOf(col.ids[i])} and ${nameOf(col.ids[i + 1])}`);
    dv.tabIndex = 0;
    const setUpper = (a, total, share) => { const x = clamp(a, Math.min(SECTION_MIN, total / 2), Math.max(total - SECTION_MIN, total / 2)); col.h[i] = (share * x) / total; col.h[i + 1] = share - col.h[i]; relayout(); };
    dv.addEventListener('pointerdown', (e) => {
      if (dv.classList.contains('pps-div-off') || e.button !== 0) return;
      e.preventDefault();
      dv.setPointerCapture(e.pointerId);
      const s = { y: e.clientY, a: col.px[i], total: col.px[i] + col.px[i + 1], share: col.h[i] + col.h[i + 1] };
      dv.classList.add('is-drag'); canvas.classList.add('pps-resizing');
      const move = (ev) => setUpper(s.a + ev.clientY - s.y, s.total, s.share);
      const up = () => { dv.classList.remove('is-drag'); canvas.classList.remove('pps-resizing'); dv.removeEventListener('pointermove', move); dv.removeEventListener('pointerup', up); dv.removeEventListener('pointercancel', up); };
      dv.addEventListener('pointermove', move); dv.addEventListener('pointerup', up); dv.addEventListener('pointercancel', up);
    });
    dv.addEventListener('dblclick', () => { equalize(col); relayout(); say(`${listWords(col.ids.map(nameOf))} have equal heights.`); });
    dv.addEventListener('keydown', (e) => {
      if (dv.classList.contains('pps-div-off')) return;
      const total = col.px[i] + col.px[i + 1]; const share = col.h[i] + col.h[i + 1]; const step = e.shiftKey ? BIG_STEP : STEP;
      if (e.key === 'ArrowUp') setUpper(col.px[i] - step, total, share);
      else if (e.key === 'ArrowDown') setUpper(col.px[i] + step, total, share);
      else if (e.key === 'Home') setUpper(0, total, share);
      else if (e.key === 'End') setUpper(total, total, share);
      else if (e.key === 'Enter') { equalize(col); relayout(); say(`${listWords(col.ids.map(nameOf))} have equal heights.`); } else return;
      e.preventDefault();
    });
    return dv;
  }

  // ---- the title bar drag: the zones, the line, the drop ----
  let drag = null;
  const rel = (r) => { const cr = canvas.getBoundingClientRect(); return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height }; };
  function zonesFor(id) {
    const out = [];
    const src = colOf(id);
    v.cols.forEach((col, c) => {
      const r = rel(v.colEls[c].getBoundingClientRect());
      const edge = Math.max(24, r.w / 8); // the outer quarter of the column's width: an eighth at each side
      const ownSingle = c === src && col.ids.length === 1;
      if (!ownSingle) {
        out.push({ kind: 'move', index: c, x: r.x, y: r.y, w: edge, h: r.h, line: r.x });
        out.push({ kind: 'move', index: c + 1, x: r.x + r.w - edge, y: r.y, w: edge, h: r.h, line: r.x + r.w });
      }
      if (ownSingle) return;
      const why = refusal(id, c);
      if (why) { out.push({ kind: 'refused', why, x: r.x + edge, y: r.y, w: r.w - 2 * edge, h: r.h }); return; }
      for (const s of col.ids) {
        if (s === id) continue;
        const sr = rel(v.secs.get(s).getBoundingClientRect());
        out.push({ kind: 'stack', c, target: s, pos: 'above', x: r.x + edge, y: sr.y, w: r.w - 2 * edge, h: sr.h / 2, sec: sr, col: r, n: col.ids.length });
        out.push({ kind: 'stack', c, target: s, pos: 'below', x: r.x + edge, y: sr.y + sr.h / 2, w: r.w - 2 * edge, h: sr.h / 2, sec: sr, col: r, n: col.ids.length });
      }
    });
    return out;
  }
  function beginDrag(id) {
    const f = canvas.querySelector(`.mf[data-id="${id}"]`);
    drag = { id, zones: zonesFor(id), hit: null, f };
    f?.classList.add('module-lifted', 'pps-lifted');
    canvas.classList.add('pps-dragging');
    drawZones();
  }
  function drawZones() {
    zones.textContent = '';
    if (!drag) return;
    const hit = drag.hit;
    if (v.styles.zones === 'A') {
      for (const z of drag.zones) {
        if (z.kind !== 'stack') continue;
        const el = h('div', `pps-zone${z === hit ? ' is-on' : ''}`);
        Object.assign(el.style, { left: `${z.x + 4}px`, top: `${z.y + 4}px`, width: `${z.w - 8}px`, height: `${Math.max(0, z.h - 8)}px` });
        const wds = h('span', 'pps-zone-words'); wds.append(fa(z.pos === 'above' ? 'arrow-up' : 'arrow-down'), `Stack ${z.pos} ${nameOf(z.target)}`);
        if (z.h >= 26) el.append(wds);
        zones.append(el);
      }
    } else if (hit && hit.kind === 'stack') {
      // B: the place it would take, as a section with its title bar: a share of the target's column, at the target's top or bottom.
      const share = Math.max(SECTION_MIN, (hit.col.h - DIV_H * hit.n) / (hit.n + 1));
      const g = h('div', 'pps-ghost-sec');
      const top = hit.pos === 'above' ? hit.sec.y : hit.sec.y + hit.sec.h - Math.min(share, hit.sec.h);
      Object.assign(g.style, { left: `${hit.col.x + 2}px`, top: `${top}px`, width: `${hit.col.w - 4}px`, height: `${Math.min(share, hit.sec.h)}px` });
      const head = h('div', 'pps-ghost-head'); head.append(fa(MODS[drag.id].icon), nameOf(drag.id));
      g.append(head, h('p', 'pps-ghost-words', `${nameOf(drag.id)} goes ${hit.pos === 'above' ? 'above' : 'under'} ${nameOf(hit.target)}`));
      zones.append(g);
    }
    if (hit && hit.kind === 'move' && !ownWhy(drag.id)) { // a drop that would be refused draws no line (the note says why when it is let go)
      const line = h('div', `pps-line${hit.line > v.w - 140 ? ' pps-line-flip' : ''}`);
      line.style.left = `${clamp(hit.line, 2, v.w - 2)}px`;
      line.append(h('span', 'pps-line-words', colOf(drag.id) >= 0 && v.cols[colOf(drag.id)].ids.length > 1 ? 'Its own column here' : 'Move here'));
      zones.append(line);
    }
    if (drag.pt) {
      const chip = h('div', 'pps-chip'); chip.append(fa(MODS[drag.id].icon), nameOf(drag.id));
      chip.style.left = `${clamp(drag.pt.x + 14, 0, v.w - 120)}px`; chip.style.top = `${clamp(drag.pt.y + 14, 0, v.h - 36)}px`;
      zones.append(chip);
    }
  }
  function dragTo(x, y) {
    if (!drag) return;
    drag.pt = { x, y };
    const inside = (z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;
    drag.hit = drag.zones.find((z) => z.kind === 'move' && inside(z)) || drag.zones.find((z) => z.kind !== 'move' && inside(z)) || null;
    drawZones();
  }
  function endDrag(cancel) {
    if (!drag) return;
    const { id, hit, f } = drag;
    drag = null;
    f?.classList.remove('module-lifted', 'pps-lifted');
    canvas.classList.remove('pps-dragging');
    zones.textContent = '';
    if (cancel || !hit) return;
    if (hit.kind === 'refused') say(hit.why);
    else if (hit.kind === 'stack') stackInto(id, hit.c, hit.target, hit.pos);
    else if (hit.kind === 'move') ownColumn(id, hit.index);
  }
  function wireDrag(f, id) {
    const head = f.titlebar;
    head.classList.add('reorderable');
    let p = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, a, input, select, textarea')) return;
      p = { id: e.pointerId, x: e.clientX, y: e.clientY, started: false };
    });
    head.addEventListener('pointermove', (e) => {
      if (!p || e.pointerId !== p.id) return;
      if (!p.started) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD) return;
        p.started = true;
        head.setPointerCapture?.(e.pointerId);
        beginDrag(id);
      }
      const cr = canvas.getBoundingClientRect();
      dragTo(e.clientX - cr.left, e.clientY - cr.top);
    });
    const stop = (e, cancel) => {
      if (!p || e.pointerId !== p.id) return;
      const moved = p.started;
      p = null;
      if (!moved) return;
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      head.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => head.removeEventListener('click', swallow, { capture: true }), 100);
      endDrag(cancel);
    };
    head.addEventListener('pointerup', (e) => stop(e, false));
    head.addEventListener('pointercancel', (e) => stop(e, true));
    head.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag) { endDrag(true); p = null; } });
  }
  // A picture of a drag held still: `id` lifted and the pointer at (x, y) in the canvas.
  function freeze(id, x, y) { beginDrag(id); dragTo(x, y); }

  // ---- the Layout menu's entries (Show, Arrange with Unstack all, the note) ----
  function layoutItems(noteEl) {
    const shown = new Set([...v.cols.flatMap((c) => c.ids), ...v.floats.map((f) => f.id)]);
    const items = [{ heading: 'Show' }];
    for (const id of ['planner', 'todo', 'polls', 'budget', 'research', 'calendar']) items.push({ toggle: true, checked: shown.has(id), icon: MODS[id].icon, tint: MODS[id].tint, label: nameOf(id), keepOpen: true, onPick: () => say('Show is drawn here, not working.') });
    items.push({ divider: true }, { heading: 'Arrange' });
    items.push({ radio: true, checked: true, keepOpen: true, icon: 'fa-solid fa-table-columns', label: 'Panel Mode', onPick: () => {} });
    items.push({ radio: true, checked: false, keepOpen: true, icon: 'window-restore', label: 'Window Mode', onPick: () => say('Window Mode is drawn here, not working.') });
    const stacks = v.cols.filter((c) => c.ids.length > 1).length;
    items.push({ icon: 'object-ungroup', label: 'Unstack all', disabled: !stacks, keepOpen: true, onPick: () => unstackAll() });
    if (noteEl) items.push({ element: noteEl });
    return items;
  }

  render();
  return { el: wrap, canvas, v, render, relayout, freeze, reset, unstackAll, layoutItems, menuFor, stackGroup, stackWithItems, frames: v.frames };
}

// The call and the chat, in the column beside the canvas (architecture-canvas, "The work area and the always-on column"): never a
// column of the canvas, so a drag shows no zone over them and their menus have no Stack with....
function sideColumn(w, height) {
  const side = h('div', 'pps-side');
  side.style.width = `${w}px`;
  side.style.height = `${height}px`;
  const tiles = h('div', 'pps-tiles');
  for (const n of ['A', 'B', 'M', 'N']) tiles.append(h('div', 'pps-tile', n));
  const call = createModuleFrame({ variant: 'docked', title: 'Call', icon: 'video', titlebar: { close: false, standard: { window: false, popout: false } }, toolbar: [], content: tiles, status: { text: '00:42:10' } });
  const msgs = h('div', 'pps-list');
  for (const [who, words] of [['Ana', 'Ferry is at nine'], ['Ben', 'I voted for the grill'], ['Mia', 'Deposit paid']]) { const m = h('div', 'pps-msg'); m.append(h('span', 'pps-msg-who', who), h('span', '', words)); msgs.append(m); }
  const chat = createModuleFrame({ variant: 'docked', title: 'Chat', icon: 'comments', titlebar: { close: false, standard: { window: false, popout: false } }, toolbar: [], content: msgs, status: { text: '3 new' } });
  side.append(call.el, chat.el);
  return side;
}

// ---- the page: one section, its parts drawn as they come near the screen ----
const main = D.getElementById('pp-main');
const sec = h('section', 'pp-group pps');
sec.id = 'pp-panel-stacking';
sec.setAttribute('aria-labelledby', 'pp-panel-stacking-name');
const title = h('h2', 'pp-group-name', 'Panel stacking: two or three modules in one column');
title.id = 'pp-panel-stacking-name';
sec.append(title, h('p', 'pp-state-note', 'The plan\'s step 0 (plan-panel-stacking.md, GitHub #387). Option B, decided: modules stacked one above the other in one column of the canvas, each in its own frame, with a divider between them and a collapse on each. Nothing in the real canvas is built yet. The modules are the real module frame and the real menus; their content is made up. Drag a title bar, a divider, or use a module\'s "..." menu in any drawing: those are real here. Light and dark are the switches at the top.'));
const jump = h('nav', 'pp-jump');
jump.setAttribute('aria-label', 'Jump to a part of Panel stacking');
jump.append(h('span', 'pp-jump-label', 'Jump to'));
sec.append(jump);

const lazy = [];
function part(id, name, note) {
  const s = h('section', 'pps-set');
  s.id = `pps-${id}`;
  s.setAttribute('aria-labelledby', `pps-${id}-name`);
  const hh = h('h3', 'pps-set-name', name);
  hh.id = `pps-${id}-name`;
  s.append(hh);
  if (note) s.append(h('p', '', note));
  sec.append(s);
  const b = h('button', 'btn btn-small', name.split(':')[0]);
  b.type = 'button';
  b.addEventListener('click', () => { hh.scrollIntoView({ block: 'start' }); s.classList.add('pp-flash'); setTimeout(() => s.classList.remove('pp-flash'), 900); });
  jump.append(b);
  return s;
}
const later = (s, draw) => lazy.push({ s, draw, done: false });
function cell(into, name, note, ab) {
  const c = h('div', 'pps-cell');
  const n = h('h4', 'pps-cell-name');
  if (ab) n.append(h('span', 'pps-ab', ab));
  n.append(name);
  c.append(n);
  if (note) { const p = h('p'); p.innerHTML = note; c.append(p); }
  into.append(c);
  return c;
}
const noteLine = () => { const p = h('p', 'pps-note'); p.setAttribute('role', 'status'); return p; };
const readout = () => h('p', 'pps-readout');
const cells = (into) => { const c = h('div', 'pps-cells'); into.append(c); return c; };
function abSwitch(label, value, onPick, words = { A: 'A', B: 'B' }) {
  const box = h('div', 'pps-bar-item');
  box.append(h('span', 'pps-bar-label', label));
  const sw = h('div', 'mf-switch');
  sw.setAttribute('role', 'radiogroup');
  sw.setAttribute('aria-label', label);
  const draw = (cur) => {
    sw.textContent = '';
    for (const k of ['A', 'B']) {
      const b = h('button', 'mf-switch-btn');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(cur === k)); b.tabIndex = cur === k ? 0 : -1;
      b.append(h('span', '', words[k]));
      b.addEventListener('click', () => { draw(k); onPick(k); sw.querySelector('[aria-checked="true"]').focus(); });
      b.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const nk = k === 'A' ? 'B' : 'A'; draw(nk); onPick(nk); sw.querySelector('[aria-checked="true"]').focus(); } });
      sw.append(b);
    }
  };
  draw(value);
  box.append(sw);
  return box;
}

// 1. Try it
{
  const s = part('try', 'Try it: the whole thing, live', 'A 920 pixel canvas beside the call and chat column, at its docked limit (three columns). Drag a title bar onto another module: the zones show where it lands; the outer edges of a column move it between columns, as today. The Calendar column holds no stack and the call and chat column is not part of the canvas, so neither shows a zone. Budget floats: its "..." has Stack with... (the limit is reached, so Dock as a panel is off, but a stack still fits). Every module\'s "..." has the stack entries, the keyboard way to do all of it. The divider moves with the pointer and with Up, Down, Shift, Home, End and Enter.');
  later(s, () => {
    const note = noteLine(); const rd = readout();
    const styles = { divider: 'A', fold: 'A', zones: 'A', pick: 'A' };
    const view = stackCanvas({ w: 920, h: 600, side: 280, drag: true, note, readout: rd, styles,
      cols: [{ ids: ['planner'] }, { ids: ['todo', 'polls'], w: 300 }, { ids: ['calendar'], w: 280 }],
      floats: [{ id: 'budget', x: 24, y: 300, w: 290, h: 270 }] });
    const bar = h('div', 'pps-bar');
    const layoutBtn = h('button', 'btn btn-small');
    layoutBtn.type = 'button'; layoutBtn.setAttribute('aria-haspopup', 'menu');
    layoutBtn.append(fa('table-columns'), h('span', '', ' Layout'));
    const menuNote = h('p', 'module-chooser-note');
    layoutBtn.addEventListener('click', () => { menuNote.textContent = note.textContent; openHostMenu(layoutBtn, () => { menuNote.textContent = note.textContent; return view.layoutItems(menuNote); }); });
    const resetBtn = h('button', 'btn btn-small', 'Start again');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', () => view.reset());
    const set = (k) => (x) => { styles[k] = x; view.v.styles[k] = x; view.render(); };
    bar.append(layoutBtn, resetBtn,
      abSwitch('Drop zones', 'A', set('zones'), { A: 'A: labelled', B: 'B: a preview' }),
      abSwitch('Divider', 'A', set('divider'), { A: 'A: a band', B: 'B: a gap' }),
      abSwitch('Collapsed', 'A', set('fold'), { A: 'A: title bar', B: 'B: and its status' }),
      abSwitch('Stack with...', 'A', set('pick'), { A: 'A: one list', B: 'B: two steps' }));
    s.append(bar, view.el, note, rd);
  });
}

// 2. The drag
{
  const s = part('drag', 'The drag: make a stack, or move between columns', 'A title bar dragged more than 6 pixels lifts the module (today\'s look). Over another module, the upper half stacks it above, the lower half below; the outer eighth of a column at each side moves it between columns, with a line where it would land. A and B differ only in how the stack zones are shown. Each picture is a drag held still; the canvases below them are live.');
  later(s, () => {
    const base = { w: 800, h: 520, side: 240, cols: [{ ids: ['todo'] }, { ids: ['polls'], w: 260 }, { ids: ['calendar'], w: 260 }] };
    const row = cells(s);
    const a = cell(row, 'Labelled zones, from the start', 'Every zone shows "Stack above" or "Stack below" with the module\'s name as soon as the drag starts; the one under the pointer fills with the accent. <strong>Recommended:</strong> the meaning is in the words, never in the colour alone (the plan\'s Accessibility), and a person sees every place before moving there.', 'A');
    const va = stackCanvas({ ...base, styles: { zones: 'A' } }); a.append(va.el); requestAnimationFrame(() => va.freeze('polls', 120, 400));
    const b = cell(row, 'A preview of the result', 'Nothing until the pointer is over a module; then the place the module would take, drawn as a section with its title bar. Calmer, and it shows the size it will get, but a person does not see the choices until they find one.', 'B');
    const vb = stackCanvas({ ...base, styles: { zones: 'B' } }); b.append(vb.el); requestAnimationFrame(() => vb.freeze('polls', 120, 400));
    const row2 = cells(s);
    const c = cell(row2, 'Moving between columns: the line', 'Polls dragged to the right edge of Calendar. Over the outer edge of a column: a line where the column lands, the same in A and B. Today\'s drag moves the columns while the pointer moves and draws no line (wireReorder in canvas.js); with zones in the columns that would make them jump under the pointer, so the line replaces it.', '');
    const vc = stackCanvas({ ...base, styles: { zones: 'A' } }); c.append(vc.el); requestAnimationFrame(() => vc.freeze('polls', 790, 260));
    const row3 = cells(s);
    for (const k of ['A', 'B']) {
      const d = cell(row3, `Live, ${k}`, 'Drag Polls (or any title bar) over To-do or to an edge, and let go.', k);
      const note = noteLine();
      const vd = stackCanvas({ ...base, side: 0, w: 640, drag: true, note, styles: { zones: k }, cols: [{ ids: ['todo'] }, { ids: ['polls'], w: 260 }] });
      const again = h('button', 'btn btn-small', 'Start again'); again.type = 'button'; again.addEventListener('click', () => vd.reset());
      const b2 = h('div', 'pps-bar'); b2.append(again); d.append(vd.el, note, b2);
    }
  });
}

// 3. Stacks of two and three
{
  const s = part('stacks', 'A stack of two and of three', 'Each section is the module\'s own docked frame (title bar, toolbar, content, status bar), unchanged; the stack is a group that holds them, with no bar of its own. A new stack starts with equal heights (decision 6). Here two at 300 pixels and the most, three, at 240 pixels, on a 600 pixel canvas: three leave each module about 95 to 135 pixels of content once its toolbar (when it has one) and status bar are counted.');
  later(s, () => {
    const rd = readout();
    const view = stackCanvas({ w: 860, h: 600, cols: [{ ids: ['planner'] }, { ids: ['todo', 'polls'], w: 300 }, { ids: ['research', 'budget', 'places'], w: 240 }], readout: rd });
    s.append(view.el, rd);
  });
}

// 4. The divider
{
  const s = part('divider', 'The divider', 'Between a status bar and the next title bar. It moves with the pointer, stops at the least a section may have (its title bar plus 120 pixels: 156; about 56 of content once a toolbar and a status bar are counted), and a double click or Enter gives equal heights. It is a separator with a name ("Resize To-do and Polls"), a tab stop, and its value is the upper section\'s share.');
  later(s, () => {
    const row = cells(s);
    for (const [k, words] of [['A', 'A band in the title bar\'s tone with a grip in the middle; the accent under the pointer and while it moves. <strong>Recommended:</strong> the grip says it moves before anyone points at it, which a finger needs, and it reads as a line between the two frames.'], ['B', 'A gap of the canvas between the two frames, with no grip; an accent line under the pointer and while it moves. Quieter, and the two frames look separate, but nothing says it moves until the pointer finds it.']]) {
      const c = cell(row, k === 'A' ? 'A band with a grip' : 'A gap', words, k);
      const rd = readout();
      const view = stackCanvas({ w: 300, h: 460, cols: [{ ids: ['todo', 'polls'] }], styles: { divider: k }, readout: rd });
      c.append(view.el, rd);
    }
    const row2 = cells(s);
    const states = [['Rest', ''], ['Under the pointer', 'is-hover'], ['The keyboard on it', 'is-focus'], ['Being dragged', 'is-drag'], ['A finger: 24 px', 'pps-show-hit pps-hit-24'], ['A finger: 44 px', 'pps-show-hit pps-hit-44']];
    for (const [name, cls] of states) {
      const c = cell(row2, name, cls.includes('hit-24') ? 'The plan\'s hit area (dashed): 8 above and below the band.' : cls.includes('hit-44') ? 'The design system\'s 44: it reaches over the title bar\'s buttons below it. Thomas to choose (see the questions).' : '', '');
      const view = stackCanvas({ w: 280, h: 300, cols: [{ ids: ['todo', 'polls'] }], menus: false });
      const dv = view.canvas.querySelector('.pps-div');
      if (cls) dv.className += ` ${cls}`;
      c.append(view.el);
    }
  });
}

// 5. Collapsed
{
  const s = part('collapse', 'A collapsed section', 'The chevron at the start of each title bar (a real button: "Collapse Polls", with aria-expanded) folds the section to its title bar; the one open below or above takes its height. Collapse and Expand are in the "..." too. Press the chevrons here.');
  later(s, () => {
    const row = cells(s);
    for (const [k, words] of [['A', 'The title bar alone, as the plan\'s contract says ("its status bar\'s summary is hidden"). <strong>Recommended:</strong> the same title bar as when it is open, nothing new to learn; the space\'s "need action" count already says when something waits.'], ['B', 'The title bar with the status bar\'s words after the name ("2 open"), as the plan\'s Option C reads. Useful at a glance, but it takes width from the name in a 240 pixel column.']]) {
      const c = cell(row, k === 'A' ? 'Its title bar alone' : 'Its title bar and status', words, k);
      const view = stackCanvas({ w: 300, h: 460, cols: [{ ids: ['todo', 'polls', 'budget'], folded: [false, true, false] }], styles: { fold: k } });
      c.append(view.el);
    }
  });
}

// 6. A short canvas
{
  const s = part('short', 'A short canvas', 'When the canvas cannot give every section its title bar plus 120 pixels, the lowest open section collapses by itself, then the next, and they open again by themselves when the height returns. A section the person collapsed stays collapsed; one the person opens is not the next to collapse. Move the slider.');
  later(s, () => {
    const rd = readout();
    const holder = h('div');
    const draw = (hh) => { const view = stackCanvas({ w: 560, h: hh, cols: [{ ids: ['planner'] }, { ids: ['todo', 'polls', 'budget'], w: 280 }], readout: rd }); holder.textContent = ''; holder.append(view.el); };
    const bar = h('label', 'pps-bar-item');
    const out = h('span', 'pps-bar-label', '560 px');
    const range = h('input');
    range.type = 'range'; range.min = '240'; range.max = '700'; range.step = '10'; range.value = '560';
    range.setAttribute('aria-label', 'Canvas height');
    range.addEventListener('input', () => { out.textContent = `${range.value} px`; draw(Number(range.value)); });
    bar.append(h('span', 'pps-bar-label', 'Canvas height'), range, out);
    s.append(bar, holder, rd);
    draw(560);
    const row = cells(s);
    const c = cell(row, 'Held at 420 pixels', 'Three sections need 3 × 156 + 2 × 8 = 484 pixels; at 420 Budget, the lowest, has collapsed by itself.', '');
    const view = stackCanvas({ w: 280, h: 420, cols: [{ ids: ['todo', 'polls', 'budget'] }] });
    c.append(view.el);
  });
}

// 7. The menus
{
  const s = part('menus', 'The menus: every drag has a menu route', 'The keyboard, a screen reader and a finger do all of it from the menus. Polls\' "..." (Tab to it, Enter, the arrows): its stack entries come after the window\'s own (Open as a window, Open in its own window); Move up and Move down are hidden at the ends. After a pick the keyboard is back on the moved module\'s "...", and the note says what happened. The Layout menu\'s Arrange gains Unstack all. These are pictures; the menus in every drawing are real.');
  later(s, () => {
    const view = stackCanvas({ w: 900, h: 400, cols: [{ ids: ['planner'] }, { ids: ['todo', 'polls', 'budget'], w: 260 }, { ids: ['research'], w: 260 }] });
    const polls = view.frames.find((f) => f.el.dataset.id === 'polls');
    const items = view.menuFor('polls', polls, polls.el);
    const row = cells(s);
    const c1 = cell(row, 'Polls, in the middle of a stack of three', '', '');
    c1.append(heldMenu(items));
    view.v.styles.pick = 'A';
    const c2 = cell(row, 'Stack with...: one list', 'Each column that can hold it, by its modules\' names, with Above and Below under each; a full stack says so. <strong>Recommended:</strong> one step, and every place the drag can reach is a row.', 'A');
    const flyA = view.stackWithItems('polls', polls.el);
    c2.append(heldPair(items, 'Stack with...', flyA));
    view.v.styles.pick = 'B';
    const c3 = cell(row, 'Stack with...: two steps', 'The columns first, then a second menu for the place. Shorter lists, but one more step, and the second menu opens away from the first.', 'B');
    const flyB = view.stackWithItems('polls', polls.el);
    const pair = heldPair(items, 'Stack with...', flyB);
    c3.append(pair, h('p', 'pps-held-cap', 'Then, after Research:'), heldMenu([{ heading: 'Stack Polls with Research' }, { label: 'Above Research', icon: 'arrow-up' }, { label: 'Below Research', icon: 'arrow-down' }]));
    const row2 = cells(s);
    const c4 = cell(row2, 'The Layout menu: Arrange', 'Unstack all puts every module of every stack in a column of its own; past the docked limit the rightmost ones float and wait, as Panel Mode\'s do. The note line is the menu\'s own, said to a screen reader too.', '');
    const note = h('p', 'module-chooser-note', 'Polls was stacked under To-do.');
    c4.append(heldMenu(view.layoutItems(note)));
    const c5 = cell(row2, 'A floating module: Dock as a panel and Stack with...', 'Decision 5: a floating window is stacked from its menu only, docking and stacking in one step; dragging a window onto a column comes later. Here the columns are full, so Dock as a panel is off and says why, but Stack with... can still fit it in.', '');
    const fv = stackCanvas({ w: 700, h: 400, cols: [{ ids: ['planner'] }, { ids: ['todo', 'polls'], w: 300 }], floats: [{ id: 'budget', x: 120, y: 60, w: 280, h: 260 }] });
    const bf = fv.frames.find((f) => f.el.dataset.id === 'budget');
    const fItems = fv.menuFor('budget', bf, bf.el);
    c5.append(heldPair(fItems, 'Stack with...', fv.stackWithItems('budget', bf.el)));
    const c6 = cell(row2, 'With the keyboard alone', '', '');
    const ol = h('ol', 'pps-list-words');
    for (const t of ['Tab to Polls\' "..." in its title bar and press Enter.', 'Down to Stack with..., then Right (or Enter) to open the list.', 'Down to "Below To-do", Enter. The note says "Polls was stacked under To-do." and the keyboard is on Polls\' "..." again.', 'In a stack: Move up, Move down, Move out of the stack, Collapse or Expand, Equal heights, the same way.', 'The divider is a tab stop: Up and Down move it 16 pixels, with Shift 64; Home and End go to the least and the most; Enter gives equal heights.']) ol.append(h('li', '', t));
    c6.append(ol);
  });
}

// 8. The docked limit
{
  const s = part('limit', 'A stack is one column of the docked limit', 'Decision 7. A 700 pixel canvas holds two columns (dockLimit, the real one): here the Planner and a stack of To-do and Polls, three modules in two columns. Budget floats: Dock as a panel is off ("The window is too narrow for another column"), but its Stack with... can put it under Polls. Try it from Budget\'s "...".');
  later(s, () => {
    const note = noteLine(); const rd = readout();
    const view = stackCanvas({ w: 700, h: 520, drag: true, note, readout: rd, cols: [{ ids: ['planner'] }, { ids: ['todo', 'polls'], w: 300 }], floats: [{ id: 'budget', x: 60, y: 200, w: 280, h: 280 }] });
    const again = h('button', 'btn btn-small', 'Start again'); again.type = 'button'; again.addEventListener('click', () => view.reset());
    const b2 = h('div', 'pps-bar'); b2.append(again); s.append(view.el, note, rd, b2);
  });
}

// 9. One module left
{
  const s = part('one', 'A stack left with one module', 'Decision 8: it is an ordinary column at once, with no divider, no chevron and no stack entries in its menu. Close Polls (its x) or choose Move out of the stack in its "...".');
  later(s, () => {
    const row = cells(s);
    const c1 = cell(row, 'Before: To-do and Polls', '', '');
    const note = noteLine();
    const v1 = stackCanvas({ w: 300, h: 420, note, cols: [{ ids: ['todo', 'polls'] }] });
    const again = h('button', 'btn btn-small', 'Start again'); again.type = 'button'; again.addEventListener('click', () => v1.reset());
    const b2 = h('div', 'pps-bar'); b2.append(again); c1.append(v1.el, note, b2);
    const c2 = cell(row, 'After closing Polls', 'The note: "Polls was closed. To-do has its own column again."', '');
    c2.append(stackCanvas({ w: 300, h: 420, cols: [{ ids: ['todo'] }] }).el);
  });
}

// 10. What cannot stack
{
  const s = part('refused', 'What cannot be stacked, and how a drop is refused', 'No zone is drawn where a stack cannot go; the edges still move between columns. A drop there does nothing, and the note line says why (as the docked limit\'s notes do, and to a screen reader). The menus never offer what cannot be done.');
  later(s, () => {
    const ul = h('ul', 'pps-list-words');
    for (const [who, words] of [
      ['The call and the chat', 'They live in the column beside the canvas, not in it: no zone is ever drawn over them and their menus have no Stack with.... (On a page with no such column, where they are columns, the same.)'],
      ['A composite (Calendar, Map)', 'Its column shows no stack zone, and dragging it shows none anywhere. Note: "Calendar can\'t hold a stack." or "Calendar can\'t be in a stack." Its menu has no Stack with....'],
      ['A full stack (three)', 'No stack zone on it. Note: "A stack holds three modules at most." In Stack with... it reads "Full: three modules".'],
      ['A canvas too short', 'No stack zone where the stack could not give each section its least. Note: "The canvas is too short to stack here." (the plan\'s sentence uses a word the Names rule forbids, so it is said this way).'],
      ['No column left', 'Moving a module out of a stack when the columns are full. Note: "The window is too narrow for another column."'],
    ]) { const li = h('li'); li.append(h('strong', '', `${who}. `), words); ul.append(li); }
    s.append(ul);
    const row = cells(s);
    const c1 = cell(row, 'Dragging Research over a full stack, beside Calendar', 'Only the edges are live: no stack zone on the stack of three or on Calendar.', '');
    const v1 = stackCanvas({ w: 860, h: 480, side: 240, cols: [{ ids: ['todo', 'polls', 'budget'] }, { ids: ['calendar'], w: 280 }, { ids: ['research'], w: 260 }] });
    c1.append(v1.el, h('p', 'pps-held-cap', 'Let go here and the note says: "A stack holds three modules at most."'));
    requestAnimationFrame(() => v1.freeze('research', 160, 300));
    const c2 = cell(row, 'Dragging Calendar', 'A composite cannot be in a stack: only the line between columns.', '');
    const v2 = stackCanvas({ w: 860, h: 480, cols: [{ ids: ['todo'] }, { ids: ['polls'], w: 280 }, { ids: ['calendar'], w: 280 }] });
    c2.append(v2.el);
    requestAnimationFrame(() => v2.freeze('calendar', 300, 260));
  });
}

// 11. A phone
{
  const s = part('phone', 'A phone (390)', 'Not offered on a phone (640 pixels and below): one view at a time, no docking, no dividers, no drag, and no stack entries in any menu (the plan; the phone plan\'s "What a phone does not offer"). A saved layout that holds a stack shows its modules as separate views; the stack stays in what is stored, untouched, for a wide window. Nothing is built for the phone. The tabs below switch the view.');
  later(s, () => {
    const phone = h('div', 'pps-phone');
    const top = h('div', 'pps-phone-top'); top.append(fa('suitcase-rolling'), h('span', '', 'Greek islands'));
    const view = h('div', 'pps-phone-view');
    const tabs = h('div', 'pps-tabs');
    tabs.setAttribute('aria-label', 'Views');
    let shown = null;
    const show = (id) => {
      shown?.destroy?.();
      const m = MODS[id];
      shown = createModuleFrame({ variant: 'page', title: m.name, icon: m.icon, tint: m.tint, titlebar: { add: { label: m.add }, close: true, standard: { window: false, popout: false } }, toolbar: m.toolbar(), content: m.body(), status: m.status });
      view.textContent = ''; view.append(shown.el);
      for (const b of tabs.children) b.setAttribute('aria-current', String(b.dataset.id === id));
    };
    for (const [id, icon, name] of [['call', 'video', 'Call'], ['chat', 'comments', 'Chat'], ['todo', 'list-check', 'To-do'], ['polls', 'square-poll-vertical', 'Polls'], ['budget', 'wallet', 'Budget']]) {
      const b = h('button', 'pps-tab'); b.type = 'button'; b.dataset.id = id; b.append(fa(icon), h('span', '', name));
      b.addEventListener('click', () => { if (MODS[id]) show(id); });
      if (!MODS[id]) b.disabled = true;
      tabs.append(b);
    }
    phone.append(top, view, tabs);
    s.append(phone);
    show('polls');
  });
}

// 12. The recommendations and the questions
{
  const s = part('questions', 'Recommendations, and what the plan leaves open', '');
  const ul = h('ul', 'pps-list-words');
  for (const t of [
    'Drop zones: A, labelled from the start. On a finger there is no hover, so zones that only appear under the pointer are never seen; A shows every place the moment the title bar lifts. A screen reader hears nothing from either (the zones are for the eye; the menu does the same job), and in A the meaning is in the words, not in the colour alone.',
    'Divider: A, a band with a grip. A finger has no pointer to find a thin line with, and the grip says "this moves" before anyone touches it; it keeps the plan\'s hit area of 24 pixels (44 is the open question below). For a screen reader both are the same separator with a name and a value, and in A the band is visible without its colour changing.',
    'A collapsed section: A, its title bar alone, the chevron at its start. It costs a finger one 44 pixel button, the same one as when the section is open. A screen reader hears "Collapse Polls" or "Expand Polls" with its state, and what is folded is not read; B adds a status that is read as part of the title, which is words rather than colour but makes the title long in a narrow column.',
    'Stack with...: A, one list with Above and Below under each column. A finger or a keyboard reaches every place in one open menu and one pick, and a screen reader reads the heading and then the places in order; B takes two menus, the second opening away from the first, which is one more step to find and to leave. Both say in words, not colour, when a column is full.',
    'Open: the plan asks for a 24 pixel hit area on the divider for a finger and, under Accessibility, 44 by 44; 44 reaches over the title bar\'s buttons. Which?',
    'Open: does "120 pixels of content" include the toolbar and the status bar? Drawn as the plan reads (title bar + 120 = 156 in all); with a toolbar and a status bar that leaves about 56 pixels of real content (title 36 + toolbar 40 + status 24 = 100 of the 156). On a 700 pixel canvas three sections get about 128 pixels of content each ((700 - 16) / 3 = 228, less the same 100), not the plan\'s "about 180". Thomas to choose the least.',
    'Open: the plan says the outer quarter of a column moves it between columns. Drawn as an eighth at each side (a quarter of the width in all, at least 24 pixels), so the middle half keeps "Stack above Budget" whole in a 240 pixel column. A quarter at each side would leave half the column for stacking.',
    'Proposal (not in the plan): the last open section of a stack cannot be collapsed. Without it, collapsing both sections of a stack of two leaves the rest of the column empty. Its chevron says so ("The last open one stays open.") and the menu entry is off with that reason; opening another one lets the first collapse.',
    'Open: a short canvas collapses the lowest sections by itself, and also refuses a new stack ("The canvas is too short to stack here."). Drawn: refused when the new stack could not give every section its least.',
  ]) ul.append(h('li', '', t));
  s.append(ul);
}

// After the other sections; each part is drawn when it comes near the screen, so the page stays light.
main.append(sec);
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const it = lazy.find((x) => x.s === e.target);
    if (!it || it.done) continue;
    it.done = true;
    io.unobserve(e.target);
    it.draw();
  }
}, { rootMargin: '600px 0px' });
for (const it of lazy) io.observe(it.s);
// The page's own jump list (prototype-phone.js; the Vault moves it into the dock): one more button.
const pageJump = D.querySelector('nav.pp-jump[aria-label="Jump to a section of the page"]');
if (pageJump) {
  const b = h('button', 'btn btn-small', 'Panel stacking');
  b.type = 'button';
  b.addEventListener('click', () => title.scrollIntoView({ block: 'start' }));
  pageJump.append(b);
}
// The address #pp-panel-stacking: the section is drawn after the page loads, so go there once it is.
if (location.hash === '#pp-panel-stacking' || location.hash.startsWith('#pps-')) {
  const go = () => D.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  requestAnimationFrame(go);
  addEventListener('load', () => setTimeout(go, 300), { once: true });
}
window.stackingSection ={ splitHeights, SECTION_MIN, MAX };
