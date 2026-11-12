#!/usr/bin/env node
/*
 * check-guest-pages.mjs -- the guest door's pages (documentation/plans/plan-access-bundle.md, step 5), read as code (the
 * flow itself is driven in a browser by hand; this keeps its pieces from drifting):
 *   - the landing lists each open space as a real link to /guest/<id>;
 *   - the space page has one guest concept: guestMode (any guest) beside guestToken (a link's token only), and a door guest
 *     sends no token (the cookie is the credential), has no Set up, no members list and no creating, and has a banner with Leave;
 *   - Leave is DELETE /api/guest-door;
 *   - every page that makes its own fetch() loads agreement-redirect.js (brand.js and shared.js do), and that wrapper uses
 *     sameSiteNext, as api() in brand.js does (issue #684);
 *   - a guest link's form sends the versions of the texts to /api/guest-join where texts are set, and draws them as text;
 *   - the Set up radio "including guests" appears only while the door is on (branding guestDoor).
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1; };

const guest = read('public/guest.js');
ok(/a\.href|row\.href = `\/guest\/\$\{encodeURIComponent\(space\.id\)\}`/.test(guest) && /createElement\('a'\)/.test(guest), 'landing: each space is a link to /guest/<id>');
ok(/api\('DELETE', '\/api\/guest-door'\)/.test(guest), 'landing: Leave is DELETE /api/guest-door');

const space = read('public/space.js');
ok(/async function doorGuestHere/.test(space) && /'\/api\/guest-door'/.test(space), 'space: asks the door whether this address is a space it lets the visitor into');
ok(/const guestToken = doorGuest \? null : pathToken/.test(space), 'space: a door guest sends no token');
ok(/const guestMode = Boolean\(pathToken\)/.test(space), 'space: one guestMode for every guest');
ok(/canSetUp = \(\) => [^\n]*!guestMode|canSetUp = \(\) => [^\n]*role !== 'guest'/.test(space), 'space: no Set up for a guest');
ok(/button\.hidden = Boolean\(guestMode\)/.test(space), 'space: no creating for a guest');
ok(/if \(doorGuest\) \{[\s\S]{0,900}api\('DELETE', '\/api\/guest-door'\)/.test(space), 'space: the banner Leave ends the session');
ok(!/initDashboard[^\n]*\n/.test(space.split('\n').filter((l) => /if \(!guestToken\) initDashboard/.test(l)).join('\n')), 'space: the member dashboard is not drawn for any guest');
ok(/versions: Object\.fromEntries\(guestDocs/.test(space) && /api\('GET', '\/api\/agreements'\)/.test(space), 'space: a guest link sends the versions of the texts');
ok(/textContent = d\.title/.test(space) && !/guest-docs'\)\.innerHTML/.test(space), 'space: the texts are drawn as text');
const html = read('public/space.html');
ok(/id="guest-banner"/.test(html) && /id="guest-banner-leave"/.test(html) && /fa-solid fa-right-from-bracket/.test(html), 'space.html: banner with Leave, solid icon');

const redirect = read('public/agreement-redirect.js');
ok(/sameSiteNext/.test(redirect) && /agreementRequired === true/.test(redirect), 'agreement-redirect: sends agreementRequired to /agree?next= by sameSiteNext');
for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((x) => x.endsWith('.js'))) {
  const text = read(`public/${f}`);
  if (!/\bfetch\(\s*['`]\/api\//.test(text) || f === 'agreement-redirect.js') continue;
  ok(/agreement-redirect\.js|from '\/brand\.js'|import '\/brand\.js'/.test(text) || /Imported by|brand\.js calls/.test(text) || ['theme-mode.js', 'environment-banner.js', 'chat-input.js', 'file-viewer-views.js', 'start.js', 'login-first-password.js'].includes(f), `${f}: raw fetch of /api/ goes through the agreement redirect`);
}
ok(/import '\/agreement-redirect\.js'/.test(read('public/shared.js')), 'shared.js: the public page redirects on agreementRequired');
ok(/import '\/agreement-redirect\.js'/.test(read('public/brand.js')), 'brand.js: every page that loads it redirects on agreementRequired');

const setup = read('public/space-setup.js');
ok(/api\('GET', '\/api\/branding'\)\.then\(\(b\) => Boolean\(b\.guestDoor\)\)/.test(setup) && /\(door \|\| state\.draft\.entry === 'guests'\)/.test(setup), 'set up: "including guests" only while the door is on');

console.log(`check-guest-pages: ${n} assertions passed`);
