// Whether a library PDF holds what makes it run, open something outside it, send something or carry files
// (documentation/plans/plan-attachments-vault.md, decision 9, and Thomas's rule of 2026-10-30: links to web pages and
// fillable forms are taken, scripts and launches are not). It runs in a worker (server/vault-scan.js), never on the
// server's main thread, and it is linear: a forward pass over the file with a tokenizer, read in 1 MB windows (never
// the whole file at once), no regular expression over the file, every search bounded by the part it looks in, and a
// budget of objects, streams and decoded bytes on top of the worker's clock and memory limit.
//
// What it reads:
// - The file's own syntax, token by token (names with their #xx escapes, strings with their escapes, comments), every
//   object from its "N G obj". A name that makes a PDF act (ACTIVE_NAMES) anywhere in it is refused; so is a link (a
//   /URI string) to anything but a web page or an email address.
// - A reader finds objects by their offsets, not by reading the file from the start, so wherever the scan does not read
//   the bytes as syntax (a string, a comment, a stream's bytes) and they hold the start of an object ("N G obj") or a
//   "trailer", they are read again as syntax from that start (security QA round 2, round 2: a stream a reader ends
//   elsewhere hid a script).
// - Each stream's dictionary, parsed as tokens, not searched. Its end is its /Length when "endstream" stands there; a
//   /Length given by reference is read from that integer object, and one that can't be (missing, given twice, or not
//   ending at "endstream") leaves the PDF unchecked. A stream a reader could take objects out of (an object stream: its
//   dictionary has /N, /First or /Extends, or says /Type /ObjStm) is decoded through its whole filter chain (Flate,
//   LZW, ASCIIHex, ASCII85, RunLength, with PNG or TIFF predictors) within bounds and read the same way, and every name
//   in it is looked at, inside strings too; one whose chain can't be decoded here, or whose dictionary names its filters
//   by reference, or twice, or that was not ended by its own /Length and is cut short, is not checked and so not taken.
//   A reader needs /N and /First to take objects out of a stream, whatever its /Type says.
// - Every other stream's bytes (pictures, fonts, page contents) are not read as names, since compressed bytes would
//   match by chance.
// - The end: %%EOF and startxref (or a trailer) in the last kilobyte, and at least one object.
// Answers null, { name, what } for what it holds, { refuse: 'damaged' } or { refuse: 'unchecked' }.
'use strict';

const fs = require('fs');
const zlib = require('zlib');

// The names that make a PDF act, and what kind of thing each is, for the sentence. /URI and /AcroForm are not here: a
// link's address is looked at instead, and a form that does not send itself anywhere or run a script is a form. A file
// carried inside is found by the key that points at its bytes (/EF, in a file specification), by associated files
// (/AF) and by a portfolio (/Collection), not only by /Type /EmbeddedFile, which a reader does not need (security QA
// round 2, round 2).
const ACTIVE_NAMES = new Map([
  ['JavaScript', 'scripts'], ['JS', 'scripts'], ['AA', 'scripts'], ['XFA', 'scripts'],
  ['Launch', 'opens'], ['GoToR', 'opens'], ['GoToE', 'opens'],
  ['SubmitForm', 'sends'],
  ['EmbeddedFile', 'files'], ['EmbeddedFiles', 'files'], ['RichMedia', 'files'], ['EF', 'files'], ['AF', 'files'], ['Collection', 'files'],
]);

// The budget. Past any of it the PDF is not checked, so not taken.
const LIMITS = {
  objects: 4 * 1000 * 1000,
  streams: 1000 * 1000,
  decodedStreams: 200, // object streams decoded (the plan's 200)
  rawStream: 32 * 1024 * 1024, // an object stream's own bytes, held to decode it
  integerObjects: 500 * 1000, // integer objects kept to read a /Length given by reference
  streamOut: 16 * 1024 * 1024, // what one stream may decode to
  allOut: 64 * 1024 * 1024, // what they may decode to together
  filters: 8, // filters in one chain
  captured: 256, // tokens kept of one dictionary's /Filter, /DecodeParms, /Length, /N, /First, /Type, /Extends
  linkKept: 2048, // bytes of a link's address looked at
};

class Unchecked extends Error {}
const unchecked = () => { throw new Unchecked('unchecked'); };

const WS = 1;
const DELIM = 2;
const CLS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) CLS[c] = WS;
for (const c of '()<>[]{}/%') CLS[c.charCodeAt(0)] = DELIM;
const hexVal = (c) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);

// --- the tokenizer ---------------------------------------------------------------------------------------------------
// lex(b, i, to, keep) reads the token at or after `i` (whitespace skipped; a comment is a token of its own) and answers
// its kind; T_START is where it starts, T_END where it ends, T_VAL its value (a name's decoded text, or null past 64
// characters; a keyword's text, '' when long; with `keep`, a string's first bytes), T_INT an integer's value.
const EOF = 0; const NAME = 1; const INT = 2; const REAL = 3; const STR = 4; const DOPEN = 5; const DCLOSE = 6; const AOPEN = 7; const ACLOSE = 8; const KW = 9; const OTHER = 10; const COMMENT = 11;
let T_START = 0;
let T_END = 0;
let T_VAL = null;
let T_INT = 0;

