#!/usr/bin/env node
/*
 * check-chat-page.mjs -- Chat's page side of the one chat model (documentation/plans/plan-chat-model.md, steps 2, 5
 * and 6), run without a browser. The server's side is tools/check-chat-model.mjs; the views' markup is in
 * tools/check-switches.mjs.
 *
 *   Discussion | Assistant (GitHub #203): which messages each view shows, where a typed line goes (a command switches
 *           to the Assistant), the marks for new messages, the Share action.
 *
 *   step 2: Chat is drawn from the one store: no local echo, no separate AI thread, no second public post; the badge
 *           sends the PATCH; the chat-visibility notice; {{summary:N}} dropped from an ordinary message; a message
 *           made public placed by its time and counted unread; "Delete your private messages" gone for Clear….
 *   Clear… (plan-chat-clear.md, #166, step 2): the types and counts from what the page holds, the scopes, pictures, the
 *           menu for a member, a moderator and a guest, the two-choice confirm, the chat-clear-some notice.
 *   step 5: the eight tints, fixed light and dark values, on a message and on a module's icon; no fixed colour in a rule.
 *   step 6: every bundled module's colour (decision 20), a known tint.
 *   Links (plan-chat-links.md, #158, step 4): the preview and Keep as the page holds them, the two notices' sender rule,
 *           the picture only ever from the image route, Keep only with `may`, the box's tint on its edge and icon.
 *
 *   Send to... (plan-object-handoff.md, step 9): what a message is, the places that take it, the words for how a request
 *           went, the menu entry and a picture uploaded first.
 *
 *   node tools/check-chat-page.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-page-check-'));
fs.copyFileSync(path.join(ROOT, 'public/chat-input.js'), path.join(tmp, 'chat-input.mjs'));
const { stripSummaryMarkers, readView, emptyLine, viewKey, CHAT_VIEWS, viewOf, inView, discussionWord, routeLine, aiNotice, commandName, commandForms, looksLikeImport, marksNew, clearTypeOf, ofClearType, inClearScope, clearChoices, clearTakesPicture, clearNoticeTakes, linkUrl, cleanPreview, cleanKept, siteName, linkKeeper, previewNoticeTakes, keptNoticeTakes, findLink, TRAVEL_KINDS, keeperFor, detailLines, keepInput, suggestionInput, takesKind, objectInputOf, objectKeepInput, namedKindCount, eventLooksLikeTravel, placeOrder, placeRank, settlePlace, splitTicked, leftOutWords, DAY_KINDS, hasDay, needsDay, keepTargets, keepTargetInput, canKeepAny, keepCountWords, detailsLine, plainTitle, messageObjects, sendChoices, requestOutcome, outcomesWords, chatDay, wordsExtra, pictureRefused } = await import(pathToFileURL(path.join(tmp, 'chat-input.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

let n = 0;
const test = (name, fn) => {
  try {
    fn();
    n += 1;
  } catch (err) {
    console.error(`check-chat-page: ${name}\n  ${err.message}`);
    process.exit(1);
  }
};
const space = read('public/space.js');
const chat = read('public/chat-input.js');
const css = read('public/style.css');
// The Chat family's block in system.css (design system step 29): the message, its head, portrait, body and quote, and the composer's field.
const sys = read('public/sdk/system.css');
const chatBlock = sys.slice(sys.indexOf('/* chat:start */'), sys.indexOf('/* chat:end */'));
const fnBody = (src, head) => {
  const at = src.indexOf(head);
  assert.ok(at > -1, `missing ${head}`);
  return src.slice(at, src.indexOf('\n}\n', at) + 2);
};
const TINTS = ['gold', 'blue', 'green', 'teal', 'purple', 'red', 'orange', 'pink'];

// --- step 2 ---------------------------------------------------------------------------------------------------------

