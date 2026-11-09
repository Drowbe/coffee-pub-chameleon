#!/usr/bin/env node
/*
 * check-whiteboard-timer.mjs -- the Whiteboard's timer and the page's guess of the server's clock (whiteboard-lib-e-block-timer.js,
 * createServerClock and createSync in whiteboard-lib-c-sync.js), and the Paint menu's rules (the Fill tool's wbFillAction,
 * the stroke's brush in whiteboard-lib-e-block-stroke.js).
 * Guards: the clock guess (a write's stamp, half the round trip; a change heard live as a floor; a board read only as a
 * loose floor; a stamp that is not a date ignored), the module host's `updatedAt` on a 'change' event (an ISO date
 * string) reaching the guess through sync.handle, and a change with none leaving the page on its own clock; the timer's
 * sums (time left, Start from idle, a pause and an end, Pause, Reset, a new length), its clean data, its linked groups and
 * that a copy is never running; Fill fills only a block with a background and Alt takes a colour; a stroke keeps its brush.
 * It runs the module's own libs in one scope as the page has them, with a fake host. No network, no sleeps.
 * Usage: node modules/whiteboard/test/check-whiteboard-timer.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['blockTypes', 'wbClean', 'wbCopies', 'createSync', 'createServerClock', 'wbTimerLeft', 'wbTimerStart', 'wbTimerPause', 'wbTimerReset', 'wbTimerSetLength', 'wbTimerText', 'wbTimerWords', 'wbFillAction'];

let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

let lib = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  lib = new Function('window', 'document', `${parts.join('\n')}\nreturn { ${grab} };`)({ devicePixelRatio: 1 }, undefined);
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const need = (...names) => { const missing = names.filter((n) => typeof lib[n] === 'undefined'); if (missing.length) throw new Error(`the libs have no ${missing.join(', ')}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const iso = (ms) => new Date(ms).toISOString();

// A page's sync with a fake host: nothing is sent; changes are handed to it as the module host would.
function page(clock) {
  const host = { storage: { list: async () => [], get: async () => null, set: async () => ({ version: 1 }), delete: async () => ({ version: 1 }) } };
  const heard = [];
  const sync = lib.createSync({ host, board: 'main', clean: lib.wbClean, me: 'me', onRemote: (c) => heard.push(c), onReload: () => {}, onRefused: () => {}, ...(clock ? { clock } : {}) });
  return { sync, heard };
}
const change = (id, extra = {}) => ({ key: `block:main:${id}`, value: { id, type: 'rect', x: 0, y: 0, w: 10, h: 10, z: 1 }, version: 1, by: 'someone', scope: 'space', ...extra });

const cases = {
  'the clock: a write of this page gives the guess, within half its round trip'() {
    need('createServerClock');
    let local = 1000000;
    const c = lib.createServerClock(() => local);
    check(c.offset() === 0, 'clock: no evidence, the page\'s own clock');
    c.wrote(iso(5000000 + 1100), 1000000, 1000200); // sent at 1,000,000, answered 200 ms later; stamped 1,100 ms past 5,000,000
    check(c.offset() === 5000000 + 1100 - 1000100, `clock: a write's stamp less the middle of its round trip (got ${c.offset()})`);
    c.wrote(iso(5000000 + 2000), 1000500, 1001500); // a slower round trip says less
    check(c.offset() === 5000000 + 1100 - 1000100, 'clock: the quickest write is kept');
    local = 1002000;
    check(c.now() === 1002000 + c.offset(), 'clock: now() is the page\'s time moved by the guess');
  },
  'the clock: a change heard live is a floor, and the guess with no write'() {
    need('createServerClock');
    const c = lib.createServerClock(() => 0);
    c.heard(iso(90000), 10000); // stamped at 90,000, heard at 10,000 here: the server is at least 80,000 ahead
    check(c.offset() === 80000, `clock: a change heard live gives the guess (got ${c.offset()})`);
    c.heard(iso(50000), 20000); // a lower floor does not lower it
    check(c.offset() === 80000, 'clock: a lower floor leaves it');
    c.wrote(iso(1000), 0, 100); // a write saying 950 ahead: under the floor, the floor holds
    check(c.offset() === 80000 || c.offset() >= 80000 - 100, `clock: never below a floor (got ${c.offset()})`);
  },
  'the clock: a board read is only a loose floor; a stamp that is not a date is ignored'() {
    need('createServerClock');
    const c = lib.createServerClock(() => 0);
    c.heard(iso(30000), 0, { old: true });
    check(c.offset() === 30000, 'clock: a read stamp ahead of the page lifts the floor');
    const d = lib.createServerClock(() => 0);
    d.heard(iso(-30000), 0, { old: true });
    check(d.offset() === 0, 'clock: an old read stamp is not taken for the guess (the page\'s own clock stays)');
    for (const bad of [undefined, null, '', 'yesterday', 'x'.repeat(10), {}, NaN]) d.heard(bad, 0);
    check(d.offset() === 0, 'clock: stamps that are not a date are ignored');
  },
  async 'a change event\'s updatedAt (an ISO string) reaches the guess through sync.handle'() {
    need('createSync', 'createServerClock');
    const { sync, heard } = page();
    const ahead = 120000;
    sync.handle(change('a', { updatedAt: iso(Date.now() + ahead) }));
    await Promise.resolve();
    check(heard.length === 1 && heard[0].op === 'put', 'sync: the change is drawn');
    check(near(sync.now() - Date.now(), ahead, 2000), `sync: now() follows the server's stamp on a change heard (off by ${sync.now() - Date.now() - ahead} ms)`);
  },
  async 'a change event with no updatedAt leaves the page on its own clock'() {
    need('createSync');
    const { sync, heard } = page();
    sync.handle(change('b'));
    sync.handle(change('c', { updatedAt: 'not a date', version: 2 }));
    await Promise.resolve();
    check(heard.length === 2, 'sync: both changes are drawn');
    check(near(sync.now(), Date.now(), 50), `sync: no stamp, the page's own clock (off by ${sync.now() - Date.now()} ms)`);
  },
  async 'a timer counts in step from the stamp: two pages, clocks a minute apart'() {
    need('createSync', 'wbTimerLeft', 'wbClean');
    // This page's own clock is 60 s behind the server's (Date.now moved back while the case runs). It hears the Start
    // (startedAt in the server's time) with its stamp.
    const realNow = Date.now;
    const server = realNow();
    Date.now = () => realNow() - 60000;
    try {
      const { sync } = page();
      const timer = lib.wbClean({ id: 't', type: 'timer', x: 0, y: 0, z: 1, length: 300, state: 'running', startedAt: server - 30000, remaining: 300 });
      const blind = lib.wbTimerLeft(timer, sync.now());
      check(near(blind, 300, 0.001), `timer: before any stamp, the page's own clock shows all of it left (got ${blind})`);
      sync.handle({ key: 'block:main:t', value: timer, version: 1, by: 'someone', scope: 'space', updatedAt: iso(server - 30000 + 5) });
      sync.handle({ key: 'block:main:u', value: { ...timer, id: 'u' }, version: 1, by: 'someone', scope: 'space', updatedAt: iso(server) });
      const left = lib.wbTimerLeft(timer, sync.now());
      check(near(left, 270, 2), `timer: 270 s left on a page whose clock is a minute behind, once it hears a stamp (got ${left})`);
    } finally {
      Date.now = realNow;
    }
  },
  'the timer\'s sums'() {
    need('wbTimerLeft', 'wbTimerStart', 'wbTimerPause', 'wbTimerReset', 'wbTimerSetLength', 'wbTimerText', 'wbTimerWords');
    const idle = { length: 300, state: 'idle', startedAt: 0, remaining: 300 };
    const s = lib.wbTimerStart(idle, 1000000);
    check(s.state === 'running' && s.startedAt === 1000000 && s.remaining === 300, `Start from idle: ${JSON.stringify(s)}`);
    const run = { ...idle, ...s };
    check(lib.wbTimerLeft(run, 1000000 + 61000) === 239, 'left: 61 s after the start of 5 minutes, 239');
    check(lib.wbTimerLeft(run, 1000000 - 5000) === 300, 'left: a start after now (clocks apart) has all of it');
    check(lib.wbTimerLeft(run, 1000000 + 400000) === 0, 'left: an end has none');
    const p = lib.wbTimerPause(run, 1000000 + 100000);
    check(p.state === 'paused' && p.remaining === 200 && p.startedAt === 0, `Pause: ${JSON.stringify(p)}`);
    const again = lib.wbTimerStart({ ...run, ...p }, 2000000);
    check(again.startedAt === 2000000 - 100000 && again.remaining === 200, `Start after a pause goes on: ${JSON.stringify(again)}`);
    const ended = lib.wbTimerStart({ ...run, state: 'paused', remaining: 0 }, 3000000);
    check(ended.remaining === 300 && ended.startedAt === 3000000, 'Start after the end: the whole length again');
    check(JSON.stringify(lib.wbTimerReset(run)) === JSON.stringify({ state: 'idle', startedAt: 0, remaining: 300 }), 'Reset');
    check(lib.wbTimerSetLength(90).length === 90 && lib.wbTimerSetLength(0).length === 1 && lib.wbTimerSetLength(1e9).length === 86399, 'a new length: 1 s to a day');
    check(lib.wbTimerText(299.2) === '05:00' && lib.wbTimerText(3900) === '1:05:00' && lib.wbTimerText(0) === '00:00', 'the face: rounded up, h:mm:ss over an hour');
    check(lib.wbTimerWords(270) === '4 minutes 30 seconds' && lib.wbTimerWords(0) === 'no time', 'the words read out');
  },
  'a timer is clean data; a copy is not running; its fields go back together'() {
    need('wbClean', 'wbCopies', 'blockTypes');
    const bad = lib.wbClean({ id: 't', type: 'timer', x: 0, y: 0, z: 1, length: -4, state: 'running', startedAt: 'soon', remaining: 'x' });
    check(bad && bad.length === 300 && bad.state === 'idle' && bad.startedAt === 0 && bad.remaining === 300, `clean: a running timer with no start is idle (${JSON.stringify(bad)})`);
    const run = lib.wbClean({ id: 't', type: 'timer', x: 0, y: 0, z: 1, length: 120, state: 'running', startedAt: 1000000, remaining: 120 });
    const [copy] = lib.wbCopies([run], { newId: () => 'c', dx: 24, dy: 24 });
    check(copy && copy.state === 'idle' && copy.length === 120 && copy.startedAt === 0 && copy.remaining === 120, `a copy waits (${JSON.stringify(copy)})`);
    const linked = lib.blockTypes.get('timer').linked || [];
    check(linked.some((g) => ['x', 'y', 'w', 'h'].every((f) => g.includes(f))), 'linked: its box');
    check(linked.some((g) => ['length', 'state', 'startedAt', 'remaining'].every((f) => g.includes(f))), 'linked: where its count stands');
  },
  'Fill: a block with a background takes the colour; Alt takes one; others refuse'() {
    need('wbFillAction', 'blockTypes');
    const def = (t) => lib.blockTypes.get(t);
    const rect = { type: 'rect', fill: 'none', stroke: 'ink' };
    check(lib.wbFillAction(rect, def('rect'), 'gold', false).kind === 'fill', 'a rectangle is filled');
    check(lib.wbFillAction({ ...rect, fill: 'gold' }, def('rect'), 'gold', false).kind === 'same', 'one with that fill is left alone');
    check(lib.wbFillAction({ type: 'line', stroke: 'ink' }, def('line'), 'gold', false).kind === 'no', 'a line has no background');
    check(lib.wbFillAction({ type: 'stroke', stroke: 'ink' }, def('stroke'), 'gold', false).kind === 'no', 'a drawing has no background');
    const took = lib.wbFillAction({ ...rect, fill: 'teal' }, def('rect'), 'gold', true);
    check(took.kind === 'pick' && took.colour === 'teal', 'Alt takes the background');
    const line = lib.wbFillAction({ type: 'line', stroke: 'red' }, def('line'), 'gold', true);
    check(line.kind === 'pick' && line.colour === 'red', 'Alt takes a line\'s colour');
    check(lib.wbFillAction(rect, def('rect'), '#ff0000', false).kind === 'no', 'only a palette colour');
  },
  'a stroke keeps its brush; an unknown brush is a pen'() {
    need('wbClean');
    const m = lib.wbClean({ id: 's', type: 'stroke', x: 0, y: 0, z: 1, points: [0, 0, 10, 10], brush: 'marker', weight: 12 });
    check(m && m.brush === 'marker' && m.weight === 12, `a marker stroke (${JSON.stringify(m && [m.brush, m.weight])})`);
    const b = lib.wbClean({ id: 's', type: 'stroke', x: 0, y: 0, z: 1, points: [0, 0, 10, 10], brush: 'spray' });
    check(b && b.brush === 'pen', `an unknown brush is a pen (${b && b.brush})`);
  },
};

for (const [name, run] of Object.entries(cases)) {
  try { await run(); } catch (err) { fails.push(`${name}: ${err.message}`); }
}
if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-timer: ${fails.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-timer: OK, ${passed} cases`);