function lexName(b, i, to) {
  let j = i + 1;
  let s = '';
  let long = false;
  while (j < to && CLS[b[j]] === 0) {
    let c = b[j];
    if (c === 0x23 && j + 2 < to && hexVal(b[j + 1]) >= 0 && hexVal(b[j + 2]) >= 0) { c = hexVal(b[j + 1]) * 16 + hexVal(b[j + 2]); j += 3; } else j += 1;
    if (!long) { if (s.length >= 64) long = true; else s += String.fromCharCode(c); }
  }
  T_END = j;
  T_VAL = long ? null : s;
  return NAME;
}

function lexLiteral(b, i, to, keep) {
  const out = keep ? [] : null;
  let depth = 1;
  let j = i + 1;
  const put = (c) => { if (out && out.length < LIMITS.linkKept) out.push(c); };
  while (j < to) {
    const c = b[j];
    if (c === 0x5c) { // an escape
      const e = j + 1 < to ? b[j + 1] : -1;
      if (!out) { j += 2; continue; }
      if (e >= 0x30 && e <= 0x37) {
        let v = 0;
        let k = j + 1;
        while (k < to && k < j + 4 && b[k] >= 0x30 && b[k] <= 0x37) { v = v * 8 + b[k] - 0x30; k += 1; }
        put(v & 0xff);
        j = k;
        continue;
      }
      if (e === 0x0d) { j += b[j + 2] === 0x0a ? 3 : 2; continue; } // a line that goes on
      if (e === 0x0a) { j += 2; continue; }
      const map = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
      if (e >= 0) put(map[e] !== undefined ? map[e] : e);
      j += 2;
      continue;
    }
    if (c === 0x28) depth += 1;
    else if (c === 0x29) { depth -= 1; if (depth === 0) { T_END = j + 1; T_VAL = out; return STR; } }
    put(c);
    j += 1;
  }
  T_END = to;
  T_VAL = out;
  return STR;
}

function lexHex(b, i, to, keep) {
  const out = keep ? [] : null;
  let j = i + 1;
  let hi = -1;
  while (j < to && b[j] !== 0x3e) {
    if (out && out.length < LIMITS.linkKept) {
      const v = hexVal(b[j]);
      if (v >= 0) { if (hi < 0) hi = v; else { out.push(hi * 16 + v); hi = -1; } }
    }
    j += 1;
  }
  if (out && hi >= 0 && out.length < LIMITS.linkKept) out.push(hi * 16);
  T_END = Math.min(j + 1, to);
  T_VAL = out;
  return STR;
}

function lex(b, i, to, keep) {
  while (i < to && CLS[b[i]] === WS) i += 1;
  T_START = i;
  if (i >= to) { T_END = to; return EOF; }
  if (b[i] === 0x25) { // a comment, to the end of its line
    let j = i + 1;
    while (j < to && b[j] !== 0x0a && b[j] !== 0x0d) j += 1;
    T_END = j;
    return COMMENT;
  }
  const c = b[i];
  if (c === 0x2f) return lexName(b, i, to);
  if (c === 0x28) return lexLiteral(b, i, to, keep);
  if (c === 0x3c) { if (i + 1 < to && b[i + 1] === 0x3c) { T_END = i + 2; return DOPEN; } return lexHex(b, i, to, keep); }
  if (c === 0x3e) { if (i + 1 < to && b[i + 1] === 0x3e) { T_END = i + 2; return DCLOSE; } T_END = i + 1; return OTHER; }
  if (c === 0x5b) { T_END = i + 1; return AOPEN; }
  if (c === 0x5d) { T_END = i + 1; return ACLOSE; }
  if (CLS[c] === DELIM) { T_END = i + 1; return OTHER; } // ) { }
  let j = i;
  let digits = 0;
  let dots = 0;
  let others = 0;
  let v = 0;
  for (; j < to && CLS[b[j]] === 0; j += 1) {
    const d = b[j];
    if (d >= 0x30 && d <= 0x39) { digits += 1; if (digits <= 15) v = v * 10 + d - 0x30; } else if (d === 0x2e) dots += 1;
    else if (!((d === 0x2b || d === 0x2d) && j === i)) others += 1;
  }
  T_END = j;
  if (!others && digits && dots <= 1) {
    if (dots) return REAL;
    T_INT = digits > 15 ? Infinity : b[i] === 0x2d ? -v : v;
    return INT;
  }
  T_VAL = j - i <= 12 ? b.latin1Slice(i, j) : '';
  return KW;
}

// --- links -------------------------------------------------------------------------------------------------------------
// A link's address (its first bytes, escapes read) is a web page or an email address, read the way a reader would:
// UTF-16 with its mark, or bytes; spaces and control characters around and inside it do not count.
function webLink(bytes) {
  let s = '';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) for (let k = 2; k + 1 < bytes.length; k += 2) s += String.fromCharCode(bytes[k] * 256 + bytes[k + 1]);
  else {
    const from = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    for (let k = from; k < bytes.length; k += 1) s += String.fromCharCode(bytes[k]);
  }
  let a = '';
  for (const ch of s) { const code = ch.charCodeAt(0); if (code > 0x20 && code !== 0x7f) a += ch; if (a.length >= 16) break; }
  a = a.toLowerCase();
  return a.startsWith('http://') || a.startsWith('https://') || a.startsWith('mailto:');
}

