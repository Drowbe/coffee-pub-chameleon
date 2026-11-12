// ---- documents-lib-t-coedit-gate.js: what a shared document lets in, and how it is mended (no page, no host) -----------------------
//
// Co-editing step 3 (plan-documents-coediting.md). Pure pieces the sync step (step 4) plugs in; nothing here touches a view, the
// network or storage. `PM` is the vendored bundle (documents-lib-0-prosemirror.js), handed in as everywhere else, so these run in a test.
//
//   dlCoeditGate(PM) -> {
//     gateUpdate(doc, update, limits)           THE REFERENCE CHECK. Is this remote update safe to apply to `doc`? It copies the live state
//                                               into a scratch document, applies the update there and walks the WHOLE result. Exact, slow
//                                               on a big document; used for large updates (a pulled snapshot) and as the test of the fast path.
//     guard(doc, limits, opts)                  THE LIVE CHECK. Keeps a shadow of `doc` and checks only what an update touched.
//                                               guard.receive(update, sender) checks, and only an ok update is applied to `doc`.
//     rebuildFromGood(snapshotBytes, limits)    a fresh document from the last good snapshot (when applying or drawing an update threw)
//     verifyBeforeSnapshot(lex, doc, text, limits)  may this state be written as the snapshot? (renders, writes the Markdown, compares)
//     repairGrids(doc)                          pads short grid rows, in ONE local transaction; for the WRITER's page only
//     plugins(frag, opts)                       the editor's plugin list for a shared document (no history, no grid repair of its own)
//     dlCoeditRefusals(opts)                            counts refusals per sender within a window; flags a sender
//   }
//
// WHAT IS REFUSED (reason -> why). too_big: over the byte cap, refused BEFORE it is decoded. not_an_update, throws: the bytes do not
// decode or the library threw (a top-level XmlText throws out of applyUpdate and poisons the document). pending: an update whose
// predecessor is missing; it is not applied half (the sync asks for the difference instead). unknown_root: a shared type that is not the
// document. top_level_text, unknown_type: the top level holds anything but our block elements. depth, nodes, text: past the bounds.
// unknown_element, attrs, grid_span, marks, nesting, schema: a name, attribute, mark or place our schema does not have.
// WHAT IS NOT REFUSED. A node with too LITTLE in it (a grid with no rows, a row with no cells, an emptied list): two people each deleting
// the other half produce it, so refusing it would stop two honest peers from ever agreeing. The binding (y-prosemirror) removes such a
// node from the shared document, the same way on every peer. A grid whose rows differ in width is applied too (a row added while a column
// is added); the writer's page repairs it (repairGrids).
//
// COST (measured in Node on a 150,000-character document of about 1,200 blocks, p50 / p95 per update). The reference check, which copies
// the state: 6.8 / 9.7 ms. The live check, which applies the update to a shadow kept in step and walks only the top-level blocks the update
// touched: 0.06 / 0.12 ms for a typed character (a plain applyUpdate is 0.02 / 0.03). The shadow costs about 1.8 MB and is made by the first
// check (about 25 ms). A refusal poisons the shadow, so the next check makes it again (the same copy, once). The whole-document totals
// (nodes, text) are kept as an upper bound (the earlier total plus the bytes of every update, since a struct is at least a byte) and measured
// exactly only when that bound passes the cap. check-documents-coedit-gate.mjs prints the numbers each run.
const DL_COEDIT = Object.freeze({
  liveBytes: 65536, // one live update
  snapshotBytes: 1048576, // a snapshot, or a pull
  depth: 64, // element levels below the document
  nodes: 20000, // elements and text runs in the whole document
  textChars: 1572864, // 1.5 MB of text in the whole document
  root: 'prosemirror', // the one shared type that is the document
  refusalsMax: 5, // refusals from one sender within the window flag the sender
  refusalsWindowMs: 60000,
  marksJsonMax: 4000, // the _marks attribute of an atom
});

const DL_COEDIT_MARK_SUFFIX = /^(.*)(--[a-zA-Z0-9+/=]{8})$/; // y-prosemirror names a mark that may repeat "name--hash"

