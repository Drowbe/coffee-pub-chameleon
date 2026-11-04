#!/usr/bin/env node
/*
 * check-ai-page.mjs -- Chat's AI as a person meets it, run in a headless browser against a throwaway server whose AI
 * service is a stand-in on a local port (no network). From the AI audit (ai-01, 09, 10, 11, 20, 23):
 *   - /ai <question> typed in the Discussion asks the AI and the answer shows (it was refused as "No command /ai");
 *   - an object dropped on Chat shows as a chip, goes with one question only, and a chip can be taken off;
 *   - a second Enter while a question is out sends nothing more;
 *   - with the AI not set up the Assistant says so before anything is typed, offers no question, and sends nothing;
 *   - a guest is not invited to ask and sends nothing;
 *   - Research's standalone page does not offer "Research this".
 * AI integration slice 1, the pages half:
 *   - under an answer, the AI used: line (the attached object as a link with its title, the counts), a citation [1] that
 *     links to the object it names, the Not sent line when the owner's setting kept it out, and The answer was cut short.;
 *   - every ask sends the browser's time zone; a question over 1,000 characters is refused in the box with the count;
 *   - the notices for the reasons chat, member and module say the server's sentence;
 *   - Manage's AI service tab: the What AI may see rows (saved and reset through /api/ai) and this month's use;
 *   - a space's Set up: What AI may see follows the environment until its switch is turned off, then saves for the space only.
 *
 *   node tools/check-ai-page.mjs        (no Chromium: SKIPPED, exit 0; that is a skip, never a pass)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { aiNotice, questionTooLong, askZone, aiUsedParts, citationParts, lookupOf } from '../public/chat-input.js';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-ai-page:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };

const seen = [];
let scripted = null;
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', async () => {
    let j = {};
    try { j = JSON.parse(body); } catch { /* none */ }
    const user = (j.messages || []).filter((m) => m.role !== 'system').map((m) => m.content).join('\n');
    if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] })); }
    seen.push(user);
    if (/SLOWANSWER/.test(user)) await sleep(2500);
    res.setHeader('content-type', 'application/json');
    // A scripted answer, once: { answer, used, cut }, as the structured contract holds it.
    const script = scripted; scripted = null;
    const content = script ? JSON.stringify({ answer: script.answer, objects: [], used: script.used || [] }) : 'A plain stub answer.';
    // Offered the tools (the read tools and `answer`), a service answers a scripted answer by calling `answer`, as a real one does.
    const hasAnswerTool = Array.isArray(j.tools) && j.tools.some((x) => x && x.function && x.function.name === 'answer');
    const message = script && hasAnswerTool
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_stub', type: 'function', function: { name: 'answer', arguments: content } }] }
      : { role: 'assistant', content };
    res.end(JSON.stringify({ choices: [{ message, finish_reason: script && script.cut ? 'length' : message.tool_calls ? 'tool_calls' : 'stop' }], usage: { total_tokens: 10 } }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubPort = stub.address().port;

const NOTE = `document.getElementById('chat-note')?.textContent || ''`;
const bodies = (n) => `(() => window.__sent.slice(${n}).map((b) => JSON.parse(b)))()`;
const WATCH = `(() => { window.__sent = []; const of = window.fetch; window.fetch = function (u, o) { if (/\\/api\\/spaces\\/[^/]+\\/ai$/.test(String(u)) && o && o.method === 'POST') window.__sent.push(o.body); return of.apply(this, arguments); }; })()`;
const drop = (trip) => `(() => { const dt = new DataTransfer(); dt.setData('application/x-host-object', JSON.stringify({ module: 'research', kind: 'note', scope: 'space', space: '${trip}', id: 'n1' })); document.getElementById('chat').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`;
const chips = `document.querySelectorAll('#chat-ai-context .chat-ai-chip').length`;
const stateLine = `(() => { const e = document.getElementById('chat-ai-state'); return e && !e.hidden && e.getClientRects().length ? e.textContent : ''; })()`;
const answers = `[...document.querySelectorAll('#messages .message')].filter((m) => m.getClientRects().length && /plain stub answer/.test(m.textContent)).length`;

// AI_PAGE_SHOTS=<folder> keeps a picture at each new element; AI_PAGE_MODE=light and AI_PAGE_SIZE=390 look at the other cases.
const snap = async (t, name) => { if (process.env.AI_PAGE_SHOTS) fs.writeFileSync(path.join(process.env.AI_PAGE_SHOTS, `${name}.png`), Buffer.from((await t.cdp.send('Page.captureScreenshot', { format: 'png' }, t.sid)).data, 'base64')); };
const lastUsed = `(() => { const u = [...document.querySelectorAll('#messages .message-used')].pop(); return u ? u.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`;
const jsonPut = (S, cookie, url, method, body) => fetch(`${S.base}${url}`, { method, headers: { cookie, 'content-type': 'application/json', origin: S.base }, body: JSON.stringify(body) });

// Waits (up to 15 seconds) until the question that is out has been answered and drawn.
async function answered(t) {
  await sleep(300);
  for (let i = 0; i < 50; i += 1) {
    if (!(await t.eval(`document.getElementById('chat-input').hasAttribute('aria-busy')`)) && !/Asking/.test(await t.eval(NOTE))) break;
    await sleep(300);
  }
  await sleep(500);
}

// Pure helpers the page uses, run as code.
function unitChecks() {
  const said = "Your role can't chat in this trip, so it can't ask the AI there.";
  expect(aiNotice('chat', said) === said, 'reason chat does not say the server sentence');
  expect(aiNotice('member', 'You are not in this trip.') === 'You are not in this trip.', 'reason member does not say the server sentence');
  expect(aiNotice('module', "Your role can't do that in this module.") === "Your role can't do that in this module.", 'reason module does not say the server sentence');
  expect(aiNotice('chat', '') !== '' && aiNotice('member', '') !== '' && aiNotice('module', '') !== '', 'a new reason with no sentence says nothing');
  expect(questionTooLong('x'.repeat(1001)) === 'A question is at most 1,000 characters; this one is 1,001.', `the long-question sentence is "${questionTooLong('x'.repeat(1001))}"`);
  expect(questionTooLong('x'.repeat(1000)) === '' && questionTooLong('') === '', 'a question of 1,000 or fewer is refused');
  expect(/^[A-Za-z_]+\/[A-Za-z_+\-0-9/]+$|^UTC$/.test(askZone()), `the time zone is "${askZone()}"`);
  const w = { object: 'object', objects: 'objects', space: 'space', owner: 'owner', member: 'member', members: 'members', nameOf: (id) => id };
  const p = aiUsedParts({ attached: [], relevant: 3, linked: 1, history: 2, chat: 0, members: 1, notSent: [{ why: 'setting', module: 'places', count: 2 }, { why: 'other-space', module: 'research', moduleName: 'Research', count: 1 }], cut: true }, [], w);
  expect(p.counts.join('|') === '3 related objects|1 linked object|2 earlier questions|1 member', `the counts read "${p.counts.join('|')}"`);
  expect(p.notSent === "Not sent: 2 objects from places, kept out by the owner's setting; 1 object from Research, from another space.", `the Not sent line reads "${p.notSent}"`);
  expect(p.fit === 'Some objects were left out to fit.', 'a cut call does not say some were left out to fit');
  expect(aiUsedParts({}, [{ part: 'relevant', why: 'budget', count: 2 }], w).fit !== '' && aiUsedParts({}, [{ part: 'x', why: 'setting', count: 2 }], w).fit === '', 'left out to fit is for the budget only');
  // Slice 2: the server's sent.lookup { searches, read } (read a count or a list of pointers); absent reads as none.
  const lk = lookupOf({ lookup: { searches: 2, read: [{ module: 'a', kind: 'k', id: '1' }, { module: 'a', kind: 'k', id: '2' }] } });
  expect(lk.count === 2 && lk.refs.length === 2 && lookupOf({ lookup: { searches: 1, read: 3 } }).count === 3, 'sent.lookup is not read as a count or a list');
  expect(lookupOf({}).count === 0 && lookupOf(null).count === 0 && lookupOf({ lookup: 'x' }).count === 0 && lookupOf({ lookup: { read: -4 } }).count === 0, 'a missing or odd sent.lookup is not read as none');
  const c = citationParts('See [1] and [2, 3] not [x].');
  expect(c.filter((x) => x.cite).map((x) => x.cite.join('+')).join(',') === '1,2+3', 'citations are not read');
  // The default question is the server's now: no page or module writes it.
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  for (const f of ['modules/research/src/research.js', 'modules/assistant/src/assistant.js', 'public/module-host.js', 'public/sdk/host.js', 'public/chat-input.js']) {
    expect(!/should I know about/.test(fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\/.*$/gm, '')), `${f} still writes the default question`);
  }
  expect(/question: '',/.test(fs.readFileSync(path.join(root, 'modules/research/src/research.js'), 'utf8')), 'Research this does not send an empty question with the object');
  say('helpers: notices, the long question, the zone, the used line and citations read as they should');
}

// A new ask as a person meets it: the used line, a citation, the zone, a long question, Not sent and cut short.
async function newAskChecks(t, S, admin) {
  const zone = await t.eval('Intl.DateTimeFormat().resolvedOptions().timeZone');
  await sleep(300);
  const before = await t.eval('window.__sent.length');
  scripted = { answer: 'Try the place in [1].', used: [1] };
  await t.eval(drop(S.ctx.trip));
  await t.typeInto('#chat-input', 'where should we eat tonight');
  await t.key('Enter');
  await answered(t);
  const sent = await t.eval(bodies(before));
  expect(sent.length === 1 && sent[0].tz === zone && zone, `the ask did not carry the browser's zone (${JSON.stringify(sent.map((b) => b.tz))} for ${zone})`);
  const used = await t.eval(lastUsed);
  expect(/^AI used: .*Where to eat near the hotel/.test(used), `the AI used: line does not link the attached object by its title ("${used}")`);
  const cite = await t.eval(`(() => { const b = [...document.querySelectorAll('#messages .message-cite')].pop(); return b ? { text: b.textContent, label: b.getAttribute('aria-label') } : null; })()`);
  expect(cite && cite.text === '1' && /Where to eat near the hotel/.test(cite.label), `the citation [1] is not a link to the object ("${JSON.stringify(cite)}")`);
  await snap(t, 'chat-used');
  say(`used line "${used}", citation ${JSON.stringify(cite)}, zone ${zone}`);

  // Over 1,000 characters: refused in the box, nothing sent.
  const n = await t.eval('window.__sent.length');
  await t.eval(`(() => { const i = document.getElementById('chat-input'); i.focus(); i.value = 'x'.repeat(1001); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await t.key('Enter');
  await sleep(500);
  const note = await t.eval(NOTE);
  expect(note === 'A question is at most 1,000 characters; this one is 1,001.', `a 1,001 character question gave the note "${note}"`);
  expect((await t.eval('window.__sent.length')) === n, 'a question over 1,000 characters was sent');
  expect((await t.eval(`document.getElementById('chat-input').value.length`)) === 1001, 'the long question was cleared from the box');
  await t.eval(`(() => { const i = document.getElementById('chat-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  say(`long question: "${note}"`);

  // The owner's setting kept the attached object out: said under the answer.
  const set = await jsonPut(S, admin, '/api/ai', 'PUT', { sees: { attached: false } });
  expect(set.status === 200, `could not set What AI may see (${set.status})`);
  scripted = { answer: 'Nothing was attached.', used: [] };
  await t.eval(drop(S.ctx.trip));
  await t.typeInto('#chat-input', 'what about this note');
  await t.key('Enter');
  await answered(t);
  const kept = await t.eval(lastUsed);
  expect(/Not sent: 1 .*kept out by the .*setting/.test(kept), `no Not sent line when the setting kept the object out ("${kept}", note "${await t.eval(NOTE)}")`);
  await jsonPut(S, admin, '/api/ai', 'PUT', { sees: null });
  say(`not sent: "${kept}"`);

  // The attached object's link opens it where it lives.
  await t.eval(`(() => { const c = window.hostModules; window.__opened = null; c.openRef = (r) => { window.__opened = r; return true; }; [...document.querySelectorAll('#messages .message-ref')].pop().click(); })()`);
  await sleep(300);
  const opened = await t.eval('window.__opened');
  expect(opened && opened.module === 'research' && opened.id === 'n1', `the object's link did not open it (${JSON.stringify(opened)})`);
}

// Slice 2, the pages half, by a person who has asked nothing yet (a minute's turns are few).
async function lookupChecks(open, S, workspace) {
  const t = await open({ ...workspace, as: 'admin' });
  try {
    await sleep(1500);
    // Slice 2: the question waits past a few seconds ("Looking things up..."), and the answer's sent.lookup shows as "looked up N"
    // with links for what the reader may open and "and N others" for the rest. The server half may not be there yet, so the
    // reply is the real one with the field added in the page.
    await t.eval(WATCH);
    await t.click('#chat-view-assistant');
    await sleep(600);
    await t.eval(`(() => { const of = window.fetch; window.fetch = async function (u, o) { const r = await of.apply(this, arguments); if (!(/\\/api\\/spaces\\/[^/]+\\/ai$/.test(String(u)) && o && o.method === 'POST')) return r; await new Promise((ok) => setTimeout(ok, 7000)); const j = await r.json(); if (j.message && j.message.sent) j.message.sent.lookup = { searches: 2, read: [{ module: 'research', kind: 'note', scope: 'space', space: '${S.ctx.trip}', id: 'n1' }, { module: 'research', kind: 'note', scope: 'space', space: '${S.ctx.trip}', id: 'gone-1' }, { module: 'research', kind: 'note', scope: 'space', space: '${S.ctx.trip}', id: 'gone-2' }] }; window.fetch = of; return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } }); }; })()`);
    scripted = { answer: 'Looked around.', used: [] };
    await t.typeInto('#chat-input', 'what did we plan for the ferry');
    await t.key('Enter');
    await sleep(6800);
    const waiting = await t.eval(NOTE);
    expect(waiting === 'Looking things up...', `a long wait does not say "Looking things up..." ("${waiting}")`);
    await snap(t, 'chat-looking');
    await answered(t);
    const looked = await t.eval(lastUsed);
    expect(/looked up 3 objects: .*Where to eat near the hotel.* and 2 others/.test(looked), `the AI used: line does not say what was looked up, with links ("${looked}")`);
    const lookedLinks = await t.eval(`[...document.querySelectorAll('#messages .message-used')].pop().querySelectorAll('.message-looked .message-ref:not(:disabled)').length`);
    expect(lookedLinks === 1, `the looked-up objects are ${lookedLinks} links, not 1`);
    await snap(t, 'chat-looked');
    say(`looked up: "${looked}"`);
  } finally { await t.close(); }
}

// Another person asks (so the first one's minute is not used up): a dropped object stands in for the words, a question under
// three characters is refused, and a citation [2] to a related object links, fresh and after a reload.
async function chipAndCiteChecks(open, S, workspace) {
  const t = await open({ ...workspace, as: 'sam' });
  try {
    await sleep(1500);
    await t.eval(WATCH);
    await t.click('#chat-view-assistant');
    await sleep(600);
  // A chip stands in for the words: Enter on an empty box asks the server's usual question about it (refs sent, question '').
  const nChip = await t.eval('window.__sent.length');
  scripted = { answer: 'About that note [1].', used: [1] };
  await t.eval(drop(S.ctx.trip));
  await sleep(300);
  await t.eval(`document.getElementById('chat-input').focus()`);
  await t.key('Enter');
  await answered(t);
  const chipSent = await t.eval(bodies(nChip));
  expect(chipSent.length === 1 && chipSent[0].question === '' && chipSent[0].refs.length === 1, `a chip with an empty box and Enter did not ask (${JSON.stringify(chipSent)}, note "${await t.eval(NOTE)}")`);
  expect(await t.eval(chips) === 0, 'the chip stayed after an empty-box ask');
  // An empty box and no chip still sends nothing.
  const nNone = await t.eval('window.__sent.length');
  await t.eval(`document.getElementById('chat-input').focus()`);
  await t.key('Enter');
  await sleep(400);
  expect((await t.eval('window.__sent.length')) === nNone, 'Enter on an empty box with no chip sent a question');
  // Under three characters: refused in the box, in the server's sentence.
  await t.typeInto('#chat-input', 'hi');
  await t.key('Enter');
  await sleep(400);
  const shortNote = await t.eval(NOTE);
  expect((await t.eval('window.__sent.length')) === nNone && shortNote === 'Ask a question of at least 3 characters.', `a 2 character question was not refused in the box (note "${shortNote}")`);
  await t.eval(`(() => { const i = document.getElementById('chat-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  say('chip: Enter on an empty box asks; two characters are refused');

  // [2] links to numbered[1] for an object that was related, fresh and after a reload.
  scripted = { answer: 'First [1] and second [2].', used: [1, 2] };
  await t.eval(drop(S.ctx.trip));
  await t.typeInto('#chat-input', 'where to eat near the hotel, and what else is saved');
  await t.key('Enter');
  await answered(t);
  const stored = await t.eval(`fetch('/api/spaces/${S.ctx.trip}/chat').then((r) => r.json())`);
  const lastAi = [...((stored && stored.messages) || [])].reverse().find((m) => m && m.kind === 'ai' && Array.isArray(m.numbered));
  const citeCount = `[...document.querySelectorAll('#messages .message')].filter((m) => /First .* and second/.test(m.textContent)).pop()?.querySelectorAll('.message-cite').length`;
  if (!lastAi || lastAi.numbered.length < 2) say(`citation [2]: the space holds only ${lastAi ? lastAi.numbered.length : 0} numbered object(s) for this ask; not measured`);
  else {
    expect(await t.eval(citeCount) === 2, `[1] and [2] are not both links to their objects (${await t.eval(citeCount)} links)`);
    await t.eval('location.reload()');
    await sleep(3500);
    await t.click('#chat-view-assistant');
    await sleep(800);
    expect(await t.eval(citeCount) === 2, `after a reload [1] and [2] are not both links (${await t.eval(citeCount)} links)`);
    await t.eval(WATCH);
  }

  } finally { await t.close(); }
}

// Text an AI wrote, through the one markdown function the page uses: allowed tags only, no handlers, http(s) links only,
// links that cannot see the opener, and no hidden direction or zero-width characters.
async function hostileChecks(t) {
  const lines = [
    '# Head <img src=x onerror=alert(1)>',
    '<script>alert(1)</script> **bold** *it* `code`',
    '[bad](javascript:alert(1)) [data](data:text/html,x) [ok](https://example.com/a_b)',
    '[x](https://example.com" onmouseover="alert(1))',
    'bare https://example.org/path and <a href="https://evil" onclick="x()">raw</a>',
    '- one',
    '- two',
    'a‮evil‬ b⁦c⁩ d​e‍f⁠g﻿h',
  ].join('\n');
  const check = await t.eval(`(() => {
    const html = hostText.markdown(${JSON.stringify(lines)});
    const d = document.createElement('div');
    d.innerHTML = html;
    const all = [...d.querySelectorAll('*')];
    return {
      html,
      tags: [...new Set(all.map((e) => e.tagName.toLowerCase()))],
      attrs: [...new Set(all.flatMap((e) => [...e.attributes].map((a) => a.name)))],
      links: [...d.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), rel: a.getAttribute('rel') })),
    };
  })()`);
  const allowed = new Set(['h1', 'h2', 'h3', 'p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'blockquote']);
  expect(check.tags.every((x) => allowed.has(x)), `markdown let through the tags ${JSON.stringify(check.tags.filter((x) => !allowed.has(x)))}`);
  expect(check.attrs.every((x) => ['href', 'target', 'rel'].includes(x)), `markdown let through the attributes ${JSON.stringify(check.attrs)}`);
  expect(check.links.length >= 2 && check.links.every((l) => /^https?:\/\//.test(l.href) && /noopener/.test(l.rel) && /noreferrer/.test(l.rel)), `a link is not http(s) with noopener noreferrer ${JSON.stringify(check.links)}`);
  expect(!/[‪-‮⁦-⁩​-‍⁠﻿]/.test(check.html), 'direction or zero-width characters reached the page');
  say(`hostile text: tags ${check.tags.join(',')}, ${check.links.length} links`);
}

// A cut-short answer says so (another person asks, so the first one's minute is not used up).
async function cutChecks(open, workspace) {
  const t = await open({ ...workspace, as: 'sam' });
  try {
    await sleep(1500);
    await t.click('#chat-view-assistant');
    await sleep(600);
    scripted = { answer: 'A long answer that', cut: true };
    await t.typeInto('#chat-input', 'tell me everything about the trip');
    await t.key('Enter');
    await answered(t);
    const cut = await t.eval(lastUsed);
    expect(/The answer was cut short\./.test(cut), `a cut-short answer does not say so ("${cut}", note "${await t.eval(NOTE)}")`);
    say(`cut short: "${cut}"`);
  } finally { await t.close(); }
}

// Manage's AI service tab: What AI may see, and this month's use.
async function manageChecks(open, S, admin) {
  for (const size of [1280, 390]) {
    const m = await open({ as: 'admin', url: '/admin#modules/ai', wait: '#ai-sees-box' }, size);
    try {
      await sleep(2200);
      const rows = await m.eval(`({ switches: document.querySelectorAll('#ai-sees-box input[role=switch][data-sees]').length, select: !!document.querySelector('#ai-sees-box select'), block: document.getElementById('ai-sees-block').getClientRects().length > 0 })`);
      expect(rows.block && rows.switches === 7 && rows.select, `What AI may see is not drawn on the AI service tab (${JSON.stringify(rows)})`);
      const wide = await m.eval(`document.documentElement.scrollWidth <= ${size} + 1`);
      expect(wide, `the AI service tab scrolls sideways at ${size}`);
      await m.eval(`document.getElementById('ai-sees-block').scrollIntoView()`);
      await snap(m, `manage-sees-${size}`);
      await m.eval(`document.getElementById('ai-use-block').scrollIntoView()`);
      await snap(m, `manage-use-${size}`);
      if (size === 1280) {
        expect(await m.eval(`document.getElementById('ai-sees-lookup').checked && /Let AI look things up in this /.test(document.getElementById('ai-sees-lookup').closest('label').textContent)`), 'Let AI look things up is not on by default on Manage');
        await m.eval(`document.getElementById('ai-sees-chat').click()`);
        await m.eval(`document.getElementById('ai-sees-lookup').click()`);
        await m.eval(`document.getElementById('ai-sees-save').click()`);
        await sleep(900);
        const got = await (await fetch(`${S.base}/api/ai`, { headers: { cookie: admin } })).json();
        expect(got.ai.sees && got.ai.sees.chat === true && got.ai.sees.lookup === false, `Save did not store What AI may see (${JSON.stringify(got.ai.sees)})`);
        await m.eval(`document.getElementById('ai-sees-reset').click()`);
        await sleep(900);
        const back = await (await fetch(`${S.base}/api/ai`, { headers: { cookie: admin } })).json();
        expect(back.ai.sees && back.ai.sees.chat === false && back.ai.sees.lookup !== false, `Back to the usual did not reset it (${JSON.stringify(back.ai.sees)})`);
        const use = await m.eval(`({ text: document.getElementById('ai-use-box').textContent.replace(/\\s+/g, ' '), grids: document.querySelectorAll('#ai-use-box .sdk-table-wrap').length, records: [...document.querySelectorAll('#ai-use-box .sdk-table-wrap')].pop().querySelectorAll('tbody tr').length })`);
        expect(/tokens in \d+ calls? this month/.test(use.text) && /By kind of request/.test(use.text) && use.grids >= 3 && use.records >= 3, `this month's use is not drawn (${JSON.stringify({ ...use, text: use.text.slice(0, 200) })})`);
        // A refusal with no template shows a dash for its Kind, not "Other".
        const kind = await m.eval(`(async () => { const { drawAiUse } = await import('/ai-use.js'); const d = document.createElement('div'); drawAiUse(d, { usage: {}, recent: [{ at: Date.now(), outcome: 'refused', reason: 'allowance' }, { at: Date.now(), template: 'ask@1', outcome: 'answered' }] }); const rows = [...d.querySelectorAll('.sdk-table-wrap')].pop().querySelectorAll('tbody tr'); return [...rows].map((r) => r.children[3].textContent); })()`);
        expect(kind[0] === '–' && kind[1] === 'Questions', `a refused record's Kind reads ${JSON.stringify(kind)}`);
        // "Only these" with none ticked is refused with a plain sentence before saving.
        await m.eval(`document.getElementById('ai-sees-modules-some').click()`);
        await sleep(200);
        await m.eval(`[...document.querySelectorAll('#ai-sees-box [data-sees-module]')].forEach((i) => { if (i.checked) i.click(); })`);
        await m.eval(`document.getElementById('ai-sees-save').click()`);
        await sleep(500);
        const empty = await m.eval(`document.getElementById('ai-sees-status').textContent`);
        expect(/at least one/i.test(empty), `an empty "Only these" was not refused ("${empty}")`);
        const after = await (await fetch(`${S.base}/api/ai`, { headers: { cookie: admin } })).json();
        expect(!(after.ai.sees && Array.isArray(after.ai.sees.modules) && after.ai.sees.modules.length === 0), 'an empty module list was saved');
        // One block of use: the meter sits with the numbers, and the block comes before What AI may see.
        const order = await m.eval(`(() => { const a = document.getElementById('ai-use-block'), b = document.getElementById('ai-sees-block'); return { before: !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING), meter: a.contains(document.getElementById('ai-usage')) }; })()`);
        expect(order.before && order.meter, `the use blocks are not merged and ordered (${JSON.stringify(order)})`);
        say(`manage: rows ${JSON.stringify(rows)}, use ${use.grids} lists, ${use.records} records`);
      } else say(`manage at ${size}: no sideways scroll`);
    } finally { await m.close(); }
  }
}

// A space's Set up: What AI may see follows the environment, until its switch is turned off.
async function setupChecks(open, S, admin) {
  const t = await open({ as: 'admin', url: `/?setup=${S.ctx.trip}#modules`, wait: '#setup-ai-sees-box' });
  try {
    await sleep(2500);
    const at = await t.eval(`({ shown: document.querySelector('[data-section="ai-sees"]').getClientRects().length > 0, follow: document.getElementById('setup-ai-sees-follow').checked, locked: [...document.querySelectorAll('#setup-ai-sees-box input')].every((i) => i.disabled) })`);
    expect(at.shown && at.follow && at.locked, `Set up does not show What AI may see as the environment's choice (${JSON.stringify(at)})`);
    await t.eval(`document.querySelector('[data-section="ai-sees"]').scrollIntoView()`);
    await snap(t, 'setup-sees-follow');
    await t.eval(`document.getElementById('setup-ai-sees-follow').click()`);
    await sleep(300);
    await snap(t, 'setup-sees-own');
    expect(await t.eval(`[...document.querySelectorAll('#setup-ai-sees-box input')].every((i) => !i.disabled)`), 'turning off "same as" did not let the rows change');
    await t.eval(`document.getElementById('setup-ai-sees-chat').click()`);
    await t.eval(`document.getElementById('setup-ai-sees-lookup').click()`);
    await sleep(200);
    await t.eval(`document.getElementById('setup-save').click()`);
    await sleep(1500);
    const space = (await (await fetch(`${S.base}/api/spaces/${S.ctx.trip}`, { headers: { cookie: admin } })).json()).space;
    expect(space.aiSees && space.aiSees.chat === true && space.aiSees.lookup === false, `Save did not store the space's own What AI may see (${JSON.stringify(space.aiSees)})`);
    const env = (await (await fetch(`${S.base}/api/ai`, { headers: { cookie: admin } })).json()).ai.sees;
    expect(env.chat === false, "the space's choice changed the environment's");
  } finally { await t.close(); }
  // A member sees no What AI may see in Set up.
  const sam = await open({ as: 'sam', url: `/?setup=${S.ctx.trip}#modules`, wait: 'body' });
  try {
    await sleep(2500);
    expect(await sam.eval(`document.querySelectorAll('[data-section="ai-sees"]').length`) === 0, 'a member is shown What AI may see');
  } finally { await sam.close(); }
  // Opened again: the space's own choice shows, and its switch gives it back to the environment.
  const t2 = await open({ as: 'admin', url: `/?setup=${S.ctx.trip}#modules`, wait: '#setup-ai-sees-box' });
  try {
    await sleep(2500);
    const own = await t2.eval(`({ follow: document.getElementById('setup-ai-sees-follow').checked, chat: document.getElementById('setup-ai-sees-chat').checked })`);
    expect(!own.follow && own.chat, `Set up did not show the space's own choice again (${JSON.stringify(own)})`);
    await t2.eval(`document.getElementById('setup-ai-sees-follow').click()`);
    await t2.eval(`document.getElementById('setup-save').click()`);
    await sleep(1500);
    const back = (await (await fetch(`${S.base}/api/spaces/${S.ctx.trip}`, { headers: { cookie: admin } })).json()).space;
    expect(!back.aiSees, `following the environment again did not clear the space's own (${JSON.stringify(back.aiSees)})`);
    say('set up: follows the environment, saves its own, follows again');
  } finally { await t2.close(); }
}

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-page-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    browser = await launch(bin);
    // The seed points the AI at a made-up OpenAI key; point it at the stand-in.
    const admin = S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
    const put = (body) => fetch(`${S.base}/api/ai`, { method: 'PUT', headers: { cookie: admin, 'content-type': 'application/json', origin: S.base }, body: JSON.stringify(body) });
    const set = await put({ source: 'custom', provider: 'compatible', address: `http://127.0.0.1:${stubPort}/v1`, model: 'stub-model', key: 'sk-test', enabled: true });
    expect(set.status === 200, `could not point the AI at the stand-in (${set.status})`);
    // Using AI needs the role's Use AI; give members theirs whatever the default is.
    const role = await fetch(`${S.base}/api/roles/member`, { method: 'PATCH', headers: { cookie: admin, 'content-type': 'application/json', origin: S.base }, body: JSON.stringify({ useAi: true }) });
    expect(role.status === 200, `could not give members Use AI (${role.status})`);
    const open = async (screen, size = 1280) => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(Number(process.env.AI_PAGE_SIZE) || size, process.env.AI_PAGE_MODE === 'light' ? 'light' : 'dark', screen.call === true);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      await driveScreen(tab, screen, S.base, S.cookies, S.ctx);
      return tab;
    };
    const workspace = { as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true };

    // /ai in the Discussion, the context chip, one question at a time.
    const t = await open(workspace);
    try {
      await sleep(1200);
      await t.eval(WATCH);
      await t.typeInto('#chat-input', '/ai what is a good first meal');
      await t.key('Enter');
      await sleep(1800);
      const note = await t.eval(NOTE);
      expect(!/No command/i.test(note), `/ai in the Discussion was refused: "${note}"`);
      expect(seen.some((q) => /good first meal/.test(q)) && !seen.some((q) => /\/ai what/.test(q)), `/ai did not reach the AI as the question alone (${JSON.stringify(seen)})`);
      expect(await t.eval(`document.getElementById('chat').dataset.view`) === 'assistant', '/ai did not bring up the Assistant');
      expect(await t.eval(answers) >= 1, '/ai: the answer did not show');
      expect(await t.eval(`document.getElementById('chat-input').value`) === '', '/ai: the box was not emptied');
      say(`/ai: asked, answer shown, note "${note}"`);

      // The picker lists /ai.
      await t.typeInto('#chat-input', '/');
      await sleep(400);
      const picker = await t.eval(`[...document.querySelectorAll('#chat-command-menu .chat-command-item')].map((b) => b.textContent)`);
      expect((picker || []).some((x) => /^\/ai/.test(x)), `the "/" list does not offer /ai (${JSON.stringify(picker)})`);
      await t.eval(`(() => { const i = document.getElementById('chat-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('chat-command-menu')?.remove(); })()`);

      // A dropped object: a chip, sent once.
      await t.eval(drop(S.ctx.trip));
      await sleep(300);
      expect(await t.eval(chips) === 1, 'a dropped object did not show as a chip');
      await t.eval(`document.querySelector('#chat-ai-context .sdk-chip-x').click()`);
      expect(await t.eval(chips) === 0, 'the chip could not be taken off');
      await t.eval(drop(S.ctx.trip));
      await sleep(200);
      const before = await t.eval('window.__sent.length');
      await t.typeInto('#chat-input', 'tell me about this note');
      await t.key('Enter');
      await sleep(1800);
      await t.typeInto('#chat-input', 'and an unrelated second question');
      await t.key('Enter');
      await sleep(1800);
      const sent = await t.eval(bodies(before));
      expect(sent.length === 2, `expected two questions after the drop, saw ${sent.length}`);
      expect(sent[0] && sent[0].refs.length === 1, 'the first question did not carry the dropped object');
      expect(sent[1] && sent[1].refs.length === 0, 'the dropped object was still attached to the second question');
      expect(await t.eval(chips) === 0, 'the chip stayed after the question was sent');
      say(`context: refs per question ${sent.map((b) => b.refs.length).join(', ')}`);

      // One question out at a time.
      const out = await t.eval('window.__sent.length');
      await t.typeInto('#chat-input', 'SLOWANSWER please');
      await t.key('Enter');
      await sleep(300);
      await t.key('Enter');
      await sleep(300);
      const busyNote = await t.eval(NOTE);
      await sleep(3200);
      const twice = (await t.eval('window.__sent.length')) - out;
      expect(twice === 1, `Enter during a question sent ${twice} requests, not 1`);
      expect(/Still asking/.test(busyNote), `no "Still asking" note while a question was out ("${busyNote}")`);
      say(`one at a time: ${twice} request, note "${busyNote}"`);
      await newAskChecks(t, S, admin);
      await hostileChecks(t);
    } finally { await t.close(); }
    await cutChecks(open, workspace);
    await chipAndCiteChecks(open, S, workspace);
    await lookupChecks(open, S, workspace);
    await manageChecks(open, S, admin);
    await setupChecks(open, S, admin);
    unitChecks();

    // The AI not set up: the Assistant says so first.
    const off = await put({ enabled: false, force: true });
    expect(off.status === 200, `could not turn the AI off (${off.status})`);
    const avail = await (await fetch(`${S.base}/api/spaces/${S.ctx.trip}/ai`, { headers: { cookie: admin } })).json();
    expect(avail.available === false && avail.reason === 'not-set-up', `availability with no AI should say reason "not-set-up" (${JSON.stringify(avail)})`);
    const t2 = await open(workspace);
    try {
      await sleep(1200);
      await t2.click('#chat-view-assistant');
      await sleep(800);
      const line = await t2.eval(stateLine);
      const hint = await t2.eval(`document.getElementById('chat-input').placeholder`);
      expect(/not set up/i.test(line), `the Assistant did not say the AI is not set up before typing ("${line}")`);
      expect(!/Instruct/.test(hint), `the box still invites a question when there is no AI ("${hint}")`);
      const count = seen.length;
      await t2.typeInto('#chat-input', 'anyone there?');
      await t2.key('Enter');
      await sleep(900);
      expect(seen.length === count, 'a question was sent with no AI set up');
      expect(/not set up/i.test(await t2.eval(NOTE)), 'no plain note after asking with no AI');
      say(`not set up: line "${line}", hint "${hint}"`);
    } finally { await t2.close(); }
    await put({ enabled: true });

    // A guest: not invited, nothing sent.
    const link = await (await fetch(`${S.base}/api/spaces/${S.ctx.trip}/guest-link`, { method: 'POST', headers: { cookie: admin, 'content-type': 'application/json', origin: S.base }, body: '{}' })).json();
    const g = await open({ as: 'none', url: new URL(link.guestUrl).pathname, wait: '#guest-name' }).catch(() => null);
    if (g) {
      try {
        await g.typeInto('#guest-name', 'Gus');
        await g.eval(`document.getElementById('guest-name').form.requestSubmit()`);
        await sleep(5000);
        await g.click('#chat-view-assistant');
        await sleep(600);
        const hint = await g.eval(`document.getElementById('chat-input').placeholder`);
        const line = await g.eval(stateLine);
        expect(!/Instruct/.test(hint), `a guest is invited to ask ("${hint}")`);
        expect(/cannot use AI/i.test(line), `a guest is not told AI is not for them ("${line}")`);
        const count = seen.length;
        await g.typeInto('#chat-input', 'can a guest ask?');
        await g.key('Enter');
        await sleep(600);
        expect(seen.length === count, 'a guest question reached the AI');
        expect(!/sign in/i.test(await g.eval(NOTE)), 'a guest was told to sign in');
        say(`guest: hint "${hint}", line "${line}"`);
      } finally { await g.close(); }
    } else say('guest: the guest page did not open here; not measured');

    // Research on its own page: no "Research this".
    const r = await open({ as: 'admin', url: '/modules/research?space={trip}', wait: 'body' });
    try {
      await sleep(2500);
      const items = await r.eval(`(async () => { const b = __q('#module-frame >>> .rcard [data-action=menu]'); if (!b) return null; b.click(); await new Promise((x) => setTimeout(x, 500)); return __all('#module-frame >>> [role=menuitem], .sdk-menu button, [role=menuitem]').map((e) => e.textContent.trim()).filter(Boolean); })()`);
      if (!items) say('research: no card menu found; not measured');
      else {
        expect(items.length > 0 && items.includes('Edit'), `research: the card menu did not open (${JSON.stringify(items)})`);
        expect(!items.includes('Research this'), 'research: "Research this" is offered on the standalone page');
        say(`research page menu: ${items.join(', ')}`);
      }
    } finally { await r.close(); }
  } finally {
    if (browser) { browser.cdp.ws.close(); browser.child.kill(); }
    if (server) await stopServer(server);
    stub.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of failures) console.error(`check-ai-page: ${f}`); return 1; }
  say('ok');
  return 0;
}
process.exit(await main());
