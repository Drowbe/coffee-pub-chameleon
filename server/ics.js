// iCalendar (RFC 5545) for a person's calendar feed (documentation/plans/plan-google-calendar.md, Part 1).
// Pure: the caller (server/index.js) finds the events a person may read and hands them in already read; this file
// knows the shapes a kind's `dated` declares (a wall clock or an instant, and a repeat in the Calendar's shape),
// never a module by name. Lines end in CRLF, are folded at 75 octets and their text is escaped.
'use strict';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = 24 * 60 * 60 * 1000;
const REPEATS = ['day', 'week', '2weeks', 'month', 'year'];

// The server's zone: TZ when Intl accepts it, else the zone the process runs in, else UTC.
function serverZone(tz = process.env.TZ) {
  const accept = (zone) => {
    if (typeof zone !== 'string' || !zone || zone.length > 64) return null;
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
    } catch {
      return null;
    }
  };
  return accept(tz) || accept(Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
}

// --- zones -------------------------------------------------------------------------------------------------------

const formatters = new Map();
function partsIn(ms, tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatters.set(tz, f);
  }
  const got = {};
  for (const p of f.formatToParts(new Date(ms))) got[p.type] = Number(p.value);
  return { year: got.year, month: got.month, day: got.day, hour: got.hour === 24 ? 0 : got.hour, minute: got.minute, second: got.second };
}
// Minutes east of UTC in `tz` at the instant `ms`.
function offsetAt(ms, tz) {
  const p = partsIn(ms, tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000);
}
// The instant of a wall-clock time in `tz` (a time that does not exist, in a spring-forward gap, moves forward).
function instantOfWall(y, m, d, hh, mi, tz) {
  const want = Date.UTC(y, m - 1, d, hh, mi, 0);
  let ms = want - offsetAt(want, tz) * 60000;
  ms = want - offsetAt(ms, tz) * 60000;
  return ms;
}

// --- text --------------------------------------------------------------------------------------------------------

const pad = (n, w = 2) => String(n).padStart(w, '0');
// TEXT values (RFC 5545, 3.3.11): backslash, semicolon and comma escaped, a line break written \n, other control
// characters dropped.
function escapeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
// One content line folded at 75 octets (RFC 5545, 3.1), never inside a UTF-8 character; each folded line after the
// first starts with a space, which counts in its 75.
function fold(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > limit) {
      out.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n');
}

