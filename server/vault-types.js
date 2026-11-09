// What a library module's file is (documentation/plans/plan-attachments-vault.md, section 1): decided from its own first
// bytes, never from its name or the type it was sent with, then compared with both. A file whose name or type says
// something else is refused, and so is anything not in the table: SVG, HTML, XML, scripts, programs, archives, Office
// files, Matroska and HEIC. The server never opens, decodes or runs a file; it reads a few header bytes, a picture's
// size from its header and a Markdown file's text; a PDF is scanned by server/pdf-scan.js, and every check of a whole
// file runs in the scan worker (server/vault-scan.js). Sentences are the caller's (they need the
// environment's words); this file answers what was found.
'use strict';

const fs = require('fs');

const MB = 1024 * 1024;
// The limit each kind of file has, and the word for it in "That file is over the 25 MB limit for pictures."
const LIMITS = {
  image: { bytes: 25 * MB, words: 'pictures' },
  audio: { bytes: 200 * MB, words: 'audio' },
  video: { bytes: 2048 * MB, words: 'video' },
  pdf: { bytes: 100 * MB, words: 'PDFs' },
  markdown: { bytes: 1 * MB, words: 'Markdown' },
};
const MAX_BYTES = Math.max(...Object.values(LIMITS).map((l) => l.bytes));
// The head read to decide a type: a WebM's DocType is somewhere in its first 4 KB.
const HEAD_BYTES = 4096;
// A picture whose header says more than this many pixels is refused, so no viewer is handed a decompression bomb.
const MAX_PIXELS = 100 * 1000 * 1000;
// What a person is told when a picture is over it (the Vault's and a module's uploads).
const PICTURE_LARGE = 'That picture is too large to show.';

// type -> { group (what the list shows), limit (a key of LIMITS), exts (the first is the one a name is given),
// claims (the types a browser may send it as) }
const TYPES = {
  'image/jpeg': { group: 'image', limit: 'image', exts: ['jpg', 'jpeg'], claims: ['image/jpeg', 'image/jpg', 'image/pjpeg'] },
  'image/png': { group: 'image', limit: 'image', exts: ['png'], claims: ['image/png', 'image/apng', 'image/x-png'] },
  'image/webp': { group: 'image', limit: 'image', exts: ['webp'], claims: ['image/webp'] },
  'image/gif': { group: 'image', limit: 'image', exts: ['gif'], claims: ['image/gif'] },
  'audio/mpeg': { group: 'audio', limit: 'audio', exts: ['mp3'], claims: ['audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg', 'audio/x-mp3'] },
  'audio/ogg': { group: 'audio', limit: 'audio', exts: ['ogg', 'oga'], claims: ['audio/ogg', 'application/ogg', 'audio/x-ogg', 'audio/vorbis', 'audio/opus'] },
  'audio/wav': { group: 'audio', limit: 'audio', exts: ['wav'], claims: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'] },
  'audio/mp4': { group: 'audio', limit: 'audio', exts: ['m4a'], claims: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'] },
  'video/mp4': { group: 'video', limit: 'video', exts: ['mp4'], claims: ['video/mp4', 'application/mp4'] },
  'video/webm': { group: 'video', limit: 'video', exts: ['webm'], claims: ['video/webm', 'audio/webm'] },
  'video/quicktime': { group: 'video', limit: 'video', exts: ['mov'], claims: ['video/quicktime'] },
  'application/pdf': { group: 'document', limit: 'pdf', exts: ['pdf'], claims: ['application/pdf', 'application/x-pdf'] },
  'text/markdown': { group: 'document', limit: 'markdown', exts: ['md'], claims: ['text/markdown', 'text/x-markdown', 'text/plain'] },
};
// What a browser sends for a file it has no type for: says nothing, so never a mismatch.
const SAYS_NOTHING = ['', 'application/octet-stream', 'binary/octet-stream'];
const HEIC_EXTS = ['heic', 'heif', 'hif'];
const HEIC_CLAIMS = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
const HEIC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1'];
const ISO_BRANDS = ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'MSNV', 'mmp4', '3gp4', '3gp5', '3gp6', '3g2a'];

const ext = (name) => (/\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''))?.[1] || '').toLowerCase();
const claimOf = (contentType) => String(contentType || '').split(';')[0].trim().toLowerCase();

