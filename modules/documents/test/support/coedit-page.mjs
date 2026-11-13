/*
 * coedit-page.mjs -- what the co-editing writer and save tests share (check-documents-coedit-writer.mjs, check-documents-coedit-save.mjs). Not a test.
 *
 * A "page" here is what documents.js builds for one open shared document, with the browser left out: a Y.Doc, a dlSyncSession on the stand-in bus, the
 * page's save state, and the real dlCoSaver over a FakeStore. The text a page would save is the editor's own writer (dlRichText) on the converged Y state,
 * read through the same spelling lookup the editor keeps. What this does NOT cover: the editor view, the toolbar, the status line's drawing, the SDK.
 */
import { loadRich } from './rich-corpus.mjs';
import { FakeStore } from './fake-store.mjs';
import { Clock, Bus, run } from './sync-bus.mjs';

export { Clock, Bus, run, FakeStore };

export const NAMES = ['dlRichRead', 'dlRichText', 'dlRichSchema', 'dlCoeditGate', 'dlSyncSession', 'dlSyncTopic', 'dlSyncSeed', 'dlSyncSeedId', 'dlSyncElect', 'dlSyncWriterHold', 'dlSyncRoster', 'dlSyncVector', 'dlSyncB64', 'DL_SYNC',
  'dlSeedClaim', 'dlCleanSeedMarker', 'dlSeedMarkerStale', 'dlSeedMarkerKey', 'dlCoeditSave', 'dlCoSaver', 'dlCoReadStored', 'dlCoSaveDelay', 'dlCoBackoff', 'dlCoErr', 'DL_COSAVE',
  'dlSnapJoin', 'dlSnapSaver', 'dlSnapPrepare', 'dlSnapSplit', 'dlSnapHash', 'dlSnapCleanHeader', 'dlSnapCleanChunk', 'dlSnapCompaction', 'dlSnapReseed', 'DL_SNAP', 'dlSnapHeaderKey', 'dlSnapChunkKey', 'dlSyncUnb64',
  'dlCleanDoc', 'dlCleanPage', 'dlSplit', 'dlPlanChunks', 'dlNewId', 'dlExcerpt', 'dlPreview', 'DL_PAPER_DEFAULT', 'dlDocKey', 'dlTextKey', 'DL_MARKED_MATH', 'DL_MARKED_HOOKS'];

export const TEXT = 'Alpha one.\n\nBeta two.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nOmega.\n';
export const ID = 'doc12345';

