// ---- documents-lib-t-editor-pages.js: real pages while typing in the rich editor (Paper above the narrow floor) ----------------
//
// The top-level blocks stay one flow in one tall sheet; nothing is added to the text. A plugin keeps SPACERS (decorations, not
// content) before the block that starts each new page. A spacer fills the rest of the page's text area, the bottom margin, a gap
// and the next page's top margin, so the next block starts at the top of the next page's text area. A manual break (page_break)
// is its own spacer (a node decoration on the break) and hides its dashed line. Whole blocks move (dlPageBreaks); a grid is ONE
// block here (it is not split by rows while editing): one that fits moves whole, a taller one gets a page of its own and runs past
// the bottom margin. The reading view keeps splitting grids by rows (documents.js, paginateRead).
const DL_EDITOR_GAP = 16; // px between two pages while editing: the reading view's gap (--space-4)
const DL_EDITOR_PAUSE = 150; // ms of quiet after typing before the heights are read

// blocks: [{ height, kind }] for the top-level blocks in order (kind 'heading' | 'code' | 'pagebreak', else a block; a grid is
// a block); geometry: { textH, margin, gap } in px. A page is one `pitch` from the next: textH + 2 margins + gap. A block taller
// than a page takes more than one pitch (the next page starts after it).
// -> { spacers: [{ beforeIndex, height, pageNumber, isManualBreak }], lastPad, pages }
//    beforeIndex: the block the spacer stands before (for a manual break, the break itself); pageNumber: the page that ends here;
//    lastPad: what the last page still needs below its blocks to be a whole page; pages: how many pages there are (at least 1).
function dlEditorPages(blocks, geometry) {
  const g = geometry || {};
  const textH = Number.isFinite(g.textH) && g.textH > 0 ? g.textH : 1;
  const margin = Number.isFinite(g.margin) && g.margin >= 0 ? g.margin : 0;
  const gap = Number.isFinite(g.gap) && g.gap >= 0 ? g.gap : 0;
  const pitch = textH + 2 * margin + gap;
  const list = (Array.isArray(blocks) ? blocks : []).map((b) => {
    const k = b && b.kind;
    return { height: b && Number.isFinite(b.height) && b.height > 0 ? b.height : 0, kind: k === 'pagebreak' || k === 'heading' || k === 'code' ? k : 'block' };
  });
  const r = dlPageBreaks(list, textH);
  const spacers = r.before.map((i) => ({ beforeIndex: i, height: 0, pageNumber: 0, isManualBreak: true }));
  let ph = 1; // the physical page the next logical page starts on
  let lastPad = r.pages.length ? 0 : textH;
  r.pages.forEach((p, n) => {
    const used = p.items.reduce((a, it) => a + list[it.i].height, 0);
    const k = Math.max(1, Math.ceil((used + pitch - textH) / pitch - 1e-9));
    const last = n === r.pages.length - 1;
    const pageNumber = ph + k - 1;
    const rest = Math.max(0, k * pitch - used - (pitch - textH)); // what is left of the page's text area
    if (p.breaks.length) {
      const brk = p.breaks[p.breaks.length - 1];
      const end = last && brk === list.length - 1; // a break at the very end ends the last page and starts none
      spacers.push({ beforeIndex: brk, height: end ? rest : k * pitch - used, pageNumber, isManualBreak: true });
      if (last) lastPad = 0;
    } else if (!last && r.pages[n + 1].items.length) {
      spacers.push({ beforeIndex: r.pages[n + 1].items[0].i, height: k * pitch - used, pageNumber, isManualBreak: false });
    } else if (last) lastPad = rest;
    ph += k;
  });
  return { spacers, lastPad, pages: Math.max(1, ph - 1) };
}