// Before the body: whether the name and the type it is sent with could be a file the Vault takes. Answers null, 'heic'
// or 'kind' (any other refusal).
function claimRefusal(name, contentType) {
  const e = ext(name);
  const c = claimOf(contentType);
  if (HEIC_EXTS.includes(e) || HEIC_CLAIMS.includes(c)) return 'heic';
  if (e && !Object.values(TYPES).some((t) => t.exts.includes(e))) return 'kind';
  if (!SAYS_NOTHING.includes(c) && !Object.values(TYPES).some((t) => t.claims.includes(c))) return 'kind';
  return null;
}

// Before the body: the type the name (or else the type sent) points to, for the limit to check Content-Length against;
// null when neither says.
function claimedType(name, contentType) {
  const e = ext(name);
  const c = claimOf(contentType);
  return Object.keys(TYPES).find((t) => TYPES[t].exts.includes(e)) || Object.keys(TYPES).find((t) => TYPES[t].claims.includes(c) && c !== 'text/plain') || null;
}

// Once the type is known from the bytes: whether the name's extension or the type sent says another one.
function mismatch(type, name, contentType) {
  const t = TYPES[type];
  const e = ext(name);
  const c = claimOf(contentType);
  return Boolean((e && !t.exts.includes(e)) || (!SAYS_NOTHING.includes(c) && !t.claims.includes(c)));
}

// The ftyp box's brands: [major, ...compatible], or null when it is not a whole, sane box: a size of 16 to 1024 bytes in
// whole brands, inside the head, and (when the head holds it) a next box with a size and a four-letter type.
function ftypBrands(b) {
  if (b.length < 16 || b.toString('latin1', 4, 8) !== 'ftyp') return null;
  const size = b.readUInt32BE(0);
  if (size < 16 || size > 1024 || size % 4 || size > b.length) return null;
  if (b.length >= size + 8) {
    const next = b.readUInt32BE(size);
    if (!(next === 0 || next === 1 || next >= 8) || !/^[\x20-\x7e]{4}$/.test(b.toString('latin1', size + 4, size + 8))) return null;
  }
  const out = [b.toString('latin1', 8, 12)];
  for (let i = 16; i + 4 <= size; i += 4) out.push(b.toString('latin1', i, i + 4));
  return out;
}

// An EBML variable-length number at `i`: { value, length } (the marker bit kept for an element id, taken off for a size),
// or null.
function ebmlVint(b, i, id) {
  if (i >= b.length || !b[i]) return null;
  const length = Math.clz32(b[i]) - 23;
  if (length > (id ? 4 : 8) || i + length > b.length) return null;
  let value = id ? b[i] : b[i] & (0xff >> length);
  for (let k = 1; k < length; k += 1) value = value * 256 + b[i + k];
  return { value, length };
}
// A WebM's EBML header, read as elements, names its DocType: 'webm', 'matroska' (refused), or null. The header must be
// whole inside the head and followed by the Segment (or a Void element) when the head holds that far.
function ebmlDocType(b) {
  const head = b.subarray(0, HEAD_BYTES);
  const size = ebmlVint(head, 4, false);
  if (!size || 4 + size.length + size.value > head.length) return null;
  const end = 4 + size.length + size.value;
  if (head.length >= end + 4 && !(head.readUInt32BE(end) === 0x18538067 || head[end] === 0xec)) return null;
  let docType = null;
  for (let i = 4 + size.length; i < end;) {
    const id = ebmlVint(head, i, true);
    const len = id && ebmlVint(head, i + id.length, false);
    if (!id || !len) return null;
    const at = i + id.length + len.length;
    if (at + len.value > end) return null;
    if (id.value === 0x4282) docType = head.toString('latin1', at, at + len.value).replace(/\0+$/, '');
    i = at + len.value;
  }
  return docType;
}

