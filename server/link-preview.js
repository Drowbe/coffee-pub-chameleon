'use strict';

// Read a page's title, description and image for a link someone is adding.
// The fetch is the dangerous part: the address is whatever they typed, so it is resolved first and a private,
// loopback or link-local address is refused, including after a redirect. Nothing here names a module.

const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const tls = require('tls');
const { userAgent } = require('./product-name');

const MAX_BYTES = 262144;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000;

class PreviewError extends Error {
  // `code` says which kind of refusal it is, for a caller that words it its own way (fetchCalendar's callers):
  // blocked, missing, timeout, unreachable, wrong, status, big, type, redirects.
  constructor(message, code = null) {
    super(message);
    this.name = 'PreviewError';
    this.code = code;
  }
}

// An IPv6 address as its eight 16-bit groups, or null. Takes "::" shortening, a dotted IPv4 tail and a zone ("%eth0").
function ipv6Groups(ip) {
  let text = String(ip || '').toLowerCase().replace(/%.*$/, '');
  if (net.isIP(text) !== 6) return null;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const b = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const part = (h) => (h ? h.split(':') : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}
const ipv4Of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

// This machine's own addresses, on every interface, as the same text blockedAddress compares (IPv6 as its groups): a
// page can't be read from the server itself, whatever range its address is in. Read again at most once a minute.
const OWN_ADDRESSES_MS = 60 * 1000;
let ownAddresses = { at: 0, set: new Set() };
const addressText = (ip) => {
  const plainIp = String(ip || '').toLowerCase().replace(/%.*$/, '');
  if (net.isIP(plainIp) !== 6) return plainIp;
  const g = ipv6Groups(plainIp);
  return g ? g.join(':') : plainIp;
};
function ownAddress(ip) {
  if (Date.now() - ownAddresses.at > OWN_ADDRESSES_MS) {
    const set = new Set();
    try {
      for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) set.add(addressText(a.address));
    } catch { /* no interfaces to read: the ranges below still hold */ }
    ownAddresses = { at: Date.now(), set };
  }
  return ownAddresses.set.has(addressText(ip));
}

