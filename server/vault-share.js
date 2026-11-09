// Share links for a library module's files (documentation/plans/plan-attachments-vault.md, sections 7 and 12, step 5).
// The records are kept by server/vault-store.js (createShare, findShareByToken...); this file holds the routes.
//
// --- The seam, for the share sheet, the list of share links and the public page -----------------------------------------
// Signed in (the Vault's own frame; `:id` is the module's id, `?space=` the space), each needs the module's `share`
// permission (owners and moderators by default; never a guest pass or the access key). JSON bodies.
//   GET    /api/modules/:id/library/shares?space=          200 { shares: [share] }  (ended ones are gone from the list)
//   POST   /api/modules/:id/library/shares?space=          { name, files: [fid], days: 1|7|30, download?: bool, password?: string }
//                                                           201 { share, token, url: "/shared/<token>" }  (the token only here, once)
//   PATCH  /api/modules/:id/library/shares/:sid?space=     { name?, files? }  its maker or an owner; 200 { share }
//   DELETE /api/modules/:id/library/shares/:sid?space=     Turn off (its maker, an owner or a moderator of the space); 200 { ok: true }
//   share: { id, name, files: [fid], by: <person key>, at, ends, download, hasPassword, opened }  (`opened`: how many times
//   its list was read; no address or person is kept). `files` holds only the files the person asking may see
//   (plan-vault-privacy.md); a file they can't see, named in POST or PATCH, is refused as one that is not there. A share
//   whose files are all hidden from them answers as not there (404), except that its maker still lists it (its `files`
//   then empty) and may turn it off. GET /api/modules/:id/library adds `shared: true|false` to each file
//   for someone with `share` only.
// Public (no session; a session cookie that comes along is never read; on a hosted install only on the environment's own
// host, where only that environment's links open):
//   GET  /shared/<token>                    the page (public/shared.html), the same page for every token, good or not
//   GET  /api/shared/<token>                200 { name, by: <first name>, ends, download, files: [file] }
//                                           401 { error: "This link needs its password.", password: true }
//                                           404 { error: "This link has ended.", ended: true }  for an unknown, wrong,
//                                               ended, turned off or emptied link, the Vault turned off or the space gone
//                                           429 { error: "Too many tries. Wait a few minutes." }  (Retry-After)
//      file: { id, name, type, group, size, hasThumb, viewable?: false, content: <url>, thumb?: <url>, download?: <url> }
//            or { id, removed: true } for a file of the set no longer there ("File removed")
//   POST /api/shared/<token>/unlock         { password }  200 { ok: true } and the cookie; 401 { error: "That password isn't right." };
//                                           404 ended; 429 too many tries
//   GET  /api/shared/<token>/files/<fid>/content[?download=1]   the bytes, with ranges (206, 416), as the library sends them
//   GET  /api/shared/<token>/files/<fid>/thumb                  the small picture
//      404 { error: "There is no such file." } for a file outside the set, a download the link doesn't allow, a missing
//      thumbnail; 404 { error: "This PDF can't be opened here. Download it." } (or "...here." when download is off) for a
//      PDF kept as download only asked inline; 401 locked; 404 ended; 429 { error: "Too many files are open at once. Close some and try again." }
// The password cookie: `share_unlock`, HttpOnly, SameSite=Strict, Secure on https, Path=/api/shared/<token> (so it goes
// only with that link's own requests), Max-Age one hour or to the link's end if sooner; signed with the environment's
// secret over the link, its token's hash and its end. The page sends nothing itself: fetch() from the page carries it.
// A PDF reaches the page's viewer (/viewer/pdf, framed sandboxed) as bytes the page fetched and handed over.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { cleanName } = require('./vault-store');