// An MPEG audio frame header at `i`: its length in bytes, or 0 when it is not one (11 bits of sync, a version and a
// layer that are not the reserved ones -- layer 00 is AAC's ADTS, not taken -- a bitrate that is neither free nor bad,
// a sample rate that is not the reserved one).
const MP3_RATES = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
MP3_RATES['2-3'] = MP3_RATES['2-2'];
const MP3_SAMPLES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3Frame(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0;
  const version = (b[i + 1] >> 3) & 3;
  const layer = 4 - ((b[i + 1] >> 1) & 3);
  if (version === 1 || layer === 4) return 0;
  const rate = MP3_RATES[`${version === 3 ? 1 : 2}-${layer}`][b[i + 2] >> 4];
  const sample = MP3_SAMPLES[version][(b[i + 2] >> 2) & 3];
  if (!rate || !sample) return 0;
  const pad = (b[i + 2] >> 1) & 1;
  if (layer === 1) return (Math.floor((12 * rate * 1000) / sample) + pad) * 4;
  return Math.floor(((layer === 3 && version !== 3 ? 72 : 144) * rate * 1000) / sample) + pad;
}
// Two frames one after the other from `i` (or one, when the bytes end before the second could).
function mp3Frames(b, i) {
  const len = mp3Frame(b, i);
  if (!len) return false;
  return i + len + 4 > b.length || mp3Frame(b, i + len) > 0;
}
// An ID3v2 tag at the start: the offset its frames follow at, or -1 when it is not a sane one (version 2 to 4, a
// syncsafe size no larger than the audio limit).
function id3End(b) {
  if (b.length < 10 || b.toString('latin1', 0, 3) !== 'ID3' || b[3] < 2 || b[3] > 4 || b[4] === 0xff) return -1;
  if ([6, 7, 8, 9].some((k) => b[k] & 0x80)) return -1;
  const size = ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + 10 + (b[5] & 0x10 ? 10 : 0);
  return size > LIMITS.audio.bytes ? -1 : size;
}
// What a PDF's first kilobyte must not hold: a page's or a script's tags.
const PDF_HTML_RE = /<\s*(?:!doctype|html|head|body|script|iframe|svg|object|embed|meta|img|style|link|form)\b/i;