function blockedAddress(ip) {
  const kind = net.isIP(String(ip || '').replace(/%.*$/, ''));
  if (kind && ownAddress(ip)) return true;
  if (kind === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    // Special use: IETF protocol assignments, the three documentation ranges (TEST-NET-1, -2, -3), the 6to4 relay and
    // benchmarking. None is a public page; a machine may still sit on one (a container on 192.0.2.0/24).
    if (p[0] === 192 && p[1] === 0 && (p[2] === 0 || p[2] === 2)) return true;
    if (p[0] === 192 && p[1] === 88 && p[2] === 99) return true;
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
    if (p[0] === 198 && p[1] === 51 && p[2] === 100) return true;
    if (p[0] === 203 && p[1] === 0 && p[2] === 113) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  if (kind === 6) {
    // Read as its 16 bytes, so every way of writing one address is judged alike (::ffff:127.0.0.1 is ::ffff:7f00:1).
    const g = ipv6Groups(ip);
    if (!g) return true;
    const zero = (from, to) => g.slice(from, to).every((x) => x === 0);
    if (zero(0, 6)) return true; // ::, ::1 and the IPv4-compatible ::/96
    if (zero(0, 5) && g[5] === 0xffff) return blockedAddress(ipv4Of(g[6], g[7])); // IPv4-mapped ::ffff:0:0/96
    if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return true; // IPv4-translated ::ffff:0:0:0/96
    if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64, 64:ff9b::/96 and 64:ff9b:1::/48
    if (g[0] === 0x100 && zero(1, 4)) return true; // discard-only 100::/64
    if (g[0] === 0x2001 && g[1] < 0x200) return true; // 2001::/23: Teredo, ORCHID and other special use
    if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
    if (g[0] === 0x2002) return true; // 6to4, which carries an IPv4 address inside
    if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local and the old site-local
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  return true;
}

function blockedName(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  // An IPv6 address written in the address itself ("[::1]") is refused outright: a page or a calendar has a name.
  if (h.startsWith('[') || h.includes(':')) return true;
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return true;
  return false;
}

function pageUrl(text) {
  let u;
  try { u = new URL(String(text || '').trim()); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
  if (blockedName(u.hostname)) return null;
  return u;
}
// A web page's or a picture's address for a preview: as pageUrl, and only on the web's own ports (80 and 443, or none
// given), so a preview can't be used to knock on a machine's other services. Null otherwise.
const WEB_PORTS = ['', '80', '443'];
function previewUrl(text) {
  const u = pageUrl(text);
  return u && WEB_PORTS.includes(u.port) ? u : null;
}

async function publicAddresses(hostname) {
  if (net.isIP(hostname) === 4) {
    if (blockedAddress(hostname)) throw new PreviewError('that address is not allowed', 'blocked');
    return [hostname];
  }
  if (blockedName(hostname)) throw new PreviewError('that address is not allowed', 'blocked');
  let records;
  try { records = await dns.lookup(hostname, { all: true, verbatim: true }); } catch { throw new PreviewError('that address could not be found', 'missing'); }
  const addresses = records.map((r) => r.address);
  if (!addresses.length || addresses.some(blockedAddress)) throw new PreviewError('that address is not allowed', 'blocked');
  return addresses;
}

// One GET to an address already checked. `timeoutMs` is how long the connection may sit idle; `deadline` (a time in
// milliseconds), when given, is when the whole request is given up, however much is still arriving.
function getOnce(target, addresses, maxBytes, accept, { timeoutMs = TIMEOUT_MS, deadline = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = target.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    const onSocketError = (err) => fail(err instanceof PreviewError ? err : new PreviewError('that page could not be read', err && err.code === 'timeout' ? 'timeout' : 'unreachable'));
    let req;
    try {
      req = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: { 'user-agent': userAgent(), accept: accept || 'text/html,application/xhtml+xml' },
      timeout: timeoutMs,
      // The connection is made here, with its error listener on before it connects: a socket that fails at once (an
      // address family this machine lacks, a TLS failure) is this request failing, never an error nobody hears,
      // which would stop the server. (No agent: with one, Node makes its own socket and this is not used.)
      createConnection: (opts) => {
        const name = target.hostname;
        const socket = target.protocol === 'https:' ? tls.connect({ ...opts, ...(net.isIP(name) || name.startsWith('[') ? {} : { servername: name }) }) : net.connect(opts);
        socket.on('error', onSocketError);
        return socket;
      },
      // The addresses already checked, never a second lookup. A connect that fails at once (an address family this
      // machine lacks) throws from inside this callback, so it is caught here and becomes this request failing.
      lookup: (_hostname, opts, cb) => {
        const list = addresses.map((address) => ({ address, family: net.isIP(address) }));
        try {
          if (opts && opts.all) cb(null, list);
          else cb(null, list[0].address, list[0].family);
        } catch {
          fail(new PreviewError('that page could not be read', 'unreachable'));
          if (req) req.destroy();
        }
      },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('error', (err) => fail(err instanceof PreviewError ? err : new PreviewError('that page could not be read', 'unreachable')));
      res.on('aborted', () => fail(new PreviewError('that page could not be read', 'unreachable')));
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy();
          done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), cut: true });
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), cut: false }));
    });
    } catch {
      fail(new PreviewError('that page could not be read', 'unreachable'));
      return;
    }
    // Too long, idle or in all: that is the answer, settled before the request is torn down (whose own errors come after).
    const tooLong = () => {
      const err = new PreviewError('that page took too long', 'timeout');
      fail(err);
      req.destroy(err);
    };
    let late = null;
    if (deadline) {
      late = setTimeout(tooLong, Math.max(1, deadline - Date.now()));
      if (late.unref) late.unref();
    }
    req.on('close', () => { if (late) clearTimeout(late); });
    req.on('timeout', tooLong);
    // A refusal of our own (too long) is passed on as it is; anything else the network says is "could not be read".
    req.on('error', (err) => fail(err instanceof PreviewError ? err : new PreviewError('that page could not be read', err && err.code === 'timeout' ? 'timeout' : 'unreachable')));
    req.end();
  });
}