// Reads `b` (from `from` to `to`) as PDF syntax for names and links only: the inside of an object stream. Answers null
// or { name, what }; throws Unchecked.
function namesIn(b, from, to) {
  let i = from;
  let link = false;
  for (;;) {
    const kind = lex(b, i, to, link);
    if (kind === EOF) return null;
    i = T_END;
    if (kind === COMMENT) continue;
    if (link) {
      link = false;
      if (kind === STR && !webLink(T_VAL)) return { name: 'URI', what: 'opens' };
      if (kind === INT) unchecked(); // a link's address held elsewhere, by reference
    }
    if (kind === NAME && T_VAL !== null) {
      if (ACTIVE_NAMES.has(T_VAL)) return { name: T_VAL, what: ACTIVE_NAMES.get(T_VAL) };
      if (T_VAL === 'URI') link = true;
    }
  }
}

// Every name in `b` (from `from` to `to`) wherever it stands, inside a string or a comment too: each "/" read as the start
// of a name, so no string or comment can hide one. A reader takes each object of an object stream from its own offset,
// so an object that opens a string the one before it never closes is still read as syntax there. Whether any refused
// name, or a /URI that is not a web or email address, is in it (true or false).
function anyNameIn(b, from, to) {
  for (let at = b.indexOf(0x2f, from); at >= 0 && at < to;) {
    lexName(b, at, to);
    const next = Math.max(T_END, at + 1);
    if (T_VAL !== null && ACTIVE_NAMES.has(T_VAL)) return true;
    if (T_VAL === 'URI') {
      let kind = lex(b, next, to, true);
      while (kind === COMMENT) kind = lex(b, T_END, to, true);
      if (kind === INT || (kind === STR && !webLink(T_VAL))) return true;
    }
    at = b.indexOf(0x2f, next);
  }
  return false;
}

// --- filters -----------------------------------------------------------------------------------------------------------
// A growing output that never passes `cap` bytes (past it: Unchecked).
class Out {
  constructor(cap, hint) { this.cap = cap; this.b = Buffer.allocUnsafe(Math.max(64, Math.min(cap, hint))); this.n = 0; }
  fit(k) {
    if (this.n + k > this.cap) unchecked();
    if (this.n + k > this.b.length) { const nb = Buffer.allocUnsafe(Math.min(this.cap, Math.max(this.b.length * 2, this.n + k))); this.b.copy(nb, 0, 0, this.n); this.b = nb; }
  }
  push(c) { this.fit(1); this.b[this.n] = c; this.n += 1; }
  done() { return this.b.subarray(0, this.n); }
}

// Whether the filter that ran last met its end of data (Flate's end, LZW's code 257, ASCIIHex's ">", ASCII85's "~>",
// RunLength's 128) before the bytes ran out.
let ENDED = false;

function asciiHex(d, cap) {
  const o = new Out(cap, d.length / 2 + 1);
  let hi = -1;
  ENDED = false;
  for (let i = 0; i < d.length; i += 1) {
    if (d[i] === 0x3e) { ENDED = true; break; }
    const v = hexVal(d[i]);
    if (v < 0) { if (CLS[d[i]] === WS) continue; unchecked(); }
    if (hi < 0) hi = v; else { o.push(hi * 16 + v); hi = -1; }
  }
  if (hi >= 0) o.push(hi * 16);
  return o.done();
}

function ascii85(d, cap) {
  const o = new Out(cap, d.length);
  let i = 0;
  while (i < d.length && CLS[d[i]] === WS) i += 1;
  if (d[i] === 0x3c && d[i + 1] === 0x7e) i += 2;
  const group = [];
  ENDED = false;
  for (; i < d.length; i += 1) {
    const c = d[i];
    if (CLS[c] === WS) continue;
    if (c === 0x7e) { ENDED = true; break; } // ~>
    if (c === 0x7a && group.length === 0) { for (let k = 0; k < 4; k += 1) o.push(0); continue; }
    if (c < 0x21 || c > 0x75) unchecked();
    group.push(c - 0x21);
    if (group.length === 5) {
      let v = 0;
      for (const g of group) v = v * 85 + g;
      if (v > 0xffffffff) unchecked();
      o.push((v >>> 24) & 255); o.push((v >>> 16) & 255); o.push((v >>> 8) & 255); o.push(v & 255);
      group.length = 0;
    }
  }
  if (group.length === 1) unchecked();
  if (group.length) {
    const k = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const g of group) v = v * 85 + g;
    for (let s = 0; s < k - 1; s += 1) o.push((v >>> (24 - 8 * s)) & 255);
  }
  return o.done();
}

function runLength(d, cap) {
  const o = new Out(cap, d.length * 2);
  ENDED = false;
  for (let i = 0; i < d.length;) {
    const L = d[i];
    if (L === 128) { ENDED = true; break; }
    if (L < 128) {
      const e = Math.min(d.length, i + 2 + L);
      for (let k = i + 1; k < e; k += 1) o.push(d[k]);
      i += L + 2;
    } else {
      if (i + 1 >= d.length) break;
      for (let k = 0; k < 257 - L; k += 1) o.push(d[i + 1]);
      i += 2;
    }
  }
  return o.done();
}