// What the first bytes are: { type } for a type the Vault takes, else { refuse: 'heic' | 'kind' }. `name` decides only
// Markdown, which has no bytes of its own to know it by.
function sniff(b, name) {
  if (!Buffer.isBuffer(b) || b.length < 4) return { refuse: 'kind' };
  const latin = (from, to) => b.toString('latin1', from, to);
  if (b.length >= 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg' };
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png' };
  if (b.length >= 12 && latin(0, 4) === 'RIFF' && latin(8, 12) === 'WEBP') return { type: 'image/webp' };
  if (b.length >= 12 && latin(0, 4) === 'RIFF' && latin(8, 12) === 'WAVE') return { type: 'audio/wav' };
  if (b.length >= 10 && (latin(0, 6) === 'GIF87a' || latin(0, 6) === 'GIF89a')) return { type: 'image/gif' };
  if (latin(0, 4) === 'OggS') return { type: 'audio/ogg' };
  if (b.length >= 5 && latin(0, 5) === '%PDF-') return PDF_HTML_RE.test(latin(0, 1024)) ? { refuse: 'kind' } : { type: 'application/pdf' };
  const brands = ftypBrands(b);
  if (brands) {
    const [major] = brands;
    if (major === 'M4A ' || major === 'M4B ') return { type: 'audio/mp4' };
    if (major === 'qt  ') return { type: 'video/quicktime' };
    if (HEIC_BRANDS.includes(major) || (!brands.some((x) => ISO_BRANDS.includes(x)) && brands.some((x) => HEIC_BRANDS.includes(x)))) return { refuse: 'heic' };
    if (major === 'avif' || major === 'avis') return { refuse: 'kind' };
    if (brands.some((x) => ISO_BRANDS.includes(x))) return { type: 'video/mp4' };
    return { refuse: 'kind' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return ebmlDocType(b) === 'webm' ? { type: 'video/webm' } : { refuse: 'kind' };
  // MP3: a sane ID3v2 tag (the frames after it are looked at once the file is in: mp3Refusal), or two MPEG audio frames.
  if (latin(0, 3) === 'ID3') return id3End(b) > 0 ? { type: 'audio/mpeg' } : { refuse: 'kind' };
  if (mp3Frames(b, 0)) return { type: 'audio/mpeg' };
  if (ext(name) === 'md' && !b.includes(0)) return { type: 'text/markdown' };
  return { refuse: 'kind' };
}

// A GIF's largest picture: its screen, or any frame (with where it stands) that reaches past it, since a browser grows
// the picture to a frame larger than the screen (security QA round 2, round 2: a 2x2 screen with a 65535x65535 frame).
// Walks every block to the end; null when they don't read as a GIF's.
function gifPixels(b) {
  const screenW = b.readUInt16LE(6);
  const screenH = b.readUInt16LE(8);
  let most = screenW * screenH;
  let i = 13 + (b[10] & 0x80 ? 3 * 2 ** ((b[10] & 7) + 1) : 0);
  const blocks = () => { // sub-blocks, to the empty one
    while (i < b.length && b[i]) i += b[i] + 1;
    i += 1;
  };
  while (i < b.length) {
    const kind = b[i];
    if (kind === 0x3b) break;
    if (kind === 0x21) { i += 2; blocks(); continue; }
    if (kind !== 0x2c || i + 10 > b.length) return null;
    const right = b.readUInt16LE(i + 1) + b.readUInt16LE(i + 5);
    const bottom = b.readUInt16LE(i + 3) + b.readUInt16LE(i + 7);
    most = Math.max(most, Math.max(screenW, right) * Math.max(screenH, bottom));
    const flags = b[i + 9];
    i += 10 + (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0) + 1; // the colours, then the code size
    blocks();
  }
  return most;
}

// A JPEG's size from its frame header (SOF), walking every segment to the end of the picture (EOI): null when a second
// frame header follows (a decoder may take either), or when the segments don't read as a JPEG's.
function jpegPixels(b) {
  let i = 2;
  let pixels = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i += 1; continue; }
    if (m === 0xd9) break;
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (pixels !== null || i + 9 > b.length) return null;
      pixels = b.readUInt16BE(i + 5) * b.readUInt16BE(i + 7);
    }
    i += 2 + len;
    if (m === 0xda) {
      // The scan's coded data, to the next marker that is not a stuffed byte or a restart.
      while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0 && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7))) i += 1;
    }
  }
  return pixels;
}

// How many pixels a picture says it has (for a GIF and a JPEG, its largest frame), or null when that can't be read.
function picturePixels(b, type) {
  try {
    if (type === 'image/png') return b.toString('latin1', 12, 16) === 'IHDR' ? b.readUInt32BE(16) * b.readUInt32BE(20) : null;
    if (type === 'image/gif') return gifPixels(b);
    if (type === 'image/webp') {
      const chunk = b.toString('latin1', 12, 16);
      if (chunk === 'VP8X') return (1 + b.readUIntLE(24, 3)) * (1 + b.readUIntLE(27, 3));
      if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return (b.readUInt16LE(26) & 0x3fff) * (b.readUInt16LE(28) & 0x3fff);
      if (chunk === 'VP8L' && b[20] === 0x2f) { const v = b.readUInt32LE(21); return ((v & 0x3fff) + 1) * (((v >>> 14) & 0x3fff) + 1); }
      return null;
    }
    if (type === 'image/jpeg') return jpegPixels(b);
  } catch {
    return null;
  }
  return null;
}

// The structure of a whole recording, once it is in (security QA round 2: a valid start followed by a page was taken).
// Each reads with `read(position, length)` (a Buffer, shorter at the end) and walks at most a bounded number of parts.