const loaded = new Map(); // the library once per folder (the bundle warns when it is loaded twice)
export function world(src, o = {}) {
  if (!loaded.has(src)) loaded.set(src, loadRich(src, NAMES));
  const { PM, L, lex } = loaded.get(src);
  const schema = L.dlRichSchema(PM);
  const clock = new Clock();
  const bus = new Bus(clock, { paceMs: o.paceMs || 0 });
  bus.pending = bus.pending || [];
  const store = new FakeStore({ now: () => clock.now(), seed: o.seed || 1, yields: o.yields === undefined ? 3 : o.yields, ...(o.store || {}) });
  const W = { PM, L, lex, schema, clock, bus, store, pages: [] };
  W.pmDoc = (text) => L.dlRichRead(PM, text, lex).doc;
  W.frag = L.dlCoeditGate(PM).limits.root;
  // the document as a new one is made (documents.js create): the chunks, then the record
  W.make = (text = TEXT, title = 'Plan') => {
    const split = L.dlSplit(text);
    const plan = L.dlPlanChunks([], split.chunks, () => L.dlNewId(Math.random));
    const iso = new Date(clock.now()).toISOString();
    for (const c of plan) store.data.set(L.dlTextKey(ID, c.id), { json: JSON.stringify({ id: c.id, doc: ID, text: c.text }), version: (store.versionCounter += 1) });
    const rec = { id: ID, type: 'doc', title, rev: 1, chunks: plan.map((c) => c.id), size: text.length, excerpt: L.dlExcerpt(text, lex), preview: L.dlPreview(text), paper: L.DL_PAPER_DEFAULT, ...L.dlCleanPage(null), by: 'u0', at: iso, editedBy: 'u0', editedByName: 'Ana', editedAt: iso };
    store.data.set(L.dlDocKey(ID), { json: JSON.stringify(rec), version: (store.versionCounter += 1) });
    return rec;
  };
  W.stored = () => {
    const r = store.peek(L.dlDocKey(ID));
    if (!r) return null;
    const rec = L.dlCleanDoc(r.value);
    const byId = new Map();
    for (const [k, e] of store.data) if (k.startsWith(`text:${ID}:`)) { const v = JSON.parse(e.json); byId.set(v.id, v.text); }
    return { rec, version: r.version, text: rec.chunks.map((c) => byId.get(c)).join(''), chunkKeys: [...store.data.keys()].filter((k) => k.startsWith(`text:${ID}:`)).length };
  };
  W.textOf = (ydoc, stored) => {
    const node = PM.yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(W.frag), schema);
    return L.dlRichText(PM, node, stored || L.dlRichRead(PM, TEXT, lex).stored, lex).text;
  };
  // One page. o: { editor, marker (false: none), config, title }
  W.page = async (key, po = {}) => {
    const m = bus.connect(key);
    const handle = store.as(key, { role: po.role || 'editor' });
    const read = await L.dlCoReadStored(handle, ID); // what readForEdit hands the page
    const p = { key, m, handle, ydoc: new PM.Doc(), rev: 0, savedRev: NaN, notes: [], refused: [], title: read.rec.title, how: null, queue: Promise.resolve(), left: false };
    p.st = { id: ID, rec: read.rec, docVersion: read.version, old: read.parts, saved: { text: read.text, title: read.rec.title, paper: read.rec.paper, page: L.dlCleanPage(read.rec) }, log: [], stray: [] };
    p.table = L.dlRichRead(PM, read.text, lex).stored;
    p.session = L.dlSyncSession(PM, {
      doc: p.ydoc, lex, topic: L.dlSyncTopic(ID), me: key, live: m.live, editor: po.editor !== false, clock: clock.api(), config: po.config,
      seed: (d, sid) => L.dlSyncSeed(PM, d, W.pmDoc(read.text), ID, read.text, sid),
      marker: po.marker === false ? undefined : { store: handle, doc: ID, seedId: L.dlSyncSeedId(ID, read.text) },
      snapshot: po.snap ? { ...L.dlSnapJoin(PM, { store: handle, id: ID, lex, storedText: read.text, storedRev: read.rec.textRev || 0, me: key, now: () => clock.now() }), adopted: (h) => p.snapSaver.adopted(h, h.hashes) } : undefined,
      onState: () => { if (p.saver && (p.ready || !po.snap)) { const w = p.session.isWriter(); if (w && !p.wasWriter) p.saver.plan(false); p.wasWriter = w; } },
    });
    p.doc = () => p.session.doc();
    p.text = () => W.textOf(p.doc(), p.table);
    p.saver = L.dlCoSaver({
      store: handle, st: p.st,
      io: { current: () => ({ text: p.text(), title: p.title, paper: p.st.saved.paper, page: p.st.saved.page, rev: p.rev }), onStored: (t) => { p.table = L.dlRichRead(PM, t, lex).stored; }, me: key, name: key, now: () => new Date(clock.now()).toISOString(), nowMs: () => clock.now(), fresh: () => L.dlNewId(Math.random), lex, sleep: (ms) => new Promise((r) => clock.set(r, ms)) },
      isWriter: () => p.ready && p.session.isWriter(),
      dirty: () => p.ready && p.rev !== p.savedRev,
      alone: () => p.session.roster.others().length === 0,
      clock: clock.api(),
      serial: (fn) => { const next = p.queue.then(fn); p.queue = next.catch(() => {}); return next; },
      drain: (ms) => p.session.drain(ms),
      onSaved: (rev) => { p.savedRev = rev; p.table = L.dlRichRead(PM, p.st.saved.text, lex).stored; },
      onChange: () => {}, note: (t) => p.notes.push(t), refused: (w) => p.refused.push(w),
    });
    p.ready = false;
    if (po.snap) {
      const stat = () => p.session.stats();
      p.writeLog = [];
      p.snapSaver = L.dlSnapSaver({
        store: handle, id: ID, me: key, now: () => clock.now(), iso: () => new Date(clock.now()).toISOString(),
        isWriter: () => p.session.isWriter(), ready: () => p.ready, dirty: () => p.rev !== p.savedRev || p.saver.state.saving,
        savedText: () => p.st.saved.text, rev: () => p.st.rec.textRev || 0,
        stateKey: () => { const s2 = stat(); return s2.changes + s2.rebuilt; }, largeKey: () => { const s2 = stat(); return s2.big + s2.assembled; },
        prepare: () => L.dlSnapPrepare(PM, lex, p.session.doc(), p.st.saved.text),
        writes: () => store.log.filter((x) => x.who === key && (x.op === 'set' || x.op === 'delete') && x.status === 200 && clock.now() - (x.at || 0) < 60000).length,
        note: (t) => p.notes.push(t), onChange: () => {},
      });
    }
    // the editor's change counter: every change of the text, this page's or another's, is a change (the editor hears both)
    const onUpdate = () => { p.rev += 1; if (p.saver && p.ready) p.saver.changed(); };
    p.listen = () => p.session.doc().on('update', onUpdate);
    p.session.start();
    p.session.join((how) => { p.how = how; p.joinedAt = clock.now(); p.ready = true; p.savedRev = NaN; p.listen(); if (po.snap && p.session.isWriter()) { p.wasWriter = true; p.saver.plan(false); } }); // like coReady, which ends with coChanged()
    W.pages.push(p);
    return p;
  };
  // type into text paragraph i (0 Alpha, 1 Beta, 2 Omega; the grid is skipped): a change by this person
  W.type = (p, i, text, at) => { const para = p.doc().getXmlFragment(W.frag).get([0, 1, 3][i]); const t = para.get(0); p.doc().transact(() => t.insert(at === undefined ? t.length : at, text), 'local'); };
  // Back: the saver's leave, then the session stops (leaveCo)
  W.leave = async (p) => { const r = await p.saver.leave(); if (r === 'go') { p.saver.stop(); p.session.stop(); bus.disconnect(p.key); p.left = true; } return r; };
  W.run = async (ms, step) => {
    if (!W.pages.some((p) => p.snapSaver)) return run(clock, bus, ms, step);
    for (let left = ms; left > 0; left -= 500) { for (const p of W.pages) if (p.snapSaver && !p.left) p.snapSaver.tick(); await run(clock, bus, Math.min(500, left), step); }
    return undefined;
  };
  return W;
}