function decode(text) {
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, ent) => {
    const e = ent.toLowerCase();
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    if (e === 'nbsp') return ' ';
    const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
  });
}

function plain(text, n) {
  return decode(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

function metaContent(html, which) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const prop = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (prop === which) return attr(tag, 'content');
  }
  return '';
}

// An image address the page named, or ''. Resolved against the final page address. A private or local host is dropped.
function absoluteImage(raw, base) {
  const text = decode(String(raw || '')).trim();
  if (!text) return '';
  try {
    const u = new URL(text, base);
    const ip = net.isIP(u.hostname) ? u.hostname : '';
    if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && WEB_PORTS.includes(u.port) && !blockedName(u.hostname) && !(ip && blockedAddress(ip)) && u.href.length <= 2000) return u.href;
  } catch { /* not an address */ }
  return '';
}

// The kinds of thing a page is about. A logo on the site or a picture of the author is not one of these.
const SUBJECT_TYPES = new Set([
  'article', 'newsarticle', 'blogposting', 'report', 'scholarlyarticle', 'techarticle', 'socialmediaposting',
  'product', 'productgroup',
  'place', 'localbusiness', 'restaurant', 'hotel', 'touristattraction', 'touristtrip', 'event', 'recipe',
  'lodgingbusiness', 'accommodation', 'landmarksorhistoricalbuildings', 'airport', 'civicstructure',
]);

function typeNames(node) {
  const raw = node && node['@type'];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((t) => typeof t === 'string').map((t) => t.toLowerCase().split('/').pop());
}

function ldNodes(html) {
  const nodes = [];
  const scripts = String(html || '').matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    const raw = script[1].trim();
    if (!raw) continue;
    let data = null;
    try { data = JSON.parse(raw); } catch { try { data = JSON.parse(decode(raw)); } catch { data = null; } }
    collectNodes(data, nodes);
  }
  return nodes;
}

function collectNodes(data, nodes) {
  if (Array.isArray(data)) { for (const one of data) collectNodes(one, nodes); return; }
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data['@graph'])) { collectNodes(data['@graph'], nodes); return; }
  nodes.push(data);
}

function nodesById(nodes) {
  const map = new Map();
  for (const node of nodes) if (typeof node['@id'] === 'string') map.set(node['@id'], node);
  return map;
}

