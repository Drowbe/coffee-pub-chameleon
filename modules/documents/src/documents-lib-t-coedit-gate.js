// ---- documents-lib-t-coedit-gate.js: what a shared document lets in, and how it is mended (no page, no host) -----------------------
//
// Co-editing step 3 (plan-documents-coediting.md). Pure pieces the sync step (step 4) plugs in; nothing here touches a view, the
// network or storage. `PM` is the vendored bundle (documents-lib-0-prosemirror.js), handed in as everywhere else, so these run in a test.
//
// THE INVARIANT. Whatever the gate accepts, verifyBeforeSnapshot accepts: no update the gate lets in can stop the writer from saving a snapshot.
// It holds because the gate refuses everything the writer cannot write and read back as the same blocks: characters the editor cannot hold
// (see "chars"), more list or quote levels than the editor makes (nesting_bound), and, when the caller hands in the reader's `lex`, any block
// that does not survive the writer's own round trip alone (not_round_trippable). So guard() and gateUpdate() REQUIRE opts.lex (the page's
// lexer, the same one the writer gets) and throw without it: there is no weaker mode to fall into by leaving it out.
// The fuzz in check-documents-coedit-gate.mjs asserts the invariant on random accepted updates. If a state gets past it anyway,
// mendForSnapshot finds the first block that does not read back and drops it from the writer's own copy, so a snapshot is still saved.
//
//   dlCoeditGate(PM) -> {
//     gateUpdate(doc, update, limits, opts)     THE REFERENCE CHECK. Is this remote update safe to apply to `doc`? It copies the live state
//                                               into a scratch document, applies the update there and walks the WHOLE result. Exact, slow
//                                               on a big document; used for large updates (a pulled snapshot) and as the test of the fast path.
//     guard(doc, limits, opts)                  THE LIVE CHECK. Keeps a shadow of `doc` and checks only what an update touched.
//                                               guard.receive(update, sender) checks, and only an ok update is applied to `doc`. `sender` comes
//                                               from the TRANSPORT and nowhere else (step 4 passes host.live's `from`): nothing inside the
//                                               update or in any other argument is read as a sender. opts: { lex, origin, bytes, now, refusals }.
//                                               A missing sender (undefined, null, '', not a string or number, an object) is NOT free: it is
//                                               the ONE shared sender 'unknown', counted like any other but with its own budget
//                                               (limits.unknownRefusals, 10 per window), so a flood with no sender is flagged and cannot
//                                               spread refusals over named senders.
//                                               guard.syncRequested() / guard.syncDone() / guard.syncPending(): the SYNC GRACE. When an update is
//                                               dropped as 'quiet' (or the caller asked for a state-vector sync with syncRequested()), later
//                                               honest updates have missing predecessors and come back 'pending'. While a sync is pending, a
//                                               'pending' result is not counted against any sender (it still spends the page budget): otherwise a
//                                               flood of rotating ids could get honest typists flagged. syncDone() (call it after a state-vector
//                                               reply was applied) clears it; so does limits.syncGraceMs (10 s, from the last quiet drop or
//                                               syncRequested(), on the injectable clock). Real refusals are always counted.
//     rebuildFromGood(snapshotBytes, limits)    a fresh document from the last good snapshot (when applying or drawing an update threw)
//     verifyBeforeSnapshot(lex, doc, text, limits)  may this state be written as the snapshot? (renders, writes the Markdown, compares)
//     mendForSnapshot(lex, doc, text, limits)   when it may not: drops the blocks that do not read back, in ONE local transaction
//                                               (origin 'dl-snapshot-mend'), and says which; -> { ok, dropped, verify }
//     repairGrids(doc)                          pads short grid rows, in ONE local transaction; for the WRITER's page only
//     plugins(frag, opts)                       the editor's plugin list for a shared document (no history, no grid repair of its own)
//     refusals(opts)                            counts refusals per sender within a window; flags a sender; forgets idle senders
//   }
//
// WHAT IS REFUSED (reason -> why). too_big: over the byte cap, refused BEFORE it is decoded. not_an_update, throws: the bytes do not
// decode or the library threw (a top-level XmlText throws out of applyUpdate and poisons the document). pending: an update whose
// predecessor is missing; it is not applied half (the sync asks for the difference instead). unknown_root: a shared type that is not the
// document. top_level_text, unknown_type: the top level holds anything but our block elements. depth, nodes, text: past the bounds.
// unknown_element, attrs, grid_span, marks, nesting, schema: a name, attribute, mark or place our schema does not have ('__proto__' as an
// attribute or mark name is refused, not stripped). chars: a control, NUL, line-break (outside code), direction or zero-width character,
// which the editor never holds (dlCleanText would take it out). nesting_bound: more list levels (DL.listDepth) or quote levels
// (DL_RICH_QUOTES) than the editor makes. not_round_trippable: the block alone does not write and read back as itself.
// sender_flagged, quiet: this sender has had too many refusals; the page had too many refusals in a second and does not decode for a while.
// WHAT IS NOT REFUSED. A node with too LITTLE in it (a grid with no rows, a row with no cells, an emptied list): two people each deleting
// the other half produce it, so refusing it would stop two honest peers from ever agreeing. The binding (y-prosemirror) removes such a
// node from the shared document, the same way on every peer. A grid whose rows differ in width is applied too (a row added while a column
// is added); the writer's page repairs it (repairGrids).
//
// COST (measured in Node on a 150,000-character document of about 1,200 blocks, p50 / p95 per update; check-documents-coedit-gate.mjs prints
// the numbers each run). The live check, which applies the update to a shadow kept in step and walks only the top-level blocks the update
// touched, now with the writer's round trip of each touched block: about 0.06 / 0.11 ms for a typed character (a plain applyUpdate is 0.01).
// The reference check copies the state and asks every block the round trip: about 35 to 50 ms on that document, for a pulled snapshot, not
// for a typed key. The shadow costs about 1.8 MB and is made by the first check (6 to 25 ms). A REFUSAL costs the shadow only when the update
// changed it: bytes over the cap, not an update, a flagged sender and the quiet period never reach it; bytes that do not decode and an
// update whose predecessor is missing change nothing in it and are dropped from its pending list. Only an update that was applied and then
// found hostile makes the next check copy the state again (about 8 ms), and the page-wide budget bounds how often (refusalBudget a second).
// The whole-document totals (nodes, text) are exact and kept by block, so near the node cap there is no whole-document walk.
const DL_COEDIT = Object.freeze({
  liveBytes: 65536, // one live update
  snapshotBytes: 1048576, // a snapshot, or a pull
  depth: 64, // element levels below the document
  nodes: 20000, // elements and text runs in the whole document
  textChars: 1572864, // 1.5 MB of text in the whole document
  root: 'prosemirror', // the one shared type that is the document
  refusalsMax: 5, // refusals from one sender within the window flag the sender
  refusalsWindowMs: 60000,
  sendersMax: 1000, // senders the counter remembers at most (the idle ones are forgotten first)
  unknownRefusals: 10, // refusals within the window that flag the shared 'unknown' sender (a message with no sender from the transport)
  syncGraceMs: 10000, // after a quiet drop or syncRequested(), 'pending' results are not counted against senders for this long (or until syncDone)
  refusalBudget: 40, // refusals (a pending one counts a tenth) the page decodes in one second, over all senders
  quietMs: 1000, // then it decodes nothing for this long
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
  const SELF = { SHADOW: 'dl-gate-shadow', LIVE: 'dl-gate-live', SEED: 'dl-gate-seed', MEND: 'dl-snapshot-mend' };
  // A string the editor can hold: dlCleanText would not change it (a line break is allowed where `lines` is true: code and raw blocks).
  const cleanLine = (v) => { const w = v.replace(/\n/g, ' '); return dlCleanText(w) === w; };
  const cleanText = (v, lines) => (lines ? dlCleanText(v) === v : cleanLine(v) && v.indexOf('\n') < 0);

  // ---- the walk of one block, on the shared type, with no recursion (a hostile chain 8,000 deep must not overflow the stack) -----
  // -> { nodes, text } or throws a stop.
  function scanBlock(block, rules, spent) {
    const stack = [block];
    const depthOf = new Map([[block, { d: 1, l: 0, q: 0 }]]); // levels below the document, lists on the way, quotes on the way
    let nodes = 0; let text = 0;
    while (stack.length) {
      const el = stack.pop();
      const at = depthOf.get(el);
      const depth = at.d;
      depthOf.delete(el);
      if (depth > rules.depth) throw dlCoeditStop('depth', `more than ${rules.depth} levels`);
      nodes += 1;
      if (spent.nodes + nodes > rules.nodes) throw dlCoeditStop('nodes', `more than ${rules.nodes} nodes`);
      const name = el.nodeName;
      if (!own(schema.nodes, name) || name === 'doc' || name === 'text') throw dlCoeditStop('unknown_element', name);
      const spec = schema.nodes[name].spec;
      const lists = at.l + (name === 'bullet_list' || name === 'ordered_list' ? 1 : 0);
      const quotes = at.q + (name === 'blockquote' ? 1 : 0);
      if (lists > DL.listDepth || quotes > DL_RICH_QUOTES) throw dlCoeditStop('nesting_bound', `more than ${lists > DL.listDepth ? DL.listDepth + ' lists' : DL_RICH_QUOTES + ' quotes'} inside each other`);
      // The attribute map as stored: getAttributes() cannot show a '__proto__' key (assigning it sets the prototype of the result).
      for (const [k, item] of el._map) if (!item.deleted && k === '__proto__') throw dlCoeditStop('attrs', `${name}.__proto__`);
      const attrs = el.getAttributes();
      for (const k of Object.keys(attrs)) {
        if (k === '_marks') {
          if (typeof attrs[k] !== 'string' || attrs[k].length > rules.marksJsonMax) throw dlCoeditStop('marks', 'the marks of an atom');
          continue;
        }
        if (!spec.attrs || !own(spec.attrs, k)) throw dlCoeditStop('attrs', `${name}.${k}`);
        const v = attrs[k];
        if (!(v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) throw dlCoeditStop('attrs', `${name}.${k} is not a plain value`);
        if (typeof v === 'string' && !cleanLine(v)) throw dlCoeditStop('chars', `${name}.${k} holds a control or direction character`);
      }
      if (spec.gridRole === 'cell' || spec.gridRole === 'header_cell') {
        if ((attrs.colspan !== undefined && attrs.colspan !== 1) || (attrs.rowspan !== undefined && attrs.rowspan !== 1) || (attrs.colwidth !== undefined && attrs.colwidth !== null)) throw dlCoeditStop('grid_span', `${name} span or width`);
      }
      for (const c of el.toArray()) {
        if (isEl(c)) { depthOf.set(c, { d: depth + 1, l: lists, q: quotes }); stack.push(c); } else if (isTx(c)) {
          nodes += 1; text += c.length;
          if (spent.text + text > rules.textChars) throw dlCoeditStop('text', `more than ${rules.textChars} characters`);
        } else throw dlCoeditStop('unknown_type', 'a shared type that is not an element or text');
      }
    }
    return { nodes, text };
  }

  // The strings in a mark's attributes (a link's address and title).
  function markChars(a) {
    if (!a || typeof a !== 'object') return;
    for (const k of Object.keys(a)) if (typeof a[k] === 'string' && !cleanLine(a[k])) throw dlCoeditStop('chars', 'a mark holds a control or direction character');
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
        markChars(m.attrs);
        try { return schema.marks[m.type].create(m.attrs || null); } catch (e) { throw dlCoeditStop('marks', `${m.type}: ${e.message}`); }
      });
      delete attrs._marks;
    }
    const kids = [];
    for (const c of el.toArray()) {
      if (isEl(c)) kids.push(toNode(c));
      else {
        // the formats as stored: toDelta() cannot show a '__proto__' key
        for (let it = c._start; it !== null; it = it.right) if (!it.deleted && it.content.key === '__proto__') throw dlCoeditStop('marks', '__proto__ as a mark');
        const lines = el.nodeName === 'code_block' || el.nodeName === 'source_block';
        for (const d of c.toDelta()) {
          if (typeof d.insert !== 'string') throw dlCoeditStop('unknown_type', 'an embedded value in text');
          if (!d.insert) continue;
          if (!cleanText(d.insert, lines)) throw dlCoeditStop('chars', 'text holds a control, line-break or direction character');
          const ms = [];
          for (const k of Object.keys(d.attributes || {})) {
            const m = DL_COEDIT_MARK_SUFFIX.exec(k);
            const name = m ? m[1] : k;
            if (!own(schema.marks, name)) throw dlCoeditStop('marks', `unknown mark ${name.slice(0, 40)}`);
            markChars(d.attributes[k]);
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
    if (!p && rules.lex && !blockReads(node, rules.lex)) throw dlCoeditStop('not_round_trippable', `${block.nodeName} does not write and read back as itself`);
    return { ...m, underfilled: Boolean(p) };
  }

  // Does this block, alone, write and read back as itself? The very steps of verifyBeforeSnapshot, for one block: the editor's tidying,
  // the module's writer, the reader. (A state with too little in it is not asked: the binding removes it.)
  // A ragged grid is let in on purpose (a row added while a column is added) and the writer's page pads it (repairGrids) before it writes, so
  // the block is asked as the padded grid: each short row gets empty cells of the kind it ends in, with the widest row's alignments.
  function padGrids(node) {
    if (node.isText || node.isLeaf) return node;
    const kids = [];
    let changed = false;
    node.forEach((c) => { const d = padGrids(c); if (d !== c) changed = true; kids.push(d); });
    if (node.type.name === 'grid') {
      const widest = kids.reduce((m, r) => (r.childCount > m.childCount ? r : m), kids[0]);
      return node.copy(PM.Fragment.fromArray(kids.map((r) => {
        if (!r.childCount || r.childCount >= widest.childCount) return r;
        const cells = [];
        for (let i = r.childCount; i < widest.childCount; i += 1) cells.push(r.child(r.childCount - 1).type.create({ colspan: 1, rowspan: 1, align: widest.child(i).attrs.align }));
        return r.copy(r.content.append(PM.Fragment.from(cells)));
      })));
    }
    return changed ? node.copy(PM.Fragment.fromArray(kids)) : node;
  }
  const emptyReads = new WeakMap();
  function blockReads(node, lex) {
    let none = emptyReads.get(lex);
    if (!none) { none = dlRichRead(PM, '', lex).stored; emptyReads.set(lex, none); }
    try {
      const w = dlRichText(PM, dlRichTidy(PM, schema.nodes.doc.create(null, [padGrids(node)]), none), none, lex);
      return w.same && !w.over;
    } catch (e) { return false; }
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
  function checkAll(doc, rules, sizes) {
    checkRoots(doc, rules);
    const frag = doc.getXmlFragment(rules.root);
    const spent = { nodes: 0, text: 0 };
    let blocks = 0; let underfilled = 0;
    for (const it of topItems(frag, null)) {
      for (const b of topBlocks(it)) {
        const r = checkBlock(b, rules, spent);
        spent.nodes += r.nodes; spent.text += r.text; blocks += 1; if (r.underfilled) underfilled += 1;
        if (sizes) sizes.set(b, { nodes: r.nodes, text: r.text });
      }
    }
    return { nodes: spent.nodes, text: spent.text, blocks, underfilled };
  }

  const needLex = (opts) => { if (!opts || typeof opts.lex !== 'function') throw new TypeError('the gate needs opts.lex, the reader\'s lexer: without it a block that does not write back cannot be told'); };
  const fail = (reason, detail, extra) => ({ ok: false, reason, detail: detail || '', ...(extra || {}) });
  const asStop = (e) => (e && e.dlCoeditStop ? fail(e.reason, e.detail) : fail('throws', e && e.message ? String(e.message).slice(0, 160) : String(e).slice(0, 160)));
  const readable = (update) => update instanceof Uint8Array && update.length > 0;

  // ---- the reference check ----------------------------------------------------------------------------------------------------------
  function gateUpdate(doc, update, limits, opts) {
    needLex(opts);
    const rules = { ...lim(limits), lex: opts.lex };
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
  // The shadow is made again only when an update really changed it and was then refused: a refusal before the update is applied (bytes
  // too big, not an update, a sender flagged, the quiet period), and one where the update changed nothing in the shadow (bytes that do
  // not decode, an update whose predecessor is missing: it is dropped from the shadow's pending list), leave it as it was.
  // The whole-document totals (nodes, text) are exact: the size of every top-level block is kept, and an update changes the total by the
  // difference in the blocks it touched. There is no whole-document walk after the shadow is made.
  function guard(doc, limits, opts) {
    needLex(opts);
    const o = opts;
    const rules = { ...lim(limits), lex: o.lex };
    const nowMs = o.now || (() => Date.now());
    const counter = o.refusals || dlCoeditRefusals({ max: rules.refusalsMax, maxFor: (who) => (who === 'unknown' ? rules.unknownRefusals : undefined), windowMs: rules.refusalsWindowMs, maxSenders: rules.sendersMax, now: o.now });
    const st = {
      applying: false, shadow: null, dirty: true, nodes: 0, text: 0, sizes: new Map(), accepted: 0, refused: 0, reseeds: 0,
      lastChanged: null, lastBefore: null, lastTx: null, quietUntil: 0, windowAt: 0, windowN: 0, quietEntered: 0, quietDropped: 0, syncUntil: 0,
    };
    const onTx = (tr) => { st.lastChanged = tr.changed; st.lastBefore = tr.beforeState; st.lastTx = tr; };
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
      const sizes = new Map();
      const t = checkAll(st.shadow, { ...rules, nodes: Infinity, textChars: Infinity, lex: undefined }, sizes);
      st.sizes = sizes; st.nodes = t.nodes; st.text = t.text; st.dirty = false; st.reseeds += 1;
    };
    // Did the update that was just applied to the shadow change nothing in it? (Then the shadow is as clean as before.)
    const sameMap = (a, b) => { if (a.size !== b.size) return false; for (const [k, v] of a) if (b.get(k) !== v) return false; return true; };
    const unchanged = () => {
      const tr = st.lastTx;
      return Boolean(tr) && tr.changed.size === 0 && tr.deleteSet.clients.size === 0 && sameMap(tr.beforeState, tr.afterState);
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
    // The sender is whatever the transport says it is: a string or a number. Nothing else (an object, a field of the update) is a sender.
    // Anything else (undefined, null, '', an object) is the one shared sender 'unknown' with its own tight budget: no free bucket.
    const senderKey = (s) => (typeof s === 'string' && s !== '' ? s.slice(0, 200) : typeof s === 'number' && Number.isFinite(s) ? String(s) : 'unknown');
    const costly = (reason) => (reason === 'too_big' || reason === 'not_an_update' ? 0 : reason === 'pending' ? 0.1 : 1);
    // The page-wide budget: after rules.refusalBudget refusals in one second nothing is decoded for rules.quietMs.
    const spend = (t, w) => {
      if (!w) return;
      if (t - st.windowAt >= 1000) { st.windowAt = t; st.windowN = 0; }
      st.windowN += w;
      if (st.windowN >= rules.refusalBudget - 1e-9) { st.quietUntil = t + rules.quietMs; st.quietEntered += 1; st.windowN = 0; }
    };
    // The sync grace: while a sync is pending, a 'pending' result is not the sender's fault (the page dropped the updates before it).
    const syncPending = () => nowMs() < st.syncUntil;
    function receive(update, sender) {
      const who = senderKey(sender);
      const t = nowMs();
      if (t < st.quietUntil) { st.quietDropped += 1; st.syncUntil = t + rules.syncGraceMs; return fail('quiet', 'too many refused updates; not decoding for a moment', { flagged: false, applied: false, quiet: true }); }
      if (counter.flagged(who)) return fail('sender_flagged', 'too many refused updates from this sender', { flagged: true, applied: false });
      const r = check(update);
      if (!r.ok) { r.flagged = r.reason === 'pending' && t < st.syncUntil ? counter.flagged(who) : counter.note(who, r.reason === 'pending' ? 0.1 : 1); r.applied = false; st.refused += 1; spend(t, costly(r.reason)); return r; }
      st.applying = true;
      try { PM.applyUpdate(doc, update, o.origin === undefined ? SELF.LIVE : o.origin); } catch (e) {
        st.dirty = true;
        const f = fail('live_threw', String(e && e.message).slice(0, 160), { applied: false, rebuild: true });
        f.flagged = counter.note(who); st.refused += 1; spend(t, 1); return f;
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
        st.lastChanged = null; st.lastBefore = null; st.lastTx = null;
        // From here the shadow may change. `leave` says what a refusal does to it: nothing, when the update changed nothing.
        const leave = () => { if (unchanged()) { shadow.store.pendingStructs = null; shadow.store.pendingDs = null; } else st.dirty = true; };
        try { PM.applyUpdate(shadow, update, SELF.SHADOW); } catch (e) { leave(); return fail('throws', String(e && e.message).slice(0, 160)); }
        if (shadow.store.pendingStructs || shadow.store.pendingDs) { leave(); return fail('pending', 'the update needs something this copy does not have yet'); }
        checkRoots(shadow, rules);
        const { blocks, top } = touched(frag);
        let underfilled = 0; let dn = 0; let dt = 0;
        const seen = new Set();
        const one = (b) => {
          if (seen.has(b)) return; seen.add(b);
          const r = checkBlock(b, rules, { nodes: 0, text: 0 });
          const was = st.sizes.get(b);
          dn += r.nodes - (was ? was.nodes : 0); dt += r.text - (was ? was.text : 0);
          st.sizes.set(b, { nodes: r.nodes, text: r.text });
          if (r.underfilled) underfilled += 1;
        };
        if (top) for (const it of topItems(frag, st.lastBefore)) for (const b of topBlocks(it)) one(b);
        for (const b of blocks) one(b);
        // a top-level block that was deleted leaves the totals
        if (top) for (const [b, z] of st.sizes) if (b._item.deleted) { dn -= z.nodes; dt -= z.text; st.sizes.delete(b); }
        if (st.nodes + dn > rules.nodes) throw dlCoeditStop('nodes', `more than ${rules.nodes} nodes`);
        if (st.text + dt > rules.textChars) throw dlCoeditStop('text', `more than ${rules.textChars} characters`);
        st.nodes += dn; st.text += dt; st.dirty = false;
        return { ok: true, ms: Date.now() - t0, touched: seen.size, underfilled };
      } catch (e) { st.dirty = true; return asStop(e); }
    }
    return {
      receive, // -> { ok, applied?, reason, detail, flagged, rebuild, quiet }
      syncRequested: () => { st.syncUntil = nowMs() + rules.syncGraceMs; }, // a state-vector sync was asked for: 'pending' is not counted until syncDone or the grace ends
      syncDone: () => { st.syncUntil = 0; }, // the state-vector reply was applied
      syncPending,
      stats: () => ({ accepted: st.accepted, refused: st.refused, reseeds: st.reseeds, nodes: st.nodes, text: st.text, quietEntered: st.quietEntered, quietDropped: st.quietDropped, senders: counter.size ? counter.size() : 0 }),
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

  // ---- the writer's mend ------------------------------------------------------------------------------------------------------------
  // The defence behind the invariant. When verifyBeforeSnapshot refuses for a reason that sits in a block (not_read_back, blocks_changed, or a
  // rule of the gate: chars, nesting_bound, attrs...), the snapshot would be stuck for good. This finds the first top-level block the gate
  // would refuse or that does not write and read back alone (when every block passes, the first block after which the state stops reading
  // back, by halving), drops it, checks again, and goes on up to opts.drops (default 16) times; all
  // on a copy. When the copy verifies, the dropped blocks are deleted from `doc` in ONE local transaction (origin 'dl-snapshot-mend'), so
  // they leave every peer the way any local edit does. When it does not (the bound, or a reason that dropping blocks cannot mend), `doc` is
  // not touched. -> { ok, dropped: [{ index, type, reason, text }], verify, applied } (`index` counts the top-level blocks of `doc`).
  function mendForSnapshot(lex, doc, storedText, limits, opts) {
    const rules = lim(limits);
    const first = verifyBeforeSnapshot(lex, doc, storedText, limits);
    if (first.ok) return { ok: true, dropped: [], verify: first, applied: false };
    if (!DL_COEDIT_MENDABLE.has(first.reason)) return { ok: false, dropped: [], verify: first, applied: false };
    const maxDrops = (opts && opts.drops) || 16;
    const copy = new PM.Doc();
    try {
      PM.applyUpdate(copy, PM.encodeStateAsUpdate(doc), SELF.SEED);
      const frag = copy.getXmlFragment(rules.root);
      const live = frag.toArray().map((b, i) => i); // the index in `doc` of each block still in the copy
      const dropped = [];
      let v = first;
      while (!v.ok && dropped.length < maxDrops && live.length) {
        const top = PM.yXmlFragmentToProseMirrorRootNode(frag, schema);
        const blocks = frag.toArray();
        if (top.childCount !== live.length || blocks.some((b) => !isEl(b))) break;
        let bad = -1;
        for (let i = 0; i < blocks.length && bad < 0; i += 1) {
          try { checkBlock(blocks[i], { ...rules, lex }, { nodes: 0, text: 0 }); } catch (e) { bad = i; }
        }
        if (bad < 0) { // every block reads back alone: the first prefix of the document that does not is the one that ends in the offender
          const prefixOk = (k) => {
            const part = new PM.Doc();
            try { PM.applyUpdate(part, PM.encodeStateAsUpdate(copy), SELF.SEED); part.getXmlFragment(rules.root).delete(k, live.length - k); return verifyBeforeSnapshot(lex, part, storedText, limits).ok; } finally { part.destroy(); }
          };
          let lo = 0; let hi = live.length; // lo reads back (the empty document counts), hi does not
          while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (prefixOk(mid)) lo = mid; else hi = mid; }
          bad = hi - 1;
        }
        const node = top.child(bad);
        dropped.push({ index: live[bad], type: node.type.name, reason: v.reason, text: node.textContent.slice(0, 80) });
        frag.delete(bad, 1); live.splice(bad, 1);
        v = live.length ? verifyBeforeSnapshot(lex, copy, storedText, limits) : { ok: false, reason: 'empty', detail: 'every block was dropped' };
      }
      if (!v.ok) return { ok: false, dropped, verify: v, applied: false };
      const real = doc.getXmlFragment(rules.root);
      doc.transact(() => { for (const d of dropped.map((x) => x.index).sort((a, b) => b - a)) real.delete(d, 1); }, SELF.MEND);
      return { ok: true, dropped, verify: verifyBeforeSnapshot(lex, doc, storedText, limits), applied: true };
    } catch (e) { const f = asStop(e); return { ok: false, dropped: [], verify: { ok: false, reason: f.reason, detail: f.detail }, applied: false }; } finally { copy.destroy(); }
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

  const api = { gateUpdate, guard, rebuildFromGood, verifyBeforeSnapshot, mendForSnapshot, repairGrids, plugins, refusals: dlCoeditRefusals, limits: DL_COEDIT, schema };
  dlCoeditGates.set(PM, api);
  return api;
}

// The reasons verifyBeforeSnapshot gives that mendForSnapshot can mend by dropping a block (the others are about the whole: size, roots, the top level).
const DL_COEDIT_MENDABLE = new Set(['not_read_back', 'blocks_changed', 'chars', 'nesting_bound', 'nesting', 'attrs', 'marks', 'unknown_element', 'grid_span', 'schema', 'depth', 'not_round_trippable']);

// How many updates a sender had refused lately. note(sender, weight) counts one refusal (a `pending` one counts a tenth: a lossy
// network makes those without any fault) and returns true once the sender is flagged (the weights reach max within windowMs);
// flagged(sender) asks; clear(sender) forgets. At most maxSenders senders are remembered: past that the idle ones (all their refusals older
// than the window) go, then the oldest, down to nine tenths, so a flood of rotating sender ids costs a bounded amount of memory.
// `now` is a clock for tests.
function dlCoeditRefusals(o) {
  const max = (o && o.max) || DL_COEDIT.refusalsMax;
  const windowMs = (o && o.windowMs) || DL_COEDIT.refusalsWindowMs;
  const maxSenders = (o && o.maxSenders) || DL_COEDIT.sendersMax;
  const now = (o && o.now) || (() => Date.now());
  const maxFor = (sender) => (o && o.maxFor && o.maxFor(sender)) || max; // a sender may have its own budget ('unknown')
  const by = new Map();
  const recent = (sender) => { const t = now(); const l = (by.get(sender) || []).filter((x) => t - x.t < windowMs); if (l.length) by.set(sender, l); else by.delete(sender); return l; };
  const sum = (l) => l.reduce((a, x) => a + x.w, 0);
  const prune = () => {
    for (const k of Array.from(by.keys())) recent(k);
    const keep = Math.floor(maxSenders * 0.9);
    if (by.size > maxSenders) for (const k of Array.from(by.keys())) { if (by.size <= keep) break; by.delete(k); }
  };
  return {
    note(sender, weight) { const l = recent(sender); l.push({ t: now(), w: weight === undefined ? 1 : weight }); by.set(sender, l); if (by.size > maxSenders) prune(); return sum(l) >= maxFor(sender) - 1e-9; },
    flagged: (sender) => sum(recent(sender)) >= maxFor(sender) - 1e-9,
    count: (sender) => sum(recent(sender)),
    clear: (sender) => { by.delete(sender); },
    size: () => by.size,
  };
}