function lzw(d, cap, early) {
  const o = new Out(cap, d.length * 3);
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const len = new Uint16Array(4096);
  for (let k = 0; k < 256; k += 1) { prefix[k] = -1; suffix[k] = k; first[k] = k; len[k] = 1; }
  let next = 258;
  let width = 9;
  let prev = -1;
  let bits = 0;
  let nbits = 0;
  let i = 0;
  ENDED = false;
  const emit = (code) => {
    const L = len[code];
    o.fit(L);
    let at = o.n + L - 1;
    for (let c = code; c >= 0; c = prefix[c]) { o.b[at] = suffix[c]; at -= 1; }
    o.n += L;
  };
  for (;;) {
    while (nbits < width && i < d.length) { bits = ((bits << 8) | d[i]) & 0xffffff; nbits += 8; i += 1; }
    if (nbits < width) break;
    const code = (bits >>> (nbits - width)) & ((1 << width) - 1);
    nbits -= width;
    if (code === 256) { next = 258; width = 9; prev = -1; continue; }
    if (code === 257) { ENDED = true; break; }
    if (prev < 0) { if (code > 255) unchecked(); emit(code); prev = code; continue; }
    let f;
    if (code < next) f = first[code]; else if (code === next) f = first[prev]; else unchecked();
    if (next < 4096) { prefix[next] = prev; suffix[next] = f; first[next] = first[prev]; len[next] = len[prev] + 1; next += 1; }
    emit(code);
    prev = code;
    if (next + early >= (1 << width) && width < 12) width += 1;
  }
  return o.done();
}

const int = (v, fallback) => (typeof v === 'number' && Number.isInteger(v) ? v : fallback);
function predict(d, parms, cap) {
  const p = int(parms.Predictor, 1);
  if (p <= 1) return d;
  const colors = int(parms.Colors, 1);
  const bpc = int(parms.BitsPerComponent, 8);
  const columns = int(parms.Columns, 1);
  if (colors < 1 || colors > 32 || ![1, 2, 4, 8, 16].includes(bpc) || columns < 1 || columns > 10 * 1000 * 1000) unchecked();
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  if (p === 2) {
    if (bpc !== 8) unchecked();
    const o = Buffer.from(d);
    for (let r = 0; r < o.length; r += rowLen) for (let k = r + colors; k < Math.min(r + rowLen, o.length); k += 1) o[k] = (o[k] + o[k - colors]) & 255;
    return o;
  }
  if (p < 10 || p > 15) unchecked();
  const rows = Math.floor(d.length / (rowLen + 1));
  if (rows * rowLen > cap) unchecked();
  const o = Buffer.alloc(rows * rowLen);
  for (let r = 0; r < rows; r += 1) {
    const t = d[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1;
    const at = r * rowLen;
    for (let k = 0; k < rowLen; k += 1) {
      const x = d[src + k];
      const a = k >= bpp ? o[at + k - bpp] : 0;
      const up = r ? o[at - rowLen + k] : 0;
      const c = r && k >= bpp ? o[at - rowLen + k - bpp] : 0;
      let v;
      if (t === 0) v = x;
      else if (t === 1) v = x + a;
      else if (t === 2) v = x + up;
      else if (t === 3) v = x + ((a + up) >> 1);
      else if (t === 4) { const pp = a + up - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - up); const pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); } else unchecked();
      o[at + k] = v & 255;
    }
  }
  return o;
}

const FILTERS = { FlateDecode: 'flate', Fl: 'flate', LZWDecode: 'lzw', LZW: 'lzw', ASCIIHexDecode: 'hex', AHx: 'hex', ASCII85Decode: 'a85', A85: 'a85', RunLengthDecode: 'rl', RL: 'rl' };
// One filter. With `whole`, its data must hold the filter's own end (a Flate stream that is not cut short, ...): where a
// stream ends was not given by a /Length a reader would use the same way, so a reader could have more of it.
function decodeOne(d, filter, parms, cap, whole = false) {
  // A predictor's numbers given by reference would be read by a reader and not here.
  for (const key of ['Predictor', 'Colors', 'BitsPerComponent', 'Columns', 'EarlyChange']) if (parms[key] !== undefined && !Number.isInteger(parms[key])) unchecked();
  if (filter === 'flate') {
    let out;
    try {
      out = zlib.inflateSync(d, whole ? { maxOutputLength: cap } : { maxOutputLength: cap, finishFlush: zlib.constants.Z_SYNC_FLUSH });
    } catch {
      unchecked();
    }
    return predict(out, parms, cap);
  }
  let out;
  if (filter === 'lzw') out = predict(lzw(d, cap, int(parms.EarlyChange, 1) ? 1 : 0), parms, cap);
  else if (filter === 'hex') out = asciiHex(d, cap);
  else if (filter === 'a85') out = ascii85(d, cap);
  else out = runLength(d, cap);
  if (whole && !ENDED) unchecked();
  return out;
}