// MPEG audio: from the first frame (after an ID3v2 tag and up to 64 KB of padding, or at the start), eight frames one
// after the other, or frames to the file's end or to a tag at its end (ID3v1, APE, Lyrics3). Answers null or 'kind'.
const MP3_RUN = 8;
function mp3Refusal(read, size) {
  const head = read(0, 10);
  const tagEnd = id3End(head);
  if (tagEnd < 0 && head.toString('latin1', 0, 3) === 'ID3') return 'kind';
  const from = Math.max(0, tagEnd);
  const b = read(from, 256 * 1024);
  const atEnd = from + b.length >= size;
  const tail = (p) => p === b.length || (b.length - p === 128 && b.toString('latin1', p, p + 3) === 'TAG') || ['APETAGEX', 'LYRICSBE'].includes(b.toString('latin1', p, p + 8));
  const run = (i) => {
    let p = i;
    for (let count = 0; count < MP3_RUN; count += 1) {
      const len = mp3Frame(b, p);
      if (!len) return atEnd && count > 0 && tail(p);
      if (p + len > b.length) return atEnd && count > 0; // the last frame, cut short
      p += len;
    }
    return true;
  };
  const last = tagEnd > 0 ? Math.min(b.length, 64 * 1024) : 1;
  for (let i = 0; i < last; i += 1) if (b[i] === 0xff && run(i)) return null;
  return 'kind';
}

// MP4, M4A and MOV: the top-level boxes, each with a size of at least its header and a four-character type, one after
// the other to the file's end exactly (a last box of size 0 runs to the end), at most 100,000 of them, and a movie
// box (moov) among them. Answers null or 'damaged'.
const ISO_BOXES_MAX = 100 * 1000;
function isoRefusal(read, size) {
  let pos = 0;
  let moov = false;
  for (let boxes = 0; pos < size; boxes += 1) {
    if (boxes >= ISO_BOXES_MAX || size - pos < 8) return 'damaged';
    const h = read(pos, 16);
    let len = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) return 'damaged';
    if (len === 1) {
      if (h.length < 16) return 'damaged';
      len = Number(h.readBigUInt64BE(8));
      if (len < 16) return 'damaged';
    } else if (len === 0) len = size - pos;
    else if (len < 8) return 'damaged';
    if (pos + len > size) return 'damaged';
    if (type === 'moov') moov = true;
    pos += len;
  }
  return moov ? null : 'damaged';
}

// WebM: right after its EBML header, the Segment; in it, elements a WebM has at its top level (SeekHead, Info, Tracks,
// Cluster, Cues, Chapters, Tags, Void, CRC-32: never Attachments, which only Matroska carries), each inside the Segment,
// at most 100,000 of them, until the Segment ends or an element of unknown size (a recording still being written)
// starts. Answers null, 'kind' or 'damaged'.
const WEBM_TOP = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1043a770, 0x1254c367, 0xec, 0xbf]);
const unknownSize = (v) => v.value === 2 ** (7 * v.length) - 1;
function webmRefusal(read, size) {
  const head = read(0, HEAD_BYTES);
  const hsize = ebmlVint(head, 4, false);
  if (!hsize) return 'kind';
  let pos = 4 + hsize.length + hsize.value;
  const at = (p) => {
    const b = read(p, 12);
    const id = ebmlVint(b, 0, true);
    const len = id && ebmlVint(b, id.length, false);
    return id && len ? { id: id.value, len, data: p + id.length + len.length } : null;
  };
  const seg = at(pos);
  if (!seg || seg.id !== 0x18538067) return 'kind';
  const segEnd = unknownSize(seg.len) ? size : seg.data + seg.len.value;
  if (segEnd > size) return 'damaged';
  pos = seg.data;
  for (let n = 0; pos < segEnd; n += 1) {
    if (n >= 100 * 1000) return 'damaged';
    const el = at(pos);
    if (!el) return 'damaged';
    if (!WEBM_TOP.has(el.id)) return 'kind';
    if (unknownSize(el.len)) return null;
    pos = el.data + el.len.value;
    if (pos > segEnd) return 'damaged';
  }
  return null;
}

// WAV: after "RIFF", its size and "WAVE", chunks one after the other to the file's end, each a four-character id and a
// size (padded to an even length), at most 100,000 of them, with a format chunk ("fmt ") before the sound ("data"). Only
// the sound may run past the end (a recording cut short, or written without its size). Answers null or 'damaged'.
const RIFF_CHUNKS_MAX = 100 * 1000;
function wavRefusal(read, size) {
  let pos = 12;
  let fmt = false;
  for (let n = 0; pos < size; n += 1) {
    if (n >= RIFF_CHUNKS_MAX || size - pos < 8) return 'damaged';
    const h = read(pos, 8);
    const id = h.toString('latin1', 0, 4);
    if (!/^[\x20-\x7e]{4}$/.test(id)) return 'damaged';
    const len = h.readUInt32LE(4);
    if (id === 'fmt ') fmt = true;
    if (id === 'data') {
      if (!fmt) return 'damaged';
      if (pos + 8 + len >= size) return null;
    }
    pos += 8 + len + (len & 1);
    if (pos > size + 1) return 'damaged';
  }
  return fmt ? null : 'damaged';
}

