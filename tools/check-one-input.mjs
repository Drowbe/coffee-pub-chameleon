#!/usr/bin/env node
/*
 * check-one-input.mjs -- Chat /ai threads, command validation, and space-level object check
 * (plan-one-input.md, #58). Manifest refusals run in-process; HTTP cases use a throwaway server.
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
const { cleanManifest, ModuleError } = createRequire(import.meta.url)('../server/modules.js');
const { ChatHistory } = createRequire(import.meta.url)('../server/chat-history.js');

let n = 0;
const files = new Set(['page.html', 'canvas.html']);
const both = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } };
const local = [{ name: 'addNote', label: 'Add a note', local: true, input: { text: 'string' } }];
const manifest = (extra) => cleanManifest({
  id: 'thing', name: 'Thing', version: '1.0.0', scope: ['environment', 'space'], surfaces: both,
  actions: { provides: local }, ...extra,
}, files);

assert.deepEqual(manifest({ commands: [{ name: 'r', label: 'Add a note', action: 'addNote' }] }).commands[0].action, 'addNote');
n += 1;
for (const [commands, re] of [
  [[{ name: 'R', action: 'addNote' }], /1 to 12 lowercase letters or digits/],
  [[{ name: 'ai', action: 'addNote' }], /reserved/],
  [[{ name: 'r', action: '' }], /not in actions.provides/],
  [[{ name: 'r', action: 'saveNote' }], /must be local/],
]) {
  assert.throws(() => manifest({
    actions: { provides: commands[0].action === 'saveNote' ? [{ name: 'saveNote', input: { title: 'string' } }] : local },
    commands,
  }), (err) => err instanceof ModuleError && re.test(err.message));
  n += 1;
}

// The private /ai thread is now private messages in the one chat store: its windows, the move from ai-threads.json
// and who reads what are checked in tools/check-chat-model.mjs.

const tmpChat = fs.mkdtempSync(path.join(os.tmpdir(), 'check-chat-history-'));
const hist = new ChatHistory(tmpChat);
const pats = hist.add('s', { by: 'pat', who: 'Pat', text: 'one' });
const sams = hist.add('s', { by: 'sam', who: 'Sam', text: 'two' });
assert.equal(hist.remove('s', pats.id, 'sam'), false);
assert.equal(hist.remove('s', pats.id, 'pat').text, 'one');
assert.equal(hist.list('s').map((m) => m.id).join(','), sams.id);
hist.clear('s');
hist.flush();
const reread = new ChatHistory(tmpChat);
assert.equal(reread.list('s').length, 0);
assert.ok(reread.clearedAt('s') > 0);
assert.equal(reread.remove('s', sams.id, 'sam'), null);
n += 1;
fs.rmSync(tmpChat, { recursive: true, force: true });

const seen = [];
const aiServer = http.createServer((req, res) => {
  seen.push(req.url);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: 'A short answer.' } }], usage: { total_tokens: 12 } }));
});
await new Promise((r) => aiServer.listen(0, '127.0.0.1', r));
const aiAddress = `http://127.0.0.1:${aiServer.address().port}`;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-one-input-'));
fs.writeFileSync(path.join(dataDir, 'ai.json'), JSON.stringify({
  source: 'custom', provider: 'compatible', address: aiAddress, model: 'stand-in-model', key: 'sk-test', enabled: true,
}));

let child = null;
let port = 0;
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir,
      ADMIN_PASSWORD: 'testpass1234',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
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
try {
  const login = async (name, password) => {
    const r = await call('POST', '/api/login', { body: { login: name, password } });
    assert.equal(r.status, 200, `${name} signs in: ${r.text}`);
    return r.json.token;
  };
  const owner = await login('admin', 'testpass1234');
  const member = (await call('POST', '/api/users', { cookie: owner, body: { login: 'pat', displayName: 'Pat', role: 'member', password: 'memberpass1234' } })).json.user;
  const other = (await call('POST', '/api/users', { cookie: owner, body: { login: 'sam', displayName: 'Sam', role: 'member', password: 'memberpass1234' } })).json.user;
  const space = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Trip', members: [member.key, other.key] } })).json.space;
  const pat = await login('pat', 'memberpass1234');
  const sam = await login('sam', 'memberpass1234');
  assert.equal((await call('PATCH', '/api/roles/member', { cookie: owner, body: { useAi: true } })).status, 200); // using AI needs the role's Use AI

  const chat = await call('GET', `/api/spaces/${space.id}/chat`, { cookie: pat });
  assert.equal(chat.status, 200, chat.text);
  assert.ok(Array.isArray(chat.json.messages));
  const sent = await call('POST', `/api/spaces/${space.id}/chat`, { cookie: pat, body: { text: 'hello from pat' } });
  assert.equal(sent.status, 200, sent.text);
  const mine = sent.json.message && sent.json.message.id;
  assert.match(mine, /^[a-f0-9]{12}$/);
  const notYours = await call('DELETE', `/api/spaces/${space.id}/chat/${mine}`, { cookie: sam });
  assert.equal(notYours.status, 403, notYours.text);
  const memberClear = await call('DELETE', `/api/spaces/${space.id}/chat`, { cookie: pat });
  assert.equal(memberClear.status, 403, memberClear.text);
  const removed = await call('DELETE', `/api/spaces/${space.id}/chat/${mine}`, { cookie: pat });
  assert.equal(removed.status, 200, removed.text);
  const afterOne = await call('GET', `/api/spaces/${space.id}/chat`, { cookie: sam });
  assert.equal(afterOne.json.messages.length, 0, afterOne.text);
  const again = await call('POST', `/api/spaces/${space.id}/chat`, { cookie: sam, body: { text: 'from sam' } });
  assert.equal(again.status, 200, again.text);
  const ownerCut = await call('DELETE', `/api/spaces/${space.id}/chat/${again.json.message.id}`, { cookie: owner });
  assert.equal(ownerCut.status, 200, ownerCut.text);
  const wiped = await call('DELETE', `/api/spaces/${space.id}/chat`, { cookie: owner });
  assert.equal(wiped.status, 200, wiped.text);
  const emptyChat = await call('GET', `/api/spaces/${space.id}/chat`, { cookie: pat });
  assert.equal(emptyChat.json.messages.length, 0, emptyChat.text);
  assert.ok(emptyChat.json.clearedAt > 0, emptyChat.text);
  const missing = await call('DELETE', `/api/spaces/${space.id}/chat/abcdefabcdef`, { cookie: pat });
  assert.equal(missing.status, 404, missing.text);
  await call('PATCH', `/api/users/${member.key}/spaces/${space.id}`, { cookie: owner, body: { permissions: { moderator: true } } });
  await call('POST', `/api/spaces/${space.id}/chat`, { cookie: sam, body: { text: 'still here' } });
  const modClear = await call('DELETE', `/api/spaces/${space.id}/chat`, { cookie: pat });
  assert.equal(modClear.status, 200, modClear.text);
  const gone = await call('GET', `/api/spaces/${space.id}/chat`, { cookie: sam });
  assert.equal(gone.json.messages.length, 0, gone.text);
  await call('PATCH', `/api/users/${member.key}/spaces/${space.id}`, { cookie: owner, body: { permissions: { moderator: false } } });
  n += 1;

  const asked = await call('POST', `/api/spaces/${space.id}/ai`, { cookie: pat, body: { question: 'What is Faro?' } });
  assert.equal(asked.status, 200, asked.text);
  assert.match(asked.json.text, /short answer/i);
  // The question and the answer are Pat's private chat messages: Pat sees both, nobody else sees either, and the old
  // thread routes are gone.
  const privateOf = async (cookie) => (await call('GET', `/api/spaces/${space.id}/chat`, { cookie })).json.messages.filter((m) => m.visibility === 'private');
  const thread = await privateOf(pat);
  assert.deepEqual(thread.map((m) => m.kind), ['command', 'ai']);
  assert.match(thread[0].id, /^[a-f0-9]{12}$/);
  assert.equal((await privateOf(sam)).length, 0);
  assert.equal((await call('GET', `/api/spaces/${space.id}/ai/thread`, { cookie: pat })).status, 404, 'the old thread route is gone');
  const samCut = await call('DELETE', `/api/spaces/${space.id}/chat/${thread[1].id}`, { cookie: sam });
  assert.equal(samCut.status, 404, samCut.text);
  const oneGone = await call('DELETE', `/api/spaces/${space.id}/chat/${thread[0].id}`, { cookie: pat });
  assert.equal(oneGone.status, 200, oneGone.text);
  assert.equal((await privateOf(pat)).length, 1);
  n += 1;

  const unsigned = await call('POST', `/api/spaces/${space.id}/ai`, { body: { question: 'hello there' } });
  assert.equal(unsigned.status, 401, unsigned.text);
  n += 1;

  const aside = await call('POST', '/api/spaces/not-a-space/ai', { cookie: pat, body: { question: 'hello there' } });
  assert.equal(aside.status, 404, aside.text);
  n += 1;

  await call('PATCH', `/api/spaces/${space.id}`, { cookie: owner, body: { aiOff: true } });
  const off = await call('POST', `/api/spaces/${space.id}/ai`, { cookie: pat, body: { question: 'hello there' } });
  assert.equal(off.status, 403, off.text);
  await call('PATCH', `/api/spaces/${space.id}`, { cookie: owner, body: { aiOff: false } });
  n += 1;

  const fence = '```objects\n{"title":"Faro","content":"A city in Portugal."}\n```';
  const check = await call('POST', `/api/spaces/${space.id}/objects/check`, { cookie: pat, raw: fence, type: 'text/plain' });
  assert.equal(check.status, 200, check.text);
  assert.equal(check.json.objects.length, 1);
  assert.equal(check.json.objects[0].title, 'Faro');
  n += 1;

  // The chat's paste detection asks this route: an answer with a block fenced with a past label (and one mixing it with
  // an objects block) is refused whole, so no "Bring in" is offered (plan-kind-names.md, decision 11); an answer whose
  // fences were lost is still read.
  const oldAnswer = 'that answer is in an older format: copy the instructions again and ask the AI for a new answer';
  const OLD_DIR = new URL('./fixtures/format-old/', import.meta.url);
  for (const name of fs.readdirSync(OLD_DIR).filter((f) => f.startsWith('answer-'))) {
    const refusedPaste = await call('POST', `/api/spaces/${space.id}/objects/check`, { cookie: pat, raw: fs.readFileSync(new URL(name, OLD_DIR), 'utf8'), type: 'text/plain' });
    assert.deepEqual([refusedPaste.status, refusedPaste.json], [400, { error: oldAnswer }], name);
  }
  const lost = await call('POST', `/api/spaces/${space.id}/objects/check`, { cookie: pat, raw: fs.readFileSync(new URL('./fixtures/object-format/no-fences.txt', import.meta.url), 'utf8'), type: 'text/plain' });
  assert.deepEqual([lost.status, lost.json.objects.map((o) => o.title)], [200, ['Casa do Largo', 'Bar do Peixe']], lost.text);
  n += 1;

  assert.equal((await call('POST', '/api/modules/bundled/assistant/install', { cookie: owner, body: {} })).status, 201);
  assert.equal((await call('PATCH', '/api/modules/assistant', { cookie: owner, body: { enabled: true, allSpaces: true } })).status, 200);
  // The retired Assistant's Use no longer gates /ai or bringing objects in (plan-chat-model.md, decision 12).
  const denied = await call('PATCH', '/api/roles/member', { cookie: owner, body: { 'module.assistant.use': false } });
  assert.equal(denied.status, 200, denied.text);
  const noUse = await call('GET', `/api/spaces/${space.id}/objects/check`, { cookie: pat });
  assert.equal(noUse.status, 200, noUse.text);
  assert.equal(noUse.json.available, true);
  const stillImport = await call('POST', `/api/spaces/${space.id}/objects/check`, { cookie: pat, raw: fence, type: 'text/plain' });
  assert.equal(stillImport.status, 200, stillImport.text);
  const stillAi = await call('POST', `/api/spaces/${space.id}/ai`, { cookie: pat, body: { question: 'hello there' } });
  assert.equal(stillAi.status, 200, stillAi.text);
  await call('PATCH', '/api/roles/member', { cookie: owner, body: { 'module.assistant.use': true } });
  n += 1;

  const unknown = await call('POST', `/api/spaces/${space.id}/command`, { cookie: pat, body: { name: 'zzzz', text: 'hi' } });
  assert.equal(unknown.status, 404, unknown.text);
  assert.match(unknown.json.error || '', /No command \/zzzz/);
  n += 1;

  assert.equal((await call('POST', '/api/modules/bundled/polls/install', { cookie: owner, body: {} })).status, 201);
  assert.equal((await call('PATCH', '/api/modules/polls', { cookie: owner, body: { enabled: true, allSpaces: true } })).status, 200);
  const listed = await call('GET', `/api/modules/for-space?space=${space.id}`, { cookie: pat });
  assert.equal(listed.status, 200, listed.text);
  const pollsMod = (listed.json.modules || []).find((m) => m.id === 'polls');
  assert.ok(pollsMod, 'polls is on the space');
  assert.ok((pollsMod.commands || []).some((c) => c.name === 'p' && c.action === 'addPoll'));
  const vote = await call('POST', `/api/spaces/${space.id}/command`, { cookie: pat, body: { name: 'p', text: 'where to stay by sep 29' } });
  assert.equal(vote.status, 200, vote.text);
  assert.equal(vote.json.module, 'polls');
  n += 1;

  // chat/ai is 6 per minute; two asks already ran above.
  for (let i = 0; i < 4; i += 1) {
    const extra = await call('POST', `/api/spaces/${space.id}/ai`, { cookie: pat, body: { question: `again ${i}` } });
    assert.equal(extra.status, 200, extra.text);
  }
  const limited = await call('POST', `/api/spaces/${space.id}/ai`, { cookie: pat, body: { question: 'one too many' } });
  assert.equal(limited.status, 429, limited.text);
  n += 1;
} finally {
  await stopServer();
  aiServer.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

const unsetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-one-input-off-'));
let child2 = null;
let port2 = 0;
child2 = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: unsetDir,
    ADMIN_PASSWORD: 'testpass1234',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out2 = '';
child2.stdout.on('data', (d) => { out2 += d; });
child2.stderr.on('data', (d) => { out2 += d; });
port2 = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child2.kill(); reject(new Error(`unset server did not start:\n${out2}`)); }, 25000);
  const onData = () => { const m = /listening on :(\d+)/.exec(out2); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
  child2.stdout.on('data', onData);
  child2.stderr.on('data', onData);
  child2.once('exit', (code) => { clearTimeout(timer); reject(new Error(`unset server stopped (${code}):\n${out2}`)); });
});
try {
  const r = await fetch(`http://127.0.0.1:${port2}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'testpass1234' }) });
  const token = (await r.json()).token;
  const spaces = await fetch(`http://127.0.0.1:${port2}/api/spaces`, { headers: { cookie: `app_session=${token}` } });
  const list = (await spaces.json()).spaces || [];
  const spaceId = list[0]?.id || (await (await fetch(`http://127.0.0.1:${port2}/api/spaces`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `app_session=${token}` }, body: JSON.stringify({ name: 'A' }) })).json()).space.id;
  const asked = await fetch(`http://127.0.0.1:${port2}/api/spaces/${spaceId}/ai`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: `app_session=${token}` }, body: JSON.stringify({ question: 'hello there' }),
  });
  assert.equal(asked.status, 503);
  n += 1;
} finally {
  await new Promise((resolve) => { child2.once('exit', resolve); child2.kill('SIGTERM'); });
  fs.rmSync(unsetDir, { recursive: true, force: true });
}

console.log(`check-one-input: OK (${n} checks)`);
