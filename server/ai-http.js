// The one way the server talks to an AI service (server/ai.js): a plain HTTP(S) request with a time limit, a size limit and no
// redirects. On a host with environments (BASE_DOMAIN) an environment owner types the address, so there the request is also
// guarded: https only, and never to a private, loopback, link-local or metadata address. The address is checked when the
// connection is made (on the resolved address, not on the name), so a name that points inside after it was saved is refused too.
'use strict';

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

// What a request failed with, in a word, so the caller picks a plain sentence and the detail only goes to the log.
class AiNetError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = code; // 'blocked', 'redirect', 'timeout', 'toolarge', 'network'
  }
}

const blocked = new net.BlockList();
for (const [net4, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(net4, bits, 'ipv4');
// ::/96 (unspecified and the old IPv4-compatible form, ::7f00:1), local NAT64 64:ff9b:1::/48 and Teredo 2001::/32 can all
// reach a private IPv4 address, so they are refused whole.
for (const [net6, bits] of [['::', 96], ['::1', 128], ['64:ff9b:1::', 48], ['2001::', 32], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64]]) blocked.addSubnet(net6, bits, 'ipv6');

// The IPv4 address inside an IPv6 one that carries it (::ffff:a.b.c.d, 64:ff9b::/96, 6to4 2002::/16), or ''.
function embeddedV4(ip) {
  const groups = expandV6(ip);
  if (!groups) return '';
  const v4 = (a, b) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return v4(groups[6], groups[7]);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) return v4(groups[6], groups[7]);
  if (groups[0] === 0x2002) return v4(groups[1], groups[2]);
  return '';
}
// An IPv6 address as eight 16-bit numbers, or null.
function expandV6(ip) {
  let s = String(ip).split('%')[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const p = tail[1].split('.').map(Number);
    if (p.length !== 4 || p.some((x) => !(x >= 0 && x <= 255))) return null;
    s = s.slice(0, -tail[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const all = halves.length === 1 ? head : [...head, ...Array(fill).fill('0'), ...rest];
  const nums = all.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((x) => Number.isFinite(x)) ? nums : null;
}

// Whether an address (a literal IP) is one a hosted environment may not make the server call. Anything that is not an IP is refused.
function isPrivateAddress(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return blocked.check(ip, 'ipv4');
  if (kind === 6) {
    if (blocked.check(ip, 'ipv6')) return true;
    const inner = embeddedV4(ip);
    return inner ? blocked.check(inner, 'ipv4') : false;
  }
  return true;
}

// The options a guarded request is made with, from the environment variables: a host leaves both unset; a developer running
// the host on one machine sets them. null when the request is not guarded (a single-environment install).
function guardFrom(env, hosted) {
  if (!hosted) return null;
  return { allowHttp: env.AI_ALLOW_HTTP === '1', allowPrivate: env.AI_ALLOW_PRIVATE_ADDRESSES === '1' };
}

// Throws AiNetError('blocked') when this address may not be called under the guard. Needs no network when the host is a literal
// IP; a name is resolved here and checked again on the connection itself (see request()).
async function assertAddressAllowed(address, guard) {
  if (!guard) return;
  let u;
  try { u = new URL(address); } catch { throw new AiNetError('blocked', 'not an address'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && guard.allowHttp)) throw new AiNetError('blocked', 'https only');
  if (guard.allowPrivate) return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new AiNetError('blocked', 'private address');
    return;
  }
  let found;
  try { found = await dns.promises.lookup(host, { all: true }); } catch { throw new AiNetError('blocked', 'name does not resolve'); }
  if (!found.length || found.some((a) => isPrivateAddress(a.address))) throw new AiNetError('blocked', 'private address');
}

// A lookup that refuses a name resolving to a private address, for the connection itself.
function guardedLookup(hostname, options, callback) {
  const opts = typeof options === 'function' ? {} : options || {};
  const cb = typeof options === 'function' ? options : callback;
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) return cb(new AiNetError('blocked', 'private address'));
    if (opts.all) return cb(null, addresses);
    return cb(null, addresses[0].address, addresses[0].family);
  });
}

// One request: { status, text }. Never follows a redirect (a 3xx is a 'redirect' failure), stops at `maxBytes` of answer and at
// `timeoutMs` in all, and with a `guard` refuses a private address or plain http first.
async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 15000, maxBytes = 1024 * 1024, guard = null } = {}) {
  await assertAddressAllowed(url, guard);
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let done = false;
    let answered = false; // the service began its answer (a status line came back): it may have done, and billed, the work
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (value instanceof AiNetError) value.answered = answered;
      fn(value);
    };
    const opts = { method, headers: { ...headers, ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, ...(guard && !guard.allowPrivate ? { lookup: guardedLookup } : {}) };
    const req = lib.request(u, opts, (res) => {
      answered = true;
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); req.destroy(); return finish(reject, new AiNetError('redirect', `redirect ${res.statusCode}`)); }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); return finish(reject, new AiNetError('toolarge')); }
        chunks.push(c);
      });
      res.on('end', () => finish(resolve, { status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', (err) => finish(reject, new AiNetError('network', err.message)));
    });
    const timer = setTimeout(() => { req.destroy(); finish(reject, new AiNetError('timeout')); }, timeoutMs);
    if (timer.unref) timer.unref();
    req.on('error', (err) => finish(reject, err instanceof AiNetError ? err : err && err.cause instanceof AiNetError ? err.cause : new AiNetError('network', `${err.code || err.name}: ${err.message}`)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

module.exports = { AiNetError, guardedLookup, request, isPrivateAddress, assertAddressAllowed, guardFrom };