// A string, a list, or an ImageObject. An @id that names another block is followed once.
function firstImage(value, base, byId, seen) {
  if (value == null) return '';
  if (typeof value === 'string') return absoluteImage(value, base);
  if (Array.isArray(value)) {
    for (const one of value) {
      const got = firstImage(one, base, byId, seen);
      if (got) return got;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const direct = absoluteImage(value.url || value.contentUrl || '', base);
  if (direct) return direct;
  const id = value['@id'];
  if (typeof id !== 'string' || !byId || seen?.has(id)) return absoluteImage(id, base);
  const node = byId.get(id);
  if (!node) return absoluteImage(id, base);
  const next = new Set(seen || []);
  next.add(id);
  return firstImage(node.url || node.contentUrl || node.image, base, byId, next);
}

function resolveNode(value, byId) {
  if (typeof value === 'string') return byId.get(value) || null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = value['@id'];
  const pointed = typeof id === 'string' ? byId.get(id) : null;
  if (pointed && !value.image && !value.url && !value.contentUrl) return pointed;
  return value;
}

// The picture the page names for itself, the way a search result does: primaryImageOfPage, then the picture on
// the main thing (an article, a product, a place), before the share tags.
function schemaImage(html, base) {
  const nodes = ldNodes(html);
  if (!nodes.length) return '';
  const byId = nodesById(nodes);
  for (const node of nodes) {
    const got = firstImage(node.primaryImageOfPage, base, byId);
    if (got) return got;
  }
  for (const node of nodes) {
    const main = node.mainEntity;
    const target = Array.isArray(main) ? resolveNode(main[0], byId) : resolveNode(main, byId);
    const got = target ? firstImage(target.image, base, byId) : '';
    if (got) return got;
  }
  for (const node of nodes) {
    if (!node.mainEntityOfPage) continue;
    const got = firstImage(node.image, base, byId);
    if (got) return got;
  }
  for (const node of nodes) {
    if (!typeNames(node).some((name) => SUBJECT_TYPES.has(name))) continue;
    const got = firstImage(node.image, base, byId);
    if (got) return got;
  }
  return '';
}

// Title, description and image from a page's HTML. The image address is resolved against the final page address.
function readPreview(html, base) {
  const text = String(html || '');
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  const title = plain(metaContent(text, 'og:title') || (titleTag && titleTag[1]) || '', 120);
  const description = plain(metaContent(text, 'og:description') || metaContent(text, 'description') || '', 2000);
  const image = schemaImage(text, base) || absoluteImage(metaContent(text, 'og:image') || metaContent(text, 'twitter:image'), base);
  return { title, description, image };
}

// The whole of one preview or one picture, redirects included, is given up after this.
const PREVIEW_DEADLINE_MS = 10000;

// Why an address typed for a preview is refused, as a sentence: not a web address, or one that isn't allowed.
function previewRefusal(text) {
  const u = pageUrl(text);
  if (!u) {
    let parsed = null;
    try { parsed = new URL(String(text || '').trim()); } catch { /* not an address */ }
    return parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password ? 'that address is not allowed' : 'give a web address that starts with https:// or http://';
  }
  return 'that address is not allowed';
}

async function fetchPreview(text) {
  let current = previewUrl(text);
  if (!current) throw new PreviewError(previewRefusal(text), 'blocked');
  const deadline = Date.now() + PREVIEW_DEADLINE_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const addresses = await publicAddresses(current.hostname);
    if (Date.now() >= deadline) throw new PreviewError('that page took too long', 'timeout');
    const res = await getOnce(current, addresses, MAX_BYTES, undefined, { deadline });
    const status = res.status || 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      if (hop === MAX_REDIRECTS) throw new PreviewError('that page could not be read');
      let next;
      try { next = new URL(res.headers.location, current); } catch { throw new PreviewError('that page could not be read'); }
      current = previewUrl(next.href);
      if (!current) throw new PreviewError('that address is not allowed');
      continue;
    }
    if (status < 200 || status >= 300) throw new PreviewError('that page could not be read');
    const type = String(res.headers['content-type'] || '');
    const body = res.body.toString('utf8');
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new PreviewError('that page is not text');
    if (!type && !/<\s*(!doctype|html|head|title|meta)\b/i.test(body)) throw new PreviewError('that page is not text');
    const preview = readPreview(body, current.href);
    if (preview.image) {
      try { await publicAddresses(new URL(preview.image).hostname); } catch { preview.image = ''; }
    }
    return preview;
  }
  throw new PreviewError('that page could not be read');
}

const IMAGE_BYTES = 1048576;
const IMAGE_CACHE_MS = 10 * 60 * 1000;
const IMAGE_CACHE_MAX = 40;
const imageCache = new Map();

