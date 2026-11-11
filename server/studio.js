'use strict';

// The studio card on the About page (STUDIO_NAME, STUDIO_LOGO_FILE, STUDIO_LOGO_DARK_FILE, STUDIO_URL, STUDIO_PRODUCT_URL,
// STUDIO_CONTACT_URL, STUDIO_SUPPORT_URL). Read once at start. A link that is empty is not shown; one that is not an
// http(s) address (Contact may also be mailto:) is dropped with a warning and never rendered. A logo file is read once,
// and only a png, jpg, webp, svg or gif of at most 512 KB is kept. The client never names a path: the two logo routes
// serve what was read here and nothing else.
const fs = require('fs');

const DEFAULT_STUDIO_NAME = 'Coffee Pub Studio';
const MAX_LOGO_BYTES = 512 * 1024;
const LINKS = [['main', 'STUDIO_URL', 'Main site'], ['product', 'STUDIO_PRODUCT_URL', 'Product site'], ['contact', 'STUDIO_CONTACT_URL', 'Contact'], ['support', 'STUDIO_SUPPORT_URL', 'Support']];

function cleanLink(raw, allowMail) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (allowMail && url.protocol === 'mailto:') return url.pathname ? url.href : null;
  if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) return null;
  return url.href;
}

function sniff(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'image/gif';
  if (/<svg[\s>]/i.test(buf.toString('utf8', 0, Math.min(buf.length, 4096)))) return 'image/svg+xml';
  return null;
}

function readLogo(name, file, warn) {
  let buf;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
    if (stat.size > MAX_LOGO_BYTES) {
      warn(`${name} is larger than 512 KB, so no logo is shown. Use a smaller file.`);
      return null;
    }
    buf = fs.readFileSync(file);
  } catch {
    warn(`${name} could not be read, so no logo is shown. Check the path.`);
    return null;
  }
  const type = sniff(buf);
  const okExt = /\.(png|jpe?g|webp|svg|gif)$/i.test(file);
  if (!type || !okExt || buf.length > MAX_LOGO_BYTES) {
    warn(`${name} is not a png, jpg, webp, svg or gif image, so no logo is shown.`);
    return null;
  }
  return { buf, type };
}

// env: process.env; warn: the log. Returns { name, links: { main, product, contact, support }, logos: { light, dark } } or null
// when nothing on the card is set.
function readStudio(env = process.env, warn = (line) => console.warn(line)) {
  const get = (key) => (typeof env[key] === 'string' ? env[key].trim() : '');
  const links = {};
  for (const [key, variable] of LINKS) {
    const raw = get(variable);
    if (!raw) continue;
    const href = cleanLink(raw, key === 'contact');
    if (href) links[key] = href;
    else warn(`${variable} is not a web address${key === 'contact' ? ' or a mailto: address' : ''}, so that link is not shown.`);
  }
  const light = get('STUDIO_LOGO_FILE') ? readLogo('STUDIO_LOGO_FILE', get('STUDIO_LOGO_FILE'), warn) : null;
  const dark = get('STUDIO_LOGO_DARK_FILE') ? readLogo('STUDIO_LOGO_DARK_FILE', get('STUDIO_LOGO_DARK_FILE'), warn) : null;
  if (!light && !dark && !Object.keys(links).length) return null;
  return { name: get('STUDIO_NAME') || DEFAULT_STUDIO_NAME, links, logos: { light: light || dark, dark: dark || light } };
}

// What the public branding answer carries: small, no paths.
function studioView(studio) {
  if (!studio) return null;
  return { name: studio.name, links: studio.links, logo: Boolean(studio.logos.light) };
}

// GET /about/studio-logo and /about/studio-logo-dark. Nothing configured: 404.
function mountStudioLogo(app, studio) {
  for (const [route, mode] of [['/about/studio-logo', 'light'], ['/about/studio-logo-dark', 'dark']]) {
    app.get(route, (req, res) => {
      const logo = studio && studio.logos[mode];
      if (!logo) return res.status(404).type('text/plain').send('There is no studio logo.');
      res.set({ 'Content-Type': logo.type, 'Content-Length': logo.buf.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
      res.end(logo.buf);
    });
  }
}

module.exports = { readStudio, studioView, mountStudioLogo, MAX_LOGO_BYTES, DEFAULT_STUDIO_NAME };