const ENDED = 'This link has ended.';
const LOCKED = 'This link needs its password.';
const WRONG_PASSWORD = 'That password isn\'t right.';
const TOO_MANY = 'Too many tries. Wait a few minutes.';
const NO_SUCH_FILE = 'There is no such file.';
const NO_SUCH_SHARE = 'There is no such share link.';
const PDF_DOWNLOAD_ONLY = 'This PDF can\'t be opened here. Download it.';
const PDF_NOT_HERE = 'This PDF can\'t be opened here.';
const BUSY = 'Too many files are open at once. Close some and try again.';
const COOKIE = 'share_unlock';
const UNLOCK_MS = 60 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const WINDOW_MS = 15 * 60 * 1000;
// Wrong passwords: five per link and address in fifteen minutes (the plan), thirty per link from anywhere, twenty per
// address across links. Lookups of links that don't open: a hundred per address in fifteen minutes.
const TRIES = { linkAddress: 5, link: 30, address: 20, misses: 100 };
const STREAMS_PER_ADDRESS = 12;
// Password checks on the public path run on libuv's threads, never blocking: at most this many at once across the
// server, this many waiting, and this many unlocks a minute for one environment.
const SCRYPT_AT_ONCE = 2;
const SCRYPT_WAITING = 50;
const UNLOCKS_PER_MINUTE = Math.max(1, Number(process.env.SHARE_UNLOCKS_PER_MINUTE) || 60);

// The page's own headers: no framing, no referrer, not indexed, not kept, and a CSP with this site's own files only (its
// scripts, styles, fonts and the share's pictures and media; /viewer/pdf framed for a PDF; nothing from anywhere else).
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': PAGE_CSP,
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
// Every public answer's headers, the JSON ones and the files alike.
const API_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

// Counts in a window, bounded however many keys come: past `max` the oldest go. A window whose keys can't be made up by
// a stranger (the links that exist) takes Infinity, so nobody can push its counts out.
class Window {
  constructor(ms, max = 10000) { this.ms = ms; this.max = max; this.hits = new Map(); }
  count(key) {
    const e = this.hits.get(key);
    if (!e || Date.now() - e.first > this.ms) return 0;
    return e.n;
  }
  add(key) {
    const now = Date.now();
    const e = this.hits.get(key);
    if (!e || now - e.first > this.ms) { this.hits.delete(key); this.hits.set(key, { first: now, n: 1 }); } else e.n += 1;
    if (this.hits.size > this.max) for (const k of this.hits.keys()) { if (this.hits.size <= this.max) break; this.hits.delete(k); }
    return this.hits.get(key).n;
  }
  clear(key) { this.hits.delete(key); }
  // One count taken back (a try that was right).
  sub(key) { const e = this.hits.get(key); if (e && e.n > 1) e.n -= 1; else this.hits.delete(key); }
  // Seconds until the window of `key` ends.
  left(key) {
    const e = this.hits.get(key);
    return e ? Math.max(1, Math.ceil((e.first + this.ms - Date.now()) / 1000)) : 1;
  }
}

// scrypt as server/auth.js makes it, off the main thread and queued: true or false, or null when too many wait.
const scryptQueue = [];
let scryptRunning = 0;
function checkPassword(password, stored) {
  return new Promise((resolve) => {
    const [kind, salt, hash] = String(stored).split('$');
    if (kind !== 'scrypt' || !salt || !hash) return resolve(false);
    if (scryptQueue.length >= SCRYPT_WAITING) return resolve(null);
    scryptQueue.push({ password, salt, hash, resolve });
    pump();
  });
}
function pump() {
  while (scryptRunning < SCRYPT_AT_ONCE && scryptQueue.length) {
    const job = scryptQueue.shift();
    scryptRunning += 1;
    crypto.scrypt(String(job.password), job.salt, 32, (err, key) => {
      scryptRunning -= 1;
      const expected = Buffer.from(job.hash, 'hex');
      job.resolve(!err && key.length === expected.length && crypto.timingSafeEqual(key, expected));
      pump();
    });
  }
}

