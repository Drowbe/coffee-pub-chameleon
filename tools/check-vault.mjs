#!/usr/bin/env node
/*
 * check-vault.mjs -- a library module's files (documentation/plans/plan-attachments-vault.md, step 1), with no outside
 * service. Part 1, the store on its own (server/vault-store.js): the layout on disk, ids and names, no path a caller
 * chooses, records written whole by a rename, what a restart leaves removed on start, usage counted per space and person,
 * a deleted space's files gone. Part 2, types (server/vault-types.js): each type from its own bytes; SVG, HTML, XML, zip,
 * programs, scripts, Matroska and HEIC refused; names and types sent checked before the body and against the bytes;
 * picture sizes from the header; a PDF's active content found as a stream; Markdown's text.
 * Then throwaway servers (DATA_DIR and VAULT_DIR under the temp folder, no LiveKit, no outside service). Server A, with
 * small quotas: every accepted type kept from its bytes and refused under a false name or type; SVG, HTML, a zip, HEIC,
 * Matroska, active PDFs, a huge-pixel PNG, cut pictures refused; where a picture was taken removed unless kept; each
 * limit from Content-Length before a byte is written; a body longer than its Content-Length cut off; an aborted upload's
 * part removed; two uploads at once reserving against one quota; the space, person, owner and server quotas; the minute's
 * allowance, the module upload limit and two uploads at once; access before the body. Serving: every header on every
 * type, ranges (206, 416, If-Range), downloads with both names, thumbnails, twelve open streams. The permission matrix
 * (signed out, guest pass, access key, outsider, member, adder, moderator, owner, admin) on every route, a refusal of a
 * file always 404 naming nothing; path tricks; rename and remove; activity lines without names. A server with
 * BASE_DOMAIN: another environment's session 401, its owner 404, the product and console hosts 404, the export without
 * the bytes, a plan's storage cap. Server B, at the defaults: the server's memory (VmRSS) stays flat while 1 GB streams
 * in, and with ten stalled readers and a slow one; a range deep in it; a 1 GB upload cut off leaves nothing.
 * Real files (tools/fixtures/vault/, made by ffmpeg, LibreOffice and ImageMagick) are taken; hostile PDFs are judged
 * in under a second each, through a worker, with the main thread kept free.
 * What can't be checked here: a browser's players seeking, and the PDF policy in a real browser (step 3, Verify).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildModule } = require('../server/module-build.js');
const { VaultStore, cleanName, nameForType, extensionOf } = require('../server/vault-store.js');
const types = require('../server/vault-types.js');
const { pdfScan, pdfScanFile, ACTIVE_NAMES, LIMITS: PDF_LIMITS, WINDOW: PDF_WINDOW } = require('../server/pdf-scan.js');
const { createScanner } = require('../server/vault-scan.js');
const { watchArrival, slowSenders } = require('../server/arrival.js');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1; };
const same = (a, b, msg) => { assert.deepEqual(a, b, msg); n += 1; };
const SPACE = 'abcd1234';
const OTHER = 'wxyz9876';

// --- part 1: the store ------------------------------------------------------------------------------------------------
{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vault-store-'));
  const bytesDir = path.join(base, 'vault', 'env');
  const modulesDir = path.join(base, 'data', 'modules');
  const s = new VaultStore({ bytesDir, modulesDir });
  same(s.swept, { parts: 0, orphans: 0 }, 'a new store has nothing to sweep');

  same(cleanName('  a\n\tb\u0000c  '), 'a b c', 'a name is one line without control characters');
  same(cleanName('../../etc/passwd'), 'etc passwd', 'path separators and leading dots go');
  same(cleanName('photo‮gpj.exe'), 'photo gpj.exe', 'the invisible characters that turn text around go');
  same(Array.from(cleanName('x'.repeat(300))).length, 120, 'at most 120 characters');
  same(nameForType('ticket', ['pdf']), 'ticket.pdf', 'a name with no extension takes the type\'s');
  same([cleanName('x.pdf.'), cleanName('x.pdf . . '), cleanName('...')], ['x.pdf', 'x.pdf', ''], 'dots and spaces at the end go');
  same(nameForType(cleanName('x.pdf.'), ['pdf']), 'x.pdf', 'so "x.pdf." is kept as x.pdf');
  same(nameForType('song.MP3', ['mp3']), 'song.MP3', 'one with the right extension keeps it');
  same(extensionOf('a.tar.GZ'), 'gz', 'the extension, lower case');

  const part = s.newPart(SPACE);
  ok(s.isPart(SPACE, part) && path.dirname(part) === path.join(bytesDir, `space-${SPACE}`), 'a part file goes in the space\'s folder');
  ok(!s.isPart(SPACE, '/etc/passwd') && !s.isPart(OTHER, part), 'only a part of this store and space is one');
  fs.writeFileSync(part, Buffer.from('%PDF-1.7 hello'));
  const fid = s.newId();
  ok(/^[a-f0-9]{24}$/.test(fid), 'a file id is 24 random hex characters');
  const rec = s.commit('vault', SPACE, part, { id: fid, name: 'ticket.pdf', type: 'application/pdf', group: 'document', size: 14, sha256: 'x', by: 'pat1', at: '2026-10-30T10:00:00.000Z', thumb: null });
  same(rec.id, fid, 'kept');
  ok(fs.existsSync(path.join(bytesDir, `space-${SPACE}`, `${fid}.bin`)) && !fs.existsSync(part), 'the part became <id>.bin');
  const recFile = path.join(modulesDir, 'vault', 'library', `space-${SPACE}.json`);
  ok(JSON.parse(fs.readFileSync(recFile, 'utf8'))[fid].name === 'ticket.pdf', 'the record is under DATA_DIR/modules/<id>/library/');
  same(fs.readdirSync(path.dirname(recFile)).filter((f) => f.endsWith('.tmp')), [], 'no temp file left beside it');
  assert.throws(() => s.commit('vault', SPACE, '/etc/hosts', { id: s.newId() }), /bad part/);
  assert.throws(() => s.commit('vault', SPACE, s.newPart(SPACE), { id: '../../x' }), /bad file id/);
  assert.throws(() => s.spaceDir('../x'), /not a valid id/);
  assert.throws(() => s.recordFile('../x', SPACE), /not a valid id/);
  same(s.filePath(SPACE, '../../etc/passwd'), null, 'a file id that is not one names no path');
  same(s.get('vault', SPACE, '../x'), null, 'and no record');
  same(s.get('vault', OTHER, fid), null, 'another space cannot reach it');
  n += 4;

  // Usage: per space and person, the thumbnail counted.
  same([s.usage().all, s.usage().spaces.get(SPACE), s.usage().people.get('pat1')], [14, 14, 14], 'usage counted from the records');
  s.putThumb('vault', SPACE, fid, Buffer.alloc(6, 1), 'image/png');
  same([s.usage().all, s.usage().people.get('pat1'), s.get('vault', SPACE, fid).thumb], [20, 20, { type: 'image/png', size: 6 }], 'the thumbnail counts too');
  s.rename('vault', SPACE, fid, 'ticket two.pdf');
  same(new VaultStore({ bytesDir, modulesDir }).get('vault', SPACE, fid).name, 'ticket two.pdf', 'a rename is on disk');
  same(new VaultStore({ bytesDir, modulesDir }).usage().all, 20, 'a fresh store counts the same');

  // What a restart leaves: parts and temp files go at once; bytes with no record only after a week.
  const left = s.newPart(SPACE);
  fs.writeFileSync(left, 'half an upload');
  fs.writeFileSync(`${recFile}.1234.tmp`, '{');
  const orphanNew = path.join(bytesDir, `space-${SPACE}`, `${'b'.repeat(24)}.bin`);
  const orphanOld = path.join(bytesDir, `space-${SPACE}`, `${'c'.repeat(24)}.bin`);
  fs.writeFileSync(orphanNew, 'recent');
  fs.writeFileSync(orphanOld, 'old');
  const weekAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(orphanOld, weekAgo, weekAgo);
  fs.utimesSync(path.join(bytesDir, `space-${SPACE}`, `${fid}.bin`), weekAgo, weekAgo);
  const again = new VaultStore({ bytesDir, modulesDir });
  same(again.swept, { parts: 1, orphans: 1 }, 'on start: the part goes, and the week-old bytes with no record');
  ok(!fs.existsSync(left) && !fs.existsSync(`${recFile}.1234.tmp`), 'the part and the temp record are gone');
  ok(fs.existsSync(orphanNew) && !fs.existsSync(orphanOld), 'recent bytes with no record are kept for now');
  ok(fs.existsSync(path.join(bytesDir, `space-${SPACE}`, `${fid}.bin`)), 'a file with its record is kept, however old');

  // Removing, and a deleted space.
  const p2 = again.newPart(OTHER);
  fs.writeFileSync(p2, 'x');
  const f2 = again.newId();
  again.commit('vault', OTHER, p2, { id: f2, name: 'a.md', type: 'text/markdown', group: 'document', size: 1, by: 'sam1', at: '2026-10-30T11:00:00.000Z', thumb: null });
  same(again.list('vault', OTHER).map((r) => r.id), [f2], 'listed in its own space');
  same(again.remove('vault', OTHER, f2), true, 'removed');
  same([again.list('vault', OTHER).length, fs.existsSync(again.filePath(OTHER, f2)), again.usage().people.get('sam1')], [0, false, undefined], 'bytes, record and usage gone');
  ok(!fs.existsSync(path.join(modulesDir, 'vault', 'library', `space-${OTHER}.json`)), 'an empty record file is removed');
  same(again.remove('vault', OTHER, f2), false, 'removing twice is nothing');
  same(again.forgetSpace(SPACE), 1, 'a deleted space takes its file');
  ok(!fs.existsSync(path.join(bytesDir, `space-${SPACE}`)) && !fs.existsSync(recFile), 'its folder and records are gone');
  same(again.usage().all, 0, 'and nothing is counted');
  fs.rmSync(base, { recursive: true, force: true });
}

// --- the files the checks send ----------------------------------------------------------------------------------------
const pngOf = (w, h, extra = Buffer.alloc(0)) => {
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('Comment\0hidden words')), chunk('IDAT', Buffer.concat([Buffer.from([1, 2, 3]), extra])), chunk('IEND', Buffer.alloc(0))]);
};
// A JPEG with a camera, a time and a position (52.5N 13.4E) in its EXIF, as check-uploads builds one.
function exifTiff() {
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
  const ent = (tag, type, count, value) => Buffer.concat([u16(tag), u16(type), u32(count), value]);
  const ifd0At = 8; const exifAt = ifd0At + 2 + 4 * 12 + 4; const gpsAt = exifAt + 2 + 12 + 4; const dataAt = gpsAt + 2 + 4 * 12 + 4;
  const make = Buffer.from('Acme\0'); const dt = Buffer.from('2026:09:21 14:30:05\0');
  const rat = (a, b) => Buffer.concat([u32(a), u32(b)]);
  const makeAt = dataAt; const dtAt = makeAt + make.length; const latAt = dtAt + dt.length; const lngAt = latAt + 24;
  const pad = (b) => Buffer.concat([b, Buffer.alloc(4 - b.length)]);
  return Buffer.concat([Buffer.from('MM'), u16(42), u32(ifd0At),
    u16(4), ent(0x010f, 2, make.length, u32(makeAt)), ent(0x0112, 3, 1, Buffer.concat([u16(1), u16(0)])), ent(0x8769, 4, 1, u32(exifAt)), ent(0x8825, 4, 1, u32(gpsAt)), u32(0),
    u16(1), ent(0x9003, 2, dt.length, u32(dtAt)), u32(0),
    u16(4), ent(1, 2, 2, pad(Buffer.from('N\0'))), ent(2, 5, 3, u32(latAt)), ent(3, 2, 2, pad(Buffer.from('E\0'))), ent(4, 5, 3, u32(lngAt)), u32(0),
    make, dt, rat(52, 1), rat(30, 1), rat(0, 1), rat(13, 1), rat(24, 1), rat(0, 1)]);
}
const seg = (marker, body) => { const h = Buffer.alloc(4); h[0] = 0xff; h[1] = marker; h.writeUInt16BE(body.length + 2, 2); return Buffer.concat([h, body]); };
const jpegOf = (w = 4, h = 3) => Buffer.concat([
  Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), exifTiff()])),
  seg(0xdb, Buffer.alloc(65, 1)), seg(0xc0, Buffer.from([8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0x12, 0x34, 0xff, 0xd9]),
]);
// A GIF: its screen with two colours, then `blocks` (extensions) and one frame of picture data, and the end.
const gifOf = (w = 2, h = 2, blocks = []) => {
  const screen = Buffer.alloc(13); screen.write('GIF89a', 0, 'latin1'); screen.writeUInt16LE(w, 6); screen.writeUInt16LE(h, 8); screen[10] = 0x80;
  const frame = Buffer.alloc(10); frame[0] = 0x2c; frame.writeUInt16LE(w, 5); frame.writeUInt16LE(h, 7);
  return Buffer.concat([screen, Buffer.from([255, 255, 255, 0, 0, 0]), ...blocks, frame, Buffer.from([2, 2, 0x44, 0x01, 0]), Buffer.from([0x3b])]);
};
// The blocks a GIF from a phone or an editor carries: the loop count, a frame's timing, a comment, and XMP as Adobe writes it
// (the packet raw, then the 258-byte trailer that makes it read as sub-blocks).
const gifLoop = Buffer.concat([Buffer.from([0x21, 0xff, 11]), Buffer.from('NETSCAPE2.0', 'latin1'), Buffer.from([3, 1, 0, 0, 0])]);
const gifTiming = Buffer.from([0x21, 0xf9, 4, 0, 10, 0, 0, 0]);
const gifComment = Buffer.concat([Buffer.from([0x21, 0xfe, 14]), Buffer.from('hidden comment', 'latin1'), Buffer.from([0])]);
const gifXmp = Buffer.concat([Buffer.from([0x21, 0xff, 11]), Buffer.from('XMP DataXMP', 'latin1'),
  Buffer.from('<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description exif:GPSLatitude="52,30.0N" exif:GPSLongitude="13,24.0E"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>', 'latin1'),
  Buffer.from([1, ...Array.from({ length: 256 }, (_, k) => 255 - k), 0])]);
const webpOf = () => { const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(32, 4); b.write('WEBPVP8X', 8, 'latin1'); b.writeUInt32LE(10, 16); b.writeUIntLE(9, 24, 3); b.writeUIntLE(9, 27, 3); return b; };
// A RIFF file of `kind`: for WAVE a format chunk and an empty sound chunk, as a whole file.
const riffOf = (kind) => { const b = Buffer.alloc(44); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36, 4); b.write(kind, 8, 'latin1'); b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(16, 16); b.write('data', 36, 'latin1'); return b; };
// An ISO file: its ftyp box, an (empty) movie box, then a media box that runs to the end (size 0).
const ftypOf = (major, compat = []) => { const size = 16 + compat.length * 4; const b = Buffer.alloc(size + 24); b.writeUInt32BE(size, 0); b.write('ftyp', 4, 'latin1'); b.write(major, 8, 'latin1'); compat.forEach((c, i) => b.write(c, 16 + i * 4, 'latin1')); b.writeUInt32BE(8, size); b.write('moov', size + 4, 'latin1'); b.write('mdat', size + 12, 'latin1'); return b; };
// A WebM's EBML header (its version, then its DocType), then the Segment.
const ebmlOf = (doc) => { const body = Buffer.concat([Buffer.from([0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x80 | doc.length]), Buffer.from(doc, 'latin1')]); return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | body.length]), body, Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0, 0, 0, 0, 0, 0, 0]), Buffer.alloc(40)]); };
// MPEG-1 Layer III frames at 128 kbps and 44.1 kHz: 417 bytes each.
const mp3Frames = (count) => Buffer.concat(Array.from({ length: count }, () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(413)])));
const mp3Of = () => Buffer.concat([Buffer.from('ID3\x04\0\0\0\0\0\0', 'latin1'), mp3Frames(3)]);
// One Ogg page that starts a stream: its header, one segment of 38 bytes, and those bytes.
const oggOf = () => { const h = Buffer.alloc(28); h.write('OggS', 0, 'latin1'); h[5] = 2; h[26] = 1; h[27] = 38; return Buffer.concat([h, Buffer.alloc(38)]); };
const pdfOf = (body = '') => Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R ${body} >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
// A link to a web page as LibreOffice writes one, and a fillable text field with no script.
const PDF_WEB_LINK = '/Annots [<< /Type /Annot /Subtype /Link /Border [0 0 0] /A << /Type /Action /S /URI /URI (https://example.com/booking) >> >>]';
const PDF_FORM = '/AcroForm << /Fields [<< /FT /Tx /T (Name) /V (Pat) /Rect [0 0 100 20] >>] /NeedAppearances true >>';
// A plain PDF of `bytes` bytes: its header, spaces, then its object and trailer.
const pdfSized = (bytes) => { const p = pdfOf(); return Buffer.concat([p.subarray(0, 9), Buffer.alloc(bytes - p.length, 0x20), p.subarray(9)]); };
const zlib = require('node:zlib');
// A PDF whose one object stream holds `objects`, Flate-compressed (or `data` as it is).
const objStm = (objects, { filter = '/FlateDecode', eol = '\n', data } = {}) => {
  const packed = data || zlib.deflateSync(Buffer.from(objects, 'latin1'));
  return Buffer.concat([Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n5 0 obj << /Type /ObjStm /N 1 /First 4 /Filter ${filter} /Length ${packed.length} >> stream${eol}`, 'latin1'), packed, Buffer.from('\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')]);
};
const OTHERS_ARRIVING = 'Other files are still arriving; try again in a minute.';
// Real files (tools/fixtures/vault/) and the type each is.
const FIXTURES = path.join(ROOT, 'tools', 'fixtures', 'vault');
const CORPUS = { 'photo.jpg': 'image/jpeg', 'pic.png': 'image/png', 'pic.webp': 'image/webp', 'anim.gif': 'image/gif', 'tone.mp3': 'audio/mpeg', 'tone.ogg': 'audio/ogg', 'tone.wav': 'audio/wav', 'tone.m4a': 'audio/mp4', 'clip.mp4': 'video/mp4', 'clip.webm': 'video/webm', 'clip.mov': 'video/quicktime', 'link.pdf': 'application/pdf', 'form.pdf': 'application/pdf', 'plain.pdf': 'application/pdf', 'notes.md': 'text/markdown' };
const memoryLines = [];

// --- part 2: types ------------------------------------------------------------------------------------------------------
{
  const sniffed = (b, name = 'x') => types.sniff(b, name).type || `refused:${types.sniff(b, name).refuse}`;
  same(sniffed(jpegOf()), 'image/jpeg', 'JPEG from FF D8 FF');
  same(sniffed(pngOf(2, 2)), 'image/png', 'PNG from its signature');
  same(sniffed(webpOf()), 'image/webp', 'WebP: RIFF then WEBP');
  same(sniffed(gifOf()), 'image/gif', 'GIF89a');
  same(sniffed(mp3Of()), 'audio/mpeg', 'MP3 from ID3');
  same(sniffed(mp3Frames(3)), 'audio/mpeg', 'MP3 from two frames one after the other');
  same(sniffed(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(1000)])), 'refused:kind', 'a frame sync followed by anything is not');
  same(sniffed(Buffer.concat([Buffer.from([0xff, 0xfb, 0xf0, 0x64]), Buffer.alloc(1000)])), 'refused:kind', 'nor a frame with a bad bitrate');
  same(sniffed(Buffer.from('ID3\x04\0\0\x80\0\0\0<html>', 'latin1')), 'refused:kind', 'an ID3 tag whose size is not syncsafe is not');
  same(sniffed(Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.alloc(40)])), 'refused:kind', 'AAC\'s ADTS is not MP3');
  same(sniffed(oggOf()), 'audio/ogg', 'OggS');
  same(sniffed(riffOf('WAVE')), 'audio/wav', 'WAV: RIFF then WAVE');
  same(sniffed(riffOf('AVI ')), 'refused:kind', 'an AVI is refused');
  same(sniffed(ftypOf('M4A ', ['isom'])), 'audio/mp4', 'M4A by its brand');
  same(sniffed(ftypOf('isom', ['iso2', 'avc1'])), 'video/mp4', 'MP4 by an ISO brand');
  same(sniffed(ftypOf('3gp5', ['isom'])), 'video/mp4', 'or an ISO brand among the compatible ones');
  same(sniffed(ftypOf('qt  ')), 'video/quicktime', '.mov is taken as video/quicktime');
  same(sniffed(ftypOf('heic', ['mif1'])), 'refused:heic', 'HEIC is refused with its own sentence');
  same(sniffed(ftypOf('mif1', ['heic'])), 'refused:heic', 'and as mif1');
  same(sniffed(ftypOf('avif', ['mif1'])), 'refused:heic', 'an AVIF that names HEIC brands only');
  same(sniffed(ftypOf('crx ')), 'refused:kind', 'another brand is refused');
  same(sniffed(ebmlOf('webm')), 'video/webm', 'WebM by its DocType');
  same(sniffed(ebmlOf('matroska')), 'refused:kind', '.mkv is refused');
  same(sniffed(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]), Buffer.from('\x42\x82\x84webm<script>', 'latin1'), Buffer.alloc(40)])), 'refused:kind', 'an EBML start that is not a header is refused');
  same(sniffed(Buffer.concat([ebmlOf('webm').subarray(0, 16), Buffer.from('<html><script>1</script>'), Buffer.alloc(40)])), 'refused:kind', 'and a WebM header followed by something that is not its Segment');
  same(sniffed(Buffer.concat([Buffer.from([0, 0, 0, 0xff]), Buffer.from('ftypisom'), Buffer.alloc(60)])), 'refused:kind', 'an ftyp box with a size that is not one is refused');
  same(sniffed((() => { const b = ftypOf('isom', ['mp42']); b.write('<ht', 24, 'latin1'); b[20] = 0; b[21] = 0; b[22] = 0; b[23] = 3; return b; })()), 'refused:kind', 'and one followed by something that is not a box');
  same(sniffed(pdfOf()), 'application/pdf', '%PDF-');
  same(sniffed(Buffer.from('%PDF-1.7\n<html><script>alert(1)</script>', 'latin1')), 'refused:kind', 'a PDF header followed by a page is refused');
  same(sniffed(Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj << /Length 4 >> stream\n<a1b2>\nendstream', 'latin1')), 'application/pdf', 'a hex string is not a tag');
  same(sniffed(Buffer.from('# Packing\n\n- socks\n'), 'list.md'), 'text/markdown', 'Markdown by its name and text');
  same(sniffed(Buffer.from('# Packing\n'), 'list.txt'), 'refused:kind', 'text with another name is not taken');
  for (const [what, bytes, name] of [
    ['SVG', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'x.svg'],
    ['HTML', '<!doctype html><script>alert(1)</script>', 'x.html'],
    ['XML', '<?xml version="1.0"?><a/>', 'x.xml'],
    ['a zip', 'PK\x03\x04\x14\0\0\0\0\0', 'x.zip'],
    ['a program', 'MZ\x90\0\x03\0\0\0\x04\0', 'x.exe'],
    ['a script', '#!/bin/sh\nrm -rf /\n', 'x.sh'],
  ]) same(sniffed(Buffer.from(bytes, 'latin1'), name), 'refused:kind', `${what} is refused`);

  // Before the body: names and types sent.
  same(types.claimRefusal('photo.heic', ''), 'heic', 'a .heic name is refused before the body');
  same(types.claimRefusal('x', 'image/heif'), 'heic', 'so is the HEIF type');
  same(['x.svg', 'x.html', 'x.zip', 'x.exe', 'x.docx', 'x.mkv'].map((nm) => types.claimRefusal(nm, '')), Array(6).fill('kind'), 'names of refused kinds');
  same(['image/svg+xml', 'text/html', 'application/zip', 'application/javascript'].map((t) => types.claimRefusal('x', t)), Array(4).fill('kind'), 'types of refused kinds');
  same([types.claimRefusal('ticket', ''), types.claimRefusal('a.pdf', 'application/octet-stream'), types.claimRefusal('a.md', 'text/plain')], [null, null, null], 'no extension, a type that says nothing, and Markdown as text/plain are fine');
  same([types.claimedType('a.mp4', ''), types.claimedType('x', 'image/png'), types.claimedType('x', ''), types.claimedType('x', 'text/plain')], ['video/mp4', 'image/png', null, null], 'the claimed type for the early limit');
  same([types.mismatch('application/pdf', 'ticket.exe', ''), types.mismatch('application/pdf', 'ticket.jpg', ''), types.mismatch('application/pdf', 'ticket', 'image/png')], [true, true, true], 'a PDF under another name or type is a mismatch');
  same([types.mismatch('application/pdf', 'ticket.PDF', 'application/pdf'), types.mismatch('image/jpeg', 'a.jpeg', 'image/jpeg'), types.mismatch('text/markdown', 'a.md', 'text/plain'), types.mismatch('video/quicktime', 'IMG_1.MOV', 'video/quicktime')], [false, false, false, false], 'the right ones are not');
  same(Object.fromEntries(Object.entries(types.LIMITS).map(([k, v]) => [k, v.bytes / 1048576])), { image: 25, audio: 200, video: 2048, pdf: 100, markdown: 1 }, 'the limits: 25 MB, 200 MB, 2 GB, 100 MB, 1 MB');

  // Pictures too large to draw, from the header.
  same([types.picturePixels(pngOf(20000, 6000), 'image/png'), types.picturePixels(gifOf(300, 200), 'image/gif'), types.picturePixels(jpegOf(4000, 3000), 'image/jpeg'), types.picturePixels(webpOf(), 'image/webp')], [120000000, 60000, 12000000, 100], 'pixels from PNG, GIF, JPEG and WebP headers');
  ok(types.picturePixels(pngOf(20000, 6000), 'image/png') > types.MAX_PIXELS, 'over 100 million is over the limit');
  // Security QA round 2, round 2: a GIF's frames, not only its screen; a JPEG's second frame header.
  const bigFrame = (() => { const g = gifOf(2, 2); g.writeUInt16LE(65535, 13 + 6 + 5); g.writeUInt16LE(65535, 13 + 6 + 7); return g; })();
  ok(types.picturePixels(bigFrame, 'image/gif') > types.MAX_PIXELS, `a 2x2 GIF whose frame says 65535x65535 is over the limit (${types.picturePixels(bigFrame, 'image/gif')})`);
  const movedFrame = (() => { const g = gifOf(100, 100); g.writeUInt16LE(60000, 13 + 6 + 1); g.writeUInt16LE(60000, 13 + 6 + 3); return g; })();
  same(types.picturePixels(movedFrame, 'image/gif'), 60100 * 60100, 'and one whose small frame stands far outside its screen');
  same(types.picturePixels(gifOf(300, 200, [gifLoop, gifTiming, gifComment]), 'image/gif'), 60000, 'a GIF with its blocks reads to its frame');
  const twoSof = Buffer.concat([jpegOf(4, 3).subarray(0, -14), seg(0xc2, Buffer.from([8, 0xff, 0xff, 0xff, 0xff, 1, 1, 0x11, 0])), jpegOf(4, 3).subarray(-14)]);
  same(types.picturePixels(twoSof, 'image/jpeg'), null, 'a JPEG with a second frame header is not read (so refused as damaged)');
  same(types.picturePixels(fs.readFileSync(path.join(FIXTURES, 'photo.jpg')), 'image/jpeg') > 0, true, 'a real JPEG still reads');

  // PDF active content (server/pdf-scan.js): read token by token, and in every stream objects can be taken out of.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vault-pdf-'));
  const file = (bytes) => { const f = path.join(dir, `p${n}-${Math.random()}`); fs.writeFileSync(f, bytes); return f; };
  const scan = async (bytes) => { const r = pdfScan(Buffer.from(bytes)); return r ? r.name || `refused:${r.refuse}` : null; };
  same(await scan(pdfOf()), null, 'a plain PDF passes');
  for (const name of ['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'RichMedia', 'XFA', 'AA', 'SubmitForm', 'GoToR']) same(await scan(pdfOf(`/OpenAction << /S /${name} (x) >>`)), name, `/${name} is refused`);
  // Links to web pages and fillable forms are taken (Thomas, 2026-10-30); a link to a program or a file is not.
  same(await scan(pdfOf(PDF_WEB_LINK)), null, 'a link to a web page, as LibreOffice writes one, passes');
  same(await scan(pdfOf(PDF_FORM)), null, 'a fillable form with no script passes');
  same(await scan(pdfOf('/OpenAction << /S /URI /URI (mailto:desk@example.com) >>')), null, 'and an email link, even on opening');
  same(await scan(pdfOf('/OpenAction << /S /URI /URI (\\376\\377\\000h\\000t\\000t\\000p\\000s\\000:\\000/\\000/\\000x) >>')), null, 'and a web link written in UTF-16');
  for (const [label, uri] of [['file:', '(file:///C:/Windows/System32/calc.exe)'], ['javascript:', '(javascript:alert\\(1\\))'], ['a hex file: address', '<66696C653A2F2F2F6574632F706173737764>'], ['a path with no scheme', '(\\\\server\\share\\run.exe)'], ['an address hiding its scheme behind spaces', '( \\tfile:///x)'], ['an address split over lines', '(java\\\nscript:alert\\(1\\))'], ['an address by reference', '9 0 R']]) same(await scan(pdfOf(`/OpenAction << /S /URI /URI ${uri} >>`)), label === 'an address by reference' ? 'refused:unchecked' : 'URI', `a link to ${label} is refused`);
  same(await scan(pdfOf('/OpenAction << /S /J#61vaScript >>')), 'JavaScript', 'a name written with #xx escapes too');
  same(await scan(pdfOf('/JSON (fine) /JSX 1 /AAA 2 /URIs 3')), null, '/JSON is not /JS, nor /AAA /AA');
  same(await scan(pdfOf('/Title (about /JS and /Launch) % a comment /JavaScript\n')), null, 'names inside a string or a comment are not names');
  same(await scan(objStm('6 0 << /S /URI /URI (file:///etc/passwd) >>')), 'URI', 'a link to a file inside a compressed object stream is refused');
  same(await scan(objStm(`6 0 ${PDF_WEB_LINK} ${PDF_FORM}`)), null, 'and a web link and a form there pass');
  same(await scan(objStm('6 0 << /Type /Annot /Subtype /Widget /AA << /K 7 0 R >> >>')), 'AA', 'a field\'s own actions (AA) there are refused');
  const straddle = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1024 * 1024 - 14, 0x20), Buffer.from('/JavaScript (x)\n')]);
  same(await scan(straddle), 'JavaScript', 'a name past the first megabyte is found');
  same(await scan(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(3 * 1024 * 1024, 0x20), Buffer.from(' /Launch')])), 'Launch', 'at the end of a larger file');
  same(await scan(Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n', 'latin1')), 'refused:damaged', 'a PDF with no %%EOF is damaged');
  same(await scan(Buffer.from('%PDF-1.7\nhello\n%%EOF\n', 'latin1')), 'refused:damaged', 'and one with no object');
  same(await scan(Buffer.concat([pdfOf(), Buffer.alloc(2048, 0x20)])), 'refused:damaged', 'and one whose %%EOF is not in its last kilobyte');
  same(await scan(Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n', 'latin1')), 'refused:damaged', 'and one with no startxref or trailer before its %%EOF');
  // Object streams: found by what a reader needs to take objects out of one (/N, /First), whatever else the dictionary
  // holds or leaves out (security QA round 2: a later key holding "obj", or no /Type, hid them), and decoded.
  same(await scan(objStm('6 0 << /Type /Page /Contents 7 0 R >>')), null, 'a compressed object stream with nothing active passes');
  same(await scan(objStm('6 0 << /Type /Action /S /JavaScript /JS (app.alert(1)) >>')), 'JavaScript', 'JavaScript in a compressed object stream is found');
  same(await scan(objStm('6 0 << /S /Launch /F (calc.exe) >>', { eol: '\r\n' })), 'Launch', 'after a CRLF too');
  same(await scan(objStm('6 0 << /Type /Filespec /EF << /F 7 0 R >> /EmbeddedFile 1 >>', { filter: '[/FlateDecode]' })), 'EF', 'and with the filter in an array (/EF, the key that points at a carried file, comes first)');
  same(await scan(objStm(`6 0 ${'x'.repeat(2 * 1024 * 1024)} /J#53 1`)), 'JS', 'deep in a large one, escaped');
  const hidden = (dict) => Buffer.concat([Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >> endobj\n6 0 obj\n<< ${dict} >>\nstream\n`, 'latin1'), zlib.deflateSync(Buffer.from('4 0 << /S /JavaScript /JS (app.alert\\(1\\)) >>', 'latin1')), Buffer.from('\nendstream\nendobj\nstartxref\n9\n%%EOF\n', 'latin1')]);
  same(await scan(hidden('/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Xobj 1')), 'JavaScript', 'with a later key named like "obj" (/Xobj)');
  same(await scan(hidden('/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Foo (obj)')), 'JavaScript', 'with a later string holding "obj"');
  same(await scan(hidden('/N 1 /First 4 /Filter /FlateDecode')), 'JavaScript', 'with no /Type at all');
  same(await scan(hidden('/N 1 /First 4 /Filter /Fl /Length 99999')), 'JavaScript', 'with a short filter name and a /Length that is wrong');
  const chain = (filters, data, parms = '') => Buffer.concat([Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n6 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter [${filters}] ${parms} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')]);
  const inner = Buffer.from('4 0 << /S /JavaScript /JS (x) >>', 'latin1');
  same(await scan(chain('/ASCIIHexDecode /FlateDecode', Buffer.from(`${zlib.deflateSync(inner).toString('hex')}>`))), 'JavaScript', 'through a chain of two filters (ASCIIHex, then Flate)');
  const a85 = (buf) => { let out = ''; for (let k = 0; k < buf.length; k += 4) { const g = Buffer.alloc(4); buf.copy(g, 0, k, k + 4); let v = g.readUInt32BE(0); const c = []; for (let m = 0; m < 5; m += 1) { c.unshift(String.fromCharCode(33 + (v % 85))); v = Math.floor(v / 85); } out += c.join('').slice(0, Math.min(5, buf.length - k + 1)); } return `${out}~>`; };
  same(await scan(chain('/A85 /Fl', Buffer.from(a85(zlib.deflateSync(inner)), 'latin1'))), 'JavaScript', 'through ASCII85 and Flate');
  same(await scan(chain('/RunLengthDecode', Buffer.concat([Buffer.from([inner.length - 1]), inner, Buffer.from([128])]))), 'JavaScript', 'through RunLength');
  const lzwOf = (buf) => { const out = []; let acc = 0; let bits = 0; const put = (code) => { acc = (acc << 9) | code; bits += 9; while (bits >= 8) { out.push((acc >> (bits - 8)) & 255); bits -= 8; } }; put(256); for (const c of buf) put(c); put(257); if (bits) out.push((acc << (8 - bits)) & 255); return Buffer.from(out); };
  same(await scan(chain('/LZWDecode', lzwOf(inner))), 'JavaScript', 'through LZW');
  const pngRows = Buffer.concat(Array.from({ length: Math.ceil(inner.length / 4) }, (_, r) => Buffer.concat([Buffer.from([2]), Buffer.from(Array.from({ length: 4 }, (__, k) => ((inner[r * 4 + k] || 0) - (r ? inner[(r - 1) * 4 + k] || 0 : 0)) & 255))])));
  same(await scan(chain('/FlateDecode', zlib.deflateSync(pngRows), '/DecodeParms << /Predictor 12 /Columns 4 >>')), 'JavaScript', 'and through a PNG predictor');
  same(await scan(chain('/FlateDecode', zlib.deflateSync(inner), '/DecodeParms << /Predictor 9 0 R >>')), 'refused:unchecked', 'a predictor given by reference is not checked');
  same(await scan(chain('/DCTDecode', inner)), 'refused:unchecked', 'nor a picture filter on an object stream');
  same(await scan(chain('/FlateDecode', zlib.deflateSync(inner)).toString('latin1').replace('/Filter [/FlateDecode]', '/Filter 7 0 R')), 'refused:unchecked', 'nor filters named by reference');
  same(await scan(chain('/FlateDecode', zlib.deflateSync(inner)).toString('latin1').replace('/Filter [/FlateDecode]', '/Filter /DCTDecode /Filter /FlateDecode')), 'refused:unchecked', 'nor a filter named twice');
  same(await scan(objStm('', { data: zlib.deflateSync(Buffer.alloc(17 * 1024 * 1024, 0x20)) })), 'refused:unchecked', 'one that inflates past 16 MB is not taken');
  same(await scan(objStm('', { data: Buffer.from('not compressed at all') })), 'refused:unchecked', 'nor one that can\'t be inflated');
  // Other streams are not read as names (compressed bytes would match by chance), unless they hold an object's start.
  const picture = (data) => Buffer.concat([Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n3 0 obj << /Type /XObject /Subtype /Image /Width 9 /Height 9 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')]);
  same(await scan(picture(Buffer.from('\xff\xd8 /JS /AA /Launch ( \xff\xd9', 'latin1'))), null, 'a picture\'s bytes that happen to spell names are not read as names');
  same(await scan(picture(Buffer.from('\xff\xd8 endobj 9 0 obj << /S /Launch /F (calc) >> endobj \xff\xd9', 'latin1'))), 'Launch', 'but a picture that holds an object\'s start is read');
  // Security QA round 2, round 2: where a stream ends. A reader ends a stream at the length its /Length names, also by
  // reference; the scan read on from the first "endstream" inside the data, and a "(" there swallowed a script.
  {
    // A PDF with a cross-reference table, built as a reader finds its objects: `objects` is [[n, body], ...], a body
    // given as a Buffer kept as it is.
    const xrefPdf = (objects) => {
      const parts = [Buffer.from('%PDF-1.7\n', 'latin1')];
      let at = parts[0].length;
      const offs = {};
      for (const [num, body] of objects) {
        offs[num] = at;
        const b = Buffer.concat([Buffer.from(`${num} 0 obj `, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from(' endobj\n', 'latin1')]);
        parts.push(b);
        at += b.length;
      }
      const most = Math.max(...objects.map(([k]) => k)) + 1;
      let x = `xref\n0 ${most}\n0000000000 65535 f \n`;
      for (let k = 1; k < most; k += 1) x += offs[k] !== undefined ? `${String(offs[k]).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n';
      parts.push(Buffer.from(`${x}trailer << /Root 1 0 R /Size ${most} >>\nstartxref\n${at}\n%%EOF\n`, 'latin1'));
      return Buffer.concat(parts);
    };
    const swallow = (data, length) => xrefPdf([
      [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'],
      [5, String(length ?? data.length)], [6, `<< /Length 5 0 R >> stream\n${data}\nendstream`],
      [1, '<< /Type /Catalog /Pages 2 0 R /OpenAction 7 0 R >>'], [7, '<< /S /JavaScript /JS (app.alert\\(1\\)) >> %)'],
    ]);
    const quiet = (data, length) => Buffer.from(swallow(data, length).toString('latin1').replace('/S /JavaScript /JS (app.alert\\(1\\))', '/Type /Annot'), 'latin1');
    same(await scan(swallow('junk endstream (')), 'JavaScript', 'a /Length by reference, an "endstream" and a "(" inside the data: the script after it is found');
    same(await scan(quiet('junk endstream (')), null, 'the same with nothing active passes: the length is read from its object');
    same(await scan(quiet('junk', 99)), 'refused:unchecked', 'a /Length by reference that does not end at "endstream" is not checked');
    same(await scan(Buffer.from(quiet('junk').toString('latin1').replace('/Length 5 0 R', '/Length 8 0 R'), 'latin1')), 'refused:unchecked', 'nor one naming an object that is not there');
    same(await scan(xrefPdf([[1, '<< /Type /Catalog >>'], [5, '4'], [2, '<< /Length 5 0 R >> stream\njunk\nendstream'], [5, '7']])), 'refused:unchecked', 'nor one whose object is given twice with different values');
    same(await scan(xrefPdf([[1, '<< /Type /Catalog >>'], [2, '<< /Length 3 0 R >> stream\nabc\nendstream'], [3, '3']])), null, 'a /Length by reference to an object after the stream, as LibreOffice, cairo and pdfTeX write it, passes');
    // The same inside an object stream: a stored Deflate block holding " endstream ", then the script compressed.
    const stored = Buffer.from('7 0 endstream ', 'latin1');
    const js = Buffer.from('<< /S /JavaScript /JS (app.alert(1)) >> ', 'latin1');
    const adler = (b) => { let a = 1; let c = 0; for (const x of b) { a = (a + x) % 65521; c = (c + a) % 65521; } return ((c << 16) | a) >>> 0; };
    const packed = Buffer.concat([Buffer.from([0x78, 0x9c, 0x00, stored.length, 0, (~stored.length) & 255, 255]), stored, zlib.deflateRawSync(js), Buffer.alloc(4)]);
    packed.writeUInt32BE(adler(Buffer.concat([stored, js])), packed.length - 4);
    const objStmPdf = (length) => xrefPdf([[1, '<< /Type /Catalog /OpenAction 7 0 R >>'], [8, String(packed.length)], [9, Buffer.concat([Buffer.from(`<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${length} >> stream\n`, 'latin1'), packed, Buffer.from('\nendstream', 'latin1')])]]);
    same(await scan(objStmPdf('8 0 R')), 'JavaScript', 'an object stream with its /Length by reference and an "endstream" inside: the script is found');
    same(await scan(objStmPdf('2')), 'refused:unchecked', 'with a /Length that is wrong, its data cut short at that "endstream": not checked');
    same(await scan(objStm('', { data: zlib.deflateSync(Buffer.from('4 0 << /Type /Page >>', 'latin1')).subarray(0, 10) }).toString('latin1').replace(/\/Length \d+/, '/Length 999999')), 'refused:unchecked', 'an object stream not ended by its own /Length, its Deflate data cut short: not checked');
    same(await scan(objStm('6 0 (a) (see /JS here)')), 'refused:unchecked', 'a refused name inside an object stream\'s string, where a reader taking each object from its offset could read it as one: not checked');
    // A string or a comment that holds an object's start is read again from there.
    same(await scan(pdfOf('/Title (x) /Subject (a 7 0 obj << /S /Launch /F (calc) >> endobj)')), 'Launch', 'an object inside a string is read');
    same(await scan(pdfOf('% 7 0 obj << /S /JavaScript >>\n')), 'JavaScript', 'and inside a comment');
    same(await scan(pdfOf('/Title (Chapter 1 0 obj a word) % 2 0 obj said here\n')), null, 'an object start with nothing active there passes');
  }
  // Files carried inside (security QA round 2, round 2): the key that points at the bytes, associated files, portfolios.
  same(await scan(pdfOf('/Annots [<< /Type /Annot /Subtype /FileAttachment /FS << /Type /Filespec /F (run.bat) /EF << /F 5 0 R >> >> >>]')), 'EF', 'a FileAttachment whose stream has no /Type /EmbeddedFile is refused by its /EF');
  same(await scan(pdfOf('/AF [4 0 R]')), 'AF', 'associated files (/AF) are refused');
  same(await scan(pdfOf('/Collection << /View /D >>')), 'Collection', 'and a portfolio');
  same(['EF', 'AF', 'Collection'].map((k) => ACTIVE_NAMES.get(k)), ['files', 'files', 'files'], 'each as files of its own');
  same(PDF_LIMITS.decodedStreams, 200, 'at most 200 object streams are decoded, as the plan says');
  // Read in windows (the plan's 1 MB, with an overlap), from the file: never read whole.
  {
    for (const [label, bytes, want] of [
      ['a name across a window\'s edge', Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n'), Buffer.alloc(PDF_WINDOW - 20, 0x20), Buffer.from('/JavaScript (x) >> endobj\ntrailer << >>\n%%EOF\n')]), 'JavaScript'],
      ['a long stream with a script after it', Buffer.concat([Buffer.from(`%PDF-1.7\n1 0 obj << /Length ${3 * PDF_WINDOW} >> stream\n`), Buffer.alloc(3 * PDF_WINDOW, 0x41), Buffer.from('\nendstream endobj\n2 0 obj << /S /Launch >> endobj\ntrailer << >>\n%%EOF\n')]), 'Launch'],
      ['a plain one of 5 MB', pdfSized(5 * 1024 * 1024), null],
      ['a 200 KB string across a window\'s edge, then a script', Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n'), Buffer.alloc(PDF_WINDOW - 100 * 1024, 0x20), Buffer.from('('), Buffer.alloc(200 * 1024, 0x61), Buffer.from(') /JS (x) >> endobj\ntrailer << >>\n%%EOF\n')]), 'JS'],
      ['a string longer than a window', Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj (', 'latin1'), Buffer.alloc(PDF_WINDOW + 70000, 0x61), Buffer.from(') endobj\ntrailer << >>\n%%EOF\n')]), 'refused:unchecked'],
    ]) {
      const f = file(bytes);
      const r = pdfScanFile(f);
      same(r ? r.name || `refused:${r.refuse}` : null, want, `from the file: ${label}`);
      same(pdfScan(bytes), r, `and the same from memory: ${label}`);
    }
  }
  // Hostile shapes (security QA round 2): each judged at once, never on the main thread.
  const tail = Buffer.from('\ntrailer << >>\n%%EOF\n', 'latin1');
  const hostile = {
    'a megabyte of "/URI ("': Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n'), Buffer.from('/URI ('.repeat(174763)), tail]),
    'a megabyte of "stream\\n"': Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n'), Buffer.from('stream\n'.repeat(149796)), tail]),
    'a megabyte of "<< >>stream"': Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n'), Buffer.from('<</N 1>>stream\n'.repeat(69905)), tail]),
    'a megabyte of "obj"': Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('1 0 obj '.repeat(131072)), tail]),
    'a megabyte of "/JS ("': Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n'), Buffer.from('/JS ('.repeat(209715)), tail]),
    'a megabyte of "<<"': Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n'), Buffer.from('<<'.repeat(524288)), tail]),
    'a megabyte of "["': Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n'), Buffer.from('['.repeat(1048576)), tail]),
    'a million objects': Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 1000000 }, (_, k) => `${k} 0 obj<<>>endobj\n`).join('')), tail]),
    'a gigabyte Flate bomb': objStm('', { data: zlib.deflateSync(Buffer.alloc(1024 * 1024 * 1024), { level: 9 }) }),
    // Each read again from the object it holds (security QA round 2, round 2), and integer objects read for a /Length.
    'a megabyte of strings holding an object': Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n'), Buffer.from('(1 0 obj) '.repeat(104857)), tail]),
    'a megabyte of comments holding an object': Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n'), Buffer.from('%1 0 obj\n'.repeat(116508)), tail]),
    'a megabyte of strings in strings': Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n'), Buffer.from('(1 0 obj (2 0 obj (3 0 obj (4 0 obj (5 0 obj (6 0 obj x) ) ) ) ) ) '.repeat(16000)), tail]),
    '200,000 integer objects and a /Length by reference': Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 200000 }, (_, k) => `${k + 10} 0 obj ${k} endobj\n`).join('')), Buffer.from('5 0 obj 3 endobj\n6 0 obj << /Length 5 0 R >> stream\nabc\nendstream endobj\n'), tail]),
  };
  for (const [label, bytes] of Object.entries(hostile)) {
    const t0 = Date.now();
    const r = pdfScan(bytes);
    const ms = Date.now() - t0;
    ok(ms < 1000, `${label} (${Math.round(bytes.length / 1024)} KB) is judged in under a second: ${ms} ms, ${JSON.stringify(r)}`);
  }
  // Through the worker (server/vault-scan.js): the main thread's longest pause while it scans stays small, a file that
  // takes too long is refused as unsafe, and so is one the worker can't finish.
  {
    const scanner = createScanner({ seconds: 5 });
    const files = Object.values(hostile).map((bytes) => file(bytes));
    // The longest pause of this thread while they are scanned; a machine busy with something else can pause it once, so
    // a pause over the limit is measured once more before it counts (security QA round 2, round 2: 170 ms under load).
    const round = async () => {
      let worst = 0;
      let last = performance.now();
      let watching = true;
      const tick = () => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; if (watching) setImmediate(tick); };
      setImmediate(tick);
      const t0 = Date.now();
      const answers = await Promise.all(files.map((f) => scanner.scan({ file: f, type: 'application/pdf' })));
      watching = false;
      return { answers, worst, ms: Date.now() - t0 };
    };
    let measured = await round();
    const first = measured.worst;
    if (measured.worst >= 100) measured = await round();
    const { answers, worst, ms } = measured;
    ok(answers.every((a) => a.ok || a.refuse), `the worker judges every hostile PDF (${answers.map((a) => (a.ok ? 'ok' : a.refuse.code)).join(', ')}) in ${ms} ms`);
    ok(worst < 100, `and the main thread is never held up for long while it does: the longest pause was ${Math.round(worst)} ms${first !== worst ? ` (${Math.round(first)} ms the first time)` : ''}`);
    memoryLines.push(`hostile PDFs through the scan worker: ${ms} ms for ${files.length}, the main thread's longest pause ${Math.round(worst)} ms`);
    const slow = createScanner({ seconds: 0.001 });
    same((await slow.scan({ file: files[0], type: 'application/pdf' })).refuse?.code, 'unsafe', 'a scan that runs out of time is refused as unsafe');
    same((await scanner.scan({ file: path.join(dir, 'not-there'), type: 'application/pdf' })).refuse?.code, 'unsafe', 'and so is one that fails');
    same(await scanner.scan({ file: file(pdfOf(PDF_WEB_LINK)), type: 'application/pdf' }), { ok: true }, 'a plain PDF passes through the worker');
  }
  // MP3 after an ID3 tag, once the file is in.
  const id3 = (size) => { const h = Buffer.from('ID3\x03\0\0\0\0\0\0', 'latin1'); h[8] = (size >> 7) & 0x7f; h[9] = size & 0x7f; return h; };
  same(types.structureRefusal(file(Buffer.concat([id3(300), Buffer.alloc(300), mp3Frames(3)])), 'audio/mpeg'), null, 'an MP3 with a tag and frames after it passes');
  same(types.structureRefusal(file(Buffer.concat([id3(300), Buffer.alloc(300), Buffer.alloc(20, 0), mp3Frames(3)])), 'audio/mpeg'), null, 'with padding after the tag too');
  same(types.structureRefusal(file(Buffer.concat([id3(300), Buffer.alloc(300), Buffer.from('<html><script>alert(1)</script>'), Buffer.alloc(70000, 0x41)])), 'audio/mpeg'), 'kind', 'a tag followed by no frames is refused');
  // Real files, made on a desktop by ffmpeg, LibreOffice and ImageMagick (tools/fixtures/vault/): each is what its
  // bytes say, and passes its whole-file check; a real start followed by a page does not (security QA round 2).
  {
    const scanner = createScanner({ seconds: 10 });
    for (const [name, type] of Object.entries(CORPUS)) {
      const bytes = fs.readFileSync(path.join(FIXTURES, name));
      same(types.sniff(bytes.subarray(0, types.HEAD_BYTES), name).type, type, `${name} is ${type}`);
      const r = await scanner.scan({ file: file(bytes), type, keepPosition: false });
      ok(r.ok, `${name} passes its check: ${JSON.stringify(r)}`);
    }
    const html = Buffer.from('<html><script>alert(1)</script></html>'.repeat(10));
    const mp4 = fs.readFileSync(path.join(FIXTURES, 'clip.mp4'));
    const webm = fs.readFileSync(path.join(FIXTURES, 'clip.webm'));
    const mp3 = fs.readFileSync(path.join(FIXTURES, 'tone.mp3'));
    const firstFrame = mp3.findIndex((c, i) => c === 0xff && (mp3[i + 1] & 0xe0) === 0xe0 && i > 10);
    const structure = (bytes, type) => types.structureRefusal(file(bytes), type);
    same(structure(Buffer.concat([mp4.subarray(0, mp4.readUInt32BE(0)), Buffer.from([0, 0, 0, 8]), Buffer.from('free'), html]), 'video/mp4'), 'damaged', 'an MP4 start, a box, then a page: refused');
    same(structure(mp4.subarray(0, 9000), 'video/mp4'), 'damaged', 'and an MP4 cut short');
    same(structure(Buffer.concat([mp4.subarray(0, mp4.readUInt32BE(0)), Buffer.from([0, 0, 0, 16]), Buffer.from('mdat'), Buffer.alloc(8)]), 'video/mp4'), 'damaged', 'and one with no movie box');
    same(structure(Buffer.concat([webm.subarray(0, 64), html]), 'video/webm'), 'damaged', 'a WebM header then a page: refused');
    const segAt = webm.indexOf(Buffer.from([0x18, 0x53, 0x80, 0x67]));
    same(structure(Buffer.concat([webm.subarray(0, segAt), Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x19, 0x41, 0xa4, 0x69, 0x84]), Buffer.from('file')]), 'video/webm'), 'kind', 'a WebM carrying attachments: refused');
    same(structure(Buffer.concat([mp3.subarray(firstFrame, firstFrame + 1200), html]), 'audio/mpeg'), 'kind', 'two MP3 frames then a page: refused');
    same(structure(mp3.subarray(0, 5000), 'audio/mpeg'), null, 'an MP3 cut short in its last frame is still taken');
    // WAV and Ogg are walked too (security QA round 2, round 2: a WAV header followed by a page was kept).
    const wav = fs.readFileSync(path.join(FIXTURES, 'tone.wav'));
    const ogg = fs.readFileSync(path.join(FIXTURES, 'tone.ogg'));
    same([structure(riffOf('WAVE'), 'audio/wav'), structure(oggOf(), 'audio/ogg')], [null, null], 'a whole WAV and a whole Ogg page pass');
    same(structure(Buffer.concat([wav.subarray(0, 12), html]), 'audio/wav'), 'damaged', 'a WAV header then a page: refused');
    same(structure(Buffer.concat([riffOf('WAVE').subarray(0, 36), Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO'), html]), 'audio/wav'), 'damaged', 'and a WAV whose chunks end in a page');
    same(structure(Buffer.concat([riffOf('WAVE').subarray(0, 12), Buffer.from('data'), Buffer.from([4, 0, 0, 0]), Buffer.alloc(4)]), 'audio/wav'), 'damaged', 'and one with its sound before its format');
    same(structure(Buffer.concat([wav, html]), 'audio/wav'), 'damaged', 'a real WAV followed by a page: refused');
    same(structure(Buffer.concat([ogg, html]), 'audio/ogg'), 'damaged', 'an Ogg followed by a page: refused');
    same(structure(Buffer.concat([oggOf().subarray(0, 4), html]), 'audio/ogg'), 'damaged', 'and an Ogg start followed by one');
    same(structure(ogg.subarray(0, ogg.length - 100), 'audio/ogg'), null, 'an Ogg cut short in its last page is still taken');
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // How an upload must keep arriving (server/arrival.js), run on a clock of its own: `send(t)` is what the sender sends in
  // the 100 ms from t (ms), `paused(t)` whether the server has stopped reading then (what it would have sent waits).
  {
    const KB = 1024;
    const arrive = ({ declared, send, paused = () => false, until }) => {
      let now = 0;
      let cut = null;
      let waiting = false;
      let queued = 0;
      let sent = 0;
      const w = watchArrival(declared, () => { cut = now; }, { minRate: 16 * KB, clock: () => now, timer: false });
      for (; now <= until && cut === null && sent < declared; now += 100) {
        const p = paused(now);
        if (p !== waiting) { w.waiting(p); waiting = p; }
        queued += send(now);
        if (!p && queued) { const n = Math.min(queued, declared - sent); w.got(n); sent += n; queued = 0; }
        if (now % 5000 === 0 && now) w.tick();
      }
      w.stop();
      return { cut: cut === null ? null : cut / 1000, sent };
    };
    const per = (rate) => (t) => (rate * 100) / 1000;
    const burst = arrive({ declared: 9 * 1024 * KB, send: (t) => (t % 50000 === 0 ? 64 * KB : 0), until: 300000 });
    ok(burst.cut !== null && burst.cut <= 65, `64 KB every 50 s (security QA round 2) is cut off after its first minute: at ${burst.cut} s`);
    const excused = arrive({ declared: 9 * 1024 * KB, send: (t) => (t % 50000 === 0 ? 64 * KB : 0), paused: (t) => t % 50000 === 0, until: 300000 });
    ok(excused.cut !== null && excused.cut <= 65, `and still when every burst makes the server wait on its disk a moment: at ${excused.cut} s`);
    const drip = arrive({ declared: 9 * 1024 * KB, send: (t) => (t === 0 ? 4 * KB : t % 5000 === 0 ? 1 : 0), until: 300000 });
    same(drip.cut, 60, 'a byte every five seconds is cut off at one minute');
    same(arrive({ declared: 3 * 1024 * KB, send: per(20 * KB), until: 300000 }).cut, null, 'a steady 20 KB a second is never cut off');
    for (const pause of [20, 45]) same(arrive({ declared: 12 * 1024 * KB, send: (t) => (t >= 30000 && t < 30000 + pause * 1000 ? 0 : 10 * KB), until: 300000 }).cut, null, `100 KB a second with a ${pause} s pause is not cut off`);
    const long = arrive({ declared: 12 * 1024 * KB, send: (t) => (t >= 30000 && t < 86000 ? 0 : 10 * KB), until: 300000 });
    ok(long.cut !== null && long.cut > 60 && long.cut <= 90, `with a 56 s pause it is (at ${long.cut} s)`);
    same(arrive({ declared: 12 * 1024 * KB, send: per(100 * KB), paused: (t) => t >= 30000 && t < 200000, until: 300000 }).cut, null, 'nor is a sender the server itself stopped reading for nearly three minutes');
    const end = arrive({ declared: 600 * 1700 + 10, send: (t) => (t < 60000 ? 1700 : t === 61000 ? 10 : 0), until: 300000 });
    same([end.cut, end.sent], [null, 600 * 1700 + 10], 'one that has only a little left to send, and sends it, is not cut off');
    let now = 0;
    const slow = slowSenders({ most: 3, windowMs: 10 * 60000, clock: () => now });
    slow.note('x'); now += 60000; slow.note('x');
    same(slow.wait('x'), 0, 'two cut-offs in ten minutes: still free to upload');
    now += 60000; slow.note('x');
    same([slow.wait('x'), slow.wait('y')], [480, 0], 'a third: the next upload waits until the first is ten minutes old (8 minutes), and only that person\'s');
    now += 480000;
    same(slow.wait('x'), 0, 'then it may go again');
  }

  // Markdown's text.
  same([types.markdownRefusal(Buffer.from('# Day one\n*sun*')), types.markdownRefusal(Buffer.from([0x23, 0x20, 0xc3, 0x28])), types.markdownRefusal(Buffer.from('a\0b')), types.markdownRefusal(Buffer.from('  <!DOCTYPE html><p>x')), types.markdownRefusal(Buffer.from('<svg onload=1>'))], [null, 'kind', 'kind', 'kind', 'kind'], 'Markdown: UTF-8, no NUL, not a page or a drawing');
}

// --- a throwaway server -------------------------------------------------------------------------------------------------
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vault-'));
// A module that declares `library`, as the Vault will: the four permissions (guest defaults asked for, and turned off
// by the host), and the owner's two lower quotas.
function shelfZip(extraSettings = []) {
  const root = path.join(base, 'mods', `shelf${extraSettings.length ? '-x' : ''}`);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify({
    id: 'shelf', name: 'Shelf', version: '1.0.0', scope: ['space'], icon: 'circle',
    surfaces: { canvas: { entry: 'shelf.html' } },
    library: true,
    permissions: [
      { key: 'view', label: 'See the files', default: { member: true, moderator: true, guest: true } },
      { key: 'add', label: 'Add files', default: { member: true, moderator: true, guest: true } },
      { key: 'download', label: 'Download files', default: { member: true, moderator: true, guest: true } },
      { key: 'remove_any', label: 'Remove files other people added', default: { member: false, moderator: true } },
    ],
    access: { read: 'view', write: 'add' },
    refs: { produces: [{ kind: 'file', name: 'File', key: 'file:{id}', summary: { title: 'name', category: 'group' }, open: true, backlinks: true }] },
    settings: [
      { key: 'spaceMaxGb', label: 'Most for one space, in GB', type: 'number', scope: 'environment', min: 0, default: 0 },
      { key: 'personMaxGb', label: 'Most for one person, in GB', type: 'number', scope: 'environment', min: 0, default: 0 },
      ...extraSettings,
    ],
  }));
  fs.writeFileSync(path.join(root, 'src', 'shelf.html'), '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
  fs.writeFileSync(path.join(root, 'src', 'shelf.css'), '');
  fs.writeFileSync(path.join(root, 'src', 'shelf.js'), '');
  return buildModule(root).zip;
}

async function startServer(name, env) {
  const dataDir = path.join(base, `${name}-data`);
  const vaultDir = path.join(base, `${name}-vault`);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, VAULT_DIR: vaultDir, ADMIN_PASSWORD: 'testpass1234', TRUST_PROXY_HOPS: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  const rss = () => { try { return Number(fs.readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)?.[1] || 0) / 1024; } catch { return 0; } };
  return { port, dataDir, vaultDir, stop, rss, out: () => out, pid: child.pid };
}

// One request: { status, headers, bytes, json, text }. `cookie` is a session token; `host` a Host header; `body` a
// Buffer (its Content-Length set unless `headers` names one).
function send(server, method, urlPath, { cookie, headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const h = { accept: 'application/json', ...headers };
    if (cookie) h.cookie = `app_session=${cookie}`;
    if (host) h.host = host;
    if (body !== undefined && h['content-length'] === undefined && h['transfer-encoding'] === undefined) h['content-length'] = String(body.length);
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(bytes.toString()); } catch { /* bytes */ }
        resolve({ status: res.statusCode, headers: res.headers, bytes, json, text: bytes.toString().slice(0, 400), cookies: (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]) });
      });
      res.on('error', reject);
    });
    req.on('error', (err) => resolve({ status: 0, error: err.code || err.message, headers: {}, bytes: Buffer.alloc(0), json: null, text: '' }));
    if (body !== undefined) req.write(body);
    req.end();
  });
}
// A request whose body the check writes itself: { req, answer } where `answer` resolves with the response (or the
// error) as send does; nothing is written until the check writes it.
function open(server, method, urlPath, { cookie, headers = {} } = {}) {
  const h = { accept: 'application/json', ...headers };
  if (cookie) h.cookie = `app_session=${cookie}`;
  const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers: h });
  const answer = new Promise((resolve) => {
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const bytes = Buffer.concat(chunks); let json = null; try { json = JSON.parse(bytes.toString()); } catch { /* bytes */ } resolve({ status: res.statusCode, headers: res.headers, bytes, json }); });
      res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, json: null }));
    });
    req.on('error', (err) => resolve({ status: 0, error: err.code || err.message }));
  });
  req.flushHeaders();
  return { req, answer };
}
const quiet = (ms) => new Promise((r) => setTimeout(r, ms));
// Writes `size` bytes of `block` to an open request as the socket takes them; stops early when an answer comes or the
// request fails, so a refusal can never leave the check waiting.
async function writeAll(o, size, block) {
  let stop = false;
  let wake = null;
  const end = () => { stop = true; if (wake) wake(); };
  o.answer.then(end);
  o.req.once('error', end);
  o.req.once('close', end);
  o.req.on('drain', () => { if (wake) wake(); });
  for (let sent = 0; sent < size && !stop; sent += block.length) {
    if (!o.req.write(block)) await new Promise((r) => { wake = r; });
    wake = null;
  }
}
// Every file under a folder (relative names), for "nothing was written" and "no part was left".
function filesUnder(dir) {
  const out = [];
  const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(dir, p)); } };
  walk(dir);
  return out.sort();
}
const partsUnder = (dir) => filesUnder(dir).filter((f) => path.basename(f).startsWith('.part-'));