// Ogg: pages one after the other from the start to the file's end, each "OggS", version 0, its header flags, and a
// segment table whose sizes give its length, at most a million of them; the first page starts a stream. The last page
// may be cut short. Answers null or 'damaged'.
const OGG_PAGES_MAX = 1000 * 1000;
function oggRefusal(read, size) {
  let pos = 0;
  for (let n = 0; pos < size; n += 1) {
    if (n >= OGG_PAGES_MAX || size - pos < 27) return 'damaged';
    const h = read(pos, 27);
    if (h.toString('latin1', 0, 4) !== 'OggS' || h[4] !== 0 || h[5] > 7 || (n === 0 && !(h[5] & 2))) return 'damaged';
    const segments = read(pos + 27, h[26]);
    if (segments.length < h[26]) return 'damaged';
    let body = 0;
    for (const s of segments) body += s;
    pos += 27 + h[26] + body;
  }
  return null;
}

// Whether a Markdown file's bytes are text the Vault takes: UTF-8 with no NUL, and not a page or a drawing dressed as
// text. Answers null or 'kind'.
function markdownRefusal(b) {
  if (b.includes(0)) return 'kind';
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return 'kind';
  }
  if (/^﻿?\s*<(?:!doctype|html|svg|\?xml|script)\b/i.test(text)) return 'kind';
  return null;
}

// What stops a file that is not a picture or a PDF from being taken once it is in, from its structure: null, 'kind' or
// 'damaged'. Synchronous and bounded: it runs in the scan worker (server/vault-scan.js), never on the main thread.
const STRUCTURE = { 'audio/mpeg': mp3Refusal, 'video/mp4': isoRefusal, 'audio/mp4': isoRefusal, 'video/quicktime': isoRefusal, 'video/webm': webmRefusal, 'audio/wav': wavRefusal, 'audio/ogg': oggRefusal };
// The types whose whole file is looked at once it is in (the upload route sends these, pictures and PDFs to the worker).
const STRUCTURED = ['text/markdown', ...Object.keys(STRUCTURE)];
function structureRefusal(file, type) {
  if (type === 'text/markdown') return markdownRefusal(fs.readFileSync(file));
  const walk = STRUCTURE[type];
  if (!walk) return null;
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    // Reads through a 64 KB block kept from the last read, so a walk of many small parts (Ogg pages, RIFF chunks) makes
    // few reads of the file.
    const BLOCK = 64 * 1024;
    let block = Buffer.alloc(0);
    let blockAt = 0;
    const read = (position, length) => {
      const want = Math.max(0, Math.min(length, size - position));
      if (position >= blockAt && position + want <= blockAt + block.length) return block.subarray(position - blockAt, position - blockAt + want);
      const b = Buffer.alloc(Math.max(want, Math.min(BLOCK, size - position)));
      block = b.subarray(0, b.length ? fs.readSync(fd, b, 0, b.length, position) : 0);
      blockAt = position;
      return block.subarray(0, Math.min(want, block.length));
    };
    return walk(read, size);
  } finally {
    fs.closeSync(fd);
  }
}

// A library module's permissions that a guest never has and that Roles can't turn on for guests (plan section 6: "off,
// and cannot be turned on"); the library routes refuse guests whatever Roles says, and with these off the module's data
// routes do too. `remove_any` is only off by default there.
const GUEST_LOCKED = ['view', 'see_all', 'add', 'download', 'share'];

module.exports = { TYPES, LIMITS, MAX_BYTES, HEAD_BYTES, MAX_PIXELS, PICTURE_LARGE, GUEST_LOCKED, STRUCTURED, claimRefusal, claimedType, mismatch, sniff, picturePixels, structureRefusal, markdownRefusal };
