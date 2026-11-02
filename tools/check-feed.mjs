#!/usr/bin/env node
/*
 * check-feed.mjs -- a person's calendar feed (documentation/plans/plan-google-calendar.md, Part 1, step 1), and Calendar
 * sharing's switches (documentation/plans/plan-space-calendars.md, step 1).
 *   - server/ics.js on its own: every line ends in CRLF and is at most 75 octets, folded never inside a UTF-8
 *     character, text escaped, and the whole checked against RFC 5545's rules (components nest, each event has its
 *     UID, DTSTAMP and DTSTART, a TZID has its VTIMEZONE, an UNTIL has DTSTART's type); an all-day event of three days
 *     ends the day after; a timed one is in UTC; each repeat's RRULE, monthly on the 31st and the 29th and yearly on
 *     February 29 clamped with BYSETPOS; a timed weekly repeat written with TZID across a change from daylight saving.
 *   - The manifest: "feed" only on a dated kind, true or false; "dated" takes an optional "repeat".
 *   - A real single-environment server (TZ America/New_York) running from a copy of the app with stand-in modules
 *     bundled, so the check does not depend on which bundled module offers a kind: the Manage setting, off by default;
 *     the address made, shown once, kept only as its hash; 404 (plain text) with the setting off, for an unknown token,
 *     after Turn off, after New address (the old one), after an owner turns it off and after the person is deleted;
 *     what it holds as the person's current rights (a member of space A and not B sees A's and the environment's; not
 *     from a space where the module is off, nor without read); a Planner-like object once, as its twin; a kind
 *     without "feed" never; events long past left out; the link back; ETag and 304; 429 past 30 a minute; a guest
 *     cannot make one.
 *   - Calendar sharing's switches (plan-space-calendars step 1): otherCalendars and publishedCalendar off with nothing
 *     set, true or false only, owners only; otherCalendars reads as calendarFeeds until set, with nothing rewritten, and
 *     is its own once set; `sharing` and `sharingReasons` in GET /api/modules for a kind offered, none offered, a newer
 *     bundled version asking for the `external` hook, and the bundled Calendar before and after its approval.
 *   - The bundled Calendar's own events in the feed, a repeat as its RRULE (step 2).
 *   - The pages (step 3), read as code: Profile's section and the owner's row, the switch (on Calendar's Configure page
 *     since plan-space-calendars step 2, with Manage's pointer) and the user list, each
 *     id the scripts look up on the page, the server's routes, and the address kept no longer than the page.
 *   - Space addresses (plan-space-calendars step 3): GET /api/me/calendars in one answer; an address made once, kept
 *     as its hash, holding that one space's events under the space's name with the personal address untouched; none
 *     for a guest, a non-member or an owner who is not a member; 404 while the module is off or unreadable there, with
 *     the switch off (the member's and the owner's reasons), after New address, Turn off, an owner's Turn off, removal
 *     from the space (either route), the space's deletion and the person's; the token gone from app.json each time.
 *   - The published calendar (step 4): made by owners while its switch is on, 403 off, members never; every space's
 *     events and the environment's with nobody's rights, named after the environment; a space left out
 *     (publishCalendar false, true or false only, never the Lobby) or with the module off; 404 with the switch off,
 *     after New address, after Turn off and while no module offering events is on; its state in GET /api/settings,
 *     never its hash.
 *   - A server with BASE_DOMAIN and two environments: one environment's address (personal, space or published) is 404
 *     at the other.
 * No network beyond localhost, no LiveKit.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ics = require('../server/ics.js');
const { cleanManifest } = require('../server/modules.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n${err.stack || err}`);
  }
};
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-feed-'));
const NY = 'America/New_York';
// Dates in next year, so nothing here is ever "long past" whenever the check runs.
const Y = new Date().getUTCFullYear() + 1;

// --- RFC 5545, as far as this feed uses it -----------------------------------------------------------------------------
const TEXT_PROPS = new Set(['SUMMARY', 'DESCRIPTION', 'UID', 'X-WR-CALNAME', 'X-WR-TIMEZONE', 'TZID', 'TZNAME']);
// A TEXT value as RFC 5545 writes it (3.3.11): a comma or semicolon only after a backslash, and a backslash only
// before a backslash, a semicolon, a comma or n.
function escapedText(value) {
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\') {
      if (!'\\;,nN'.includes(value[i + 1] ?? 'x')) return false;
      i += 1;
    } else if (value[i] === ';' || value[i] === ',') return false;
  }
  return true;
}
const unescapeText = (v) => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
// The content lines, unfolded, as { name, params, value }; throws on anything RFC 5545 refuses.
function parseIcs(text) {
  assert.ok(text.endsWith('\r\n'), 'ends with CRLF');
  const physical = text.slice(0, -2).split('\r\n');
  for (const [i, line] of physical.entries()) {
    assert.ok(!/[\r\n]/.test(line), `line ${i + 1}: a bare CR or LF`);
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line ${i + 1} is ${Buffer.byteLength(line, 'utf8')} octets: ${line}`);
    assert.ok(Buffer.from(line, 'utf8').toString('utf8') === line && !line.includes('�'), `line ${i + 1}: a split UTF-8 character`);
  }
  const logical = [];
  for (const line of physical) {
    if (line.startsWith(' ') || line.startsWith('\t')) logical[logical.length - 1] += line.slice(1);
    else logical.push(line);
  }
  return logical.map((line) => {
    const m = /^([A-Za-z0-9-]+)((?:;[A-Za-z0-9-]+=(?:"[^"]*"|[^";:,]*)(?:,(?:"[^"]*"|[^";:,]*))*)*):(.*)$/.exec(line);
    assert.ok(m, `not a content line: ${line}`);
    const params = {};
    for (const p of m[2].split(';').slice(1)) { const at = p.indexOf('='); params[p.slice(0, at).toUpperCase()] = p.slice(at + 1).replace(/^"|"$/g, ''); }
    return { name: m[1].toUpperCase(), params, value: m[3] };
  });
}
const DATE = /^\d{8}$/;
const DATE_TIME = /^\d{8}T\d{6}Z?$/;
const valueMs = (p) => {
  const v = p.value;
  return Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +(v.slice(9, 11) || 0), +(v.slice(11, 13) || 0), +(v.slice(13, 15) || 0));
};
// Checks the calendar's structure and answers its events, each { props: name -> [line] }.
function rfcEvents(text) {
  const lines = parseIcs(text);
  const stack = [];
  const zones = new Set();
  const events = [];
  let current = null;
  const cal = { props: {} };
  for (const l of lines) {
    if (l.name === 'BEGIN') {
      stack.push(l.value);
      if (l.value === 'VEVENT') current = { props: {} };
      continue;
    }
    if (l.name === 'END') {
      assert.equal(stack.pop(), l.value, `END:${l.value} closes what was open`);
      if (l.value === 'VEVENT') { events.push(current); current = null; }
      continue;
    }
    assert.ok(stack.length, `${l.name} outside any component`);
    const top = stack.at(-1);
    if (top === 'VTIMEZONE' && l.name === 'TZID') zones.add(unescapeText(l.value));
    const into = top === 'VEVENT' ? current.props : top === 'VCALENDAR' ? cal.props : null;
    if (into) (into[l.name] ||= []).push(l);
    if (TEXT_PROPS.has(l.name)) assert.ok(escapedText(l.value), `${l.name} is escaped: ${l.value}`);
  }
  assert.equal(stack.length, 0, 'every component is closed');
  assert.equal(lines[0].name, 'BEGIN');
  assert.equal(lines[0].value, 'VCALENDAR');
  assert.deepEqual([cal.props.VERSION?.[0].value, Boolean(cal.props.PRODID)], ['2.0', true]);
  for (const ev of events) {
    const one = (name) => { assert.equal(ev.props[name]?.length, 1, `one ${name}`); return ev.props[name][0]; };
    one('UID');
    assert.match(one('DTSTAMP').value, /^\d{8}T\d{6}Z$/);
    const start = one('DTSTART');
    assert.ok(!(ev.props.DTEND && ev.props.DURATION), 'DTEND or DURATION, not both');
    const isDate = start.params.VALUE === 'DATE';
    assert.match(start.value, isDate ? DATE : DATE_TIME);
    if (start.params.TZID) assert.ok(zones.has(start.params.TZID), `a VTIMEZONE for ${start.params.TZID}`);
    if (ev.props.DTEND) {
      const end = ev.props.DTEND[0];
      assert.equal(end.params.VALUE === 'DATE', isDate, 'DTEND has DTSTART\'s type');
      assert.ok(valueMs(end) > valueMs(start), 'DTEND is after DTSTART');
    }
    if (ev.props.RRULE) {
      const until = /UNTIL=([0-9TZ]+)/.exec(ev.props.RRULE[0].value)?.[1];
      if (until) assert.match(until, isDate ? DATE : /^\d{8}T\d{6}Z$/, 'UNTIL is a date with a date, else UTC');
    }
  }
  return events;
}
const prop = (ev, name) => ev.props[name]?.[0] || null;
const text = (ev, name) => (prop(ev, name) ? unescapeText(prop(ev, name).value) : null);

// --- server/ics.js on its own ------------------------------------------------------------------------------------------
const ev = (fields) => ({ uid: `event-${Math.random().toString(36).slice(2)}-environment@example.test`, stamp: Date.UTC(Y, 0, 1), title: 'An event', description: '', url: '', allDay: false, start: Date.UTC(Y, 5, 1, 12), end: null, repeat: null, ...fields });
const one = (fields, tz = NY) => {
  const out = ics.buildCalendar({ name: 'Check', tz, events: [ev(fields)] });
  return { out, event: rfcEvents(out)[0] };
};

await test('ics: CRLF, 75 octets, folding never splits a character, and text escaped both ways', () => {
  const awkward = 'Commas, semicolons; back\\slashes and\nline breaks\r\nand é ü 漢字 🎲 '.repeat(6);
  const { out, event } = one({ title: awkward, description: `${'é'.repeat(100)}\n${'🎲'.repeat(40)}` });
  assert.ok(!/(^|[^\r])\n/.test(out), 'no bare LF');
  assert.equal(text(event, 'SUMMARY'), awkward.replace(/\r\n/g, '\n'));
  assert.equal(text(event, 'DESCRIPTION'), `${'é'.repeat(100)}\n${'🎲'.repeat(40)}`);
  assert.ok(out.split('\r\n').some((l) => l.startsWith(' ')), 'long lines are folded');
  assert.equal(ics.fold('A'.repeat(75)), 'A'.repeat(75), 'exactly 75 octets is not folded');
  assert.equal(ics.fold('A'.repeat(76)), `${'A'.repeat(75)}\r\n A`);
  assert.equal(ics.escapeText('a,b;c\\d\ne\u0001'), 'a\\,b\\;c\\\\d\\ne');
});

await test('ics: an all-day event of three days ends the day after its last; a timed one is in UTC', () => {
  const all = one({ allDay: true, start: `${Y}-10-10`, end: `${Y}-10-12` }).event;
  assert.deepEqual([prop(all, 'DTSTART').params.VALUE, prop(all, 'DTSTART').value, prop(all, 'DTEND').value], ['DATE', `${Y}1010`, `${Y}1013`]);
  const day = one({ allDay: true, start: `${Y}-12-31` }).event;
  assert.equal(prop(day, 'DTEND').value, `${Y + 1}0101`, 'one day with no end: the next day, across a year');
  const timed = one({ start: Date.parse(`${Y}-06-01T18:30:00Z`), end: Date.parse(`${Y}-06-01T20:00:00Z`) }).event;
  assert.deepEqual([prop(timed, 'DTSTART').value, prop(timed, 'DTEND').value, prop(timed, 'DTSTART').params.TZID], [`${Y}0601T183000Z`, `${Y}0601T200000Z`, undefined]);
  const noEnd = one({ start: Date.parse(`${Y}-06-01T18:30:00Z`) }).event;
  assert.equal(prop(noEnd, 'DTEND'), null, 'no end, no DTEND');
});

await test('ics: each repeat\'s RRULE, with the Calendar\'s clamping on the 29th to 31st and February 29', () => {
  const rule = (start, every, until = null) => prop(one({ allDay: true, start, repeat: { every, until } }).event, 'RRULE').value;
  assert.equal(rule(`${Y}-03-04`, 'day', `${Y}-03-20`), `FREQ=DAILY;UNTIL=${Y}0320`);
  assert.equal(rule(`${Y}-03-04`, 'week'), 'FREQ=WEEKLY');
  assert.equal(rule(`${Y}-03-04`, '2weeks'), 'FREQ=WEEKLY;INTERVAL=2');
  assert.equal(rule(`${Y}-03-15`, 'month'), 'FREQ=MONTHLY');
  assert.equal(rule(`${Y}-01-31`, 'month'), 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
  assert.equal(rule(`${Y}-01-30`, 'month'), 'FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1');
  assert.equal(rule(`${Y}-01-29`, 'month'), 'FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1');
  assert.equal(rule(`${Y}-01-28`, 'month'), 'FREQ=MONTHLY');
  assert.equal(rule(`${Y}-07-04`, 'year'), 'FREQ=YEARLY');
  assert.equal(rule('2028-02-29', 'year'), 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1');
});

await test('ics: a timed weekly repeat keeps its wall-clock time across the change from daylight saving (TZID and VTIMEZONE)', () => {
  // 18:00 in New York, daylight time, a week or two before it ends on the first Sunday of November.
  const { out, event } = one({ start: Date.parse(`${Y}-10-20T22:00:00Z`), end: Date.parse(`${Y}-10-20T23:30:00Z`), repeat: { every: 'week', until: `${Y}-11-30` } });
  assert.deepEqual([prop(event, 'DTSTART').params.TZID, prop(event, 'DTSTART').value], [NY, `${Y}1020T180000`]);
  assert.deepEqual([prop(event, 'DTEND').params.TZID, prop(event, 'DTEND').value], [NY, `${Y}1020T193000`]);
  // The last day ends at 23:59:59 in New York, standard time by then: 04:59:59 UTC the next day.
  assert.equal(prop(event, 'RRULE').value, `FREQ=WEEKLY;UNTIL=${Y}1201T045959Z`);
  const firstSunday = [1, 2, 3, 4, 5, 6, 7].find((d) => new Date(Date.UTC(Y, 10, d)).getUTCDay() === 0);
  assert.ok(out.includes(`BEGIN:STANDARD\r\nDTSTART:${Y}11${String(firstSunday).padStart(2, '0')}T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\n`), 'the VTIMEZONE has the change back to standard time');
  assert.ok(out.includes(`BEGIN:DAYLIGHT\r\nDTSTART:${Y}03`), 'and the spring change');
  assert.ok(out.includes(`X-WR-TIMEZONE:${NY}\r\n`));
  // A zone with no daylight saving still has its VTIMEZONE.
  const utc = one({ start: Date.parse(`${Y}-10-20T22:00:00Z`), repeat: { every: 'day', until: null } }, 'UTC');
  assert.equal(prop(utc.event, 'DTSTART').value, `${Y}1020T220000`);
  assert.ok(utc.out.includes('BEGIN:VTIMEZONE\r\nTZID:UTC\r\nBEGIN:STANDARD\r\n'));
});

await test('ics: reading a dated object, either shape, and leaving out what is long past', () => {
  const instant = { form: 'instant', title: 'title', start: 'start', end: 'end', allDay: 'allDay', repeat: 'repeat' };
  const wall = { form: 'wall', title: 'title', day: 'date', time: 'time', endDay: 'checkOut' };
  assert.deepEqual(ics.readDated({ title: 'A', start: `${Y}-05-01`, end: `${Y}-05-03`, allDay: true, repeat: { every: 'month', until: 'soon' } }, instant, NY), { title: 'A', allDay: true, start: `${Y}-05-01`, end: `${Y}-05-03`, repeat: { every: 'month', until: null } });
  assert.equal(ics.readDated({ title: 'A', start: 'whenever' }, instant, NY), null);
  assert.deepEqual(ics.readDated({ title: 'Dinner', date: `${Y}-07-01`, time: '19:30' }, wall, NY), { title: 'Dinner', allDay: false, start: Date.parse(`${Y}-07-01T23:30:00Z`), end: null, repeat: null });
  assert.deepEqual(ics.readDated({ title: 'Stay', date: `${Y}-07-01`, checkOut: `${Y}-07-04` }, wall, NY), { title: 'Stay', allDay: true, start: `${Y}-07-01`, end: `${Y}-07-04`, repeat: null });
  const now = Date.now();
  const daysAgo = (d) => new Date(now - d * 86400000).toISOString();
  assert.equal(ics.recentEnough({ allDay: false, start: Date.parse(daysAgo(100)), end: Date.parse(daysAgo(91)) }, now), false);
  assert.equal(ics.recentEnough({ allDay: false, start: Date.parse(daysAgo(100)), end: Date.parse(daysAgo(89)) }, now), true);
  assert.equal(ics.recentEnough({ allDay: true, start: daysAgo(120).slice(0, 10), end: null, repeat: { every: 'week', until: daysAgo(95).slice(0, 10) } }, now), false);
  assert.equal(ics.recentEnough({ allDay: true, start: daysAgo(400).slice(0, 10), end: null, repeat: { every: 'year', until: null } }, now), true);
});

// --- the manifest ------------------------------------------------------------------------------------------------------
await test('manifest: "feed" only on a dated kind and only true or false; "dated" takes "repeat"', () => {
  const files = new Set(['page.html']);
  const manifest = (kind) => ({ id: 'thing', name: 'Thing', version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'page.html' } }, refs: { produces: [{ kind: 'event', key: 'event:{id}', summary: { title: 'title' }, ...kind }] } });
  assert.throws(() => cleanManifest(manifest({ feed: true }), files), { message: 'module.json: refs "event" feed needs "dated"' });
  assert.throws(() => cleanManifest(manifest({ feed: 'yes', dated: { title: 'title', start: 'start' } }), files), { message: 'module.json: refs "event" feed must be true or false' });
  assert.throws(() => cleanManifest(manifest({ dated: { title: 'title', start: 'start', repeat: 'a b' } }), files), { message: 'module.json: refs "event" dated.repeat must name a stored field' });
  const kept = cleanManifest(manifest({ feed: true, dated: { title: 'title', start: 'start', allDay: 'allDay', repeat: 'repeat' } }), files).refs.produces[0];
  assert.deepEqual([kept.feed, kept.dated], [true, { form: 'instant', title: 'title', start: 'start', allDay: 'allDay', repeat: 'repeat' }]);
  assert.equal('feed' in cleanManifest(manifest({ feed: false, dated: { title: 'title', start: 'start' } }), files).refs.produces[0], false);
  assert.equal(cleanManifest(manifest({ dated: { title: 'title', day: 'date', repeat: 'again' } }), files).refs.produces[0].dated.repeat, 'again');
});

// --- the pages (step 3) ------------------------------------------------------------------------------------------------
// Profile's section and the owner's row, the switch on Calendar's Configure page, Manage's pointer and the user list: every id the scripts look up is on the page,
// the routes are the server's, and the address is never put anywhere it would outlive the page.
await test('pages: Profile\'s Calendar feed section and the owner\'s row, Manage\'s switch, wired to the server\'s routes', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const looked = (js, re) => [...new Set([...js.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]).filter((id) => re.test(id)))];
  const profileHtml = read('public/profile.html');
  const profileJs = read('public/profile.js');
  const onProfile = ids(profileHtml);
  const feedIds = looked(profileJs, /^(section-)?feed/);
  for (const id of ['section-feed', 'feed-make', 'feed-new', 'feed-off', 'feed-url', 'feed-copy', 'feed-row', 'feed-row-off', 'feed-why', 'feed-made']) assert.ok(feedIds.includes(id), `profile.js looks up #${id}`);
  for (const id of feedIds) assert.ok(onProfile.has(id), `public/profile.html has #${id}`);
  // Step 5 of plan-space-calendars.md: the section is Addresses, going out, on the Calendars tab, after Your calendars,
  // coming in; Everything first, then one row per space from the template.
  assert.match(profileHtml, /<section class="[^"]+" id="section-feed" hidden>\s*<h2>Addresses, going out<\/h2>/, 'the section is called Addresses, going out and starts hidden');
  const calendarsTab = profileHtml.slice(profileHtml.indexOf('id="tab-calendars"'), profileHtml.indexOf('id="tab-spaces"'));
  assert.ok(calendarsTab.includes('id="section-external"') && calendarsTab.includes('id="section-feed"'), 'both sections are on the Calendars tab');
  assert.ok(calendarsTab.indexOf('id="section-external"') < calendarsTab.indexOf('id="section-feed"'), 'coming in, then going out');
  assert.match(profileHtml, /<button class="subtab" data-tab="calendars" type="button" hidden>Calendars<\/button>/, 'the tab is Calendars, hidden until there is something to show');
  assert.match(calendarsTab, /<li class="address-row" id="feed-row">[\s\S]*?<strong class="address-name">Everything<\/strong>\s*<span class="sdk-status" id="feed-row-state">/, 'Everything is the first row, with the owner\'s pill');
  assert.match(profileHtml, /<template id="address-row-template">\s*<li class="address-row" data-space>/, 'a space row comes from the template');
  assert.ok(profileHtml.includes('Copy it now. It will not be shown again.'), 'the address is said to be shown once');
  assert.ok(profileHtml.includes('From URL'), 'the Google steps name From URL');
  for (const [method, route] of [['GET', "'/api/me/calendars'"], ['DELETE', '`/api/users/${user.key}/feed`'], ['DELETE', '`/api/users/${user.key}/spaces/${encodeURIComponent(spaceId)}/feed`']]) {
    assert.ok(profileJs.includes(`api('${method}', ${route}`), `profile.js: ${method} ${route}`);
  }
  assert.ok(profileJs.includes("api('POST', spaceId ? `/api/me/spaces/${encodeURIComponent(spaceId)}/feed` : '/api/me/feed', {})"), 'one make for Everything and a space');
  assert.ok(profileJs.includes("api('DELETE', spaceId ? `/api/me/spaces/${encodeURIComponent(spaceId)}/feed` : '/api/me/feed')"), 'one Turn off for both');
  assert.doesNotMatch(profileJs, /api\('GET', '\/api\/me\/feed'\)/, 'the tab is read in one (GET /api/me/calendars)');
  assert.doesNotMatch(profileJs, /(localStorage|sessionStorage|history\.(push|replace)State)[^\n]*feedUrl/, 'the address is not kept beyond the page');
  // The reasons are drawn in place (never a hidden section), and an owner's "Turn it on in <Module>'s configuration." links the module's tab on Manage > Modules.
  assert.match(profileJs, /a\.href = `\/admin#modules\/\$\{encodeURIComponent\(module\.id\)\}`;/, 'the reason links the module\'s tab');
  assert.match(profileJs, /\$\('feed-why'\)\.hidden = !whyAll;/);
  assert.match(profileJs, /parts\.reason\.hidden = !why;/);
  // QA of step 5: a kept address that does not work always names its cause (the row's reason, else the section's), never
  // a sentence starting with a space; an owner's Turn off keeps focus in the row; Everything's buttons name the row.
  assert.match(profileJs, /const cause = address\.reason \|\| whyAll;/);
  assert.match(profileJs, /\(cause \? `\$\{cause\} This address does not work for now\.` : 'This address does not work for now\.'\)/);
  assert.doesNotMatch(profileJs, /`\$\{address\.reason\} This address/, 'never an empty reason in front');
  assert.match(profileJs, /function focusAfterTurnOff\(row\)/);
  assert.equal((profileJs.match(/focusAfterTurnOff\(/g) || []).length, 3, 'called after both owner Turn offs');
  assert.ok(profileHtml.includes('id="feed-make" type="button" aria-label="Make an address for everything"') && profileHtml.includes('id="feed-row-off" type="button" aria-label="Turn off the address for everything"'));
  assert.match(profileJs, /\$\('calendars-intro'\)\.hidden = editing;/, 'the intro is not shown to an owner reading someone\'s');
  assert.match(profileJs, /if \(!external\.allowed\) linkConfigure\(\$\('external-off'\), external\.why \|\| ''\);/, 'Other calendars links the module\'s configuration as the rows do');
  const adminHtml = read('public/admin.html');
  const adminJs = read('public/admin.js');
  // The switch moved to Calendar's Configure page, with its id (plan-space-calendars.md, section 4); Manage keeps a pointer.
  const configHtml = read('public/module-config.html');
  const configJs = read('public/module-config.js');
  assert.match(configHtml, /<input id="set-calendar-feeds" type="checkbox" class="sdk-switch" role="switch" aria-describedby="calendar-feeds-hint"><span class="sdk-choice-text">Private addresses<\/span><\/label>/, 'the Configure page has the Private addresses switch');
  assert.ok(ids(configHtml).has('calendar-feeds-hint') && ids(configHtml).has('calendar-feeds-status'));
  assert.ok(!ids(adminHtml).has('set-calendar-feeds') && !ids(adminHtml).has('calendar-feeds-settings'), 'Manage no longer has the switch or its panel');
  assert.ok(!ids(adminHtml).has('calendar-sharing-pointer') && !adminJs.includes('renderSharingPointer'), 'Manage\'s one-release pointer to where it went is gone');
  assert.match(configJs, /\{ key: 'calendarFeeds', input: 'set-calendar-feeds', hint: 'calendar-feeds-hint' \}/, 'the switch saves calendarFeeds');
  // The published calendar (step 4 and 5): its switch shown, its address made, replaced and turned off on the page.
  assert.match(configJs, /\{ key: 'publishedCalendar', input: 'set-published-calendar', hint: 'published-calendar-hint' \}/, 'the Published calendar switch is shown (no `later`)');
  for (const id of ['published-calendar', 'published-state', 'published-made', 'published-url', 'published-copy', 'published-make', 'published-new', 'published-off', 'published-status']) assert.ok(ids(configHtml).has(id), `module-config.html has #${id}`);
  assert.ok(configJs.includes("api('POST', '/api/settings/published-calendar', {})") && configJs.includes("api('DELETE', '/api/settings/published-calendar')"), 'wired to the routes');
  assert.doesNotMatch(configJs, /(localStorage|sessionStorage)[^\n]*publishedUrl/, 'the address is not kept beyond the page');
  assert.ok(configJs.includes("if (!on) { publishedUrl = ''; $('published-url').textContent = ''; $('published-made').hidden = true; return; }"), 'no address left on the page once the switch is off');
  assert.ok(configHtml.includes("or one {space}'s,"), 'the Private addresses line names a space\'s address again');
  // The space's Set up panel: In the published calendar, shown only while publishing is on (it was space-settings.html).
  const setupJs = read('public/space-setup.js');
  assert.ok(setupJs.includes("sectionHtml('calendar', "), 'the panel has a calendar section');
  assert.ok(setupJs.includes('<span class="sdk-choice-label">In the published calendar</span></span><input type="checkbox" class="sdk-switch" role="switch" id="setup-publish-calendar">'), 'with the In the published calendar switch');
  assert.ok(setupJs.includes("patch.publishCalendar = after.publishCalendar;"), 'saves publishCalendar');
  assert.ok(setupJs.includes("section.hidden = settings.publishedCalendar !== true || !(m && m.enabled);"), 'the section needs publishing on and the module on (no per-space test)');
  assert.doesNotMatch(setupJs, /allSpaces|m\.spaces/, 'Set up no longer reads the per-space availability');
  assert.ok(configJs.includes("api('PATCH', '/api/settings', { [key]: input.checked })"), 'each switch saves as it is flipped');
  assert.ok(adminJs.includes('api(\'DELETE\', `/api/users/${user.key}/feed`)'), 'the user list turns someone\'s feed off');
  assert.match(adminHtml, /data-feed hidden/, 'the user card marks a feed, hidden until there is one');
});

// QA of #179 steps 0 to 2: a member opening Calendar's Configure page is told why rather than sent round sign-in for
// ever; owners get the link to Modules with a switch's reason; and Profile's Calendar feed names the switch and follows
// it when the page shows again. (Steps 3 and 4 built the space addresses and the published calendar on the server, so
// the page may now promise both; step 5 draws them.)
await test('pages: the Configure page stops for a member and links owners to Modules', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const configHtml = read('public/module-config.html');
  const configJs = read('public/module-config.js');
  const onFail = configJs.slice(configJs.indexOf("data = await api('GET', '/api/modules');"), configJs.indexOf('const m = data'));
  assert.match(onFail, /if \(err\.status === 401\) location\.href = `\/login\?next=/, 'only a 401 goes to sign-in');
  assert.match(onFail, /err\.status === 403 \? `Only \$\{word\('owner', \{ many: true \}\)\} can change this\.`/, 'a 403 says who can');
  assert.equal((configJs.match(/location\.href = `\/login/g) || []).length, 1, 'no other way to sign-in');
  assert.match(configHtml, /<p class="hint" id="cfg-denied" role="status" hidden><\/p>/);
  assert.match(configJs, /api\('GET', '\/api\/me'\)\.then\(\(r\) => hasOwnerRights\(r\.user\)\)/, 'owners and the admin get the link to Modules');
  assert.match(configJs, /typeof why === 'string' \? why : why\?\.reason \|\| ''/, 'whatever reason the server sends is drawn');
  const profileJs = read('public/profile.js');
  assert.doesNotMatch(profileJs, /Calendar feeds are off/);
  assert.match(profileJs, /`Private addresses are off in \$\{place\} for now, so this address does not work\./, 'the feed names the switch');
  assert.match(profileJs, /document\.addEventListener\('visibilitychange', refreshFeed\);/, 'the feed is read again when the page shows again');
  assert.match(profileJs, /if \(event\.persisted\) refreshFeed\(\);/);
  assert.match(profileJs, /if \(editingKey \|\| !feed \|\| feedReading \|\| document\.visibilityState !== 'visible'\) return;/, 'one read at a time');
  assert.match(profileJs, /if \(seq !== feedSeq\) return false;/, 'an older answer is dropped');
});

// --- a real server -----------------------------------------------------------------------------------------------------
// The app copied with its modules/ linked one by one, plus three stand-ins bundled beside them: dates that offer
// themselves to the feed and take twins (as the Calendar does), plans that send twins (as the Planner does), and
// notes that are dated but not offered.
function writeModule(dir, id, refs, { scope = ['environment', 'space'], destination, guards } = {}) {
  const root = path.join(dir, id);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify({
    id, name: id, version: '1.0.0', scope, icon: 'circle', description: 'A stand-in for check-feed.',
    surfaces: { page: { entry: `${id}.html` }, canvas: { entry: `${id}.html` }, ...(destination ? { destination } : {}) },
    permissions: [
      { key: 'view', label: 'See it', default: { member: true, moderator: true, guest: true } },
      { key: 'edit', label: 'Change it', default: { member: true, moderator: true, guest: false } },
    ],
    access: { read: 'view', write: 'edit' },
    refs,
    ...(guards ? { guards } : {}),
  }, null, 2));
  fs.writeFileSync(path.join(root, 'src', `${id}.html`), '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
  fs.writeFileSync(path.join(root, 'src', `${id}.css`), '');
  fs.writeFileSync(path.join(root, 'src', `${id}.js`), '');
}
function appCopy(name) {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, 'modules'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'server'), path.join(root, 'server'), { recursive: true });
  for (const link of ['public', 'templates', 'node_modules', 'package.json']) fs.symlinkSync(path.join(ROOT, link), path.join(root, link));
  for (const m of fs.readdirSync(path.join(ROOT, 'modules'))) fs.symlinkSync(path.join(ROOT, 'modules', m), path.join(root, 'modules', m));
  const mods = path.join(root, 'modules');
  writeModule(mods, 'feed-dates', { produces: [{
    kind: 'event', name: 'Event', open: true, key: 'event:{id}',
    summary: { title: 'title', subtitle: 'desc', when: 'start', end: 'end', allDay: 'allDay' },
    dated: { title: 'title', start: 'start', end: 'end', allDay: 'allDay', repeat: 'repeat' },
    mirror: 'in', create: { id: '{id}', desc: '', repeat: null, by: '{by}' }, feed: true,
  }] }, { destination: [{ id: 'calendar', part: 'main', entry: 'feed-dates.html' }], guards: { hidden: ['desc', 'end'] } }); // kept from guests, so from the published calendar too
  writeModule(mods, 'feed-plans', { produces: [{
    kind: 'plan', name: 'Plan', key: 'plan:{id}', summary: { title: 'title', when: 'date' },
    dated: { title: 'title', day: 'date', time: 'time' }, mirror: 'out',
  }], consumes: ['feed-dates:event'] });
  writeModule(mods, 'feed-quiet', { produces: [{
    kind: 'note', name: 'Note', key: 'note:{id}', summary: { title: 'title', when: 'start' },
    dated: { title: 'title', start: 'start' },
  }] });
  // Takes no part in calendar sharing until a newer version that asks for the `external` hook ships beside it.
  writeModule(mods, 'feed-later', {}, { scope: ['environment'] });
  return root;
}
async function startServer(root, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: path.join(root, 'data'), TZ: NY, ADMIN_PASSWORD: 'testpass1234', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const call = (method, urlPath, { body, cookie, host = '', headers: more = {} } = {}) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { host: `${host ? `${host}.` : ''}localhost:${port}`, accept: 'application/json', ...more };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
    if (cookie) headers.cookie = cookie;
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
  const signIn = async (login, password, host = '') => {
    const r = await call('POST', '/api/login', { body: { login, password }, host });
    assert.equal(r.status, 200, `${login} signs in: ${r.text}`);
    return [].concat(r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  };
  const stop = () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  return { call, signIn, stop, root, output: () => out };
}

const feedPath = (url) => new URL(url).pathname;
const hashOf = (url) => crypto.createHash('sha256').update(/\/feed\/([A-Za-z0-9_-]+)\.ics$/.exec(url)[1]).digest('hex');
const NOT_HERE = 'There is no calendar at this address.';

const servers = [];
try {
  const single = await startServer(appCopy('single'));
  servers.push(single);
  const { call, signIn } = single;
  const admin = await signIn('admin', 'testpass1234');
  const mk = async (login) => {
    const r = await call('POST', '/api/users', { cookie: admin, body: { login, displayName: login, role: 'member', password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
    return r.json.user.key;
  };
  const [alice, bob, carol] = [await mk('alice'), await mk('bob'), await mk('carol')];
  const spaceA = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Keep, East', members: [alice, carol] } })).json.space.id;
  const spaceB = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Tower', members: [bob] } })).json.space.id;
  // A creator is a member of the space they make (GitHub #239); these cases want the admin outside both.
  await call('PATCH', `/api/spaces/${spaceA}`, { cookie: admin, body: { members: [alice, carol] } });
  await call('PATCH', `/api/spaces/${spaceB}`, { cookie: admin, body: { members: [bob] } });
  const guestToken = (await call('POST', `/api/spaces/${spaceA}/guest-link`, { cookie: admin, body: {} })).json.space.guestToken;
  const [aliceC, bobC, carolC] = [await signIn('alice', 'memberpass1234'), await signIn('bob', 'memberpass1234'), await signIn('carol', 'memberpass1234')];
  const setting = async (value) => {
    const r = await call('PATCH', '/api/settings', { cookie: admin, body: { calendarFeeds: value } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.settings.calendarFeeds, value);
  };
  const put = async (moduleId, key, value, where = 'environment') => {
    const q = where === 'environment' ? 'scope=environment' : `scope=space&space=${where}`;
    const r = await call('PUT', `/api/modules/${moduleId}/data/${encodeURIComponent(key)}?${q}`, { cookie: admin, body: { value, tz: NY } });
    assert.equal(r.status, 200, r.text);
  };
  const read = (url, headers = {}) => call('GET', feedPath(url), { headers: { accept: 'text/calendar', ...headers } });
  const notHere = async (url, why) => {
    const r = await read(url);
    assert.deepEqual([r.status, r.text, String(r.headers['content-type']).split(';')[0], r.headers.location], [404, NOT_HERE, 'text/plain', undefined], why);
  };

  // plan-space-calendars.md, step 1: Calendar sharing's other two switches, off in a single install with nothing set.
  const storedSettings = () => JSON.parse(fs.readFileSync(path.join(single.root, 'data', 'app.json'), 'utf8')).settings;
  await test('server: otherCalendars and publishedCalendar read off with nothing set, take only true or false, and only from owners', async () => {
    const got = (await call('GET', '/api/settings', { cookie: admin })).json.settings;
    assert.deepEqual([got.calendarFeeds, got.otherCalendars, got.publishedCalendar], [false, false, false]);
    assert.equal('otherCalendars' in storedSettings(), false, 'nothing written for otherCalendars');
    for (const key of ['otherCalendars', 'publishedCalendar']) {
      const bad = await call('PATCH', '/api/settings', { cookie: admin, body: { [key]: 'yes' } });
      assert.deepEqual([bad.status, bad.json], [400, { error: `${key} is true or false` }], key);
      assert.equal((await call('PATCH', '/api/settings', { cookie: aliceC, body: { [key]: true } })).status, 403, `a member cannot turn on ${key}`);
    }
    assert.equal('otherCalendars' in storedSettings(), false, 'a refused change writes nothing');
  });

  // GitHub #199: autoJoinCall, the environment's "join the call on entering a space" switch. Off by default, true or
  // false only, owners only, and carried by /api/branding (what the space page reads) as well as GET /api/settings.
  await test('server: autoJoinCall reads off by default, takes only true or false, is carried by /api/branding, and is set by owners', async () => {
    assert.equal((await call('GET', '/api/branding')).json.autoJoinCall, false, 'off with nothing set');
    assert.equal((await call('GET', '/api/settings', { cookie: admin })).json.settings.autoJoinCall, false);
    const bad = await call('PATCH', '/api/settings', { cookie: admin, body: { autoJoinCall: 'yes' } });
    assert.deepEqual([bad.status, bad.json], [400, { error: 'autoJoinCall is true or false' }]);
    assert.equal((await call('PATCH', '/api/settings', { cookie: aliceC, body: { autoJoinCall: true } })).status, 403, 'a member cannot turn it on');
    assert.equal((await call('GET', '/api/branding')).json.autoJoinCall, false, 'a refused change changes nothing');
    const on = await call('PATCH', '/api/settings', { cookie: admin, body: { autoJoinCall: true } });
    assert.deepEqual([on.status, on.json.settings.autoJoinCall, storedSettings().autoJoinCall], [200, true, true]);
    assert.equal((await call('GET', '/api/branding')).json.autoJoinCall, true, 'carried by /api/branding');
    const off = await call('PATCH', '/api/settings', { cookie: admin, body: { autoJoinCall: false } });
    assert.deepEqual([off.status, off.json.settings.autoJoinCall, (await call('GET', '/api/branding')).json.autoJoinCall], [200, false, false]);
    const adminJs = fs.readFileSync(path.join(ROOT, 'public', 'admin.js'), 'utf8');
    assert.ok(adminJs.includes("autoJoinCall: $('set-auto-join-call').checked"), 'Manage > Call features saves the switch');
    assert.ok(adminJs.includes("$('set-auto-join-call').checked = settings.autoJoinCall === true"), 'and draws it from the settings');
  });

  await test('server: the setting is off by default, refused when not true or false, and a feed is not allowed until it is on and a kind is offered', async () => {
    assert.equal((await call('GET', '/api/settings', { cookie: admin })).json.settings.calendarFeeds, false);
    const bad = await call('PATCH', '/api/settings', { cookie: admin, body: { calendarFeeds: 'yes' } });
    assert.equal(bad.status, 400, bad.text);
    assert.deepEqual(await call('GET', '/api/me/feed', { cookie: aliceC }).then((r) => [r.status, r.json]), [200, { allowed: false, on: false, made: null, readAt: null }]);
    const refused = await call('POST', '/api/me/feed', { cookie: aliceC, body: {} });
    assert.equal(refused.status, 403);
    assert.equal(typeof refused.json.error, 'string');
    assert.equal((await call('PATCH', '/api/settings', { cookie: aliceC, body: { calendarFeeds: true } })).status, 403, 'a member cannot turn it on');
    await setting(true);
    assert.equal((await call('GET', '/api/me/feed', { cookie: aliceC })).json.allowed, false, 'on, but no enabled module offers a kind');
    for (const id of ['feed-dates', 'feed-plans', 'feed-quiet']) {
      { const r = await call('POST', `/api/modules/bundled/${id}/install`, { cookie: admin, body: {} }); assert.equal(r.status, 201, `${id}: ${r.text}\n${single.output().slice(-1500)}`); }
      assert.equal((await call('PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: true, allSpaces: true } })).status, 200, id);
    }
    assert.equal((await call('GET', '/api/me/feed', { cookie: aliceC })).json.allowed, true);
    // A guest has no account, so no feed.
    assert.equal((await call('GET', `/api/me/feed?guest=${guestToken}`)).status, 401);
    assert.equal((await call('POST', `/api/me/feed?guest=${guestToken}`, { body: {} })).status, 401);
  });

  await test('server: otherCalendars follows calendarFeeds until an owner sets it, then is its own; publishedCalendar is its own', async () => {
    let got = (await call('GET', '/api/settings', { cookie: admin })).json.settings;
    assert.deepEqual([got.calendarFeeds, got.otherCalendars], [true, true], 'an environment that allowed other calendars still does');
    assert.equal('otherCalendars' in storedSettings(), false, 'read, not rewritten');
    const off = await call('PATCH', '/api/settings', { cookie: admin, body: { otherCalendars: false } });
    assert.equal(off.status, 200, off.text);
    assert.deepEqual([off.json.settings.calendarFeeds, off.json.settings.otherCalendars], [true, false]);
    assert.equal(storedSettings().otherCalendars, false);
    assert.equal((await call('GET', '/api/me/feed', { cookie: aliceC })).json.allowed, true, 'the addresses do not hang on it');
    await setting(false);
    await setting(true);
    got = (await call('GET', '/api/settings', { cookie: admin })).json.settings;
    assert.equal(got.otherCalendars, false, 'once set, Calendar feeds no longer moves it');
    assert.equal((await call('PATCH', '/api/settings', { cookie: admin, body: { otherCalendars: true } })).json.settings.otherCalendars, true);
    for (const value of [true, false]) {
      const r = await call('PATCH', '/api/settings', { cookie: admin, body: { publishedCalendar: value } });
      assert.deepEqual([r.status, r.json.settings.publishedCalendar, r.json.settings.calendarFeeds, r.json.settings.otherCalendars], [200, value, true, true]);
      assert.equal(storedSettings().publishedCalendar, value);
    }
  });

  // `sharing` and `sharingReasons` in GET /api/modules: what Calendar's Configure page draws its section from.
  const moduleRow = async (id) => (await call('GET', '/api/modules', { cookie: admin })).json.modules.find((m) => m.id === id);
  await test('server: a module offering a kind to the addresses takes part in calendar sharing; one that does not, not', async () => {
    const dates = await moduleRow('feed-dates');
    assert.deepEqual([dates.sharing, dates.sharingReasons], [true, { calendarFeeds: null, publishedCalendar: null }]);
    for (const id of ['feed-plans', 'feed-quiet']) {
      const m = await moduleRow(id);
      assert.deepEqual([m.sharing, m.sharingReasons], [false, null], `${id}: no kind offered`);
    }
    assert.equal((await call('GET', '/api/modules', { cookie: aliceC })).status, 403, 'owners only');
  });

  await test('server: a newer bundled version asking for the external hook makes the running one take part, waiting for its update', async () => {
    { const r = await call('POST', '/api/modules/bundled/feed-later/install', { cookie: admin, body: {} }); assert.equal(r.status, 201, r.text); }
    let m = await moduleRow('feed-later');
    assert.deepEqual([m.version, m.sharing, m.sharingReasons], ['1.0.0', false, null]);
    const file = path.join(single.root, 'modules', 'feed-later', 'module.json');
    const was = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(was), version: '1.1.0', hooks: { external: true } }));
    try {
      m = await moduleRow('feed-later');
      assert.deepEqual([m.version, m.sharing, m.sharingReasons], ['1.0.0', true, { otherCalendars: { hooks: ['external'], reason: 'Approve feed-later\'s update in Manage > Modules first.' } }]);
    } finally {
      fs.writeFileSync(file, was);
    }
    assert.equal((await call('DELETE', '/api/modules/feed-later?keepData=0', { cookie: admin })).status, 200);
  });

  // The events, written as the admin.
  await put('feed-dates', 'event:env1', { title: 'Market day, all; welcome', start: `${Y}-10-10`, end: `${Y}-10-12`, allDay: true, desc: 'Bring coin.\nAnd bags.' });
  await put('feed-dates', 'event:a1', { title: 'Session in A', start: `${Y}-10-20T22:00:00.000Z`, end: `${Y}-10-20T23:30:00.000Z`, allDay: false, desc: '', repeat: { every: 'week', until: `${Y}-11-30` } }, spaceA);
  await put('feed-dates', 'event:a2', { title: 'Rent in A', start: `${Y}-01-31`, allDay: true, repeat: { every: 'month', until: null } }, spaceA);
  await put('feed-dates', 'event:b1', { title: 'Session in B', start: `${Y}-10-21T22:00:00.000Z`, allDay: false }, spaceB);
  await put('feed-dates', 'event:old', { title: 'Long ago', start: new Date(Date.now() - 200 * 86400000).toISOString(), end: new Date(Date.now() - 199 * 86400000).toISOString(), allDay: false });
  await put('feed-plans', 'plan:p1', { title: 'Dinner at the inn', date: `${Y}-10-22`, time: '19:30' }, spaceA);
  await put('feed-quiet', 'note:n1', { title: 'A quiet note', start: `${Y}-10-23T12:00:00.000Z` }, spaceA);

  let aliceUrl = null;
  await test('server: the address is shown once, kept only as its hash, and holds the environment\'s and space A\'s events for a member of A', async () => {
    const made = await call('POST', '/api/me/feed', { cookie: aliceC, body: {} });
    assert.equal(made.status, 201, made.text);
    assert.match(made.json.url, /^http:\/\/localhost:\d+\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    assert.ok(!Number.isNaN(Date.parse(made.json.made)));
    aliceUrl = made.json.url;
    const token = /\/feed\/(.+)\.ics$/.exec(aliceUrl)[1];
    const stored = fs.readFileSync(path.join(single.root, 'data', 'app.json'), 'utf8');
    assert.ok(!stored.includes(token), 'no token in app.json');
    assert.deepEqual(Object.keys(JSON.parse(stored).users.find((u) => u.key === alice).calendarFeed).sort(), ['hash', 'made', 'readAt']);
    assert.equal(JSON.parse(stored).users.find((u) => u.key === alice).calendarFeed.hash, hashOf(aliceUrl));
    const state = (await call('GET', '/api/me/feed', { cookie: aliceC })).json;
    assert.deepEqual([state.allowed, state.on, state.made, state.readAt], [true, true, made.json.made, null]);
    assert.ok(!JSON.stringify(state).includes(token) && !JSON.stringify(state).includes(hashOf(aliceUrl)), 'not shown again');

    const r = await read(aliceUrl);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.headers['content-type'], 'text/calendar; charset=utf-8');
    assert.ok(r.headers.etag);
    const events = rfcEvents(r.text);
    const titles = events.map((e) => text(e, 'SUMMARY')).sort();
    assert.deepEqual(titles, ['Dinner at the inn', 'Market day, all; welcome', 'Rent in A', 'Session in A'], 'not B\'s, not the quiet note, not one long past');
    assert.ok(r.text.includes('X-WR-CALNAME:') && r.text.includes(`X-WR-TIMEZONE:${NY}\r\n`));
    const byTitle = Object.fromEntries(events.map((e) => [text(e, 'SUMMARY'), e]));
    assert.equal(text(byTitle['Market day, all; welcome'], 'UID'), 'event-env1-environment@localhost');
    assert.equal(text(byTitle['Session in A'], 'UID'), `event-a1-${spaceA}@localhost`);
    assert.equal(prop(byTitle['Market day, all; welcome'], 'DTEND').value, `${Y}1013`);
    assert.equal(prop(byTitle['Session in A'], 'DTSTART').value, `${Y}1020T180000`);
    assert.equal(prop(byTitle['Session in A'], 'DTSTART').params.TZID, NY);
    assert.equal(prop(byTitle['Rent in A'], 'RRULE').value, 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
    // The Planner-like object appears once, as its twin: the dates module's own event, timed in UTC.
    const dinner = byTitle['Dinner at the inn'];
    assert.match(text(dinner, 'UID'), new RegExp(`^event-[A-Za-z0-9_-]+-${spaceA}@localhost$`));
    assert.equal(prop(dinner, 'DTSTART').value, `${Y}1022T233000Z`);
    // The description: the space's name, the event's own, then the link back; URL the same link. The Calendar
    // destination is off, so the link is the module's page in that space.
    const envName = (await call('GET', '/api/settings', { cookie: admin })).json.settings.environmentName;
    assert.ok(envName, 'the environment has a name');
    assert.deepEqual(text(byTitle['Market day, all; welcome'], 'DESCRIPTION').split('\n').slice(0, 3), [envName, 'Bring coin.', 'And bags.']);
    assert.equal(text(byTitle['Market day, all; welcome'], 'DESCRIPTION').split('\n').length, 4, 'the name, two lines of its own, the link');
    assert.equal(text(byTitle['Session in A'], 'DESCRIPTION').split('\n')[0], 'Keep, East');
    const link = prop(byTitle['Session in A'], 'URL').value;
    assert.ok(link.startsWith(`http://localhost:`) && link.includes(`/modules/feed-dates?space=${spaceA}#ref=`), link);
    assert.deepEqual(JSON.parse(decodeURIComponent(link.split('#ref=')[1])), { module: 'feed-dates', kind: 'event', id: 'a1', scope: 'space', space: spaceA });
    assert.equal(text(byTitle['Session in A'], 'DESCRIPTION').split('\n').at(-1), link);
    // Read once: Profile's "Last read".
    assert.ok((await call('GET', '/api/me/feed', { cookie: aliceC })).json.readAt);
  });

  await test('server: with the Calendar destination shown, the link goes to /calendar#ref=', async () => {
    assert.equal((await call('PATCH', '/api/settings', { cookie: admin, body: { showCalendar: true } })).status, 200);
    const r = await read(aliceUrl);
    const env1 = rfcEvents(r.text).find((e) => text(e, 'SUMMARY').startsWith('Market'));
    const link = prop(env1, 'URL').value;
    assert.match(link, /^http:\/\/localhost:\d+\/calendar#ref=/);
    assert.deepEqual(JSON.parse(decodeURIComponent(link.split('#ref=')[1])), { module: 'feed-dates', kind: 'event', id: 'env1', scope: 'environment' });
    assert.equal((await call('PATCH', '/api/settings', { cookie: admin, body: { showCalendar: false } })).status, 200);
  });

  await test('server: ETag and 304', async () => {
    const r = await read(aliceUrl);
    const again = await read(aliceUrl, { 'if-none-match': r.headers.etag });
    assert.deepEqual([again.status, again.text], [304, '']);
    assert.equal((await read(aliceUrl, { 'if-none-match': '"something-else"' })).status, 200);
    await put('feed-dates', 'event:env2', { title: 'Something new', start: `${Y}-11-01`, allDay: true });
    const changed = await read(aliceUrl, { 'if-none-match': r.headers.etag });
    assert.equal(changed.status, 200, 'a change makes a new ETag');
    assert.notEqual(changed.headers.etag, r.headers.etag);
  });

  await test('server: each read uses the person\'s current rights: a module off, or no read, empties it', async () => {
    const titles = async () => rfcEvents((await read(aliceUrl)).text).map((e) => text(e, 'SUMMARY')).sort();
    assert.equal((await call('PATCH', '/api/modules/feed-dates', { cookie: admin, body: { enabled: false } })).status, 200);
    assert.deepEqual(await titles(), [], 'the module off: no events');
    assert.equal((await call('PATCH', '/api/modules/feed-dates', { cookie: admin, body: { enabled: true } })).status, 200);
    assert.equal((await call('PATCH', '/api/roles/member', { cookie: admin, body: { 'module.feed-dates.view': false } })).status, 200);
    const r = await read(aliceUrl);
    assert.equal(r.status, 200, 'still answers, empty');
    assert.deepEqual(rfcEvents(r.text), []);
    assert.equal((await call('GET', '/api/me/feed', { cookie: aliceC })).json.allowed, false);
    assert.equal((await call('POST', '/api/me/feed', { cookie: bobC, body: {} })).status, 403, 'nothing offered to bob now');
    assert.equal((await call('PATCH', '/api/roles/member', { cookie: admin, body: { 'module.feed-dates.view': true } })).status, 200);
    // Bob, a member of B only, sees B's and the environment's.
    const bobUrl = (await call('POST', '/api/me/feed', { cookie: bobC, body: {} })).json.url;
    assert.deepEqual(rfcEvents((await read(bobUrl)).text).map((e) => text(e, 'SUMMARY')).sort(), ['Market day, all; welcome', 'Session in B', 'Something new']);
  });

  await test('server: 404 for an unknown token and with the setting off; on again, the same address works', async () => {
    await notHere(`http://localhost/feed/${'A'.repeat(43)}.ics`, 'an unknown token');
    await notHere('http://localhost/feed/nonsense.ics', 'not a token');
    await setting(false);
    await notHere(aliceUrl, 'the setting off');
    assert.equal((await call('GET', '/api/me/feed', { cookie: aliceC })).json.on, true, 'turning the setting off deletes nothing');
    await setting(true);
    assert.equal((await read(aliceUrl)).status, 200);
  });

  await test('server: New address stops the old one; Turn off stops it; an owner\'s Turn off stops it and never shows the address', async () => {
    const old = aliceUrl;
    const fresh = await call('POST', '/api/me/feed', { cookie: aliceC, body: {} });
    assert.equal(fresh.status, 201);
    await notHere(old, 'the old address after New address');
    assert.equal((await read(fresh.json.url)).status, 200);
    const off = await call('DELETE', '/api/me/feed', { cookie: aliceC });
    assert.deepEqual([off.status, off.text], [204, '']);
    await notHere(fresh.json.url, 'after Turn off');
    assert.deepEqual((await call('GET', '/api/me/feed', { cookie: aliceC })).json, { allowed: true, on: false, made: null, readAt: null });
    // The owner's view and Turn off.
    const again = (await call('POST', '/api/me/feed', { cookie: aliceC, body: {} })).json.url;
    const seen = await call('GET', `/api/users/${alice}`, { cookie: admin });
    assert.deepEqual(Object.keys(seen.json.user.calendarFeed).sort(), ['made', 'on', 'readAt']);
    assert.equal(seen.json.user.calendarFeed.on, true);
    for (const r of [seen, await call('GET', '/api/users', { cookie: admin }), await call('GET', '/api/me', { cookie: aliceC })]) {
      assert.ok(!r.text.includes(/\/feed\/(.+)\.ics/.exec(again)[1]) && !r.text.includes(hashOf(again)), 'neither the token nor its hash in any answer');
    }
    assert.equal((await call('DELETE', `/api/users/${alice}/feed`, { cookie: carolC })).status, 403, 'a member cannot');
    assert.equal((await call('DELETE', '/api/users/nobody1/feed', { cookie: admin })).status, 404);
    assert.equal((await call('DELETE', `/api/users/${alice}/feed`, { cookie: admin })).status, 204);
    await notHere(again, 'after an owner turns it off');
    assert.equal((await call('GET', `/api/users/${alice}`, { cookie: admin })).json.user.calendarFeed.on, false);
    aliceUrl = (await call('POST', '/api/me/feed', { cookie: aliceC, body: {} })).json.url;
  });

  await test('server: 429 past 30 reads a minute for one address, with Retry-After', async () => {
    const url = (await call('POST', '/api/me/feed', { cookie: carolC, body: {} })).json.url;
    for (let i = 0; i < 30; i += 1) assert.equal((await read(url)).status, 200, `read ${i + 1}`);
    const r = await read(url);
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers['retry-after']) > 0);
    assert.equal(String(r.headers['content-type']).split(';')[0], 'text/plain');
    assert.equal((await read(aliceUrl)).status, 200, 'another address is not held back');
  });

  // The bundled Calendar (1.20.0) itself: its events reach the feed, a repeat as its RRULE.
  await test('server: the bundled Calendar\'s events are in the feed, with their repeat', async () => {
    for (const id of ['feed-dates', 'feed-plans']) assert.equal((await call('PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: false } })).status, 200, id);
    { const r = await call('POST', '/api/modules/bundled/calendar/install', { cookie: admin, body: {} }); assert.ok([201, 409].includes(r.status), r.text); }
    // Calendar takes part in every switch; its `external` hook waits for approval until it is turned on.
    const waiting = await moduleRow('calendar');
    assert.deepEqual([waiting.sharing, waiting.sharingReasons], [true, { calendarFeeds: null, publishedCalendar: null, otherCalendars: { hooks: ['external'], reason: 'Approve Calendar\'s update in Manage > Modules first.' } }]);
    assert.equal((await call('PATCH', '/api/modules/calendar', { cookie: admin, body: { enabled: true, allSpaces: true } })).status, 200);
    assert.deepEqual((await moduleRow('calendar')).sharingReasons, { calendarFeeds: null, publishedCalendar: null, otherCalendars: null }, 'approved: nothing waits');
    await put('calendar', 'event:c1', { title: 'Weekly game', start: `${Y}-03-04T23:00:00.000Z`, end: `${Y}-03-05T02:00:00.000Z`, allDay: false, desc: 'Bring dice.', remind: null, repeat: { every: 'week', until: `${Y}-06-30` }, by: 'admin' }, spaceA);
    const url = (await call('POST', '/api/me/feed', { cookie: carolC, body: {} })).json.url;
    const r = await read(url);
    assert.equal(r.status, 200);
    const game = rfcEvents(r.text).find((e) => text(e, 'SUMMARY') === 'Weekly game');
    assert.ok(game, 'the Calendar\'s event is in the feed');
    assert.match(prop(game, 'RRULE').value, /^FREQ=WEEKLY;UNTIL=/);
    assert.ok(text(game, 'DESCRIPTION').includes('Bring dice.'));
    assert.ok(!rfcEvents(r.text).some((e) => text(e, 'SUMMARY') === 'Session in A'), 'a module turned off is not read');
    assert.equal((await call('PATCH', '/api/modules/calendar', { cookie: admin, body: { enabled: false } })).status, 200);
    for (const id of ['feed-dates', 'feed-plans']) assert.equal((await call('PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: true, allSpaces: true } })).status, 200, id);
  });

  // --- space addresses (plan-space-calendars.md, section 1, step 3) ---------------------------------------------------
  // State here: calendarFeeds on, feed-dates and feed-plans on in every space, the bundled Calendar installed but off;
  // alice and carol in A, bob in B; alice holds a personal address (aliceUrl).
  const stored = () => JSON.parse(fs.readFileSync(path.join(single.root, 'data', 'app.json'), 'utf8'));
  const envName = (await call('GET', '/api/settings', { cookie: admin })).json.settings.environmentName;
  const calendars = async (cookie) => { const r = await call('GET', '/api/me/calendars', { cookie }); assert.equal(r.status, 200, r.text); return r.json; };
  const rowOf = (tab, id) => tab.spaces.find((s) => s.id === id);
  const spaceTitles = async (url) => { const r = await read(url); assert.equal(r.status, 200, r.text); return rfcEvents(r.text).map((e) => text(e, 'SUMMARY')).sort(); };
  let aliceA = null;

  await test('space addresses: GET /api/me/calendars answers the tab in one: switches, reasons, the module, the personal address, one row per space the person is in', async () => {
    const tab = await calendars(aliceC);
    assert.deepEqual(tab.switches, { addresses: true, otherCalendars: true });
    assert.equal(tab.reasons.addresses, null);
    assert.equal(typeof tab.reasons.otherCalendars, 'string', 'no enabled module asks for the external hook: a reason');
    assert.deepEqual(tab.module, { id: 'feed-dates', name: 'feed-dates', on: true });
    assert.deepEqual(tab.everything, { allowed: true, reason: null, on: true, made: tab.everything.made, readAt: tab.everything.readAt });
    assert.ok(tab.everything.made && tab.everything.readAt);
    assert.deepEqual(tab.spaces.map((s) => s.id), [spaceA], 'only the spaces she is in, never the Lobby');
    const row = rowOf(tab, spaceA);
    assert.deepEqual([row.name, typeof row.icon, row.svg.startsWith('<svg')], ['Keep, East', 'string', true]);
    assert.deepEqual(row.address, { allowed: true, reason: null, on: false, made: null, readAt: null });
    assert.deepEqual(['allowed', 'calendars'], Object.keys(tab.external).sort());
    assert.deepEqual((await calendars(bobC)).spaces.map((s) => s.id), [spaceB]);
    assert.deepEqual((await calendars(admin)).spaces, [], 'an owner who is in no space has no row');
    assert.equal((await call('GET', `/api/me/calendars?guest=${guestToken}`)).status, 401, 'a guest has no account, so no tab');
  });

  await test('space addresses: made once, kept only as its hash, holding that one space\'s events under its name, with the personal address untouched', async () => {
    const made = await call('POST', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC, body: {} });
    assert.equal(made.status, 201, made.text);
    assert.match(made.json.url, /^http:\/\/localhost:\d+\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    assert.ok(!Number.isNaN(Date.parse(made.json.made)));
    aliceA = made.json.url;
    const token = /\/feed\/(.+)\.ics$/.exec(aliceA)[1];
    const raw = fs.readFileSync(path.join(single.root, 'data', 'app.json'), 'utf8');
    assert.ok(!raw.includes(token), 'no token in app.json');
    const entry = stored().users.find((u) => u.key === alice).spaces[spaceA].calendarFeed;
    assert.deepEqual([Object.keys(entry).sort(), entry.hash], [['hash', 'made', 'readAt'], hashOf(aliceA)]);
    assert.notEqual(entry.hash, hashOf(aliceUrl), 'its own token, beside the personal one');
    const r = await read(aliceA);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.headers['content-type'], 'text/calendar; charset=utf-8');
    assert.ok(r.text.includes('X-WR-CALNAME:Keep\\, East\r\n'), 'named after the space');
    const events = rfcEvents(r.text);
    assert.deepEqual(events.map((e) => text(e, 'SUMMARY')).sort(), ['Dinner at the inn', 'Rent in A', 'Session in A'], 'A\'s only: not the environment\'s, not B\'s, not the quiet note');
    const session = events.find((e) => text(e, 'SUMMARY') === 'Session in A');
    assert.equal(text(session, 'UID'), `event-a1-${spaceA}@localhost`, 'the UID the personal address gives it');
    assert.equal(text(session, 'DESCRIPTION'), prop(session, 'URL').value, 'the description omits the space\'s name: only the link, since the event has no description of its own');
    const rent = events.find((e) => text(e, 'SUMMARY') === 'Rent in A');
    assert.ok(!text(rent, 'DESCRIPTION').includes('Keep, East'));
    const row = rowOf(await calendars(aliceC), spaceA);
    assert.deepEqual([row.address.allowed, row.address.on, row.address.made, Boolean(row.address.readAt)], [true, true, made.json.made, true], 'on, with Last read');
    assert.ok(!JSON.stringify(row).includes(token) && !JSON.stringify(row).includes(hashOf(aliceA)), 'not shown again');
    assert.deepEqual(await spaceTitles(aliceUrl), ['Dinner at the inn', 'Market day, all; welcome', 'Rent in A', 'Session in A', 'Something new'], 'the personal address still holds everything');
    const again = await read(aliceA, { 'if-none-match': r.headers.etag });
    assert.equal(again.status, 304);
  });

  await test('space addresses: none for a guest, for someone not in the space, or for an owner who is not a member', async () => {
    assert.equal((await call('POST', `/api/me/spaces/${spaceA}/feed?guest=${guestToken}`, { body: {} })).status, 401);
    const bob = await call('POST', `/api/me/spaces/${spaceA}/feed`, { cookie: bobC, body: {} });
    assert.deepEqual([bob.status, bob.json], [403, { error: 'You are not in this space.' }]);
    const owner = await call('POST', `/api/me/spaces/${spaceA}/feed`, { cookie: admin, body: {} });
    assert.deepEqual([owner.status, owner.json], [403, { error: 'You are not in this space.' }], 'managing a space is not being in it');
    assert.equal((await call('POST', '/api/me/spaces/nowhere1/feed', { cookie: aliceC, body: {} })).status, 404);
    assert.equal((await call('POST', '/api/me/spaces/lobby/feed', { cookie: aliceC, body: {} })).status, 404, 'the Lobby is not a space one is a member of');
  });

  await test('space addresses: 404 while the module is off or the person cannot read it there, with the row saying why', async () => {
    assert.equal((await call('PATCH', '/api/modules/feed-dates', { cookie: admin, body: { enabled: false } })).status, 200);
    await notHere(aliceA, 'the module off');
    let row = rowOf(await calendars(aliceC), spaceA);
    assert.deepEqual([row.address.allowed, /^feed-dates is off in .+\.$/.test(row.address.reason), row.address.on], [false, true, true], 'the address is kept, not deleted');
    const refused = await call('POST', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC, body: {} });
    assert.deepEqual([refused.status, /^feed-dates is off in .+\.$/.test(refused.json.error)], [403, true]);
    assert.equal((await call('PATCH', '/api/modules/feed-dates', { cookie: admin, body: { enabled: true } })).status, 200);
    assert.equal((await read(aliceA)).status, 200, 'on again: the same address works');
    assert.equal((await call('PATCH', '/api/roles/member', { cookie: admin, body: { 'module.feed-dates.view': false } })).status, 200);
    await notHere(aliceA, 'no read in A');
    row = rowOf(await calendars(aliceC), spaceA);
    assert.deepEqual([row.address.allowed, row.address.reason], [false, 'feed-dates is off in this space.']);
    assert.equal((await call('PATCH', '/api/roles/member', { cookie: admin, body: { 'module.feed-dates.view': true } })).status, 200);
    assert.equal((await read(aliceA)).status, 200);
  });

  await test('space addresses: 404 with the switch off, and the reasons a member and an owner read', async () => {
    await setting(false);
    await notHere(aliceA, 'the switch off');
    const member = await calendars(aliceC);
    assert.deepEqual([member.switches.addresses, member.reasons.addresses], [false, `Owners have not turned on private addresses in ${envName}.`]);
    assert.deepEqual([member.everything.allowed, member.everything.reason, member.everything.on], [false, member.reasons.addresses, true]);
    assert.deepEqual([rowOf(member, spaceA).address.allowed, rowOf(member, spaceA).address.reason], [false, member.reasons.addresses]);
    const owner = await calendars(admin);
    assert.equal(owner.reasons.addresses, `Owners have not turned on private addresses in ${envName}. Turn it on in feed-dates's configuration.`);
    const refused = await call('POST', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC, body: {} });
    assert.deepEqual([refused.status, refused.json.error], [403, member.reasons.addresses]);
    assert.equal((await call('DELETE', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC })).status, 204, 'Turn off is still offered');
    await setting(true);
    await notHere(aliceA, 'turned off while the switch was off: gone for good');
    assert.equal(rowOf(await calendars(aliceC), spaceA).address.on, false);
    aliceA = (await call('POST', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC, body: {} })).json.url;
    assert.equal((await read(aliceA)).status, 200);
  });

  await test('space addresses: New address stops the old one; Turn off stops it; an owner\'s Turn off stops it and never shows it', async () => {
    const old = aliceA;
    const fresh = await call('POST', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC, body: {} });
    assert.equal(fresh.status, 201);
    await notHere(old, 'the old address after New address');
    assert.equal((await read(fresh.json.url)).status, 200);
    assert.equal((await read(aliceUrl)).status, 200, 'the personal address is not touched');
    const off = await call('DELETE', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC });
    assert.deepEqual([off.status, off.text], [204, '']);
    await notHere(fresh.json.url, 'after Turn off');
    assert.equal('calendarFeed' in stored().users.find((u) => u.key === alice).spaces[spaceA], false, 'deleted, not kept');
    assert.equal((await call('DELETE', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC })).status, 204, 'turning off nothing is fine');
    // The owner's view and Turn off.
    const again = (await call('POST', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC, body: {} })).json.url;
    const seen = await call('GET', `/api/users/${alice}`, { cookie: admin });
    assert.deepEqual(Object.keys(seen.json.user.spaces[spaceA].calendarFeed).sort(), ['made', 'on', 'readAt']);
    assert.equal(seen.json.user.spaces[spaceA].calendarFeed.on, true);
    for (const r of [seen, await call('GET', '/api/users', { cookie: admin }), await call('GET', '/api/me', { cookie: aliceC }), await call('GET', '/api/me/calendars', { cookie: aliceC })]) {
      assert.ok(!r.text.includes(/\/feed\/(.+)\.ics$/.exec(again)[1]) && !r.text.includes(hashOf(again)), 'neither the token nor its hash in any answer');
    }
    assert.equal((await call('DELETE', `/api/users/${alice}/spaces/${spaceA}/feed`, { cookie: carolC })).status, 403, 'a member cannot');
    assert.equal((await call('DELETE', `/api/users/nobody1/spaces/${spaceA}/feed`, { cookie: admin })).status, 404);
    assert.equal((await call('DELETE', `/api/users/${alice}/spaces/${spaceA}/feed`, { cookie: admin })).status, 204);
    await notHere(again, 'after an owner turns it off');
    assert.equal((await call('GET', `/api/users/${alice}`, { cookie: admin })).json.user.spaces[spaceA].calendarFeed.on, false);
    aliceA = (await call('POST', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC, body: {} })).json.url;
  });

  await test('space addresses: removing someone from the space, or taking them off its member list, deletes their token; deleting the space deletes every token for it', async () => {
    assert.equal((await call('DELETE', `/api/spaces/${spaceA}/members/${alice}`, { cookie: admin })).status, 200);
    await notHere(aliceA, 'after removal');
    const entry = stored().users.find((u) => u.key === alice).spaces[spaceA];
    assert.ok(entry && !('calendarFeed' in entry), 'the token is gone from app.json; her pictures and ticks there stay');
    assert.equal(rowOf(await calendars(aliceC), spaceA), undefined, 'no row for a space she is not in');
    assert.equal((await call('PATCH', `/api/spaces/${spaceA}`, { cookie: admin, body: { members: [alice, carol] } })).status, 200);
    aliceA = (await call('POST', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC, body: {} })).json.url;
    assert.equal((await read(aliceA)).status, 200);
    assert.equal((await call('PATCH', `/api/spaces/${spaceA}`, { cookie: admin, body: { members: [carol] } })).status, 200, 'taken off the member list');
    await notHere(aliceA, 'after the member list changed');
    assert.equal('calendarFeed' in stored().users.find((u) => u.key === alice).spaces[spaceA], false);
    assert.equal((await call('PATCH', `/api/spaces/${spaceA}`, { cookie: admin, body: { members: [alice, carol] } })).status, 200);
    // A space of its own, deleted.
    const spaceC = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Gone soon', members: [alice] } })).json.space.id;
    const c = (await call('POST', `/api/me/spaces/${spaceC}/feed`, { cookie: aliceC, body: {} })).json.url;
    assert.equal((await read(c)).status, 200);
    assert.equal((await call('DELETE', `/api/spaces/${spaceC}`, { cookie: admin })).status, 200);
    await notHere(c, 'after the space is deleted');
    assert.equal(stored().users.find((u) => u.key === alice).spaces[spaceC]?.calendarFeed, undefined);
    assert.equal((await read(aliceUrl)).status, 200, 'the personal address is not touched by any of it');
    aliceA = (await call('POST', `/api/me/spaces/${spaceA}/feed`, { cookie: aliceC, body: {} })).json.url;
  });

  // --- the published calendar (plan-space-calendars.md, section 2, step 4) ------------------------------------------
  const published = () => call('GET', '/api/settings', { cookie: admin }).then((r) => r.json.settings.publishedCalendarFeed);
  const publish = (value) => call('PATCH', '/api/settings', { cookie: admin, body: { publishedCalendar: value } }).then((r) => { assert.equal(r.status, 200, r.text); });
  let pubUrl = null;
  await test('published calendar: owners and the admin make it while its switch is on; 403 while off; members never', async () => {
    assert.deepEqual(await published(), { on: false, made: null, readAt: null });
    const off = await call('POST', '/api/settings/published-calendar', { cookie: admin, body: {} });
    assert.deepEqual([off.status, off.json], [403, { error: 'The published calendar is off in this environment.' }]);
    await publish(true);
    assert.equal((await call('POST', '/api/settings/published-calendar', { cookie: aliceC, body: {} })).status, 403, 'owners only');
    assert.equal((await call('DELETE', '/api/settings/published-calendar', { cookie: aliceC })).status, 403);
    const made = await call('POST', '/api/settings/published-calendar', { cookie: admin, body: {} });
    assert.equal(made.status, 201, made.text);
    assert.match(made.json.url, /^http:\/\/localhost:\d+\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    pubUrl = made.json.url;
    const token = /\/feed\/(.+)\.ics$/.exec(pubUrl)[1];
    const raw = fs.readFileSync(path.join(single.root, 'data', 'app.json'), 'utf8');
    assert.ok(!raw.includes(token), 'no token in app.json');
    const kept = stored().settings.publishedCalendarFeed;
    assert.deepEqual([Object.keys(kept).sort(), kept.hash], [['hash', 'made', 'readAt'], hashOf(pubUrl)]);
    const state = await call('GET', '/api/settings', { cookie: admin });
    assert.deepEqual(state.json.settings.publishedCalendarFeed, { on: true, made: made.json.made, readAt: null });
    assert.ok(!state.text.includes(token) && !state.text.includes(kept.hash), 'never the token or its hash');
    assert.ok(!(await call('GET', '/api/me/calendars', { cookie: aliceC })).text.includes('published'), 'not shown to members on Profile');
  });

  await test('published calendar: every space\'s events and the environment\'s, named after the environment, each event naming its space, with nobody\'s rights involved', async () => {
    const r = await read(pubUrl);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.text.includes(`X-WR-CALNAME:${ics.escapeText(envName)}\r\n`));
    const events = rfcEvents(r.text);
    assert.deepEqual(events.map((e) => text(e, 'SUMMARY')).sort(), ['Dinner at the inn', 'Market day, all; welcome', 'Rent in A', 'Session in A', 'Session in B', 'Something new'], 'A\'s and B\'s, not the quiet note, not one long past');
    const byTitle = Object.fromEntries(events.map((e) => [text(e, 'SUMMARY'), e]));
    assert.equal(text(byTitle['Session in B'], 'DESCRIPTION').split('\n')[0], 'Tower');
    assert.equal(text(byTitle['Market day, all; welcome'], 'DESCRIPTION').split('\n')[0], envName);
    // The fields the module keeps from guests (guards.hidden: desc and end) are left out of everything read for it, its
    // dates as well as its words; the personal address above has both.
    assert.doesNotMatch(text(byTitle['Market day, all; welcome'], 'DESCRIPTION'), /Bring coin/, 'no hidden description');
    assert.equal(prop(byTitle['Market day, all; welcome'], 'DTEND').value, `${Y}1011`, 'no hidden end: one day');
    assert.equal(text(byTitle['Session in B'], 'UID'), `event-b1-${spaceB}@localhost`);
    assert.ok(!r.text.includes('busy') && !r.text.includes('BUSY'), 'no busy block');
    assert.ok((await published()).readAt, 'Last read');
    assert.equal((await read(pubUrl, { 'if-none-match': r.headers.etag })).status, 304);
    // No person's rights: members losing read changes nothing here.
    assert.equal((await call('PATCH', '/api/roles/member', { cookie: admin, body: { 'module.feed-dates.view': false } })).status, 200);
    assert.equal(rfcEvents((await read(pubUrl)).text).length, 6);
    assert.equal((await call('PATCH', '/api/roles/member', { cookie: admin, body: { 'module.feed-dates.view': true } })).status, 200);
    // Nor does the private addresses switch.
    await setting(false);
    assert.equal((await read(pubUrl)).status, 200, 'its own switch, not the private addresses\'');
    await notHere(aliceA, 'while the space address is off');
    await setting(true);
  });

  await test('published calendar: a space left out (publishCalendar false) is not in it', async () => {
    const bad = await call('PATCH', `/api/spaces/${spaceB}`, { cookie: admin, body: { publishCalendar: 'yes' } });
    assert.deepEqual([bad.status, bad.json], [400, { error: 'publishCalendar is true or false' }]);
    const lobby = await call('PATCH', '/api/spaces/lobby', { cookie: admin, body: { publishCalendar: false } });
    assert.deepEqual([lobby.status, lobby.json], [400, { error: 'the Lobby is never in the published calendar' }], 'the Lobby is never in it, so it takes no switch');
    assert.equal('publishCalendar' in stored().spaces.find((r) => r.id === 'lobby'), false);
    const out = await call('PATCH', `/api/spaces/${spaceB}`, { cookie: admin, body: { publishCalendar: false } });
    assert.equal(out.status, 200, out.text);
    assert.equal(out.json.space.publishCalendar, false);
    assert.equal((await call('GET', `/api/spaces/${spaceB}`, { cookie: admin })).json.space.publishCalendar, false);
    assert.equal(stored().spaces.find((r) => r.id === spaceB).publishCalendar, false);
    assert.ok(!rfcEvents((await read(pubUrl)).text).some((e) => text(e, 'SUMMARY') === 'Session in B'), 'B left out');
    assert.ok(rfcEvents((await read(pubUrl)).text).some((e) => text(e, 'SUMMARY') === 'Session in A'), 'A still in');
    assert.equal((await call('PATCH', `/api/spaces/${spaceB}`, { cookie: aliceC, body: { publishCalendar: true } })).status, 403, 'owners only');
    const back = await call('PATCH', `/api/spaces/${spaceB}`, { cookie: admin, body: { publishCalendar: true } });
    assert.equal('publishCalendar' in back.json.space, false, 'in it again: stored as nothing');
    assert.equal('publishCalendar' in stored().spaces.find((r) => r.id === spaceB), false);
    assert.ok(rfcEvents((await read(pubUrl)).text).some((e) => text(e, 'SUMMARY') === 'Session in B'));
  });

  await test('published calendar: 404 with its switch off, after New address (the old one) and after Turn off', async () => {
    await publish(false);
    await notHere(pubUrl, 'the switch off');
    assert.equal((await published()).on, true, 'the switch deletes nothing');
    await publish(true);
    assert.equal((await read(pubUrl)).status, 200);
    const fresh = await call('POST', '/api/settings/published-calendar', { cookie: admin, body: {} });
    assert.equal(fresh.status, 201);
    await notHere(pubUrl, 'the old address after New address');
    assert.equal((await read(fresh.json.url)).status, 200);
    const off = await call('DELETE', '/api/settings/published-calendar', { cookie: admin });
    assert.deepEqual([off.status, off.text], [204, '']);
    await notHere(fresh.json.url, 'after Turn off');
    assert.deepEqual(await published(), { on: false, made: null, readAt: null });
    assert.equal('publishedCalendarFeed' in stored().settings, false);
    assert.equal((await read(aliceUrl)).status, 200);
    assert.equal((await read(aliceA)).status, 200, 'the other addresses are not touched');
    await publish(false);
  });

  // Section 2's revocation: turning the Calendar off stops the published address at once (a space address already
  // does; the personal address stays as it is, as before).
  await test('published calendar: 404 while no module offering events is on; on again, the same address works', async () => {
    await publish(true);
    const again = await call('POST', '/api/settings/published-calendar', { cookie: admin, body: {} });
    assert.equal(again.status, 201, again.text);
    assert.equal((await read(again.json.url)).status, 200);
    for (const id of ['feed-dates', 'feed-plans']) assert.equal((await call('PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: false } })).status, 200, id);
    await notHere(again.json.url, 'the modules off');
    assert.equal((await published()).on, true, 'turning the module off deletes nothing');
    assert.equal((await read(aliceUrl)).status, 200, 'the personal address stays as it is');
    for (const id of ['feed-dates', 'feed-plans']) assert.equal((await call('PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: true, allSpaces: true } })).status, 200, id);
    assert.equal((await read(again.json.url)).status, 200, 'on again: the same address');
    assert.equal((await call('DELETE', '/api/settings/published-calendar', { cookie: admin })).status, 204);
    await publish(false);
  });

  await test('server: deleting the person stops their addresses, the personal one and the space one', async () => {
    assert.equal((await read(aliceA)).status, 200);
    assert.equal((await call('DELETE', `/api/users/${alice}`, { cookie: admin })).status, 200);
    await notHere(aliceUrl, 'after the person is deleted');
    await notHere(aliceA, 'and their space address with them');
  });

  // --- BASE_DOMAIN: one environment's address is 404 at another --------------------------------------------------------
  const hosted = await startServer(appCopy('hosted'), { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'host', ADMIN_PASSWORD: 'host-password-1' });
  servers.push(hosted);
  await test('hosted: a token belongs to its own environment', async () => {
    const hostCookie = await (async () => {
      const r = await hosted.call('POST', '/api/host/login', { host: 'admin', body: { login: 'host', password: 'host-password-1' } });
      assert.equal(r.status, 200, r.text);
      return [].concat(r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    })();
    const owners = {};
    for (const slug of ['acme', 'beta']) {
      const made = await hosted.call('POST', '/api/host/environments', { host: 'admin', cookie: hostCookie, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } });
      assert.equal(made.status, 201, made.text);
      const cookie = await hosted.signIn('owner', 'owner-password-1', slug);
      owners[slug] = cookie;
      assert.equal((await hosted.call('POST', '/api/modules/bundled/feed-dates/install', { host: slug, cookie, body: {} })).status, 201);
      assert.equal((await hosted.call('PATCH', '/api/modules/feed-dates', { host: slug, cookie, body: { enabled: true, allSpaces: true } })).status, 200);
      assert.equal((await hosted.call('PATCH', '/api/settings', { host: slug, cookie, body: { calendarFeeds: true } })).status, 200);
      assert.equal((await hosted.call('PUT', '/api/modules/feed-dates/data/event:e1?scope=environment', { host: slug, cookie, body: { value: { title: `In ${slug}`, start: `${Y}-05-05`, allDay: true } } })).status, 200);
    }
    const made = await hosted.call('POST', '/api/me/feed', { host: 'acme', cookie: owners.acme, body: {} });
    assert.equal(made.status, 201, made.text);
    assert.match(made.json.url, /^http:\/\/acme\.localhost:\d+\/feed\//);
    const at = (slug) => hosted.call('GET', feedPath(made.json.url), { host: slug });
    const home = await at('acme');
    assert.equal(home.status, 200);
    assert.deepEqual(rfcEvents(home.text).map((e) => text(e, 'SUMMARY')), ['In acme']);
    assert.ok(home.text.includes('@acme.localhost\r\n'), 'the UID names the environment\'s host');
    const away = await at('beta');
    assert.deepEqual([away.status, away.text], [404, NOT_HERE]);
    // A space address and the published calendar belong to their environment too.
    const space = await hosted.call('POST', '/api/spaces', { host: 'acme', cookie: owners.acme, body: { name: 'Acme trip', members: [(await hosted.call('GET', '/api/me', { host: 'acme', cookie: owners.acme })).json.user.key] } });
    assert.equal(space.status, 200, space.text);
    assert.equal((await hosted.call('PUT', `/api/modules/feed-dates/data/event:t1?scope=space&space=${space.json.space.id}`, { host: 'acme', cookie: owners.acme, body: { value: { title: 'On the trip', start: `${Y}-05-06`, allDay: true } } })).status, 200);
    const mine = await hosted.call('POST', `/api/me/spaces/${space.json.space.id}/feed`, { host: 'acme', cookie: owners.acme, body: {} });
    assert.equal(mine.status, 201, mine.text);
    const atMine = (slug) => hosted.call('GET', feedPath(mine.json.url), { host: slug });
    assert.deepEqual(rfcEvents((await atMine('acme')).text).map((e) => text(e, 'SUMMARY')), ['On the trip']);
    assert.ok((await atMine('acme')).text.includes('X-WR-CALNAME:Acme trip\r\n'));
    assert.equal((await atMine('beta')).status, 404);
    assert.equal((await hosted.call('PATCH', '/api/settings', { host: 'acme', cookie: owners.acme, body: { publishedCalendar: true } })).status, 200);
    const pub = await hosted.call('POST', '/api/settings/published-calendar', { host: 'acme', cookie: owners.acme, body: {} });
    assert.equal(pub.status, 201, pub.text);
    const atPub = (slug) => hosted.call('GET', feedPath(pub.json.url), { host: slug });
    assert.deepEqual(rfcEvents((await atPub('acme')).text).map((e) => text(e, 'SUMMARY')).sort(), ['In acme', 'On the trip']);
    assert.equal((await atPub('beta')).status, 404);
  });
} finally {
  for (const s of servers) await s.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-feed: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-feed: OK (${n} groups)`);
