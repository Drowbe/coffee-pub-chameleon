#!/usr/bin/env node
/*
 * check-chat-links.mjs -- links in Chat (documentation/plans/plan-chat-links.md, GitHub #158), steps 1 and 3: which
 * text counts as a message's link (server/chat-links.js); `preview` and `kept` stored on a message in both chat
 * files and read past by the previous release; and, on a throwaway server, the preview, image and keep routes and
 * `may` on GET .../actions.
 *
 * The server reads pages with the real reader (server/link-preview.js), its address guard untouched. A preload
 * (tools/fixtures/chat-links-net.cjs) makes page.example.com resolve to a public test address and sends the request
 * the reader makes, once the guard has passed it, to a local stand-in page; intranet.example.com resolves to a private
 * address, which the guard must refuse before any request reaches the stand-in.
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
const { findLink, readFields, CHAT_LINK_LIMITS } = require('../server/chat-links.js');
const { ChatHistory } = require('../server/chat-history.js');
const { ChatHistory: PreviousChat } = require('./fixtures/chat-previous/chat-history.js');

let n = 0;
const ok = (name) => { n += 1; console.log(`ok ${name}`); };
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-chat-links-${name}-`));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// --- which text is a link -------------------------------------------------------------------------------------------

assert.equal(findLink('This one? https://example.com/hotel'), 'https://example.com/hotel', 'bare');
assert.equal(findLink('See [the hotel](https://example.com/hotel) now'), 'https://example.com/hotel', 'written as [text](...)');
assert.equal(findLink('http://example.com/a'), 'http://example.com/a', 'http at the start');
assert.equal(findLink('(https://example.com/a)'), 'https://example.com/a', 'in brackets');
assert.equal(findLink('Go to https://example.com/a.'), 'https://example.com/a', 'a full stop left off');
assert.equal(findLink('Go to https://example.com/a, then'), 'https://example.com/a', 'a comma left off');
assert.equal(findLink('https://example.com/first and [two](https://example.com/second)'), 'https://example.com/first', 'the first of several');
assert.equal(findLink('[two](https://example.com/second) then https://example.com/third'), 'https://example.com/second', 'the first by place');
assert.equal(findLink('a\nb https://example.com/line2'), 'https://example.com/line2', 'on a later line');
ok('a link: bare, [text](...), the first of several, trailing punctuation left off');

assert.equal(findLink('look at `https://example.com/code`'), '', 'not in `code`');
assert.equal(findLink('```\nhttps://example.com/fenced\n```'), '', 'not in a fenced block');
assert.equal(findLink('```\nhttps://example.com/fenced\n```\nhttps://example.com/after'), 'https://example.com/after', 'after a fenced block');
assert.equal(findLink('> https://example.com/quoted\nmy answer'), '', 'not in a quoted line');
assert.equal(findLink('> https://example.com/quoted\nmine https://example.com/mine'), 'https://example.com/mine', 'the answer\'s own link');
assert.equal(findLink(`https://example.com/${'a'.repeat(CHAT_LINK_LIMITS.MAX_URL)}`), '', 'over 500 characters');
const longest = `https://example.com/${'a'.repeat(CHAT_LINK_LIMITS.MAX_URL - 20)}`;
assert.equal(longest.length, 500);
assert.equal(findLink(longest), longest, '500 characters is a link');
assert.equal(findLink('https://user:secret@example.com/a'), '', 'with a password');
assert.equal(findLink('https://user@example.com/a'), '', 'with a user name');
assert.equal(findLink('https://user:secret@example.com/a then https://example.com/b'), 'https://example.com/b', 'a password link is passed over');
assert.equal(findLink('ftp://example.com/file'), '', 'ftp:');
assert.equal(findLink('javascript:alert(1)'), '', 'javascript:');
assert.equal(findLink('nohttps://example.com'), '', 'not after a letter');
assert.equal(findLink(''), '');
assert.equal(findLink(null), '');
ok('not a link: in code, a fence or a quote, too long, a user name or password, ftp:');

{
  const now = Date.now();
  const got = readFields({ title: `  A  title ${'t'.repeat(200)}`, description: 'd'.repeat(900), image: 'https://example.com/og.jpg' }, now);
  assert.equal(got.title.length, 120);
  assert.ok(got.title.startsWith('A title'), 'spaces folded');
  assert.equal(got.description.length, 500, 'cut to 500');
  assert.ok(got.description.endsWith('…'), 'with an ellipsis');
  assert.equal(got.image, 'https://example.com/og.jpg');
  assert.equal(got.at, now);
  assert.deepEqual(readFields({ title: '', description: '', image: '' }, now), { at: now }, 'empty fields left out');
  assert.equal(readFields({ image: `https://example.com/${'i'.repeat(2000)}` }, now).image, undefined, 'a picture address over 2000 is left out');
  assert.equal(readFields({ image: 'data:image/png;base64,AAAA' }, now).image, undefined, 'only http or https pictures');
  ok('what a read stores: title 120, description 500 with an ellipsis, picture address 2000');
}

// --- the store ------------------------------------------------------------------------------------------------------

{
  const dir = tmp('store');
  const hist = new ChatHistory(dir);
  const plain = hist.add('s1', { by: 'pat', who: 'Pat', text: 'no link here' });
  assert.equal('preview' in plain, false, 'no link, no preview');
  const linked = hist.add('s1', { by: 'pat', who: 'Pat', text: 'see https://example.com/a', link: 'https://example.com/a' });
  assert.deepEqual(linked.preview, { url: 'https://example.com/a' });
  const echo = hist.add('s1', { by: 'pat', who: 'Pat', text: '/v https://example.com/c', visibility: 'private', kind: 'command', command: 'v', link: 'https://example.com/c' });
  assert.equal('preview' in echo, false, 'never on a command echo');
  assert.equal('preview' in hist.add('s1', { by: 'pat', who: 'Pat', text: 'x', link: 'h'.repeat(501) }), false, 'never over 500');

  const read = hist.setPreview('s1', linked.id, 'research', { title: 'A', description: 'B', image: 'https://example.com/i.png', at: 5 });
  assert.equal(read.changed, true);
  assert.deepEqual(read.message.preview, { url: 'https://example.com/a', module: 'research', title: 'A', description: 'B', image: 'https://example.com/i.png', at: 5 });
  read.message.preview.title = 'changed by a caller';
  assert.equal(hist.find('s1', linked.id).preview.title, 'A', 'what is returned is a copy');
  assert.equal(hist.setPreview('s1', linked.id, 'research', { title: 'Again', at: 6 }).changed, false, 'read once');
  assert.equal(hist.setPreview('s1', plain.id, 'research', { at: 6 }), null, 'a message with no link');
  const kept = hist.setKept('s1', linked.id, { by: 'sam', who: 'Sam', at: 7 });
  assert.deepEqual(kept.message.kept, { by: 'sam', who: 'Sam', at: 7 });
  assert.equal(hist.setKept('s1', linked.id, { by: 'mia', who: 'Mia', at: 8 }).changed, false, 'kept once');
  assert.equal(hist.find('s1', linked.id).kept.who, 'Sam');

  // Moved with visibility, both ways, and on disk in whichever file the message lives.
  hist.setVisibility('s1', linked.id, 'pat', 'private');
  hist.flush();
  const priv = readJson(path.join(dir, 'chat-private.json')).spaces.s1.find((m) => m.id === linked.id);
  assert.equal(priv.preview.title, 'A', 'kept in chat-private.json');
  assert.equal(priv.kept.who, 'Sam');
  assert.ok(!readJson(path.join(dir, 'chat.json')).spaces.s1.some((m) => m.id === linked.id));
  hist.setVisibility('s1', linked.id, 'pat', 'public');
  hist.flush();
  const pub = readJson(path.join(dir, 'chat.json'));
  assert.deepEqual(Object.keys(pub).sort(), ['cleared', 'spaces'], 'chat.json keeps its old shape');
  const back = pub.spaces.s1.find((m) => m.id === linked.id);
  assert.deepEqual(back.preview, { url: 'https://example.com/a', module: 'research', title: 'A', description: 'B', image: 'https://example.com/i.png', at: 5 });
  assert.deepEqual(back.kept, { by: 'sam', who: 'Sam', at: 7 });

  // Read back by this release and by the previous one, which knows nothing of either field.
  assert.equal(new ChatHistory(dir).find('s1', linked.id).kept.who, 'Sam', 'read back after a restart');
  const previous = new PreviousChat(dir);
  const seen = previous.list('s1');
  assert.deepEqual(seen.map((m) => m.text), ['no link here', 'see https://example.com/a', 'x'], 'the previous release lists them');
  assert.equal(seen[1].text, 'see https://example.com/a', 'the text as it was');
  // The previous release writing the file again keeps the fields it does not know.
  previous.add('s1', { by: 'pat', who: 'Pat', text: 'after a roll back' });
  previous.flush();
  assert.deepEqual(new ChatHistory(dir).find('s1', linked.id).kept, { by: 'sam', who: 'Sam', at: 7 }, 'not lost by a roll back');

  // Deleted with the message.
  hist.remove('s1', linked.id, 'pat');
  assert.equal(hist.find('s1', linked.id), null);
  fs.rmSync(dir, { recursive: true, force: true });
  ok('preview and kept: stored in both files, moved with visibility, read past by the previous release');
}

// --- the routes, on a throwaway server ------------------------------------------------------------------------------

// The stand-in page.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const hits = []; // paths the stand-in was asked for
const page = http.createServer((req, res) => {
  hits.push(req.url);
  if (req.url === '/hotel' || req.url.startsWith('/page/')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<html><head><title>Ignored</title>
      <meta property="og:title" content="Hotel Example, Lisbon">
      <meta property="og:description" content="A quiet hotel by the river.">
      <meta property="og:image" content="http://page.example.com/og.png"></head></html>`);
  }
  if (req.url === '/og.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
  if (req.url === '/to-private') { res.writeHead(302, { location: 'http://127.0.0.1/admin' }); return res.end(); }
  res.writeHead(500);
  res.end('broken');
});
await new Promise((r) => page.listen(0, '127.0.0.1', r));
const pagePort = page.address().port;
const hitsOf = (p) => hits.filter((h) => h === p).length;

const aiServer = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: 'Try http://page.example.com/page/ai' } }], usage: { total_tokens: 12 } }));
});
await new Promise((r) => aiServer.listen(0, '127.0.0.1', r));

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
  source: 'custom', provider: 'compatible', address: `http://127.0.0.1:${aiServer.address().port}`, model: 'stand-in-model', key: 'sk-test', enabled: true,
}));

let child = null;
let port = 0;
let serverOut = '';
async function startServer() {
  child = spawn(process.execPath, ['--require', path.join(ROOT, 'tools', 'fixtures', 'chat-links-net.cjs'), path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir,
      ADMIN_PASSWORD: 'testpass1234',
      CHECK_STUB_PORT: String(pagePort),
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

async function call(method, urlPath, { body, cookie } = {}) {
  const headers = { accept: 'application/json' };
  if (cookie) headers.cookie = `app_session=${cookie}`;
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: payload });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, buf, headers: res.headers };
}
const login = async (name, password) => {
  const r = await call('POST', '/api/login', { body: { login: name, password } });
  assert.equal(r.status, 200, `${name} signs in: ${r.text}`);
  return r.json.token;
};
// Lets the server finish anything it sends on its own (a notice to the call) before it is looked at.
const settle = () => new Promise((r) => setTimeout(r, 150));
const told = (type) => sent.filter((s) => s.payload?.type === type).map(({ payload: { space, ...rest } }) => rest);

// First start: people and a space, then stopped, so messages from before this release can be written in.
await startServer();
let ids;
try {
  const owner = await login('admin', 'testpass1234');
  const mk = async (login, displayName) => (await call('POST', '/api/users', { cookie: owner, body: { login, displayName, role: 'member', password: 'memberpass1234' } })).json.user;
  const pat = await mk('pat', 'Pat');
  const sam = await mk('sam', 'Sam');
  const space = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Trip', members: [pat.key, sam.key] } })).json.space;
  ids = { pat: pat.key, sam: sam.key, space: space.id };
} finally {
  await stopServer();
}
const S = ids.space;
const OLD_PLAIN = { id: 'c00000000001', at: Date.now() - 20 * 60000, by: ids.pat, who: 'Pat', text: 'from before: http://page.example.com/page/before' };
const OLD_LINK = { id: 'c00000000002', at: Date.now() - 6 * 60000, by: ids.pat, who: 'Pat', text: 'six minutes ago http://page.example.com/page/old', preview: { url: 'http://page.example.com/page/old' } };
fs.writeFileSync(path.join(dataDir, 'chat.json'), JSON.stringify({ spaces: { [S]: [OLD_PLAIN, OLD_LINK] }, cleared: {} }));

await startServer();
try {
  const owner = await login('admin', 'testpass1234');
  const pat = await login('pat', 'memberpass1234');
  const sam = await login('sam', 'memberpass1234');
  await listenLive(`/api/live?space=${S}`, owner);
  const guest = `?guest=${encodeURIComponent((await call('POST', `/api/spaces/${S}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken)}`;
  const post = async (cookie, text, q = '') => {
    const r = await call('POST', `/api/spaces/${S}/chat${q}`, { cookie, body: { text, name: 'Visitor' } });
    assert.equal(r.status, 200, r.text);
    return r.json.message;
  };
  const preview = (cookie, id, q = '') => call('POST', `/api/spaces/${S}/chat/${id}/preview${q}`, { cookie });
  const keep = (cookie, id, q = '') => call('POST', `/api/spaces/${S}/chat/${id}/keep${q}`, { cookie });
  const image = (cookie, id, q = '') => call('GET', `/api/spaces/${S}/chat/${id}/image${q}`, { cookie });
  const chatOf = async (cookie, q = '') => (await call('GET', `/api/spaces/${S}/chat${q}`, { cookie })).json.messages;

  // Nothing stored breaks: the old messages read as they were.
  const before = await chatOf(pat);
  assert.deepEqual(before.find((m) => m.id === OLD_PLAIN.id), OLD_PLAIN, 'a message from before reads as it was');
  assert.deepEqual(before.find((m) => m.id === OLD_LINK.id), OLD_LINK);
  ok('messages stored before read as they were');

  // No keeper on in the space: the link is stored, but nothing is read and nothing can be kept.
  const early = await post(pat, 'This one? http://page.example.com/hotel and http://page.example.com/page/second');
  assert.deepEqual(early.preview, { url: 'http://page.example.com/hotel' }, 'the first link, stored when posted');
  assert.deepEqual((await chatOf(sam)).find((m) => m.id === early.id).preview, { url: 'http://page.example.com/hotel' }, 'and read back');
  assert.equal('preview' in (await post(pat, 'nothing to see')), false, 'no link, no preview');
  const none = await preview(pat, early.id);
  assert.equal(none.status, 200, none.text);
  assert.deepEqual(none.json.message.preview, { url: 'http://page.example.com/hotel' }, 'no keeper: unchanged');
  const noKeeper = await keep(pat, early.id);
  assert.equal(noKeeper.status, 404);
  assert.equal(noKeeper.json.error, 'nothing here can keep links');
  assert.equal(hits.length, 0, 'nothing fetched without a keeper');
  ok('no keeper on: preview.url stored, nothing read, nothing kept');

  // Research on in every space.
  assert.equal((await call('POST', '/api/modules/bundled/research/install', { cookie: owner, body: {} })).status, 201);
  const on = await call('PATCH', '/api/modules/research', { cookie: owner, body: { enabled: true, allSpaces: true } });
  assert.equal(on.status, 200, on.text);
  const actionsOf = async (cookie, q = '') => {
    const r = await call('GET', `/api/spaces/${S}/actions${q}`, { cookie });
    assert.equal(r.status, 200, r.text);
    return r.json.actions;
  };
  const saveLink = (await actionsOf(pat)).find((a) => a.name === 'saveLink');
  assert.ok(saveLink, 'the keeper\'s saveLink is listed');
  const keeperName = saveLink.moduleName;
  assert.equal(saveLink.may, true, 'a member may');
  assert.equal((await actionsOf(pat)).find((a) => a.name === 'addNote').may, true, 'a local action: read access is enough');
  assert.ok((await actionsOf(pat)).every((a) => typeof a.may === 'boolean'), 'every action says may');
  assert.equal((await actionsOf('', guest)).find((a) => a.name === 'saveLink').may, false, 'a guest reads the keeper by default, but may not keep');

  // The author, and only the author, has the page read.
  const linked = await post(pat, 'This one? http://page.example.com/hotel');
  sent.length = 0;
  const notAuthor = await preview(sam, linked.id);
  assert.equal(notAuthor.status, 403);
  assert.equal(notAuthor.json.error, 'only the person who posted it can ask for its preview');
  const guestAsks = await preview('', linked.id, guest);
  assert.equal(guestAsks.status, 403, 'a guest is never the author');
  assert.equal((await preview(owner, linked.id)).status, 403, 'nor the owner');
  assert.equal(hits.length, 0);
  const read = await preview(pat, linked.id);
  assert.equal(read.status, 200, read.text);
  const shown = read.json.message.preview;
  assert.equal(shown.url, 'http://page.example.com/hotel');
  assert.equal(shown.module, 'research');
  assert.equal(shown.title, 'Hotel Example, Lisbon');
  assert.equal(shown.description, 'A quiet hotel by the river.');
  assert.equal(shown.image, 'http://page.example.com/og.png');
  assert.ok(Number.isFinite(shown.at));
  assert.equal(hitsOf('/hotel'), 1, 'read once, through the reader');
  await settle();
  assert.deepEqual(told('chat-preview'), [{ type: 'chat-preview', id: linked.id, preview: shown }], 'the live stream is told');
  const again = await preview(pat, linked.id);
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.message.preview, shown, 'a second ask changes nothing');
  assert.equal(hitsOf('/hotel'), 1, 'and reads nothing');
  await settle();
  assert.equal(told('chat-preview').length, 1, 'and tells nobody');
  assert.deepEqual((await chatOf(sam)).find((m) => m.id === linked.id).preview, shown, 'everyone reads it');
  assert.equal((await preview(pat, 'abcdefabcdef')).status, 404);
  assert.equal((await preview(pat, 'nope')).json.error, 'no such message');
  ok('the preview route: only the author, read once, stored, told to the call');

  // The picture, through the server.
  const pic = await image(sam, linked.id);
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get('content-type'), 'image/png');
  assert.equal(pic.headers.get('cache-control'), 'private, max-age=600');
  assert.deepEqual(pic.buf, PNG);
  assert.equal(hitsOf('/og.png'), 1);
  assert.equal((await image('', linked.id, guest)).status, 200, 'a guest reads a public message\'s picture');
  assert.equal(hitsOf('/og.png'), 1, 'from the cache');
  assert.equal((await image(sam, early.id)).status, 404, 'no picture read: 404');
  assert.equal((await image(sam, 'abcdefabcdef')).status, 404);
  assert.equal((await image(sam, linked.id.replace(/^./, 'x'))).status, 404);
  ok('the image route: the picture read here, cached, 404 without one');

  // Never for a private message, a command or an AI answer; never after five minutes.
  const hidden = await post(pat, 'Mine http://page.example.com/page/private');
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/${hidden.id}`, { cookie: pat, body: { visibility: 'private' } })).status, 200);
  assert.equal('at' in (await preview(pat, hidden.id)).json.message.preview, false, 'private: not read');
  assert.equal((await preview(sam, hidden.id)).status, 404, 'someone else\'s private message is no such message');
  assert.equal((await image(sam, hidden.id)).status, 404);
  assert.equal((await keep(sam, hidden.id)).status, 404);
  assert.equal((await keep(sam, hidden.id)).json.error, 'no such message');
  assert.equal(hitsOf('/page/private'), 0);
  assert.equal((await call('POST', '/api/modules/bundled/polls/install', { cookie: owner, body: {} })).status, 201);
  assert.equal((await call('PATCH', '/api/modules/polls', { cookie: owner, body: { enabled: true, allSpaces: true } })).status, 200);
  const vote = await call('POST', `/api/spaces/${S}/command`, { cookie: pat, body: { name: 'p', text: 'http://page.example.com/page/command' } });
  assert.equal(vote.status, 200, vote.text);
  assert.equal('preview' in vote.json.message, false, 'a command echo has no preview');
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/${vote.json.message.id}`, { cookie: pat, body: { visibility: 'public' } })).status, 200);
  assert.equal('preview' in (await preview(pat, vote.json.message.id)).json.message, false);
  const answer = await call('POST', `/api/spaces/${S}/ai`, { cookie: pat, body: { question: 'where? http://page.example.com/page/question' } });
  assert.equal(answer.status, 200, answer.text);
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/${answer.json.id}`, { cookie: pat, body: { visibility: 'public' } })).status, 200);
  assert.equal('preview' in (await preview(pat, answer.json.id)).json.message, false, 'an AI answer has no preview');
  assert.equal('preview' in (await preview(pat, answer.json.questionId)).json.message, false, 'nor its question');
  const old = await preview(pat, OLD_LINK.id);
  assert.equal(old.status, 200);
  assert.deepEqual(old.json.message.preview, OLD_LINK.preview, 'older than five minutes: not read');
  assert.equal(hits.length, 2, `only the page and its picture were asked for: ${hits.join(', ')}`);
  ok('never read: a private message, a command, an AI answer, a message past five minutes');

  // Made private after it was read: it keeps its preview, and only its author sees it.
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/${linked.id}`, { cookie: pat, body: { visibility: 'private' } })).status, 200);
  assert.deepEqual((await chatOf(pat)).find((m) => m.id === linked.id).preview, shown, 'kept through the flip');
  assert.equal((await image(sam, linked.id)).status, 404, 'others cannot read its picture');
  assert.equal((await call('PATCH', `/api/spaces/${S}/chat/${linked.id}`, { cookie: pat, body: { visibility: 'public' } })).status, 200);
  assert.deepEqual((await chatOf(sam)).find((m) => m.id === linked.id).preview, shown, 'and back');
  ok('a preview survives a change of who sees the message');

  // The guard: a private or local address is never asked for, and a failed read is not retried.
  const before2 = hits.length;
  for (const text of [`http://127.0.0.1:${pagePort}/hotel`, 'http://localhost/hotel', 'http://intranet.example.com/hotel', 'http://printer.local/', 'http://[::1]/x', 'http://2130706433/']) {
    const m = await post(pat, `look ${text}`);
    assert.ok(m.preview, `${text} is a link`);
    const r = await preview(pat, m.id);
    assert.equal(r.status, 200, r.text);
    assert.equal('at' in r.json.message.preview, false, `${text}: nothing added`);
  }
  assert.equal(hits.length, before2, `no request reached the stand-in: ${hits.slice(before2).join(', ')}`);
  const redirect = await post(pat, 'http://page.example.com/to-private');
  assert.equal('at' in (await preview(pat, redirect.id)).json.message.preview, false);
  assert.deepEqual(hits.slice(before2), ['/to-private'], 'a redirect to a private address is not followed');
  const broken = await post(pat, 'http://page.example.com/broken');
  assert.equal('at' in (await preview(pat, broken.id)).json.message.preview, false);
  assert.equal('at' in (await preview(pat, broken.id)).json.message.preview, false);
  assert.equal(hitsOf('/broken'), 1, 'a failed read is not tried again');
  await settle();
  assert.equal(told('chat-preview').length, 1, 'a failed read is not told');
  const activity = (await call('GET', '/api/modules/activity', { cookie: owner })).json.activity;
  assert.ok(activity.some((a) => a.module === 'research' && a.what === 'could not read a link from the chat: that address is not allowed'), `the reason is in the activity log: ${JSON.stringify(activity.slice(0, 5))}`);
  ok('the guard: private and local addresses refused before any request; a failed read not retried');

  // Fetch link previews off: nothing is read, the picture stops, Keep still saves the address.
  const off = await call('PUT', '/api/modules/research/settings/environment', { cookie: owner, body: { values: { linkPreviews: false } } });
  assert.equal(off.status, 200, off.text);
  const quiet = await post(pat, 'Off http://page.example.com/page/off');
  const quietRead = await preview(pat, quiet.id);
  assert.equal(quietRead.status, 200);
  assert.deepEqual(quietRead.json.message.preview, { url: 'http://page.example.com/page/off' }, 'off: unchanged');
  assert.equal(hitsOf('/page/off'), 0, 'off: nothing fetched');
  assert.equal((await image(sam, linked.id)).status, 404, 'off: the picture stops');
  assert.equal((await chatOf(sam)).find((m) => m.id === linked.id).preview.title, 'Hotel Example, Lisbon', 'a stored title still shows');
  const keptOff = await keep(sam, quiet.id);
  assert.equal(keptOff.status, 200, keptOff.text);
  assert.equal(keptOff.json.status, 'pending');
  assert.equal((await call('PUT', '/api/modules/research/settings/environment', { cookie: owner, body: { values: { linkPreviews: true } } })).status, 200);
  ok('Fetch link previews off: nothing read, the picture stops, Keep still saves the address');

  // Keep: as the caller, the stored fields, once.
  const pendingOf = async () => {
    const r = await call('GET', `/api/bus/actions/pending?module=research&scope=space&space=${S}`, { cookie: pat });
    assert.equal(r.status, 200, r.text);
    return r.json.actions;
  };
  const queuedBefore = (await pendingOf()).length;
  sent.length = 0;
  const kept = await keep(sam, linked.id);
  assert.equal(kept.status, 200, kept.text);
  assert.equal(kept.json.status, 'pending', 'waits until the keeper is next open');
  assert.equal(kept.json.message.kept.by, ids.sam);
  assert.equal(kept.json.message.kept.who, 'Sam');
  assert.ok(Number.isFinite(kept.json.message.kept.at));
  const pending = await pendingOf();
  assert.equal(pending.length, queuedBefore + 1);
  const asked = pending.at(-1);
  assert.equal(asked.name, 'saveLink');
  assert.equal(asked.by, 'Sam', 'asked as the person who kept it');
  assert.equal(kept.json.id, asked.id, 'Keep answers the request\'s id');
  const keptStatus = await call('GET', `/api/spaces/${S}/action/${kept.json.id}`, { cookie: sam });
  assert.deepEqual([keptStatus.status, keptStatus.json], [200, { id: asked.id, status: 'pending' }], 'the person who kept it reads how it is going');
  assert.equal((await call('GET', `/api/spaces/${S}/action/${kept.json.id}`, { cookie: pat })).status, 404, 'nobody else does');
  assert.deepEqual(asked.input, { url: 'http://page.example.com/hotel', title: 'Hotel Example, Lisbon', excerpt: 'A quiet hotel by the river.' }, 'built from the stored message');
  await settle();
  assert.deepEqual(told('chat-kept'), [{ type: 'chat-kept', id: linked.id, kept: kept.json.message.kept }], 'the live stream is told');
  const twice = await keep(pat, linked.id);
  assert.equal(twice.status, 200);
  assert.equal(twice.json.status, 'kept', 'already kept');
  assert.equal('id' in twice.json, false, 'nothing asked, so no request id');
  assert.deepEqual(twice.json.message.kept, kept.json.message.kept, 'by the first person still');
  assert.equal((await pendingOf()).length, queuedBefore + 1, 'and nothing asked again');
  await settle();
  assert.equal(told('chat-kept').length, 1);
  assert.deepEqual((await chatOf(pat)).find((m) => m.id === linked.id).kept, kept.json.message.kept, 'everyone reads Kept by');
  assert.deepEqual((await keep(pat, (await post(pat, 'no link')).id)).json, { error: 'no such message' }, 'a message with no link');
  assert.equal((await keep(pat, 'abcdefabcdef')).status, 404);
  // A long address goes to the keeper whole: saveLink takes `url` as "text" (Research 0.2.34), not a "string" cut at 200.
  const long = `http://page.example.com/page/${'l'.repeat(270)}`;
  const longMessage = await post(pat, long);
  assert.equal(longMessage.preview.url, long);
  assert.equal((await keep(pat, longMessage.id)).status, 200);
  assert.equal(saveLink.input.url, 'text', 'saveLink declares url as text');
  assert.equal((await pendingOf()).at(-1).input.url, long, 'the whole address reaches the keeper');
  // The author keeps their own private message; the call is not told.
  sent.length = 0;
  const own = await keep(pat, hidden.id);
  assert.equal(own.status, 200, own.text);
  assert.equal(own.json.message.kept.who, 'Pat');
  await settle();
  assert.equal(told('chat-kept').length, 0, 'a private message\'s Keep is not told');
  ok('Keep: built from the stored message, asked as the caller, Kept by, once');

  // A guest, and a reader without write: no Keep, no preview, may false.
  const guestKeep = await keep('', early.id, guest);
  assert.equal(guestKeep.status, 403);
  assert.equal(guestKeep.json.error, `you cannot add to ${keeperName} here`);
  assert.equal((await call('PATCH', '/api/roles/guest', { cookie: owner, body: { 'module.research.view': false } })).status, 200);
  assert.ok(!(await actionsOf('', guest)).some((a) => a.module === 'research'), 'a guest who cannot read the keeper is not offered it');
  assert.equal((await keep('', early.id, guest)).status, 403);
  assert.equal((await call('PATCH', '/api/roles/guest', { cookie: owner, body: { 'module.research.view': true } })).status, 200);
  assert.equal((await call('PATCH', '/api/roles/member', { cookie: owner, body: { 'module.research.edit': false } })).status, 200);
  assert.equal((await actionsOf(pat)).find((a) => a.name === 'saveLink').may, false, 'a reader without write');
  assert.equal((await actionsOf(owner)).find((a) => a.name === 'saveLink').may, true, 'the owner may');
  assert.equal((await keep(sam, early.id)).status, 403);
  const reader = await post(pat, 'Reader http://page.example.com/page/reader');
  assert.equal('at' in (await preview(pat, reader.id)).json.message.preview, false, 'an author who cannot write to the keeper: not read');
  assert.equal(hitsOf('/page/reader'), 0);
  assert.equal((await call('PATCH', '/api/roles/member', { cookie: owner, body: { 'module.research.edit': true } })).status, 200);
  ok('a guest and a reader without write: no Keep (403), no preview, may false');

  // Signed out, and the key that opens a keyed page, are refused as for the rest of the chat.
  assert.equal((await preview('', linked.id)).status, 401);
  assert.equal((await keep('', linked.id)).status, 401);
  assert.equal((await image('', linked.id)).status, 401);

  // Research's limit, shared: once the author's searches are used up, the preview route says so.
  let limited = null;
  for (let i = 0; i < 60 && !limited; i += 1) {
    const r = await call('POST', `/api/modules/research/link-preview?scope=space&space=${S}`, { cookie: pat, body: { url: 'ftp://example.com/' } });
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, 'Research\'s own limit is reached');
  const slowed = await post(pat, 'Slow http://page.example.com/page/limit');
  const over = await preview(pat, slowed.id);
  assert.equal(over.status, 429);
  assert.equal(over.json.error, limited.json.error, 'with the module\'s limit message');
  assert.equal(hitsOf('/page/limit'), 0);
  ok('the preview route shares Research\'s limit');

  // The chat post limit for Keep.
  let keepLimited = null;
  for (let i = 0; i < 40 && !keepLimited; i += 1) {
    const m = await call('POST', `/api/spaces/${S}/chat`, { cookie: sam, body: { text: `k${i} http://page.example.com/page/k${i}` } });
    if (m.status === 429) keepLimited = await keep(sam, early.id);
  }
  assert.ok(keepLimited, 'the chat post limit is reached');
  assert.equal(keepLimited.status, 429);
  assert.equal(keepLimited.json.error, 'too many messages, slow down');
  ok('Keep counts toward the chat post limit');

  liveCtl?.abort();
  await stopServer();
  // On disk after a stop: chat.json in its old shape with the new fields; the previous release reads it.
  const pub = readJson(path.join(dataDir, 'chat.json'));
  assert.deepEqual(Object.keys(pub).sort(), ['cleared', 'spaces']);
  const stored = pub.spaces[S].find((m) => m.id === linked.id);
  assert.deepEqual(stored.preview, shown);
  assert.equal(stored.kept.who, 'Sam');
  assert.deepEqual(pub.spaces[S].find((m) => m.id === OLD_PLAIN.id), OLD_PLAIN, 'an old message is not touched');
  const privStored = readJson(path.join(dataDir, 'chat-private.json')).spaces[S].find((m) => m.id === hidden.id);
  assert.equal(privStored.kept.who, 'Pat', 'kept on a private message, in chat-private.json');
  const previous = new PreviousChat(dataDir).list(S);
  assert.ok(previous.some((m) => m.id === linked.id && m.text === 'This one? http://page.example.com/hotel'), 'the previous release reads it');
  assert.ok(!previous.some((m) => m.id === hidden.id), 'and never the private one');
  ok('on disk: both files, readable by the previous release');
} finally {
  await stopServer();
  page.close();
  aiServer.close();
  liveCtl?.abort();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`check-chat-links: OK (${n} checks)`);
