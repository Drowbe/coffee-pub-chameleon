#!/usr/bin/env node
/*
 * check-chat-model.mjs -- the one chat store (documentation/plans/plan-chat-model.md, GitHub #157): private and
 * public messages in DATA_DIR/chat.json, the one-time move of ai-threads.json, who reads what, the visibility PATCH,
 * "Delete your private messages", Clear… by type (plan-chat-clear.md, #166), the limits by kind, /ai's rule without
 * the Assistant, and the manifest's `color`.
 * The store and the manifest run in-process; the routes run against a throwaway server with a stand-in AI service.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { ChatHistory, CHAT_LIMITS } = require('../server/chat-history.js');
const { cleanManifest, ModuleError, TINTS } = require('../server/modules.js');
const { zipFiles } = require('../server/module-build.js');

let n = 0;
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-chat-model-${name}-`));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const DAY = 24 * 60 * 60 * 1000;
// The previous release's reader (frozen in tools/fixtures/chat-previous/): it reads chat.json and knows nothing of
// visibility, so whatever it lists is what everyone in a space would see after a roll back.
const { ChatHistory: PreviousChat } = require('./fixtures/chat-previous/chat-history.js');

// Both files, and the promise this build keeps: chat.json never holds a private message; chat-private.json holds only
// private ones. `merged` is every message on disk, by space.
function onDisk(dir, label = '') {
  const pub = fs.existsSync(path.join(dir, 'chat.json')) ? readJson(path.join(dir, 'chat.json')) : { spaces: {} };
  const priv = fs.existsSync(path.join(dir, 'chat-private.json')) ? readJson(path.join(dir, 'chat-private.json')) : { spaces: {} };
  assert.deepEqual(Object.keys(pub).filter((k) => !['spaces', 'cleared'].includes(k)), [], `${label}: chat.json keeps its old shape`);
  for (const [spaceId, list] of Object.entries(pub.spaces || {})) {
    for (const m of list) assert.ok(m.visibility !== 'private' && !('visibility' in m), `${label}: chat.json holds a private message in ${spaceId}: ${JSON.stringify(m)}`);
  }
  for (const list of Object.values(priv.spaces || {})) for (const m of list) assert.equal(m.visibility, 'private', `${label}: chat-private.json holds only private messages`);
  const merged = {};
  for (const src of [pub.spaces || {}, priv.spaces || {}]) for (const [k, list] of Object.entries(src)) merged[k] = [...(merged[k] || []), ...list].sort((a, b) => a.at - b.at);
  return { pub, priv, merged };
}
// What the previous release would show in a space: never a private message.
function previousSees(dir, spaceId, label = '') {
  const seen = new PreviousChat(dir).list(spaceId);
  assert.ok(!seen.some((m) => m.visibility === 'private'), `${label}: the previous release would show a private message`);
  return seen;
}

// --- the move from ai-threads.json ------------------------------------------------------------------------------

{
  const dir = tmp('move');
  const now = Date.now();
  // Today's chat, with one id the threads also use.
  fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify({
    spaces: {
      s1: [
        { id: 'aaaaaaaaaaaa', at: now - 5000, by: 'pat', who: 'Pat', text: 'hello all' },
        { id: 'bbbbbbbbbbbb', at: now - 1000, by: 'pat', who: 'Pat', text: 'AI answer shared by Pat\n\nIt is {{summary:0}}.' },
      ],
    },
    cleared: { s9: now - DAY },
  }));
  fs.writeFileSync(path.join(dir, 'ai-threads.json'), JSON.stringify({
    threads: {
      's1:pat': [
        { id: '111111111111', at: now - 9000, role: 'user', text: 'Where is Faro?' },
        { id: '222222222222', at: now - 8000, role: 'ai', text: 'In Portugal.', summaries: [{ title: 'Faro', content: 'A city.' }] },
        { id: '333333333333', at: now - 3000, role: 'user', text: 'Shared question', shared: true },
        { id: 'aaaaaaaaaaaa', at: now - 2000, role: 'ai', text: 'Shared answer {{summary:0}}', summaries: [{ title: 'X', content: 'Y' }], shared: true },
        { id: 'not-hex', at: now - 1500, role: 'ai', text: 'An answer with no question before it' },
      ],
      's1:gone': [{ id: '444444444444', at: now - 7000, role: 'user', text: 'From a deleted account' }],
      's2:pat': [{ id: '111111111111', at: now - 6000, role: 'user', text: 'Same id, another space' }],
    },
  }));
  const before = fs.readFileSync(path.join(dir, 'ai-threads.json'), 'utf8');
  const names = { pat: 'Pat' };
  const hist = new ChatHistory(dir);
  assert.equal(hist.moveThreads((k) => names[k] || null), 7, 'every thread entry moves');
  n += 1;

  assert.equal(fs.existsSync(path.join(dir, 'ai-threads.json')), false, 'the old file is renamed');
  assert.equal(fs.readFileSync(path.join(dir, 'ai-threads.moved.json'), 'utf8'), before, 'kept as it was, not deleted');
  const { pub, priv, merged } = onDisk(dir, 'after the move');
  assert.ok(priv.threadsMoved > 0, 'chat-private.json is marked threadsMoved');
  assert.deepEqual(pub.cleared, { s9: now - DAY }, 'cleared times are kept');
  assert.deepEqual(previousSees(dir, 's1', 'after the move').map((m) => m.text), ['hello all', 'AI answer shared by Pat\n\nIt is {{summary:0}}.']);
  assert.deepEqual(previousSees(dir, 's2', 'after the move'), []);
  n += 1;

  const disk = { spaces: merged };
  const s1 = disk.spaces.s1;
  assert.deepEqual(s1.map((m) => m.at), [...s1.map((m) => m.at)].sort((a, b) => a - b), 'oldest first');
  const byText = (t) => s1.find((m) => m.text === t);
  const q = byText('Where is Faro?');
  assert.deepEqual(q, { id: '111111111111', at: now - 9000, by: 'pat', who: 'Pat', text: 'Where is Faro?', visibility: 'private', kind: 'command', command: 'ai' });
  const a = byText('In Portugal.');
  assert.deepEqual(a, { id: '222222222222', at: now - 8000, by: 'pat', who: 'AI', text: 'In Portugal.', visibility: 'private', kind: 'ai', summaries: [{ title: 'Faro', content: 'A city.' }], replyTo: '111111111111' });
  n += 1;

  // shared: true stays private: its public copy is already in the chat.
  const sq = byText('Shared question');
  const sa = byText('Shared answer {{summary:0}}');
  assert.equal(sq.visibility, 'private');
  assert.equal(sa.visibility, 'private');
  assert.equal('shared' in sa, false, 'no shared field is carried');
  assert.notEqual(sa.id, 'aaaaaaaaaaaa', 'an id taken in the space gets a new one');
  assert.match(sa.id, /^[a-f0-9]{12}$/);
  assert.equal(sa.replyTo, sq.id);
  assert.equal(byText('hello all').id, 'aaaaaaaaaaaa', 'the chat message keeps its id');
  assert.deepEqual(byText('hello all'), { id: 'aaaaaaaaaaaa', at: now - 5000, by: 'pat', who: 'Pat', text: 'hello all' }, 'an old public message is not touched');
  assert.equal(byText('AI answer shared by Pat\n\nIt is {{summary:0}}.').visibility, undefined, 'the shared copy stays public, its text as it was');
  const lone = byText('An answer with no question before it');
  assert.match(lone.id, /^[a-f0-9]{12}$/, 'an id that is not 12 hex characters is renewed');
  assert.equal(lone.replyTo, undefined, 'an answer after another answer names no question');
  assert.equal(byText('From a deleted account').who, 'someone');
  assert.equal(byText('From a deleted account').by, 'gone');
  assert.equal(disk.spaces.s2[0].id, '111111111111', 'the same id in another space is kept');
  n += 1;

  // A second start does nothing, even if an ai-threads.json comes back.
  const marked = fs.readFileSync(path.join(dir, 'chat.json'), 'utf8');
  const markedPrivate = fs.readFileSync(path.join(dir, 'chat-private.json'), 'utf8');
  fs.writeFileSync(path.join(dir, 'ai-threads.json'), before);
  const again = new ChatHistory(dir);
  assert.equal(again.moveThreads((k) => names[k] || null), 0);
  assert.equal(fs.readFileSync(path.join(dir, 'chat.json'), 'utf8'), marked, 'chat.json is not written again');
  assert.equal(fs.readFileSync(path.join(dir, 'chat-private.json'), 'utf8'), markedPrivate, 'nor chat-private.json');
  assert.equal(fs.readFileSync(path.join(dir, 'ai-threads.json'), 'utf8'), before, 'the restored file is left alone');
  assert.equal(again.list('s1', 'pat').length, 7);
  n += 1;

  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // No ai-threads.json: nothing is written, and a chat.json from before reads exactly as before.
  const dir = tmp('nothing');
  const old = { spaces: { s: [{ id: 'cccccccccccc', at: Date.now(), by: 'pat', who: 'Pat', text: 'old' }] }, cleared: {} };
  fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify(old));
  const hist = new ChatHistory(dir);
  assert.equal(hist.moveThreads(() => 'X'), 0);
  assert.deepEqual(readJson(path.join(dir, 'chat.json')), old);
  assert.deepEqual(hist.list('s', null), old.spaces.s);
  const empty = tmp('empty');
  assert.equal(new ChatHistory(empty).moveThreads(() => 'X'), 0);
  assert.deepEqual(fs.readdirSync(empty), [], 'a fresh data folder gets no chat.json from the move');
  // An unreadable ai-threads.json is left where it is, unmarked.
  fs.writeFileSync(path.join(empty, 'ai-threads.json'), '{ not json');
  assert.equal(new ChatHistory(empty).moveThreads(() => 'X'), 0);
  assert.deepEqual(fs.readdirSync(empty), ['ai-threads.json']);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
  n += 1;
}

{
  // A chat.json from a build that kept private entries in it (and its threadsMoved mark) is split on the first load.
  const dir = tmp('legacy');
  const at = Date.now();
  fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify({
    spaces: { s: [
      { id: 'd00000000001', at, by: 'pat', who: 'Pat', text: 'public one' },
      { id: 'd00000000002', at: at + 1, by: 'pat', who: 'Pat', text: 'private one', visibility: 'private', kind: 'command', command: 'r', module: 'research' },
      { id: 'd00000000003', at: at + 2, by: 'sam', who: 'AI', text: 'private answer', visibility: 'private', kind: 'ai' },
    ] },
    cleared: {},
    threadsMoved: at - 5,
  }));
  assert.equal(new PreviousChat(dir).list('s').length, 3, 'the case to fix: the previous release would show all three');
  const hist = new ChatHistory(dir);
  const { pub, priv } = onDisk(dir, 'after the split');
  assert.deepEqual(pub.spaces.s.map((m) => m.id), ['d00000000001']);
  assert.deepEqual(priv.spaces.s.map((m) => m.id), ['d00000000002', 'd00000000003']);
  assert.equal(priv.threadsMoved, at - 5, 'the mark moves with them');
  assert.deepEqual(previousSees(dir, 's', 'after the split').map((m) => m.text), ['public one']);
  assert.deepEqual(hist.list('s', 'pat').map((m) => m.text), ['public one', 'private one']);
  assert.deepEqual(new ChatHistory(dir).list('s', 'sam').map((m) => m.text), ['public one', 'private answer'], 'reads back the same');
  n += 1;

  // chat.json never holds a private message after any change; the previous release never shows one.
  const ops = new ChatHistory(dir);
  const check = (label) => { ops.flush(); onDisk(dir, label); previousSees(dir, 's', label); };
  ops.add('s', { by: 'pat', who: 'Pat', text: 'posted' }); check('a post');
  const echo = ops.add('s', { by: 'pat', who: 'Pat', text: 'echo', visibility: 'private', kind: 'command', command: 'v', module: 'polls' }); check('a command');
  const q = ops.add('s', { by: 'pat', who: 'Pat', text: 'q', visibility: 'private', kind: 'command', command: 'ai' });
  const a = ops.add('s', { by: 'pat', who: 'AI', text: 'a', visibility: 'private', kind: 'ai', replyTo: q.id }); check('/ai');
  ops.setVisibility('s', a.id, 'pat', 'public'); onDisk(dir, 'made public');
  assert.ok(previousSees(dir, 's', 'made public').some((m) => m.id === a.id), 'a public answer is in chat.json');
  assert.ok(!readJson(path.join(dir, 'chat-private.json')).spaces.s.some((m) => m.id === a.id), 'and out of chat-private.json');
  ops.setVisibility('s', a.id, 'pat', 'private'); onDisk(dir, 'made private');
  assert.ok(!previousSees(dir, 's', 'made private').some((m) => m.id === a.id));
  const posted = ops.list('s', null).find((m) => m.text === 'posted');
  ops.setVisibility('s', posted.id, 'pat', 'private'); onDisk(dir, 'a post made private');
  assert.ok(!previousSees(dir, 's', 'a post made private').some((m) => m.id === posted.id));
  // Round trip: the same message, read back from disk, after each way.
  const before = new ChatHistory(dir).list('s', 'pat').find((m) => m.id === a.id);
  ops.setVisibility('s', a.id, 'pat', 'public');
  ops.setVisibility('s', a.id, 'pat', 'private');
  assert.deepEqual(new ChatHistory(dir).list('s', 'pat').find((m) => m.id === a.id), before, 'a round trip changes nothing');
  ops.removePrivate('s', 'pat'); check('delete your private messages');
  assert.ok(!ops.list('s', 'pat').some((m) => m.id === echo.id));
  ops.clear('s'); check('delete the chat');
  assert.deepEqual(onDisk(dir).priv.spaces, {}, 'delete the chat empties chat-private.json for that space');
  n += 1;

  // A change cut short between the two writes: never in neither file; found in both, it reads back once, as private.
  for (const [from, to] of [['private', 'public'], ['public', 'private']]) {
    const d = tmp(`cut-${to}`);
    const h = new ChatHistory(d);
    const m = h.add('s', { by: 'pat', who: 'Pat', text: `was ${from}`, ...(from === 'private' ? { visibility: 'private', kind: 'command', command: 'r' } : {}) });
    h.add('s', { by: 'sam', who: 'Sam', text: 'other' });
    h.flush();
    let writes = 0;
    const real = h.writeFile.bind(h);
    h.writeFile = (file, data) => { writes += 1; if (writes === 2) throw new Error('stopped'); return real(file, data); };
    h.setVisibility('s', m.id, 'pat', to);
    assert.equal(writes, 2, 'the second write was cut');
    const { merged } = onDisk(d, `cut short making it ${to}`);
    assert.equal(merged.s.filter((x) => x.id === m.id).length, 2, `making it ${to}: written where it goes first, so it is in both, not neither`);
    // Cut short, chat.json holds it only when it was public until now, or its author had just made it public.
    previousSees(d, 's', `cut short making it ${to}`);
    const back = new ChatHistory(d);
    const pats = back.list('s', 'pat').filter((x) => x.id === m.id);
    assert.equal(pats.length, 1, 'no duplicate');
    assert.equal(pats[0].visibility, 'private', 'in both reads as private: nothing private is ever shown');
    assert.ok(!back.list('s', 'sam').some((x) => x.id === m.id));
    const healed = onDisk(d, 'healed on load');
    assert.equal(healed.merged.s.filter((x) => x.id === m.id).length, 1, 'the load writes the files apart again');
    // Made private: done. Made public: still private, and the author can make it public again.
    assert.equal(new ChatHistory(d).setVisibility('s', m.id, 'pat', to).changed, to === 'public');
    fs.rmSync(d, { recursive: true, force: true });
  }
  n += 1;
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- the store: who reads what, and the limits --------------------------------------------------------------------

{
  const dir = tmp('store');
  const hist = new ChatHistory(dir);
  const pub = hist.add('s', { by: 'pat', who: 'Pat', text: 'public' });
  const mine = hist.add('s', { by: 'pat', who: 'Pat', text: 'note', visibility: 'private', kind: 'command', command: 'r', module: 'research' });
  assert.equal(pub.visibility, undefined, 'public is stored as no field');
  assert.equal(mine.visibility, 'private');
  assert.deepEqual(hist.list('s', 'pat').map((m) => m.text), ['public', 'note']);
  assert.deepEqual(hist.list('s', 'sam').map((m) => m.text), ['public'], 'another person never gets it');
  assert.deepEqual(hist.list('s', null).map((m) => m.text), ['public'], 'nor a guest');
  assert.deepEqual(hist.list('s', 'guest').map((m) => m.text), ['public']);
  assert.equal(hist.find('s', mine.id, 'sam'), null);
  // Flip: only visibility changes.
  const flipped = hist.setVisibility('s', mine.id, 'pat', 'public');
  const { visibility: _was, ...minePublic } = mine;
  assert.deepEqual(flipped, { message: minePublic, changed: true });
  assert.deepEqual(hist.setVisibility('s', mine.id, 'pat', 'public').changed, false);
  assert.equal(hist.setVisibility('s', mine.id, 'sam', 'private'), false, "someone else's public message");
  hist.setVisibility('s', mine.id, 'pat', 'private');
  assert.equal(hist.setVisibility('s', mine.id, 'sam', 'public'), null, "someone else's private message is none");
  // Delete: someone else's private message is none, for a moderator (by null) too.
  assert.equal(hist.remove('s', mine.id, null, 'sam'), null);
  assert.equal(hist.remove('s', mine.id, 'sam', 'sam'), null);
  assert.ok(hist.list('s', 'pat').some((m) => m.id === mine.id));
  n += 1;

  // The question quoted on a public AI answer, as read, never stored; only the author's own question.
  const q1 = hist.add('q', { by: 'pat', who: 'Pat', text: 'Where?', visibility: 'private', kind: 'command', command: 'ai' });
  const a1 = hist.add('q', { by: 'pat', who: 'AI', text: 'There.', visibility: 'private', kind: 'ai', replyTo: q1.id });
  const samQ = hist.add('q', { by: 'sam', who: 'Sam', text: 'Sam asks', visibility: 'private', kind: 'command', command: 'ai' });
  const odd = hist.add('q', { by: 'pat', who: 'AI', text: 'Odd.', visibility: 'private', kind: 'ai', replyTo: samQ.id });
  assert.equal(hist.list('q', 'pat').find((m) => m.id === a1.id).question, undefined, 'private: no quote, even for the author');
  assert.ok(!hist.list('q', 'sam').some((m) => m.id === a1.id));
  hist.setVisibility('q', a1.id, 'pat', 'public');
  hist.setVisibility('q', odd.id, 'pat', 'public');
  for (const viewer of ['sam', null, 'pat']) {
    const seen = hist.list('q', viewer);
    assert.deepEqual(seen.find((m) => m.id === a1.id).question, { who: 'Pat', text: 'Where?' }, String(viewer));
    assert.equal(seen.find((m) => m.id === odd.id).question, undefined, "never someone else's question");
  }
  assert.deepEqual(hist.list('q', 'sam').map((m) => m.text).sort(), ['Odd.', 'Sam asks', 'There.'], 'the question itself never reaches Sam');
  assert.equal(hist.spaces.q.find((m) => m.id === a1.id).question, undefined, 'never stored');
  hist.flush();
  assert.ok(!fs.readFileSync(path.join(dir, 'chat.json'), 'utf8').includes('"question"'));
  const longQ = hist.add('q', { by: 'pat', who: 'Pat', text: 'z'.repeat(5000), visibility: 'private', kind: 'command', command: 'ai' });
  const longA = hist.add('q', { by: 'pat', who: 'AI', text: 'Long.', visibility: 'private', kind: 'ai', replyTo: longQ.id });
  assert.equal(hist.setVisibility('q', longA.id, 'pat', 'public').message.question.text.length, 300, 'the quote is cut to 300');
  hist.remove('q', q1.id, 'pat');
  assert.equal(hist.list('q', 'sam').find((m) => m.id === a1.id).question, undefined, 'a deleted question is not quoted');
  n += 1;

  // Text limits by kind.
  const long = 'x'.repeat(9000);
  assert.equal(hist.add('t', { by: 'pat', who: 'Pat', text: long }).text.length, CHAT_LIMITS.MAX_TEXT);
  assert.equal(CHAT_LIMITS.MAX_TEXT, 1000);
  assert.equal(hist.add('t', { by: 'pat', who: 'Pat', text: long, visibility: 'private', kind: 'command', command: 'r', module: 'research' }).text.length, 1000);
  assert.equal(hist.add('t', { by: 'pat', who: 'AI', text: long, visibility: 'private', kind: 'ai' }).text.length, 8000);
  assert.equal(hist.add('t', { by: 'pat', who: 'Pat', text: long, visibility: 'private', kind: 'command', command: 'ai' }).text.length, 8000);
  const big = hist.add('t', { by: 'pat', who: 'AI', text: long, visibility: 'private', kind: 'ai', summaries: Array.from({ length: 30 }, (_, i) => ({ title: `${i}` })) });
  assert.equal(big.summaries.length, 20);
  const flippedBig = hist.setVisibility('t', big.id, 'pat', 'public');
  assert.equal(flippedBig.message.text.length, 8000, 'flipping never trims a message');
  n += 1;

  // Windows counted apart: 500 public per space, 200 private per person per space, 30 days for all.
  const w = new ChatHistory(dir);
  const t0 = Date.now() - 1000 * 1000;
  w.spaces.w = [
    { id: 'old000000000', at: Date.now() - CHAT_LIMITS.MAX_AGE_MS - 1000, by: 'pat', who: 'Pat', text: 'too old', visibility: 'private' },
    ...Array.from({ length: 260 }, (_, i) => ({ id: `p${i}`, at: t0 + i, by: 'pat', who: 'Pat', text: `pat ${i}`, visibility: 'private' })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, at: t0 + 300 + i, by: 'sam', who: 'Sam', text: `sam ${i}`, visibility: 'private' })),
    ...Array.from({ length: 620 }, (_, i) => ({ id: `u${i}`, at: t0 + 400 + i, by: 'sam', who: 'Sam', text: `pub ${i}` })),
  ];
  const patSees = w.list('w', 'pat');
  assert.equal(patSees.filter((m) => m.visibility !== 'private').length, 500);
  assert.equal(patSees.filter((m) => m.visibility === 'private').length, 200);
  assert.equal(patSees.find((m) => m.visibility === 'private').text, 'pat 60', 'the oldest private ones go first');
  assert.equal(w.list('w', 'sam').filter((m) => m.visibility === 'private').length, 10, "one person's private use never pushes out another's");
  assert.equal(patSees.find((m) => m.visibility !== 'private').text, 'pub 120');
  assert.ok(!patSees.some((m) => m.text === 'too old'));
  // A lot of private use never pushes the public chat out.
  for (let i = 0; i < 300; i += 1) w.add('w', { by: 'pat', who: 'AI', text: `more ${i}`, visibility: 'private', kind: 'ai' });
  assert.equal(w.list('w', null).length, 500);
  n += 1;

  // Delete your private messages: only the person's own, never a public one.
  const d = new ChatHistory(dir);
  d.add('d', { by: 'pat', who: 'Pat', text: 'pat public' });
  d.add('d', { by: 'pat', who: 'Pat', text: 'pat private', visibility: 'private', kind: 'command', command: 'r' });
  d.add('d', { by: 'pat', who: 'AI', text: 'pat ai', visibility: 'private', kind: 'ai' });
  d.add('d', { by: 'sam', who: 'Sam', text: 'sam private', visibility: 'private', kind: 'command', command: 'r' });
  d.add('d', { by: 'sam', who: 'Sam', text: 'sam public' });
  assert.equal(d.removePrivate('d', 'pat'), 2);
  assert.deepEqual(d.list('d', 'pat').map((m) => m.text), ['pat public', 'sam public']);
  assert.deepEqual(d.list('d', 'sam').map((m) => m.text), ['pat public', 'sam private', 'sam public']);
  assert.equal(d.removePrivate('d', null), 0);
  n += 1;

  // Clear… by type (plan-chat-clear.md): each type takes exactly its messages; `mine` the caller's own, public and
  // private; `everyone` every public one plus the caller's own private ones, never another person's private message.
  const cdir = tmp('clear');
  const seedClear = () => {
    const c = new ChatHistory(cdir);
    delete c.spaces.c;
    const at = Date.now() - 10000;
    let i = 0;
    const put = (by, text, extra = {}) => c.add('c', { by, who: by, text, at: at + (i += 1), ...extra });
    for (const by of ['pat', 'sam']) {
      put(by, `${by} chat`);
      put(by, `${by} chat private`, { visibility: 'private' });
      const q = put(by, `${by} asks`, { visibility: 'private', kind: 'command', command: 'ai' });
      put(by, `${by} answer`, { visibility: 'private', kind: 'ai', replyTo: q.id });
      put(by, `${by} public answer`, { kind: 'ai' });
      put(by, `${by} todo`, { visibility: 'private', kind: 'command', command: 't', module: 'todo' });
      put(by, `${by} todo public`, { kind: 'command', command: 't', module: 'todo' });
      put(by, `${by} tasks`, { visibility: 'private', kind: 'command', command: 't', module: 'tasks' }); // same command, another module
      put(by, `${by} tasks public`, { kind: 'command', command: 't', module: 'tasks' });
    }
    c.flush();
    return c;
  };
  const texts = (list) => list.map((m) => m.text).sort();
  const allTexts = (c) => texts(c.spaces.c || []);
  const cases = [
    [{ type: 'chat', scope: 'mine' }, ['pat chat', 'pat chat private']],
    [{ type: 'ai', scope: 'mine' }, ['pat answer', 'pat asks', 'pat public answer']],
    [{ type: 'module', module: 'todo', scope: 'mine' }, ['pat todo', 'pat todo public']],
    [{ type: 'all', scope: 'mine' }, ['pat answer', 'pat asks', 'pat chat', 'pat chat private', 'pat public answer', 'pat tasks', 'pat tasks public', 'pat todo', 'pat todo public']],
    [{ type: 'chat', scope: 'everyone' }, ['pat chat', 'pat chat private', 'sam chat']],
    [{ type: 'ai', scope: 'everyone' }, ['pat answer', 'pat asks', 'pat public answer', 'sam public answer']],
    [{ type: 'module', module: 'todo', scope: 'everyone' }, ['pat todo', 'pat todo public', 'sam todo public']],
    [{ type: 'all', scope: 'everyone' }, ['pat answer', 'pat asks', 'pat chat', 'pat chat private', 'pat public answer', 'pat tasks', 'pat tasks public', 'pat todo', 'pat todo public', 'sam chat', 'sam public answer', 'sam tasks public', 'sam todo public']],
  ];
  for (const [ask, gone] of cases) {
    const c = seedClear();
    const before = allTexts(c);
    const samPrivate = c.spaces.c.filter((m) => m.by === 'sam' && m.visibility === 'private').map((m) => m.id);
    const removed = c.clearByType('c', { ...ask, by: 'pat' });
    const label = JSON.stringify(ask);
    assert.deepEqual(texts(removed), gone, label);
    assert.deepEqual(allTexts(c), before.filter((t) => !gone.includes(t)), `${label}: the rest stays`);
    for (const id of samPrivate) assert.ok(c.spaces.c.some((m) => m.id === id), `${label}: another person's private message stays`);
    // Written once, to both files; read back the same after a restart.
    const back = new ChatHistory(cdir);
    assert.deepEqual(allTexts(back), allTexts(c), `${label}: as written`);
    const onFile = onDisk(cdir, label).merged.c || [];
    for (const m of removed) assert.ok(!onFile.some((x) => x.id === m.id), `${label}: gone from both files`);
  }
  n += 1;

  // Anything unknown or missing removes nothing: a request that lost its words never empties the chat.
  {
    const c = seedClear();
    const before = allTexts(c);
    for (const ask of [
      {}, { scope: 'everyone', by: 'pat' }, { type: 'all', by: 'pat' }, { type: 'all', scope: 'everyone' }, { type: 'all', scope: 'everyone', by: '' },
      { type: 'All', scope: 'everyone', by: 'pat' }, { type: 'toString', scope: 'everyone', by: 'pat' }, { type: '__proto__', scope: 'everyone', by: 'pat' },
      { type: 'constructor', scope: 'mine', by: 'pat' }, { type: ['all'], scope: 'everyone', by: 'pat' }, { type: 'all', scope: 'Everyone', by: 'pat' },
      { type: 'module', scope: 'everyone', by: 'pat' }, { type: 'module', module: '', scope: 'everyone', by: 'pat' }, { type: 'module', module: 'nosuch', scope: 'everyone', by: 'pat' },
      { type: 'module', module: 't', scope: 'everyone', by: 'pat' },
    ]) {
      assert.deepEqual(c.clearByType('c', ask), [], JSON.stringify(ask));
    }
    assert.deepEqual(allTexts(c), before, 'nothing went');
    assert.deepEqual(c.clearByType('none', { type: 'all', scope: 'everyone', by: 'pat' }), [], 'a space with no chat');
    // `cleared` is never touched, and an emptied space leaves no list behind.
    c.cleared.c = 12345;
    c.clearByType('c', { type: 'all', scope: 'everyone', by: 'pat' });
    c.clearByType('c', { type: 'all', scope: 'mine', by: 'sam' });
    assert.equal(c.spaces.c, undefined);
    assert.equal(c.clearedAt('c'), 12345);
    assert.equal(readJson(path.join(cdir, 'chat.json')).cleared.c, 12345);
    // A guest's shared sender clears only the 'guest' messages, never a person's (the route refuses guests anyway).
    const g = seedClear();
    g.add('c', { by: 'guest', who: 'Guest', text: 'guest says' });
    assert.deepEqual(texts(g.clearByType('c', { type: 'chat', scope: 'mine', by: 'guest' })), ['guest says']);
  }
  n += 1;
  fs.rmSync(cdir, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- the manifest's color ----------------------------------------------------------------------------------------

const files = new Set(['canvas.html']);
const base = (extra) => ({ id: 'tinted', name: 'Tinted', version: '1.0.0', scope: ['space'], surfaces: { canvas: { entry: 'canvas.html' } }, ...extra });
assert.deepEqual(TINTS, ['gold', 'blue', 'green', 'teal', 'purple', 'red', 'orange', 'pink']);
for (const tint of TINTS) assert.equal(cleanManifest(base({ color: tint }), files).color, tint);
assert.equal(cleanManifest(base({}), files).color, null, 'no color is neutral');
assert.equal(cleanManifest(base({ color: null }), files).color, null);
const tintRefusal = 'module.json: "color" must be one of gold, blue, green, teal, purple, red, orange, pink';
for (const bad of ['mauve', 'Blue', '#ff0000', 'var(--accent)', '', 3, true, ['blue'], 'ai']) {
  assert.throws(() => cleanManifest(base({ color: bad }), files), (err) => err instanceof ModuleError && err.message === tintRefusal, JSON.stringify(bad));
}
n += 1;

// --- the routes, on a throwaway server ------------------------------------------------------------------------------

const aiServer = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: 'A short answer.' } }], usage: { total_tokens: 12 } }));
});
await new Promise((r) => aiServer.listen(0, '127.0.0.1', r));
const aiAddress = `http://127.0.0.1:${aiServer.address().port}`;

// What the server tells the space's chat is read from the live stream (GET /api/live), as a page would hear it.
const sent = []; // { payload }
let liveCtl = null;
async function listenLive(urlPath, cookie) {
  liveCtl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers: { cookie: `app_session=${cookie}` }, signal: liveCtl.signal });
  assert.equal(res.status, 200, 'the live stream opens');
  let ready = null;
  const opened = new Promise((r) => { ready = r; });
  (async () => {
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let at;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, at).split('\n').find((l) => l.startsWith('data: '));
          buf = buf.slice(at + 2);
          if (!line) continue;
          const data = JSON.parse(line.slice(6));
          if (data.type === 'ready') ready();
          else sent.push({ payload: data });
        }
      }
    } catch { /* closed */ }
  })();
  await opened;
}

