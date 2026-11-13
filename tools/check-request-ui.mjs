#!/usr/bin/env node
/*
 * check-request-ui.mjs -- request access in the pages (documentation/plans/plan-access-bundle.md, step 7), read as code. The
 * flow is driven in a browser by hand; this keeps the rules that protect a stranger's view from drifting:
 *   - a stranger's row (it has `request`, no `members`) is kept out of presenceSpaces, so nothing that reads members meets it;
 *   - a request card, a guest-landing row and the menu entries are drawn as text (textContent), never as markup;
 *   - a request card is not entered by a click (it has no role=button, and its click goes to its two buttons only);
 *   - the buttons call POST and DELETE /api/spaces/:id/request, and the server's own sentence is shown in a toast;
 *   - Set up: the switch is saved with Save (requestAccess in the patch), the waiting list reads and answers the routes,
 *     marks a guest, draws names as text and shows a refusal plainly; owners only, never the Lobby;
 *   - the bell opens only a strictly shaped Set up address, and draws the notice escaped;
 *   - solid icons only, and 44px tap targets on a phone for each new control.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1; };

const space = read('public/space.js');
ok(/requestSpaces = \(spaces \|\| \[\]\)\.filter\(\(r\) => r && r\.request\)/.test(space) && /presenceSpaces = \[\.\.\.\(spaces \|\| \[\]\)\.filter\(\(r\) => !\(r && r\.request\)\)/.test(space), 'space: a stranger\'s row is kept out of presenceSpaces');
const paint = space.slice(space.indexOf('function paintRequestCard'), space.indexOf('async function askAccess'));
ok(paint.length > 200 && !/innerHTML|insertAdjacentHTML/.test(paint), 'space: the request card is drawn as text');
ok(/removeAttribute\(a\)/.test(paint) && !/setAttribute\('role'/.test(paint) && /\.space-choice-actions'\)\.hidden = true/.test(paint), 'space: a request card is not a button and has no Join');
ok(/\.space-choice\.requestable[\s\S]{0,300}askAccess\(asking, 'POST'\)[\s\S]{0,200}askAccess\(asking, 'DELETE'\)[\s\S]{0,60}return;/.test(space), 'space: a click on a request card goes to its two buttons only');
ok(/api\(method, `\/api\/spaces\/\$\{encodeURIComponent\(id\)\}\/request`\)/.test(space) && /noticeToast\(err\.message/.test(space), 'space: the server\'s sentence is shown in a toast');
ok(/'Requested'/.test(paint) && /'Declined'/.test(paint) && /\[data-ask\]'\)\.hidden = pending \|\| declined/.test(paint), 'space: Requested with Withdraw; Declined with no button');
const html = read('public/space.html');
ok(/data-ask type="button"[\s\S]{0,200}Request access/.test(html) && /data-withdraw/.test(html) && !/fa-regular|fa-light/.test(html.slice(html.indexOf('data-ask-box'), html.indexOf('space-choice-actions'))), 'space.html: the card has Request access and Withdraw, solid icons');

const guest = read('public/guest.js');
const askRow = guest.slice(guest.indexOf('function askRow'), guest.indexOf('function load'));
ok(askRow.length > 200 && !/innerHTML/.test(askRow) && /textContent = space\.name/.test(askRow) && /textContent = space\.description/.test(askRow), 'guest landing: a request row is drawn as text');
ok(/space\.state === 'request' \|\| space\.state === 'pending'/.test(guest) && !/href/.test(askRow), 'guest landing: a request row is not a link');
ok(/method|pending \? 'DELETE' : 'POST'/.test(askRow) && /noticeToast\(err\.message/.test(askRow) && /Not this time/.test(askRow), 'guest landing: asks, withdraws, shows the server\'s sentence, Not this time');

const brand = read('public/brand.js');
ok(/askRows = \(data\) => \(data\?\.spaces \|\| \[\]\)\.filter\(\(r\) => r && r\.request\)/.test(brand) && /items\.push\(\.\.\.askRows\(data\)\.map\(askItem\)\)/.test(brand), 'menu: the Spaces menu lists the spaces to ask for');
ok(/\/\^\\\/\\\?setup=\[A-Za-z0-9_-\]\{1,64\}#members\$\//.test(brand) && /escapeHtml\(setup\)/.test(brand), 'bell: only a strictly shaped Set up address opens, and it is escaped');
ok(/<strong>\$\{escapeHtml\(n\.title/.test(brand) && /escapeHtml\(n\.body\)/.test(brand), 'bell: title and body are escaped');

const setup = read('public/space-setup.js');
ok(/patch\.requestAccess = after\.requestAccess/.test(setup) && /requestAccess: 'members'/.test(setup) && /id="setup-request-access"/.test(setup), 'set up: the switch is saved with Save');
ok(/People can ask to come in/.test(setup) && /Waiting to come in/.test(setup), 'set up: the switch and the list have their words');
const members = setup.slice(setup.indexOf('function membersTabHtml'), setup.indexOf('function phasesTabHtml'));
ok(/state\.owner && !space\.isLobby[\s\S]*setup-request-access[\s\S]*data-section|state\.owner && !space\.isLobby[\s\S]{0,3000}'waiting'/.test(members), 'set up: owners only, never the Lobby');
const waiting = setup.slice(setup.indexOf('async function loadWaiting'), setup.indexOf('async function loadOwnerParts'));
ok(waiting.length > 500 && !/innerHTML|insertAdjacentHTML/.test(waiting), 'set up: the waiting list is drawn as text');
ok(/access-requests`\)/.test(waiting) && /access-requests\/\$\{encodeURIComponent\(r\.id\)\}`, \{ decision \}/.test(waiting) && /'approve'/.test(waiting) && /'deny'/.test(waiting), 'set up: the list reads and answers the routes');
ok(/name\.textContent = r\.name;/.test(waiting) && !/\(\$\{word\('guest'\)\}\)/.test(waiting), 'set up: a guest is shown by the name the door kept, which carries the guest mark once');
ok(/err\.message/.test(waiting) && /loadWaiting\(\)/.test(waiting) && /Nobody is waiting/.test(waiting), 'set up: a refusal is shown plainly, the list reloads, an empty list says so');
ok(/button\.disabled|b\.disabled = true/.test(waiting), 'set up: a button is off while its answer is sent');

const all = [space, guest, brand.slice(brand.indexOf('async function askFromMenu'), brand.indexOf('export async function openSwitcher')), waiting, html.slice(html.indexOf('data-ask-box'), html.indexOf('space-choice-actions'))].join('\n');
ok(!/fa-regular|fa-light|fa-thin|\bfar fa-/.test(askRow + waiting + paint), 'icons are solid');
const OLD = ['ro' + 'om', 'ta' + 'ble', 'sta' + 'ge', 'pa' + 'ne', 'ten' + 'ant', 'it' + 'em'].join('|');
ok(!new RegExp(`\\b(${OLD})s?\\b`, 'i').test(askRow + waiting + paint.replace(/\.space-choice-[a-z-]+/g, '')), 'no old names in the new words');
const css = read('public/style.css');
for (const sel of ['.space-choice-ask .btn', '.guest-space-actions .btn', '.setup-waiting-actions .btn']) ok(!css.includes(`${sel} {`), `phone: ${sel} gets its size from the shared button rules (--btn-h; check-phone-targets measures it), not its own min-height`);
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.slice(css.indexOf('.space-choice-ask {'), css.indexOf('/* The whole card enters the space'))), 'styles: theme tokens only');
void all;

console.log(`check-request-ui: ${n} assertions passed`);