// A refusal travels as a thrown object so the walkers can stay plain.
function dlCoeditStop(reason, detail) { return { dlCoeditStop: true, reason, detail: String(detail === undefined ? '' : detail).slice(0, 160) }; }

const dlCoeditGates = new WeakMap();
function dlCoeditGate(PM) {
  if (dlCoeditGates.has(PM)) return dlCoeditGates.get(PM);
  const schema = dlRichSchema(PM);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isEl = (v) => v instanceof PM.XmlElement;
  const isTx = (v) => v instanceof PM.XmlText;
  const docMatch = schema.nodes.doc.contentMatch;
  const topOk = (name) => own(schema.nodes, name) && name !== 'doc' && name !== 'text' && docMatch.matchType(schema.nodes[name]) !== null;
  const lim = (limits) => ({ ...DL_COEDIT, ...(limits || {}) });
  const SELF = { SHADOW: 'dl-gate-shadow', LIVE: 'dl-gate-live', SEED: 'dl-gate-seed' };

  // ---- the walk of one block, on the shared type, with no recursion (a hostile chain 8,000 deep must not overflow the stack) -----
  // -> { nodes, text } or throws a stop.
  function scanBlock(block, rules, spent) {
    const stack = [block];
    const depthOf = new Map([[block, 1]]);
    let nodes = 0; let text = 0;
    while (stack.length) {
      const el = stack.pop();
      const depth = depthOf.get(el);
      depthOf.delete(el);
      if (depth > rules.depth) throw dlCoeditStop('depth', `more than ${rules.depth} levels`);
      nodes += 1;
      if (spent.nodes + nodes > rules.nodes) throw dlCoeditStop('nodes', `more than ${rules.nodes} nodes`);
      const name = el.nodeName;
      if (!own(schema.nodes, name) || name === 'doc' || name === 'text') throw dlCoeditStop('unknown_element', name);
      const spec = schema.nodes[name].spec;
      const attrs = el.getAttributes();
      for (const k of Object.keys(attrs)) {
        if (k === '_marks') {
          if (typeof attrs[k] !== 'string' || attrs[k].length > rules.marksJsonMax) throw dlCoeditStop('marks', 'the marks of an atom');
          continue;
        }
        if (!spec.attrs || !own(spec.attrs, k)) throw dlCoeditStop('attrs', `${name}.${k}`);
        const v = attrs[k];
        if (!(v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) throw dlCoeditStop('attrs', `${name}.${k} is not a plain value`);
      }
      if (spec.gridRole === 'cell' || spec.gridRole === 'header_cell') {
        if ((attrs.colspan !== undefined && attrs.colspan !== 1) || (attrs.rowspan !== undefined && attrs.rowspan !== 1) || (attrs.colwidth !== undefined && attrs.colwidth !== null)) throw dlCoeditStop('grid_span', `${name} span or width`);
      }
      for (const c of el.toArray()) {
        if (isEl(c)) { depthOf.set(c, depth + 1); stack.push(c); } else if (isTx(c)) {
          nodes += 1; text += c.length;
          if (spent.text + text > rules.textChars) throw dlCoeditStop('text', `more than ${rules.textChars} characters`);
        } else throw dlCoeditStop('unknown_type', 'a shared type that is not an element or text');
      }
    }
    return { nodes, text };
  }

  // ---- the same block as a ProseMirror node (recursion is safe: scanBlock bounded the depth) --------------------------------------
  function toNode(el) {
    const type = schema.nodes[el.nodeName];
    const attrs = el.getAttributes();
    let marks = null;
    if (attrs._marks !== undefined) {
      let list;
      try { list = JSON.parse(attrs._marks); } catch (e) { throw dlCoeditStop('marks', 'the marks of an atom are not JSON'); }
      if (!Array.isArray(list) || list.length > 8) throw dlCoeditStop('marks', 'the marks of an atom');
      marks = list.map((m) => {
        if (!m || typeof m.type !== 'string' || !own(schema.marks, m.type)) throw dlCoeditStop('marks', `unknown mark ${String(m && m.type).slice(0, 40)}`);
        try { return schema.marks[m.type].create(m.attrs || null); } catch (e) { throw dlCoeditStop('marks', `${m.type}: ${e.message}`); }
      });
      delete attrs._marks;
    }
    const kids = [];
    for (const c of el.toArray()) {
      if (isEl(c)) kids.push(toNode(c));
      else {
        for (const d of c.toDelta()) {
          if (typeof d.insert !== 'string') throw dlCoeditStop('unknown_type', 'an embedded value in text');
          if (!d.insert) continue;
          const ms = [];
          for (const k of Object.keys(d.attributes || {})) {
            const m = DL_COEDIT_MARK_SUFFIX.exec(k);
            const name = m ? m[1] : k;
            if (!own(schema.marks, name)) throw dlCoeditStop('marks', `unknown mark ${name.slice(0, 40)}`);
            try { ms.push(schema.marks[name].create(d.attributes[k])); } catch (e) { throw dlCoeditStop('marks', `${name}: ${e.message}`); }
          }
          kids.push(schema.text(d.insert, ms));
        }
      }
    }
    try { return type.create(attrs, kids, marks); } catch (e) { throw dlCoeditStop('attrs', `${el.nodeName}: ${e.message}`); }
  }

  // The first thing wrong with a node's content, other than having too little. -> null, 'underfilled' (tolerated) or a stop reason.
  function problem(root) {
    let under = false;
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (n.isText) continue;
      let match = n.type.contentMatch;
      for (let i = 0; i < n.childCount; i += 1) {
        const c = n.child(i);
        match = match.matchType(c.type);
        if (!match) return ['nesting', `${c.type.name} in ${n.type.name}`];
        if (!n.type.allowsMarks(c.marks)) return ['marks', `${c.marks[0] && c.marks[0].type.name} in ${n.type.name}`];
        stack.push(c);
      }
      if (!match.validEnd) under = true;
    }
    return under ? ['underfilled', ''] : null;
  }

  // One top-level block: the walk, then the ProseMirror node and its checks. -> { nodes, text, underfilled }
  function checkBlock(block, rules, spent) {
    const m = scanBlock(block, rules, spent);
    if (!topOk(block.nodeName)) throw dlCoeditStop('nesting', `${block.nodeName} at the top level`);
    let node;
    try { node = toNode(block); } catch (e) { if (e && e.dlCoeditStop) throw e; throw dlCoeditStop('schema', e && e.message); }
    const p = problem(node);
    if (p && p[0] !== 'underfilled') throw dlCoeditStop(p[0], p[1]);
    return { ...m, underfilled: Boolean(p) };
  }

  // The top-level items of the fragment, in order. A new one is one made after `before` (a state vector map), or every one when null.
  function* topItems(frag, before) {
    for (let it = frag._first; it !== null; it = it.right) {
      if (it.deleted) continue;
      if (before && it.id.clock < (before.get(it.id.client) || 0)) continue;
      yield it;
    }
  }
  function topBlocks(item) {
    const out = [];
    for (const v of item.content.getContent()) {
      if (isEl(v)) out.push(v);
      else if (isTx(v)) throw dlCoeditStop('top_level_text', 'text directly at the top level');
      else throw dlCoeditStop('unknown_type', 'something that is not a block at the top level');
    }
    return out;
  }
  function checkRoots(doc, rules) {
    for (const k of doc.share.keys()) if (k !== rules.root) throw dlCoeditStop('unknown_root', k);
  }

  // The whole fragment. -> { nodes, text, blocks, underfilled }
  function checkAll(doc, rules) {
    checkRoots(doc, rules);
    const frag = doc.getXmlFragment(rules.root);
    const spent = { nodes: 0, text: 0 };
    let blocks = 0; let underfilled = 0;
    for (const it of topItems(frag, null)) {
      for (const b of topBlocks(it)) {
        const r = checkBlock(b, rules, spent);
        spent.nodes += r.nodes; spent.text += r.text; blocks += 1; if (r.underfilled) underfilled += 1;
      }
    }
    return { nodes: spent.nodes, text: spent.text, blocks, underfilled };
  }

  const fail = (reason, detail, extra) => ({ ok: false, reason, detail: detail || '', ...(extra || {}) });
  const asStop = (e) => (e && e.dlCoeditStop ? fail(e.reason, e.detail) : fail('throws', e && e.message ? String(e.message).slice(0, 160) : String(e).slice(0, 160)));
  const readable = (update) => update instanceof Uint8Array && update.length > 0;

  // ---- the reference check ----------------------------------------------------------------------------------------------------------
  function gateUpdate(doc, update, limits) {
    const rules = lim(limits);
    const cap = limits && limits.bytes ? limits.bytes : rules.liveBytes;
    if (!readable(update)) return fail('not_an_update', 'not bytes');
    if (update.length > cap) return fail('too_big', `${update.length} bytes, at most ${cap}`);
    const scratch = new PM.Doc();
    try {
      PM.applyUpdate(scratch, PM.encodeStateAsUpdate(doc), SELF.SEED);
      try { PM.applyUpdate(scratch, update, SELF.SHADOW); } catch (e) { return fail('throws', String(e && e.message).slice(0, 160)); }
      if (scratch.store.pendingStructs || scratch.store.pendingDs) return fail('pending', 'the update needs something this copy does not have yet');
      const t = checkAll(scratch, rules);
      return { ok: true, nodes: t.nodes, text: t.text, blocks: t.blocks, underfilled: t.underfilled };
    } catch (e) { return asStop(e); } finally { scratch.destroy(); }
  }

  // ---- the live check ---------------------------------------------------------------------------------------------------------------
  // `doc` is the live document. The guard keeps `shadow`, a copy that follows `doc` (every change of `doc` not made by the guard is
  // applied to the shadow too). receive() applies an update to the shadow, looks at what it touched, and only then to `doc`.
  function guard(doc, limits, opts) {
    const rules = lim(limits);
    const o = opts || {};
    const counter = o.refusals || dlCoeditRefusals({ max: rules.refusalsMax, windowMs: rules.refusalsWindowMs, now: o.now });
    const st = { applying: false, shadow: null, dirty: true, nodes: 0, text: 0, accepted: 0, refused: 0, reseeds: 0, lastChanged: null, lastBefore: null };
    const onTx = (tr) => { st.lastChanged = tr.changed; st.lastBefore = tr.beforeState; };
    const onLive = (u) => {
      if (st.applying || !st.shadow || st.dirty) return;
      try { PM.applyUpdate(st.shadow, u, SELF.SHADOW); } catch (e) { st.dirty = true; }
    };
    doc.on('update', onLive);
    const reseed = () => {
      if (st.shadow) { st.shadow.off('afterTransaction', onTx); st.shadow.destroy(); }
      st.shadow = new PM.Doc();
      PM.applyUpdate(st.shadow, PM.encodeStateAsUpdate(doc), SELF.SEED);
      st.shadow.on('afterTransaction', onTx);
      const t = checkAll(st.shadow, { ...rules, nodes: Infinity, textChars: Infinity });
      st.nodes = t.nodes; st.text = t.text; st.dirty = false; st.reseeds += 1;
    };
    // The block each changed type belongs to (a type changed at the top level means: look at the new top-level items).
    function touched(frag) {
      const blocks = new Set(); let top = false;
      const changed = st.lastChanged;
      if (!changed) return { blocks, top: true };
      for (const t of changed.keys()) {
        if (t === frag) { top = true; continue; }
        if (t._item === null) throw dlCoeditStop('unknown_root', 'a change outside the shared text');
        if (t._item.deleted) continue;
        let x = t; let steps = 0;
        while (x._item !== null && x._item.parent !== frag) {
          x = x._item.parent;
          steps += 1;
          if (steps > rules.depth + 1 || x === null || x._item === null) throw dlCoeditStop('depth', 'the change sits deeper than the bound');
        }
        if (x._item === null) throw dlCoeditStop('unknown_root', 'a change outside the shared text');
        if (!x._item.deleted) blocks.add(x);
      }
      return { blocks, top };
    }
    function receive(update, sender) {
      if (sender !== undefined && counter.flagged(sender)) return fail('sender_flagged', 'too many refused updates from this sender', { flagged: true, applied: false });
      const r = check(update);
      if (!r.ok) { r.flagged = sender !== undefined ? counter.note(sender, r.reason === 'pending' ? 0.1 : 1) : false; r.applied = false; st.refused += 1; return r; }
      st.applying = true;
      try { PM.applyUpdate(doc, update, o.origin === undefined ? SELF.LIVE : o.origin); } catch (e) {
        st.dirty = true;
        const f = fail('live_threw', String(e && e.message).slice(0, 160), { applied: false, rebuild: true });
        f.flagged = sender !== undefined ? counter.note(sender) : false; st.refused += 1; return f;
      } finally { st.applying = false; }
      st.accepted += 1;
      return r;
    }
    function check(update) {
      const t0 = Date.now();
      if (!readable(update)) return fail('not_an_update', 'not bytes');
      if (update.length > rules.liveBytes && !(o.bytes && update.length <= o.bytes)) return fail('too_big', `${update.length} bytes, at most ${rules.liveBytes}`);
      try {
        if (st.dirty) reseed();
        const shadow = st.shadow;
        const frag = shadow.getXmlFragment(rules.root);
        st.lastChanged = null; st.lastBefore = null;
        try { PM.applyUpdate(shadow, update, SELF.SHADOW); } catch (e) { st.dirty = true; return fail('throws', String(e && e.message).slice(0, 160)); }
        if (shadow.store.pendingStructs || shadow.store.pendingDs) { st.dirty = true; return fail('pending', 'the update needs something this copy does not have yet'); }
        checkRoots(shadow, rules);
        const { blocks, top } = touched(frag);
        const spent = { nodes: 0, text: 0 };
        let underfilled = 0;
        const seen = new Set();
        const one = (b) => { if (seen.has(b)) return; seen.add(b); const r = checkBlock(b, rules, { nodes: 0, text: 0 }); spent.nodes += r.nodes; if (r.underfilled) underfilled += 1; };
        if (top) for (const it of topItems(frag, st.lastBefore)) for (const b of topBlocks(it)) one(b);
        for (const b of blocks) one(b);
        // the whole-document totals: an upper bound, exact only when the bound passes the cap
        st.nodes += update.length; st.text += update.length;
        if (st.nodes > rules.nodes || st.text > rules.textChars) {
          const t = checkAll(shadow, rules);
          st.nodes = t.nodes; st.text = t.text;
        }
        return { ok: true, ms: Date.now() - t0, touched: seen.size, underfilled };
      } catch (e) { st.dirty = true; return asStop(e); }
    }
    return {
      receive, // -> { ok, applied?, reason, detail, flagged, rebuild }
      stats: () => ({ accepted: st.accepted, refused: st.refused, reseeds: st.reseeds, nodesBound: st.nodes, textBound: st.text }),
      // after the live document was replaced or mended outside the guard, or applyUpdate threw on it
      reseed: () => { st.dirty = true; },
      // make the shadow now (otherwise the first check does)
      prime: () => { if (st.dirty) reseed(); },
      refusals: counter,
      destroy() { doc.off('update', onLive); if (st.shadow) { st.shadow.off('afterTransaction', onTx); st.shadow.destroy(); st.shadow = null; } },
    };
  }

  // ---- recovery ---------------------------------------------------------------------------------------------------------------------
  // -> { ok, doc, reason }. The snapshot goes through the same walk as any update, so a bad snapshot is not trusted either.
  function rebuildFromGood(snapshot, limits) {
    const rules = lim(limits);
    const cap = limits && limits.bytes ? limits.bytes : rules.snapshotBytes;
    const doc = new PM.Doc();
    if (!readable(snapshot)) return { ok: false, doc, reason: 'not_an_update', detail: 'no snapshot' };
    if (snapshot.length > cap) return { ok: false, doc, reason: 'too_big', detail: `${snapshot.length} bytes` };
    try {
      PM.applyUpdate(doc, snapshot, SELF.SEED);
      if (doc.store.pendingStructs || doc.store.pendingDs) return { ok: false, doc: new PM.Doc(), reason: 'pending', detail: 'the snapshot is incomplete' };
      checkAll(doc, rules);
      return { ok: true, doc, reason: '' };
    } catch (e) { const f = asStop(e); return { ok: false, doc: new PM.Doc(), reason: f.reason, detail: f.detail }; }
  }

  // ---- the writer's check before a snapshot is written -------------------------------------------------------------------------------
  // The state is copied (the binding mends a shared document by deleting what the schema refuses; that must happen on the copy), drawn the
  // way the editor draws it, written with the module's own writer and compared with the stored text: the text must read back as the
  // editor's text, and every stored block still in the document must be written word for word.
  // -> { ok, reason, detail, text, kept, expected, bytes }
  function verifyBeforeSnapshot(lex, doc, storedText, limits) {
    const rules = lim(limits);
    const cap = limits && limits.bytes ? limits.bytes : rules.snapshotBytes;
    const copy = new PM.Doc();
    try {
      const state = PM.encodeStateAsUpdate(doc);
      if (state.length > cap) return { ok: false, reason: 'too_big', detail: `the snapshot would be ${state.length} bytes, at most ${cap}` };
      PM.applyUpdate(copy, state, SELF.SEED);
      checkAll(copy, rules);
      const top = PM.yXmlFragmentToProseMirrorRootNode(copy.getXmlFragment(rules.root), schema);
      try { top.check(); } catch (e) { return { ok: false, reason: 'schema', detail: String(e.message).slice(0, 160) }; }
      const rd = dlRichRead(PM, String(storedText || ''), lex);
      const w = dlRichText(PM, dlRichTidy(PM, top, rd.stored), rd.stored, lex);
      if (!w.same) return { ok: false, reason: 'not_read_back', detail: 'the written text does not read back as the shared text' };
      if (w.over) return { ok: false, reason: 'text_too_long', detail: 'the text is longer than the reader reads' };
      const now = new Map();
      for (const e of dlRichRead(PM, w.text, lex).stored.entries) now.set(e.text, (now.get(e.text) || 0) + 1);
      const pool = []; top.forEach((n) => pool.push(n));
      let expected = 0; let kept = 0;
      for (const e of rd.stored.entries) {
        const i = pool.findIndex((n) => n.eq(e.node));
        if (i < 0) continue;
        pool.splice(i, 1); expected += 1;
        if (now.get(e.text) > 0) { kept += 1; now.set(e.text, now.get(e.text) - 1); }
      }
      if (kept < expected) return { ok: false, reason: 'blocks_changed', detail: `${expected - kept} of ${expected} untouched blocks are not written word for word`, text: w.text, kept, expected };
      return { ok: true, reason: '', text: w.text, kept, expected, bytes: state.length };
    } catch (e) { const f = asStop(e); return { ok: false, reason: f.reason, detail: f.detail }; } finally { copy.destroy(); }
  }

  // ---- the writer's grid repair -----------------------------------------------------------------------------------------------------
  // A row added while a column is added leaves a grid whose rows differ in width. This pads each short row to the widest, with empty cells
  // of the kind the row ends in, in one local transaction of `doc` (origin 'dl-grid-repair'). Nothing is written when every grid is
  // rectangular. Only the page that is the writer runs it; two that do it at once each add the cells, so the grid ends one or two cells
  // wider than it was and rectangular, and the next run writes nothing. -> the number of cells added.
  function repairGrids(doc, limits) {
    const rules = lim(limits);
    const frag = doc.getXmlFragment(rules.root);
    const jobs = [];
    const stack = [];
    for (const b of frag.toArray()) if (isEl(b)) stack.push(b);
    let guardN = 0;
    while (stack.length) {
      const el = stack.pop();
      if ((guardN += 1) > rules.nodes * 2) break;
      if (el.nodeName === 'grid') {
        const rows = el.toArray().filter((r) => isEl(r) && r.nodeName === 'grid_row');
        const kids = rows.map((r) => r.toArray().filter((c) => isEl(c)));
        const widest = kids.reduce((m, k) => (k.length > m.length ? k : m), []);
        rows.forEach((r, i) => { if (kids[i].length > 0 && kids[i].length < widest.length) jobs.push({ row: r, have: kids[i], widest }); });
        for (const k of kids) for (const c of k) for (const g of c.toArray()) if (isEl(g)) stack.push(g);
        continue;
      }
      for (const c of el.toArray()) if (isEl(c)) stack.push(c);
    }
    if (!jobs.length) return 0;
    let added = 0;
    doc.transact(() => {
      for (const j of jobs) {
        const kind = j.have[j.have.length - 1].nodeName;
        const cells = [];
        for (let i = j.have.length; i < j.widest.length; i += 1) {
          const c = new PM.XmlElement(kind);
          c.setAttribute('colspan', 1); c.setAttribute('rowspan', 1);
          const align = j.widest[i].getAttribute('align');
          if (align) c.setAttribute('align', align);
          cells.push(c);
        }
        j.row.insert(j.row.length, cells);
        added += cells.length;
      }
    }, 'dl-grid-repair');
    return added;
  }

  // ---- the plugins of a shared document ---------------------------------------------------------------------------------------------
  // ySync and yUndo first; then the editor's own plugins (dlRichPlugins) WITHOUT the history plugin (its undo does nothing once a remote
  // change has come in: yUndo undoes one's own changes) and with the grid library's appendTransaction (fixTables) taken off: each page
  // would repair a ragged grid on its own, both repairs would sync, and the grid would gain a column every round. opts.base: another list.
  function plugins(frag, opts) {
    const base = (opts && opts.base) || dlRichPlugins(PM);
    const gridKey = PM.gridEditing().spec.key; // the grid plugin's own key
    const kept = [];
    for (const p of base) {
      const k = String((p.spec && p.spec.key && p.spec.key.key) || p.key || '');
      if (k.startsWith('history')) continue;
      if (p.spec && p.spec.key === gridKey && p.spec.appendTransaction) { kept.push(new PM.Plugin({ ...p.spec, appendTransaction: undefined })); continue; }
      kept.push(p);
    }
    return [PM.ySyncPlugin(frag), PM.yUndoPlugin((opts && opts.undo) || {}), ...kept];
  }

  const api = { gateUpdate, guard, rebuildFromGood, verifyBeforeSnapshot, repairGrids, plugins, refusals: dlCoeditRefusals, limits: DL_COEDIT, schema };
  dlCoeditGates.set(PM, api);
  return api;
}

// How many updates a sender had refused lately. note(sender, weight) counts one refusal (a `pending` one counts a tenth: a lossy
// network makes those without any fault) and returns true once the sender is flagged (the weights reach max within windowMs);
// flagged(sender) asks; clear(sender) forgets. `now` is a clock for tests.
function dlCoeditRefusals(o) {
  const max = (o && o.max) || DL_COEDIT.refusalsMax;
  const windowMs = (o && o.windowMs) || DL_COEDIT.refusalsWindowMs;
  const now = (o && o.now) || (() => Date.now());
  const by = new Map();
  const recent = (sender) => { const t = now(); const l = (by.get(sender) || []).filter((x) => t - x.t < windowMs); if (l.length) by.set(sender, l); else by.delete(sender); return l; };
  const sum = (l) => l.reduce((a, x) => a + x.w, 0);
  return {
    note(sender, weight) { const l = recent(sender); l.push({ t: now(), w: weight === undefined ? 1 : weight }); by.set(sender, l); return sum(l) >= max - 1e-9; },
    flagged: (sender) => sum(recent(sender)) >= max - 1e-9,
    count: (sender) => sum(recent(sender)),
    clear: (sender) => { by.delete(sender); },
  };
}