const dataDir = tmp('server');
fs.writeFileSync(path.join(dataDir, 'ai.json'), JSON.stringify({
  source: 'custom', provider: 'compatible', address: aiAddress, model: 'stand-in-model', key: 'sk-test', enabled: true,
}));

let child = null;
let port = 0;
let serverOut = '';
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir,
      ADMIN_PASSWORD: 'testpass1234',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverOut = '';
  child.stdout.on('data', (d) => { serverOut += d; });
  child.stderr.on('data', (d) => { serverOut += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${serverOut}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(serverOut); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${serverOut}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });

async function call(method, urlPath, { body, cookie, raw, type } = {}) {
  const headers = { accept: 'application/json' };
  if (cookie) headers.cookie = `app_session=${cookie}`;
  let payload;
  if (raw !== undefined) {
    headers['content-type'] = type || 'text/plain';
    payload = raw;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

await startServer();
let ids;
try {
  const login = async (name, password) => {
    const r = await call('POST', '/api/login', { body: { login: name, password } });
    assert.equal(r.status, 200, `${name} signs in: ${r.text}`);
    return r.json.token;
  };
  const owner = await login('admin', 'testpass1234');
  const patUser = (await call('POST', '/api/users', { cookie: owner, body: { login: 'pat', displayName: 'Pat', role: 'member', password: 'memberpass1234' } })).json.user;
  const samUser = (await call('POST', '/api/users', { cookie: owner, body: { login: 'sam', displayName: 'Sam', role: 'member', password: 'memberpass1234' } })).json.user;
  const space = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Trip', members: [patUser.key, samUser.key] } })).json.space;
  ids = { pat: patUser.key, sam: samUser.key, space: space.id };
  // Before the upgrade: an old private thread of Pat's, and the copy the old Shared switch posted.
  const sharedCopy = await call('POST', `/api/spaces/${space.id}/chat`, { cookie: await login('pat', 'memberpass1234'), body: { text: 'AI answer shared by Pat\n\nOld answer {{summary:0}}' } });
  assert.equal(sharedCopy.status, 200, sharedCopy.text);
} finally {
  await stopServer();
}
// Written while the server is stopped, as an install from before the upgrade would have it.
const t = Date.now() - 60000;
fs.writeFileSync(path.join(dataDir, 'ai-threads.json'), JSON.stringify({
  threads: {
    [`${ids.space}:${ids.pat}`]: [
      { id: 'a00000000001', at: t, role: 'user', text: 'Old question', shared: true },
      { id: 'a00000000002', at: t + 1, role: 'ai', text: 'Old answer {{summary:0}}', summaries: [{ title: 'Faro', content: 'A city.' }], shared: true },
    ],
  },
}));

await startServer();
try {
  assert.match(serverOut, /Moved 2 private AI messages into the chat\./);
  assert.ok(fs.existsSync(path.join(dataDir, 'ai-threads.moved.json')) && !fs.existsSync(path.join(dataDir, 'ai-threads.json')));
  const login = async (name, password) => (await call('POST', '/api/login', { body: { login: name, password } })).json.token;
  const owner = await login('admin', 'testpass1234');
  const pat = await login('pat', 'memberpass1234');
  const sam = await login('sam', 'memberpass1234');
  assert.equal((await call('PATCH', '/api/roles/member', { cookie: owner, body: { useAi: true } })).status, 200); // using AI needs the role's Use AI
  const S = ids.space;
  const chatOf = async (cookie, q = '') => {
    const r = await call('GET', `/api/spaces/${S}/chat${q}`, { cookie });
    assert.equal(r.status, 200, r.text);
    return r.json.messages;
  };
  const guestToken = (await call('POST', `/api/spaces/${S}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;
  assert.ok(guestToken, 'a guest link');
  const asGuest = `?guest=${encodeURIComponent(guestToken)}`;
  const privateIds = async () => (await chatOf(pat)).filter((m) => m.visibility === 'private').map((m) => m.id);
  // Nobody but Pat ever receives one of Pat's private messages, from any route that lists messages.
  const nobodyElseSees = async (label) => {
    const mine = await privateIds();
    for (const [who, list] of [['sam', await chatOf(sam)], ['owner', await chatOf(owner)], ['guest', await chatOf(null, asGuest)]]) {
      assert.ok(!list.some((m) => m.visibility === 'private'), `${label}: ${who} gets no private message`);
      assert.ok(!list.some((m) => mine.includes(m.id)), `${label}: ${who} gets none of Pat's private ids`);
    }
    return mine;
  };

  // The move, through the server: the thread is Pat's private messages; shared:true stayed private.
  const patChat = await chatOf(pat);
  const oldQ = patChat.find((m) => m.id === 'a00000000001');
  const oldA = patChat.find((m) => m.id === 'a00000000002');
  assert.deepEqual([oldQ.visibility, oldQ.kind, oldQ.command, oldQ.who, oldQ.by], ['private', 'command', 'ai', 'Pat', ids.pat]);
  assert.deepEqual([oldA.visibility, oldA.kind, oldA.who, oldA.replyTo, oldA.summaries.length], ['private', 'ai', 'AI', 'a00000000001', 1]);
  assert.ok(patChat.some((m) => m.text.startsWith('AI answer shared by Pat') && !m.visibility), 'the old copy stays public');
  await nobodyElseSees('after the move');
  n += 1;

  // A second start does nothing.
  const marked = fs.readFileSync(path.join(dataDir, 'chat.json'), 'utf8');
  await stopServer();
  await startServer();
  assert.doesNotMatch(serverOut, /Moved \d+ private AI/);
  assert.ok(readJson(path.join(dataDir, 'chat-private.json')).threadsMoved > 0);
  assert.equal(fs.readFileSync(path.join(dataDir, 'chat.json'), 'utf8'), marked, 'a second start writes nothing');
  assert.equal((await chatOf(pat)).filter((m) => m.visibility === 'private').length, 2);
  n += 1;

  // /ai stores the question and the answer as private messages; share is accepted and ignored; nothing goes public.
  const publicBefore = (await chatOf(sam)).length;
  const asked = await call('POST', `/api/spaces/${S}/ai`, { cookie: pat, body: { question: 'What is Faro?', share: true } });
  assert.equal(asked.status, 200, asked.text);
  assert.equal(asked.json.shared, false);
  assert.match(asked.json.text, /short answer/i);
  assert.equal(asked.json.message.id, asked.json.id);
  assert.equal(asked.json.question.id, asked.json.questionId);
  assert.deepEqual([asked.json.question.visibility, asked.json.question.kind, asked.json.question.command, asked.json.question.who, asked.json.question.text], ['private', 'command', 'ai', 'Pat', 'What is Faro?']);
  assert.deepEqual([asked.json.message.visibility, asked.json.message.kind, asked.json.message.who, asked.json.message.replyTo, asked.json.message.by], ['private', 'ai', 'AI', asked.json.questionId, ids.pat]);
  assert.equal((await chatOf(sam)).length, publicBefore, 'share: true posts nothing public');
  assert.ok((await chatOf(pat)).some((m) => m.id === asked.json.id));
  n += 1;

  // The old thread routes are gone: the chat is the one place the thread lives.
  assert.equal((await call('GET', `/api/spaces/${S}/ai/thread`, { cookie: pat })).status, 404);
  n += 1;

  // A command's echo is stored as the caller's private message.
  assert.equal((await call('POST', '/api/modules/bundled/polls/install', { cookie: owner, body: {} })).status, 201);
  assert.equal((await call('PATCH', '/api/modules/polls', { cookie: owner, body: { enabled: true, allSpaces: true } })).status, 200);
  const vote = await call('POST', `/api/spaces/${S}/command`, { cookie: pat, body: { name: 'p', text: 'where to stay' } });
  assert.equal(vote.status, 200, vote.text);
  assert.deepEqual([vote.json.message.visibility, vote.json.message.kind, vote.json.message.command, vote.json.message.module, vote.json.message.text, vote.json.message.who], ['private', 'command', 'p', 'polls', 'where to stay', 'Pat']);
  const refused = await call('POST', `/api/spaces/${S}/command`, { cookie: pat, body: { name: 'zzzz', text: 'stored?' } });
  assert.equal(refused.status, 404);
  assert.ok(!(await chatOf(pat)).some((m) => m.text === 'stored?'), 'a refused command stores nothing');
  const guestVote = await call('POST', `/api/spaces/${S}/command${asGuest}`, { body: { name: 'p', text: 'guest vote' } });
  assert.equal(guestVote.status, 200, guestVote.text);
  assert.equal(guestVote.json.message, null, "a guest's echo is not stored");
  assert.ok(!(await chatOf(pat)).some((m) => m.text === 'guest vote'));
  assert.ok(!(await chatOf(null, asGuest)).some((m) => m.text === 'guest vote'));
  // POST /chat is always public, whatever it is sent.
  const sneaky = await call('POST', `/api/spaces/${S}/chat`, { cookie: pat, body: { text: 'plain', visibility: 'private', kind: 'ai', summaries: [{ title: 'x' }] } });
  assert.equal(sneaky.status, 200);
  assert.deepEqual(Object.keys(sneaky.json.message).sort(), ['at', 'by', 'id', 'text', 'who']);
  await nobodyElseSees('after /ai and a command');
  n += 1;

  // Moderators and owners never see another's private messages.
  await call('PATCH', `/api/users/${ids.sam}/spaces/${S}`, { cookie: owner, body: { permissions: { moderator: true } } });
  await nobodyElseSees('sam as moderator');
  const modDelete = await call('DELETE', `/api/spaces/${S}/chat/${asked.json.id}`, { cookie: sam });
  assert.deepEqual([modDelete.status, modDelete.json.error], [404, 'no such message'], "a moderator cannot delete someone's private message");
  assert.equal((await call('DELETE', `/api/spaces/${S}/chat/${asked.json.id}`, { cookie: owner })).status, 404);
  n += 1;

  // PATCH: the author flips; only visibility changes.
  const answer = (await chatOf(pat)).find((m) => m.id === asked.json.id);
  const toPublic = await call('PATCH', `/api/spaces/${S}/chat/${answer.id}`, { cookie: pat, body: { visibility: 'public' } });
  assert.equal(toPublic.status, 200, toPublic.text);
  assert.equal(answer.question, undefined, 'a private answer carries no question, even for its author');
  const { visibility: _v, ...answerPublic } = answer;
  const quoted = { ...answerPublic, question: { who: 'Pat', text: 'What is Faro?' } };
  assert.deepEqual(toPublic.json.message, quoted, 'same id, at, kind, text, summaries, replyTo; the question quoted as read');
  assert.deepEqual((await chatOf(sam)).find((m) => m.id === answer.id), quoted, 'now everyone gets it, as it is, with its question quoted');
  assert.ok(!(await chatOf(sam)).some((m) => m.id === asked.json.questionId), 'the question itself stays private');
  assert.ok(!(await chatOf(null, asGuest)).some((m) => m.id === asked.json.questionId));
  for (const f of ['chat.json', 'chat-private.json']) assert.ok(!fs.readFileSync(path.join(dataDir, f), 'utf8').includes('"question"'), `the quote is never stored (${f})`);
  assert.ok((await chatOf(null, asGuest)).some((m) => m.id === answer.id));
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/${answer.id}`, { cookie: pat, body: { visibility: 'public' } })).status, 200, 'the same value is a 200');
  const notAuthor = await call('PATCH', `/api/spaces/${S}/chat/${answer.id}`, { cookie: sam, body: { visibility: 'private' } });
  assert.deepEqual([notAuthor.status, notAuthor.json.error], [403, 'only the person who posted it can change who sees it']);
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/${answer.id}`, { cookie: owner, body: { visibility: 'private' } })).status, 403);
  const guestFlip = await call('PATCH', `/api/spaces/${S}/chat/${answer.id}${asGuest}`, { body: { visibility: 'private' } });
  assert.ok(guestFlip.status === 403, `a guest never may: ${guestFlip.text}`);
  const hidden = await call('PATCH', `/api/spaces/${S}/chat/${asked.json.questionId}`, { cookie: sam, body: { visibility: 'public' } });
  assert.deepEqual([hidden.status, hidden.json.error], [404, 'no such message'], "someone else's private message is not revealed");
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/${asked.json.questionId}`, { cookie: owner, body: { visibility: 'public' } })).status, 404);
  for (const bad of [undefined, 'shared', true, 'Public']) {
    const r = await call('PATCH', `/api/spaces/${S}/chat/${answer.id}`, { cookie: pat, body: { visibility: bad } });
    assert.deepEqual([r.status, r.json.error], [400, 'visibility is public or private'], String(bad));
  }
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/abcdefabcdef`, { cookie: pat, body: { visibility: 'public' } })).status, 404);
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/nope`, { cookie: pat, body: { visibility: 'public' } })).status, 404);
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/${answer.id}`, { body: { visibility: 'public' } })).status, 401);
  const back = await call('PATCH', `/api/spaces/${S}/chat/${answer.id}`, { cookie: pat, body: { visibility: 'private' } });
  assert.deepEqual(back.json.message, answer);
  assert.ok(!(await chatOf(sam)).some((m) => m.id === answer.id || m.question), 'made private again: gone for others, with its quote');
  // An ordinary message made private disappears for everyone else.
  const plain = (await chatOf(pat)).find((m) => m.text === 'plain');
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/${plain.id}`, { cookie: pat, body: { visibility: 'private' } })).status, 200);
  assert.ok(!(await chatOf(sam)).some((m) => m.id === plain.id));
  assert.equal((await chatOf(pat)).find((m) => m.id === plain.id).visibility, 'private');
  await nobodyElseSees('after flipping');
  n += 1;

  // Over the chat post limit: 30 writes in ten seconds.
  let limited = null;
  for (let i = 0; i < 35 && !limited; i += 1) {
    const r = await call('PATCH', `/api/spaces/${S}/chat/${plain.id}`, { cookie: pat, body: { visibility: i % 2 ? 'private' : 'public' } });
    if (r.status === 429) limited = r;
    else assert.equal(r.status, 200, r.text);
  }
  assert.ok(limited, 'the PATCH is limited');
  assert.equal(limited.json.error, 'too many messages, slow down');
  n += 1;

  // The author deletes their own private message; the route limits for text hold through the server.
  const samLong = await call('POST', `/api/spaces/${S}/chat`, { cookie: sam, body: { text: 'y'.repeat(3000) } });
  assert.equal(samLong.json.message.text.length, 1000);
  const ownDelete = await call('DELETE', `/api/spaces/${S}/chat/${vote.json.message.id}`, { cookie: pat });
  assert.equal(ownDelete.status, 200, ownDelete.text);
  n += 1;

  // Delete your private messages: all of Pat's private ones, nothing of Sam's, no public message.
  const samQ = await call('POST', `/api/spaces/${S}/ai`, { cookie: sam, body: { question: 'Sam asks' } });
  assert.equal(samQ.status, 200, samQ.text);
  const samBefore = await chatOf(sam);
  const publicBeforeWipe = (await chatOf(pat)).filter((m) => m.visibility !== 'private').map((m) => m.id);
  const patPrivate = (await privateIds()).length;
  assert.ok(patPrivate >= 4);
  const guestWipe = await call('DELETE', `/api/spaces/${S}/chat/private${asGuest}`);
  assert.equal(guestWipe.status, 403, guestWipe.text);
  assert.ok(guestWipe.json.error);
  const wipe = await call('DELETE', `/api/spaces/${S}/chat/private`, { cookie: pat });
  assert.equal(wipe.status, 200, wipe.text);
  assert.deepEqual(wipe.json, { ok: true, deleted: patPrivate });
  assert.deepEqual(await privateIds(), []);
  assert.deepEqual((await chatOf(pat)).map((m) => m.id), publicBeforeWipe, 'every public message stays, Pat\'s own too');
  assert.deepEqual(await chatOf(sam), samBefore, "Sam's messages, private and public, stay");
  assert.equal((await call('DELETE', `/api/spaces/${S}/chat/private`, { cookie: pat })).json.deleted, 0);
  n += 1;

  // --- Clear… by type, through the route (plan-chat-clear.md) ---
  // A space of its own: Mia a member, Mod its moderator, Max a moderator of another space only, Oli an owner, and the
  // admin. Each of them has, in Clearing: a public and a private chat message, a private /ai question and answer plus
  // a public answer, and a private and a public poll echo.
  const newUser = async (login, role) => (await call('POST', '/api/users', { cookie: owner, body: { login, displayName: login[0].toUpperCase() + login.slice(1), role, password: 'memberpass1234' } })).json.user;
  const mia = await newUser('mia', 'member');
  const mod = await newUser('mod', 'member');
  const max = await newUser('max', 'member');
  const oli = await newUser('oli', 'owner');
  assert.ok(mia && mod && max && oli, 'four more accounts');
  const C = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Clearing', members: [mia.key, mod.key, max.key] } })).json.space.id;
  const D = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Elsewhere', members: [max.key] } })).json.space.id;
  assert.equal((await call('PATCH', `/api/users/${mod.key}/spaces/${C}`, { cookie: owner, body: { permissions: { moderator: true } } })).status, 200);
  assert.equal((await call('PATCH', `/api/users/${max.key}/spaces/${D}`, { cookie: owner, body: { permissions: { moderator: true } } })).status, 200);
  const cookies = { admin: owner, mia: await login('mia', 'memberpass1234'), mod: await login('mod', 'memberpass1234'), max: await login('max', 'memberpass1234'), oli: await login('oli', 'memberpass1234') };
  const keys = { admin: null, mia: mia.key, mod: mod.key, max: max.key, oli: oli.key };
  await listenLive(`/api/live?space=${C}`, owner);
  const listC = async (cookie) => {
    const r = await call('GET', `/api/spaces/${C}/chat`, { cookie });
    assert.equal(r.status, 200, r.text);
    return r.json;
  };
  keys.admin = (await call('POST', `/api/spaces/${C}/chat`, { cookie: owner, body: { text: 'who am I' } })).json.message.by;
  const seedC = async () => {
    for (const [name, cookie] of Object.entries(cookies)) {
      assert.equal((await call('POST', `/api/spaces/${C}/chat`, { cookie, body: { text: `${name} chat` } })).status, 200);
      const hid = await call('POST', `/api/spaces/${C}/chat`, { cookie, body: { text: `${name} chat private` } });
      assert.equal((await call('PATCH', `/api/spaces/${C}/chat/${hid.json.message.id}`, { cookie, body: { visibility: 'private' } })).status, 200);
      const ai1 = await call('POST', `/api/spaces/${C}/ai`, { cookie, body: { question: `${name} asks` } });
      assert.equal(ai1.status, 200, ai1.text);
      const ai2 = await call('POST', `/api/spaces/${C}/ai`, { cookie, body: { question: `${name} asks aloud` } });
      assert.equal((await call('PATCH', `/api/spaces/${C}/chat/${ai2.json.id}`, { cookie, body: { visibility: 'public' } })).status, 200);
      assert.equal((await call('POST', `/api/spaces/${C}/command`, { cookie, body: { name: 'p', text: `${name} vote` } })).status, 200);
      const v2 = await call('POST', `/api/spaces/${C}/command`, { cookie, body: { name: 'p', text: `${name} vote aloud` } });
      assert.equal((await call('PATCH', `/api/spaces/${C}/chat/${v2.json.message.id}`, { cookie, body: { visibility: 'public' } })).status, 200);
    }
  };
  await seedC();
  // Every message in Clearing, as the server holds it: each person's view, merged.
  const everything = async () => {
    const all = new Map();
    for (const cookie of Object.values(cookies)) for (const m of (await listC(cookie)).messages) all.set(m.id, m);
    return [...all.values()];
  };
  const privateOf = (all, who) => all.filter((m) => m.visibility === 'private' && m.by === keys[who]).map((m) => m.id);
  const clear = (q, cookie) => call('DELETE', `/api/spaces/${C}/chat/messages${q}`, { cookie });
  const clearSome = async (count) => {
    const until = Date.now() + 3000;
    while (sent.filter((s) => s.payload?.type === 'chat-clear-some').length < count && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    return sent.filter((s) => s.payload?.type === 'chat-clear-some');
  };
  const seeded = await everything();
  const clearedBefore = (await listC(owner)).clearedAt;

  // A lost or bad query never wipes anything; refusals are plain sentences.
  for (const [q, error] of [
    ['', 'type is chat, ai, module or all'], ['?scope=everyone', 'type is chat, ai, module or all'], ['?type=', 'type is chat, ai, module or all'],
    ['?type=All&scope=everyone', 'type is chat, ai, module or all'], ['?type=toString&scope=everyone', 'type is chat, ai, module or all'],
    ['?type=all&type=ai&scope=everyone', 'type is chat, ai, module or all'], ['?type=all', 'scope is mine or everyone'],
    ['?type=all&scope=all', 'scope is mine or everyone'], ['?type=ai&scope=everyone&scope=mine', 'scope is mine or everyone'],
    ['?type=module&scope=everyone', 'which module'], ['?type=module&module=%20&scope=mine', 'which module'],
  ]) {
    const r = await clear(q, owner);
    assert.deepEqual([r.status, r.json?.error], [400, error], `400 for "${q}"`);
  }
  const noSpace = await call('DELETE', '/api/spaces/nosuchspace/chat/messages?type=all&scope=mine', { cookie: owner });
  assert.deepEqual([noSpace.status, noSpace.json.error], [404, 'no such space']);
  assert.equal((await call('DELETE', `/api/spaces/${C}/chat/messages?type=all&scope=mine`)).status, 401, 'signed out');
  // The access key (?s=) opens a module's keyed page, never the chat: every chat route answers it as signed out, not 500.
  const keyQ = `?s=${encodeURIComponent((await call('GET', '/api/settings', { cookie: owner })).json.streamKey)}`;
  for (const [method, route] of [
    ['GET', 'chat'], ['POST', 'chat'], ['DELETE', 'chat'], ['DELETE', 'chat/private'], ['DELETE', 'chat/messages'],
    ['DELETE', 'chat/abcdefabcdef'], ['PATCH', 'chat/abcdefabcdef'], ['POST', 'command'], ['GET', 'actions'], ['POST', 'action'],
  ]) {
    const r = await call(method, `/api/spaces/${C}/${route}${keyQ}${route === 'chat/messages' ? '&type=all&scope=mine' : ''}`, method === 'GET' || method === 'DELETE' ? {} : { body: {} });
    assert.equal(r.status, 401, `a keyed viewer, ${method} ${route}: ${r.status} ${r.text}`);
  }
  const outsider = await call('DELETE', `/api/spaces/${C}/chat/messages?type=all&scope=mine`, { cookie: pat });
  assert.deepEqual([outsider.status, outsider.json.error], [403, 'you are not in that space']);
  const guestC = `?guest=${encodeURIComponent((await call('POST', `/api/spaces/${C}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken)}`;
  for (const scope of ['mine', 'everyone']) {
    const r = await call('DELETE', `/api/spaces/${C}/chat/messages${guestC}&type=all&scope=${scope}`);
    assert.deepEqual([r.status, r.json.error], [403, "guests can't clear messages"], `a guest, ${scope}`);
  }
  for (const who of ['mia', 'max']) {
    const r = await clear('?type=all&scope=everyone', cookies[who]);
    assert.deepEqual([r.status, r.json.error], [403, "Only an owner or a moderator can clear everyone's messages"], `${who}: everyone`);
  }
  assert.deepEqual((await everything()).map((m) => m.id).sort(), seeded.map((m) => m.id).sort(), 'every refusal left every message');
  assert.equal((await clearSome(0)).length, 0, 'and told nothing');
  n += 1;

  // A member clears their own AI messages: questions and answers, public and private; nobody else's.
  const miaAi = seeded.filter((m) => m.by === mia.key && (m.kind === 'ai' || m.command === 'ai'));
  assert.equal(miaAi.length, 4);
  const miaClear = await clear('?type=ai&scope=mine', cookies.mia);
  assert.deepEqual([miaClear.status, miaClear.json], [200, { ok: true, deleted: 4 }]);
  let now = await everything();
  assert.deepEqual(now.map((m) => m.id).sort(), seeded.filter((m) => !miaAi.includes(m)).map((m) => m.id).sort());
  let told = await clearSome(1);
  assert.deepEqual(told[0].payload, {
    type: 'chat-clear-some', space: C, ids: miaAi.filter((m) => m.visibility !== 'private').map((m) => m.id), by: mia.key, who: 'Mia', scope: 'mine', clearType: 'ai',
  }, 'only the public ids are told on the live stream');
  assert.equal(told[0].payload.space, C);
  // A member's own polls messages, by module id.
  const miaPolls = await clear('?type=module&module=polls&scope=mine', cookies.mia);
  assert.deepEqual(miaPolls.json, { ok: true, deleted: 2 });
  told = await clearSome(2);
  assert.deepEqual([told[1].payload.clearType, told[1].payload.module, told[1].payload.ids.length], ['module', 'polls', 1]);
  // Nothing left of that type: 0, and nothing told. A module that matches nothing is not an error.
  assert.deepEqual((await clear('?type=ai&scope=mine', cookies.mia)).json, { ok: true, deleted: 0 });
  assert.deepEqual((await clear('?type=module&module=nosuch&scope=everyone', cookies.mod)).json, { ok: true, deleted: 0 });
  assert.equal((await clearSome(3)).length, 2, 'a clear of nothing tells nothing');
  n += 1;

  // Everyone's, for a moderator, an owner and the admin: every public message of the type and their own private ones,
  // never another person's private message. A moderator of another space may not.
  const everyoneClear = async (who, q, label) => {
    const before = await everything();
    const r = await clear(q, cookies[who]);
    assert.equal(r.status, 200, `${label}: ${r.text}`);
    const after = await everything();
    for (const other of Object.keys(cookies).filter((k) => k !== who)) {
      assert.deepEqual(privateOf(after, other), privateOf(before, other), `${label}: ${other}'s private messages all stay`);
    }
    assert.equal(r.json.deleted, before.length - after.length, `${label}: deleted is the count`);
    return { before, after, r };
  };
  // Mod: every public poll echo, Mod's own private one.
  let step = await everyoneClear('mod', '?type=module&module=polls&scope=everyone', 'moderator, polls');
  assert.ok(!step.after.some((m) => m.module === 'polls' && (m.visibility !== 'private' || m.by === mod.key)));
  assert.equal(step.r.json.deleted, 4 + 1, "four public echoes left (Mia's went) and Mod's own private one");
  told = await clearSome(3);
  assert.deepEqual([told[2].payload.scope, told[2].payload.by, told[2].payload.who, told[2].payload.ids.length], ['everyone', mod.key, 'Mod', 4]);
  // Oli, an owner: chat messages.
  step = await everyoneClear('oli', '?type=chat&scope=everyone', 'owner, chat');
  assert.ok(!step.after.some((m) => !m.kind && (m.visibility !== 'private' || m.by === oli.key)));
  assert.ok(step.after.some((m) => m.kind === 'ai'), 'chat leaves the AI messages');
  assert.ok(step.after.some((m) => m.kind === 'command' && m.command === 'p'), 'and the commands');
  // The admin: everything.
  step = await everyoneClear('admin', '?type=all&scope=everyone', 'admin, all');
  assert.ok(step.after.every((m) => m.visibility === 'private' && m.by !== keys.admin), 'only other people\'s private messages are left');
  assert.ok(step.after.length > 0);
  // A moderator of another space is refused in this one, and a member stays refused.
  assert.equal((await clear('?type=chat&scope=everyone', cookies.max)).status, 403);
  // Each one's `mine` still works on what is left of theirs: Max, a member here.
  const maxLeft = step.after.filter((m) => m.by === max.key).length;
  assert.ok(maxLeft > 0);
  assert.deepEqual((await clear('?type=all&scope=mine', cookies.max)).json, { ok: true, deleted: maxLeft });
  assert.equal((await listC(owner)).clearedAt, clearedBefore, '`cleared` is unchanged');
  n += 1;

  // Single message deletes and the old routes still answer at the same paths: /chat/messages is never a message id.
  const miaLeft = (await everything()).filter((m) => m.by === mia.key);
  assert.ok(miaLeft.length > 0 && miaLeft.every((m) => m.visibility === 'private'), "Mia's private chat message outlived everyone's clears");
  assert.deepEqual((await call('DELETE', `/api/spaces/${C}/chat/private`, { cookie: cookies.mia })).json, { ok: true, deleted: miaLeft.length });
  // After a restart, what was cleared is gone from both files; an aside has no chat.
  const leftBefore = (await everything()).map((m) => m.id).sort();
  await stopServer();
  const app = readJson(path.join(dataDir, 'app.json'));
  app.asides = [...(app.asides || []), { id: 'asideclear1', members: [mia.key, mod.key], origin: C, private: false, createdAt: new Date().toISOString() }];
  fs.writeFileSync(path.join(dataDir, 'app.json'), JSON.stringify(app));
  const fileIds = onDisk(dataDir, 'after clearing').merged[C] || [];
  for (const m of seeded) {
    if (!leftBefore.includes(m.id)) assert.ok(!fileIds.some((x) => x.id === m.id), `cleared ${m.text} is gone from both files`);
  }
  await startServer();
  for (const who of Object.keys(cookies)) cookies[who] = await login(who === 'admin' ? 'admin' : who, who === 'admin' ? 'testpass1234' : 'memberpass1234');
  assert.deepEqual((await everything()).map((m) => m.id).sort(), leftBefore, 'read back the same after a restart');
  const asideClear = await call('DELETE', '/api/spaces/asideclear1/chat/messages?type=all&scope=mine', { cookie: cookies.mod });
  assert.deepEqual([asideClear.status, asideClear.json.error], [404, 'no such space'], 'an aside has no chat');
  // Delete the chat still empties everything, private messages included, and marks `cleared`.
  await seedC();
  assert.ok((await everything()).some((m) => m.visibility === 'private'));
  assert.equal((await call('DELETE', `/api/spaces/${C}/chat`, { cookie: cookies.mod })).status, 200);
  assert.deepEqual(await everything(), []);
  assert.ok((await listC(cookies.mia)).clearedAt > 0);
  n += 1;

  // /ai no longer depends on the retired Assistant's Use (decision 12); a space's AI off still refuses.
  assert.equal((await call('POST', '/api/modules/bundled/assistant/install', { cookie: owner, body: {} })).status, 201);
  assert.equal((await call('PATCH', '/api/modules/assistant', { cookie: owner, body: { enabled: true, allSpaces: true } })).status, 200);
  assert.equal((await call('PATCH', '/api/roles/member', { cookie: owner, body: { 'module.assistant.use': false } })).status, 200);
  const stillAi = await call('POST', `/api/spaces/${S}/ai`, { cookie: pat, body: { question: 'Still allowed?' } });
  assert.equal(stillAi.status, 200, stillAi.text);
  assert.equal((await call('GET', `/api/spaces/${S}/ai`, { cookie: pat })).json.available, true);
  await call('PATCH', `/api/spaces/${S}`, { cookie: owner, body: { aiOff: true } });
  const off = await call('POST', `/api/spaces/${S}/ai`, { cookie: pat, body: { question: 'Off?' } });
  assert.deepEqual([off.status, off.json.error], [403, 'AI is turned off in this space']);
  await call('PATCH', `/api/spaces/${S}`, { cookie: owner, body: { aiOff: false } });
  n += 1;

  // The manifest's color: refused at install, delivered by for-space.
  const zipOf = (manifest) => zipFiles([['module.json', Buffer.from(JSON.stringify(manifest))], ['canvas.html', Buffer.from('<!doctype html><p>hi</p>')]]);
  const tinted = (color) => ({ id: 'tinted', name: 'Tinted', version: '1.0.0', scope: ['space'], surfaces: { canvas: { entry: 'canvas.html' } }, ...(color === undefined ? {} : { color }) });
  const refusedTint = await call('POST', '/api/modules', { cookie: owner, raw: zipOf(tinted('mauve')), type: 'application/zip' });
  assert.deepEqual([refusedTint.status, refusedTint.json.error], [400, tintRefusal]);
  assert.ok(!(await call('GET', '/api/modules', { cookie: owner })).json.modules.some((m) => m.id === 'tinted'), 'nothing installed');
  const okTint = await call('POST', '/api/modules', { cookie: owner, raw: zipOf(tinted('teal')), type: 'application/zip' });
  assert.equal(okTint.status, 201, okTint.text);
  assert.equal((await call('PATCH', '/api/modules/tinted', { cookie: owner, body: { enabled: true, allSpaces: true } })).status, 200);
  const listed = await call('GET', `/api/modules/for-space?space=${S}`, { cookie: pat });
  assert.equal(listed.status, 200, listed.text);
  assert.equal(listed.json.modules.find((m) => m.id === 'tinted').color, 'teal');
  assert.ok('color' in listed.json.modules.find((m) => m.id === 'polls'));
  for (const m of listed.json.modules) assert.ok(m.color === null || TINTS.includes(m.color), `${m.id}: ${m.color}`);
  // Each entry carries the manifest's budget mark as a boolean, always present (Set up shows the Budget field to a moderator by it).
  for (const m of listed.json.modules) assert.equal(typeof m.budget, 'boolean', `${m.id}: budget is a boolean`);
  assert.equal(listed.json.modules.find((m) => m.id === 'tinted').budget, false, 'no mark, false');
  const budgeted = await call('POST', '/api/modules', { cookie: owner, raw: zipOf({ ...tinted('teal'), id: 'budgeted', name: 'Budgeted', budget: true }), type: 'application/zip' });
  assert.equal(budgeted.status, 201, budgeted.text);
  assert.equal((await call('PATCH', '/api/modules/budgeted', { cookie: owner, body: { enabled: true, allSpaces: true } })).status, 200);
  const withBudget = (await call('GET', `/api/modules/for-space?space=${S}`, { cookie: pat })).json.modules;
  assert.equal(withBudget.find((m) => m.id === 'budgeted').budget, true, 'budget: true in the manifest');
  assert.equal(withBudget.find((m) => m.id === 'tinted').budget, false);
  // A module that only takes commands is a canvas module with menu: false (a space module needs a canvas), so it is in
  // `modules` with its colour: Chat finds every command's colour there.
  const commandOnly = {
    id: 'pinkcmd', name: 'Pink', version: '1.0.0', scope: ['space'], color: 'pink',
    surfaces: { canvas: { entry: 'canvas.html', menu: false } },
    actions: { provides: [{ name: 'addNote', label: 'Add a note', local: true, input: { text: 'string' } }] },
    commands: [{ name: 'pk', label: 'Add a note', action: 'addNote' }],
  };
  const cmdInstall = await call('POST', '/api/modules', { cookie: owner, raw: zipOf(commandOnly), type: 'application/zip' });
  assert.equal(cmdInstall.status, 201, cmdInstall.text);
  assert.equal((await call('PATCH', '/api/modules/pinkcmd', { cookie: owner, body: { enabled: true, allSpaces: true } })).status, 200);
  const withCmd = await call('GET', `/api/modules/for-space?space=${S}`, { cookie: pat });
  const pink = withCmd.json.modules.find((m) => m.id === 'pinkcmd');
  assert.ok(pink, 'a command-only module is listed');
  assert.deepEqual([pink.color, pink.canvas.menu, pink.commands.map((c) => c.name)], ['pink', false, ['pk']]);
  const pk = await call('POST', `/api/spaces/${S}/command`, { cookie: pat, body: { name: 'pk', text: 'a pink note' } });
  assert.equal(pk.status, 200, pk.text);
  assert.equal(pk.json.message.module, 'pinkcmd', "its echo names the module whose colour it takes");
  // Every module a command can reach is in for-space's list: the command route's modules are a subset.
  const doneCmds = withCmd.json.modules.filter((m) => m.commands.length).map((m) => m.id);
  assert.ok(doneCmds.includes('pinkcmd') && doneCmds.includes('polls'));
  // Still teal after a restart (read from the stored manifest).
  await stopServer();
  await startServer();
  const relisted = await call('GET', `/api/modules/for-space?space=${S}`, { cookie: await login('pat', 'memberpass1234') });
  assert.equal(relisted.json.modules.find((m) => m.id === 'tinted').color, 'teal');
  n += 1;

  // Through the server: /ai, commands, posts and flips above; one more private answer and a flip each way now.
  const pat2 = await login('pat', 'memberpass1234');
  const last = await call('POST', `/api/spaces/${S}/ai`, { cookie: pat2, body: { question: 'Last one?' } });
  assert.equal(last.status, 200, last.text);
  await call('POST', `/api/spaces/${S}/command`, { cookie: pat2, body: { name: 'p', text: 'a last vote' } });
  const lastPublic = await call('PATCH', `/api/spaces/${S}/chat/${last.json.id}`, { cookie: pat2, body: { visibility: 'public' } });
  assert.equal(lastPublic.status, 200, lastPublic.text);
  onDisk(dataDir, 'the server, after a flip');
  const shownNow = await chatOf(pat2);
  await stopServer(); // writes what is still owed
  const { merged } = onDisk(dataDir, 'the server, stopped');
  const seenByPrevious = previousSees(dataDir, S, 'the server, stopped');
  assert.ok(seenByPrevious.some((m) => m.id === last.json.id), 'the answer made public is what the previous release shows');
  assert.ok(!seenByPrevious.some((m) => m.id === last.json.questionId || m.text === 'a last vote'), 'and never its question or a command echo');
  assert.deepEqual(new ChatHistory(dataDir).list(S, ids.pat).map((m) => m.id), shownNow.map((m) => m.id), 'the two files read back as the server served them');
  assert.ok(merged[S].some((m) => m.text === 'a last vote' && m.visibility === 'private'));
  n += 1;
} finally {
  await stopServer();
  aiServer.close();
  liveCtl?.abort();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`check-chat-model: OK (${n} checks)`);
