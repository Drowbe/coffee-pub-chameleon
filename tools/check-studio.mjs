// The About page's studio card (server/studio.js): unset shows nothing, links are filtered, a bad logo file is refused with a
// log, the served logo has its headers, and the page draws the values as text, never as markup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readStudio, studioView, mountStudioLogo, MAX_LOGO_BYTES } = require('../server/studio.js');
const express = require('express');

let failed = 0;
const ok = (cond, what) => { if (!cond) { failed++; console.error(`FAIL: ${what}`); } };
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'studio-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
const file = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };
const read = (env) => { const log = []; return { studio: readStudio(env, (l) => log.push(l)), log }; };

// Nothing set: no card, no logo route.
{
  const { studio, log } = read({ STUDIO_NAME: 'Someone' });
  ok(studio === null && studioView(studio) === null && !log.length, 'unset: no card');
  const app = express(); mountStudioLogo(app, studio);
  const srv = app.listen(0); const port = srv.address().port;
  for (const r of ['/about/studio-logo', '/about/studio-logo-dark']) ok((await fetch(`http://127.0.0.1:${port}${r}`)).status === 404, `unset: ${r} is 404`);
  srv.close();
}
// Links: filtered, with a warning each.
{
  const { studio, log } = read({ STUDIO_URL: 'javascript:alert(1)', STUDIO_PRODUCT_URL: 'mailto:a@b.c', STUDIO_CONTACT_URL: 'mailto:hi@example.com', STUDIO_SUPPORT_URL: ' https://example.com/s ', STUDIO_NAME: '' });
  ok(!studio.links.main && !studio.links.product, 'javascript: and mailto: on a non-contact link are dropped');
  ok(studio.links.contact === 'mailto:hi@example.com' && studio.links.support === 'https://example.com/s', 'contact may be mailto:, others https');
  ok(log.length === 2 && studio.name === 'Coffee Pub Studio', 'two warnings, default name');
  ok(read({ STUDIO_CONTACT_URL: 'javascript:x', STUDIO_URL: 'data:text/html,x', STUDIO_SUPPORT_URL: 'ftp://x.y' }).studio === null, 'only bad links: no card');
}
// Logos: refused with a log.
{
  for (const [what, env] of [['missing', { STUDIO_LOGO_FILE: path.join(dir, 'nope.png') }], ['too big', { STUDIO_LOGO_FILE: file('big.png', Buffer.concat([png, Buffer.alloc(MAX_LOGO_BYTES)])) }], ['wrong type', { STUDIO_LOGO_FILE: file('a.png', Buffer.from('<html>no</html>')) }], ['wrong extension', { STUDIO_LOGO_FILE: file('a.txt', png) }]]) {
    const { studio, log } = read(env);
    ok(studio === null && log.length === 1, `${what}: refused with one log line`);
  }
}
// A served logo: headers; one logo serves both routes; the dark one is its own.
{
  const { studio } = read({ STUDIO_LOGO_FILE: file('l.svg', svg), STUDIO_LOGO_DARK_FILE: file('d.png', png), STUDIO_NAME: 'X' });
  ok(JSON.stringify(studioView(studio)) === '{"name":"X","links":{},"logo":true}', 'view is small and holds no path');
  const app = express(); mountStudioLogo(app, studio);
  const srv = app.listen(0); const port = srv.address().port;
  const light = await fetch(`http://127.0.0.1:${port}/about/studio-logo`);
  ok(light.status === 200 && light.headers.get('content-type') === 'image/svg+xml', 'svg content type');
  ok(/sandbox/.test(light.headers.get('content-security-policy') || ''), 'svg has the sandbox policy');
  ok(light.headers.get('x-content-type-options') === 'nosniff' && /max-age/.test(light.headers.get('cache-control') || ''), 'nosniff and a cache header');
  ok((await light.arrayBuffer()).byteLength === svg.length, 'the light file is served');
  ok((await fetch(`http://127.0.0.1:${port}/about/studio-logo-dark`)).headers.get('content-type') === 'image/png', 'the dark file is served on the dark route');
  ok((await fetch(`http://127.0.0.1:${port}/about/studio-logo?file=/etc/passwd`)).headers.get('content-type') === 'image/svg+xml', 'a query changes nothing');
  srv.close();
  const only = read({ STUDIO_LOGO_FILE: file('o.png', png) }).studio;
  ok(only.logos.dark === only.logos.light, 'with one logo set, both modes use it');
}
// The page: text and attributes only.
{
  const js = fs.readFileSync(new URL('../public/brand.js', import.meta.url), 'utf8');
  const body = js.slice(js.indexOf('function paintStudio'), js.indexOf("document.addEventListener('app:theme', () => paintStudio"));
  ok(body.length > 200 && !/innerHTML|insertAdjacentHTML|outerHTML/.test(body), 'paintStudio holds no innerHTML');
  ok(/noopener noreferrer/.test(body) && /textContent/.test(body), 'links are text with rel noopener noreferrer');
}
fs.rmSync(dir, { recursive: true, force: true });
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('check-studio: ok');
