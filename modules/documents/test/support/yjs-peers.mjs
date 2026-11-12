/*
 * yjs-peers.mjs -- what the Yjs tests share (check-documents-yjs-sync.mjs, check-documents-yjs-merge.mjs). Not a test.
 *
 * A "peer" is one person's copy of a document: a Y.Doc, the same plugins the editor will use (ySyncPlugin and yUndoPlugin from the
 * vendored bundle, the very code), and a stand-in for the EditorView with the few members those plugins call (state, dispatch,
 * hasFocus). There is no DOM here, so what only a real view does (drawing, focus, the DOM selection, composition) is NOT covered.
 * "The network" is a list of updates that a test delivers, shuffles, duplicates or drops.
 */
import { loadRich } from './rich-corpus.mjs';

// ProseMirror itself warns (console.warn) when y-prosemirror puts the first selection at the start of a document that begins with a list.
// The real editor does the same; it is not a failure, so the tests do not print it.
const warn = console.warn;
console.warn = (...a) => { if (!/^TextSelection endpoint not pointing into a node with inline content/.test(String(a[0]))) warn(...a); };

export const NAMES = ['dlRichSchema', 'dlRichRead', 'dlRichText', 'dlRichSerialise', 'DL_MARKED_MATH', 'DL_MARKED_HOOKS', 'dlCoeditGate', 'dlRichPlugins', 'dlEditorPagesPlugin', 'dlRichEditor'];

export function loadYjs(src) {
  const r = loadRich(src, NAMES);
  return { ...r, schema: r.L.dlRichSchema(r.PM) };
}

// A seeded random generator (the tests must give the same answer every run).
export function rng(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }

class FakeView {
  constructor(PM, state) {
    this.PM = PM; this.state = state; this.views = [];
    this.views = state.plugins.map((p) => (p.spec.view ? p.spec.view(this) : null));
  }
  hasFocus() { return false; }
  dispatch(tr) {
    const prev = this.state; this.state = prev.apply(tr);
    for (const v of this.views) if (v && v.update) v.update(this, prev);
  }
  destroy() { for (const v of this.views) if (v && v.destroy) v.destroy(); }
}

export class Net {
  constructor(ctx, seed = 12345) { this.ctx = ctx; this.peers = []; this.R = rng(seed); }
  // seed: a ProseMirror doc put into the Y.Doc before the view is made (only for the first peer). plugins: more plugins after ySync and
  // yUndo; build(PM, frag): the whole plugin list instead
  peer(name, { seed, plugins, build } = {}) {
    const { PM, schema } = this.ctx;
    const ydoc = new PM.Doc(); const frag = ydoc.getXmlFragment('prosemirror');
    if (seed) PM.prosemirrorToYXmlFragment(seed, frag);
    const p = { name, ydoc, frag, out: [], bad: 0, exc: 0, lastExc: '' };
    p.view = new FakeView(PM, PM.EditorState.create({ schema, plugins: build ? build(PM, frag) : [PM.ySyncPlugin(frag), PM.yUndoPlugin(), ...(plugins ? plugins(PM) : [])] }));
    ydoc.on('update', (u, origin) => { if (origin !== 'net') p.out.push(u); });
    this.peers.push(p); return p;
  }
  after(p) { try { p.view.state.doc.check(); } catch (e) { p.bad++; } }
  apply(q, u) { try { this.ctx.PM.applyUpdate(q.ydoc, u, 'net'); } catch (e) { q.exc++; q.lastExc = String(e).slice(0, 120); } this.after(q); }
  // everything every peer has made so far goes to every other peer. o: { shuffle, dup (0..1), drop (0..1) }
  deliver(o = {}) {
    const msgs = [];
    for (const p of this.peers) for (const u of p.out.splice(0)) for (const q of this.peers) if (q !== p) msgs.push({ q, u });
    if (o.shuffle) for (let i = msgs.length - 1; i > 0; i--) { const j = Math.floor(this.R() * (i + 1)); [msgs[i], msgs[j]] = [msgs[j], msgs[i]]; }
    for (const m of msgs) { if (o.drop && this.R() < o.drop) continue; for (let k = o.dup && this.R() < o.dup ? 2 : 1; k > 0; k--) this.apply(m.q, m.u); }
    return msgs.length;
  }
  quiesce(o = {}) { for (let i = 0; i < 30 && this.peers.some((p) => p.out.length); i++) this.deliver(o); }
  // the repair: every peer sends what each other peer is missing (one state-vector exchange)
  sync() { const { PM } = this.ctx; for (const a of this.peers) for (const b of this.peers) if (a !== b) this.apply(b, PM.encodeStateAsUpdate(a.ydoc, PM.encodeStateVector(b.ydoc))); }
  json(p) { return JSON.stringify(p.view.state.doc.toJSON()); }
  converged() { const j = this.peers.map((p) => this.json(p)); const y = this.peers.map((p) => p.frag.toString()); return j.every((x) => x === j[0]) && y.every((x) => x === y[0]); }
  destroy() { for (const p of this.peers) { p.view.destroy(); p.ydoc.destroy(); } this.peers = []; }
}

// ---- helpers on a peer's document -------------------------------------------------------------------------------------------------
export const textOf = (p) => p.view.state.doc.textContent;
export function posOfText(doc, s, nth = 0) { let found = -1, k = 0; doc.descendants((n, pos) => { if (found >= 0) return false; if (n.isText) { const i = n.text.indexOf(s); if (i >= 0 && k++ >= nth) found = pos + i; } }); return found; }
export function nodesOfType(doc, type) { const r = []; doc.descendants((n, pos) => { if (n.type.name === type) r.push({ n, pos }); }); return r; }
export function typeChars(p, pos, s) { for (let i = 0; i < s.length; i++) p.view.dispatch(p.view.state.tr.insertText(s[i], pos + i)); }
