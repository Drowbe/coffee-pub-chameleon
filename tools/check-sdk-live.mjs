#!/usr/bin/env node
/*
 * check-sdk-live.mjs -- host.live, the SDK for live messages (documentation/plans/plan-module-live.md, step 5; its Verify
 * section, point 8 and point 1's code read), with the guest path of step 3 as the pages use it. Live messages travel over
 * the app's own server, never over the call.
 *
 *   1. In Node, the page's side on its own (public/module-live.js, with a stand-in for the requests and the clock): every
 *      call is cleaned and refused when it is bad (a field not named, a bad topic, a bad or long `to`, data over 256 bytes
 *      in UTF-8, data that is not plain JSON, a `__proto__` key anywhere); a module can't name another module or space,
 *      and only its own messages in its own space, on topics it subscribed to, are handed on; subscribe joins once the
 *      stream says `ready`, unsubscribing the last topic leaves; `lost` and a new `ready` join again with the new id and
 *      tell the module `fresh` (its last-seen sequence numbers start over); the same `ready` twice joins once; a 409 waits
 *      for the next `ready`, a 403 closes until then, a 429 asks again after Retry-After; a message whose data has a
 *      `__proto__` key is dropped and every other reaches the module as its own copy; who is there only while watched;
 *      publishing is held to 20 a second (429 past it); the server's limits from a join are kept to; a new page in the
 *      frame (reset, on its second hello), unmounting (destroy) and the page going (pageHide, a keepalive request) leave.
 *      The stream hub and relay (public/module-stream.js): `ready` goes to the space's mounts every time (never taken for
 *      a repeat), a mount that joins later is handed the id at once, a retiring connection's is not handed on, an error
 *      says `lost`; a guest's connection carries their pass, and a pass that arrives later replaces the connection; the
 *      relay hands a window frame the pass with its join answer, only for its own guest link.
 *      The tint rule: one of the eight, the same for a key every time, spread over them.
 *      Read as code: host.live in public/sdk/host.js, public/module-live.js and the live wiring in public/module-host.js
 *      name none of livekit, callService, HAS_CALL_SERVICE, publishData, /api/call/ or /api/token; the wiring routes the
 *      stream's live events to the bridge before anything else, resets when a new page in the frame says hello (not on
 *      its load event), leaves on destroy and pagehide.
 *   2. In Chromium (SKIPPED, said so, when there is none; it is not a pass): a throwaway server with NO LiveKit keys and
 *      nobody on a call, three modules built here (live-t and live-u with `live: true`, live-n without), mounted by the
 *      real module host into real sandboxed frames on a page of the server, for two members and a guest (each in a
 *      browser context of their own; the guest by their pass). A topic subscribed as a module's page starts (before its
 *      frame's load event) is heard, also after the frame loads a new page. A message reaches the other two, never the sender;
 *      the same topic in another module is not heard; `from` has the sender's key, name, guest flag and tint (the same
 *      tint as Node's rule); `to` reaches only the one named; messages arrive in order; a burst is coalesced to the newest
 *      and every promise settles; the bridge refuses a bad topic, too much data, `__proto__`, extra fields and a raw call
 *      naming another module, and holds a raw flood to its rate; a module without `live` is closed and refused in the
 *      server's sentence; a message with a `__proto__` key in its data never reaches a module and pollutes nothing; a
 *      stale or repeated sequence number is dropped and a new `ready` starts them over; unsubscribe stops delivery; who is
 *      there arrives with tints, and a leave on unsubscribe, on a frame's new page, on unmount and on closing the tab
 *      (well inside the 10-second grace); the server restarted: every frame goes 'connecting', joins again on the new
 *      `ready`, and hears the new server's first sequence numbers. No page asks for the call's client, a call token or
 *      the call routes.
 * Usage: node tools/check-sdk-live.mjs. Browser: CHROME_PATH, else a Playwright or system Chromium.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowser, launch, sleep } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1; };
const same = (a, b, msg) => { assert.deepEqual(a, b, msg); n += 1; };
const say = (...a) => console.log('check-sdk-live:', ...a);

// Browser modules (no package type here): read through copies named .mjs.
const UNIT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-live-unit-'));
for (const f of ['module-live.js', 'module-stream.js']) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(UNIT_TMP, f.replace(/\.js$/, '.mjs')));
const L = await import(pathToFileURL(path.join(UNIT_TMP, 'module-live.mjs')).href);
const S = await import(pathToFileURL(path.join(UNIT_TMP, 'module-stream.mjs')).href);
fs.rmSync(UNIT_TMP, { recursive: true, force: true });

const TINTS = ['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red'];
const sdk = read('public/sdk/host.js');
// The SDK's tint rule, as it is written there, run on its own.
const tintSrc = /const PERSON_TINTS = [^\n]*\n\s*function personTint\(key\) \{[\s\S]*?\n {2}\}\n/.exec(sdk);
assert.ok(tintSrc, 'the SDK has the tint rule (PERSON_TINTS, personTint)');
const personTint = new Function(`${tintSrc[0]}; return personTint;`)();

// === 1. Node =============================================================================================================
{
  // --- the tint rule ---
  const keys = ['abcd', 'mia1', 'sam2', 'lee3', 'zz99', 'guest-AAAA', 'guest-Zed01', 'k0001', 'k0002', 'k0003', 'k0004', 'k0005', 'k0006', 'k0007', 'k0008', 'k0009'];
  ok(keys.every((k) => TINTS.includes(personTint(k))), 'a tint is always one of the eight');
  ok(keys.every((k) => personTint(k) === personTint(k)), 'the same for a key every time');
  ok(new Set(Array.from({ length: 200 }, (_, i) => personTint(`p${i}x`))).size === 8, 'and the keys spread over all eight');
  same(/const PERSON_TINTS = Object\.freeze\((\[[^\]]+\])\)/.exec(sdk)[1].replace(/'/g, '"'), JSON.stringify(TINTS).replace(/,/g, ', '), 'the eight, in the plan\'s order');
  same(personTint('abcd'), personTint(String('ab') + 'cd'), 'it depends only on the key');

  // --- cleanPublish ---
  const P = (params, limits) => { try { return L.cleanPublish(params, limits); } catch (err) { return { error: err.message, status: err.status }; } };
  same(P({ topic: 'pointer', data: { x: 1 } }), { topic: 'pointer', data: { x: 1 }, to: null }, 'a good message');
  same(P({ topic: 'a', to: ['abcd', 'abcd', 'guest-Ab_9'] }).to, ['abcd', 'guest-Ab_9'], 'to: keys and guest ids, once each');
  same(P({ topic: 'a' }).data, null, 'no data is null');
  for (const [params, why, status] of [
    [null, 'no params', 400], [[], 'a list', 400], [{ topic: 'a', module: 'other' }, 'a module field', 400], [{ topic: 'a', space: 's' }, 'a space field', 400],
    [{ topic: 'a', from: { key: 'x' } }, 'a from field', 400], [{ topic: 'Pointer' }, 'upper case', 400], [{ topic: '' }, 'an empty topic', 400], [{ topic: 'x'.repeat(41) }, 'a long topic', 400],
    [{ topic: 'a', to: [] }, 'to empty', 400], [{ topic: 'a', to: 'abcd' }, 'to not a list', 400], [{ topic: 'a', to: ['ABCD'] }, 'a bad key', 400], [{ topic: 'a', to: ['__proto__'] }, 'to __proto__', 400],
    [{ topic: 'a', to: Array.from({ length: 21 }, (_, i) => `k${String(i).padStart(3, '0')}`) }, '21 people', 400],
    [{ topic: 'a', data: { s: 'x'.repeat(249) } }, '257 bytes', 413], [{ topic: 'a', data: 'é'.repeat(128) }, '258 bytes of 130 characters', 413],
    [{ topic: 'a', data: 10n }, 'a BigInt', 400], [{ topic: 'a', data: JSON.parse('{"__proto__":{"polluted":1}}') }, 'a __proto__ key', 400],
    [{ topic: 'a', data: { deep: [{ x: JSON.parse('{"__proto__":{"polluted":1}}') }] } }, 'a __proto__ key deep down', 400],
  ]) same(P(params).status, status, `refused: ${why}`);
  same(P({ topic: 'a', data: { s: 'x'.repeat(248) } }).data.s.length, 248, '256 bytes of data are taken');
  same(P({ topic: 'a', data: { s: 'x'.repeat(100) } }, { bytes: 64, perSecond: 20, to: 20 }).status, 413, 'the server\'s own limit when it gave one');
  same(P({ topic: 'a', data: { d: new Date(0), f: () => 1, u: undefined } }).data, { d: '1970-01-01T00:00:00.000Z' }, 'data is plain JSON from here on');
  same(({}).polluted, undefined, 'nothing was polluted');

  // --- the bridge ---
  const makeBridge = (o = {}) => {
    let t = 1000;
    const sent = [];
    const asked = [];
    const answers = o.answers || {};
    let timers = [];
    const b = L.createLiveBridge({
      moduleId: 'board',
      spaceId: o.space === undefined ? 'keep' : o.space,
      request: (p, body, opts) => {
        asked.push({ path: p, body, keepalive: Boolean(opts && opts.keepalive) });
        const a = answers[p];
        const v = typeof a === 'function' ? a(body) : a;
        return v instanceof Error ? Promise.reject(v) : Promise.resolve(v === undefined ? { ok: true } : v);
      },
      send: (event, data) => sent.push([event, data]),
      notInSpace: 'live messages are only in a space',
      now: () => t,
      schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      cancel: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    });
    return {
      b, sent, asked, answers,
      tick: (ms) => { t += ms; },
      timers: () => timers.filter((x) => x.fn),
      runTimers: () => { const due = timers.filter((x) => x.fn); timers = []; for (const x of due) x.fn(); },
      call: async (m, params) => { try { return await b.handlers[m](params); } catch (err) { return { error: err.message, status: err.status, retryAfter: err.retryAfter }; } },
      events: (name) => sent.filter(([e]) => e === name).map(([, d]) => d),
    };
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const err = (message, status, extra = {}) => Object.assign(new Error(message), { status, ...extra });

  // Not in a space.
  {
    const x = makeBridge({ space: null });
    same(x.b.state(), 'closed', 'not in a space: closed');
    same(await x.call('live.publish', { topic: 'a' }), { error: 'live messages are only in a space', status: 400, retryAfter: undefined }, 'publish refused in the plan\'s sentence');
    same((await x.call('live.subscribe', { topic: 'a' })).status, 400, 'subscribe refused');
    x.b.onStream('ready', { stream: 's1' });
    await settle();
    same(x.asked, [], 'and nothing is asked of the server');
  }

  // Subscribe, ready, join, messages, unsubscribe, leave.
  {
    const x = makeBridge({ answers: { '/join': { ok: true, people: [{ key: 'al01', name: 'Al', guest: false }, { key: 'guest-Zed01', name: 'Zed', guest: true }, { key: 'BAD', name: 'x' }], limits: { bytes: 64, perSecond: 3, to: 2 } } } });
    same(x.b.state(), 'connecting', 'in a space: connecting until the stream says ready');
    same(await x.call('live.subscribe', { topic: 'pointer' }), { state: 'connecting' }, 'subscribe answers the state');
    await settle();
    same(x.asked, [], 'no join before the stream says its id');
    for (const [params, why] of [[{ topic: 'pointer', module: 'other' }, 'naming another module'], [{ topic: 'pointer', space: 'tower' }, 'naming another space'], [{ topic: 'Bad' }, 'a bad topic'], [null, 'no params']]) {
      same((await x.call('live.subscribe', params)).status, 400, `subscribe refused: ${why}`);
    }
    same((await x.call('live.people', { on: 'yes' })).status, 400, 'people: on must be true or false');
    same((await x.call('live.state', { module: 'x' })).status, 400, 'state: no fields');
    x.b.onStream('ready', { stream: 's1' });
    await settle(); await settle();
    same(x.asked.map((a) => [a.path, a.body]), [['/join', { stream: 's1' }]], 'ready: joins with the stream\'s id');
    same(x.b.state(), 'open', 'and is open once the server answered');
    same(x.events('live.state').map((e) => e.state), ['connecting', 'open'], 'the module heard connecting (fresh) then open');
    ok(x.events('live.state')[0].fresh === true, 'the first state after a ready says fresh');
    x.b.onStream('ready', { stream: 's1' });
    await settle();
    same(x.asked.length, 1, 'the same ready twice (a late mount) joins once');
    // Messages: only this module's, in this space, on a subscribed topic.
    const msg = (o) => ({ module: 'board', spaceId: 'keep', topic: 'pointer', data: { x: 1 }, from: { key: 'al01', name: 'Al', guest: false }, at: 5, seq: 1, ...o });
    const original = { x: 1, nest: { y: 2 } };
    x.b.onStream('live', msg({ data: original }));
    x.b.onStream('live', msg({ module: 'other', seq: 2 }));
    x.b.onStream('live', msg({ spaceId: 'tower', seq: 3 }));
    x.b.onStream('live', msg({ topic: 'typing', seq: 4 }));
    x.b.onStream('live', msg({ data: JSON.parse('{"__proto__":{"polluted":true},"a":1}'), seq: 5 }));
    x.b.onStream('live', msg({ data: { deep: [JSON.parse('{"__proto__":{"polluted":true}}')] }, seq: 6 }));
    x.b.onStream('live', msg({ from: { key: 'NOT A KEY', name: 'x' }, seq: 7 }));
    x.b.onStream('live', msg({ seq: 0 }));
    x.b.onStream('live', msg({ seq: 8, from: { key: 'guest-Zed01', name: 'Zed'.repeat(40), guest: true, extra: 1 } }));
    const got = x.events('live.message');
    same(got.map((m) => m.seq), [1, 8], 'only this module\'s, in this space, on a subscribed topic, well formed, with no __proto__ key in its data');
    same(got[0], { topic: 'pointer', data: { x: 1, nest: { y: 2 } }, from: { key: 'al01', name: 'Al', guest: false }, at: 5, seq: 1 }, 'what the module gets: topic, data, from, at, seq');
    ok(got[0].data !== original && got[0].data.nest !== original.nest, 'the data is a copy of its own, never the one shared with other mounts');
    same(got[1].from, { key: 'guest-Zed01', name: 'Zed'.repeat(40).slice(0, 80), guest: true }, 'from: only key, name (cut to 80) and guest');
    same(({}).polluted, undefined, 'nothing polluted');
    // Unsubscribe the last topic: leave.
    await x.call('live.unsubscribe', { topic: 'pointer' });
    await settle(); await settle();
    same(x.asked.at(-1), { path: '/leave', body: { stream: 's1' }, keepalive: false }, 'the last topic unsubscribed: leaves');
    x.b.onStream('live', msg({ seq: 9 }));
    same(x.events('live.message').length, 2, 'and no more messages on it');
    // The limits the join gave are kept to.
    same((await x.call('live.publish', { topic: 'a', data: 'x'.repeat(70) })).status, 413, 'the server\'s bytes from the join answer');
    same((await x.call('live.publish', { topic: 'a', to: ['abcd', 'bcde', 'cdef'] })).error, 'to must list 1 to 2 people', 'and its `to`');
    // Publish: the body has only topic, data and to, and goes to this module's route ('').
    same(await x.call('live.publish', { topic: 'pointer', data: { x: 2 } }), true, 'publish resolves true once the server took it');
    same(x.asked.at(-1), { path: '', body: { topic: 'pointer', data: { x: 2 } }, keepalive: false }, 'with only topic and data');
    await x.call('live.publish', { topic: 'nudge', data: null, to: ['al01', 'al01'] });
    same(x.asked.at(-1).body, { topic: 'nudge', data: null, to: ['al01'] }, 'to once each');
    same((await x.call('live.publish', { topic: 'pointer', data: 1, module: 'other' })).error, 'send only topic, data and to', 'publish naming another module: refused');
    // The rate: 3 a second here (from the join answer).
    x.tick(2000);
    const burst = [];
    for (let i = 0; i < 5; i += 1) burst.push(await x.call('live.publish', { topic: 'r' }));
    same(burst.map((r) => (r === true ? 200 : r.status)), [200, 200, 200, 429, 429], 'a burst past the rate: 429 at once');
    same([burst[3].error, burst[3].retryAfter], ['too many live messages; wait a moment', 1], 'in the server\'s sentence, with a wait');
    x.tick(1000);
    same(await x.call('live.publish', { topic: 'r' }), true, 'a second later: taken again');
  }

  // Reconnect: lost, then a new ready joins with the new id and says fresh; a 409 waits; a 403 closes; a 429 asks again.
  {
    const x = makeBridge();
    await x.call('live.subscribe', { topic: 'pointer' });
    x.b.onStream('ready', { stream: 's1' });
    await settle(); await settle();
    x.b.onStream('lost', {});
    same(x.b.state(), 'connecting', 'lost: connecting');
    x.b.onStream('ready', { stream: 's2' });
    await settle(); await settle();
    same(x.asked.map((a) => a.body.stream), ['s1', 's2'], 'a new ready: joins again with the new id');
    same(x.events('live.state').filter((e) => e.fresh).length, 2, 'and says fresh each time');
    same(x.b.state(), 'open', 'open again');
    x.answers['/join'] = err('open the space first; there is no module stream of yours there', 409);
    x.b.onStream('ready', { stream: 's3' });
    await settle(); await settle();
    same(x.b.state(), 'connecting', 'a 409 (that stream is gone): connecting, waiting for the next ready');
    same(x.timers().length, 0, 'and not asked again on a timer');
    x.answers['/join'] = err('this module doesn\'t use live messages', 400);
    x.b.onStream('ready', { stream: 's4' });
    await settle(); await settle();
    same(x.b.state(), 'closed', 'a 400: closed');
    same(x.events('live.state').at(-1), { state: 'closed', reason: 'this module doesn\'t use live messages' }, 'with the server\'s sentence');
    same((await x.call('live.publish', { topic: 'a' })).error, 'this module doesn\'t use live messages', 'publish refused in it');
    x.answers['/join'] = err('too many live messages; wait a moment', 429, { retryAfter: 2 });
    x.b.onStream('ready', { stream: 's5' });
    await settle(); await settle();
    same(x.timers().map((t) => t.ms), [2000], 'a 429: asked again after Retry-After');
    x.answers['/join'] = { ok: true, people: [] };
    x.runTimers();
    await settle(); await settle();
    same([x.asked.at(-1).body.stream, x.b.state()], ['s5', 'open'], 'and joined');
    x.answers['/join'] = err('the server failed', 500);
    x.b.onStream('ready', { stream: 's6' });
    await settle(); await settle();
    same(x.timers().map((t) => t.ms), [3000], 'no answer or a failure: asked again in 3 seconds');
  }

  // Who is there: only while watched; joined and left of this module only.
  {
    const x = makeBridge({ answers: { '/join': { ok: true, people: [{ key: 'al01', name: 'Al', guest: false }] } } });
    same(await x.call('live.people', { on: true }), { state: 'connecting', people: [] }, 'watching before the join: nobody yet');
    x.b.onStream('ready', { stream: 's1' });
    await settle(); await settle();
    same(x.events('live.people'), [{ joined: null, left: null, people: [{ key: 'al01', name: 'Al', guest: false }] }], 'the join answer: who is there');
    x.b.onStream('joined', { module: 'board', spaceId: 'keep', person: { key: 'bo02', name: 'Bo', guest: false }, people: [{ key: 'al01', name: 'Al' }, { key: 'bo02', name: 'Bo' }] });
    x.b.onStream('joined', { module: 'other', spaceId: 'keep', person: { key: 'cy03', name: 'Cy' }, people: [] });
    x.b.onStream('left', { module: 'board', spaceId: 'tower', person: { key: 'al01', name: 'Al' }, people: [] });
    x.b.onStream('left', { module: 'board', spaceId: 'keep', person: { key: 'al01', name: 'Al', guest: false }, people: [{ key: 'bo02', name: 'Bo' }] });
    same(x.events('live.people').slice(1).map((e) => [e.joined && e.joined.key, e.left && e.left.key, e.people.map((p) => p.key)]), [['bo02', null, ['al01', 'bo02']], [null, 'al01', ['bo02']]], 'joined and left of this module in this space only');
    await x.call('live.people', { on: false });
    await settle(); await settle();
    same(x.asked.at(-1), { path: '/leave', body: { stream: 's1' }, keepalive: false }, 'not watching and no topic: leaves');
    x.b.onStream('joined', { module: 'board', spaceId: 'keep', person: { key: 'cy03', name: 'Cy' }, people: [] });
    same(x.events('live.people').length, 3, 'and is told no more');
  }

  // reset (a new page in the frame), pageHide, destroy.
  {
    const x = makeBridge();
    await x.call('live.subscribe', { topic: 'pointer' });
    x.b.onStream('ready', { stream: 's1' });
    await settle(); await settle();
    x.b.reset();
    await settle(); await settle();
    same(x.asked.at(-1), { path: '/leave', body: { stream: 's1' }, keepalive: false }, 'a new page in the frame: leaves');
    x.b.onStream('live', { module: 'board', spaceId: 'keep', topic: 'pointer', data: 1, from: { key: 'al01', name: 'Al' }, at: 1, seq: 1 });
    same(x.events('live.message').length, 0, 'and its old topics are forgotten');
    await x.call('live.subscribe', { topic: 'pointer' });
    await settle(); await settle();
    x.b.pageHide();
    same(x.asked.at(-1), { path: '/leave', body: { stream: 's1' }, keepalive: true }, 'the page going: leaves at once, with a keepalive request');
    const y = makeBridge();
    await y.call('live.subscribe', { topic: 'pointer' });
    y.b.onStream('ready', { stream: 's9' });
    await settle(); await settle();
    y.b.destroy();
    await settle(); await settle();
    same(y.asked.at(-1), { path: '/leave', body: { stream: 's9' }, keepalive: false }, 'unmounted: leaves');
    const before = y.sent.length;
    y.b.onStream('live', { module: 'board', spaceId: 'keep', topic: 'pointer', data: 1, from: { key: 'al01', name: 'Al' }, at: 1, seq: 2 });
    y.b.onStream('ready', { stream: 's10' });
    await settle();
    same([y.sent.length, y.asked.length, y.b.state()], [before, 2, 'closed'], 'and hears, says and asks nothing more');
    same((await y.call('live.publish', { topic: 'a' })).status, 400, 'publishing after it: refused');
  }

  // --- the stream hub and the relay ---
  {
    const sources = [];
    class FakeES {
      constructor(url) { this.url = url; this.readyState = 0; this.on = new Map(); this.closed = false; sources.push(this); }
      addEventListener(type, fn) { if (!this.on.has(type)) this.on.set(type, []); this.on.get(type).push(fn); }
      close() { this.closed = true; this.readyState = 2; }
      fire(type, ev = {}) { for (const fn of this.on.get(type) || []) fn(ev); }
      opened() { this.readyState = 1; this.fire('open'); }
      send(type, data, id) { this.fire(type, { data: JSON.stringify(data), lastEventId: id === undefined ? '' : String(id) }); }
    }
    let timers = [];
    const schedule = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    const cancel = (t) => { if (timers[t - 1]) timers[t - 1].fn = null; };
    const run = () => { while (timers.some((t) => t.fn && t.ms === 0)) for (const t of timers) if (t.fn && t.ms === 0) { const f = t.fn; t.fn = null; f(); } };
    const passes = new Map();
    for (const type of ['ready', 'live', 'joined', 'left', 'lost']) ok(S.STREAM_TYPES.includes(type), `the stream hands on '${type}' (and the relay lets it through)`);
    same(S.moduleStreamUrl({ space: 's1', guest: 'tok', pass: 'p.q' }), '/api/modules/stream?space=s1&guest=tok&pass=p.q', 'a guest\'s connection carries the pass');
    same(S.moduleStreamUrl({ space: 's1', pass: 'p.q' }), '/api/modules/stream?space=s1', 'never without the guest link');
    const hub = S.createStreamHub({ EventSourceImpl: FakeES, schedule, cancel, passFor: (g) => passes.get(g) || null });
    const a = [];
    const b = [];
    hub.join('s1', 'tok', (t, d) => a.push([t, d]));
    run();
    same(sources.map((s) => s.url), ['/api/modules/stream?space=s1&guest=tok'], 'a guest without a pass yet: the link only (receives)');
    const c1 = sources[0];
    c1.opened();
    c1.send('ready', { stream: 'A1' }, 'x9');
    c1.send('ready', { stream: 'A1' }, 'x9');
    same(a.filter(([t]) => t === 'ready'), [['ready', { stream: 'A1' }], ['ready', { stream: 'A1' }]], 'ready is handed on every time, never taken for a repeat');
    c1.send('live', { module: 'm', spaceId: 's1', topic: 't', seq: 1 }, 'e1');
    c1.send('live', { module: 'm', spaceId: 's1', topic: 't', seq: 1 }, 'e1');
    same(a.filter(([t]) => t === 'live').length, 1, 'a live message with the same id is handed on once');
    hub.join('s1', 'tok', (t, d) => b.push([t, d]));
    run();
    same(b, [['ready', { stream: 'A1' }]], 'a mount that joins later is handed the id at once');
    c1.fire('error');
    same(a.at(-1), ['lost', {}], 'an error: lost');
    c1.opened();
    c1.send('ready', { stream: 'A2' });
    same(a.at(-1), ['ready', { stream: 'A2' }], 'the browser\'s retry: the new id');
    passes.set('tok', 'pass.sig');
    hub.refresh();
    run();
    same(sources.filter((s) => !s.closed).map((s) => s.url), ['/api/modules/stream?space=s1&guest=tok', '/api/modules/stream?space=s1&guest=tok&pass=pass.sig'], 'the pass arrived: a connection with it opens (the old one goes once it is open)');
    const c2 = sources[1];
    c1.send('ready', { stream: 'OLD' });
    ok(!a.some(([t, d]) => t === 'ready' && d.stream === 'OLD'), 'a retiring connection\'s id is not handed on');
    c2.opened();
    c2.send('ready', { stream: 'B1' });
    same(a.at(-1), ['ready', { stream: 'B1' }], 'the new connection\'s id is');
    ok(c1.closed, 'and the old one closed');

    // The relay: the frame's join answer carries the pass, for its own guest link only.
    const frameMsgs = [];
    const listeners = [];
    const win = { addEventListener: (t, f) => listeners.push(f), removeEventListener() {} };
    const frameWin = { postMessage: (m) => frameMsgs.push(m) };
    const frame = { contentWindow: frameWin, ownerDocument: { defaultView: win }, addEventListener() {}, removeEventListener() {} };
    const joined = [];
    S.createStreamRelay({ win, frame, origin: 'https://x', allow: () => ({ space: 's1', guest: 'tok', pass: 'pass.sig' }), join: (sp, g, fn) => { joined.push([sp, g]); return () => {}; } });
    const ask = (d) => listeners.forEach((f) => f({ source: frameWin, origin: 'https://x', data: d }));
    ask({ type: 'app:streamjoin', doc: 'd1', sub: 's1', space: 's1', guest: 'tok' });
    same(frameMsgs.at(-1), { type: 'app:streamjoined', doc: 'd1', sub: 's1', ok: true, pass: 'pass.sig' }, 'the frame made for this guest link is handed the pass with its answer');
    ask({ type: 'app:streamjoin', doc: 'd1', sub: 's2', space: 's1', guest: 'other' });
    same([frameMsgs.at(-1).ok, frameMsgs.at(-1).pass], [false, undefined], 'asking for another link: refused, and no pass');
    ask({ type: 'app:streamjoin', doc: 'd1', sub: 's1', space: 's1', guest: 'tok' });
    same(frameMsgs.at(-1).pass, 'pass.sig', 'asked again: the pass again');
    // The frame's side hands the pass to onPass.
    const selfL = [];
    let doc = null;
    const page = { postMessage: (m) => { doc = m.doc; } };
    const gotPass = [];
    const client = S.createStreamRelayClient({ parent: page, self: { addEventListener: (t, f) => selfL.push([t, f]) }, origin: 'https://x', onPass: (g, p) => gotPass.push([g, p]), schedule: () => 0, cancel: () => {} });
    client.join('s1', 'tok', () => {});
    const toFrame = (data) => { for (const [t, f] of selfL) if (t === 'message') f({ origin: 'https://x', source: page, data }); };
    toFrame({ type: 'app:streamjoined', doc, sub: 's1', ok: true, pass: 'pass.sig' });
    same(gotPass, [['tok', 'pass.sig']], 'the frame keeps the pass its page handed it');
    toFrame({ type: 'app:streamjoined', doc, sub: 's1', ok: true, pass: 'pass.sig' });
    toFrame({ type: 'app:streamjoined', doc: 'another', sub: 's1', ok: true, pass: 'forged' });
    const warn = console.warn;
    console.warn = () => {}; // the frame says the page refused, as it should
    toFrame({ type: 'app:streamjoined', doc, sub: 's1', ok: false, pass: 'forged' });
    console.warn = warn;
    ok(!gotPass.some(([, p]) => p === 'forged'), 'only from its own page\'s good answer');
  }

  // --- read as code ---
  const CALL_WORDS = /livekit|callService|HAS_CALL_SERVICE|publishData|\/api\/call\/|\/api\/token/i;
  const liveFile = read('public/module-live.js');
  ok(!/^\s*import\s/m.test(liveFile), 'public/module-live.js imports nothing');
  ok(!CALL_WORDS.test(liveFile), 'public/module-live.js names no LiveKit, call service or call route');
  const sdkFrom = sdk.indexOf('// Live messages (plan-module-live.md)');
  const sdkTo = sdk.indexOf('host.live = makeLive();');
  ok(sdkFrom > 0 && sdkTo > sdkFrom, 'host.live has its section in public/sdk/host.js');
  ok(!CALL_WORDS.test(sdk.slice(sdkFrom, sdkTo)) && !CALL_WORDS.test(tintSrc[0]), 'host.live names none of them');
  const mh = read('public/module-host.js');
  const mhFrom = mh.indexOf('// Live messages (host.live; plan-module-live.md)');
  const mhTo = mh.indexOf("window.addEventListener('pageshow', onPageShow);");
  ok(mhFrom > 0 && mhTo > mhFrom && !CALL_WORDS.test(mh.slice(mhFrom, mhTo)), 'the live calls in public/module-host.js name none of them');
  ok(/const leaveStream = keyed \? pollSettings\(\) : joinStream\([^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*if \(type === 'ready' \|\| type === 'lost' \|\| type === 'live' \|\| type === 'joined' \|\| type === 'left'\) \{\n\s*live\.onStream\(type, d\);\n(?:\s*if \(reconnectWatch\(type\)\) send\('reconnected', \{\}\);\n)?\s*return;/.test(mh), 'the mount hands the stream\'s live events to the bridge before anything else');
  ok(/async hello\(\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(helloSeen\) live\.reset\(\);\n\s*helloSeen = true;/.test(mh), 'a new page in the frame (a second hello) resets its live messages, before it can subscribe again');
  ok(!/addEventListener\('load', \(\) => live\.reset\(\)\)/.test(mh), 'and not on the frame\'s load event, which comes after the page\'s scripts subscribed');
  ok(/live\.destroy\(\);/.test(mh) && /window\.removeEventListener\('pagehide', onPageHide\)/.test(mh), 'unmounting leaves');
  ok(/\.\.\.live\.handlers,/.test(mh) && /live: live\.state\(\),/.test(mh), 'the calls are the bridge\'s, and the hello says the state');
  ok(/createStreamHub\(\{ passFor \}\)/.test(mh) && /onPass: setGuestPass/.test(mh), 'the guest\'s pass rides the hub and the relay');
  ok(/setGuestPass\(guestToken, guestPass\)/.test(read('public/space.js')), 'the space page hands the guest\'s pass to the module host');
  ok(JSON.parse(read('package.json')).scripts.check.includes('node tools/check-sdk-live.mjs'), 'npm run check runs this check');
  // The product host (BASE_DOMAIN) lets the design system pages load only the app files on its list; module-host.js imports
  // module-live.js, so it must be on it too.
  const dsFiles = /const DESIGN_SYSTEM_FILES = \[([^\]]*)\]/.exec(read('server/index.js'));
  ok(dsFiles && dsFiles[1].includes("'/module-live.js'") && dsFiles[1].includes("'/module-host.js'"), 'the product host serves /module-live.js beside /module-host.js');
}

// === 2. Chromium =========================================================================================================
const MODULE_JS = String.raw`(function () {
  // Everything the host posts to this frame (the hello answer, every call's answer and error, every event), as text, so
  // the check can see that no stream id or guest pass ever reaches a module.
  var inbox = [];
  addEventListener('message', function (e) { var m = e.data; if (m && m.host === 1) { try { inbox.push(JSON.stringify(m)); } catch (err) { inbox.push(String(m)); } } });
  var report = function (o) { parent.postMessage(Object.assign({ livetest: 1 }, o), '*'); };
  var subs = new Map();
  var peopleOff = null;
  var states = [];
  var handler = function (name) {
    return function (data, from, meta) {
      var plain = data === null || typeof data !== 'object' || Array.isArray(data) || Object.getPrototypeOf(data) === Object.prototype;
      report({ kind: 'message', name: name, data: data, from: from, meta: meta, plain: plain, polluted: ({}).polluted === undefined ? null : true });
      // A handler that changes its data: the next handler on the topic must not see the change.
      if (data && typeof data === 'object' && !Array.isArray(data)) data.touchedBy = name;
    };
  };
  // Subscribed as the page starts, before host.ready() and before the frame's load event, as a module may.
  subs.set('early', host.live.subscribe('early', handler('early')));
  host.live.on('state', function (s) { states.push(s); report({ kind: 'state', state: s }); });
  var tk = new URLSearchParams(location.search).get('tk');
  var rawId = 1000000;
  function raw(method, params) {
    return new Promise(function (resolve) {
      var id = ++rawId;
      var on = function (e) { var m = e.data; if (!m || m.host !== 1 || m.id !== id) return; removeEventListener('message', on); resolve(m.error ? { error: m.error } : { result: m.result }); };
      addEventListener('message', on);
      parent.postMessage({ host: 1, tk: tk, id: id, method: method, params: params }, '*');
    });
  }
  addEventListener('message', async function (e) {
    var c = e.data;
    if (!c || c.livecmd !== 1) return;
    var answer = function (o) { report(Object.assign({ kind: 'answer', id: c.id }, o)); };
    try {
      if (c.op === 'state') return answer({ state: host.live.state, states: states });
      if (c.op === 'inbox') return answer({ inbox: inbox.join('\n'), count: inbox.length });
      if (c.op === 'tint') return answer({ tints: c.keys.map(function (k) { return host.live.tint(k); }) });
      if (c.op === 'subscribe') {
        subs.set(c.name, host.live.subscribe(c.topic, handler(c.name)));
        return answer({ ok: true });
      }
      if (c.op === 'unsubscribe') { subs.get(c.name)(); subs.delete(c.name); return answer({ ok: true }); }
      if (c.op === 'people') { peopleOff = host.live.on('people', function (p) { report({ kind: 'people', joined: p.joined, left: p.left, people: p.people }); }); return answer({ ok: true }); }
      if (c.op === 'peopleOff') { peopleOff(); peopleOff = null; return answer({ ok: true }); }
      if (c.op === 'publish') {
        var data = c.data === '__PROTO__' ? JSON.parse('{"__proto__":{"polluted":true}}') : c.data;
        return answer({ result: await host.live.publish(c.topic, data, c.options) });
      }
      if (c.op === 'burst') {
        var all = [];
        for (var i = 0; i < c.n; i += 1) all.push(host.live.publish(c.topic, { i: i }));
        var r = await Promise.allSettled(all);
        return answer({ results: r.map(function (x) { return x.status === 'fulfilled' ? x.value : (x.reason && x.reason.status) || 'error'; }) });
      }
      if (c.op === 'raw') return answer(await raw(c.method, c.params));
      if (c.op === 'rawBurst') {
        var calls = [];
        for (var j = 0; j < c.n; j += 1) calls.push(raw('live.publish', { topic: c.topic, data: { i: j } }));
        var got = await Promise.all(calls);
        return answer({ results: got.map(function (x) { return x.error ? x.error.status : 'ok'; }) });
      }
      answer({ error: { message: 'no such op' } });
    } catch (err) {
      answer({ error: { message: err && err.message, status: err && err.status } });
    }
  });
  host.ready().then(function (info) { report({ kind: 'ready', state: host.live.state, user: info.user && info.user.key }); });
})();`;

// The page script each tab runs on a page of the server: the real module host mounts the three modules in real frames.
const PAGE_SETUP = (p) => `(async () => {
  const P = ${JSON.stringify(p)};
  const mh = await import('/module-host.js');
  window.__got = [];
  window.__mods = {};
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.livetest !== 1) return;
    for (const [k, v] of Object.entries(window.__mods)) if (v.f.contentWindow === e.source) { window.__got.push({ mod: k, at: Date.now(), ...d }); return; }
  });
  let guestToken = null;
  if (P.guest) {
    const r = await fetch('/api/guest-join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: P.guest, name: P.name }) });
    window.__guest = (await r.json()).guest;
    mh.setGuestPass(P.guest, window.__guest.pass);
    guestToken = P.guest;
  }
  window.__mount = (k, id) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'width:240px;height:120px';
    document.body.append(f);
    window.__mods[k] = { f, id, m: mh.mountModule({ module: { id, version: '1.0.0', scope: ['space'] }, frame: f, scope: 'space', spaceId: P.space, guestToken, entry: id + '.html' }) };
  };
  for (const [k, id] of Object.entries(P.mods)) window.__mount(k, id);
  let n = 0;
  window.__cmd = (k, op, args = {}) => new Promise((resolve, reject) => {
    const id = ++n;
    const timer = setTimeout(() => { clearInterval(look); reject(new Error('no answer to ' + op + ' from ' + k)); }, 20000);
    const look = setInterval(() => {
      const a = window.__got.find((g) => g.mod === k && g.kind === 'answer' && g.id === id);
      if (a) { clearInterval(look); clearTimeout(timer); resolve(a); }
    }, 20);
    window.__mods[k].f.contentWindow.postMessage({ livecmd: 1, id, op, ...args }, '*');
  });
  return guestToken ? window.__guest.id : true;
})()`;

let note = '';
const bin = findBrowser();
if (!bin) note = ' (browser part SKIPPED: no Chromium found; set CHROME_PATH. This is not a pass)';
else {
  const { buildModule } = require('../server/module-build.js');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-live-'));
  const writeModule = (id, extra) => {
    const root = path.join(TMP, 'modules', id);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify({
      id, name: id, version: '1.0.0', scope: ['space'], icon: 'circle',
      surfaces: { canvas: { entry: `${id}.html`, menu: false } },
      permissions: [{ key: 'view', label: 'View', default: { member: true, guest: true } }],
      access: { read: 'view' },
      ...extra,
    }));
    fs.writeFileSync(path.join(root, 'src', `${id}.html`), '<!DOCTYPE html><html><head><meta charset="utf-8"><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
    fs.writeFileSync(path.join(root, 'src', `${id}.css`), '');
    fs.writeFileSync(path.join(root, 'src', `${id}.js`), MODULE_JS);
    return buildModule(root).zip;
  };
  const ZIPS = { 'live-t': writeModule('live-t', { live: true }), 'live-u': writeModule('live-u', { live: true }), 'live-n': writeModule('live-n', {}) };
  const dataDir = fs.mkdtempSync(path.join(TMP, 'data-'));
  let child = null;
  let out = '';
  let port = 0;
  const start = async () => {
    out = '';
    // No LiveKit at all: no keys, no URL. Live messages must not need them.
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234', TRUST_PROXY_HOPS: '0' };
    child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the server did not start:\n${out}`)), 30000);
      const look = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
      child.stdout.on('data', look);
      child.stderr.on('data', look);
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
    });
  };
  const stop = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  const base = () => `http://127.0.0.1:${port}`;
  const http = async (method, url, { body, cookie, raw, type = 'application/json' } = {}) => {
    const headers = { accept: 'application/json' };
    if (cookie) headers.cookie = `app_session=${cookie}`;
    if (body !== undefined || raw !== undefined) headers['content-type'] = type;
    const r = await fetch(base() + url, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, json };
  };
  const login = async (name, password) => (await http('POST', '/api/login', { body: { login: name, password } })).json.token;

  let browser = null;
  const tabs = [];
  const asked = []; // every request a page made: [tab, url]
  const streamIds = new Set(); // every module stream id a page named in a join or leave
  try {
    await start();
    ok(/No LiveKit: voice and video are off\./.test(out), 'the throwaway server has no LiveKit');
    const admin = await login('admin', 'testpass1234');
    for (const [id, zip] of Object.entries(ZIPS)) {
      same((await http('POST', '/api/modules', { cookie: admin, raw: zip, type: 'application/zip' })).status, 201, `${id} installs`);
      same((await http('PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: true } })).status, 200, `${id} turns on`);
    }
    const mk = async (login_, displayName) => (await http('POST', '/api/users', { cookie: admin, body: { login: login_, displayName, role: 'member', password: 'memberpass1234' } })).json.user;
    const ann = await mk('ann', 'Ann');
    const ben = await mk('ben', 'Ben');
    const annC = await login('ann', 'memberpass1234');
    const benC = await login('ben', 'memberpass1234');
    const hall = (await http('POST', '/api/spaces', { cookie: admin, body: { name: 'Hall', members: [ann.key, ben.key] } })).json.space;
    await http('PATCH', `/api/spaces/${hall.id}`, { cookie: admin, body: { members: [ann.key, ben.key] } });
    const link = (await http('POST', `/api/spaces/${hall.id}/guest-link`, { cookie: admin, body: {} })).json.space.guestToken;

    browser = await launch(bin);
    const { cdp } = browser;
    // A tab of its own browser context (its own cookies), with no clock or random number stand-ins: the SDK's pacing and
    // the bridge's rate run on the real clock.
    const openTab = async (name, cookie) => {
      const { browserContextId } = await cdp.send('Target.createBrowserContext');
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => cdp.send(m, p, sessionId);
      await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
      cdp.listeners.push((m) => {
        if (m.sessionId !== sessionId || m.method !== 'Network.requestWillBeSent') return;
        asked.push([name, m.params.request.url]);
        // The stream ids the page joins and leaves with: none may ever reach a module.
        const said = /"stream":"([^"]+)"/.exec(m.params.request.postData || '');
        if (said) streamIds.add(said[1]);
      });
      if (cookie) await s('Network.setCookie', { name: 'app_session', value: cookie, url: base(), httpOnly: true });
      const tab = {
        name, targetId, browserContextId, sessionId,
        eval: async (expr) => {
          const r = await s('Runtime.evaluate', { expression: `(async () => (${expr}))()`, returnByValue: true, awaitPromise: true });
          if (r.exceptionDetails) throw new Error(`${name}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
          return r.result.value;
        },
        close: async () => {
          await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
          await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
        },
      };
      tabs.push(tab);
      await s('Page.navigate', { url: `${base()}/bad-link.html` });
      for (let i = 0; i < 100; i += 1) { if (await tab.eval('document.readyState === "complete"').catch(() => false)) break; await sleep(100); }
      return tab;
    };
    const cmd = (tab, k, op, args = {}) => tab.eval(`window.__cmd(${JSON.stringify(k)}, ${JSON.stringify(op)}, ${JSON.stringify(args)})`);
    const got = (tab, filter) => tab.eval(`window.__got.filter((g) => ${filter})`);
    const until = async (tab, filter, ms = 8000, what = filter) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const g = await got(tab, filter);
        if (g.length) return g;
        await sleep(50);
      }
      throw new Error(`${tab.name}: nothing matched ${what} in ${ms} ms`);
    };
    const stateIs = async (tab, k, want, ms = 8000) => {
      const end = Date.now() + ms;
      let last = null;
      while (Date.now() < end) { last = (await cmd(tab, k, 'state')).state; if (last === want) return true; await sleep(50); }
      throw new Error(`${tab.name} ${k}: state ${last}, not ${want}`);
    };
    const mods = { t: 'live-t', u: 'live-u', n: 'live-n' };
    const A = await openTab('Ann', annC);
    const B = await openTab('Ben', benC);
    const G = await openTab('Gia', null);
    same(await A.eval(PAGE_SETUP({ space: hall.id, mods })), true, 'Ann\'s page mounts the modules');
    same(await B.eval(PAGE_SETUP({ space: hall.id, mods })), true, 'Ben\'s page mounts them');
    const giaId = await G.eval(PAGE_SETUP({ space: hall.id, mods, guest: link, name: 'Gia' }));
    ok(/^guest-/.test(giaId), 'the guest\'s page enters with a name and mounts them as a guest');
    for (const T of [A, B, G]) for (const k of Object.keys(mods)) await until(T, `g.mod === '${k}' && g.kind === 'ready'`, 15000, `${k} ready`);
    const firstState = await got(B, "g.mod === 't' && g.kind === 'ready'");
    ok(['connecting', 'open'].includes(firstState[0].state), `host.live.state is there from the hello (${firstState[0].state})`);

    // Subscriptions: Ben's live-t twice on 'pointer', his live-u on 'pointer'; Ann's and Gia's live-t on 'pointer'.
    await cmd(B, 't', 'subscribe', { topic: 'pointer', name: 'p1' });
    await cmd(B, 't', 'subscribe', { topic: 'pointer', name: 'p2' });
    await cmd(B, 'u', 'subscribe', { topic: 'pointer', name: 'pu' });
    await cmd(A, 't', 'subscribe', { topic: 'pointer', name: 'p1' });
    await cmd(G, 't', 'subscribe', { topic: 'pointer', name: 'p1' });
    await cmd(A, 't', 'people');
    for (const [T, k] of [[A, 't'], [B, 't'], [B, 'u'], [G, 't']]) await stateIs(T, k, 'open');
    ok(true, 'every subscriber is open: joined on its stream\'s id (with no LiveKit)');
    const ppl = await until(A, "g.mod === 't' && g.kind === 'people' && g.people.length === 3", 8000, 'three people');
    const list = ppl.at(-1).people;
    same(list.map((p) => p.key).sort(), [ann.key, ben.key, giaId].sort(), 'who is there: Ann, Ben and the guest');
    ok(list.every((p) => p.tint === personTint(p.key)), 'each with the tint Node\'s rule gives');
    same(list.find((p) => p.key === giaId), { key: giaId, name: 'Gia', guest: true, tint: personTint(giaId) }, 'the guest by the name on their pass');

    // A subscription made as the module's page started (before its frame's load event) holds.
    await cmd(A, 't', 'publish', { topic: 'early', data: { e: 1 } });
    await until(B, "g.mod === 't' && g.name === 'early' && g.data?.e === 1");
    await until(G, "g.mod === 't' && g.name === 'early' && g.data?.e === 1");
    ok(true, 'a topic subscribed as the page started is heard (the frame\'s load event did not forget it)');

    // A message: to the others, not the sender; not another module's same topic.
    same((await cmd(A, 't', 'publish', { topic: 'pointer', data: { x: 1 } })).result, true, 'publish resolves true');
    const m1 = await until(B, "g.mod === 't' && g.kind === 'message' && g.name === 'p1'");
    same(m1[0].data, { x: 1 }, 'Ben\'s live-t hears it');
    same(m1[0].from, { key: ann.key, name: 'Ann', guest: false, tint: personTint(ann.key) }, 'from Ann, with her tint');
    same([m1[0].meta.topic, typeof m1[0].meta.at, Number.isInteger(m1[0].meta.seq)], ['pointer', 'number', true], 'meta: topic, the server\'s time and sequence');
    const m1b = await until(B, "g.mod === 't' && g.kind === 'message' && g.name === 'p2'");
    ok(true, 'both handlers on the topic hear it');
    same(m1b[0].data, { x: 1 }, 'each with its own copy: the first handler changing its data does not change the second\'s');
    await until(G, "g.mod === 't' && g.kind === 'message'");
    await sleep(400);
    same((await got(B, "g.mod === 'u' && g.kind === 'message'")).length, 0, 'another module\'s same topic hears nothing');
    same((await got(A, "g.kind === 'message'")).length, 0, 'the sender hears nothing');
    // The guest sends, as themselves.
    await cmd(G, 't', 'publish', { topic: 'pointer', data: { x: 2 } });
    const gm = await until(B, "g.mod === 't' && g.kind === 'message' && g.name === 'p1' && g.data?.x === 2");
    same(gm[0].from, { key: giaId, name: 'Gia', guest: true, tint: personTint(giaId) }, 'a guest sends as the id and name on their pass');
    await sleep(300);
    same((await got(G, "g.kind === 'message' && g.data?.x === 2")).length, 0, 'and never hears it');
    // Another module: live-u's 'pointer' is live-u's only.
    await cmd(A, 'u', 'publish', { topic: 'pointer', data: { u: 1 } });
    await until(B, "g.mod === 'u' && g.kind === 'message' && g.data?.u === 1");
    await sleep(300);
    same((await got(B, "g.mod === 't' && g.kind === 'message' && g.data?.u === 1")).length, 0, 'live-u\'s message reaches live-u, not live-t');
    // `to`.
    await cmd(A, 't', 'publish', { topic: 'pointer', data: { to: 1 }, options: { to: [giaId] } });
    await until(G, "g.kind === 'message' && g.data?.to === 1");
    await sleep(400);
    same((await got(B, "g.kind === 'message' && g.data?.to === 1")).length, 0, '`to` reaches only the one named');
    // The tint in the frame is Node's.
    const tints = (await cmd(B, 't', 'tint', { keys: [ann.key, ben.key, giaId, 'abcd'] })).tints;
    same(tints, [ann.key, ben.key, giaId, 'abcd'].map(personTint), 'host.live.tint in a real frame gives the same tints');

    // In order, and a burst coalesced to the newest.
    await cmd(B, 't', 'subscribe', { topic: 'ord', name: 'ord' });
    await cmd(B, 't', 'subscribe', { topic: 'co', name: 'co' });
    await sleep(200);
    for (let i = 0; i < 8; i += 1) await cmd(A, 't', 'publish', { topic: 'ord', data: { i } });
    const ord = await until(B, "g.name === 'ord' && g.data?.i === 7");
    const ordAll = await got(B, "g.name === 'ord'");
    same(ordAll.map((g) => g.data?.i), [0, 1, 2, 3, 4, 5, 6, 7], 'messages arrive in order');
    ok(ordAll.every((g, i) => i === 0 || g.meta.seq > ordAll[i - 1].meta.seq), 'with rising sequence numbers');
    void ord;
    const burst = (await cmd(A, 't', 'burst', { topic: 'co', n: 10 })).results;
    same(burst, Array(10).fill(true), 'ten published at once: every promise settles (resolved)');
    await until(B, "g.name === 'co' && g.data?.i === 9");
    await sleep(300);
    const co = await got(B, "g.name === 'co'");
    ok(co.length < 10 && co.at(-1).data.i === 9, `coalesced to the newest (${co.length} sent of 10, the last {i: 9})`);

    // Refusals at the bridge, from a real frame.
    const pub = async (data, options, topic = 'pointer') => (await cmd(A, 't', 'publish', { topic, data, options })).error;
    same((await pub(1, undefined, 'Bad Topic')).status, 400, 'a bad topic: refused');
    same(await pub({ s: 'x'.repeat(300) }), { message: 'a live message\'s data can be at most 256 bytes', status: 413 }, 'too much data: 413 at the bridge');
    same(await pub('__PROTO__'), { message: 'the data can\'t have a __proto__ key', status: 400 }, 'a __proto__ key: refused');
    same((await pub(1, { to: [ben.key], module: 'live-u' })).status, 400, 'an option beyond `to`: refused');
    const rawPub = await cmd(A, 't', 'raw', { method: 'live.publish', params: { topic: 'pointer', data: 1, module: 'live-u' } });
    same(rawPub.error.message, 'send only topic, data and to', 'a raw call naming another module: the bridge refuses it');
    const rawSub = await cmd(A, 't', 'raw', { method: 'live.subscribe', params: { topic: 'pointer', space: 'elsewhere' } });
    same(rawSub.error.message, 'send only topic', 'a raw subscribe naming another space: refused');
    await sleep(1100);
    const flood = (await cmd(A, 'u', 'rawBurst', { topic: 'fl', n: 40 })).results;
    const floodOk = flood.filter((r) => r === 'ok').length;
    ok(floodOk >= 18 && floodOk <= 21 && flood.filter((r) => r === 429).length === 40 - floodOk, `a raw flood of 40 bypassing the SDK: held to the rate at the page (${floodOk} went, the rest 429)`);
    // A module without `live`.
    await cmd(A, 'n', 'subscribe', { topic: 'pointer', name: 'n1' });
    await stateIs(A, 'n', 'closed');
    ok(true, 'a module without "live": closed');
    same((await cmd(A, 'n', 'publish', { topic: 'pointer', data: 1 })).error, { message: 'this module doesn\'t use live messages', status: 400 }, 'and refused in the server\'s sentence');

    // __proto__ sent past every page (straight to the server): dropped by the host, nothing polluted.
    await sleep(1100);
    const rawPost = await http('POST', `/api/modules/live-t/live?space=${hall.id}`, { cookie: annC, raw: '{"topic":"pointer","data":{"__proto__":{"polluted":true},"a":1}}' });
    same(rawPost.status, 200, 'the server takes data with a __proto__ key (it is only data there)');
    await http('POST', `/api/modules/live-t/live?space=${hall.id}`, { cookie: annC, body: { topic: 'pointer', data: { after: 1 } } });
    await until(B, "g.name === 'p1' && g.data?.after === 1");
    same((await got(B, "g.kind === 'message' && g.data && g.data?.a === 1")).length, 0, 'a message whose data has a __proto__ key never reaches the module');
    ok((await got(B, "g.kind === 'message'")).every((g) => g.polluted === null && g.plain === true), 'every message the module got is plain data, and nothing in the frame was polluted');
    same(await B.eval('({}).polluted === undefined && Object.prototype.polluted === undefined'), true, 'nor in the page');

    // Stale and repeated sequence numbers: dropped; a fresh ready starts them over.
    const lastSeq = (await got(B, "g.name === 'p1'")).at(-1).meta.seq;
    const inject = (seq, mark) => B.eval(`(window.__mods.t.m.send('live.message', { topic: 'pointer', data: { inj: ${mark} }, from: { key: ${JSON.stringify(ann.key)}, name: 'Ann', guest: false }, at: Date.now(), seq: ${seq} }), true)`);
    await inject(lastSeq - 1, 1);
    await inject(lastSeq, 2);
    await inject(lastSeq + 100, 3);
    await inject(lastSeq + 100, 4);
    await inject(lastSeq + 50, 5);
    await until(B, "g.name === 'p1' && g.data?.inj === 3");
    await sleep(300);
    same((await got(B, "g.name === 'p1' && g.data?.inj")).map((g) => g.data?.inj), [3], 'older, equal and repeated sequence numbers from the same person are dropped');
    await B.eval("(window.__mods.t.m.send('live.state', { state: 'open', fresh: true }), true)");
    await inject(1, 6);
    await until(B, "g.name === 'p1' && g.data?.inj === 6");
    ok(true, 'after a fresh ready, sequence numbers start over');

    // Unsubscribe stops delivery; the last one (and no people watch) leaves.
    await cmd(B, 't', 'unsubscribe', { name: 'p1' });
    await cmd(A, 't', 'publish', { topic: 'pointer', data: { un: 1 } });
    await until(B, "g.name === 'p2' && g.data?.un === 1");
    await sleep(300);
    same((await got(B, "g.name === 'p1' && g.data?.un === 1")).length, 0, 'unsubscribed: that handler hears no more, the other still does');
    for (const name of ['p2', 'ord', 'co', 'early']) await cmd(B, 't', 'unsubscribe', { name });
    const benLeft = await until(A, `g.mod === 't' && g.kind === 'people' && g.left && g.left.key === ${JSON.stringify(ben.key)}`, 3000, 'Ben left');
    ok(benLeft.length === 1, 'Ben\'s last topic unsubscribed: Ann is told he left, at once');
    await cmd(A, 't', 'publish', { topic: 'pointer', data: { gone: 1 } });
    await until(G, "g.kind === 'message' && g.data?.gone === 1");
    await sleep(300);
    same((await got(B, "g.mod === 't' && g.kind === 'message' && g.data?.gone === 1")).length, 0, 'and hears nothing more');

    // The server restarted: every frame goes connecting, joins again on the new ready, and hears seq from 1 again.
    await cmd(B, 't', 'subscribe', { topic: 'after', name: 'after' });
    await stateIs(B, 't', 'open');
    const beforeSeq = (await got(G, "g.kind === 'message'")).at(-1).meta.seq;
    const peopleBefore = (await got(A, "g.mod === 't' && g.kind === 'people'")).length;
    await stop();
    await start();
    same(child.exitCode, null, 'the server is back');
    for (const [T, k] of [[A, 't'], [B, 't'], [G, 't']]) await stateIs(T, k, 'open', 20000);
    const states = (await cmd(B, 't', 'state')).states;
    ok(states.includes('connecting') && states.at(-1) === 'open', `the module heard 'connecting' then 'open' (${states.join(', ')})`);
    const peopleAfter = await until(A, `g.mod === 't' && g.kind === 'people' && g.people.length === 3`, 8000);
    ok(peopleAfter.length > 0 && (await got(A, "g.mod === 't' && g.kind === 'people'")).length > peopleBefore, 'and joined again: Ann hears who is there anew');
    await cmd(A, 't', 'publish', { topic: 'after', data: { r: 1 } });
    const after = await until(B, "g.name === 'after' && g.data?.r === 1", 8000);
    ok(after[0].meta.seq <= beforeSeq && after[0].meta.seq === 1, `the new server's first sequence number (${after[0].meta.seq}) is heard though lower than the last (${beforeSeq})`);

    // Nothing the host posted to any module frame -- the hello answer, every answer and error, every event, before and after
    // the restart -- holds a module stream's id or the guest's pass.
    const pass = await G.eval('window.__guest.pass');
    ok(streamIds.size >= 6, `the stream ids the pages joined with are known (${streamIds.size})`);
    for (const T of [A, B, G]) {
      for (const k of Object.keys(mods)) {
        const { inbox, count } = await cmd(T, k, 'inbox');
        ok(count > 5 && inbox.includes('"live"'), `${T.name}'s ${k}: the host's messages were recorded (${count}, the hello answer among them)`);
        const leaked = [...streamIds].filter((id) => inbox.includes(id));
        same(leaked, [], `${T.name}'s ${k}: no stream id in anything the host posted to the module`);
        ok(!inbox.includes(pass) && !inbox.includes(pass.split('.')[1]) && !/pass=/.test(inbox), `${T.name}'s ${k}: no guest pass (nor its signature, nor pass=) either`);
      }
    }

    // Leaving: a new page in Ben's frame (reset), the guest's module unmounted, Ben's tab closed.
    await until(A, `g.mod === 't' && g.kind === 'people' && g.joined && g.joined.key === ${JSON.stringify(ben.key)}`, 8000);
    const leftCount = async (key) => (await got(A, `g.mod === 't' && g.kind === 'people' && g.left && g.left.key === ${JSON.stringify(key)}`)).length;
    const benLefts = await leftCount(ben.key);
    await B.eval("(window.__mods.t.f.src = window.__mods.t.f.src, true)");
    let t0 = Date.now();
    while ((await leftCount(ben.key)) === benLefts && Date.now() - t0 < 5000) await sleep(50);
    ok((await leftCount(ben.key)) > benLefts && Date.now() - t0 < 3000, `a new page in Ben's frame: he leaves at once (${Date.now() - t0} ms; the grace is 10 s)`);
    await until(B, "g.mod === 't' && g.kind === 'ready' && g.at > " + t0, 10000, 'the frame\'s new page');
    await cmd(B, 't', 'subscribe', { topic: 'pointer', name: 'again' });
    await until(A, `g.mod === 't' && g.kind === 'people' && g.joined && g.joined.key === ${JSON.stringify(ben.key)} && g.at > ${t0}`, 8000, 'Ben back');
    await cmd(A, 't', 'publish', { topic: 'early', data: { e: 2 } });
    await until(B, "g.mod === 't' && g.name === 'early' && g.data?.e === 2");
    ok(true, 'the new page\'s own early subscription holds: the old page\'s went, the new page\'s did not');
    t0 = Date.now();
    await G.eval('(window.__mods.t.m.destroy(), true)');
    await until(A, `g.mod === 't' && g.kind === 'people' && g.left && g.left.key === ${JSON.stringify(giaId)}`, 3000, 'Gia left');
    ok(Date.now() - t0 < 3000, `the guest's module unmounted: they leave at once (${Date.now() - t0} ms)`);
    const benLefts2 = await leftCount(ben.key);
    t0 = Date.now();
    await B.close();
    while ((await leftCount(ben.key)) === benLefts2 && Date.now() - t0 < 9000) await sleep(50);
    const closedMs = Date.now() - t0;
    ok((await leftCount(ben.key)) > benLefts2 && closedMs < 5000, `Ben's tab closed: he leaves as the page goes, well inside the 10-second grace (${closedMs} ms)`);

    // Never the call.
    const callAsks = asked.filter(([, url]) => /livekit|\/api\/call\/|\/api\/token/i.test(url));
    same(callAsks, [], 'no page asked for the call\'s client, a call token or the call routes');
    ok(asked.some(([, url]) => /\/api\/modules\/live-t\/live\/join\?/.test(url)) && asked.some(([, url]) => /\/api\/modules\/live-t\/live\?/.test(url)), 'the pages joined and sent on the module live routes');
    ok(asked.filter(([who, url]) => who === 'Gia' && /\/api\/modules\/live-t\/live/.test(url)).every(([, url]) => /[?&]pass=/.test(url)), 'every live call of the guest\'s carries their pass');
    ok(asked.some(([who, url]) => who === 'Gia' && /\/api\/modules\/stream\?[^ ]*pass=/.test(url)), 'and so does their module stream');
    ok(!/A live stream's listener failed|server error/i.test(out), `the server logged no failure:\n${out.slice(-1500)}`);
  } finally {
    for (const t of tabs) await t.close().catch(() => {});
    if (browser) {
      try { browser.cdp.ws.close(); } catch { /* gone */ }
      browser.child.kill(); // this browser only, started here
      await new Promise((r) => (browser.child.exitCode !== null ? r() : browser.child.once('exit', r)));
      // The browser's helpers may still be writing its profile for a moment.
      await sleep(1500);
      try { fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (err) { console.warn(`check-sdk-live: could not remove ${browser.dir}: ${err.message}`); }
    }
    await stop();
    try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (err) { console.warn(`check-sdk-live: could not remove ${TMP}: ${err.message}`); }
  }
}
say(`${n} checks passed${note || ', in Node and in a real frame in Chromium'}`);