// The heights as the editor draws them: the distance from one top-level block to the next element, in unscaled px (a CSS zoom on
// an ancestor is divided out). The spacers are hidden for the reading (class dl-measuring), so the blocks flow naturally. A
// manual break has no height of its own. The array's `head` is the height above the first block in the sheet. -> [{ height, kind }] or null when the DOM does not match the document.
function dlEditorRead(PM, view) {
  const root = view.dom;
  const doc = view.state.doc;
  if (!root || typeof root.getBoundingClientRect !== 'function') return null;
  const kids = [...root.children].filter((c) => !c.classList.contains('dl-pgsp') || c.classList.contains('dl-pgsp-break'));
  if (kids.length !== doc.childCount) return null;
  root.classList.add('dl-measuring');
  try {
    const box = root.getBoundingClientRect();
    const scale = root.offsetWidth > 0 && box.width > 0 ? box.width / root.offsetWidth : 1;
    const tops = kids.map((c) => c.getBoundingClientRect().top / scale);
    const foot = box.bottom / scale - (parseFloat(root.style.paddingBottom) || 0);
    const last = kids[kids.length - 1];
    const out = [];
    doc.forEach((node, offset, i) => {
      const kind = node.type.name === 'page_break' ? 'pagebreak' : node.type.name === 'heading' ? 'heading' : node.type.name === 'code_block' ? 'code' : 'block';
      const end = i + 1 < kids.length ? tops[i + 1] : Math.min(foot, last.getBoundingClientRect().bottom / scale);
      out.push({ height: kind === 'pagebreak' ? 0 : Math.max(0, end - tops[i]), kind });
    });
    // what stands above the editor in the sheet (the title, the line under it, the tags) is the first thing on the first page, as the reading view has it
    const sheet = root.closest ? root.closest('.sheet-edit') : null;
    if (sheet) {
      const cs = getComputedStyle(sheet);
      const content = sheet.getBoundingClientRect().top / scale + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
      out.head = Math.max(0, tops[0] - content) + (parseFloat(cs.getPropertyValue('--dl-meta-h')) || 0); // plus the reading view's line under the title, which the editor does not show
    }
    return out;
  } finally { root.classList.remove('dl-measuring'); }
}