// --- a stream's dictionary -----------------------------------------------------------------------------------------------
// What is kept of the keys below: each value as a small tree ({ n } a name, a number, { r } a reference, { s } a string,
// { k } a keyword, { a: [...] } an array, { d: [...] } a dictionary as its tokens in order).
const KEPT_KEYS = new Set(['Length', 'Filter', 'DecodeParms', 'N', 'First', 'Extends', 'Type']);
const pairs = (items) => {
  if (items.length % 2) unchecked();
  const m = new Map();
  for (let k = 0; k < items.length; k += 2) {
    if (!items[k] || items[k].n === undefined) unchecked();
    m.set(items[k].n, items[k + 1]);
  }
  return m;
};
// The one value of a kept key, or undefined; a key given twice, or a value that is not one, is Unchecked.
function oneValue(entries, key) {
  const list = entries.get(key);
  if (!list) return undefined;
  if (list.length !== 1 || list[0].length !== 1) unchecked();
  return list[0][0];
}
function filterChain(entries) {
  const f = oneValue(entries, 'Filter');
  const p = oneValue(entries, 'DecodeParms');
  if (f === undefined) return [];
  const names = f.n !== undefined ? [f] : f.a ? f.a : unchecked();
  if (names.length > LIMITS.filters) unchecked();
  let parms = [];
  if (p !== undefined && !(p.k === 'null')) parms = p.d ? [p] : p.a ? p.a : unchecked();
  return names.map((x, k) => {
    if (!x || x.n === undefined || !FILTERS[x.n]) unchecked();
    const q = parms[k];
    const map = q && q.d ? pairs(q.d) : q === undefined || q.k === 'null' ? new Map() : unchecked();
    const values = {};
    for (const [key, v] of map) values[key] = v;
    return { filter: FILTERS[x.n], parms: values };
  });
}

// --- the file ------------------------------------------------------------------------------------------------------------
// The file is read in windows of WINDOW bytes, each overlapping the next by OVERLAP, so a scan never holds the whole file:
// a token always lies whole inside the window it is read in (one longer than a window is not checked). An object
// stream's own bytes (at most LIMITS.rawStream) and what it decodes to are the only parts held whole.
const WINDOW = 1024 * 1024;
const OVERLAP = 64 * 1024;
// How deep a part read again as syntax (below) may lie inside another one that was.
const MAX_DEPTH = 4;
const ENDSTREAM = Buffer.from('endstream', 'latin1');
const ENDOBJ = Buffer.from('endobj', 'latin1');
const OBJ = Buffer.from('obj', 'latin1');
const TRAILER = Buffer.from('trailer', 'latin1');
const isDigit = (c) => c >= 0x30 && c <= 0x39;

// Where a scan's bytes come from: a Buffer (the checks), or an open file read with fs.readSync.
function readInto(fd, buf, pos, len) {
  let got = 0;
  while (got < len) {
    const r = fs.readSync(fd, buf, got, len - got, pos + got);
    if (!r) break;
    got += r;
  }
  return buf.subarray(0, got);
}
function bufferSource(b) {
  return { size: b.length, buffer: b, read: (pos, len) => b.subarray(pos, Math.min(b.length, pos + len)) };
}
function fileSource(fd, size) {
  return { size, fd, read: (pos, len) => { const k = Math.max(0, Math.min(len, size - pos)); return readInto(fd, Buffer.allocUnsafe(k), pos, k); } };
}
// `len` bytes from `pos` (at most a window and its overlap): a view of a Buffer, or read into the scan's one scratch
// buffer, good until the next call.
function chunk(ctx, pos, len) {
  len = Math.max(0, Math.min(len, WINDOW + OVERLAP, ctx.size - pos));
  if (ctx.src.buffer) return ctx.src.buffer.subarray(pos, pos + len);
  if (!ctx.scratch) ctx.scratch = Buffer.allocUnsafe(WINDOW + OVERLAP);
  return readInto(ctx.src.fd, ctx.scratch, pos, len);
}

// The object id ("N G") just before the "obj" at `at`, looked back at most 48 bytes and never before `stop`:
// { start, num, gen } or null.
function idBefore(d, at, stop) {
  stop = Math.max(stop, at - 48);
  let k = at - 1;
  while (k >= stop && CLS[d[k]] === WS) k -= 1;
  let gen = 0;
  let scale = 1;
  let n = 0;
  while (k >= stop && isDigit(d[k])) { gen += (d[k] - 0x30) * scale; scale *= 10; k -= 1; n += 1; }
  if (!n || n > 10 || k < stop || CLS[d[k]] !== WS) return null;
  while (k >= stop && CLS[d[k]] === WS) k -= 1;
  let num = 0;
  scale = 1;
  n = 0;
  while (k >= stop && isDigit(d[k])) { num += (d[k] - 0x30) * scale; scale *= 10; k -= 1; n += 1; }
  if (!n || n > 15) return null;
  return { start: k + 1, num, gen };
}

// The first place in `d` (from `from` to `to`) where a reader could start reading an object ("N G obj") or a trailer:
// its index, or -1.
function objectStart(whole, from, to) {
  if (to - from < 7) return -1;
  const d = whole.subarray(from, to); // every search ends at `to`
  let first = d.indexOf(TRAILER);
  for (let at = d.indexOf(OBJ); at >= 0 && (first < 0 || at < first); at = d.indexOf(OBJ, at + 3)) {
    if (at + 3 < d.length && CLS[d[at + 3]] === 0) continue; // "object", not "obj"
    const id = idBefore(d, at, 0);
    if (id) { first = first < 0 ? id.start : Math.min(first, id.start); break; }
  }
  return first < 0 ? -1 : from + first;
}
// The same over the scan's bytes from `from` to `to`, a window at a time: an absolute position, or -1.
function findObjectStart(ctx, from, to) {
  if (ctx.src.buffer) return objectStart(ctx.src.buffer, from, to);
  for (let p = from; p < to; p += WINDOW) {
    const cs = Math.max(from, p - 64);
    const d = chunk(ctx, cs, Math.min(to, p + WINDOW + 16) - cs);
    const at = objectStart(d, 0, d.length);
    if (at >= 0) return cs + at;
  }
  return -1;
}
// The first `needle` from `from` to `to`: an absolute position, or -1.
function findIn(ctx, needle, from, to) {
  if (ctx.src.buffer) { const at = ctx.src.buffer.subarray(from, to).indexOf(needle); return at >= 0 ? from + at : -1; }
  for (let p = from; p < to; p += WINDOW) {
    const d = chunk(ctx, p, Math.min(to - p, WINDOW + needle.length - 1));
    const at = d.indexOf(needle);
    if (at >= 0) return p + at;
  }
  return -1;
}