test('an ordinary message drops {{summary:N}} (decision 16); only an AI answer turns it into a preview', () => {
  assert.equal(stripSummaryMarkers('AI answer shared by Pat\n\nIt is {{summary:0}}.'), 'AI answer shared by Pat\n\nIt is.');
  assert.equal(stripSummaryMarkers('Two {{summary:0}} and {{summary:12}} here'), 'Two and here');
  assert.equal(stripSummaryMarkers('no markers {{summary:x}}'), 'no markers {{summary:x}}');
  assert.equal(stripSummaryMarkers(null), '');
  const el = fnBody(space, 'function messageEl(entry, own) {');
  assert.match(el, /renderMarkup\(entry\.kind \? entry\.text : stripSummaryMarkers\(entry\.text\)\)/, 'ordinary messages only');
  assert.match(el, /chatInput\.answerBody\(entry\.text, entry\.summaries,/, 'an AI answer draws its previews, Keep and all, for whoever sees it');
});

test('one store: no local echo, no AI thread load, no second public post (no duplicates)', () => {
  for (const [file, src] of [['chat-input.js', chat], ['space.js', space]]) {
    assert.ok(!/onPublic/.test(src), `${file}: onPublic is gone`);
    assert.ok(!/sendChat\(`AI answer shared by/.test(src), `${file}: no "AI answer shared by" post`);
    assert.ok(!/\/ai\/thread/.test(src), `${file}: the page reads nothing from the old AI thread routes`);
    assert.ok(!/reflectCommand|addAiTurn|shareMode|threadId/.test(src), `${file}: the local echo and the share mode are gone`);
  }
  const run = fnBody(chat.replace(/^ {2}/gm, ''), 'async function runAi(question, held = null) {');
  const ask = fnBody(chat.replace(/^ {2}/gm, ''), 'function askNow(text, refs, attached = null) {');
  assert.ok(!/share/.test((run + ask).replace(/\/\/.*$/gm, '')), 'POST .../ai is not sent share');
  assert.match(ask, /const shown = \(m\) => \(m && addStored\(m\)/, 'the stored question and answer are drawn from the reply');
  assert.match(ask, /shown\(reply\.question\)[\s\S]*shown\(reply\.message\)/, 'the question, then the answer');
  const echo = fnBody(chat.replace(/^ {2}/gm, ''), 'function echo(parsed, chosen, reply) {');
  assert.match(echo, /if \(reply && reply\.message\) \{ addStored\(reply\.message\); return; \}/, 'a command\'s echo is the stored message the server returned');
  assert.match(echo, /\{ local: true \}/, 'a guest\'s echo (no message) stays on the page only');
  assert.match(space, /addStored: \(m, opts\) => addStoredMessage\(m, opts\),/);
  // History: GET .../chat, every field kept, private and public in one list.
  assert.match(fnBody(space, 'async function fetchChatHistory('), /messages: messages\.map\(\(m\) => storedEntry\(m\)\)/);
  const stored = fnBody(space, 'function storedEntry(m, { local = false } = {}) {');
  for (const field of ['visibility', 'kind', 'command', 'module', 'summaries', 'replyTo', 'question']) assert.ok(stored.includes(field), `storedEntry keeps ${field}`);
  assert.match(stored, /visibility: m\.visibility === 'private' \? 'private' : 'public'/, 'absent means public');
});

test('the badge: the author of a stored message flips it with PATCH, both ways; pictures and local echoes are plain', () => {
  const rule = fnBody(space, 'function canChangeVisibility(entry) {');
  const can = new Function('me', 'guestToken', 'chatIdOk', `${rule}; return canChangeVisibility;`);
  const ok = (id) => /^[a-f0-9]{12}$/.test(id);
  const pat = { key: 'pat', role: 'member' };
  const mine = { stored: true, id: 'aaaaaaaaaaaa', by: 'pat', visibility: 'private' };
  assert.equal(can(pat, '', ok)(mine), true, 'the author, a private message');
  assert.equal(can(pat, '', ok)({ ...mine, visibility: 'public' }), true, 'and a public one');
  assert.equal(can(pat, '', ok)({ ...mine, by: 'sam' }), false, 'never someone else\'s');
  assert.equal(can(pat, '', ok)({ ...mine, picture: true }), false, 'a picture is never stored');
  assert.equal(can(pat, '', ok)({ ...mine, stored: false }), false, 'a guest\'s local echo, an import preview');
  assert.equal(can({ key: 'guest', role: 'guest' }, '', ok)({ ...mine, by: 'guest' }), false, 'a guest never');
  assert.equal(can(pat, 'tok', ok)(mine), false, 'nor a guest link');
  const set = fnBody(space, 'async function setMessageVisibility(entry, visibility) {');
  assert.match(set, /api\('PATCH', `\/api\/spaces\/\$\{encodeURIComponent\(chatSpace\(\)\.id\)\}\/chat\/\$\{entry\.id\}`, \{ visibility \}\)/);
  assert.match(set, /chatNotice\(err\.message \|\| 'Could not change who sees that\.', true\);\n\s*return false;/, 'a refusal leaves the badge and says why');
  const frame = fnBody(space, 'function frameMessage(');
  assert.match(frame, /const done = await setMessageVisibility\(entry, next\);\n\s*if \(!done\) return;/, 'the badge repaints only once the server took it');
  assert.match(frame, /label: next === 'public' \? 'Make public' : 'Make private'/);
  // The mark is an icon, never a word and never a lock: one person private, three people public and shared, each with a
  // tooltip and a label in plain words.
  assert.match(frame, /icon: next === 'public' \? 'users' : 'user',/, 'Make public shows three people, Make private one');
  assert.match(frame, /fa-solid \$\{said === 'private' \? 'fa-user' : 'fa-users'\} fa-fw/, 'one person private, three people public and shared');
  assert.match(frame, /const words = said === 'private' \? 'Only you' : said === 'shared' \? 'Shared with everyone' : 'Everyone';/);
  assert.match(frame, /vis\.dataset\.tip = words;\n\s*vis\.dataset\.mark = said;\n\s*vis\.setAttribute\('aria-label', words\);/, 'tooltip and aria-label say it');
  assert.ok(!/vis\.textContent/.test(frame) && !/lock/.test(frame), 'no word in the header, no lock');
  assert.ok(!/fa-(user-)?lock|'lock'/.test(chat) && !/fa-(user-)?lock|'lock'/.test(space.slice(space.indexOf('function messageEl('), space.indexOf('function placeMessage('))), 'no lock for private in Chat');
});

test('chat-visibility beside chat-delete: made public, drawn by its time and counted unread; made private, gone', () => {
  // Every chat notice is the server's word on the live stream (plan-realtime-optional-livekit.md, step 3); no page sends one.
  const apply = fnBody(space, 'function applyChatNotice(data) {');
  assert.match(apply, /data\.type === 'chat-delete' && chatIdOk\(data\.id\)\) applyDeleteNotice\(data\);\n\s*else if \(data\.type === 'chat-visibility'\) applyVisibilityNotice\(data\);/);
  assert.match(fnBody(space, 'function applyDeleteNotice(data) {'), /dropChatMessage\(data\.id\);/);
  // Delete the chat: the server's chat-clear empties the page; the clearer's own page empties itself once the server
  // has taken it.
  assert.match(apply, /else if \(data\.type === 'chat-clear'\) dropSharedChat\(\);/);
  assert.ok(!/publishChat|publishData\([^)]*topic: 'chat'|sendChatMessage|registerByteStreamHandler\('chat-image'|RoomEvent\.ChatMessage/.test(space), 'nothing of the chat goes over the call');
  assert.match(space, /const space = chatSpace\(\);\n\s*if \(!space\) return;\n\s*try \{\n\s*await api\('DELETE', `\/api\/spaces\/\$\{encodeURIComponent\(space\.id\)\}\/chat`\);\n[\s\S]{0,200}?\n\s*dropSharedChat\(\);/, 'the clearer empties its own page after the server answers (the chat showing: Home\'s or the space\'s)');
  assert.match(read('server/index.js'), /chatHistory\.clear\(found\.space\.id\);\n\s*forgetChatPictures\(found\.space\.id, \(\) => true\);\n\s*tellChat\(found\.space\.id, \{ type: 'chat-clear' \}\);/, 'the server always tells the live stream');
  const notice = fnBody(space, 'function applyVisibilityNotice(data) {');
  assert.match(notice, /dropChatMessage\(data\.id\);/, 'made private: gone for everyone else');
  assert.match(notice, /addEntry\(entry, entry\.by === me\?\.key\);/, 'made public: added, as a new message from its author');
  const add = fnBody(space, 'function addEntry(entry, own = false) {');
  assert.match(add, /const el = messageEl\(entry, own\);\n\s*const last = placeMessage\(el\);/, 'placed by its time');
  assert.match(add, /chatInput\.arrived\(el, \{ own \}\);/, 'and marks the other view');
  assert.match(add, /if \(!canvas\.builtinOpen\('chat'\) && !own && entry\.visibility !== 'private'\) \{\n\s*unread \+= 1;/, 'unread counts public messages from others');
  // placeMessage: before the first message that is later, else last.
  const place = fnBody(space, 'function placeMessage(el) {');
  assert.match(place, /\.find\(\(m\) => Number\(m\.dataset\.at\) > at\)/);
  // The others hear it from the server only, as after a delete.
  assert.ok(!/publishChat/.test(fnBody(space, 'async function setMessageVisibility(')));
});

test('a public AI answer reads "AI, for <name>" and quotes the question in one line (decision 11)', () => {
  const el = fnBody(space, 'function messageEl(entry, own) {');
  assert.match(el, /const quote = entry\.visibility === 'public' && entry\.question \? entry\.question : null;/, 'never on a private answer');
  assert.match(el, /if \(quote\) name = `AI, for \$\{quote\.who\}`;/);
  assert.match(el, /q\.className = 'message-quote';/);
  assert.match(chatBlock, /\n\.message-quote \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/, 'one line');
});

test('"Delete your private messages" is gone for Clear… (plan-chat-clear.md, decision 1)', () => {
  assert.ok(!/Clear your AI thread/.test(space));
  assert.ok(!/Delete your private messages/.test(space), 'the old entry is gone');
  assert.ok(!/\/chat\/private/.test(space), 'the page no longer calls /chat/private');
  // A private message is deleted by its author only, and never announced (the server tells only a public one).
  assert.match(fnBody(space, 'function canDeleteChatEntry(entry) {'), /if \(entry\.visibility === 'private'\) return Boolean\(me\?\.key && entry\.by === me\.key && me\.role !== 'guest'\);/);
  assert.match(read('server/index.js'), /if \(gone\.visibility !== 'private'\) tellChat\(found\.space\.id, \{ type: 'chat-delete', id: gone\.id \}\);/);
});

// --- Clear… (plan-chat-clear.md, step 2) -----------------------------------------------------------------------------

const held = (o) => ({ stored: true, id: 'aaaaaaaaaaaa', visibility: 'public', kind: '', ...o });
const HELD = [
  held({ by: 'pat' }), // Pat's chat, public
  held({ by: 'pat', visibility: 'private' }), // Pat's chat made private
  held({ by: 'sam' }), // Sam's chat
  held({ by: 'pat', kind: 'command', command: 'ai', visibility: 'private' }), // Pat's /ai question
  held({ by: 'pat', kind: 'ai', visibility: 'private' }), // its answer
  held({ by: 'sam', kind: 'ai' }), // Sam's public answer
  held({ by: 'sam', kind: 'command', command: 't', module: 'todo' }),
  held({ by: 'pat', kind: 'command', command: 't', module: 'other-todo' }), // the same command, another module
  held({ by: 'pat', kind: 'command', command: 'x' }), // a stored command with no module: only All takes it
  { id: 'bbbbbbbbbbbb', by: 'pat', picture: true, visibility: 'public' }, // a picture, never stored
  held({ by: 'pat', stored: false }), // an old local copy
];

test('Clear…: each message has one type; pictures, local echoes and old copies have none', () => {
  assert.deepEqual(HELD.map(clearTypeOf), ['chat', 'chat', 'chat', 'ai', 'ai', 'ai', 'module:todo', 'module:other-todo', 'other', '', '']);
  assert.equal(ofClearType(HELD[6], 'module', 'todo'), true);
  assert.equal(ofClearType(HELD[7], 'module', 'todo'), false, 'keyed by module id, not command (decision 10)');
  assert.equal(ofClearType(HELD[6], 'module', ''), false, 'a module type needs its id');
  assert.equal(ofClearType(HELD[8], 'all'), true);
  assert.equal(ofClearType(HELD[9], 'all'), false, 'a picture is not a stored message');
  assert.equal(ofClearType(HELD[3], 'chat'), false, 'an /ai question is AI, not chat');
});

test('Clear…: mine is the person\'s own, public and private; everyone is every public one and only their own private', () => {
  assert.equal(inClearScope(HELD[1], 'mine', 'pat'), true);
  assert.equal(inClearScope(HELD[2], 'mine', 'pat'), false);
  assert.equal(inClearScope(HELD[2], 'everyone', 'pat'), true);
  assert.equal(inClearScope({ ...HELD[1], by: 'sam' }, 'everyone', 'pat'), false, 'never someone else\'s private message (decision 4)');
  assert.equal(inClearScope(HELD[0], 'mine', ''), false, 'nobody without a key');
  assert.equal(inClearScope(HELD[0], 'nobody', 'pat'), false);
});

test('Clear…: the list and its counts, whatever the filter shows (decision 7)', () => {
  const pick = (list) => list.map((c) => [c.type + (c.module ? `:${c.module}` : ''), c.mine, c.everyone]);
  // A member: their own only. Sam's To-do line is not theirs, so it is not listed.
  assert.deepEqual(pick(clearChoices(HELD, { by: 'pat' })), [['chat', 2, 3], ['ai', 2, 3], ['module:other-todo', 1, 1], ['all', 6, 9]]);
  // A moderator: everyone's (every public one and their own private), Sam's To-do too.
  assert.deepEqual(pick(clearChoices(HELD, { by: 'pat', moderator: true })), [['chat', 2, 3], ['ai', 2, 3], ['module:todo', 0, 1], ['module:other-todo', 1, 1], ['all', 6, 9]]);
  assert.equal(clearChoices(HELD, { by: 'pat' })[2].command, 't', 'a module that is gone reads as its command');
  // Nothing of theirs: nothing listed, and Clear… is not offered.
  assert.deepEqual(clearChoices(HELD.filter((e) => e.by === 'sam'), { by: 'pat' }), []);
  assert.deepEqual(clearChoices([HELD[9], HELD[10]], { by: 'pat', moderator: true }), [], 'pictures and old copies alone are nothing to clear');
  assert.deepEqual(clearChoices([], { by: 'pat' }), []);
});

test('Clear…: chat and all take pictures too, the person\'s own for mine, every one for everyone', () => {
  const pic = HELD[9];
  assert.equal(clearTakesPicture(pic, { type: 'chat', scope: 'mine', by: 'pat' }), true);
  assert.equal(clearTakesPicture(pic, { type: 'all', scope: 'mine', by: 'sam' }), false);
  assert.equal(clearTakesPicture(pic, { type: 'all', scope: 'everyone', by: 'sam' }), true);
  assert.equal(clearTakesPicture(pic, { type: 'ai', scope: 'everyone', by: 'pat' }), false);
  assert.equal(clearTakesPicture(HELD[0], { type: 'chat', scope: 'everyone', by: 'pat' }), false, 'only a picture');
});

test("Clear…'s notice (the server's): what it lists, and the pictures by the rule", () => {
  const held = HELD.map((e, i) => ({ ...e, id: e.picture ? e.id : `${i}`.padStart(12, 'c') })); // each its own id
  const every = new Set(held.map((e) => e.id));
  const takes = (opts) => held.filter((e) => clearNoticeTakes(e, { ids: every, ...opts }));
  // Scope mine with no ids: only Sam's pictures go (chat or all).
  const mine = held.filter((e) => clearNoticeTakes(e, { ids: new Set(), type: 'chat', scope: 'mine', by: 'sam' }));
  assert.deepEqual(mine.map((e) => [e.by, Boolean(e.picture)]), mine.map(() => ['sam', true]), "a clear of mine takes the clearer's pictures only");
  // Everyone's listed ids, and for chat or all every picture.
  const server = takes({ type: 'all', scope: 'everyone', by: 'sam' });
  assert.ok(server.some((e) => e.by === 'pat' && !e.picture), "the server's notice takes Pat's listed messages");
  assert.ok(server.includes(held[9]), "the server's clear of everyone's takes Pat's picture");
  assert.equal(clearNoticeTakes(HELD[0], { ids: every, type: 'all', scope: 'everyone', by: '' }), false, 'no sender named, nothing taken');
});

test('Clear… in the ⋮ menu: after Save the chat, before Delete the chat; never for a guest; the route; the notice', () => {
  const more = space.slice(space.indexOf("$('chat-more').addEventListener('click'"), space.indexOf("$('chat-pic').addEventListener"));
  const at = (label) => more.indexOf(label);
  assert.ok(at("label: 'Save the chat'") > -1 && at("label: 'Save the chat'") < at("label: 'Clear…'") && at("label: 'Clear…'") < at("label: 'Delete the chat'"), 'Save, Clear…, Delete');
  assert.match(more, /if \(canClearChat\(\) && clearChoices\(chatLog, \{ by: me\.key, moderator: canModerateChat\(\) \}\)\.length\)/, 'offered only with something to clear');
  assert.match(more, /hint: 'Every message goes, for everyone, private ones too\.'/, 'Delete the chat names private messages (decision 6)');
  assert.match(fnBody(space, 'function canClearChat() {'), /me\?\.key && me\.role !== 'guest' && !guestToken && chatSpace\(\) && !chatSpace\(\)\.isAside/, 'never a guest, never in an aside');
  const clear = fnBody(space, 'async function clearChatMessages(');
  assert.match(clear, /api\('DELETE', `\/api\/spaces\/\$\{encodeURIComponent\(chatSpace\(\)\.id\)\}\/chat\/messages\?\$\{q\}`\)/, 'the route of decision 11');
  assert.ok(clear.indexOf('await api(') < clear.indexOf('dropChatEntries(gone)'), 'dropped here only once the server took it');
  assert.ok(!/catch/.test(clear), 'a refusal is thrown, for the confirm to show');
  assert.ok(!/publishChat/.test(clear), 'the server tells the others');
  const confirm = fnBody(space, 'function confirmClearChat(');
  assert.match(confirm, /confirm: `Clear your \$\{choice\.mine\} \$\{what\}\$\{messagesWord\(choice\.mine\)\}\?`/, 'a member: one choice with the count');
  assert.match(confirm, /label: `Clear yours \(\$\{choice\.mine\}\)`/);
  assert.match(confirm, /label: `Clear everyone's \(\$\{choice\.everyone\}\)`, hint: 'Private messages of others stay\.'/);
  // The two-choice confirm in module-host.js: each choice acts, a failure shows in the menu, Keep it last.
  const host = read('public/module-host.js');
  const cm = fnBody(host, 'export function openConfirmMenu(');
  assert.match(cm, /choices\.map\(\(c\) => \(\{ icon, label: c\.label, hint: c\.hint, disabled: Boolean\(c\.disabled\), danger: !c\.disabled, onPick: act\(c\.onConfirm\) \}\)\)/);
  assert.match(cm, /catch \(err\) \{ openHostMenu\(trigger, \[\{ label: err\.message \|\| fail, disabled: true \}\]\); \}/);
  assert.match(cm, /\[\.\.\.doing, \{ icon: 'xmark', label: 'Keep it'/);
  // The notice beside chat-delete; only someone else's clear of everyone's leaves a line.
  assert.match(fnBody(space, 'function applyChatNotice(data) {'), /data\.type === 'chat-visibility'\) applyVisibilityNotice\(data\);\n\s*else if \(data\.type === 'chat-clear-some'\) applyClearNotice\(data\);/);
  const notice = fnBody(space, 'function applyClearNotice(data) {');
  assert.match(notice, /clearNoticeTakes\(e, \{ ids, type, scope, by \}\)/, 'what a notice takes');
  assert.match(notice, /if \(scope !== 'everyone' \|\| by === me\?\.key\) return;/, "only someone else's clear of everyone's adds the line");
  assert.ok(!/addEntry|chatLog\.push|unread \+=/.test(notice), 'the line is not stored and not counted');
  // Tints in the host menu come from the tokens.
  const menuJs = read('public/host-menu.js');
  assert.match(menuJs, /const TINT = \/\^\(gold\|blue\|green\|teal\|purple\|red\|orange\|pink\)\$\/;/);
  assert.match(menuJs, /if \(TINT\.test\(tint \|\| ''\)\) i\.dataset\.tint = tint;/);
});

// --- Discussion | Assistant (GitHub #203), in place of the filter (its markup is in check-switches.mjs) ---------------

test('the views: the Discussion by default, the two choices, the session key, the word', () => {
  assert.deepEqual(CHAT_VIEWS, ['discussion', 'assistant']);
  assert.equal(readView(null), 'discussion');
  assert.equal(readView('all'), 'discussion', 'the old filter\'s value is not a view');
  assert.equal(readView('private'), 'discussion');
  assert.equal(readView('assistant'), 'assistant');
  assert.equal(viewKey('abc'), 'chat-view:abc');
  assert.equal(discussionWord('Chat'), 'Discussion', 'the default word');
  assert.equal(discussionWord(''), 'Discussion');
  assert.equal(discussionWord(' Trip  talk '), 'Trip talk', 'the environment\'s own name for Chat');
  // Shown in a space to anyone who reads Chat, guests too; hidden in an aside, which is the Discussion alone.
  assert.match(chat, /setViewsVisible\(Boolean\(spaceId\(\)\) && !isHome\(\)\);/, 'not on Home (GitHub #326)');
  assert.match(space, /if \(\$\('chat-views'\)\) \$\('chat-views'\)\.hidden = true;/);
  assert.match(chat, /view = spaceId\(\) && !isHome\(\) \? readView\(next\) : 'discussion';/, 'no Assistant outside a space, nor on Home');
  // Home (GitHub #326, Thomas 2026-10-15): the Discussion alone, and no commands, which run in a space's modules.
  assert.match(chat, /function commandList\(\) \{\n    const list = \[\];\n    if \(isHome\(\)\) return list;/, 'Home has no commands');
  assert.match(chat, /if \(!spaceId\(\) \|\| isHome\(\) \|\| !getMe\(\)\) return;/, 'Home asks for no import actions');
  assert.match(space, /isHome: \(\) => Boolean\(homeChatSpace\),/, 'space.js tells the chat when it is Home\'s');
  assert.match(space, /\$\('chat-command-wrap'\)\.hidden = Boolean\(homeChatSpace\)/, 'the command button is hidden on Home');
});

test('the views: which messages each shows (one store, no copies)', () => {
  // Private: only ever its author's page holds one; the Assistant's, whatever it is.
  for (const kind of ['', 'ai', 'command', 'own']) assert.equal(viewOf({ visibility: 'private', kind, mine: true }), 'assistant');
  assert.equal(viewOf({ visibility: 'private', kind: 'ai', mine: false }), 'assistant', 'an import preview, a guest\'s echo');
  // Public: everyone's conversation is the Discussion's.
  assert.equal(viewOf({ visibility: 'public', kind: 'own', mine: true }), 'discussion', 'my own message');
  assert.equal(viewOf({ visibility: 'public', kind: '', mine: false }), 'discussion', 'someone else\'s');
  assert.equal(viewOf({ visibility: 'public', kind: 'ai', mine: false }), 'discussion', 'someone else\'s shared answer');
  assert.equal(viewOf({ visibility: 'public', kind: 'command', mine: false }), 'discussion', 'someone else\'s shared command');
  // My own shared command or answer: in the Discussion for everyone, and still in my Assistant.
  assert.equal(viewOf({ visibility: 'public', kind: 'ai', mine: true }), 'both');
  assert.equal(viewOf({ visibility: 'public', kind: 'command', mine: true }), 'both');
  assert.equal(inView('both', 'discussion') && inView('both', 'assistant'), true);
  assert.equal(inView('assistant', 'discussion'), false, 'no private message in the Discussion');
  assert.equal(inView('discussion', 'assistant'), false, 'no conversation in the Assistant');
  assert.equal(inView(undefined, 'discussion'), true, 'a line without a place (a divider, a notice) is the Discussion\'s');
  assert.equal(inView(undefined, 'assistant'), false);
  // The page: data-in from viewOf on each message, repainted with its badge; the person's own shared one reads shared.
  const frame = fnBody(space, 'function frameMessage(');
  assert.match(frame, /const mine = Boolean\(me\?\.key && entry\?\.by === me\.key\);/);
  assert.match(frame, /el\.dataset\.in = viewOf\(\{ visibility: state, kind, mine \}\);\n\s*const said = el\.dataset\.in === 'both' \? 'shared' : state;/);
  assert.match(chat, /box\.dataset\.in = 'assistant';/, 'the "not open" question is the person\'s own');
  // The Assistant's empty line; the Discussion shows none, as before.
  assert.equal(emptyLine('discussion', []), '');
  assert.equal(emptyLine('assistant', ['discussion']), 'Your commands, AI answers and what you bring in show here. Only you see them.');
  assert.equal(emptyLine('assistant', ['both']), '');
  assert.equal(emptyLine('assistant', ['assistant', 'discussion']), '');
});

test('the views: where a typed line goes; a command switches to the Assistant and leaves the Discussion alone', () => {
  assert.deepEqual(routeLine('/t buy milk', 'discussion'), { run: 'command', view: 'assistant', line: '/t buy milk' }, 'switches');
  assert.deepEqual(routeLine('/t buy milk', 'assistant'), { run: 'command', view: 'assistant', line: '/t buy milk' });
  assert.deepEqual(routeLine('  /todo buy milk  ', 'discussion'), { run: 'command', view: 'assistant', line: '/todo buy milk' }, 'the full word is a command as well');
  assert.deepEqual(routeLine('/t', 'discussion'), { run: 'command', view: 'assistant', line: '/t' }, 'a bare command still runs (and says what it needs)');
  assert.deepEqual(routeLine('hello all', 'discussion'), { run: 'message', view: 'discussion', line: 'hello all' });
  assert.deepEqual(routeLine('where to eat?', 'assistant'), { run: 'ai', view: 'assistant', line: 'where to eat?' }, 'plain words in the Assistant ask the AI');
  assert.deepEqual(routeLine('/', 'discussion'), { run: 'none', view: 'discussion', line: '/' }, 'a lone slash stays in the box');
  assert.deepEqual(routeLine('/Hello there', 'assistant'), { run: 'none', view: 'assistant', line: '/Hello there' });
  assert.deepEqual(routeLine('   ', 'assistant'), { run: 'none', view: 'assistant', line: '' });
  // ai-01: /ai is the one built-in command; it asks the AI from either view, and a module command is still a command.
  assert.deepEqual(routeLine('/ai where to eat?', 'discussion'), { run: 'ai', view: 'assistant', line: 'where to eat?' }, '/ai asks the AI');
  assert.deepEqual(routeLine('/ai where to eat?', 'assistant'), { run: 'ai', view: 'assistant', line: 'where to eat?' });
  assert.deepEqual(routeLine('/ai', 'discussion'), { run: 'ai', view: 'assistant', line: '' }, 'a bare /ai asks for the question');
  assert.deepEqual(routeLine('/aim high', 'discussion'), { run: 'command', view: 'assistant', line: '/aim high' }, '/aim is not /ai');
  assert.equal(aiNotice('not-set-up'), 'AI is not set up yet.');
  assert.equal(aiNotice('role', '', { owner: 'owner' }), "Your role can't use AI here: ask the owner.");
  assert.equal(aiNotice('allowance'), "This month's AI allowance is used up.");
  assert.equal(aiNotice('guest', '', { guests: 'Guests' }), 'Guests cannot use AI.');
  assert.equal(aiNotice('space-off', '', { space: 'trip' }), 'AI is turned off in this trip.');
  assert.equal(aiNotice(''), '');
  assert.equal(aiNotice('new-reason', 'something else is wrong'), 'Something else is wrong.');
  assert.equal(routeLine('hi', 'nonsense').run, 'message', 'an unknown view is the Discussion');
  // The page: the box sends by the route; a known command switches before it runs, so its echo lands in the Assistant.
  const submit = space.slice(space.indexOf("$('chat-form').addEventListener('submit'"), space.indexOf('// Enter sends, as in any chat'));
  assert.match(submit, /const route = chatInput\.routeLine\(text\);\n\s*if \(route\.run === 'import'\) \{\n\s*if \(await chatInput\.importText\(route\.line\)\) \{/);
  assert.match(submit, /if \(route\.run === 'command' \|\| route\.run === 'ai'\) \{\n\s*if \(await \(route\.run === 'ai' \? chatInput\.ask\(route\.line\) : chatInput\.handleSubmit\(route\.line\)\)\) \{/);
  assert.match(submit, /if \(route\.run !== 'message'\) return;\n\s*\$\('chat-input'\)\.value = '';/, 'only a message is posted for everyone');
  const run = fnBody(chat.replace(/^ {2}/gm, ''), 'async function runCommand(parsed) {');
  assert.ok(run.indexOf("setNote(`No command /${parsed.name}`, true)") < run.indexOf("setView('assistant')"), 'an unknown command stays where it was typed');
  assert.ok(run.indexOf("setView('assistant')") < run.indexOf('echo(parsed, chosen'), 'switched before it runs');
  assert.ok(!/runAi|'ai'/.test(run), 'no /ai in the command runner: anything typed in the Assistant is asked of the AI');
  assert.match(fnBody(chat.replace(/^ {2}/gm, ''), 'async function askAbout({ question, refs } = {}) {'), /setView\('assistant'\);/, 'a module\'s question too');
  // A picture is for everyone: sent from the Assistant, it shows the Discussion.
  assert.match(fnBody(space, 'async function sendImage(file) {'), /chatInput\.setView\('discussion'\);/);
});

test('the views: the marks for what is new, the rail counts both, the news read out', () => {
  // An AI answer while in the Discussion, or with Chat out of sight: the Assistant's dot.
  assert.equal(marksNew('assistant', { view: 'discussion', shown: true, own: false }), 'assistant');
  assert.equal(marksNew('assistant', { view: 'assistant', shown: false, own: false }), 'assistant');
  assert.equal(marksNew('assistant', { view: 'assistant', shown: true, own: false }), '', 'seen as it lands');
  assert.equal(marksNew('assistant', { view: 'discussion', shown: true, own: true }), '', 'what I typed is not news');
  assert.equal(marksNew('both', { view: 'discussion', shown: true, own: false }), '', 'my own shared one is not news');
  // Someone else's message while in the Assistant: the Discussion's count. Out of sight, Chat's own unread counts it.
  assert.equal(marksNew('discussion', { view: 'assistant', shown: true, own: false }), 'discussion');
  assert.equal(marksNew('discussion', { view: 'discussion', shown: true, own: false }), '');
  assert.equal(marksNew('discussion', { view: 'assistant', shown: false, own: false }), '', 'the rail\'s unread has it');
  assert.equal(marksNew('discussion', { view: 'assistant', shown: true, own: true }), '');
  const rail = fnBody(space, 'function syncRail() {');
  assert.match(rail, /const total = unread \+ assistantNew;/, 'the rail counts both views');
  assert.match(space, /onAssistantNew: \(n\) => \{\n\s*assistantNew = n;\n\s*canvas\.setBuiltinUnread\('chat', unread \+ assistantNew\);\n\s*syncRail\(\);/);
  const arrived = fnBody(chat.replace(/^ {2}/gm, ''), 'function arrived(el, { own = false } = {}) {');
  assert.match(arrived, /announce\(/, 'the Assistant\'s news is read out');
  assert.match(fnBody(chat.replace(/^ {2}/gm, ''), 'function announce(text) {'), /\$\('chat-view-news'\)/);
});

test('Share: the author\'s private message, made public with the PATCH the badge sends', () => {
  const frame = fnBody(space, 'function frameMessage(');
  assert.match(frame, /if \(canChange && state === 'private'\) \{\n\s*items\.push\(\{\n\s*icon: 'users',\n\s*label: 'Share',/);
  assert.match(frame, /if \(!await setMessageVisibility\(entry, 'public'\)\) return;\n\s*el\.repaintVis\('public'\);/, 'repainted only once the server took it');
  assert.ok(frame.indexOf("label: 'Share'") < frame.indexOf("label: 'Send to...'"), 'Share before Send to...');
});

// --- step 5 ---------------------------------------------------------------------------------------------------------

// A tint is written `#rrggbb;` (host.css) or `var(--tone-<same name>, #rrggbb);` (style.css: a theme may set the tone, the hex is
// what it is until it does). Anything else, or another tone's name, is not a tint value.
function tintValue(block, t) {
  const m = new RegExp(`--tint-${t}: (?:#([0-9a-f]{6})|var\\(--tone-${t}, #([0-9a-f]{6})\\));`).exec(block);
  return m ? (m[1] || m[2]) : null;
}

test('tintValue reads both written forms and refuses a mixed or foreign one (planted)', () => {
  assert.equal(tintValue('--tint-gold: #d9a93c;', 'gold'), 'd9a93c');
  assert.equal(tintValue('--tint-gold: var(--tone-gold, #d9a93c);', 'gold'), 'd9a93c');
  assert.equal(tintValue('--tint-gold: var(--tone-blue, #d9a93c);', 'gold'), null, 'another tone');
  assert.equal(tintValue('--tint-gold: color-mix(in srgb, #d9a93c, #94680a);', 'gold'), null, 'a mix of the palettes');
  assert.equal(tintValue('--tint-gold: var(--tone-gold, var(--x));', 'gold'), null, 'no fixed fallback');
});

test('the eight tints: fixed dark values on :root and light ones for the light mode, in style.css and host.css', () => {
  for (const file of ['public/style.css', 'public/sdk/host.css']) {
    const src = read(file);
    const root = src.slice(src.indexOf(':root {'), src.indexOf('\n}\n', src.indexOf(':root {')));
    const lightAt = src.indexOf(':root[data-theme-mode="light"],\n:root[data-mode-shown="light"]:not([data-theme-mode="dark"]) {');
    assert.ok(lightAt > -1, `${file}: the light values follow the mode showing`);
    const light = src.slice(lightAt, src.indexOf('}', lightAt));
    for (const t of TINTS) {
      const dark = tintValue(root, t);
      const lit = tintValue(light, t);
      assert.ok(dark && lit, `${file}: --tint-${t} has a dark and a light value`);
      assert.notEqual(dark, lit, `${file}: --tint-${t} differs by mode`);
    }
  }
  // The same values in both files (style.css may wrap each in its tone role).
  const values = (src) => [...src.matchAll(/--tint-([a-z]+): (?:var\(--tone-[a-z]+, )?(#[0-9a-f]{6})\)?;/g)].map((m) => `${m[1]}=${m[2]}`).join(' ');
  assert.equal(values(read('public/sdk/host.css')), values(css));
  // The mode showing is written for the light values to key on, and module frames receive the tints.
  assert.match(read('public/theme-mode.js'), /for \(const doc of liveDocs\(\)\) doc\.documentElement\.dataset\.modeShown = mode;/);
  const host = read('public/module-host.js');
  for (const t of TINTS) assert.ok(host.includes(`'--tint-${t}'`), `module frames receive --tint-${t}`);
  // The server's list of tints is the same eight.
  assert.deepEqual(createRequire(import.meta.url)('../server/modules.js').TINTS, TINTS);
});

test('a tint colours a message\'s portrait (no edge: the Chat family, step 29) and a module\'s icon; no fixed colour in those rules', () => {
  for (const t of TINTS) assert.match(css, new RegExp(`\\[data-tint="${t}"\\] \\{ --tint: var\\(--tint-${t}\\); \\}`));
  const rule = (src, sel) => {
    const at = src.indexOf(`\n${sel} {`);
    assert.ok(at > -1, `the stylesheet has ${sel}`);
    return src.slice(at, src.indexOf('}', at));
  };
  assert.match(rule(chatBlock, '.message[data-tint] .message-portrait'), /background: color-mix\(in srgb, var\(--tint\) 22%, var\(--surface-panel\)\);\s*color: color-mix\(in srgb, var\(--tint\) 62%, var\(--text-primary\)\);/);
  // No side edge on a message or anything in it, and the tint only on the portrait or a link's icon.
  for (const src of [css, chatBlock]) {
    for (const [, sel, body] of src.matchAll(/([^{}]*\.message[^{}]*)\{([^{}]*)\}/g)) {
      assert.ok(!/border-(left|right)\s*:/.test(body), `${sel.trim()}: no side edge in a message`);
      if (/var\(--tint\)/.test(body)) assert.match(sel, /message-portrait|chat-link-icon/, `${sel.trim()}: the tint only on the portrait or the link's icon`);
    }
  }
  assert.match(rule(css, 'i[data-tint]'), /color: var\(--tint\);/);
  for (const [src, sel] of [[chatBlock, '.message[data-tint] .message-portrait'], [css, 'i[data-tint]'], [chatBlock, '.message-command'], [chatBlock, '.message-quote'], [css, '.chat-view-empty']]) {
    assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(rule(src, sel)), `${sel} uses tokens only`);
  }
  // Where: the module's titlebar on the canvas and in its own window, its line in the Layout menu's Show section.
  const canvasJs = read('public/canvas.js');
  assert.match(canvasJs, /title: m\.name,\s*\n\s*icon: m\.icon,\s*\n\s*tint: colorOf\(m\.id\),/, 'the window\'s frame: its title bar\'s icon in the module\'s tint');
  assert.match(read('public/module-frame.js'), /if \(TINT\.test\(opts\.tint \|\| ''\)\) headIcon\.dataset\.tint = opts\.tint;/);
  assert.ok(canvasJs.includes("icon: m.icon, tint: colorOf(m.id), label: m.name, ...(m.description ? { hint: m.description, clamp: true } : {}), badge: unreadOf(m.id)"), 'the Layout menu\'s Show list tints each module\'s icon');
  assert.match(read('public/switch-list.js'), /data-tint="\$\{tint\}"/);
  // The popped-out page's titlebar (GitHub #229): the server's colour, else a stable pick from the id (module-tint.js).
  const moduleJs = read('public/module.js');
  assert.match(moduleJs, /tint: moduleTint\(mod\.id, mod\.color \|\| null\),/);
  // On a message: a command's colour from its module, the AI gold.
  const look = fnBody(chat.replace(/^ {2}/gm, ''), 'function commandLook({ kind, command, module } = {}) {');
  assert.match(look, /if \(kind === 'ai' \|\| command === 'ai'\) return \{ icon: 'robot', tint: 'gold', label: '\/ai' \};/);
  assert.match(look, /tint: canvas\.colorOf \? canvas\.colorOf\(module\) : null/);
});

// --- step 6 ---------------------------------------------------------------------------------------------------------

test('every bundled module\'s colour (decision 20), a known tint; Stream and the Assistant have none', () => {
  const want = { research: 'blue', todo: 'green', calendar: 'red', travel: 'teal', polls: 'purple', places: 'orange', budget: 'gold', maps: 'pink', whiteboard: 'teal', vault: 'blue', stream: undefined, assistant: undefined };
  const dirs = fs.readdirSync(path.join(ROOT, 'modules')).filter((d) => fs.existsSync(path.join(ROOT, 'modules', d, 'module.json')));
  for (const id of dirs) {
    const manifest = JSON.parse(read(`modules/${id}/module.json`));
    assert.ok(id in want, `modules/${id}: say its colour here`);
    assert.equal(manifest.color, want[id], `modules/${id}: "color"`);
    if (manifest.color !== undefined) assert.ok(TINTS.includes(manifest.color), `modules/${id}: a known tint`);
  }
});

test('links (plan-chat-links.md): a preview is cleaned whoever hands it in; the picture is only a yes or no', () => {
  assert.equal(linkUrl('https://example.com/a'), 'https://example.com/a');
  for (const bad of ['ftp://x.com', 'javascript:alert(1)', 'https://u:p@x.com', `https://x.com/${'a'.repeat(500)}`, '', null, 7]) assert.equal(linkUrl(bad), '', String(bad).slice(0, 30));
  assert.equal(cleanPreview({ url: 'javascript:alert(1)', at: 1, title: 'x' }), null, 'no link, no preview');
  assert.deepEqual(cleanPreview({ url: 'https://x.com/h' }), { url: 'https://x.com/h' }, 'not read: the address alone');
  const read = cleanPreview({ url: 'https://x.com/h', module: 'research', at: 5, title: ` ${'T'.repeat(200)} `, description: 'D'.repeat(900), image: 'https://evil.example/track.gif' });
  assert.equal(read.title.length, 120);
  assert.equal(read.description.length, 500);
  assert.equal(read.image, true, 'the picture\'s address is dropped: the page loads it from the image route by id');
  assert.equal(cleanPreview({ url: 'https://x.com', module: '<b>', at: 1 }).module, undefined, 'a module id or nothing');
  assert.deepEqual(cleanPreview({ url: 'https://x.com', title: 'only when read' }), { url: 'https://x.com' }, 'words only come with a read');
  assert.deepEqual(cleanKept({ by: 'k1', who: 'Mia', at: 9 }), { by: 'k1', who: 'Mia', at: 9 });
  assert.equal(cleanKept({ who: 'Mia' }), null);
  assert.equal(siteName('https://www.Example.com/x'), 'example.com');
});

test('links: Keep only for the keeper\'s saveLink with may: true (decision 10), found by its shape, not its name', () => {
  const save = { name: 'saveLink', module: 'research', moduleName: 'Research', input: { url: 'text', title: 'string?' }, may: true };
  assert.deepEqual(linkKeeper([{ name: 'saveNote', input: { title: 'x', body: 'y' } }, save]), { module: 'research', name: 'Research', may: true });
  assert.equal(linkKeeper([{ ...save, may: false }]).may, false, 'a guest or a reader: no Keep');
  assert.equal(linkKeeper([{ ...save, may: undefined }]).may, false, 'an older server that does not say: no Keep');
  assert.equal(linkKeeper([{ ...save, input: { title: 'string' } }]), null, 'no url input, not a keeper');
  assert.equal(linkKeeper([]), null, 'no keeper (decision 9)');
});

test('links: chat-preview and chat-kept (the server\'s, on the live stream) take the first copy', () => {
  const entry = { id: 'aaaaaaaaaaaa', by: 'author', kind: '', preview: { url: 'https://x.com/h' } };
  const notice = { id: entry.id, preview: { url: 'https://x.com/h', at: 3, title: 'T' } };
  assert.equal(previewNoticeTakes(entry, notice), true, 'the server\'s');
  assert.equal(previewNoticeTakes({ ...entry, preview: { ...entry.preview, at: 1 } }, notice), false, 'a second copy');
  assert.equal(previewNoticeTakes(entry, { ...notice, preview: { ...notice.preview, url: 'https://evil.example' } }), false, 'another address');
  assert.equal(previewNoticeTakes(entry, { ...notice, preview: { url: 'https://x.com/h' } }), false, 'nothing read');
  assert.equal(previewNoticeTakes({ ...entry, kind: 'ai' }, notice), false, 'only an ordinary message');
  const kept = { id: entry.id, kept: { by: 'mia', who: 'Mia', at: 4 } };
  assert.equal(keptNoticeTakes(entry, kept), true, 'the server\'s');
  assert.equal(keptNoticeTakes({ ...entry, kept: { by: 'x' } }, kept), false, 'kept once (decision 11)');
  assert.equal(keptNoticeTakes({ ...entry, preview: undefined }, kept), false, 'no link');
});

test('links: storedEntry keeps preview and kept; the page asks for the preview, draws from the image route; Keep calls the keep route', () => {
  const space = read('public/space.js');
  const stored = space.slice(space.indexOf('function storedEntry('), space.indexOf('async function postChatMessage('));
  assert.match(stored, /if \(!kind\) \{\s*const preview = cleanPreview\(m\.preview\);/);
  assert.match(stored, /const kept = preview \? cleanKept\(m\.kept\) : null;/);
  const send = space.slice(space.indexOf('async function sendChatText('), space.indexOf('function dropChatMessage('));
  assert.match(send, /me\?\.key && me\.role !== 'guest' && !guestToken/, 'never asked for a guest');
  const ask = space.slice(space.indexOf('async function askLinkPreview('), space.indexOf('function applyLinkNotice('));
  assert.match(ask, /\/chat\/\$\{entry\.id\}\/preview`/);
  assert.ok(!/publishChat/.test(ask), 'the server tells the others');
  assert.match(read('server/index.js'), /if \(out\.changed && out\.message\.visibility !== 'private'\) tellChat\(space\.id, \{ type: 'chat-preview'/, 'a private message is never told');
  const box = space.slice(space.indexOf('function linkBox('), space.indexOf('function paintLinkBox('));
  assert.match(box, /img\.src = `\/api\/spaces\/\$\{encodeURIComponent\(chatSpace\(\)\.id\)\}\/chat\/\$\{entry\.id\}\/image\$\{q\}`/);
  assert.ok(!/innerHTML/.test(box), 'a preview\'s words are drawn as text');
  assert.match(box, /if \(!chatLinkKeeper\?\.may \|\| !entry\.stored/, 'Keep only with may');
  assert.match(box, /`Kept by \$\{entry\.kept\.who\}`/);
  assert.ok(!/Waiting/.test(box), 'no lasting waiting line: the server marks it kept at once');
  const keep = space.slice(space.indexOf('async function keepStoredLink('), space.indexOf('async function askLinkPreview('));
  assert.match(keep, /\/chat\/\$\{entry\.id\}\/keep\$\{q\}`/);
  assert.match(keep, /const kept = cleanKept\(out\?\.message\?\.kept\);\n\s*if \(kept\) entry\.kept = kept;/, '"Kept by" from the answer');
  assert.ok(!/publishChat/.test(keep), 'chat-kept is the server\'s only');
  assert.match(fnBody(space, 'function applyChatNotice(data) {'), /else if \(\(data\.type === 'chat-preview' \|\| data\.type === 'chat-kept'\) && chatIdOk\(data\.id\)\) applyLinkNotice\(data\);/);
  const notice = space.slice(space.indexOf('function applyLinkNotice('), space.indexOf('// --- end links in Chat ---'));
  assert.match(notice, /previewNoticeTakes\(entry, data\)/);
  assert.match(notice, /keptNoticeTakes\(entry, data\)/);
  assert.match(space, /loadLinkKeeper\(currentSpace\.id\);/);
});

test('links: the box wears the keeper\'s tint on its icon only (no edge: the Chat family, step 29), theme tokens throughout', () => {
  const css = read('public/style.css');
  const rules = [...css.matchAll(/([^{}]*\.chat-link[^{}]*)\{([^{}]*)\}/g)];
  assert.ok(rules.length >= 8, 'the link box\'s rules');
  for (const [, sel, body] of rules) {
    assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(body), `${sel.trim()}: theme tokens only`);
    assert.ok(!/border-(left|right)\s*:/.test(body), `${sel.trim()}: no side edge`);
    const tinted = body.split(';').filter((d) => /var\(--tint/.test(d)).map((d) => d.split(':')[0].trim());
    for (const prop of tinted) assert.equal(prop, 'color', `${sel.trim()}: the tint only on the icon (${prop})`);
    if (tinted.includes('color')) assert.match(sel, /chat-link-icon/, 'the coloured text is the icon');
  }
});

test('Keep reads how its request went: the bus answers pending at first, so the result route decides (step 9)', () => {
  const src = read('public/chat-input.js');
  const keep = src.slice(src.indexOf('async function requestKeep('), src.indexOf('const sendKey = '));
  assert.ok(!/'queued'/.test(keep.slice(0, keep.indexOf('const sleep'))), 'the POST\'s status is never read as waiting');
  assert.match(keep, /if \(target\.local && !canvas\.isOpen\(target\.module\)\) return \{ error: `\$\{target\.moduleName\} isn't open\.` \};/, 'a form is never asked for while its module is closed');
  assert.match(keep, /api\('GET', `\/api\/spaces\/\$\{encodeURIComponent\(id\)\}\/action\/\$\{encodeURIComponent\(requestId\)\}`\)/);
  assert.match(keep, /for \(let i = 0; i < 10; i \+= 1\) \{\n\s*await sleep\(500\);/, 'about every half second, for about five seconds');
  assert.match(keep, /if \(!status \|\| status\.status === 'done' \|\| status\.status === 'expired'\) break;/);
  // A form not opened yet is still followed until it opens or expires (the bus hands it out for a minute), then said.
  assert.match(keep, /if \(outcome\.result === 'starting'\) followLate\(read, outcomeOf, target, onLate\);/);
  const late = keep.slice(keep.indexOf('async function followLate('));
  assert.match(late, /const until = Date\.now\(\) \+ 70000;/);
  assert.match(late, /await sleep\(2000\);\n\s*status = await read\(\);\n\s*if \(!status \|\| status\.status !== 'pending'\) break;/);
  assert.match(late, /if \(late\.result === 'starting' \|\| late\.result === 'sent'\) late = outcomeOf\(\{ status: 'expired' \}\);/, 'expired, or never told: "isn\'t open"');
  assert.match(late, /if \(late\.result === 'opened'\) bringForward\(target\.module\);/, 'a late form is brought forward too');
  assert.match(late, /else setNote\(late\.text\);/);
  assert.match(keep, /if \(id && requestId && !guest\(\)\) \{/, 'never for a guest');
  assert.match(keep, /if \(outcome\.result === 'opened'\) bringForward\(target\.module\);/, 'a form that opened is brought forward');
  assert.match(keep, /canvas\.show\(moduleId\)/);
  assert.match(read('public/canvas.js'), /show: api_show,/, 'the canvas shows a module as its tab does');
  // The id read through the composites' aliases (`todo` shows the one Calendar while it is on; plan-calendar-todo.md step 3).
  assert.match(fnBody(read('public/canvas.js').replace(/^  /gm, ''), 'const api_show = (id) => {'), /else setView\(m\.id\);/);
});

test('links: the page finds a message\'s link by the server\'s rule', () => {
  const { findLink: serverFindLink } = createRequire(import.meta.url)('../server/chat-links.js');
  const texts = [
    'This one? https://example.com/hotel.', 'see [the hotel](https://a.example/x) and https://b.example', '`https://code.example` then http://plain.example/p',
    '> quoted https://quoted.example\nmine https://mine.example', '```\nhttps://fenced.example\n```\nafter https://after.example', 'ftp://x.example and https://u:p@x.example',
    `https://x.example/${'a'.repeat(600)}`, 'no link here', '(https://paren.example/a)', 'two https://first.example https://second.example',
  ];
  for (const t of texts) assert.equal(findLink(t), serverFindLink(t), t.slice(0, 50));
});

// --- Object handoff (plan-object-handoff.md, step 1) ---------------------------------------------------------------

test('Keep, an older module with no takes: only a travel kind goes to the typed keeper; every other kind to the note keeper', () => {
  const { TRAVEL_KINDS: serverKinds, KINDS } = createRequire(import.meta.url)('../server/object-format.js');
  assert.deepEqual(TRAVEL_KINDS, serverKinds, 'the page\'s copy matches server/object-format.js');
  const keepers = { note: { name: 'saveNote' }, suggestion: { name: 'acceptSuggestion' } };
  for (const kind of TRAVEL_KINDS) assert.equal(keeperFor({ title: 'T', kind }, keepers), keepers.suggestion, kind);
  for (const kind of KINDS.filter((k) => !TRAVEL_KINDS.includes(k))) assert.equal(keeperFor({ title: 'T', kind }, keepers), keepers.note, kind);
  for (const kind of [undefined, '', 'image', 'nonsense']) assert.equal(keeperFor({ title: 'T', kind }, keepers), keepers.note, String(kind));
  assert.equal(keeperFor({ title: 'T', kind: 'flight' }, { note: keepers.note }), keepers.note, 'no typed keeper: the note keeper');
  assert.equal(keeperFor({ title: 'T', kind: 'note' }, { suggestion: keepers.suggestion }), undefined, 'no note keeper: nothing');
  assert.equal(keeperFor(null, keepers), keepers.note);
  // keeperFor is the older rule only: keepTargets uses it for the modules that declare no takes.
  assert.match(fnBody(chat, 'export function keepTargets('), /const old = findKeepers\(list\.filter\(\(a\) => !Array\.isArray\(a\.takes\)\)\);\n\s*const keeper = keeperFor\(summary, old\);/);
  assert.ok(!/summary\.kind && suggestion/.test(chat), 'no keeper chosen by any kind at all');
});

test('Keep: details are kept as "Label: value" lines after the content, for either keeper', () => {
  const { cleanObject } = createRequire(import.meta.url)('../server/object-format.js');
  const sw = cleanObject({ kind: 'flight', title: 'Southwest 1234', details: {
    airline: 'Southwest', number: 1234, from: { code: 'MDW', name: 'Chicago Midway' }, to: 'SJC',
    departs: '2026-11-14T12:50', arrives: '2026-11-14T15:25', minutes: 155, reference: 'ABC123',
  } }, { imported: true });
  const lines = ['Airline: Southwest', 'Number: 1234', 'From: Chicago Midway (MDW)', 'To: SJC', 'Departs: 2026-11-14 12:50', 'Arrives: 2026-11-14 15:25', 'Minutes: 155', 'Reference: ABC123'];
  assert.deepEqual(detailLines(sw.details), lines);
  assert.equal(suggestionInput(sw).content, `${lines.join('\n')}\n\nExternal source`);
  assert.equal(keepInput(sw, '').body, `${lines.join('\n')}\n\nExternal source`);
  const hotel = { title: 'Casa', content: 'Two nights.', kind: 'hotel', details: { checkIn: '2026-11-14', checkOut: '2026-11-16T11:00', guests: 2 } };
  assert.equal(keepInput(hotel, '').body, 'Two nights.\n\nCheck in: 2026-11-14\nCheck out: 2026-11-16 11:00\nGuests: 2');
  assert.deepEqual(detailLines({ options: ['Tasca', 'Marisqueira'], multiple: false, allDay: true, upload: '0123456789abcdef01234567' }), ['Options: Tasca, Marisqueira', 'Multiple: no', 'All day: yes']);
  for (const none of [undefined, null, 'x', [], {}]) assert.deepEqual(detailLines(none), []);
  // No details: exactly as before.
  assert.equal(keepInput({ title: 'T', content: 'Just words.' }, '').body, 'Just words.');
  assert.equal(suggestionInput({ title: 'T', content: 'Just words.', kind: 'tour' }).content, 'Just words.');
  // A dropped picture gets its own words in the import's summary.
  assert.match(chat, /if \(why === 'it is a picture'\) return n === 1 \? "1 was a picture, which can't be imported" : `\$\{n\} were pictures, which can't be imported`;/);
});

// --- Object handoff, step 5: Keep sends the object itself to a keeper that takes it ------------------------------------

test('Keep: a keeper whose takes names the kind gets the object whole; an older one the flat fields', () => {
  const { takersOf, TRAVEL_KINDS: travel } = createRequire(import.meta.url)('../server/object-format.js');
  const planner = JSON.parse(read('modules/travel/module.json')).actions.provides.find((a) => a.name === 'acceptSuggestion');
  const research = JSON.parse(read('modules/research/module.json')).actions.provides.find((a) => a.name === 'saveNote');
  // The page's rule is the server's.
  const samples = [planner.takes, [{ kinds: ['*', 'text'], except: travel.slice(), as: 'an event' }], [{ kinds: ['text'], as: 'a note' }], [{ kinds: ['image'], as: 'an image' }], undefined];
  for (const takes of samples) for (const kind of [...travel, 'event', 'task', 'poll', 'note', 'link', 'image', undefined]) assert.equal(takesKind(takes, kind), takersOf(takes, kind).length > 0, `${JSON.stringify(takes)} ${kind}`);
  const flight = { title: 'Southwest **2483**', kind: 'flight', icon: 'plane', content: 'Window', date: '2026-11-14', basis: 'imported', sources: [1], details: { airline: 'Southwest', number: '2483', departs: '2026-11-14T12:50', arrives: '2026-11-14T15:25' }, links: [{ title: 'SW', url: 'https://southwest.com' }] };
  assert.equal(objectInputOf(planner, flight), 'object');
  assert.deepEqual(objectKeepInput(planner, 'object', flight), { title: 'Southwest **2483**', object: { title: 'Southwest **2483**', kind: 'flight', icon: 'plane', content: 'Window', details: flight.details, date: '2026-11-14', links: flight.links, basis: 'imported' } }, 'details travel as they are, not as lines of text');
  assert.equal(objectInputOf(planner, { title: 'T', kind: 'task' }), '', 'a kind it does not take');
  assert.equal(objectInputOf(research, { title: 'T', kind: 'note' }), research.takes ? 'object' : '', 'Research declares no takes yet: the flat fields');
  assert.equal(objectInputOf({ name: 'acceptSuggestion', input: { title: 'string', kind: 'string?' } }, flight), '', 'an older Planner: the flat fields, details as lines');
  // An AI answer kept to the note keeper as an object keeps its question, as the flat fields did (Research 0.3.0 takes "*").
  const noteKeeper = { name: 'saveNote', input: { title: 'string', body: 'text?', object: 'object?' }, takes: [{ kinds: ['note', '*', 'text'], as: 'a note' }] };
  assert.equal(objectKeepInput(noteKeeper, 'object', { title: 'Lisbon', content: 'A city.' }, 'Where next?').object.content, 'A city.\n\nAsked: Where next?');
  assert.equal(objectKeepInput(noteKeeper, 'object', { title: 'Flight', kind: 'flight', details: { number: '1' } }, 'Which?').object.content, 'Asked: Which?', 'details alone: the question is the content');
  assert.equal(objectKeepInput(noteKeeper, 'object', { title: 'X', content: 'y', basis: 'imported' }, 'Which?').object.content, 'y', 'never for an import');
  assert.equal(objectKeepInput(noteKeeper, 'object', { title: 'X', content: 'y' }, '').object.content, 'y');
  assert.ok(objectKeepInput(noteKeeper, 'object', { title: 'X', content: 'z'.repeat(6000) }, 'Q?').object.content.length <= 6000, 'within the format\'s 6000');
});

// --- Object handoff, step 8: the import preview (plan-object-handoff.md, "The import preview in Chat") -----------------

// GET /api/spaces/:id/actions as the server answers it, from the bundled modules' own module.json: each action with its
// takes (each entry's `may`), and `may`. `opts.off` leaves modules out; `opts.refuse` names entries' permissions not held.
const bundledActions = (ids, { refuse = [], needs = false } = {}) => {
  const names = { travel: 'Planner', research: 'Research', todo: 'To-do', calendar: 'Calendar', polls: 'Polls' };
  const out = [];
  for (const id of ids) {
    const m = JSON.parse(read(`modules/${id}/module.json`));
    for (const a of m.actions.provides) {
      const takes = a.takes ? a.takes.map((e) => ({ ...e, may: !e.permission || !refuse.includes(e.permission) })) : undefined;
      out.push({ action: `${id}:${a.name}`, module: id, moduleName: names[id], name: a.name, label: a.label, input: a.input, local: Boolean(a.local),
        ...(takes ? { takes } : {}), ...(needs && a.needs ? { needs: a.needs } : {}), may: !takes || takes.some((e) => e.may) });
    }
  }
  return out;
};
const places = (actions, obj, o) => keepTargets(actions, obj, o).map((t) => `${t.id} ${t.label}`);

test('Keep goes by takes: with Research off, a note and an event go to the Planner (the reported "Nothing here can keep that yet")', () => {
  const planner = bundledActions(['travel']);
  assert.deepEqual(places(planner, { title: 'N', kind: 'note' }), ['travel:acceptSuggestion Add to Planner as a note']);
  assert.deepEqual(places(planner, { title: 'E', kind: 'event', date: '2026-11-14' }), ['travel:acceptSuggestion Add to Planner as an event']);
  assert.deepEqual(places(planner, { title: 'F', kind: 'flight' }), ['travel:acceptSuggestion Add to Planner as a flight']);
  assert.deepEqual(places(planner, { title: 'H', kind: 'hotel' }), ['travel:acceptSuggestion Add to Planner as a stay']);
  for (const kind of ['task', 'poll', 'link', undefined]) assert.deepEqual(places(planner, { title: 'X', kind }), [], `the Planner does not take ${kind}`);
  assert.ok(canKeepAny(planner), 'Bring in shows with the Planner alone');
});

test('Keep goes by takes: Research alone takes every kind as a note, and a link with an address as a link', () => {
  const research = bundledActions(['research']);
  assert.deepEqual(places(research, { title: 'F', kind: 'flight' }), ['research:saveNote Add to Research as a note']);
  assert.deepEqual(places(research, { title: 'X' }), ['research:saveNote Add to Research as a note'], 'no kind');
  assert.deepEqual(places(research, { title: 'L', kind: 'link', links: [{ title: 'a', url: 'https://a.example' }] }), ['research:saveLink Add to Research as a link', 'research:saveNote Add to Research as a note']);
  assert.deepEqual(places(research, { title: 'L', kind: 'link' }), ['research:saveNote Add to Research as a note'], 'no address: not the link keeper, which needs url');
  assert.deepEqual(places(research, { title: 'P', kind: 'image', details: { upload: 'x' } }), ['research:savePhoto Add to Research as an image'], 'a picture only where it is named ("*" never covers it)');
});

test('Keep goes by takes: with both on, the module naming the kind comes before one taking any object', () => {
  const both = bundledActions(['research', 'travel']);
  assert.deepEqual(places(both, { title: 'F', kind: 'flight' }), ['travel:acceptSuggestion Add to Planner as a flight', 'research:saveNote Add to Research as a note']);
  assert.deepEqual(places(both, { title: 'N', kind: 'note' }), ['research:saveNote Add to Research as a note', 'travel:acceptSuggestion Add to Planner as a note'], 'both name a note: the specialist first');
  assert.deepEqual(places(bundledActions(['travel', 'research']), { title: 'N', kind: 'note' }), places(both, { title: 'N', kind: 'note' }), 'whatever the install order');
  const all = bundledActions(['research', 'travel', 'todo', 'calendar', 'polls'], { needs: true });
  assert.equal(keepTargets(all, { title: 'T', kind: 'task' })[0].id, 'todo:createTask');
  assert.equal(keepTargets(all, { title: 'P', kind: 'poll' })[0].id, 'polls:draftPoll');
  assert.ok(keepTargets(all, { title: 'P', kind: 'poll' })[0].local, 'Polls opens its own form: a local action');
  assert.ok(!keepTargets(all, { title: 'F', kind: 'flight', date: '2026-11-14' }).some((t) => t.module === 'calendar'), 'the Calendar never takes a travel kind (except)');
  assert.ok(!keepTargets(all, { title: 'E', kind: 'event' }).some((t) => t.module === 'calendar'), 'needs date: no Calendar for an undated event');
  assert.ok(keepTargets(all, { title: 'E', kind: 'event', date: '2026-11-14' }).some((t) => t.module === 'calendar'), 'with a day it may go to the Calendar');
  assert.ok(keepTargets(all, { title: 'E', kind: 'event', details: { starts: '2026-11-14T19:00' } }).some((t) => t.module === 'calendar'), 'a details day counts');
  // The person's last choice for the kind comes first.
  assert.equal(keepTargets(both, { title: 'F', kind: 'flight' }, { last: 'research:saveNote' })[0].id, 'research:saveNote');
  assert.equal(keepTargets(both, { title: 'F', kind: 'flight' }, { last: 'gone:action' })[0].id, 'travel:acceptSuggestion', 'a choice no longer here is ignored');
  // Only what this person may use: Polls' create permission, and an action they may not write to.
  assert.ok(!keepTargets(bundledActions(['polls'], { refuse: ['create'] }), { title: 'P', kind: 'poll' }).length);
  assert.ok(!keepTargets(both.map((a) => ({ ...a, may: false })), { title: 'F', kind: 'flight' }).length);
  assert.ok(!canKeepAny([]), 'nothing to keep with: no Bring in');
});

test('Keep: a module with no takes keeps the older rule, after one that names the kind', () => {
  const oldPlanner = { action: 'travel:acceptSuggestion', module: 'travel', moduleName: 'Planner', name: 'acceptSuggestion', input: { title: 'string', kind: 'string?', content: 'text?' }, may: true };
  const oldResearch = { action: 'research:saveNote', module: 'research', moduleName: 'Research', name: 'saveNote', input: { title: 'string', body: 'text?' }, may: true };
  assert.deepEqual(places([oldResearch, oldPlanner], { title: 'F', kind: 'flight' }), ['travel:acceptSuggestion Add to Planner']);
  assert.deepEqual(places([oldResearch, oldPlanner], { title: 'E', kind: 'event' }), ['research:saveNote Add to Research']);
  assert.ok(canKeepAny([oldResearch]));
  const mixed = [...bundledActions(['research']), oldPlanner];
  assert.deepEqual(places(mixed, { title: 'F', kind: 'flight' }), ['travel:acceptSuggestion Add to Planner', 'research:saveNote Add to Research as a note'], 'the older typed keeper before "*"');
  const flight = { title: 'F', kind: 'flight', details: { number: '1' }, basis: 'imported' };
  assert.deepEqual(keepTargetInput(keepTargets([oldPlanner], flight)[0], flight, ''), suggestionInput(flight), 'the flat fields, as before');
  assert.deepEqual(keepTargetInput(keepTargets([oldResearch], flight)[0], flight, 'Q'), keepInput(flight, 'Q'));
});

test('Keep: what each place is sent; the question goes to a note, never to a module mapping the fields', () => {
  const all = bundledActions(['research', 'travel', 'todo', 'calendar', 'polls']);
  const pick = (obj, id) => keepTargets(all, obj).find((t) => t.id === id);
  const flight = { title: 'Southwest 1', kind: 'flight', details: { number: '1' } };
  assert.equal(keepTargetInput(pick(flight, 'travel:acceptSuggestion'), flight, 'Which?').object.content, undefined, 'the Planner maps a flight');
  assert.equal(keepTargetInput(pick(flight, 'research:saveNote'), flight, 'Which?').object.content, 'Asked: Which?', 'Research keeps it as a note');
  const link = { title: 'Site', kind: 'link', links: [{ title: 'Site', url: 'https://a.example/x' }] };
  const input = keepTargetInput(pick(link, 'research:saveLink'), link, '');
  assert.equal(input.url, 'https://a.example/x', 'a link keeper\'s url, from the first link');
  assert.equal(input.object.kind, 'link');
  const poll = { title: 'Where?', kind: 'poll', details: { options: ['A', 'B'] } };
  assert.deepEqual(Object.keys(keepTargetInput(pick(poll, 'polls:draftPoll'), poll, '')), ['object'], 'Polls takes the object alone');
});

test('Keep ticked: the confirm counts each kind by its own word and names each place', () => {
  const words = { one: 'object', many: 'objects' };
  assert.equal(keepCountWords([...Array(3)].map(() => ({ kind: 'event', moduleName: 'Planner' })), words), '3 events in Planner', 'events are not "notes"');
  assert.equal(keepCountWords([
    { kind: 'flight', moduleName: 'Planner' }, { kind: 'hotel', moduleName: 'Planner' }, { kind: 'flight', moduleName: 'Planner' },
    { kind: 'flight', moduleName: 'Planner' }, { kind: 'hotel', moduleName: 'Planner' }, { kind: 'task', moduleName: 'To-do' },
  ], words), '3 flights and 2 stays in Planner, 1 task in To-do');
  assert.equal(keepCountWords([{ kind: 'bus', moduleName: 'Planner' }, { kind: 'bus', moduleName: 'Planner' }, { kind: '', moduleName: 'Research' }], { one: 'note', many: 'notes' }), '2 buses in Planner, 1 note in Research');
  assert.equal(keepCountWords([{ kind: 'ferry', moduleName: 'P' }, { kind: 'note', moduleName: 'P' }, { kind: 'show', moduleName: 'P' }], words), '1 ferry, 1 note and 1 show in P');
});

test('the preview: a details line under the title, the title as plain text, and a day asked for where one is missing', () => {
  const sw = { kind: 'flight', title: 'Southwest **2483**', date: '2026-11-14', details: { airline: 'Southwest', number: '1234', from: { code: 'MDW', name: 'Chicago Midway' }, to: { code: 'SJC' }, departs: '2026-11-14T12:50', arrives: '2026-11-14T15:25', reference: 'ABC123' } };
  assert.equal(detailsLine(sw), 'Southwest 1234 · MDW 12:50 → SJC 15:25 · ABC123');
  assert.equal(detailsLine({ ...sw, date: undefined }), 'Southwest 1234 · MDW 2026-11-14 12:50 → SJC 2026-11-14 15:25 · ABC123', 'another day: the date shown');
  assert.equal(detailsLine({ kind: 'hotel', date: '2026-11-14', details: { checkIn: '2026-11-14T15:00', checkOut: '2026-11-16T11:00', guests: 2 } }), 'Check in 15:00 · Check out 2026-11-16 11:00 · 2 guests');
  assert.equal(detailsLine({ kind: 'restaurant', details: { starts: '19:30', partySize: 4, reference: 'R9' } }), '19:30 · 4 people · R9');
  assert.equal(detailsLine({ kind: 'task', details: { due: '2026-11-20' } }), 'Due 2026-11-20');
  assert.equal(detailsLine({ kind: 'poll', details: { options: ['A', 'B'], closes: '2026-11-01T18:00' } }), 'A / B · Closes 2026-11-01 18:00');
  assert.equal(detailsLine({ kind: 'note', title: 'x' }), '');
  // The title read as plain text, with the SDK's own helper (host.util.plain), never shown as raw Markdown.
  const win = { addEventListener() {}, location: { search: '' } };
  win.parent = win;
  new Function('window', 'document', read('public/sdk/host.js'))(win, { createElement: (tag) => ({ tag }) });
  assert.equal(plainTitle('Southwest **2483**', win.hostText.plain), 'Southwest 2483');
  assert.equal(plainTitle('[Casa](https://c.example) *nice*', win.hostText.plain).startsWith('Casa'), true);
  assert.match(fnBody(chat.replace(/^  /gm, ''), 'function drawObject('), /title\.textContent = titleText;/);
  assert.match(chat, /const titleText = plainTitle\(summary\.title\) \|\| 'Untitled';/);
  // A day: journeys, stays, stops, events and tasks; not notes, links or polls.
  assert.deepEqual(DAY_KINDS, [...TRAVEL_KINDS, 'event', 'task']);
  assert.ok(needsDay({ kind: 'flight', title: 'F' }));
  assert.ok(needsDay({ kind: 'flight', title: 'F', details: { departs: '12:50' } }), 'a time alone is no day');
  assert.ok(!needsDay({ kind: 'flight', title: 'F', details: { departs: '2026-11-14T12:50' } }), 'a details day');
  assert.ok(!needsDay({ kind: 'task', title: 'T', date: '2026-11-14' }));
  for (const kind of ['note', 'link', 'poll', undefined]) assert.ok(!needsDay({ kind, title: 'X' }), String(kind));
  assert.ok(hasDay({ details: { checkIn: '2026-11-14' } }) && !hasDay({ date: '14 Nov' }));
  // The day field is the preview's only (askDay), filled it is the object's date, and "Same day for all" fills every
  // empty one, never one the person set.
  const draw = fnBody(chat.replace(/^  /gm, ''), 'function drawObject(');
  assert.match(draw, /const asksDay = askDay && needsDay\(summary\);/);
  assert.match(draw, /const current = \(\) => \(dayInput && \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(dayInput\.value\) \? \{ \.\.\.summary, date: dayInput\.value \} : summary\);/);
  assert.match(draw, /if \(!dayInput \|\| done\(\) \|\| \(dayInput\.value && !dayFromAll\)\) return;/);
  assert.match(chat, /sameDay\.append\('Same day for all', field\);/);
  assert.match(chat, /words\.textContent = 'No day';/);
  // Keep and Keep ticked both send through the row's own send, to the place the row shows.
  assert.match(chat, /for \(const p of split\.going\) \{\n\s*const going = await p\.r\.view\.send\(p\.target, \{ quiet: true \}\);/);
  assert.match(chat, /const sent = await requestKeep\(current\(\), question, t\);/);
  assert.match(chat, /if \(id && getMe\(\) && canKeepAny\(lastActions\)\) \{/, 'Bring in shows when anything here can keep');
  // The row's checkbox styles reach only the checkbox, not the day field inside the object.
  assert.match(css, /\.chat-import-row > input \{/);
  assert.ok(!/\.chat-import-row input \{/.test(css));
});

// --- Object handoff, step 8 after QA: the place shown is the place sent; forms one at a time ------------------------------

test('the default place: the specialist (fewest named kinds) first, not the install order', () => {
  for (const order of [['travel', 'research', 'todo', 'calendar', 'polls'], ['polls', 'calendar', 'todo', 'research', 'travel']]) {
    const all = bundledActions(order, { needs: true });
    const first = (obj) => keepTargets(all, obj)[0].id;
    assert.equal(first({ title: 'N', kind: 'note' }), 'research:saveNote', order.join());
    assert.equal(first({ title: 'E', kind: 'event', date: '2026-11-14' }), 'calendar:createEvent', order.join());
    assert.equal(first({ title: 'F', kind: 'flight' }), 'travel:acceptSuggestion', order.join());
    assert.equal(first({ title: 'T', kind: 'task' }), 'todo:createTask');
    assert.equal(first({ title: 'P', kind: 'poll' }), 'polls:draftPoll');
    assert.equal(first({ title: 'L', kind: 'link', links: [{ url: 'https://a.example' }] }), 'research:saveLink');
  }
  assert.equal(namedKindCount({ takes: [{ kinds: ['note', '*', 'text'] }] }), 1);
  assert.equal(namedKindCount({ takes: [{ kinds: ['flight', 'train'] }, { kinds: ['note', 'flight'] }] }), 3);
  assert.ok(placeOrder({ rank: 0, span: 1, i: 9 }, { rank: 0, span: 15, i: 0 }) < 0, 'the specialist');
  assert.ok(placeOrder({ rank: 2, note: true, span: 1, i: 9 }, { rank: 2, note: false, span: 0, i: 0 }) < 0, 'among "*" places, the note keeper first');
  assert.ok(placeOrder({ rank: 2, note: false, span: 1, i: 9 }, { rank: 2, note: false, span: 15, i: 0 }) < 0, 'then the fewest named kinds');
  assert.ok(placeOrder({ rank: 2, note: false, span: 1, i: 9 }, { rank: 2, note: false, span: 1, i: 0 }) > 0, 'then the server\'s order');
});

test('the default place: a travel kind, or an event that reads as travel, goes to the Planner in Keep and Send to... (Thomas)', () => {
  for (const order of [['travel', 'research', 'todo', 'calendar', 'polls'], ['polls', 'calendar', 'todo', 'research', 'travel']]) {
    const all = bundledActions(order, { needs: true });
    const keep = (obj) => keepTargets(all, obj)[0].id;
    const send = (obj) => sendChoices(all, [{ what: 'one', objects: [obj] }])[0].id;
    const both = (obj, id, why) => { assert.equal(keep(obj), id, `Keep: ${why}, ${order.join()}`); assert.equal(send(obj), id, `Send to...: ${why}, ${order.join()}`); };
    for (const kind of TRAVEL_KINDS) both({ title: 'X', kind, date: '2026-11-14' }, 'travel:acceptSuggestion', kind);
    both({ title: 'Flight', kind: 'flight', date: '2026-11-14' }, 'travel:acceptSuggestion', 'flight');
    both({ title: 'Tour', kind: 'tour', date: '2026-11-14' }, 'travel:acceptSuggestion', 'tour');
    both({ title: 'Walking tour of Alfama', kind: 'event', date: '2026-11-14' }, 'travel:acceptSuggestion', 'an event that reads as a tour');
    both({ title: 'Dentist', kind: 'event', date: '2026-11-14' }, 'calendar:createEvent', 'a plain event');
    both({ title: 'N', kind: 'note' }, 'research:saveNote', 'a note');
    assert.ok(keepTargets(all, { title: 'Walking tour of Alfama', kind: 'event', date: '2026-11-14' }).some((t) => t.id === 'calendar:createEvent'), 'the Calendar is still in the menu');
  }
  // On what the server keeps of an event (cleanObject): the title and starts, ends, allDay, address; no travel details.
  const { cleanObject } = createRequire(import.meta.url)('../server/object-format.js');
  const ev = (title) => eventLooksLikeTravel(cleanObject({ kind: 'event', title, place: { name: 'Belém' }, details: { starts: '2026-11-14T09:00', departs: '2026-11-14T09:00', airline: 'TAP', reference: 'AB12' } }, { imported: true }));
  assert.deepEqual(Object.keys(cleanObject({ kind: 'event', title: 'X', details: { departs: '2026-11-14T09:00', airline: 'TAP', starts: '2026-11-14T09:00' } }, { imported: true }).details), ['starts'], 'the server keeps no travel details on an event');
  for (const title of ['Airport transfer', 'Hotel transfer', 'Transfer to the hotel', 'Shuttle to the hotel', 'Day cruise', 'Pick up rental car', 'Excursion to Sintra', 'Tours of the old town', 'Ferry to Capri', 'Walking tour of Alfama',
    'Bus to Lisbon', 'Coach to Oxford', 'Taxi to airport', 'Airport pickup', 'Boat trip', 'Flight to Lisbon']) assert.ok(ev(title), title);
  for (const title of ['Dentist', 'Team training', 'Tourism board meeting', 'Concert', 'Trainee review', 'Bank transfer due', 'Wire transfer', 'Détours', 'Trainée review', 'Training session', 'Meet the coach', 'Detour via Porto']) assert.ok(!ev(title), title);
  assert.ok(!eventLooksLikeTravel({ kind: 'task', title: 'Book the tour' }), 'only an event');
  assert.ok(placeOrder({ rank: 0, trip: true, span: 14, i: 9 }, { rank: 0, trip: false, span: 1, i: 0 }) < 0, 'trip before the specialist');
});

test('the place shown is the place sent: fixed on first draw, never moved by a later "last used" or a refresh', () => {
  const both = bundledActions(['research', 'travel']);
  const note = { title: 'N', kind: 'note' };
  // First drawn with "last used" = the Planner: the row shows and keeps the Planner.
  let t = keepTargets(both, note, { last: 'travel:acceptSuggestion' });
  let s1 = settlePlace(t, '');
  assert.equal(s1.target.id, 'travel:acceptSuggestion');
  // Another row's choice changes "last used" to Research; this row is redrawn (a refresh) without last used.
  t = keepTargets(both, note);
  const s2 = settlePlace(t, s1.chosen);
  assert.deepEqual([s2.target.id, s2.moved], ['travel:acceptSuggestion', false], 'not moved by the other row');
  // The Planner is turned off: the row falls back, and says it moved.
  const s3 = settlePlace(keepTargets(bundledActions(['research']), note), s2.chosen);
  assert.deepEqual([s3.target.id, s3.moved], ['research:saveNote', true]);
  assert.deepEqual(settlePlace([], 'x'), { target: null, chosen: 'x', moved: false });
  // In the page: the label, the menu's tick and what is sent all come from the one settled place.
  const draw = fnBody(chat.replace(/^  /gm, ''), 'function drawObject(');
  assert.match(draw, /targets = keepTargets\(lastActions, current\(\), \{ last: chosen \? '' : lastPlace\(summary\.kind\)/, 'last used only before a place is fixed');
  assert.match(draw, /const settled = settlePlace\(targets, chosen\);\n\s*if \(settled\.moved\) view\.moved = true;\n\s*if \(view\.fresh\) chosen = settled\.chosen;\n\s*shown = settled\.target;/);
  assert.match(draw, /label\.textContent = `in \$\{t\.moduleName\}`;/);
  assert.match(draw, /const t = shown;/);
  assert.match(draw, /const target = \(\) => shown;/);
  assert.match(draw, /checked: x\.id === shown\.id/);
  // A single Keep whose place moved on refresh sends nothing and says where it now goes.
  assert.match(draw, /await refreshActions\(\);\n\s*if \(!shown \|\| !before \|\| shown\.id !== before\.id\) \{/);
  // Keep ticked says a moved place before the confirm.
  assert.match(chat, /await confirmDialog\(\{ title: `Keep \$\{what\}\?`, message: `\$\{movedWords\}\$\{leftOut\}`/);
});

test('Keep ticked: a form opens one at a time, a closed module is left out, and what cannot be kept is counted', () => {
  const all = bundledActions(['research', 'travel', 'todo', 'calendar', 'polls']);
  const row = (obj, open) => ({ kind: obj.kind, target: keepTargets(all, obj)[0] || null, open });
  const poll = { title: 'P', kind: 'poll', details: { options: ['A', 'B'] } };
  const split = splitTicked([row(poll, true), row(poll, true), row({ title: 'F', kind: 'flight' }, false), { kind: 'task', target: null }]);
  assert.deepEqual([split.going.length, split.forms.length, split.closed.length, split.nowhere.length], [1, 2, 0, 1], 'polls never go in a batch');
  assert.equal(leftOutWords(split, { one: 'object', many: 'objects' }), "2 polls open a form each in Polls: use each one's own Keep. 1 can't be kept here.");
  const closed = splitTicked([row(poll, false), row(poll, false)]);
  assert.equal(leftOutWords(closed), '2 polls need Polls open.');
  assert.equal(leftOutWords(splitTicked([row(poll, false)])), '1 poll needs Polls open.');
  const nowhere = splitTicked([{ kind: 'task', target: null }, { kind: 'poll', target: null }]);
  assert.equal(leftOutWords(nowhere), "2 can't be kept here.");
  assert.equal(leftOutWords(splitTicked([row(poll, true)])), '1 poll opens a form in Polls: use its own Keep.');
  // In the page: the left-out words go in the confirm, or alone in the note when nothing goes.
  assert.match(chat, /const leftOut = leftOutWords\(split, objectWords\(\)\);/);
  assert.match(chat, /if \(!split\.going\.length\) \{ setNote\(/);
  // The confirm's count of what can't be kept is no longer filtered away: ticked() keeps rows with nowhere to go.
  assert.match(chat, /const ticked = \(\) => rows\.filter\(\(r\) => r\.box\.checked && !r\.view\.isKept\(\)\);/);
});

test('Keep: once at a time, a kept button stays off, a form is "Opened in", and the names follow the words', () => {
  const draw = fnBody(chat.replace(/^  /gm, ''), 'function drawObject(');
  assert.match(draw, /if \(state \|\| !t\) return null;\n\s*state = 'busy';\n\s*drawPlace\(\);/, 'does nothing while on its way');
  assert.match(draw, /if \(state\) keep\.setAttribute\('aria-disabled', 'true'\);/, 'busy, kept or waiting: focusable but inactive');
  assert.match(draw, /async function keepNow\(\) \{\n\s*if \(state\) return;/);
  assert.match(draw, /opened: \[`Opened in \$\{t\.moduleName\}`, `Opened in \$\{t\.moduleName\}`\]/);
  assert.match(draw, /kept: o\.result === 'sent' \? \['Sent', `Sent to \$\{t\.moduleName\}`\] : \['Kept', `Kept in \$\{t\.moduleName\}`\],\n\s*queued: o\.result === 'adding' \? \['Adding', `\$\{t\.moduleName\} is adding it`\] : \['Waiting', `Waiting for \$\{t\.moduleName\}`\],/);
  assert.match(draw, /if \(o\.result === 'starting'\) return; \/\/ still 'busy'/, 'a form still opening keeps the row busy');
  assert.match(draw, /const onLate = \(late\) => \{ settle\(t, late\); setNote\(late\.text\); \};/);
  assert.match(draw, /keep\.setAttribute\('aria-label', words\[1\]\);/);
  assert.match(draw, /if \(!state\) keep\.setAttribute\('aria-label', opened \? `Opened in \$\{opened\}` : `Keep in \$\{t\.moduleName\}`\);/, 'the name follows "Opened in" after a redraw');
  assert.match(draw, /btn\.setAttribute\('aria-label', `Keep in \$\{t\.moduleName\}: choose another place`\);/);
  assert.ok(!/Kept in \$\{t\.moduleName\}\. Choose where/.test(chat));
  // Focus after a pick: the new place button, in an AI answer too.
  assert.match(draw, /refocus\(\);\n\s*if \(pick === 'send'\) \{ await keepNow\(\); refocus\(\); \}/, 'focus back after the send redraws');
  assert.match(draw, /function refocus\(\) \{\n\s*\(where\.querySelector\('button'\) \|\| keep\)\.focus\(\);/);
  // The day's words never tick or untick the row; a day is asked only where some place could keep it.
  assert.match(draw, /dayRow\.addEventListener\('click', \(e\) => \{\n\s*if \(e\.target === dayInput\) return;\n\s*e\.preventDefault\(\);/);
  assert.match(draw, /dayRow\.hidden = !couldKeep;/);
});

// --- Object handoff, step 8, last QA round --------------------------------------------------------------------------------

test('the preview places objects from the modules on now: an import refreshes first, an AI answer fixes its place from a refresh', () => {
  const show = fnBody(chat.replace(/^  /gm, ''), 'async function showImport(');
  assert.ok(show.indexOf('await refreshActions();') > -1 && show.indexOf('await refreshActions();') < show.indexOf('drawObject('), 'refreshed before the first row is drawn');
  assert.match(chat, /return await showImport\(await postCheck\(input, .text\/plain.\)\);/);
  assert.match(chat, /const view = drawObject\(summary, question, \{ fresh: false \}\);\n\s*soonRefresh\(\);/, 'an AI answer asks for a fresh list');
  assert.match(chat, /if \(v\.el\.isConnected\) \{ v\.seen = true; v\.fresh = true; v\.redraw\(\); \}/);
  assert.match(fnBody(chat.replace(/^  /gm, ''), 'function drawObject('), /if \(view\.fresh\) chosen = settled\.chosen;/, 'a place is fixed only from a fresh list');
});

test('a kept row: its place is plain words, its day is off, and nothing it shows can change', () => {
  const draw = fnBody(chat.replace(/^  /gm, ''), 'function drawObject(');
  assert.match(draw, /if \(!done\(\)\) \{\n\s*targets = keepTargets\(/, 'a kept row is not redrawn with new places');
  assert.match(draw, /if \(targets\.length < 2 \|\| done\(\)\) \{\n\s*where\.textContent = `in \$\{t\.moduleName\}`;/, 'no menu once kept');
  assert.match(draw, /dayInput\.disabled = done\(\);/);
  assert.match(draw, /onPick: async \(\) => \{\n\s*if \(state\) return;/, 'a menu left open does nothing once kept');
  assert.match(draw, /if \(opened\) \{ opened = ''; keep\.textContent = 'Keep'; \}/, '"Opened in" until another place is chosen');
  assert.match(css, /\.message \.chat-object-keep\.kept\[aria-disabled="true"\],\n\.message \.chat-object-keep\.queued\[aria-disabled="true"\] \{\n\s*opacity: 1;/);
});

test('Keep ticked: a moved row is reported however long ago it moved, and the count is what would go', () => {
  const show = fnBody(chat.replace(/^  /gm, ''), 'async function showImport(');
  assert.ok(!/for \(const r of rows\) r\.view\.moved = false;/.test(show), 'the moved marks are not cleared before the refresh');
  assert.match(show, /const movedRows = ticked\(\)\.filter\(\(r\) => r\.view\.moved\);\n\s*const moved = movedRows\.length;\n\s*for \(const r of movedRows\) r\.view\.moved = false;/, 'cleared once reported');
  assert.match(show, /keepTicked\.textContent = `Keep ticked \(\$\{splitTicked\(ticked\(\)\.map\(pickOf\)\)\.going\.length\}\)`;/);
  // Two polls with Polls open and one flight: the button says 1.
  const all = bundledActions(['research', 'travel', 'todo', 'calendar', 'polls']);
  const r = (obj, open) => ({ kind: obj.kind, target: keepTargets(all, obj)[0], open });
  const poll = { title: 'P', kind: 'poll', details: { options: ['A', 'B'] } };
  assert.equal(splitTicked([r(poll, true), r(poll, false), r({ title: 'F', kind: 'flight' })]).going.length, 1);
});

test('the default place for an object no module names: never a form, the note keeper first, in either install order', () => {
  for (const order of [['travel', 'research', 'todo', 'calendar', 'polls'], ['polls', 'calendar', 'todo', 'research', 'travel']]) {
    const all = bundledActions(order, { needs: true });
    assert.equal(keepTargets(all, { title: 'X', content: 'words' })[0].id, 'research:saveNote', `no kind, ${order.join()}`);
    assert.equal(keepTargets(all, { title: 'L', kind: 'link' })[0].id, 'research:saveNote', `a link with no address, ${order.join()}`);
    assert.equal(keepTargets(all, { title: 'X', date: '2026-11-14' })[0].id, 'research:saveNote', 'a dated object with no kind');
    assert.equal(keepTargets(all, { title: 'X' }).at(-1).id, 'polls:draftPoll', 'the poll form last for words with no kind');
    assert.equal(keepTargets(all, { title: 'P', kind: 'poll' })[0].id, 'polls:draftPoll', 'it names a poll: first');
    // Without Research: To-do and the Calendar each name one kind, so the server's order decides; never the poll form.
    const noResearch = bundledActions(order.filter((m) => m !== 'research'), { needs: true });
    assert.equal(keepTargets(noResearch, { title: 'X', date: '2026-11-14' })[0].id, order.indexOf('todo') < order.indexOf('calendar') ? 'todo:createTask' : 'calendar:createEvent', order.join());
    assert.notEqual(keepTargets(noResearch, { title: 'X' })[0].id, 'polls:draftPoll', order.join());
  }
  assert.equal(placeRank({ named: false, local: true }), 4);
  assert.equal(placeRank({ named: true, local: true }), 0);
  assert.equal(placeRank({ legacy: true, typed: true }), 1);
});

// --- Object handoff, step 9: Send to... ----------------------------------------------------------------------------------

const NOW = new Date(2026, 9, 4, 12, 0); // a Sunday
const plainOf = (() => {
  const win = { addEventListener() {}, location: { search: '' } };
  win.parent = win;
  new Function('window', 'document', read('public/sdk/host.js'))(win, { createElement: (tag) => ({ tag }) });
  return win.hostText.plain;
})();
const objectsOf = (entry) => messageObjects(entry, { plain: plainOf, now: NOW });
const sendLabels = (actions, entry, o) => sendChoices(actions, objectsOf(entry), o).map((c) => c.label);

test('Send to...: a day in a chat message is read strictly, so ordinary words never become days (QA)', () => {
  for (const t of ['The sun is hot', 'I sat down', 'Wed like pizza', 'mon ami', 'version 1/2', 'paid 12/10', '> on friday\nnothing here', 'a 3/4 cup', 'at 7pm', 'Thu is a word too', 'may I come', 'sep 31']) {
    assert.equal(chatDay(t, NOW), '', t);
  }
  const days = {
    'Buy milk on Friday': '2026-10-09', 'see you sunday': '2026-10-11', 'this sunday': '2026-10-04', 'dinner on sat': '2026-10-10',
    'next fri': '2026-10-16', 'nov 14': '2026-11-14', '14 November': '2026-11-14', 'Nov. 14th, 2027': '2027-11-14', 'march 3rd': '2027-03-03',
    'on 12/10': '2026-12-10', '12/10 at 7pm': '2026-12-10', '12/10 19:00': '2026-12-10', 'Ski on 2027-06-01': '2027-06-01', 'tomorrow lunch': '2026-10-05',
  };
  for (const [t, d] of Object.entries(days)) assert.equal(chatDay(t, NOW), d, t);
  assert.ok(!/parseWhen/.test(fnBody(chat, 'export function messageObjects(')), 'not the SDK\'s field reader');
  assert.ok(!/parseWhen/.test(read('public/sdk/host.js').slice(read('public/sdk/host.js').indexOf('global.hostText ='), read('public/sdk/host.js').indexOf('global.hostText =') + 120)), 'host.util.parseWhen unchanged, not on hostText');
  for (const t of ['The sun is hot', 'I sat down', 'paid 12/10']) {
    const all = bundledActions(['research', 'travel', 'todo', 'calendar', 'polls'], { needs: true });
    assert.ok(!sendLabels(all, { chat: true, text: t }).some((l) => /Calendar|Planner/.test(l)), `${t}: no Calendar, no Planner`);
  }
});

test('Send to...: what a message is (a picture, a link, words with a day, an AI answer\'s objects, a command\'s words)', () => {
  const pic = objectsOf({ chat: true, picture: true, name: 'beach.gif' });
  assert.deepEqual(pic, [{ what: 'picture', objects: [{ kind: 'image', title: 'beach.gif', details: { name: 'beach.gif' } }] }]);
  const text = objectsOf({ chat: true, text: '> Pat: earlier\nBook the **ferry** on oct 12\nsecond line' });
  assert.equal(text.length, 2);
  assert.deepEqual(text[0].objects[0], { title: 'Book the ferry on oct 12', content: '> Pat: earlier\nBook the **ferry** on oct 12\nsecond line', date: '2026-10-12' }, 'the first line not quoted, as plain text; the whole text; the day found');
  assert.deepEqual({ what: text[1].what, named: text[1].named, kind: text[1].objects[0].kind }, { what: 'text', named: true, kind: 'event' }, 'with a day it may also go as an event');
  assert.equal(objectsOf({ chat: true, text: 'just words' }).length, 1, 'no day: words only');
  const link = objectsOf({ chat: true, text: 'Look https://a.example/hotel', preview: { url: 'https://a.example/hotel', at: 1, title: 'The Hotel', description: 'Ocean view' } });
  assert.equal(link[0].what, 'link');
  assert.deepEqual(link[0].objects[0], { kind: 'link', title: 'The Hotel', content: 'Ocean view', links: [{ title: 'The Hotel', url: 'https://a.example/hotel' }] });
  assert.deepEqual(link[1].objects[0].links, [{ title: 'The Hotel', url: 'https://a.example/hotel' }], 'the words carry the link too');
  assert.equal(objectsOf({ chat: true, text: 'no preview https://b.example/x' })[0].objects[0].links[0].url, 'https://b.example/x', 'the link by the server\'s rule');
  const ai = objectsOf({ chat: true, kind: 'ai', text: 'Here {{summary:0}}', summaries: [{ title: 'F', kind: 'flight' }, { title: 'S', kind: 'hotel' }] });
  assert.deepEqual(ai, [{ what: 'objects', objects: [{ title: 'F', kind: 'flight' }, { title: 'S', kind: 'hotel' }] }]);
  assert.equal(objectsOf({ chat: true, kind: 'ai', text: 'Plain answer {{summary:0}}' })[0].objects[0].content, 'Plain answer', 'an answer without objects is its words');
  assert.equal(objectsOf({ chat: true, kind: 'command', command: 'ai', text: 'where to eat' })[0].objects[0].title, 'where to eat', 'a command echo is the words after it');
  assert.deepEqual(objectsOf({ chat: true, text: '   ' }), []);
});

test('Send to...: only the places that can take it, labelled "<module> as <what>", a form last and one at a time', () => {
  const all = bundledActions(['research', 'travel', 'todo', 'calendar', 'polls'], { needs: true });
  assert.deepEqual(sendLabels(all, { chat: true, picture: true, name: 'p.png' }), ['Research as an image'], 'a picture goes to Research as an image');
  assert.deepEqual(sendLabels(all, { chat: true, text: 'buy sunscreen' }), ['Research as a note', 'To-do as a task', 'Polls as a poll'], 'no day: no Calendar, no Planner');
  assert.deepEqual(sendLabels(all, { chat: true, text: 'dinner at Rosa oct 12' }), ['Research as a note', 'To-do as a task', 'Calendar as an event', 'Planner as an event', 'Polls as a poll'], 'with a day: the Calendar, and the Planner as an event');
  assert.deepEqual(sendLabels(all, { chat: true, text: 'see https://a.example/x', preview: { url: 'https://a.example/x' } }).slice(0, 2), ['Research as a link', 'Research as a note'], 'a link first, then the words');
  const flights = { chat: true, kind: 'ai', text: '', summaries: [{ title: 'F1', kind: 'flight' }, { title: 'F2', kind: 'flight' }, { title: 'S', kind: 'hotel' }, { title: 'T', kind: 'task' }] };
  const many = sendChoices(all, objectsOf(flights), { one: 'object', many: 'objects' });
  assert.equal(many[0].label, 'Planner (3)');
  assert.equal(many[0].hint, '2 flights, 1 stay; 1 left out');
  assert.equal(many[0].sends.length, 3);
  assert.ok(many.some((c) => c.label === 'To-do (4)'), 'To-do takes any object');
  assert.ok(!many.some((c) => /Calendar/.test(c.label)), 'undated: no Calendar');
  // Two polls: a form opens one object at a time, so the entry opens the first and says so.
  const polls = sendChoices(all, objectsOf({ chat: true, kind: 'ai', text: '', summaries: [{ title: 'A?', kind: 'poll' }, { title: 'B?', kind: 'poll' }] }));
  const form = polls.find((c) => c.module === 'polls');
  assert.deepEqual([form.label, form.hint, form.sends.length, form.more], ['Polls as a poll', 'Opens the first of 2', 1, 1]);
  assert.equal(polls.at(-1).module, 'polls', 'forms last');
  const last = sendChoices(all, objectsOf({ chat: true, text: 'buy sunscreen' }), { last: 'todo:createTask' });
  assert.equal(last[0].id, 'todo:createTask');
  assert.equal(last[0].hint, 'Last used');
  assert.deepEqual(sendLabels(bundledActions(['polls'], { refuse: ['create'] }), { chat: true, text: 'x' }), [], 'without the permission: nothing, so no Send to...');
  assert.deepEqual(sendLabels(all.map((a) => ({ ...a, may: false })), { chat: true, text: 'x' }), []);
});

test('Send to...: words with a day go to To-do with that day as due; nothing else gets one', () => {
  const all = bundledActions(['research', 'todo', 'calendar'], { needs: true });
  const words = objectsOf({ chat: true, text: 'Buy milk on Friday' })[0].objects[0];
  const at = (id) => keepTargets(all, words).find((t) => t.id === id);
  assert.deepEqual(wordsExtra(at('todo:createTask'), words), { due: '2026-10-09' });
  assert.deepEqual(wordsExtra(at('research:saveNote'), words), {}, 'Research takes no due');
  assert.deepEqual(wordsExtra(at('todo:createTask'), { ...words, date: undefined }), {});
  assert.deepEqual(wordsExtra(at('todo:createTask'), { ...words, kind: 'task' }), {}, 'an object of a kind: the module maps it');
  const choice = chat.slice(chat.indexOf('async function sendChoice('), chat.indexOf('async function sendTo('));
  assert.match(choice, /requestKeep\(s\.summary, question, s\.target, plan\.what === 'objects' \? \{\} : wordsExtra\(s\.target, s\.summary\)\)/);
  assert.match(chat, /input: \{ \.\.\.keepTargetInput\(target, summary, question\), \.\.\.extra \}/);
});

test('Send to...: what Chat says once a request is known (the result route), alone and for several', () => {
  const p = { moduleName: 'Planner', as: 'a flight' };
  assert.deepEqual(requestOutcome({ status: 'done', ok: true, note: 'it is past the plan\'s 60 days, so it is under Not on a day yet' }, p), { result: 'kept', text: 'Added to Planner as a flight. It is past the plan\'s 60 days, so it is under Not on a day yet.', note: 'It is past the plan\'s 60 days, so it is under Not on a day yet.' });
  assert.deepEqual(requestOutcome({ status: 'done', ok: false, error: 'that needs a day to go on the calendar' }, { moduleName: 'Calendar' }), { result: 'failed', text: 'Calendar couldn\'t add that: that needs a day to go on the calendar.', error: 'that needs a day to go on the calendar' });
  assert.equal(requestOutcome({ status: 'done', ok: false }, { moduleName: 'Calendar' }).text, 'Calendar couldn\'t add that.');
  assert.deepEqual(requestOutcome({ status: 'pending' }, p), { result: 'queued', text: 'Waiting: it is added when Planner is next open.' });
  assert.deepEqual(requestOutcome({ status: 'claimed' }, p), { result: 'adding', text: 'Planner is adding it.' }, 'a page has it: not "next open"');
  assert.deepEqual(requestOutcome({ status: 'pending' }, { moduleName: 'Polls', local: true }), { result: 'starting', text: 'Waiting for Polls to open it.' }, 'a form not opened yet is still followed');
  assert.deepEqual(requestOutcome({ status: 'expired' }, { moduleName: 'Polls', local: true }), { result: 'closed', text: 'Polls isn\'t open.' });
  assert.equal(requestOutcome({ status: 'claimed' }, { moduleName: 'Polls', local: true }).result, 'opened');
  assert.equal(requestOutcome({ status: 'done', ok: true }, { moduleName: 'Polls', local: true }).text, 'Opened in Polls.');
  assert.equal(requestOutcome(null, p).text, 'Sent to Planner.', 'a guest, or a result that could not be read');
  const o = (status, extra) => ({ ...requestOutcome(status, p), moduleName: 'Planner', ...extra });
  assert.equal(outcomesWords([o({ status: 'done', ok: true }), o({ status: 'done', ok: true }), o({ status: 'pending' })], { moduleName: 'Planner' }), 'Added 2 to Planner. 1 waiting: it is added when Planner is next open.');
  assert.equal(outcomesWords([o({ status: 'done', ok: true })]), 'Added to Planner as a flight.', 'one: its own words');
  // Opened forms are counted (QA): two opened, and opened beside closed.
  const f = (status) => ({ ...requestOutcome(status, { moduleName: 'Polls', local: true }), moduleName: 'Polls' });
  assert.equal(outcomesWords([f({ status: 'done', ok: true }), f({ status: 'done', ok: true })]), 'Opened 2 in Polls.');
  assert.equal(outcomesWords([f({ status: 'done', ok: true }), f({ status: 'expired' })]), 'Opened in Polls. Polls isn\'t open.');
  assert.equal(outcomesWords([o({ status: 'claimed' }), o({ status: 'claimed' })]), 'Planner is adding 2.');
  assert.ok(outcomesWords([o({ status: 'done', ok: true }), f({ status: 'pending' })]).endsWith('Waiting for Polls to open it.'));
});

test('A picture someone sent: fetched from its url (never base64 on the stream), a plain line once it is gone', () => {
  const entry = fnBody(space, 'function pictureEntry(');
  assert.ok(!/atob|data\.data/.test(entry), 'no bytes read from the live stream');
  assert.match(entry, /`\/api\/spaces\/\$\{encodeURIComponent\(data\.space\)\}\/chat\/pictures\/\$\{data\.id\}\$\{q\}`/, 'its url, the page builds it from the space and id');
  assert.match(entry, /guest: guestToken, pass: guestPass/, "a guest's fetch carries their link and pass");
  assert.match(space, /const PICTURE_GONE = 'Picture no longer available\.';/);
  const el = fnBody(space, 'function messageEl(');
  assert.match(el, /img\.addEventListener\('error', \(\) => \{[^}]*gone\.textContent = PICTURE_GONE;/, 'a picture that no longer loads says so');
  const blob = fnBody(space, 'async function pictureBlob(');
  assert.match(blob, /if \(!res\.ok\) return null;/, 'copy and Send to fetch it, and know when it is gone');
  assert.match(chat, /let blob = await pictureBlob\(entry\);/, 'Send to... reads a fetched picture too');
});

test('Send to...: the menu entry, a picture uploaded first and taken back off when refused, plain errors', () => {
  const frame = fnBody(space, 'function frameMessage(');
  assert.ok(!/label: 'Send to\.\.\.', onPick: \(\) => \{\}/.test(frame), 'no empty entry');
  assert.match(frame, /if \(entry\?\.chat && chatInput\.canSendTo\(entry\)\) items\.push\(\{ icon: 'share', label: 'Send to\.\.\.', onPick: \(\) => chatInput\.sendTo\(entry, more\) \}\);/);
  const body = chat.slice(chat.indexOf('async function sendPicture('), chat.indexOf('async function sendChoice('));
  assert.match(body, /api\('POST', `\/api\/modules\/\$\{encodeURIComponent\(target\.module\)\}\/uploads\?\$\{where\}`, blob, blob\.type\)/);
  assert.match(body, /new URLSearchParams\(\{ scope: 'space', space: id, name \}\)/);
  assert.match(body, /requestKeep\(\{ kind: 'image', title: name, details: \{ upload: fileId, name \} \}, '', target\)/, 'the bytes never go on the bus: the file\'s id does');
  assert.match(body, /if \(!\/\^image\\\/\(jpeg\|png\|webp\)\$\/\.test\(blob\.type\)\)/, 'a GIF is redrawn as a JPEG first');
  assert.match(body, /if \(pictureRefused\(outcome\)\) drop\(\);/, 'refused: the upload goes');
  assert.match(body, /const sorry = `That picture can't be sent to \$\{target\.moduleName\}\.`;/);
  assert.ok(!/err\.message/.test(body), 'no raw error from the upload in the note');
  assert.ok(pictureRefused({ result: 'failed', error: 'that picture is not here any more' }));
  assert.ok(!pictureRefused({ result: 'failed', error: 'that picture is already a photo here' }), 'already a photo: it is in use');
  assert.ok(!pictureRefused({ result: 'kept' }) && !pictureRefused({ result: 'queued' }));
  assert.match(chat, /return \{ error: sentence\(err\.message\) \|\| 'Could not keep that\.' \};/, 'a refusal reads as a sentence');
  const choice = chat.slice(chat.indexOf('async function sendChoice('), chat.indexOf('async function sendTo('));
  assert.match(choice, /const out = await keepStoredLink\(entry\);/, 'a message\'s own link goes through its Keep ("Kept by")');
  assert.match(choice, /if \(choice\.local && !canvas\.isOpen\(choice\.module\)\) \{ setNote\(`\$\{choice\.moduleName\} isn't open\.`\); return; \}/, 'a closed form is never queued');
  assert.match(choice, /The other \$\{choice\.more\}: use each one's own Keep\./);
  assert.match(choice, /choice\.more === 1 \? ' The other one: use its own Keep\.'/);
  assert.match(space, /isGuest: \(\) => !me\?\.key \|\| me\.role === 'guest' \|\| Boolean\(guestToken\),/);
});

test('Send to...: the private warning is on each entry\'s hint, and Chat\'s note is read out (QA)', () => {
  const to = chat.slice(chat.indexOf('async function sendTo('), chat.indexOf('canSendTo: (entry) =>'));
  assert.ok(!/disabled: true/.test(to), 'no row the keyboard skips');
  assert.match(to, /const seen = entry\.visibility === 'private' \? `Everyone in this \$\{word\('space'\)\} will see it` : '';/);
  assert.match(to, /hint: \[closed \? `Open \$\{c\.moduleName\} first` : c\.hint, seen\]\.filter\(Boolean\)\.join\('; '\),/);
  assert.match(read('public/space.html'), /<span class="mf-status-item" id="chat-note-item"><span id="chat-note" role="status" aria-live="polite"><\/span><\/span>/);
  const set = fnBody(chat.replace(/^  /gm, ''), 'function setNote(');
  assert.match(set, /el\.textContent = text \|\| '';/, 'the status area is always there: only its words change');
});

test('the Assistant\'s empty line cannot start a loop: its words are set only when they differ, and its own changes are ignored (page hang on /t)', () => {
  const sync = fnBody(chat.replace(/^  /gm, ''), 'function syncEmpty(');
  assert.match(sync, /if \(line\.textContent !== text\) line\.textContent = text;/, 'setting the same words again replaces the text node, which the observer sees, for ever');
  assert.ok(!/^\s*line\.textContent = text;/m.test(sync), 'no unconditional write of the line\'s words');
  assert.match(chat, /r\.type === 'childList' && \(own\(r\.target\) \|\| \[\.\.\.r\.addedNodes, \.\.\.r\.removedNodes\]\.every\(own\)\)/, 'the observer skips the empty line\'s own changes, a text node in it included');
});

console.log(`check-chat-page: OK (${n} tests)`);


// --- GitHub #340 and #330: the composer and the status area -------------------------------------------------------------
test('the composer: no Send button, Enter sends, Shift+Enter makes a new line, a phone keyboard\'s Enter sends', () => {
  const html = read('public/space.html');
  const form = /<form id="chat-form">[\s\S]*?<\/form>/.exec(html)[0];
  assert.ok(!/<button|type="submit"/.test(form), 'no Send button in the form');
  assert.match(form, /<textarea id="chat-input"[^>]*enterkeyhint="send"/, 'the phone keyboard says Send');
  const keys = space.slice(space.indexOf('// Enter sends, as in any chat'), space.indexOf('// Grows with the text'));
  assert.match(keys, /if \(event\.key !== 'Enter' \|\| event\.shiftKey \|\| event\.isComposing\) return;\n\s*event\.preventDefault\(\);\n\s*\$\('chat-form'\)\.requestSubmit\(\);/, 'Enter sends, Shift+Enter is left to make a line');
  assert.match(keys, /beforeinput[\s\S]*insertLineBreak[\s\S]*chatShift[\s\S]*requestSubmit/, 'a line break asked for without Shift (a phone keyboard) sends');
});

test('commands: the short name is the first letter of the full word; either runs the same command; the menu shows both', () => {
  const list = [{ name: 'e', word: 'event' }, { name: 'p', word: 'poll' }, { name: 'n', word: 'note' }, { name: 'l', word: 'link' }, { name: 't', word: 'todo' }, { name: 'x' }];
  assert.equal(commandName('todo', list), 't', '/todo runs the to-do command');
  assert.equal(commandName('t', list), 't', 'and so does /t');
  assert.equal(commandName('poll', list), 'p');
  assert.equal(commandName('p', list), 'p');
  assert.equal(commandName('event', list), 'e');
  assert.equal(commandName('task', list), 'task', 'the old word is no command');
  assert.equal(commandName('x', list), 'x', 'a module with no word still works by its short name');
  assert.equal(commandName('nonsense'), 'nonsense');
  assert.equal(commandForms('t', 'todo'), '/t or /todo');
  assert.equal(commandForms('xyz'), '/xyz');
  assert.ok(!/COMMAND_WORDS/.test(chat), 'no client list of words: the manifest has them');
  assert.match(chat, /name: commandName\(m\[1\], commandList\(\)\)/, 'typing either runs it');
  assert.match(chat, /const forms = commandForms\(name, group\[0\]\.word\);/, 'the menu row shows both');
  assert.ok(!/name: 'ai'/.test(fnBody(chat.replace(/^ {2}/gm, ''), 'function commandList() {')), '/ai is not a command any more');
  const found = {};
  for (const dir of fs.readdirSync(path.join(ROOT, 'modules'))) {
    const mf = path.join(ROOT, 'modules', dir, 'module.json');
    if (!fs.existsSync(mf)) continue;
    for (const c of JSON.parse(fs.readFileSync(mf, 'utf8')).commands || []) {
      assert.ok(c.word, `${dir}: /${c.name} has a full word`);
      assert.equal(c.word[0], c.name, `${dir}: /${c.name} is the first letter of /${c.word}`);
      found[c.name] = [c.word, dir, c.label];
    }
  }
  assert.deepEqual(found, { e: ['event', 'calendar', 'Add an event'], p: ['poll', 'polls', 'Start a poll'], n: ['note', 'research', 'Add a research note'], l: ['link', 'research', 'Add a research link'], t: ['todo', 'todo', 'Add a to-do'] }, 'the five commands, and no /trip');
  assert.ok(!JSON.stringify(JSON.parse(read('modules/travel/module.json')).commands || []).includes('"p"'), 'the Planner has no command');
});

test('the Assistant\'s one box: a command runs, an import answer is imported, other words ask the AI', () => {
  const json = '{"format":"objects","formatVersion":1,"objects":[{"kind":"task","title":"Book the hotel"}]}';
  assert.equal(routeLine(json, 'assistant').run, 'import', 'pasted import JSON is an import');
  assert.equal(routeLine('[{"title":"Book","kind":"task"}]', 'assistant').run, 'import', 'a list too');
  assert.equal(routeLine('```objects\n[{"title":"x"}]\n```', 'assistant').run, 'import', 'a fenced block too');
  assert.equal(routeLine('/t buy milk', 'assistant').run, 'command', 'a command is not sent to the AI');
  assert.equal(routeLine('/todo buy milk', 'assistant').run, 'command');
  assert.equal(routeLine('Where should we eat in Rome?', 'assistant').run, 'ai', 'other words go to the AI');
  assert.equal(routeLine('{not json at all', 'assistant').run, 'ai');
  assert.equal(routeLine('hello {"a": 1}', 'assistant').run, 'ai', 'JSON that is not our template is words');
  assert.equal(routeLine(json, 'discussion').run, 'message', 'in the Discussion it is a message');
  assert.equal(looksLikeImport(''), false);
});

test('the composer: the Discussion has no paste box; the Assistant has no formatting tools but copy prompt and bring in research', () => {
  const html = read('public/space.html');
  for (const gone of ['chat-import-text', 'chat-import-show', 'Paste the whole answer here', 'id="chat-import"']) assert.ok(!html.includes(gone), `${gone} is gone`);
  const tag = (id) => new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`).exec(html)?.[0] || '';
  for (const id of ['chat-pic', 'chat-bold', 'chat-italic', 'chat-code', 'chat-list']) assert.match(tag(id), /data-for="discussion"/, `${id} is the Discussion's`);
  assert.match(html, /data-for="discussion">\s*<button class="sdk-icon-btn btn-quiet btn-small" id="chat-emoji"/);
  assert.match(html, /data-for="discussion">\s*<button class="sdk-icon-btn btn-quiet btn-small" id="chat-help"/, 'formatting help is the Discussion\'s');
  assert.match(tag('chat-import-copy'), /data-for="assistant"[^>]*data-tip="Copy prompt"/);
  assert.match(tag('chat-bring'), /data-for="assistant"[^>]*data-tip="Bring in research"/);
  assert.ok(!/data-for/.test(tag('chat-command')), 'the commands button is in both');
  const paint = fnBody(chat.replace(/^ {2}/gm, ''), 'function paintModeTools() {');
  assert.match(paint, /const off = mine \? !\(assistant && importOk\) : assistant;/, 'in the Assistant the formatting tools go; its two tools show where objects can be kept');
  assert.match(css, /\.chat\[data-view="assistant"\] #chat-input \{\n\s*min-height: calc\(var\(--composer-lines\) \* var\(--composer-lh\)/, 'five lines tall');
  assert.match(chatBlock, /--composer-lines: 5;/, 'five lines of the composer\'s line');
  assert.match(chat, /if \(\$\('chat'\)\) \$\('chat'\)\.dataset\.view = view;/);
  assert.ok(!/offerImport|pendingImport/.test(chat), 'a long paste no longer offers a button');
});

test('the status area: the module frame\'s status bar under the composer, always there, announced politely', () => {
  const html = read('public/space.html');
  const bar = /<div class="mod-bar chat-bar" id="chat-bar">[\s\S]*?<\/aside>/.exec(html)[0];
  assert.match(bar, /<div class="mf-status chat-status" id="chat-status" role="region" aria-label="Chat status">/, 'the frame\'s status bar look; not hidden, so nothing jumps');
  assert.ok(bar.indexOf('id="chat-form"') < bar.indexOf('id="chat-status"'), 'under the composer');
  assert.match(bar, /id="chat-conn" aria-live="polite"/, 'the connection is announced');
  assert.match(bar, /id="chat-note" role="status" aria-live="polite"/, 'a notice is announced');
  assert.ok(!/id="chat-status"[^>]*hidden/.test(bar));
  const conn = fnBody(space, 'function chatConnState() {');
  for (const state of ["'paused'", "'reconnecting'", "'call'", "'idle'"]) assert.ok(conn.includes(state), `${state} is a state`);
  const look = fnBody(space, 'function paintChatConn() {');
  assert.ok(look.includes("'In a call'"), 'in a call shows In a call');
  assert.match(look, /idle: \['', '', ''\]/, 'out of a call the left is empty');
  assert.ok(look.includes('Reconnecting… messages may be late'), 'reconnecting says what it means');
  assert.ok(look.includes('Paused. Reload to see new messages'), 'paused says the fix');
  assert.ok(look.includes('Live updates are paused. Reload the page to try again.'), 'the plan\'s words for a refusal');
  assert.ok(!/\bNot live\b|'Live'|Live'/.test(look + conn + bar), 'no Live or Not live');
  assert.ok(!/arrive as they are sent|New messages show when you load/.test(look + bar), 'the old tooltips are gone');
  assert.match(bar, /id="chat-conn-time" aria-hidden="true"/, 'the ticking time is not announced');
  assert.match(fnBody(space, 'function showCallTime() {'), /paintChatConn\(\);/, 'the time repaints with the call bar');
  assert.match(fnBody(space, 'function paintChatTime() {'), /callTime\(seconds\)/, 'the same time as the call bar');
  // The call finding its way back is the call's (its own status), never the chat's: the chat is on the live stream.
  assert.match(space, /RoomEvent\.Reconnecting, \(\) => setStatus\('reconnecting the call\.\.\.'\)\)/);
  assert.match(conn, /if \(chatStream === 'reconnecting'\) return 'reconnecting';/, 'reconnecting is the live stream\'s');
  assert.match(conn, /if \(inCall && call\.state === 'connected'\) return 'call';/, 'In a call only while on the call');
  const note = fnBody(chat.replace(/^ {2}/gm, ''), 'function setNote(');
  assert.match(note, /el\.classList\.toggle\('error', Boolean\(text\) && error\);/, 'an error shows in the error colour');
  assert.match(fnBody(space, 'function chatNotice(text, error = false) {'), /chatNoteFn\(text, error\);/);
  const sendText = fnBody(space, 'async function sendChatText(text) {');
  assert.match(sendText, /chatNotice\(err\.serverSaid \? `Not sent: \$\{err\.message\}` : 'Not sent\. Try again\.', true\);/, 'a failed send says so in the status area');
  assert.ok(!/sendChatMessage|publish/.test(sendText), 'and is not sent some other way');
  assert.ok(!/chat-clear-note/.test(space), 'a clear is told in the status area, not as a line in the list');
  assert.match(css, /\.chat-status \.error \{\n\s*color: var\(--danger-text\);/);
});

test('the composer hint: plain defaults for Chat and the Assistant, back to them after a send, a cancel or a switch of view (#346)', () => {
  assert.ok(chat.includes("const HINTS = ['Send a message or type / for commands', 'Send a message, or / for commands', 'Send a message'];"), 'Chat\'s hint, then its shorter ones');
  assert.ok(chat.includes("const ASK_HINTS = ['Instruct the Assistant or type / for commands', 'Instruct the Assistant, or / for commands', 'Instruct the Assistant'];"), 'the Assistant\'s hint, then its shorter ones');
  assert.match(read('public/space.html'), /<textarea id="chat-input"[^>]*placeholder="Send a message or type \/ for commands"/, 'the page starts with Chat\'s');
  assert.ok(!/something on the trip|Chat or type|Ask the AI, paste/.test(chat + read('public/space.html') + read('modules/travel/module.json')), 'the odd and old hints are gone');
  assert.match(fnBody(chat.replace(/^ {2}/gm, ''), 'function resetHint() {'), /!parseCommand\(el\.value \|\| ''\)\) el\.placeholder = defaultHint\(\)/, 'a command being typed keeps its example, anything else gets the view\'s hint');
  assert.match(fnBody(chat.replace(/^ {2}/gm, ''), 'function setView('), /resetHint\(\);/, 'switching view resets the hint, even over a command\'s example');
  const submit = read('public/space.js').slice(read('public/space.js').indexOf("$('chat-form').addEventListener('submit'"));
  const body = submit.slice(0, submit.indexOf("// Enter sends"));
  assert.equal(body.split('chatInput.resetHint();').length - 1, 3, 'an import, a command or ask and a message each reset the hint once the box is emptied');
  assert.ok(chat.includes("input().value = ''; resizeChatInput(); resetHint(); }"), 'a command sent from the "not open" box does too');
  for (const m of fs.readdirSync(path.join(ROOT, 'modules'))) {
    const mf = path.join(ROOT, 'modules', m, 'module.json');
    if (!fs.existsSync(mf)) continue;
    for (const c of JSON.parse(fs.readFileSync(mf, 'utf8')).commands || []) assert.ok(!c.hint || /^(the|what) /.test(c.hint), `${m} /${c.name}: a command's example names what to type`);
  }
});