// The plugin and its controller. `env`: doc (the page's document, to make a spacer), and for tests read(view) -> blocks, after(fn, ms) -> cancel function.
// The decorations are the plugin's state, changed only by a transaction with the meta key (no change of the text, no revision,
// no undo step). -> { plugin, key, setPaged(view, on, sizeKey), measure(view), info(state), paged(), destroy() }
function dlEditorPagesPlugin(PM, env) {
  const e = env || {};
  const key = new PM.PluginKey('dlPages');
  const read = e.read || ((view) => dlEditorRead(PM, view));
  const after = e.after || ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
  let on = false;
  let sizeKey = 'letter';
  let cancel = null;
  let current = null; // the view
  const empty = { set: PM.DecorationSet.empty, spacers: [], lastPad: 0, pages: 1, on: false, sizeKey: '' };
  const posOf = (doc, index) => { let p = 0; for (let i = 0; i < index && i < doc.childCount; i += 1) p += doc.child(i).nodeSize; return p; };
  const build = (doc, spacers) => {
    const decos = [];
    for (const s of spacers) {
      if (s.beforeIndex >= doc.childCount) continue;
      const at = posOf(doc, s.beforeIndex);
      const h = `${Math.round(s.height * 100) / 100}px`;
      if (s.isManualBreak) {
        const end = Boolean(s.atEnd);
        decos.push(PM.Decoration.node(at, at + doc.child(s.beforeIndex).nodeSize, { class: end ? 'dl-pgsp dl-pgsp-break dl-pgsp-end' : 'dl-pgsp dl-pgsp-break', style: `height:${h}`, 'data-num': String(s.pageNumber) }));
      } else {
        const rest = Math.max(0, s.height - 2 * (s.margin || 0) - DL_EDITOR_GAP);
        decos.push(PM.Decoration.widget(at, () => {
          const el = e.doc.createElement('div');
          el.className = 'dl-pgsp';
          el.setAttribute('contenteditable', 'false');
          el.setAttribute('aria-hidden', 'true');
          el.style.height = h;
          el.setAttribute('data-num', String(s.pageNumber));
          el.style.setProperty('--sp-top', `${rest + (s.margin || 0)}px`);
          return el;
        }, { side: -1, ignoreSelection: true, key: `pg-${s.beforeIndex}-${h}-${s.margin || 0}-${s.pageNumber}`, stopEvent: () => true }));
      }
    }
    return decos.length ? PM.DecorationSet.create(doc, decos) : PM.DecorationSet.empty;
  };
  const plugin = new PM.Plugin({
    key,
    state: {
      init: () => empty,
      apply(tr, value) {
        const m = tr.getMeta(key);
        if (m) return { set: build(tr.doc, m.spacers), spacers: m.spacers, lastPad: m.lastPad, pages: m.pages, on: m.on, sizeKey: m.sizeKey };
        return tr.docChanged && value.set !== PM.DecorationSet.empty ? { ...value, set: value.set.map(tr.mapping, tr.doc) } : value;
      },
    },
    props: { decorations: (state) => key.getState(state).set },
    view(v) {
      current = v;
      return {
        update(view, prev) {
          const now = key.getState(view.state);
          if (view.dom && view.dom.style && key.getState(prev) !== now) {
            view.dom.style.paddingBottom = now.on && now.lastPad ? `${now.lastPad}px` : '';
            if (now.on) view.dom.setAttribute('data-lastnum', String(now.pages)); else view.dom.removeAttribute('data-lastnum');
          }
          if (on && prev.doc !== view.state.doc) ctl.schedule(view);
        },
        destroy() { if (cancel) cancel(); cancel = null; current = null; },
      };
    },
  });
  // A spacer set that moves the caret's block can push the caret out of the view: scroll the nearest scrolling ancestor just enough to bring the caret line back, and not at all when it is still in view.
  const keepInView = (v) => {
    if (!v.hasFocus || !v.hasFocus() || !v.state.selection.empty) return;
    let box = v.dom.parentElement;
    while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
    if (!box) return;
    let c; try { c = v.coordsAtPos(v.state.selection.head); } catch (e) { return; }
    const r = box.getBoundingClientRect(); const pad = 24;
    if (c.bottom > r.bottom - pad) box.scrollTop += c.bottom - r.bottom + pad;
    else if (c.top < r.top + pad) box.scrollTop -= r.top + pad - c.top;
  };
  const ctl = {
    plugin,
    key,
    paged: () => on,
    info: (state) => { const s = key.getState(state); return { pages: s.pages, spacers: s.spacers.slice() }; },
    // After a pause: readings are never taken for a key, and never during composition.
    schedule(view, ms) {
      if (cancel) cancel();
      cancel = after(() => { cancel = null; ctl.measure(view); }, ms === undefined ? DL_EDITOR_PAUSE : ms);
    },
    // Reads the heights and puts the spacers in. -> true when something was dispatched.
    measure(view) {
      const v = view || current;
      if (!v) return false;
      const was = key.getState(v.state);
      if (!on) {
        if (!was.on && !was.spacers.length) return false;
        v.dispatch(v.state.tr.setMeta(key, { spacers: [], lastPad: 0, pages: 1, on: false, sizeKey }).setMeta('addToHistory', false));
        return true;
      }
      if (v.composing) { ctl.schedule(v); return false; }
      const blocks = read(v);
      if (!blocks) return false;
      const g = dlPageGeometry(sizeKey);
      const head = blocks.head > 0 ? 1 : 0; // the title above the editor stands in as the first block (a heading, so it stays with what follows)
      const made = dlEditorPages(head ? [{ height: blocks.head, kind: 'heading' }, ...blocks] : blocks, { textH: g.textH, margin: g.margin, gap: DL_EDITOR_GAP });
      const spacers = made.spacers.map((s) => ({ ...s, atEnd: s.isManualBreak && s.beforeIndex - head === (blocks.length - 1) && s.pageNumber === made.pages, beforeIndex: s.beforeIndex - head, margin: g.margin, height: Math.round(s.height * 100) / 100 }));
      const same = was.on && was.sizeKey === sizeKey && was.pages === made.pages && Math.abs(was.lastPad - made.lastPad) < 0.5
        && was.spacers.length === spacers.length && spacers.every((s, i) => s.beforeIndex === was.spacers[i].beforeIndex && Math.abs(s.height - was.spacers[i].height) < 0.5 && s.isManualBreak === was.spacers[i].isManualBreak);
      if (same) return false;
      v.dispatch(v.state.tr.setMeta(key, { spacers, lastPad: Math.round(made.lastPad * 100) / 100, pages: made.pages, on: true, sizeKey }).setMeta('addToHistory', false));
      keepInView(v);
      return true;
    },
    // Paper above the narrow floor pages the editor (on, with the page size); Fluid and narrow hold no spacers.
    setPaged(view, flag, size) {
      const v = view || current;
      const next = Boolean(flag);
      const sk = size === 'a4' ? 'a4' : 'letter';
      if (next === on && sk === sizeKey) return;
      on = next; sizeKey = sk;
      if (cancel) { cancel(); cancel = null; }
      if (v) ctl.measure(v);
    },
    destroy() { if (cancel) cancel(); cancel = null; current = null; },
  };
  return ctl;
}