// The integer objects ("N G obj <integer> endobj") of the whole file, for a stream whose /Length is a reference, found
// by a search of the bytes that no string, comment or stream can hide one from: idKey(num, gen) -> the integer, or null when
// that id is given more than once with different values or as something else too (a reader's cross-reference table
// picks one, and the scan can't know which). Made the first time a reference needs it, in two searches.
const idKey = (num, gen) => num * 65536 + gen;
function integerObjects(ctx) {
  if (ctx.lengths) return ctx.lengths;
  const found = new Map();
  const each = (fn) => {
    for (let p = 0; p < ctx.size; p += WINDOW) {
      const cs = Math.max(0, p - 64);
      const d = chunk(ctx, cs, Math.min(ctx.size, p + WINDOW + 128) - cs);
      const from = p - cs;
      for (let at = d.indexOf(OBJ, from); at >= 0 && at < from + WINDOW; at = d.indexOf(OBJ, at + 3)) {
        if (at + 3 < d.length && CLS[d[at + 3]] === 0) continue;
        const id = idBefore(d, at, 0);
        if (id && id.gen <= 65535) fn(idKey(id.num, id.gen), d, at + 3);
      }
    }
  };
  // Every id given as an integer, and how many times.
  each((key, d, k) => {
    const stop = Math.min(d.length, k + 64);
    while (k < stop && CLS[d[k]] === WS) k += 1;
    let v = 0;
    let n = 0;
    while (k < stop && isDigit(d[k])) { if (n < 15) v = v * 10 + d[k] - 0x30; k += 1; n += 1; }
    if (!n || n > 15 || k >= stop || CLS[d[k]] !== WS) return;
    while (k < stop && CLS[d[k]] === WS) k += 1;
    if (k + 6 > d.length || !d.subarray(k, k + 6).equals(ENDOBJ) || (k + 6 < d.length && CLS[d[k + 6]] === 0)) return;
    const had = found.get(key);
    if (had === undefined) {
      if (found.size >= LIMITS.integerObjects) unchecked();
      found.set(key, { value: v, ints: 1, all: 0 });
    } else { had.ints += 1; if (had.value !== v) had.value = null; }
  });
  // Every time each of those ids is given at all.
  if (found.size) each((key) => { const had = found.get(key); if (had) had.all += 1; });
  ctx.lengths = new Map();
  for (const [key, f] of found) ctx.lengths.set(key, f.all === f.ints ? f.value : null);
  return ctx.lengths;
}

// Where "endstream" stands at `p`, after at most 64 bytes of whitespace: its position, or -1.
function endstreamAt(ctx, p, to) {
  if (p > to) return -1;
  const d = chunk(ctx, p, Math.min(to - p, 64 + ENDSTREAM.length));
  let k = 0;
  while (k < Math.min(d.length, 64) && CLS[d[k]] === WS) k += 1;
  return k + ENDSTREAM.length <= d.length && d.subarray(k, k + ENDSTREAM.length).equals(ENDSTREAM) ? p + k : -1;
}

// A window for a scan `depth` deep, from `pos`, never past `to`. Each depth has its own buffer (for a file), used again
// by every scan at that depth.
function windowAt(ctx, depth, pos, to) {
  let w = ctx.wins[depth];
  if (!w) { w = { buf: ctx.src.buffer ? null : Buffer.allocUnsafe(WINDOW + OVERLAP), base: 0, b: null, last: true }; ctx.wins[depth] = w; }
  const len = Math.max(0, Math.min(WINDOW + OVERLAP, to - pos));
  w.base = pos;
  w.b = ctx.src.buffer ? ctx.src.buffer.subarray(pos, pos + len) : readInto(ctx.src.fd, w.buf, pos, len);
  w.last = pos + w.b.length >= to;
  return w;
}

