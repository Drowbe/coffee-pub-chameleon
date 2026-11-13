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
ok(/let name = entry\.who;/.test(space) && !/entry\.by === 'guest' \?/.test(space) && /nameEl\.textContent = name/.test(space), 'space: a guest\'s chat sender is shown as the server names them (the mark is in the name, once) and drawn as text');
ok(!/\$\{me\.displayName\} \(\$\{word\('guest'\)\}\)/.test(space) && /You are in as \$\{me\.displayName\}\./.test(space), 'space: the banner says the name once');
ok(!/\(\$\{word\('guest'\)\}\)/.test(guest) && /You are in as \$\{answer\.guest\.name\}\./.test(guest), 'landing: the greeting says the name once');
ok(!/\(\$\{word\('guest'\)\}\)/.test(read('public/space-setup.js')), 'set up: a waiting guest is shown by the name as kept');
// The guest landing and Home (point 5), the poll (point 7).
const gHtml = read('public/guest.html');
ok(/id="guest-continue"[^>]*>Continue</.test(gHtml) && /class="btn btn-primary"[^>]*id="guest-continue"/.test(gHtml), 'landing: a primary Continue');
ok(/class="btn btn-small btn-quiet"[^>]*id="guest-leave"[^>]*>Leave</.test(gHtml) && !/class="btn" type="button" id="guest-leave"/.test(gHtml), 'landing: Leave is small and secondary');
ok(/location\.hash === '#home'/.test(guest) && /location\.hash = '#home'/.test(guest), 'landing: Continue goes to Home');
ok(/setInterval\([^\n]*visibilityState === 'visible'[^\n]*POLL_MS|setInterval\(\(\) => \{ if \(document\.visibilityState === 'visible'\) load\(\)/.test(guest) && /const POLL_MS = 1[0-5]000/.test(guest), 'landing: the list is read again every 10 to 15 seconds while the page is visible');
ok(/visibilitychange/.test(guest) && /snapshot === shown/.test(guest), 'landing: read again on return, and redrawn only when it changed');
ok(/space\.state === 'pending'[\s\S]{0,200}load\(\)/.test(guest) || /now\.state !== 'pending'/.test(guest), 'landing: Withdraw reads the server first');
ok(/Not this time/.test(guest) && /ask again tomorrow/.test(guest) && !/'Declined'/.test(guest), 'landing: a declined request says Not this time, with the 24-hour wait');
ok(/guest-space-open[\s\S]{0,120}'Open'|textContent = 'Open'/.test(guest), 'landing: an open space has Open');
ok(/location\.href = '\/guest#home'/.test(space), 'space: a guest\'s way back is their Home');
// The owner's switch is gone (point 1); the Guests section is its own (point 2); the host's box (point 3); the guest link (point 6).
const adminHtml = read('public/admin.html');
const adminJs = read('public/admin.js');
ok(!/set-guest-door|save-guest-door/.test(adminHtml + adminJs) && !/Let anyone come in as/.test(adminHtml), 'manage: the owner\'s guest door switch and its Save are gone');
ok(/<div class="[a-z]+" id="guest-door-section">\s*<h2 data-fill>\{Guests\}<\/h2>/.test(adminHtml) && /<h2>Invite link<\/h2>/.test(adminHtml) && adminHtml.indexOf('id="signup-section"') < adminHtml.indexOf('id="invite-section"') && adminHtml.indexOf('id="invite-section"') < adminHtml.indexOf('id="guest-door-section"'), 'manage: Sign-up, then Invite link, then Guests, each its own block');
ok(/end-guest-sessions/.test(adminHtml) && /\/api\/guest-door\/end-all/.test(adminJs), 'manage: End all guest sessions now stays in Guests');
ok(/To let \$\{guestsLow\} in, open \$\{word\('space', \{ a: true \}\)\} and set Who can enter to Anyone, including \$\{guestsLow\}\./.test(adminJs) && /for \$\{settings\.guestHours \|\| 24\} hours/.test(adminJs), 'manage: Guests says how long and the next step');
ok(/guestDoorHost !== true|const on = settings\.guestDoorHost === true/.test(adminJs), 'manage: Guests offers the section only while the host\'s switch is on (one plain line when off)');
const hostHtml = read('public/host.html');
ok(/Allow \{guest\} sign-in on this \{environment\}\. \{Owners\} then choose which \{spaces\} are open to \{guests\}\./.test(hostHtml), 'host console: the environment box says it only makes the door available');
const setupSrc = read('public/space-setup.js');
ok(/switchRow\('setup-allow-guests', esc\(`Invited \$\{guestsMany\}`\)\)/.test(setupSrc) && /switchRow\('setup-entry-guests', esc\(`Visiting \$\{guestsMany\}`\)\)/.test(setupSrc) && !/Lets you make a link that brings someone/.test(setupSrc), 'set up: Invited guests (the guest link) and Visiting guests are two of the four Who can enter switches');
ok(/guests can see costs and booking codes|can see costs and booking codes/.test(setupSrc), 'set up: Guests can see costs and booking codes stays');
ok(/setup-entry-hint/.test(read('public/space-setup.js')) && /come in from the sign-in page with just a name/.test(read('public/space-setup.js')) && /The host has not turned/.test(read('public/space-setup.js')), 'set up: the hint names visiting guests, and one line says the host has not turned guest sign-in on');
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
ok(/api\('GET', '\/api\/branding'\)/.test(setup) && /state\.door = Boolean\(branding\.guestDoor\)/.test(setup) && /closed \|\| state\.door === false/.test(setup), 'set up: Visiting guests is dimmed while the host\'s guest sign-in is off');

console.log(`check-guest-pages: ${n} assertions passed`);