function mountVaultShares(app, deps) {
  const { express, vault, modules, store, auth, word, libraryAccess, libraryHeaders, dropUploadBody, noteActivity, slugOf, sharePage, makerCan } = deps;
  const tries = new Window(WINDOW_MS); // wrong passwords per address, and per link and address
  const linkTries = new Window(WINDOW_MS, Infinity); // per link: its keys are the links that exist, so it can't be pushed out
  const unlocks = new Window(60 * 1000); // unlocks a minute per environment
  const misses = new Window(WINDOW_MS);
  const streams = new Map(); // "<slug>|<address>" -> open streams
  setInterval(() => {
    for (const w of [tries, linkTries, unlocks, misses]) for (const [k, e] of w.hits) if (Date.now() - e.first > w.ms) w.hits.delete(k);
  }, 60000).unref();

  // --- signed in: make, list, change and turn off ------------------------------------------------------------------
  const refuseShare = (res, err) => {
    if (err && err.status && err.message) return res.status(err.status).json({ error: err.message });
    console.error(`A share link could not be saved: ${err && err.message}`);
    return res.status(500).json({ error: 'The share link could not be saved. Try again, or ask the admin if it keeps happening.' });
  };
  // The access check before any of the body is read, then the small JSON body.
  const shareAccess = (req, res, next) => {
    const ctx = libraryAccess(req, res, 'share');
    if (!ctx) return dropUploadBody(req);
    req.shareCtx = ctx;
    next();
  };
  const smallJson = express.json({ limit: '64kb' });
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

  const mayTurnOff = (ctx, s) => s.by === ctx.by || ctx.owner || ctx.moderator;
  // A share as this person is shown it: without the ids of files hidden from them (ctx.sees, the library's one rule).
  // A share whose files are all hidden from this person is not theirs to see, change or turn off: it answers as one that is not there.
  // Its maker is the exception for seeing and turning it off: they made it, so it tells them nothing, and a file narrowed
  // after they made the link must not leave them unable to end it. Its `files` still holds only the files they can see.
  const shareHidden = (ctx, s) => s.files.length > 0 && s.files.every((fid) => { const r = vault.get(ctx.manifest.id, ctx.spaceId, fid); return Boolean(r) && !ctx.sees(r); });
  const ownShare = (ctx, s) => s.by === ctx.by;
  const seenShare = (ctx, s) => ({ ...s, files: s.files.filter((fid) => ctx.sees(vault.get(ctx.manifest.id, ctx.spaceId, fid))) });

  app.get('/api/modules/:id/library/shares', (req, res) => {
    const ctx = libraryAccess(req, res, 'share');
    if (!ctx) return;
    // `canTurnOff`: this person may turn that link off (its maker, an owner or this space's moderator).
    res.json({ shares: vault.listShares(ctx.manifest.id, ctx.spaceId).filter((s) => ownShare(ctx, s) || !shareHidden(ctx, s)).map((s) => ({ ...seenShare(ctx, s), canTurnOff: mayTurnOff(ctx, s) })) });
  });

  app.post('/api/modules/:id/library/shares', shareAccess, smallJson, (req, res) => {
    const ctx = req.shareCtx;
    const b = body(req);
    if (b.days !== undefined && typeof b.days !== 'number') return res.status(400).json({ error: 'A share link ends after 1, 7 or 30 days.' });
    if (b.download !== undefined && typeof b.download !== 'boolean') return res.status(400).json({ error: 'Allow download is on or off.' });
    if (b.password !== undefined && b.password !== null && typeof b.password !== 'string') return res.status(400).json({ error: 'A password is text.' });
    if (b.download === true && !ctx.can('download')) return res.status(403).json({ error: `Your role can't download from ${ctx.name}, so its share links can't allow it.` });
    vault.dropEndedShares(ctx.manifest.id, ctx.spaceId);
    try {
      const made = vault.createShare(ctx.manifest.id, ctx.spaceId, { name: b.name, files: b.files, by: ctx.by, days: b.days === undefined ? 7 : b.days, download: b.download === true, password: b.password || '', visible: ctx.sees });
      noteActivity(ctx.manifest.id, 'made a share link', ctx.by, `space:${ctx.spaceId}`);
      res.status(201).json({ share: made.share, token: made.token, url: `/shared/${made.token}` });
    } catch (err) {
      refuseShare(res, err);
    }
  });

  app.patch('/api/modules/:id/library/shares/:sid', shareAccess, smallJson, (req, res) => {
    const ctx = req.shareCtx;
    const s = vault.getShare(ctx.manifest.id, ctx.spaceId, req.params.sid);
    if (!s || shareHidden(ctx, s)) return res.status(404).json({ error: NO_SUCH_SHARE });
    if (s.by !== ctx.by && !ctx.owner) return res.status(403).json({ error: `Only the person who made this share link, or ${word('owner', { a: true })}, can change it.` });
    const b = body(req);
    if (b.files !== undefined && s.download && !ctx.can('download')) return res.status(403).json({ error: `Your role can't download from ${ctx.name}, so you can't change the files of a link that allows it.` });
    try {
      res.json({ share: seenShare(ctx, vault.updateShare(ctx.manifest.id, ctx.spaceId, s.id, { name: b.name, files: b.files, visible: ctx.sees })) });
    } catch (err) {
      refuseShare(res, err);
    }
  });

  app.delete('/api/modules/:id/library/shares/:sid', (req, res) => {
    const ctx = libraryAccess(req, res, 'share');
    if (!ctx) return;
    const s = vault.getShare(ctx.manifest.id, ctx.spaceId, req.params.sid);
    if (!s || (!ownShare(ctx, s) && shareHidden(ctx, s))) return res.status(404).json({ error: NO_SUCH_SHARE });
    if (!mayTurnOff(ctx, s)) return res.status(403).json({ error: `Only the person who made this share link, ${word('owner', { a: true })} or a ${word('moderator')} of this ${word('space')} can turn it off.` });
    if (!vault.revokeShare(ctx.manifest.id, ctx.spaceId, req.params.sid)) return res.status(404).json({ error: NO_SUCH_SHARE });
    noteActivity(ctx.manifest.id, 'turned off a share link', ctx.by, `space:${ctx.spaceId}`);
    res.json({ ok: true });
  });

  // --- public ---------------------------------------------------------------------------------------------------------
  const address = (req) => `${slugOf()}|${req.ip || 'unknown'}`;

  // The share a token opens here, with its module and space: { moduleId, spaceId, share, manifest } or null. Every
  // library module's links are looked through (each compared in constant time), and a link opens only while its module
  // is on in its space and the space is there.
  function openShare(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    let found = null;
    for (const moduleId of vault.libraryModules()) {
      const f = vault.findShareByToken(moduleId, token);
      if (f && !found) found = { moduleId, ...f };
    }
    if (!found) return null;
    const on = modules.enabled(found.moduleId);
    if (!on || !on.manifest.library || !modules.isOnIn(found.moduleId, found.spaceId) || !store.spaceById(found.spaceId)) return null;
    // The link is its maker's: it ends when they are gone, out of the space, or no longer allowed to share (or to download).
    if (!makerCan(found.share.by, found.spaceId, found.moduleId, found.share.download ? ['share', 'download'] : ['share'])) return null;
    return { ...found, manifest: on.manifest };
  }

  const cookieMac = (found, exp) => crypto.createHmac('sha256', store.sessionSecret)
    .update(`${COOKIE}\n${slugOf()}\n${found.moduleId}\n${found.spaceId}\n${found.share.id}\n${found.share.tokenHash}\n${found.share.passwordHash || ''}\n${found.share.ends}\n${exp}`)
    .digest('base64url');
  function unlocked(req, found) {
    if (!found.share.passwordHash) return true;
    const raw = auth.parseCookies(req.get('cookie') || '')[COOKIE];
    const m = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(String(raw || ''));
    if (!m) return false;
    const exp = Number(m[1]);
    if (!(exp > Date.now()) || exp > Date.parse(found.share.ends)) return false;
    const want = Buffer.from(cookieMac(found, exp));
    const got = Buffer.from(m[2]);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  // A link that doesn't open: counted against the address, answered as ended.
  function missed(res, addr) {
    if (misses.count(addr) >= TRIES.misses) return res.status(429).set('Retry-After', String(misses.left(addr))).json({ error: TOO_MANY });
    misses.add(addr);
    return res.status(404).json({ error: ENDED, ended: true });
  }

  // Each public route: the headers, then the token (its end, its maker and the Vault), then the password. Misses are
  // counted only for links that don't open; a link that does open is never held up by them.
  function sharedAccess(req, res, { needUnlock = true } = {}) {
    res.set(API_HEADERS);
    const found = openShare(req.params.token);
    if (!found) { missed(res, address(req)); return null; }
    if (needUnlock && !unlocked(req, found)) { res.status(401).json({ error: LOCKED, password: true }); return null; }
    return found;
  }

  // Only `firstName` of the maker reaches the page (the plan's "Shared by <first name>"); a maker who left shows none.
  const firstName = (key) => {
    const u = store.userByKey(key);
    return u ? cleanName(String(u.displayName || '').trim().split(/\s+/)[0]) || null : null;
  };

  const sendPage = (req, res) => {
    res.set(PAGE_HEADERS);
    res.sendFile(sharePage, { dotfiles: 'allow', headers: PAGE_HEADERS }, (err) => {
      if (!err || res.headersSent) return;
      res.status(404).type('text').send(ENDED);
    });
  };
  app.get('/shared/:token', sendPage);
  app.get('/shared.html', sendPage); // the same file by its name gets the same headers (express.static would not)

  app.get('/api/shared/:token', (req, res) => {
    const found = sharedAccess(req, res);
    if (!found) return;
    const { moduleId, spaceId, share } = found;
    const base = `/api/shared/${req.params.token}/files`;
    const files = share.files.map((fid) => {
      const r = vault.get(moduleId, spaceId, fid);
      if (!r) return { id: fid, removed: true };
      return {
        id: r.id, name: r.name, type: r.type, group: r.group, size: r.size, hasThumb: Boolean(r.thumb),
        ...(r.viewable === false ? { viewable: false } : {}),
        content: `${base}/${r.id}/content`,
        ...(r.thumb ? { thumb: `${base}/${r.id}/thumb` } : {}),
        ...(share.download ? { download: `${base}/${r.id}/content?download=1` } : {}),
      };
    });
    vault.noteShareOpened(moduleId, spaceId, share.id);
    res.json({ name: share.name, by: firstName(share.by), ends: share.ends, download: Boolean(share.download), files });
  });

  app.post('/api/shared/:token/unlock', async (req, res) => {
    res.set(API_HEADERS);
    const addr = address(req);
    const found = openShare(req.params.token);
    if (!found) return missed(res, addr);
    // Nothing to check: no password, or the cookie already says it was right. No limit applies.
    if (!found.share.passwordHash || unlocked(req, found)) return res.json({ ok: true });
    const link = `${slugOf()}|${found.moduleId}|${found.share.id}`;
    const keys = [[tries, addr, TRIES.address], [tries, `${link}|${addr}`, TRIES.linkAddress], [linkTries, link, TRIES.link]];
    const over = keys.find(([w, k, most]) => w.count(k) >= most);
    if (over) return res.status(429).set('Retry-After', String(over[0].left(over[1]))).json({ error: TOO_MANY });
    const env = slugOf();
    if (unlocks.count(env) >= UNLOCKS_PER_MINUTE) return res.status(429).set('Retry-After', String(unlocks.left(env))).json({ error: TOO_MANY });
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    // Counted before the check, so tries sent at once can't all pass the limit; a right one is taken back below.
    unlocks.add(env);
    let most = 0; // the wait grows with this address's own tries, never with other people's
    for (const [w, k] of keys) { const n = w.add(k); if (w !== linkTries) most = Math.max(most, n); }
    // A growing wait after the first wrong tries: 0, 0, 0.5, 1, 2, 4 s ... at most 8.
    const wait = most > 2 ? Math.min(8000, 500 * 2 ** (most - 3)) : 0;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const right = await checkPassword(password, found.share.passwordHash);
    if (right === null) return res.status(429).set('Retry-After', '5').json({ error: TOO_MANY });
    // The link may have ended or been turned off while waiting.
    const still = openShare(req.params.token);
    if (!still || still.share.id !== found.share.id) return res.status(404).json({ error: ENDED, ended: true });
    if (!right) return res.status(401).json({ error: WRONG_PASSWORD });
    tries.clear(`${link}|${addr}`); // a right password clears its link and address, and takes its try back from the others
    linkTries.sub(link);
    tries.sub(addr);
    const exp = Math.min(Date.now() + UNLOCK_MS, Date.parse(found.share.ends));
    res.cookie(COOKIE, `${exp}.${cookieMac(found, exp)}`, { httpOnly: true, sameSite: 'strict', secure: auth.isSecure(req), path: `/api/shared/${req.params.token}`, maxAge: Math.max(0, exp - Date.now()) });
    res.json({ ok: true });
  });

  function sendSharedFile(req, res, thumb) {
    const found = sharedAccess(req, res);
    if (!found) return;
    const { moduleId, spaceId, share } = found;
    const download = !thumb && req.query.download === '1';
    const fid = String(req.params.fid);
    const r = share.files.includes(fid) ? vault.get(moduleId, spaceId, fid) : null;
    if (!r || (thumb && !r.thumb) || (download && !share.download)) return res.status(404).json({ error: NO_SUCH_FILE });
    if (!thumb && !download && r.viewable === false) return res.status(404).json({ error: share.download ? PDF_DOWNLOAD_ONLY : PDF_NOT_HERE });
    const file = vault.filePath(spaceId, r.id, thumb);
    const key = address(req);
    if (!thumb) {
      if ((streams.get(key) || 0) >= STREAMS_PER_ADDRESS) return res.status(429).set('Retry-After', '2').json({ error: BUSY });
      streams.set(key, (streams.get(key) || 0) + 1);
      let freed = false;
      res.once('close', () => {
        if (freed) return;
        freed = true;
        const v = (streams.get(key) || 0) - 1;
        if (v > 0) streams.set(key, v); else streams.delete(key);
      });
    }
    const headers = { ...(thumb ? libraryHeaders(r.thumb.type, r.name, 'inline') : libraryHeaders(r.type, r.name, download ? 'attachment' : 'inline')), ...API_HEADERS };
    res.sendFile(file, { acceptRanges: true, etag: true, lastModified: true, cacheControl: false, dotfiles: 'allow', headers }, (err) => {
      if (!err || res.headersSent) return;
      res.removeHeader('Content-Disposition');
      res.type('application/json');
      if (err.status === 416) {
        let size = 0;
        try { size = fs.statSync(file).size; } catch { /* gone */ }
        res.removeHeader('Content-Range');
        return res.status(416).set('Content-Range', `bytes */${size}`).json({ error: 'That part of the file is out of range.' });
      }
      if (err.status === 404 || err.code === 'ENOENT') return res.status(404).json({ error: NO_SUCH_FILE });
      return res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({ error: 'The file could not be read.' });
    });
  }
  app.get('/api/shared/:token/files/:fid/content', (req, res) => sendSharedFile(req, res, false));
  app.get('/api/shared/:token/files/:fid/thumb', (req, res) => sendSharedFile(req, res, true));
  // Anything else under /api/shared/ answers as a link that has ended, so no other route is reachable from a link.
  app.use('/api/shared', (req, res) => res.status(404).set(API_HEADERS).json({ error: ENDED, ended: true }));
}

module.exports = { mountVaultShares, Window, COOKIE, PAGE_CSP, PAGE_HEADERS, TRIES, UNLOCKS_PER_MINUTE };