// Reads the bytes from `from` to `to` as PDF syntax, token by token: null or { name, what }; throws Unchecked. A part it
// does not read as syntax (a string, a comment, a stream's bytes) that holds the start of an object is read again from
// that start, one level deeper.
function scanRange(ctx, from, to, depth) {
  if (depth > MAX_DEPTH) unchecked();
  const count = ctx.count;
  let w = windowAt(ctx, depth, from, to);
  let b = w.b;
  let i = 0;
  // Reads on from `abs`: in this window while a token there still has OVERLAP bytes after it (or the window is the
  // last), else from a new window that starts there (always, with `fresh`).
  const move = (abs, fresh = false) => {
    if (!fresh && abs >= w.base && abs <= w.base + b.length && (w.last || abs - w.base <= b.length - OVERLAP)) { i = abs - w.base; return; }
    w = windowAt(ctx, depth, abs, to);
    b = w.b;
    i = 0;
  };
  // A string's or a comment's bytes (lo to hi in the window), read again from the first object that starts in them.
  const inside = (lo, hi) => {
    const at = objectStart(b, lo, hi);
    return at >= 0 ? scanRange(ctx, w.base + at, w.base + hi, depth + 1) : null;
  };
  // Where the tokens are: how deep, whether the outermost is a dictionary, and in it whether a key was just read.
  let level = 0;
  let topDict = false;
  let afterKey = false;
  let entries = null; // the outermost dictionary's kept keys: key -> [value tokens, ...]
  let cap = null; // the value being kept: { items, stack, size }
  let closed = null; // entries of the dictionary that the last token closed
  let p1 = 0;
  let p2 = 0; // the kinds of the two tokens before
  let link = false;
  const reset = () => { level = 0; topDict = false; afterKey = false; entries = null; cap = null; };
  const keep = (item) => {
    if (!cap) return;
    cap.size += 1;
    if (cap.size > LIMITS.captured) { cap.over = true; return; }
    const top = cap.stack[cap.stack.length - 1];
    if (item.k === 'R' && top.length >= 2 && typeof top[top.length - 1] === 'number' && typeof top[top.length - 2] === 'number') { const r = [top[top.length - 2], top[top.length - 1]]; top.length -= 2; top.push({ r }); return; }
    top.push(item);
  };
  const endValue = () => {
    if (!cap) return;
    // A value too long to keep counts as two, so it is never taken as the one value of its key.
    entries.get(cap.key).push(cap.over ? [{ over: true }, { over: true }] : cap.items);
    cap = null;
  };

  for (;;) {
    if (!w.last && i > b.length - OVERLAP) move(w.base + i);
    if (i >= b.length) break;
    const kind = lex(b, i, b.length, link);
    // Whitespace to the window's end is skipped; a token that reaches it is read again from a window that starts with
    // it, and one longer than a window is not checked.
    if (!w.last && T_END >= b.length) {
      if (kind === EOF) { move(w.base + b.length, true); continue; }
      if (T_START === 0) unchecked();
      move(w.base + T_START, true);
      continue;
    }
    if (kind === EOF) break;
    const start = T_START;
    i = T_END;
    if (kind === COMMENT) {
      const r = inside(start + 1, i);
      if (r) return r;
      continue;
    }
    const wasClosed = closed;
    closed = null;
    if (link) {
      link = false;
      if (kind === STR && !webLink(T_VAL)) return { name: 'URI', what: 'opens' };
      if (kind === INT) unchecked();
    }
    if (kind === NAME) {
      if (T_VAL !== null && ACTIVE_NAMES.has(T_VAL)) return { name: T_VAL, what: ACTIVE_NAMES.get(T_VAL) };
      if (T_VAL === 'URI') link = true;
      if (level === 1 && topDict) {
        if (afterKey) { keep({ n: T_VAL }); afterKey = false; } else {
          endValue();
          afterKey = true;
          if (T_VAL !== null && KEPT_KEYS.has(T_VAL)) {
            const items = [];
            cap = { key: T_VAL, items, stack: [items], size: 0 };
            if (!entries.has(T_VAL)) entries.set(T_VAL, []);
          }
        }
      } else keep({ n: T_VAL });
    } else if (kind === INT || kind === REAL) {
      keep(kind === INT ? T_INT : 0.5);
      if (level === 1) afterKey = false;
    } else if (kind === STR) {
      const value = T_VAL;
      const r = inside(start + 1, i);
      if (r) return r;
      T_VAL = value;
      keep({ s: true });
      if (level === 1) afterKey = false;
    } else if (kind === DOPEN || kind === AOPEN) {
      if (level === 0) { reset(); topDict = kind === DOPEN; if (topDict) entries = new Map(); } else {
        if (cap) { const box = []; keep(kind === DOPEN ? { d: box } : { a: box }); if (!cap.over) cap.stack.push(box); }
        if (level === 1) afterKey = false;
      }
      level += 1;
    } else if (kind === DCLOSE || kind === ACLOSE) {
      if (level > 0) level -= 1;
      if (level >= 1 && cap && cap.stack.length > 1) cap.stack.pop();
      if (level === 0 && topDict) {
        endValue();
        if (kind === DCLOSE) closed = entries;
        topDict = false;
        entries = null;
      }
    } else if (kind === KW) {
      const word = T_VAL;
      if (word === 'obj') {
        if (p1 === INT && p2 === INT) {
          ctx.sawObj = true;
          count.objects += 1;
          if (count.objects > LIMITS.objects) unchecked();
        }
        reset();
      } else if (word === 'stream' && wasClosed) {
        const r = stream(ctx, b, w.base, i, wasClosed, to, depth);
        if (r.found) return r.found;
        move(r.resume);
        reset();
      } else if (word === 'endobj' || word === 'endstream' || word === 'trailer' || word === 'xref' || word === 'startxref') reset();
      else { keep({ k: word }); if (level === 1 && word !== 'R') afterKey = false; }
    }
    p2 = p1;
    p1 = kind;
  }
  return null;
}