function imageType(buf, header) {
  const type = String(header || '').split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' || type === 'image/gif') return type;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length >= 6 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

// A picture already read for this address, or null. The card asks again for every view, so a repeat is not fetched twice.
function cachedImage(text) {
  const target = pageUrl(text);
  if (!target || target.href.length > 2000) return null;
  const hit = imageCache.get(target.href);
  if (!hit || Date.now() - hit.at > IMAGE_CACHE_MS) return null;
  return hit;
}

// The picture itself, fetched here so the card does not ask the other site (many refuse that). Same address rules as the page.
async function fetchImage(text) {
  const hit = cachedImage(text);
  if (hit) return hit;
  let current = previewUrl(text);
  if (!current || current.href.length > 2000) throw new PreviewError('that address is not allowed', 'blocked');
  const asked = current.href;
  const deadline = Date.now() + PREVIEW_DEADLINE_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const addresses = await publicAddresses(current.hostname);
    if (Date.now() >= deadline) throw new PreviewError('that picture took too long', 'timeout');
    const res = await getOnce(current, addresses, IMAGE_BYTES, 'image/webp,image/png,image/jpeg,image/gif', { deadline });
    const status = res.status || 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      if (hop === MAX_REDIRECTS) throw new PreviewError('that picture could not be read');
      let next;
      try { next = new URL(res.headers.location, current); } catch { throw new PreviewError('that picture could not be read'); }
      current = previewUrl(next.href);
      if (!current) throw new PreviewError('that address is not allowed');
      continue;
    }
    if (status < 200 || status >= 300 || res.cut) throw new PreviewError('that picture could not be read');
    const type = imageType(res.body, res.headers['content-type']);
    if (!type) throw new PreviewError('that picture could not be read');
    const stored = { type, body: res.body, at: Date.now() };
    if (imageCache.size >= IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(asked, stored);
    return stored;
  }
  throw new PreviewError('that picture could not be read');
}

// --- a calendar file (plan-google-calendar.md, Part 2: a person's other calendars) -----------------------------------
// The same guard as a page: the host resolved first, a private, loopback or link-local address refused, also after a
// redirect. Only https (a pasted webcal: address is made https by the caller), 5 MB, 15 seconds for the whole read.
const CALENDAR_BYTES = 5 * 1048576;
const CALENDAR_TIMEOUT_MS = 15000;

// A calendar address as it may be read: https, no user or password, not a local name. Null otherwise.
function calendarUrl(text) {
  const u = pageUrl(text);
  return u && u.protocol === 'https:' && u.href.length <= 2000 ? u : null;
}

// The calendar file's text. Throws a PreviewError with a `code` saying why it could not be read.
async function fetchCalendar(text) {
  let current = calendarUrl(text);
  if (!current) throw new PreviewError('that address is not allowed', 'blocked');
  const deadline = Date.now() + CALENDAR_TIMEOUT_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const addresses = await publicAddresses(current.hostname);
    if (Date.now() >= deadline) throw new PreviewError('that calendar took too long', 'timeout');
    const res = await getOnce(current, addresses, CALENDAR_BYTES, 'text/calendar, text/plain;q=0.5, */*;q=0.1', { timeoutMs: CALENDAR_TIMEOUT_MS, deadline });
    const status = res.status || 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      if (hop === MAX_REDIRECTS) throw new PreviewError('that calendar was sent elsewhere too many times', 'redirects');
      let next;
      try { next = new URL(res.headers.location, current); } catch { throw new PreviewError('that calendar could not be read', 'status'); }
      current = calendarUrl(next.href);
      if (!current) throw new PreviewError('that address is not allowed', 'blocked');
      continue;
    }
    if (status === 401 || status === 403 || status === 404 || status === 410) throw new PreviewError('that calendar address is wrong', 'wrong');
    if (status < 200 || status >= 300) throw new PreviewError('that calendar could not be read', 'status');
    if (res.cut) throw new PreviewError('that calendar is too large', 'big');
    const body = res.body.toString('utf8');
    if (!/^\s*BEGIN:VCALENDAR/i.test(body.replace(/^\uFEFF/, ''))) throw new PreviewError('that address did not give a calendar', 'type');
    return body;
  }
  throw new PreviewError('that calendar was sent elsewhere too many times', 'redirects');
}

// getOnce is exported for tools/check-link-preview.mjs only (the request it sends, to an address already checked).
module.exports = { PreviewError, blockedAddress, blockedName, previewUrl, PREVIEW_DEADLINE_MS, readPreview, fetchPreview, fetchImage, cachedImage, getOnce, fetchCalendar, calendarUrl, CALENDAR_BYTES, CALENDAR_TIMEOUT_MS };