let failed = false;
const servers = [];
try {
  // Server A: small quotas, so they can be filled; a minute's allowance of 4 MB.
  const A = await startServer('a', { VAULT_SPACE_MAX_GB: String(40 / 1024), VAULT_PERSON_MAX_GB: String(30 / 1024), VAULT_MAX_GB: String(60 / 1024), VAULT_MB_PER_MINUTE: '40', VAULT_SLOW_MINUTES: '0.25' });
  servers.push(A);
  const login = async (who, password) => { const r = await send(A, 'POST', '/api/login', { headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ login: who, password })) }); assert.equal(r.status, 200, `${who} signs in: ${r.text}`); return r.json.token; };
  const json = (method, urlPath, cookie, value) => send(A, method, urlPath, { cookie, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) });
  const admin = await login('admin', 'testpass1234');
  const people = {};
  for (const who of ['pat', 'sam', 'mo', 'lou', 'rae', 'kit']) {
    const r = await json('POST', '/api/users', admin, { login: who, displayName: who, role: 'member', password: 'memberpass1234' });
    assert.equal(r.status, 201, r.text);
    people[who] = { key: r.json.user.key, token: await login(who, 'memberpass1234') };
  }
  const members = ['pat', 'sam', 'mo', 'rae', 'kit'].map((w) => people[w].key);
  const trip = (await json('POST', '/api/spaces', admin, { name: 'Rome', members })).json.space;
  const other = (await json('POST', '/api/spaces', admin, { name: 'Oslo', members: [people.lou.key] })).json.space;
  await json('PATCH', `/api/spaces/${trip.id}`, admin, { members });
  await json('PATCH', `/api/spaces/${other.id}`, admin, { members: [people.lou.key] });
  assert.equal((await json('PATCH', `/api/users/${people.mo.key}/spaces/${trip.id}`, admin, { permissions: { moderator: true } })).status, 200);
  const up = await send(A, 'POST', '/api/modules', { cookie: admin, headers: { 'content-type': 'application/zip' }, body: shelfZip() });
  same(up.status, 201, `a module that declares library installs: ${up.text}`);
  const libFolder = await send(A, 'POST', '/api/modules', { cookie: admin, headers: { 'content-type': 'application/zip' }, body: shelfZip([{ key: 'maps', label: 'Maps', type: 'files', scope: 'environment', folder: 'library' }]) });
  ok(libFolder.status === 400 && /not "versions" or "library"/.test(libFolder.json?.error), `a files setting may not name its folder library, where the records are: ${libFolder.text}`);
  same((await json('PATCH', '/api/modules/shelf', admin, { enabled: true, allSpaces: true })).status, 200, 'and turns on');
  const roles = (await send(A, 'GET', '/api/roles', { cookie: admin })).json.roles;
  same(['view', 'add', 'download', 'remove_any'].map((k) => roles.guest[`module.shelf.${k}`]), [false, false, false, false], 'its library permissions are off for guests, whatever the manifest asked');
  same(['view', 'add', 'download', 'remove_any'].map((k) => roles.member[`module.shelf.${k}`]), [true, true, true, false], 'and as asked for members');
  const guestToken = (await json('POST', `/api/spaces/${trip.id}/guest-link`, admin, {})).json.space.guestToken;
  // Roles can't turn a library permission on for guests (plan section 6, "off, and cannot be turned on"; security QA
  // round 2, round 2: it could, and the module's data route then answered a guest pass), and the data route stays shut.
  for (const k of ['view', 'add', 'download']) {
    const r = await json('PATCH', '/api/roles/guest', admin, { [`module.shelf.${k}`]: true });
    ok(r.status === 400 && /^Guests can never have ".+"\.$/.test(r.json?.error), `PATCH /api/roles/guest can't turn ${k} on: ${r.status} ${r.json?.error}`);
  }
  same((await send(A, 'GET', '/api/roles', { cookie: admin })).json.roles.guest['module.shelf.view'], false, 'so Roles still shows it off');
  same((await json('PATCH', '/api/roles/guest', admin, { 'module.shelf.remove_any': true, 'module.shelf.view': false })).status, 200, 'remove_any is only off by default for guests, and off may always be sent');
  await json('PATCH', '/api/roles/guest', admin, { 'module.shelf.remove_any': false });
  for (const q of ['', `/space-x`]) {
    const r = await send(A, 'GET', `/api/modules/shelf/data${q}?scope=space&space=${trip.id}&guest=${guestToken}`);
    same(r.status, 403, `a guest pass on the module's data route${q ? ' (one key)' : ''}: 403`);
  }
  const streamKey = (await send(A, 'GET', '/api/me', { cookie: admin })).json.streamKey;
  const spaceDir = path.join(A.vaultDir, '_default', `space-${trip.id}`);
  const lib = (q = '') => `/api/modules/shelf/library?space=${trip.id}${q}`;
  const add = (who, name, body, { type, q = '' } = {}) => send(A, 'POST', lib(`&name=${encodeURIComponent(name)}${q}`), { cookie: people[who]?.token || who, headers: { 'content-type': type || 'application/octet-stream' }, body });

  // --- piece 3: uploads ---------------------------------------------------------------------------------------------
  const kept = {};
  for (const [label, who, name, bytes, type, want] of [
    ['a JPEG', 'pat', 'beach.jpg', jpegOf(), 'image/jpeg', ['image/jpeg', 'image', 'beach.jpg']],
    ['a PNG', 'pat', 'map.png', pngOf(3, 2), 'image/png', ['image/png', 'image', 'map.png']],
    ['a WebP', 'pat', 'sky.webp', webpOf(), 'image/webp', ['image/webp', 'image', 'sky.webp']],
    ['a GIF', 'pat', 'wave.gif', gifOf(), 'image/gif', ['image/gif', 'image', 'wave.gif']],
    ['an MP3', 'sam', 'song.mp3', mp3Of(), 'audio/mpeg', ['audio/mpeg', 'audio', 'song.mp3']],
    ['an OGG', 'sam', 'birds.ogg', oggOf(), 'audio/ogg', ['audio/ogg', 'audio', 'birds.ogg']],
    ['a WAV', 'sam', 'bell.wav', riffOf('WAVE'), 'audio/x-wav', ['audio/wav', 'audio', 'bell.wav']],
    ['an M4A', 'sam', 'talk.m4a', ftypOf('M4A ', ['isom']), 'audio/x-m4a', ['audio/mp4', 'audio', 'talk.m4a']],
    ['an MP4', 'sam', 'walk.mp4', ftypOf('isom', ['mp42']), 'video/mp4', ['video/mp4', 'video', 'walk.mp4']],
    ['a WebM', 'sam', 'clip.webm', ebmlOf('webm'), 'video/webm', ['video/webm', 'video', 'clip.webm']],
    ['a MOV', 'sam', 'IMG_0001.MOV', ftypOf('qt  '), 'video/quicktime', ['video/quicktime', 'video', 'IMG_0001.MOV']],
    ['a PDF', 'pat', 'ticket', pdfOf(), 'application/pdf', ['application/pdf', 'document', 'ticket.pdf']],
    ['a PDF with a web link', 'mo', 'booking.pdf', pdfOf(PDF_WEB_LINK), 'application/pdf', ['application/pdf', 'document', 'booking.pdf']],
    ['a PDF with a fillable form', 'mo', 'visa.pdf', pdfOf(PDF_FORM), 'application/pdf', ['application/pdf', 'document', 'visa.pdf']],
    ['Markdown', 'pat', 'notes.md', Buffer.from('# Day one\n<script>alert(1)</script>\n'), 'text/markdown', ['text/markdown', 'document', 'notes.md']],
  ]) {
    const r = await add(who, name, bytes, { type });
    same([r.status, r.json?.file?.type, r.json?.file?.group, r.json?.file?.name], [201, ...want], `${label} is kept from its bytes: ${r.text}`);
    kept[want[0]] ||= r.json.file; // the first of each type
  }
  const v = kept['application/pdf'];
  same(Object.keys(v).sort(), ['at', 'by', 'group', 'hasThumb', 'id', 'name', 'size', 'type', 'uses'], 'a file\'s view');
  same([v.by, v.size, v.hasThumb, v.uses], [people.pat.key, pdfOf().length, false, 0], 'who added it, its size, no thumbnail, no links');
  ok(/^[a-f0-9]{24}$/.test(v.id) && fs.existsSync(path.join(spaceDir, `${v.id}.bin`)), 'its bytes are VAULT_DIR/_default/space-<id>/<id>.bin on a single install');
  same(fs.readFileSync(path.join(spaceDir, `${v.id}.bin`)), pdfOf(), 'kept as sent');
  const recs = JSON.parse(fs.readFileSync(path.join(A.dataDir, 'modules', 'shelf', 'library', `space-${trip.id}.json`), 'utf8'));
  same([recs[v.id].sha256, recs[v.id].name], [require('node:crypto').createHash('sha256').update(pdfOf()).digest('hex'), 'ticket.pdf'], 'its record, with its SHA-256, in DATA_DIR');
  ok(!filesUnder(A.dataDir).some((f) => f.endsWith('.bin')), 'no bytes under DATA_DIR');

  // Pictures: where it was taken goes unless the person keeps it; what rides along goes either way.
  const jpg = fs.readFileSync(path.join(spaceDir, `${kept['image/jpeg'].id}.bin`));
  ok(!jpg.includes(Buffer.from('Acme')) && !jpg.includes(Buffer.from('2026:09')), 'a JPEG loses its EXIF by default, so where it was taken');
  same(kept['image/jpeg'].taken, '2026-09-21T14:30:05', 'and its taken time is in the record');
  const keptPos = await add('pat', 'pos.jpg', jpegOf(), { type: 'image/jpeg', q: '&keepPosition=1' });
  same(keptPos.status, 201, 'keepPosition=1 keeps it');
  ok(fs.readFileSync(path.join(spaceDir, `${keptPos.json.file.id}.bin`)).includes(Buffer.from('Acme')), 'with its EXIF');
  ok(!fs.readFileSync(path.join(spaceDir, `${kept['image/png'].id}.bin`)).includes(Buffer.from('hidden words')), 'a PNG loses its text');
  // A GIF loses its comment and its XMP (where it was taken) unless the person keeps it; its frame, timing and loop stay.
  {
    const sent = gifOf(3, 2, [gifLoop, gifXmp, gifComment, gifTiming]);
    const g = await add('pat', 'walk.gif', Buffer.concat([sent, Buffer.from('after the end')]), { type: 'image/gif' });
    same(g.status, 201, `a GIF with XMP is kept: ${g.text}`);
    const stored = fs.readFileSync(path.join(spaceDir, `${g.json.file.id}.bin`));
    ok(!stored.includes(Buffer.from('GPSLatitude')) && !stored.includes(Buffer.from('hidden comment')) && !stored.includes(Buffer.from('after the end')), 'a GIF loses its XMP, its comment and what follows its end');
    same(stored, gifOf(3, 2, [gifLoop, gifTiming]), 'and keeps its screen, colours, loop count, timing and frame as they were');
    const kp = await add('pat', 'walk2.gif', sent, { type: 'image/gif', q: '&keepPosition=1' });
    const keptGif = fs.readFileSync(path.join(spaceDir, `${kp.json.file.id}.bin`));
    ok(keptGif.includes(Buffer.from('GPSLatitude')) && !keptGif.includes(Buffer.from('hidden comment')), 'keepPosition=1 keeps its XMP, never its comment');
    const cut = await add('pat', 'cut.gif', sent.subarray(0, sent.length - 9), { type: 'image/gif' });
    same([cut.status, cut.json?.error], [400, 'That picture is damaged or cut short.'], 'a GIF cut short in its frame is refused');
  }

  // Refused, with the sentence that says why, and nothing kept.
  const before = filesUnder(spaceDir);
  for (const [label, name, bytes, type, status, sentence] of [
    ['SVG', 'x.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'image/svg+xml', 400, /That kind of file can't be added here\. It takes pictures/],
    ['SVG under a .png name', 'x.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'image/png', 400, /That kind of file/],
    ['HTML as Markdown', 'x.md', Buffer.from('<!doctype html><script>1</script>'), 'text/markdown', 400, /That kind of file/],
    ['HTML', 'x.html', Buffer.from('<html><script>1</script></html>'), 'text/html', 400, /That kind of file/],
    ['a zip', 'x.zip', Buffer.from('PK\x03\x04\x14\0\0\0\0\0', 'latin1'), 'application/zip', 400, /That kind of file/],
    ['a zip with no name', 'x', Buffer.from('PK\x03\x04\x14\0\0\0\0\0', 'latin1'), 'application/octet-stream', 400, /That kind of file/],
    ['HEIC by name', 'IMG_2.HEIC', ftypOf('heic', ['mif1']), 'image/heic', 400, /^HEIC pictures can't be added here\. Save it as a JPEG\.$/],
    ['HEIC under a .jpg name', 'IMG_2.jpg', ftypOf('heic', ['mif1']), 'image/jpeg', 400, /Save it as a JPEG/],
    ['Matroska', 'film.mkv', ebmlOf('matroska'), 'video/x-matroska', 400, /That kind of file/],
    ['a PDF named .exe', 'ticket.exe', pdfOf(), 'application/octet-stream', 400, /That kind of file/],
    ['a PDF named .jpg', 'ticket.jpg', pdfOf(), 'image/jpeg', 400, /^That file's name or type doesn't match what is in it\.$/],
    ['a PDF sent as a PNG', 'ticket', pdfOf(), 'image/png', 400, /doesn't match/],
    ['a JPEG named .png', 'beach.png', jpegOf(), 'image/png', 400, /doesn't match/],
    ['a PDF with JavaScript', 'evil.pdf', pdfOf('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'), 'application/pdf', 400, /^That PDF holds scripts, so it can't be added\.$/],
    ['a PDF that launches', 'evil.pdf', pdfOf('/OpenAction << /S /Launch /F (calc.exe) >>'), 'application/pdf', 400, /^That PDF holds links that open programs or files, so it can't be added\.$/],
    ['a PDF that sends its form', 'form.pdf', pdfOf(`${PDF_FORM} /OpenAction << /S /SubmitForm /F (https://example.com) >>`), 'application/pdf', 400, /^That PDF holds a form that sends what is typed in it, so it can't be added\.$/],
    ['a PDF that links to a program', 'run.pdf', pdfOf('/OpenAction << /S /URI /URI (file:///C:/calc.exe) >>'), 'application/pdf', 400, /^That PDF holds links that open programs or files, so it can't be added\.$/],
    ['a PDF with a file in it', 'carry.pdf', pdfOf('/Names << /EmbeddedFiles 9 0 R >>'), 'application/pdf', 400, /^That PDF holds files of its own, so it can't be added\.$/],
    ['a PDF with JavaScript in an object stream', 'hidden.pdf', objStm('6 0 << /S /JavaScript /JS (app.alert(1)) >>'), 'application/pdf', 400, /^That PDF holds scripts, so it can't be added\.$/],
    ['a PDF that is cut short', 'cut.pdf', pdfOf().subarray(0, 40), 'application/pdf', 400, /^That PDF is damaged or cut short\.$/],
    ['a PDF whose object stream is too big to check', 'bomb.pdf', objStm('', { data: zlib.deflateSync(Buffer.alloc(17 * 1024 * 1024, 0x20)) }), 'application/pdf', 400, /^That PDF can't be checked for scripts, so it can't be added\.$/],
    ['an MP3 tag with no audio after it', 'tag.mp3', Buffer.concat([Buffer.from('ID3\x03\0\0\0\0\x02\x2c', 'latin1'), Buffer.alloc(300), Buffer.from('<script>1</script>'), Buffer.alloc(5000, 0x41)]), 'audio/mpeg', 400, /That kind of file/],
    ['a picture too large to draw', 'huge.png', pngOf(20000, 6000), 'image/png', 400, /^That picture is too large to show\.$/],
    ['a JPEG cut short', 'cut.jpg', jpegOf().subarray(0, 60), 'image/jpeg', 400, /^That picture is damaged or cut short\.$/],
    ['text that is not Markdown', 'notes.txt', Buffer.from('# hi'), 'text/plain', 400, /That kind of file/],
    ['Markdown that is not UTF-8', 'bad.md', Buffer.from([0x23, 0x20, 0xc3, 0x28]), 'text/markdown', 400, /That kind of file/],
  ]) {
    const r = await add('rae', name, bytes, { type });
    ok(r.status === status && sentence.test(r.json?.error || ''), `${label} is refused (${status}): ${r.status} ${r.text}`);
  }
  same(filesUnder(spaceDir), before, 'nothing was kept for any of them, and no part was left');
  same((await add('rae', '', pdfOf())).json?.error, 'Name the file in ?name=.', 'no name: 400');
  same((await add('rae', 'empty.pdf', Buffer.alloc(0))).status, 400, 'an empty body: 400');
  const chunked = await send(A, 'POST', lib('&name=a.pdf'), { cookie: people.rae.token, headers: { 'content-type': 'application/pdf', 'transfer-encoding': 'chunked' }, body: pdfOf() });
  same([chunked.status, chunked.json?.error], [411, 'Send the file with its size (Content-Length).'], 'no Content-Length: 411');

  // Sizes from Content-Length, before the body: a picture over 25 MB is refused at once and nothing is written.
  const MB = 1024 * 1024;
  const mp4Of = (bytes) => Buffer.concat([ftypOf('isom', ['mp42']), Buffer.alloc(bytes - ftypOf('isom', ['mp42']).length, 7)]);
  {
    const big = open(A, 'POST', lib('&name=big.png'), { cookie: people.pat.token, headers: { 'content-type': 'image/png', 'content-length': String(26 * MB) } });
    const r = await big.answer;
    same([r.status, r.json?.error], [413, 'That file is over the 25 MB limit for pictures.'], 'a 26 MB picture is refused from its Content-Length');
    big.req.destroy();
    same(partsUnder(A.vaultDir), [], 'before any byte was written: no part file');
    const huge = open(A, 'POST', lib('&name=film'), { cookie: people.pat.token, headers: { 'content-type': 'application/octet-stream', 'content-length': String(3 * 1024 * MB) } });
    same((await huge.answer).json?.error, 'That file is over the 2 GB limit for video.', 'over 2 GB with no type said: refused at once');
    huge.req.destroy();
    const pdf = open(A, 'POST', lib('&name=a.pdf'), { cookie: people.pat.token, headers: { 'content-type': 'application/pdf', 'content-length': String(101 * MB) } });
    same((await pdf.answer).json?.error, 'That file is over the 100 MB limit for PDFs.', 'a PDF over 100 MB');
    pdf.req.destroy();
    const md = open(A, 'POST', lib('&name=a.md'), { cookie: people.pat.token, headers: { 'content-type': 'text/markdown', 'content-length': String(2 * MB) } });
    same((await md.answer).json?.error, 'That file is over the 1 MB limit for Markdown.', 'Markdown over 1 MB');
    md.req.destroy();
  }
  // A body that says nothing of its type is refused once its first bytes say it is a picture over 25 MB, without the rest.
  {
    const sneaky = open(A, 'POST', lib('&name=photo'), { cookie: people.kit.token, headers: { 'content-type': 'application/octet-stream', 'content-length': String(26 * MB) } });
    sneaky.req.write(Buffer.concat([pngOf(2, 2), Buffer.alloc(8192)]));
    const r = await sneaky.answer;
    same([r.status, r.json?.error], [413, 'That file is over the 25 MB limit for pictures.'], 'a 26 MB PNG with no name or type said is refused from its first bytes');
    sneaky.req.destroy();
    await quiet(200);
    same(partsUnder(A.vaultDir), [], 'and its part is gone');
  }
  // A body longer than its Content-Length: only what it declared is read as the file.
  {
    const r = await send(A, 'POST', lib('&name=short.pdf'), { cookie: people.pat.token, headers: { 'content-type': 'application/pdf', 'content-length': String(pdfOf().length) }, body: Buffer.concat([pdfOf(), Buffer.from('GARBAGE AFTER THE END'.repeat(10))]) });
    await quiet(300);
    const listed = (await send(A, 'GET', lib(), { cookie: people.pat.token })).json.files.find((f) => f.name === 'short.pdf');
    same([r.status === 201 || r.status === 400, listed?.size], [true, pdfOf().length], 'a body longer than its Content-Length is cut off at it (what follows is not a request, so the server answers 400 to it)');
  }
  // An upload cut off part way: its part goes, and what it reserved is free again.
  {
    const cut = open(A, 'POST', lib('&name=cut.mp4'), { cookie: people.mo.token, headers: { 'content-type': 'video/mp4', 'content-length': String(10 * MB) } });
    cut.req.write(mp4Of(1 * MB));
    await quiet(300);
    same(partsUnder(A.vaultDir).length, 1, 'an upload arriving has a part file');
    cut.req.destroy();
    await cut.answer;
    await quiet(400);
    same(partsUnder(A.vaultDir), [], 'cut off, its part is removed');
  }
  // Two uploads at once reserve against one quota: the second is refused while the first is still arriving.
  {
    const first = open(A, 'POST', lib('&name=first.mp4'), { cookie: people.sam.token, headers: { 'content-type': 'video/mp4', 'content-length': String(20 * MB) } });
    const body = mp4Of(20 * MB);
    first.req.write(body.subarray(0, MB));
    await quiet(200);
    const second = await add('sam', 'second.mp4', mp4Of(12 * MB), { type: 'video/mp4' });
    same([second.status, second.json?.error, second.headers['retry-after']], [429, OTHERS_ARRIVING, '60'], 'a second upload that would pass the person\'s quota only with the first still arriving: 429, try again in a minute');
    first.req.end(body.subarray(MB));
    same((await first.answer).status, 201, 'the first is kept');
    const third = await add('sam', 'third.mp4', mp4Of(12 * MB), { type: 'video/mp4' });
    same([third.status, third.json?.error], [413, 'You have used your 30 MB in Shelf. Remove some of your files to add more.'], 'and then counts on disk: 413');
  }
  // Two uploads at once for one person; a third waits.
  {
    const a1 = open(A, 'POST', lib('&name=a1.mp4'), { cookie: people.pat.token, headers: { 'content-type': 'video/mp4', 'content-length': String(MB) } });
    const a2 = open(A, 'POST', lib('&name=a2.mp4'), { cookie: people.pat.token, headers: { 'content-type': 'video/mp4', 'content-length': String(MB) } });
    const body = mp4Of(MB);
    a1.req.write(body.subarray(0, 8192));
    a2.req.write(body.subarray(0, 8192));
    await quiet(300);
    const a3 = await add('pat', 'a3.mp4', mp4Of(MB), { type: 'video/mp4' });
    same([a3.status, a3.json?.error, a3.headers['retry-after']], [429, 'Another upload is still running. Wait for it to finish.', '5'], 'a third upload at once: 429');
    a1.req.end(body.subarray(8192));
    a2.req.end(body.subarray(8192));
    same([(await a1.answer).status, (await a2.answer).status], [201, 201], 'the two finish');
    same((await add('pat', 'a3.mp4', mp4Of(MB), { type: 'video/mp4' })).status, 201, 'then another may start');
  }
  // The space's quota (40 MB here), the owner's lower person quota, the server's total (60 MB).
  {
    same((await add('pat', 'big.mp4', mp4Of(14 * MB), { type: 'video/mp4' })).status, 201, 'the space fills up');
    const full = await add('mo', 'more.mp4', mp4Of(5 * MB), { type: 'video/mp4' });
    same([full.status, full.json?.error], [413, 'This space\'s Shelf is full (40 MB). Remove some files to add more.'], 'a space that is full: 413');
    const set = await json('PUT', '/api/modules/shelf/settings/environment', admin, { values: { personMaxGb: 0.01 } });
    same(set.status, 200, `the owner sets a lower person quota: ${set.text}`);
    const lower = await add('rae', 'tiny.gif', gifOf(), { type: 'image/gif' });
    same(lower.status, 201, 'someone under it still adds');
    const overLower = await send(A, 'POST', `/api/modules/shelf/library?space=${other.id}&name=x.mp4`, { cookie: people.lou.token, headers: { 'content-type': 'video/mp4' }, body: mp4Of(11 * MB) });
    same([overLower.status, overLower.json?.error], [413, 'You have used your 10.2 MB in Shelf. Remove some of your files to add more.'], 'the owner\'s lower quota holds');
    await json('PUT', '/api/modules/shelf/settings/environment', admin, { values: { personMaxGb: 0 } });
    const inOther = (who, name, bytes) => send(A, 'POST', `/api/modules/shelf/library?space=${other.id}&name=${name}`, { cookie: people[who].token, headers: { 'content-type': 'video/mp4' }, body: bytes });
    same((await inOther('lou', 'x.mp4', mp4Of(20 * MB))).status, 201, 'another space still takes files');
    const total = await inOther('lou', 'y.mp4', mp4Of(5 * MB));
    same([total.status, total.json?.error], [413, 'The server\'s file storage is full. Ask the admin.'], 'the server\'s total (VAULT_MAX_GB): 413');
  }
  // The minute's allowance (40 MB here), counted from Content-Length when an upload starts.
  {
    const r = await send(A, 'POST', `/api/modules/shelf/library?space=${trip.id}&name=late.mp4`, { cookie: people.kit.token, headers: { 'content-type': 'video/mp4' }, body: mp4Of(15 * MB) });
    ok(r.status === 429 && /^You have sent a lot in the last minute\. Wait \d+ seconds and try again\.$/.test(r.json?.error) && Number(r.headers['retry-after']) > 0, `over VAULT_MB_PER_MINUTE: 429 with Retry-After (${r.status} ${r.text})`);
  }
  // The module's own upload limit: 30 a minute for one person.
  {
    let got = null;
    for (let i = 0; i < 32 && !got; i += 1) {
      const r = await add('rae', `g${i}.gif`, gifOf(), { type: 'image/gif' });
      if (r.status === 429) got = r;
    }
    same(got?.json?.error, 'This module is doing that too often. Try again in a moment.', 'the module upload limit (30 a minute) holds, and says so plainly');
  }
  same(partsUnder(A.vaultDir), [], 'no part file is left after any of it');

  // Who may add, decided before the body: nothing is read or written for a refusal.
  {
    const asks = [
      ['signed out', {}, 401, 'Sign in first.'],
      ['a guest pass', { q: `&guest=${guestToken}` }, 403, 'Guests can\'t use Shelf.'],
      ['the access key', { headers: { 'x-stream-key': streamKey } }, 403, 'The access key can\'t open Shelf.'],
      ['someone not in the space', { cookie: people.lou.token }, 404, 'There is no such space.'],
      ['no such space', { cookie: people.pat.token, space: 'nosuch1' }, 404, 'There is no such space.'],
    ];
    for (const [who, o, status, error] of asks) {
      const u = open(A, 'POST', `/api/modules/shelf/library?space=${o.space || trip.id}&name=x.mp4${o.q || ''}`, { cookie: o.cookie, headers: { 'content-type': 'video/mp4', 'content-length': String(5 * MB), ...(o.headers || {}) } });
      const r = await u.answer;
      same([r.status, r.json?.error], [status, error], `${who}: ${status} before the body`);
      u.req.destroy();
    }
    await json('PATCH', '/api/roles/member', admin, { 'module.shelf.add': false });
    const noAdd = await add('rae', 'x.gif', gifOf(), { type: 'image/gif' });
    same([noAdd.status, noAdd.json?.error], [403, 'Your role can\'t do that in Shelf.'], 'a member whose role may not add: 403');
    same((await add('mo', 'mod.gif', gifOf(), { type: 'image/gif' })).status, 201, 'a moderator still may (the moderator role keeps add)');
    await json('PATCH', '/api/roles/member', admin, { 'module.shelf.add': true });
    same((await send(A, 'POST', '/api/modules/nosuch/library?space=x&name=a.pdf', { cookie: people.pat.token, body: pdfOf() })).status, 404, 'no such module: 404');
    const signedOut = await Promise.all(['shelf', 'nosuch'].map((id) => send(A, 'GET', `/api/modules/${id}/library?space=${trip.id}`)));
    same(signedOut.map((r) => [r.status, r.json?.error]), [[401, 'Sign in first.'], [401, 'Sign in first.']], 'signed out, a library module and one that is not there answer the same');
    same((await send(A, 'GET', `/api/modules/shelf/library?space=nosuch1`, { cookie: people.lou.token })).json, (await send(A, 'GET', `/api/modules/shelf/library?space=${trip.id}`, { cookie: people.lou.token })).json, 'a space someone is not in answers as one that is not there');
    same(partsUnder(A.vaultDir), [], 'nothing written for any refusal');
  }
  // --- piece 4: serving, with ranges and the headers every file is sent with ----------------------------------------
  {
    const listed = (await send(A, 'GET', lib(), { cookie: people.sam.token })).json;
    ok(Array.isArray(listed.files) && listed.files.length > 20 && listed.usage.maxBytes === 40 * MB && listed.usage.bytes > 30 * MB, 'the list: every file, and what the space uses of its quota');
    const content = (f, q = '', o = {}) => send(A, 'GET', `/api/modules/shelf/library/${f.id}/content?space=${trip.id}${q}`, { cookie: people.sam.token, ...o });
    for (const f of Object.values(kept)) {
      const r = await content(f);
      const h = r.headers;
      same([r.status, h['content-type'], h['x-content-type-options'], h['cache-control'], h['cross-origin-resource-policy'], h['referrer-policy'], h['accept-ranges']],
        [200, f.type === 'text/markdown' ? 'text/plain; charset=utf-8' : f.type, 'nosniff', 'private, no-store', 'same-origin', 'no-referrer', 'bytes'], `${f.name}: its stored type and every header`);
      same(h['content-security-policy'], "sandbox; default-src 'none'", `${f.name}: the sandbox, a PDF too (security QA round 2, round 2)`);
      const kind = f.type === 'application/pdf' ? 'attachment' : 'inline';
      ok(h['content-disposition'] === `${kind}; filename="${f.name}"; filename*=UTF-8''${encodeURIComponent(f.name)}` && h.etag && h['last-modified'], `${f.name}: ${kind} (a PDF always, until the app's own viewer), with its name, an ETag and Last-Modified`);
      same(r.bytes.length, f.size, `${f.name}: whole`);
    }
    const md = await content(kept['text/markdown']);
    same(md.bytes.toString(), '# Day one\n<script>alert(1)</script>\n', 'Markdown is sent as the text it is, never as a page');
    // Ranges, on a 20 MB video.
    const film = listed.files.find((f) => f.name === 'first.mp4');
    const whole = fs.readFileSync(path.join(spaceDir, `${film.id}.bin`));
    const part = await content(film, '', { headers: { range: 'bytes=100-199' } });
    same([part.status, part.headers['content-range'], part.bytes.equals(whole.subarray(100, 200))], [206, `bytes 100-199/${whole.length}`, true], 'a range: 206 with those bytes');
    const tail = await content(film, '', { headers: { range: 'bytes=-10' } });
    same([tail.status, tail.bytes.equals(whole.subarray(-10))], [206, true], 'the last ten bytes');
    const open1 = await content(film, '', { headers: { range: `bytes=${whole.length - 5}-` } });
    same([open1.status, open1.headers['content-range']], [206, `bytes ${whole.length - 5}-${whole.length - 1}/${whole.length}`], 'from a place to the end');
    const bad = await content(film, '', { headers: { range: `bytes=${whole.length + 10}-` } });
    same([bad.status, bad.headers['content-range'], bad.json?.error, bad.headers['content-type']], [416, `bytes */${whole.length}`, 'That part of the file is out of range.', 'application/json; charset=utf-8'], 'a range it can\'t meet: 416 with the size');
    const etag = part.headers.etag;
    same((await content(film, '', { headers: { range: 'bytes=0-9', 'if-range': etag } })).status, 206, 'If-Range with its ETag: the range');
    const stale = await content(kept['application/pdf'], '', { headers: { range: 'bytes=0-9', 'if-range': '"not-it"' } });
    same([stale.status, stale.bytes.length], [200, kept['application/pdf'].size], 'If-Range with another: the whole file');
    // A download: attachment, with the name in both forms.
    const named = await add('pat', 'Résumé été.pdf', pdfOf(), { type: 'application/pdf' });
    const dl = await send(A, 'GET', `/api/modules/shelf/library/${named.json.file.id}/content?space=${trip.id}&download=1`, { cookie: people.sam.token });
    same([dl.status, dl.headers['content-disposition']], [200, 'attachment; filename="R_sum_ _t_.pdf"; filename*=UTF-8\'\'R%C3%A9sum%C3%A9%20%C3%A9t%C3%A9.pdf'], 'download=1: attachment, a cleaned ASCII name and the UTF-8 one');
    await json('PATCH', '/api/roles/member', admin, { 'module.shelf.download': false });
    const noDl = await send(A, 'GET', `/api/modules/shelf/library/${named.json.file.id}/content?space=${trip.id}&download=1`, { cookie: people.sam.token });
    same([noDl.status, noDl.json?.error], [404, 'There is no such file.'], 'without download: 404');
    same((await content(named.json.file)).status, 200, 'it is still sent without download=1');
    await json('PATCH', '/api/roles/member', admin, { 'module.shelf.download': true });

    // Thumbnails: from the person who added a picture or a video, small, cleaned.
    const thumbOf = (f, who, body, type = 'image/png') => send(A, 'PUT', `/api/modules/shelf/library/${f.id}/thumb?space=${trip.id}`, { cookie: people[who].token, headers: { 'content-type': type }, body });
    same((await send(A, 'GET', `/api/modules/shelf/library/${kept['image/jpeg'].id}/thumb?space=${trip.id}`, { cookie: people.sam.token })).status, 404, 'no thumbnail yet: 404');
    const t = await thumbOf(kept['image/jpeg'], 'pat', pngOf(4, 4));
    same([t.status, t.json?.file?.hasThumb], [200, true], 'the adder gives it a small picture');
    const tg = await send(A, 'GET', `/api/modules/shelf/library/${kept['image/jpeg'].id}/thumb?space=${trip.id}`, { cookie: people.sam.token });
    same([tg.status, tg.headers['content-type'], tg.headers['x-content-type-options'], tg.bytes.includes(Buffer.from('hidden words'))], [200, 'image/png', 'nosniff', false], 'and it is served cleaned, with its own type');
    same((await thumbOf(kept['image/jpeg'], 'sam', pngOf(4, 4))).status, 403, 'someone else may not');
    same((await thumbOf(kept['application/pdf'], 'pat', pngOf(4, 4))).status, 400, 'a PDF has none');
    same((await thumbOf(kept['image/png'], 'pat', Buffer.from('<svg/>'), 'image/svg+xml')).status, 400, 'an SVG is not one');
    same((await thumbOf(kept['image/png'], 'pat', pngOf(4, 4, Buffer.alloc(310 * 1024)))).status, 413, 'over 300 KB: 413');
    // A small picture that stalls: two at once for one person, a third waits; each is cut off within ten seconds and
    // what its size gives at the floor, so nothing is held open.
    {
      const thumbUrl = `/api/modules/shelf/library/${kept['image/png'].id}/thumb?space=${trip.id}`;
      const stalled = [0, 1].map(() => open(A, 'PUT', thumbUrl, { cookie: people.pat.token, headers: { 'content-type': 'image/png', 'content-length': '1000' } }));
      const started = Date.now();
      const closedAt = [];
      for (const s of stalled) { s.req.on('close', () => closedAt.push(Date.now() - started)); s.req.write(Buffer.alloc(10)); }
      await quiet(300);
      const third = await thumbOf(kept['image/png'], 'pat', pngOf(4, 4));
      same([third.status, third.json?.error, third.headers['retry-after']], [429, 'Another small picture is still being sent. Wait for it to finish.', '5'], 'a third small picture at once: 429');
      same((await thumbOf(kept['image/jpeg'], 'pat', pngOf(4, 4))).status === 429, true, 'still, while the two are held');
      while (closedAt.length < 2 && Date.now() - started < 20000) await quiet(200);
      ok(closedAt.length === 2 && Math.max(...closedAt) < 12000, `a stalled small picture is cut off (after ${closedAt.map((t) => Math.round(t / 100) / 10).join(' and ')} s)`);
      same((await thumbOf(kept['image/png'], 'pat', pngOf(4, 4))).status, 200, 'then the next one goes');
    }
    // Three cut-offs within VAULT_SLOW_MINUTES (a quarter of a minute here), as lou in Oslo: lou's next upload waits,
    // with a Retry-After, until the first of them is that long ago; someone else's does not.
    {
      const inOslo = (who, name, body, type) => send(A, 'POST', `/api/modules/shelf/library?space=${other.id}&name=${name}`, { cookie: people[who]?.token || who, headers: { 'content-type': type }, body });
      const own = await inOslo('lou', 'own.png', pngOf(4, 4), 'image/png');
      same(own.status, 201, `lou adds a picture: ${own.text}`);
      const thumbUrl = `/api/modules/shelf/library/${own.json.file.id}/thumb?space=${other.id}`;
      const stall = async (count) => {
        const reqs = Array.from({ length: count }, () => open(A, 'PUT', thumbUrl, { cookie: people.lou.token, headers: { 'content-type': 'image/png', 'content-length': '1000' } }));
        await Promise.all(reqs.map((o) => new Promise((resolve) => { o.req.on('close', resolve); o.req.write(Buffer.alloc(10)); })));
      };
      await stall(2);
      await stall(1);
      const blocked = await inOslo('lou', 'after.pdf', pdfOf(), 'application/pdf');
      const retry = Number(blocked.headers['retry-after']);
      ok(blocked.status === 429 && blocked.json?.error === 'Your last few uploads stalled, so you can add files again in a minute.' && retry > 0 && retry <= 15, `three cut-offs in a row: the next upload is refused (${blocked.status} ${blocked.json?.error} Retry-After ${retry})`);
      const thumbNow = await send(A, 'PUT', thumbUrl, { cookie: people.lou.token, headers: { 'content-type': 'image/png' }, body: pngOf(4, 4) });
      same(thumbNow.status, 429, 'and so is a small picture');
      const others = await inOslo(admin, 'other.pdf', pdfOf(), 'application/pdf');
      same(others.status, 201, `someone else's is not: ${others.text}`);
      await quiet(retry * 1000 + 500);
      const later = await inOslo('lou', 'after.pdf', pdfOf(), 'application/pdf');
      same(later.status, 201, `after the Retry-After it goes: ${later.text}`);
      for (const [r, token] of [[others, admin], [later, people.lou.token], [own, people.lou.token]]) same((await send(A, 'DELETE', `/api/modules/shelf/library/${r.json.file.id}?space=${other.id}`, { cookie: token })).status, 200, 'and they are removed again');
    }

    // Open file streams: twelve at once for one person; the thirteenth waits.
    const held = [];
    for (let i = 0; i < 12; i += 1) {
      const req = http.request({ host: '127.0.0.1', port: A.port, path: `/api/modules/shelf/library/${film.id}/content?space=${trip.id}`, headers: { cookie: `app_session=${people.kit.token}` } });
      held.push(new Promise((resolve) => req.on('response', (res) => { res.pause(); resolve({ req, res }); })));
      req.end();
    }
    const streams = await Promise.all(held);
    ok(streams.every((x) => x.res.statusCode === 200), 'twelve readers that do not read are open');
    const thirteenth = await send(A, 'GET', `/api/modules/shelf/library/${kept['application/pdf'].id}/content?space=${trip.id}`, { cookie: people.kit.token });
    same([thirteenth.status, thirteenth.json?.error], [429, 'Too many files are open at once. Close some and try again.'], 'the thirteenth: 429');
    same((await content(kept['application/pdf'])).status, 200, 'someone else is not held up');
    for (const x of streams) x.req.destroy();
    await quiet(300);
    same((await send(A, 'GET', `/api/modules/shelf/library/${kept['application/pdf'].id}/content?space=${trip.id}`, { cookie: people.kit.token })).status, 200, 'closed, they free their places');
  }
  // --- piece 6: who may do what, on every route --------------------------------------------------------------------
  {
    const own = await json('POST', '/api/users', admin, { login: 'ola', displayName: 'Ola', role: 'owner', password: 'ownerpass1234' });
    same(own.status, 201, 'an owner');
    const ownerTok = await login('ola', 'ownerpass1234');
    // A member whose role may not view: a role of their own would need Roles; the member role is switched for the row.
    const f = (await add('pat', 'matrix.jpg', jpegOf(), { type: 'image/jpeg' })).json.file;
    await send(A, 'PUT', `/api/modules/shelf/library/${f.id}/thumb?space=${trip.id}`, { cookie: people.pat.token, headers: { 'content-type': 'image/png' }, body: pngOf(2, 2) });
    const who = {
      'signed out': {},
      'a guest pass': { q: `&guest=${guestToken}` },
      'the access key': { headers: { 'x-stream-key': streamKey } },
      'not in the space': { cookie: people.lou.token },
      member: { cookie: people.sam.token },
      adder: { cookie: people.pat.token },
      moderator: { cookie: people.mo.token },
      owner: { cookie: ownerTok },
      admin: { cookie: admin },
    };
    const routes = {
      list: (o) => send(A, 'GET', `/api/modules/shelf/library?space=${trip.id}${o.q || ''}`, o),
      content: (o) => send(A, 'GET', `/api/modules/shelf/library/${f.id}/content?space=${trip.id}${o.q || ''}`, o),
      download: (o) => send(A, 'GET', `/api/modules/shelf/library/${f.id}/content?space=${trip.id}&download=1${o.q || ''}`, o),
      thumb: (o) => send(A, 'GET', `/api/modules/shelf/library/${f.id}/thumb?space=${trip.id}${o.q || ''}`, o),
      uses: (o) => send(A, 'GET', `/api/modules/shelf/library/${f.id}/uses?space=${trip.id}${o.q || ''}`, o),
      rename: (o) => send(A, 'PATCH', `/api/modules/shelf/library/${f.id}?space=${trip.id}${o.q || ''}`, { ...o, headers: { ...(o.headers || {}), 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ name: 'matrix' })) }),
      'put thumb': (o) => send(A, 'PUT', `/api/modules/shelf/library/${f.id}/thumb?space=${trip.id}${o.q || ''}`, { ...o, headers: { ...(o.headers || {}), 'content-type': 'image/png' }, body: pngOf(2, 2) }),
    };
    //            signed out, guest, key, outsider, member, adder, moderator, owner, admin
    const want = {
      list: [401, 403, 403, 404, 200, 200, 200, 200, 200],
      content: [401, 404, 404, 404, 200, 200, 200, 200, 200],
      download: [401, 404, 404, 404, 200, 200, 200, 200, 200],
      thumb: [401, 404, 404, 404, 200, 200, 200, 200, 200],
      uses: [401, 404, 404, 404, 200, 200, 200, 200, 200],
      rename: [401, 404, 404, 404, 403, 200, 200, 200, 200],
      'put thumb': [401, 404, 404, 404, 403, 200, 403, 403, 403],
    };
    for (const [route, call] of Object.entries(routes)) {
      const got = [];
      for (const [label, o] of Object.entries(who)) {
        const r = await call(o);
        got.push(r.status);
        if (r.status === 404) ok(r.json?.error === (route === 'list' ? 'There is no such space.' : 'There is no such file.') && !r.text.includes('matrix'), `${route}, ${label}: a refusal says nothing of the file or the space`);
      }
      same(got, want[route], `${route}: ${Object.keys(who).join(', ')}`);
    }
    same((await routes.uses(who.member)).json, { uses: [], hidden: 0 }, 'uses: nothing links to it yet');
    same((await routes.rename(who.adder)).json?.file?.name, 'matrix.jpg', 'a rename keeps the type\'s extension');
    // A member whose role may not view: every route refuses, a file route with 404.
    await json('PATCH', '/api/roles/member', admin, { 'module.shelf.view': false });
    same([(await routes.list(who.member)).status, (await routes.content(who.member)).status, (await routes.uses(who.member)).status], [403, 404, 404], 'a member without view: 403 for the list, 404 for the file');
    same((await routes.content(who.moderator)).status, 200, 'a moderator keeps it');
    await json('PATCH', '/api/roles/member', admin, { 'module.shelf.view': true });
    // The module turned off: its files are kept, and not reachable. Never in the Lobby.
    await json('PATCH', '/api/modules/shelf', admin, { enabled: false });
    same([(await routes.list(who.member)).status, (await routes.content(who.member)).status], [404, 404], 'the module off: 404');
    ok(fs.existsSync(path.join(spaceDir, `${f.id}.bin`)), 'and the file is still kept');
    await json('PATCH', '/api/modules/shelf', admin, { enabled: true, allSpaces: true });
    same((await routes.content(who.member)).status, 200, 'on again, it is back');
    const lobby = await send(A, 'GET', '/api/modules/shelf/library?space=lobby', { cookie: admin });
    ok(lobby.status === 404 && /can't be turned on in/.test(lobby.json?.error), `there is no library in the Lobby, and it says so: ${lobby.text}`);
    // A file id from another space, with that space named: 404.
    same((await send(A, 'GET', `/api/modules/shelf/library/${f.id}/content?space=${other.id}`, { cookie: people.lou.token })).status, 404, 'another space\'s file, asked for in one\'s own: 404');
    for (const fid of ['..%2F..%2Fapp.json', '..', '%2e%2e', 'a'.repeat(24), `${f.id}.bin`, `${f.id}%00`]) same((await send(A, 'GET', `/api/modules/shelf/library/${fid}/content?space=${trip.id}`, { cookie: people.sam.token })).status, 404, `a file id of ${fid}: 404`);
    same((await send(A, 'GET', `/api/modules/shelf/library/${f.id}/content?space=..%2F..`, { cookie: people.sam.token })).status, 404, 'a space id that is a path: 404');
    // Removing: the adder, a moderator (remove_any), an owner; not another member.
    const del = (fid, o) => send(A, 'DELETE', `/api/modules/shelf/library/${fid}?space=${trip.id}${o.q || ''}`, o);
    const g1 = (await add('pat', 'one.gif', gifOf(), { type: 'image/gif' })).json.file;
    const g2 = (await add('pat', 'two.gif', gifOf(), { type: 'image/gif' })).json.file;
    const r1 = await del(g1.id, who.member);
    same([r1.status, r1.json?.error], [403, 'Only the person who added it, or someone who may remove other people\'s files, can remove it.'], 'another member may not remove it: 403');
    same((await del(g1.id, who['a guest pass'])).status, 404, 'a guest: 404');
    same((await del(g1.id, who.moderator)).json, { ok: true }, 'a moderator may (remove_any)');
    same((await del(g2.id, who.adder)).json, { ok: true }, 'the adder may');
    same((await del(f.id, who.owner)).json, { ok: true }, 'an owner may');
    ok(![g1, g2, f].some((x) => fs.existsSync(path.join(spaceDir, `${x.id}.bin`)) || fs.existsSync(path.join(spaceDir, `${x.id}.thumb`))), 'removed: bytes and small pictures gone');
    same((await routes.content(who.member)).status, 404, 'and it answers 404');
    same((await del(f.id, who.owner)).status, 404, 'removing twice: 404');
    const activity = (await send(A, 'GET', '/api/modules/activity', { cookie: admin })).json.activity.map((a) => a.what);
    ok(activity.includes('added a file to Shelf') && activity.includes('removed a file from Shelf') && !activity.some((w) => /matrix|one\.gif|ticket/.test(w)), 'activity lines, without the files\' names');
  }
  // --- uninstalling: kept data stays, data removed takes the files' bytes and what the server holds of them -----------
  {
    const reinstall = async () => {
      same((await send(A, 'POST', '/api/modules', { cookie: admin, headers: { 'content-type': 'application/zip' }, body: shelfZip() })).status, 201, 'installed again');
      await json('PATCH', '/api/modules/shelf', admin, { enabled: true, allSpaces: true });
    };
    const listOf = async () => (await send(A, 'GET', lib(), { cookie: people.sam.token })).json;
    const before = await listOf();
    const one = before.files[0];
    ok(before.files.length > 5 && filesUnder(spaceDir).some((f) => f.endsWith('.bin')), 'the space has files');
    same((await send(A, 'DELETE', '/api/modules/shelf', { cookie: admin })).status, 200, 'uninstalled, keeping its data');
    await reinstall();
    same((await listOf()).files.map((f) => f.id), before.files.map((f) => f.id), 'installed again, its files are all there');
    same((await send(A, 'DELETE', '/api/modules/shelf?keepData=0', { cookie: admin })).status, 200, 'uninstalled with its data');
    same(filesUnder(spaceDir).filter((f) => /\.(bin|thumb)$/.test(f)), [], 'its files\' bytes and small pictures are gone from VAULT_DIR');
    ok(!fs.existsSync(path.join(A.dataDir, 'modules', 'shelf', 'library')), 'and their records');
    const folders = fs.readdirSync(path.join(A.vaultDir, '_default')).filter((d) => d.startsWith('space-'));
    same(folders.filter((d) => !fs.readdirSync(path.join(A.vaultDir, '_default', d)).length), [], `and no space's folder is left empty (security QA round 2, round 2): ${folders.join(', ') || 'none left'}`);
    await reinstall();
    const after = await listOf();
    same([after.files, after.usage.bytes], [[], 0], 'installed again, it has no files and uses nothing');
    same((await send(A, 'GET', `/api/modules/shelf/library/${one.id}/content?space=${trip.id}`, { cookie: people.sam.token })).status, 404, 'an old file answers 404');
    same((await send(A, 'DELETE', '/api/modules/nosuch?keepData=0', { cookie: admin })).status, 404, 'uninstalling a module that is not there: 404');
    // An upload still arriving when the module is uninstalled with its data is stopped (security QA round 2: it was kept
    // and came back after a reinstall): answered, its part removed, no records written.
    const three = pdfSized(3 * 1024 * 1024);
    const flying = open(A, 'POST', lib('&name=fly.pdf'), { cookie: people.sam.token, headers: { 'content-type': 'application/pdf', 'content-length': String(three.length) } });
    flying.req.on('error', () => {});
    flying.req.write(three.subarray(0, 1024 * 1024));
    await quiet(400);
    same((await send(A, 'DELETE', '/api/modules/shelf?keepData=0', { cookie: admin })).status, 200, 'uninstalled with its data while a file is arriving');
    flying.req.end(three.subarray(1024 * 1024));
    const flew = await flying.answer;
    same([flew.status, flew.json?.error], [404, 'Shelf was removed while the file was arriving, so it wasn\'t added.'], 'the upload is refused');
    await quiet(300);
    ok(!fs.existsSync(path.join(A.dataDir, 'modules', 'shelf', 'library')) && partsUnder(A.vaultDir).length === 0, 'no records are written and its part is removed');
    await reinstall();
    same((await listOf()).files, [], 'installed again, the file is not there');
  }
  // A library route in another case is a library route: its body is not read by the JSON parser before access is
  // decided (security QA round 2, round 2: up to 64 KB were), so signed out it is 401, not the parser's 413.
  {
    const big = Buffer.from(JSON.stringify({ x: 'y'.repeat(100 * 1024) }));
    const r = await send(A, 'POST', `/api/modules/shelf/LIBRARY?space=${trip.id}&name=a.pdf`, { headers: { 'content-type': 'application/json' }, body: big });
    same([r.status, r.json?.error], [401, 'Sign in first.'], 'POST /api/modules/shelf/LIBRARY with a large JSON body, signed out: 401 before the body is read');
  }
  // --- end of server A ---
  await A.stop();

  // --- a request's body must arrive in REQUEST_BODY_SECONDS on every route but a library upload ---------------------
  // (security QA round 2, round 2: the two hours a library upload may take held every route open that long).
  {
    const T = await startServer('t', { REQUEST_BODY_SECONDS: '2' });
    servers.push(T);
    const tjson = (method, urlPath, cookie, value) => send(T, method, urlPath, { cookie, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) });
    const tAdmin = (await tjson('POST', '/api/login', null, { login: 'admin', password: 'testpass1234' })).json.token;
    const sp = (await tjson('POST', '/api/spaces', tAdmin, { name: 'Slow' })).json.space;
    same((await send(T, 'POST', '/api/modules', { cookie: tAdmin, headers: { 'content-type': 'application/zip' }, body: shelfZip() })).status, 201, 'a library module installs on the slow-body server');
    await tjson('PATCH', '/api/modules/shelf', tAdmin, { enabled: true, allSpaces: true });
    const t0 = Date.now();
    const slowLogin = open(T, 'POST', '/api/login', { headers: { 'content-type': 'application/json', 'content-length': '1000' } });
    slowLogin.req.on('error', () => {});
    let loginClosed = null;
    slowLogin.answer.then(() => { loginClosed = Date.now(); });
    slowLogin.req.write('{"login":"');
    const drip = setInterval(() => { if (!slowLogin.req.destroyed) slowLogin.req.write('x'); }, 500);
    const pdf = pdfSized(64 * 1024);
    const slowUpload = open(T, 'POST', `/api/modules/shelf/library?space=${sp.id}&name=slow.pdf`, { cookie: tAdmin, headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.length) } });
    for (let k = 0; k < 8; k += 1) { slowUpload.req.write(pdf.subarray(k * 8192, (k + 1) * 8192)); await quiet(500); }
    slowUpload.req.end();
    const login = await slowLogin.answer;
    clearInterval(drip);
    const closedAfter = ((loginClosed || Date.now()) - t0) / 1000;
    ok(login.status === 0 && closedAfter >= 1.5 && closedAfter < 4, `a login whose body trickles in is closed after REQUEST_BODY_SECONDS (2 here; 300 by default): ${login.status || login.error} after ${closedAfter.toFixed(1)} s`);
    const uploaded = await slowUpload.answer;
    same(uploaded.status, 201, 'while a library upload sent over 4 seconds is still taken');
    await T.stop();
  }

  // --- a server with environments (BASE_DOMAIN): each environment's files are its own -------------------------------
  {
    const BASE = 'vault.test';
    // The server's total is 10 MB here, so one environment's upload still arriving could fill it.
    const H = await startServer('h', { BASE_DOMAIN: BASE, ADMIN_LOGIN: 'host', ADMIN_PASSWORD: 'hostpass1234', VAULT_MAX_GB: String(10 / 1024) });
    servers.push(H);
    const at = (sub) => `${sub ? `${sub}.` : ''}${BASE}:${H.port}`;
    const hsend = (method, sub, urlPath, o = {}) => send(H, method, urlPath, { ...o, host: at(sub) });
    const hjson = (method, sub, urlPath, value, o = {}) => hsend(method, sub, urlPath, { ...o, headers: { ...(o.headers || {}), 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) });
    const hostLogin = await hjson('POST', 'admin', '/api/host/login', { login: 'host', password: 'hostpass1234' });
    same(hostLogin.status, 200, `the host admin signs in: ${hostLogin.text}`);
    const hostCookie = hostLogin.cookies.join('; ');
    const envs = {};
    for (const slug of ['aaa', 'bbb']) {
      same((await hjson('POST', 'admin', '/api/host/environments', { slug, name: `Env ${slug}`, owner: { login: `own${slug}`, password: 'ownerpass1234' } }, { headers: { cookie: hostCookie } })).status, 201, `environment ${slug}`);
      const asHost = (await hjson('POST', slug, '/api/login', { login: 'host', password: 'hostpass1234' })).json.token;
      same((await hsend('POST', slug, '/api/modules', { cookie: asHost, headers: { 'content-type': 'application/zip' }, body: shelfZip() })).status, 201, `the module installs in ${slug}`);
      same((await hjson('PATCH', slug, '/api/modules/shelf', { enabled: true, allSpaces: true }, { cookie: asHost })).status, 200, 'and turns on');
      const owner = (await hjson('POST', slug, '/api/login', { login: `own${slug}`, password: 'ownerpass1234' })).json.token;
      const space = (await hjson('POST', slug, '/api/spaces', { name: 'Trip' }, { cookie: owner })).json.space;
      envs[slug] = { owner, host: asHost, space };
    }
    const a = envs.aaa;
    const b = envs.bbb;
    const upA = await hsend('POST', 'aaa', `/api/modules/shelf/library?space=${a.space.id}&name=ticket.pdf`, { cookie: a.owner, headers: { 'content-type': 'application/pdf' }, body: pdfOf() });
    same(upA.status, 201, `a file in aaa: ${upA.text}`);
    const fid = upA.json.file.id;
    ok(fs.existsSync(path.join(H.vaultDir, 'aaa', `space-${a.space.id}`, `${fid}.bin`)) && !fs.existsSync(path.join(H.vaultDir, 'bbb')), 'its bytes are under VAULT_DIR/aaa/, and bbb has none');
    // A trickle: aaa's owner says 9 MB, sends 4 KB, then a byte every five seconds. It holds no one's place for long.
    const trickle = (() => {
      const o = open(H, 'POST', `/api/modules/shelf/library?space=${a.space.id}&name=slow.pdf`, { cookie: a.owner, headers: { host: at('aaa'), 'content-type': 'application/pdf', 'content-length': String(9 * 1024 * 1024) } });
      const started = Date.now();
      let closedAt = null;
      o.req.on('close', () => { closedAt = Date.now(); });
      o.req.write(pdfSized(9 * 1024 * 1024).subarray(0, 4096));
      const drip = setInterval(() => { if (closedAt === null) o.req.write(' '); }, 5000);
      return { o, started, drip, closed: () => closedAt };
    })();
    await quiet(500);
    const pdf2 = pdfSized(2 * 1024 * 1024);
    const otherEnv = await hsend('POST', 'bbb', `/api/modules/shelf/library?space=${b.space.id}&name=b.pdf`, { cookie: b.owner, headers: { 'content-type': 'application/pdf' }, body: pdf2 });
    same(otherEnv.status, 201, `another environment is not held up by it, though the server's 10 MB would be full with it: ${otherEnv.text}`);
    const sameEnv = await hsend('POST', 'aaa', `/api/modules/shelf/library?space=${a.space.id}&name=a.pdf`, { cookie: a.host, headers: { 'content-type': 'application/pdf' }, body: pdf2 });
    // It holds at most half of what is free against anyone else (security QA round 2: a trickler kept everyone out).
    same(sameEnv.status, 201, `in its own environment, someone else's upload still fits beside it: ${sameEnv.text}`);
    same((await hsend('DELETE', 'aaa', `/api/modules/shelf/library/${sameEnv.json?.file?.id}?space=${a.space.id}`, { cookie: a.host })).status, 200, 'and is removed again');
    const bigOther = await hsend('POST', 'aaa', `/api/modules/shelf/library?space=${a.space.id}&name=big.pdf`, { cookie: a.host, headers: { 'content-type': 'application/pdf' }, body: pdfSized(6 * 1024 * 1024) });
    same([bigOther.status, bigOther.json?.error, bigOther.headers['retry-after']], [429, OTHERS_ARRIVING, '60'], 'one that needs more than the half left free is asked to try again in a minute');
    const path1 = `/api/modules/shelf/library/${fid}/content?space=${a.space.id}`;
    same((await hsend('GET', 'aaa', path1, { cookie: a.owner })).status, 200, 'aaa\'s owner reads it');
    same((await hsend('GET', 'bbb', path1, { cookie: a.owner })).status, 401, 'aaa\'s session at bbb is no session: 401');
    same((await hsend('GET', 'bbb', path1, { cookie: b.owner })).status, 404, 'bbb\'s owner, naming aaa\'s space: 404');
    same((await hsend('GET', 'bbb', `/api/modules/shelf/library/${fid}/content?space=${b.space.id}`, { cookie: b.owner })).status, 404, 'or their own space: 404');
    same((await hsend('GET', '', path1, { cookie: a.owner })).status, 404, 'the product host: 404');
    same((await hsend('GET', 'admin', path1, { cookie: a.owner, headers: { cookie: `${hostCookie}; app_session=${a.owner}` } })).status, 404, 'the host console: 404');
    same((await hsend('GET', 'nosuch', path1, { cookie: a.owner })).status, 404, 'an environment that is not there: 404');
    // The environment's own copy of its data carries the records, never the bytes.
    const zip = await hsend('GET', 'aaa', '/api/environment/export', { cookie: a.owner });
    ok(zip.status === 200 && zip.bytes.includes(Buffer.from(`modules/shelf/library/space-${a.space.id}.json`)) && !zip.bytes.includes(Buffer.from(`${fid}.bin`)), 'the export carries the records and not the bytes');
    // A hosted plan's storage cap counts the library's files (here, a cap already passed by what is kept).
    same((await hjson('PATCH', 'admin', '/api/host/environments/bbb', { plan: { storageBytes: 1024 } }, { headers: { cookie: hostCookie } })).status, 200, 'bbb gets a tiny storage cap');
    const capped = await hsend('POST', 'bbb', `/api/modules/shelf/library?space=${b.space.id}&name=a.pdf`, { cookie: b.owner, headers: { 'content-type': 'application/pdf' }, body: pdfOf() });
    same([capped.status, capped.json?.error], [413, 'This environment has used its 1 KB of storage.'], 'the plan\'s cap: 413, its size in words that fit it (not "0 GB")');
    // The trickle is cut off once a minute brought less than the floor (16 KB a second), and what it reserved is free.
    while (trickle.closed() === null && Date.now() - trickle.started < 90000) await quiet(250);
    clearInterval(trickle.drip);
    const cutAfter = trickle.closed() === null ? null : (trickle.closed() - trickle.started) / 1000;
    ok(cutAfter !== null && cutAfter >= 55 && cutAfter <= 75, `a trickled upload is cut off after its first minute (${cutAfter} s)`);
    memoryLines.push(`a trickle of a byte every 5 s on a 9 MB upload was cut off after ${cutAfter} s`);
    await quiet(300);
    same(partsUnder(H.vaultDir), [], 'and its part is removed');
    const after = await hsend('POST', 'aaa', `/api/modules/shelf/library?space=${a.space.id}&name=a.pdf`, { cookie: a.host, headers: { 'content-type': 'application/pdf' }, body: pdf2 });
    same(after.status, 201, `then the upload it held up goes: ${after.text}`);
    // Two environments' uploads at once: neither counts the other's when it starts, and the one that finishes past the
    // server's real total (10 MB, about 4 MB kept so far) is refused as it finishes.
    {
      same((await hjson('PATCH', 'admin', '/api/host/environments/bbb', { plan: { storageBytes: null } }, { headers: { cookie: hostCookie } })).status, 200, 'bbb\'s cap is lifted');
      const four = pdfSized(4 * 1024 * 1024);
      const ua = open(H, 'POST', `/api/modules/shelf/library?space=${a.space.id}&name=x.pdf`, { cookie: a.owner, headers: { host: at('aaa'), 'content-type': 'application/pdf', 'content-length': String(four.length) } });
      const ub = open(H, 'POST', `/api/modules/shelf/library?space=${b.space.id}&name=y.pdf`, { cookie: b.owner, headers: { host: at('bbb'), 'content-type': 'application/pdf', 'content-length': String(four.length) } });
      ua.req.write(four.subarray(0, 4096));
      ub.req.write(four.subarray(0, 4096));
      await quiet(300);
      ua.req.end(four.subarray(4096));
      const ra = await ua.answer;
      ub.req.end(four.subarray(4096));
      const rb = await ub.answer;
      same([ra.status, rb.status, rb.json?.error], [201, 413, 'The server\'s file storage is full. Ask the admin.'], 'both start; the second to finish past the real total is refused');
      await quiet(200);
      same(partsUnder(H.vaultDir), [], 'and its part is removed');
    }
    await H.stop();
  }

  // --- piece 7: the server's memory while 1 GB streams in, and while slow and stalled readers take it out --------------
  {
    const B = await startServer('b', {});
    servers.push(B);
    if (!fs.existsSync(`/proc/${B.pid}/status`)) {
      console.log('check-vault: no /proc here, so the memory checks are skipped');
    } else {
      const loginB = async (who, password) => (await send(B, 'POST', '/api/login', { headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ login: who, password })) })).json.token;
      const jsonB = (method, urlPath, cookie, value) => send(B, method, urlPath, { cookie, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) });
      const adminB = await loginB('admin', 'testpass1234');
      same((await send(B, 'POST', '/api/modules', { cookie: adminB, headers: { 'content-type': 'application/zip' }, body: shelfZip() })).status, 201, 'the module on a second server');
      await jsonB('PATCH', '/api/modules/shelf', adminB, { enabled: true, allSpaces: true });
      const sp = (await jsonB('POST', '/api/spaces', adminB, { name: 'Big' })).json.space;
      // The real files are all taken, each as its type (sent by a member, so the admin's minute is left for 1 GB).
      const cal = (await jsonB('POST', '/api/users', adminB, { login: 'cal', displayName: 'cal', role: 'member', password: 'memberpass1234' })).json.user;
      same((await jsonB('PATCH', `/api/spaces/${sp.id}`, adminB, { members: [cal.key] })).status, 200, 'a member in the space');
      const calB = await loginB('cal', 'memberpass1234');
      for (const [name, type] of Object.entries(CORPUS)) {
        const r = await send(B, 'POST', `/api/modules/shelf/library?space=${sp.id}&name=${name}`, { cookie: calB, headers: { 'content-type': 'application/octet-stream' }, body: fs.readFileSync(path.join(FIXTURES, name)) });
        same([r.status, r.json?.file?.type], [201, type], `a real ${name} is taken: ${r.text}`);
        same((await send(B, 'DELETE', `/api/modules/shelf/library/${r.json.file.id}?space=${sp.id}`, { cookie: calB })).status, 200, 'and removed again');
      }
      const mp4 = fs.readFileSync(path.join(FIXTURES, 'clip.mp4'));
      const poly = await send(B, 'POST', `/api/modules/shelf/library?space=${sp.id}&name=poly.mp4`, { cookie: calB, headers: { 'content-type': 'video/mp4' }, body: Buffer.concat([mp4.subarray(0, mp4.readUInt32BE(0)), Buffer.from([0, 0, 0, 8]), Buffer.from('free'), Buffer.from('<html><script>alert(1)</script></html>'.repeat(10))]) });
      same([poly.status, poly.json?.error], [400, 'That file is damaged or cut short.'], 'an MP4 start followed by a page is refused');
      // A 1 GB video, written a block at a time as the socket takes it: byte i is BLOCK[i % 1 MB].
      const SIZE = 1024 * 1024 * 1024;
      const BLOCK = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < BLOCK.length; i += 1) BLOCK[i] = (i * 7 + 3) % 251;
      ftypOf('isom', ['mp42']).copy(BLOCK, 0);
      const byteAt = (i) => BLOCK[i % BLOCK.length];
      let peak = 0;
      const sample = () => { peak = Math.max(peak, B.rss()); };
      await quiet(300);
      const before = B.rss();
      const timer = setInterval(sample, 25);
      const big = open(B, 'POST', `/api/modules/shelf/library?space=${sp.id}&name=long.mp4`, { cookie: adminB, headers: { 'content-type': 'video/mp4', 'content-length': String(SIZE) } });
      await writeAll(big, SIZE, BLOCK);
      big.req.end();
      const kept = await big.answer;
      clearInterval(timer);
      sample();
      same([kept.status, kept.json?.file?.size], [201, SIZE], `a 1 GB video is kept: ${JSON.stringify(kept.json)}`);
      memoryLines.push(`1 GB upload: ${Math.round(before)} MB before, ${Math.round(peak)} MB at most`);
      ok(peak - before < 150, `the server's memory stays flat while 1 GB streams in: ${Math.round(before)} MB before, ${Math.round(peak)} MB at most`);
      const fidB = kept.json.file.id;
      const url = `/api/modules/shelf/library/${fidB}/content?space=${sp.id}`;
      // A range deep in it.
      const deep = await send(B, 'GET', url, { cookie: adminB, headers: { range: 'bytes=700000000-700000099' } });
      same([deep.status, deep.bytes.equals(Buffer.from(Array.from({ length: 100 }, (_, k) => byteAt(700000000 + k))))], [206, true], 'a range 700 MB in: the right bytes');
      // Ten readers that never read, and one that reads about 0.6 MB a second: the server sends only as fast as each reads.
      peak = 0;
      const before2 = B.rss();
      const timer2 = setInterval(sample, 25);
      const stalled = [];
      for (let i = 0; i < 10; i += 1) {
        const req = http.request({ host: '127.0.0.1', port: B.port, path: url, headers: { cookie: `app_session=${adminB}` } });
        stalled.push(new Promise((resolve) => req.on('response', (res) => { res.pause(); resolve({ req, res }); })));
        req.end();
      }
      const held = await Promise.all(stalled);
      let slowBytes = 0;
      let slowOk = true;
      const slowReq = http.request({ host: '127.0.0.1', port: B.port, path: url, headers: { cookie: `app_session=${adminB}` } });
      const slowDone = new Promise((resolve) => {
        slowReq.on('response', (res) => {
          res.on('data', (c) => {
            for (let k = 0; k < c.length; k += 4099) if (c[k] !== byteAt(slowBytes + k)) slowOk = false;
            slowBytes += c.length;
            res.pause();
            setTimeout(() => res.resume(), 100 * Math.max(1, c.length / 65536));
          });
          res.on('close', resolve);
        });
      });
      slowReq.end();
      await quiet(4000);
      clearInterval(timer2);
      sample();
      ok(held.every((x) => x.res.statusCode === 200) && slowBytes > 0 && slowBytes < 64 * 1024 * 1024 && slowOk, `a slow reader gets the right bytes at its own pace (${Math.round(slowBytes / 1048576)} MB in 4 seconds)`);
      memoryLines.push(`10 stalled readers and a slow one: ${Math.round(before2)} MB before, ${Math.round(peak)} MB at most, the slow one read ${Math.round(slowBytes / 1048576)} MB in 4 s`);
      ok(peak - before2 < 100, `ten stalled readers and a slow one keep the server's memory flat: ${Math.round(before2)} MB before, ${Math.round(peak)} MB at most`);
      for (const x of held) x.req.destroy();
      slowReq.destroy();
      await slowDone;
      // Cut off half way through 1 GB: the part goes.
      const cut = open(B, 'POST', `/api/modules/shelf/library?space=${sp.id}&name=cut.mp4`, { cookie: adminB, headers: { 'content-type': 'video/mp4', 'content-length': String(SIZE) } });
      await writeAll(cut, 64 * BLOCK.length, BLOCK);
      cut.req.destroy();
      await cut.answer;
      await quiet(500);
      same(partsUnder(B.vaultDir), [], 'a 1 GB upload cut off part way leaves no part');
      same((await send(B, 'GET', `/api/modules/shelf/library?space=${sp.id}`, { cookie: adminB })).json.files.map((f) => f.name), ['long.mp4'], 'and no file');
    }
    await B.stop();
  }
} catch (err) {
  failed = true;
  console.error(err);
  for (const s of servers) console.error(`--- server output ---\n${s.out().slice(-3000)}`);
} finally {
  for (const s of servers) await s.stop();
  fs.rmSync(base, { recursive: true, force: true });
}
if (failed) process.exit(1);

for (const line of memoryLines) console.log(`check-vault: ${line}`);
console.log(`check-vault: ${n} checks OK`);