const utcStamp = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};
const dateValue = (ymd) => ymd.replace(/-/g, '');
const localValue = (p) => `${p.year}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;
const ymdOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDaysYmd = (ymd, n) => ymdOf(Date.parse(`${ymd}T00:00:00Z`) + n * DAY);
const validYmd = (s) => typeof s === 'string' && YMD.test(s) && ymdOf(Date.parse(`${s}T00:00:00Z`)) === s;

// --- reading a dated object ------------------------------------------------------------------------------------------

// A repeat in the Calendar's shape, { every, until }, or null.
function readRepeat(raw) {
  if (!raw || typeof raw !== 'object' || !REPEATS.includes(raw.every)) return null;
  return { every: raw.every, until: validYmd(raw.until) ? raw.until : null };
}

// One stored object as an event, by its kind's `dated` (the shape cleanDated in server/modules.js keeps), or null when
// it has no usable start. All day: { allDay: true, start: 'YYYY-MM-DD', end: last day, inclusive }. Timed: { allDay:
// false, start: ms, end: ms or null }. A wall-clock time is read in `tz`.
function readDated(value, dated, tz) {
  const v = value && typeof value === 'object' ? value : {};
  const title = typeof v[dated.title] === 'string' ? v[dated.title] : '';
  const repeat = dated.repeat ? readRepeat(v[dated.repeat]) : null;
  // The days taken out of a repeat (`dated.skips`): real days, each once, in order, at most 400 (as the Calendar keeps).
  if (repeat && dated.skips && Array.isArray(v[dated.skips])) {
    const days = [...new Set(v[dated.skips].filter(validYmd))].sort().slice(-400);
    if (days.length) repeat.skips = days;
  }
  if (dated.form === 'wall') {
    const day = v[dated.day];
    if (!validYmd(day)) return null;
    const time = dated.time && HM.test(v[dated.time]) ? v[dated.time] : null;
    if (!time) {
      const endDay = dated.endDay && validYmd(v[dated.endDay]) && v[dated.endDay] >= day ? v[dated.endDay] : null;
      return { title, allDay: true, start: day, end: endDay, repeat };
    }
    const [y, m, d] = day.split('-').map(Number);
    const [hh, mi] = time.split(':').map(Number);
    return { title, allDay: false, start: instantOfWall(y, m, d, hh, mi, tz), end: null, repeat };
  }
  // An instant is a date or date-time string, or a number of milliseconds (a poll's `closesAt`,
  // plan-calendar-markers.md).
  const start = v[dated.start];
  const end = dated.end ? v[dated.end] : null;
  const msOf = (x) => (typeof x === 'number' ? (Number.isFinite(x) && Math.abs(x) <= 8.64e15 ? x : NaN) : typeof x === 'string' ? Date.parse(x) : NaN);
  const whole = (dated.allDay && v[dated.allDay] === true) || (typeof start === 'string' && YMD.test(start));
  if (whole) {
    const day = typeof start === 'string' && validYmd(start) ? start : (Number.isNaN(msOf(start)) ? null : ymdOf(msOf(start)));
    if (!day) return null;
    const last = typeof end === 'string' && validYmd(end) && end >= day ? end : null;
    return { title, allDay: true, start: day, end: last, repeat };
  }
  const startMs = msOf(start);
  if (Number.isNaN(startMs)) return null;
  const endMs = !Number.isNaN(msOf(end)) && msOf(end) > startMs ? msOf(end) : null;
  return { title, allDay: false, start: startMs, end: endMs, repeat };
}

// Whether an event is still worth sending at `now`: its end (or start), or its repeat's last day, is no more than
// `days` past. A repeat with no last day always is.
function recentEnough(ev, now, days = 90) {
  const cutoff = now - days * DAY;
  if (ev.repeat) return !ev.repeat.until || Date.parse(`${ev.repeat.until}T23:59:59Z`) >= cutoff;
  if (ev.allDay) return Date.parse(`${ev.end || ev.start}T23:59:59Z`) >= cutoff;
  return (ev.end ?? ev.start) >= cutoff;
}

// --- writing -----------------------------------------------------------------------------------------------------

// The RRULE for a repeat starting on day-of-month `day` of `month` (1-12). Monthly on the 29th to 31st, and yearly on
// February 29, clamp to the month's last day as the Calendar does: the last of the days from the 28th up to it.
function rruleOf(repeat, { day, month }, until) {
  const upTo = (d) => Array.from({ length: d - 27 }, (_, i) => 28 + i).join(',');
  let rule;
  if (repeat.every === 'day') rule = 'FREQ=DAILY';
  else if (repeat.every === 'week') rule = 'FREQ=WEEKLY';
  else if (repeat.every === '2weeks') rule = 'FREQ=WEEKLY;INTERVAL=2';
  else if (repeat.every === 'month') rule = day >= 29 ? `FREQ=MONTHLY;BYMONTHDAY=${upTo(day)};BYSETPOS=-1` : 'FREQ=MONTHLY';
  else rule = month === 2 && day === 29 ? 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1' : 'FREQ=YEARLY';
  return until ? `${rule};UNTIL=${until}` : rule;
}

const offsetText = (minutes) => `${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}${pad(Math.abs(minutes) % 60)}`;
const shortNames = new Map();
function shortName(ms, tz) {
  let f = shortNames.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' });
    shortNames.set(tz, f);
  }
  return f.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value || '';
}

// A VTIMEZONE for `tz` covering the years `fromYear` to `toYear`: one sub-component at the start of the range, then
// one per change of offset, each with its own onset (no rule, so it holds for any zone's history).
function vtimezone(tz, fromYear, toYear) {
  const lines = ['BEGIN:VTIMEZONE', `TZID:${escapeText(tz)}`];
  const standardOf = (ms) => {
    const y = new Date(ms).getUTCFullYear();
    return Math.min(offsetAt(Date.UTC(y, 0, 1), tz), offsetAt(Date.UTC(y, 6, 1), tz));
  };
  const part = (ms, from, to) => {
    const type = to > standardOf(ms) ? 'DAYLIGHT' : 'STANDARD';
    const name = shortName(ms, tz);
    lines.push(`BEGIN:${type}`, `DTSTART:${localValue(wallAt(ms, from))}`, `TZOFFSETFROM:${offsetText(from)}`, `TZOFFSETTO:${offsetText(to)}`);
    if (name) lines.push(`TZNAME:${escapeText(name)}`);
    lines.push(`END:${type}`);
  };
  // From midnight, January 1, as the zone had it.
  const begin = instantOfWall(fromYear, 1, 1, 0, 0, tz);
  const end = Date.UTC(toYear + 1, 0, 1);
  const first = offsetAt(begin, tz);
  part(begin, first, first);
  const WEEK = 7 * DAY;
  let at = begin;
  let current = first;
  while (at < end) {
    const next = Math.min(at + WEEK, end);
    const there = offsetAt(next, tz);
    if (there !== current) {
      // The first second with the new offset, between `at` and `next`.
      let lo = at;
      let hi = next;
      while (hi - lo > 1000) {
        const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
        if (offsetAt(mid, tz) === current) lo = mid; else hi = mid;
      }
      part(hi, current, there);
      current = there;
    }
    at = next;
  }
  lines.push('END:VTIMEZONE');
  return lines;
}
// The wall-clock time at the instant `ms`, read with the offset `offset` (minutes): a sub-component's onset is given in
// the time that was in force just before it.
function wallAt(ms, offset) {
  const d = new Date(ms + offset * 60000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
}

// The whole calendar. `name`: the calendar's name (X-WR-CALNAME). `tz`: the server's zone. `events`: each { uid,
// stamp (ms), title, description, url, allDay, start, end, repeat } as readDated answers plus the rest.
function buildCalendar({ name, tz, events, prodId = '-//Coffee Pub//Calendar feed//EN', now = Date.now() }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodId}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(name)}`, `X-WR-TIMEZONE:${escapeText(tz)}`];
  // A parameter value with a colon, semicolon or comma is quoted (RFC 5545, 3.2); a zone's name never has a quote.
  const tzid = /[:;,]/.test(tz) ? `"${tz}"` : tz;
  const zoned = events.filter((ev) => !ev.allDay && ev.repeat);
  if (zoned.length) {
    const thisYear = new Date(now).getUTCFullYear();
    const years = zoned.flatMap((ev) => [new Date(ev.start).getUTCFullYear(), ev.repeat.until ? Number(ev.repeat.until.slice(0, 4)) : thisYear + 10]);
    const from = Math.max(Math.min(...years) - 1, thisYear - 60);
    const to = Math.min(Math.max(...years, thisYear + 10) + 1, from + 80);
    lines.push(...vtimezone(tz, from, to));
  }
  for (const ev of events) {
    const stamp = utcStamp(Number.isFinite(ev.stamp) ? ev.stamp : now);
    lines.push('BEGIN:VEVENT', `UID:${escapeText(ev.uid)}`, `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(ev.start)}`, `DTEND;VALUE=DATE:${dateValue(addDaysYmd(ev.end || ev.start, 1))}`);
      if (ev.repeat) {
        const [, m, d] = ev.start.split('-').map(Number);
        lines.push(`RRULE:${rruleOf(ev.repeat, { day: d, month: m }, ev.repeat.until ? dateValue(ev.repeat.until) : null)}`);
        // A single day taken out ("Delete this one" in the Calendar) is an exception (RFC 5545, 3.8.5.1).
        if (ev.repeat.skips?.length) lines.push(`EXDATE;VALUE=DATE:${ev.repeat.skips.map(dateValue).join(',')}`);
      }
    } else if (ev.repeat) {
      // Wall-clock time in the server's zone, so it holds across a change to or from daylight saving time.
      const p = partsIn(ev.start, tz);
      lines.push(`DTSTART;TZID=${tzid}:${localValue(p)}`);
      if (ev.end) lines.push(`DTEND;TZID=${tzid}:${localValue(partsIn(ev.end, tz))}`);
      let until = null;
      if (ev.repeat.until) {
        const [y, m, d] = ev.repeat.until.split('-').map(Number);
        until = utcStamp(instantOfWall(y, m, d, 23, 59, tz) + 59000);
      }
      lines.push(`RRULE:${rruleOf(ev.repeat, { day: p.day, month: p.month }, until)}`);
      // Each day taken out, at the repeat's own wall-clock time in the same zone as DTSTART, so it matches that occurrence.
      if (ev.repeat.skips?.length) lines.push(`EXDATE;TZID=${tzid}:${ev.repeat.skips.map((day) => `${dateValue(day)}T${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`).join(',')}`);
    } else {
      lines.push(`DTSTART:${utcStamp(ev.start)}`);
      if (ev.end) lines.push(`DTEND:${utcStamp(ev.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(ev.title)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

module.exports = { buildCalendar, readDated, readRepeat, recentEnough, escapeText, fold, serverZone, offsetAt, instantOfWall, rruleOf, vtimezone };