// The stream whose keyword ends at `i` of the window `b` (which starts at `base`), with the dictionary before it. Where
// it ends: at its /Length when "endstream" stands there; a /Length given by reference is read from that integer object
// (integerObjects), and one that can't be, or that does not end at "endstream", leaves the PDF unchecked (security QA
// round 2, round 2: a reader uses the referenced length while the first "endstream" stood inside the data); with no
// /Length, or a direct one that does not end there, at the first "endstream". Its bytes, where they hold the start of
// an object, are read again as syntax from there; an object stream is also decoded and read. Answers { resume } (where
// its "endstream" is) or { found }.
function stream(ctx, b, base, i, entries, to, depth) {
  const count = ctx.count;
  count.streams += 1;
  if (count.streams > LIMITS.streams) unchecked();
  // The data starts on the next line.
  let s = i;
  for (let k = i; k < Math.min(b.length, i + 256); k += 1) {
    if (b[k] === 0x0a) { s = k + 1; break; }
    if (b[k] === 0x0d) { s = b[k + 1] === 0x0a ? k + 2 : k + 1; break; }
  }
  s += base;
  let end = -1;
  let resume = -1;
  let byLength = false; // ended by a /Length given in the dictionary itself, which a reader reads the same way
  const lengthItems = entries.get('Length');
  const L = lengthItems && lengthItems.length === 1 && lengthItems[0].length === 1 ? lengthItems[0][0] : null;
  if (typeof L === 'number' && Number.isInteger(L) && L >= 0 && s + L <= to) {
    const at = endstreamAt(ctx, s + L, to);
    if (at >= 0) { end = s + L; resume = at; byLength = true; }
  } else if (L && L.r) {
    const v = Number.isInteger(L.r[0]) && Number.isInteger(L.r[1]) && L.r[0] >= 0 && L.r[1] >= 0 && L.r[1] <= 65535 ? integerObjects(ctx).get(idKey(L.r[0], L.r[1])) : undefined;
    const at = Number.isInteger(v) && s + v <= to ? endstreamAt(ctx, s + v, to) : -1;
    if (at < 0) unchecked();
    end = s + v;
    resume = at;
  }
  if (end < 0) {
    const at = findIn(ctx, ENDSTREAM, s, to);
    if (at < 0) { end = to; resume = to; } else {
      end = at;
      const before = chunk(ctx, Math.max(s, at - 2), at - Math.max(s, at - 2));
      if (end > s && before[before.length - 1] === 0x0a) end -= 1;
      if (end > s && before[before.length - 1 - (at - end)] === 0x0d) end -= 1;
      resume = at;
    }
  }
  // Its bytes, where they hold the start of an object.
  const at = findObjectStart(ctx, s, end);
  if (at >= 0) {
    const found = scanRange(ctx, at, end, depth + 1);
    if (found) return { found };
  }
  const typeList = entries.get('Type') || [];
  const objectStream = entries.has('N') || entries.has('First') || entries.has('Extends') || typeList.some((v) => v.some((x) => x && x.n === 'ObjStm'));
  if (objectStream) {
    count.decoded += 1;
    if (count.decoded > LIMITS.decodedStreams) unchecked();
    if (end - s > LIMITS.rawStream) unchecked();
    let d = ctx.src.read(s, end - s);
    const chain = filterChain(entries);
    // Not ended by its own /Length, a reader may take more of it: its first filter must end inside what the scan took.
    if (!byLength && !chain.length) unchecked();
    chain.forEach((step, k) => {
      const left = Math.min(LIMITS.streamOut, LIMITS.allOut - count.out);
      if (left <= 0) unchecked();
      d = decodeOne(d, step.filter, step.parms, left, !byLength && k === 0);
    });
    count.out += d.length;
    if (count.out > LIMITS.allOut) unchecked();
    const found = namesIn(d, 0, d.length);
    if (found) return { found };
    // A name that reading did not see as one (inside what it read as a string) is one a reader taking each object from
    // its own offset could: not judged.
    if (anyNameIn(d, 0, d.length)) unchecked();
  }
  return { resume };
}

function run(src) {
  if (src.size < 8 || src.read(0, 5).latin1Slice(0, 5) !== '%PDF-') return { refuse: 'damaged' };
  const ctx = { src, size: src.size, count: { objects: 0, streams: 0, decoded: 0, out: 0 }, wins: [], lengths: null, scratch: null, sawObj: false };
  const found = scanRange(ctx, 0, src.size, 0);
  if (found) return found;
  const tail = src.read(Math.max(0, src.size - 1024), 1024);
  if (!ctx.sawObj || tail.indexOf('%%EOF') < 0 || (tail.indexOf('startxref') < 0 && tail.indexOf(TRAILER) < 0)) return { refuse: 'damaged' };
  return null;
}
function answer(fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof Unchecked) return { refuse: 'unchecked' };
    throw err;
  }
}

// The scan of a whole PDF held in a Buffer: null, { name, what } or { refuse: 'damaged' | 'unchecked' }.
function pdfScan(b) {
  return answer(() => run(bufferSource(b)));
}
// The same for a file, read a window at a time.
function pdfScanFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    return answer(() => run(fileSource(fd, fs.fstatSync(fd).size)));
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { pdfScan, pdfScanFile, ACTIVE_NAMES, LIMITS, WINDOW };
