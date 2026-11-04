// The in-app AI's read tools and the loop that runs them (plan-ai-integration.md, "Slice 2: the first tools", step 1).
//
// Who it acts as: the person asking, at the moment of each tool call; there is no AI identity with rights of its own. The
// policy's check runs once before the first round (the route); every object a tool returns goes through aiPolicy.admit as
// the person with part `lookup`, so the space pinning (decision 4), What AI may see (decision 8), the person's read rights,
// the modules' guards and redaction hold for tool results exactly as they do for the rollup.
//
// Numbers, never pointers: the model never sees or sends a ref. Every object it is shown (attached, rollup or found by a
// tool) carries a number `n`; read_object takes only a number the server gave out in this question, so a model can't name
// an object of another space or guess one. An unknown number is "Not found.".
//
// The loop: send with the tools; for each tool call, the name must be one offered this round and the input must check; then
// it runs as the person, its result capped, and goes back as a tool result. It ends when the model calls `answer` (or
// answers in plain text), or at a limit: 4 rounds, 8 look-ups and 120 seconds a question, each request at most 90 seconds;
// on the last round only `answer` is offered. Each round reserves its estimate before it is sent and settles to the real
// count (slice 1's reserve and settle); every round's tokens count, and the question is one call.
'use strict';

const prompts = require('./prompts');
const { cleanData } = require('./prompts/inputs');
const toolRegistry = require('./prompts/tools');
const { moduleAllowed, redactText, redactSummary } = require('./ai-policy');
const { wordsOf, whenText } = require('./ai-context');
const { AiError, completeRound, FETCH_MS } = require('./ai-providers');

// The limits (decision S4). Constants, like the templates' budgets; `ms` is read per question so a check can shorten it.
const LIMITS = { rounds: 4, calls: 8, ms: 120000, resultChars: 8000, resultsChars: 6000 * 4, found: 15, links: 5, text: 8000 };
const NOT_FOUND = 'Not found.';
const NO_MORE = 'No more look-ups; answer now.';
const DIDNT_FINISH = "The AI didn't finish its answer.";
const NO_ANSWER = 'The AI service gave no answer.';
const TOO_LONG = 'The AI service took too long to answer. Try again in a moment.';

const keyOf = (r) => `${r.module}|${r.kind}|${r.scope}|${r.space || ''}|${r.id}`;
const placeText = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.name === 'string' ? v.name : '');
const dayOf = (when) => { const w = whenText(when); return /^\d{4}-\d{2}-\d{2}/.test(w) ? w.slice(0, 10) : ''; };
// A tool result as the model reads it: JSON, with the data message's cleaning (no NUL, no run of backticks).
const json = (v) => JSON.stringify(cleanData(v));

// One found object as the model reads it (no text): the plan's { n, kind, title, when?, end?, place?, done?, module }.
function foundOf(n, s, moduleName) {
  const when = whenText(s.when);
  const end = whenText(s.end);
  const place = placeText(s.place);
  const kind = s.kindName || s.kind;
  return { n, ...(kind ? { kind: String(kind) } : {}), title: typeof s.title === 'string' ? s.title : String(s.title ?? ''), ...(when ? { when } : {}), ...(end ? { end } : {}), ...(place ? { place } : {}), ...(s.done ? { done: true } : {}), ...(moduleName ? { module: String(moduleName) } : {}) };
}

// A result made to fit `max` characters as JSON: a read object's text shortened, a search's last objects dropped (`more`),
// a read object's links dropped, else only the error. Never cut in the middle of a JSON value.
function fit(value, max) {
  let v = value;
  for (let i = 0; i < 40 && JSON.stringify(v).length > max; i += 1) {
    if (typeof v.text === 'string' && v.text.length > 200) {
      const over = JSON.stringify(v).length - max;
      const keep = Math.max(200, v.text.length - over - 20);
      v = { ...v, text: `${v.text.slice(0, keep).replace(/[\uD800-\uDBFF]$/, '')}…` };
    } else if (Array.isArray(v.objects) && v.objects.length) {
      v = { ...v, objects: v.objects.slice(0, Math.floor(v.objects.length / 2)), more: true };
    } else if (Array.isArray(v.links) && v.links.length) {
      v = { ...v, links: v.links.slice(0, Math.floor(v.links.length / 2)) };
    } else {
      v = { error: 'That was too long to send.' };
    }
  }
  return v;
}

// deps: { policy, listObjects(who, { scope, space }) -> summaries, moduleLinks: { from(ref), to(ref) } }.
function createAiTools(deps) {
  const { policy, listObjects, moduleLinks } = deps;

  // The tools for one question asked by `who` in `space`, after the context was built (`built`: the context builder's
  // answer). `words`: the template's words; `contract`: the answer's schema. `on`: whether the look-ups are offered at all
  // (a space, and What AI may see has `lookup` on).
  function toolbox(who, space, built, { words, contract }) {
    const sees = built.sees;
    const secretList = policy.secrets();
    const on = Boolean(space && sees && sees.lookup);
    // The pointer behind every number given out in this question: the context's first, then each object a tool returns.
    const numbered = built.numbered.slice();
    const numberOf = new Map(numbered.map((r, i) => [keyOf(r), i + 1]));
    const give = (ref) => {
      const k = keyOf(ref);
      if (!numberOf.has(k)) { numbered.push(ref); numberOf.set(k, numbered.length); }
      return numberOf.get(k);
    };
    const stats = { searches: 0, found: new Set(), read: [] };
    const admit = (ref, withText) => policy.admit(who, space, ref, { sees, part: 'lookup', withText, secretList });

    // search_objects: this space's objects (and environment-wide ones only when What AI may see says `readable`), read as the
    // person, matched by the input, best first, each admitted with part lookup. Never says why something was left out.
    function search(input) {
      stats.searches += 1;
      const pool = [...listObjects(who, { scope: 'space', space: space.id })];
      if (sees.environment === 'readable') pool.push(...listObjects(who, { scope: 'environment' }));
      const asked = input.words ? wordsOf(input.words) : [];
      const phrase = input.words ? input.words.toLowerCase() : '';
      const kind = input.kind ? input.kind.toLowerCase().replace(/s$/, '') : '';
      const scored = [];
      const seen = new Set();
      for (const s of pool) {
        if (!s || !s.ref || seen.has(keyOf(s.ref)) || !moduleAllowed(sees, s.ref.module)) continue;
        seen.add(keyOf(s.ref));
        if (kind && ![s.kind, s.kindName].some((k) => typeof k === 'string' && k.toLowerCase().replace(/s$/, '') === kind)) continue;
        if (input.has === 'place' && !(s.place && placeText(s.place))) continue;
        const day = dayOf(s.when);
        if (input.from || input.to) {
          if (!day) continue;
          const last = dayOf(s.end) || day;
          if ((input.from && last < input.from) || (input.to && day > input.to)) continue;
        }
        let score = 0;
        if (input.words) {
          // Matched on what the model may read, never on the raw text: a secret in a title can't be found by searching for it.
          const r = redactSummary(s, secretList);
          const title = `${r.title || ''} ${r.subtitle || ''}`.toLowerCase();
          const hay = new Set(wordsOf(`${r.title} ${r.subtitle || ''} ${r.kindName || ''} ${r.category || ''} ${placeText(r.place)}`));
          score = asked.filter((w) => hay.has(w)).length + (phrase && title.includes(phrase) ? 1 : 0);
          if (!score) continue;
        }
        scored.push({ s, score, day });
      }
      scored.sort((a, b) => b.score - a.score || String(a.day || '9').localeCompare(String(b.day || '9')) || String(a.s.title).localeCompare(String(b.s.title)));
      const objects = [];
      let more = false;
      for (const x of scored) {
        const got = admit(x.s.ref, false);
        if (!got.ok) continue; // the policy has the last word, and is never named
        if (objects.length >= LIMITS.found) { more = true; break; }
        const n = give(got.ref);
        stats.found.add(n);
        objects.push(foundOf(n, got.summary, got.moduleName));
      }
      return { objects, ...(more ? { more: true } : {}) };
    }

    // read_object: one object by a number given out in this question, with its text and one step of links, each admitted.
    function read(input) {
      const ref = numbered[input.n - 1];
      if (!ref) return { error: NOT_FOUND };
      const got = admit(ref, true);
      if (!got.ok) return { error: NOT_FOUND }; // the same words whether it is gone or the person lost access
      const s = got.summary;
      const n = give(got.ref);
      if (!stats.read.some((r) => keyOf(r) === keyOf(got.ref))) stats.read.push(got.ref);
      const links = [];
      const linkSeen = new Set([keyOf(got.ref)]);
      for (const other of [...moduleLinks.from(got.ref), ...moduleLinks.to(got.ref)]) {
        if (links.length >= LIMITS.links) break;
        if (!other || typeof other !== 'object' || linkSeen.has(keyOf(other))) continue;
        linkSeen.add(keyOf(other));
        const l = admit(other, false);
        if (!l.ok) continue;
        const ln = give(l.ref);
        stats.found.add(ln);
        links.push(foundOf(ln, l.summary, l.moduleName));
      }
      const text = [s.text, s.subtitle].filter((x) => (typeof x === 'string' && x) || (typeof x === 'number' && Number.isFinite(x))).map(String).join('\n').slice(0, LIMITS.text);
      const { module: _m, ...head } = foundOf(n, s, '');
      delete head.end;
      delete head.done;
      return { ...head, text, links };
    }

    // One call, as the model made it: the result value. `offeredNow`: the tool names offered this round.
    function run(call, offeredNow) {
      const name = typeof call.name === 'string' ? call.name : '';
      if (!offeredNow.includes(name) || !toolRegistry.LOOKUPS.includes(name)) {
        const shown = name.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'that';
        return { error: `There is no tool ${shown} here; use ${offeredNow.join(', ')}.` };
      }
      if (call.input === undefined) return { error: `The input to ${name} could not be read as JSON.` };
      const checked = toolRegistry.tool(name).check(call.input);
      if (!checked.ok) return { error: checked.error };
      return name === 'search_objects' ? search(checked.input) : read(checked.input);
    }

    return {
      on,
      numbered,
      offered: (last) => toolRegistry.offered({ words, contract, lookup: on, last }),
      run,
      // What the record keeps (counts only) and what the stored answer keeps (`sent.lookup`: the reads as pointers).
      looked: () => ({ found: stats.found.size, read: stats.read.length }),
      lookup: () => ({ searches: stats.searches, read: stats.read.slice() }),
      redact: (text) => redactText(text, secretList),
    };
  }

  return { toolbox };
}

// The rounds of one question with tools (server/ai.js's run calls it when a toolbox is given and the service has not refused
// tools). `ai`: the Ai instance (reserve, overCap, record, log); `c`: the effective service. Answers
//   { toolsRefused: true } -- a compatible service refused tools on the first round; nothing was billed; ask again without
//   { answer: { text, structured, finish, mode }, rounds, toolCalls, stop, tokens, model, billed }
// or throws AiError (with `refund` only when no round was billed, and `tokens` already recorded).
async function runToolLoop(ai, { t, name, inputs, use, toolbox, c, guard, hosts, logPrompts, overCapSentence }) {
  const started = Date.now();
  const deadline = started + LIMITS.ms;
  const rendered = prompts.render(t, inputs, { structured: true, tools: true });
  const conversation = [];
  const toolCalls = {};
  let rounds = 0;
  let calls = 0;
  let billed = 0;
  const tokens = { in: 0, out: 0 };
  let model = c.model;
  const usage = { task: t.id, template: name, person: use.person, space: use.space };
  const base = { purpose: use.purpose, environment: use.environment, space: use.space, person: use.person, template: name, sent: use.counts, provider: c.provider, model: c.model, tools: 'on' };
  const stats = (extra = {}) => ({ rounds, toolCalls: Object.keys(toolCalls).length ? { ...toolCalls } : undefined, looked: toolbox.looked(), ...extra });
  const failed = (err, extra = {}) => {
    if (err instanceof AiError && billed > 0) err.refund = false; // earlier rounds were billed: the question counts
    ai.log({ ...base, model, outcome: 'error', error: (err instanceof AiError && err.kind) || 'error', ms: Date.now() - started, tokensIn: tokens.in, tokensOut: tokens.out, ...stats(extra) });
    // Every round's tokens are already counted here: the caller records nothing more for this question.
    if (err instanceof AiError) err.tokens = 0;
    return err;
  };
  if (logPrompts) console.log(`[ai] prompt ${name} (tools): ${JSON.stringify(rendered.messages)}`);
  while (rounds < LIMITS.rounds) {
    rounds += 1;
    const limited = rounds === LIMITS.rounds || calls >= LIMITS.calls;
    const offered = toolbox.offered(limited);
    const offeredNames = offered.map((o) => o.name);
    const estimate = Math.ceil((JSON.stringify(rendered.messages).length + JSON.stringify(conversation).length + JSON.stringify(offered).length) / 4) + t.budget.answer;
    // The allowance with this round in it: the loop stops, nothing is kept; earlier rounds' tokens stay counted.
    if (ai.overCap(estimate)) {
      const err = new AiError(overCapSentence, 429, { refund: billed === 0, kind: 'allowance' });
      if (billed === 0) { ai.log({ ...base, outcome: 'refused', reason: 'allowance', ...stats() }); throw err; }
      throw failed(err, { stop: 'allowance' });
    }
    const left = deadline - Date.now();
    if (left <= 0) throw failed(new AiError(TOO_LONG, 502, { kind: 'timeout' }), { stop: 'time' });
    const release = ai.reserve(estimate);
    let out;
    try {
      out = await completeRound(c, { rendered, conversation, tools: offered, force: limited ? toolRegistry.ANSWER : '', round: rounds }, { hosts, guard, timeoutMs: Math.min(FETCH_MS, left) });
    } catch (err) {
      release();
      if (err instanceof AiError && err.tokens > 0) { ai.record(usage, err.tokens, { call: billed === 0 }); billed += err.tokens; tokens.in += err.tokens; }
      // A request cut by what was left of the question's time says so in the question's words.
      if (err instanceof AiError && err.kind === 'timeout') err.message = TOO_LONG;
      throw failed(err);
    }
    release();
    if (out.toolsRefused) return { toolsRefused: true };
    const total = out.tokens.in + out.tokens.out;
    ai.record(usage, total, { call: billed === 0 });
    billed += total;
    tokens.in += out.tokens.in;
    tokens.out += out.tokens.out;
    model = out.model || model;
    const answerCall = out.calls.find((x) => x.name === toolRegistry.ANSWER && offeredNames.includes(x.name));
    if (answerCall) {
      const input = answerCall.input && typeof answerCall.input === 'object' ? answerCall.input : undefined;
      return { answer: { text: input ? JSON.stringify(input) : String(answerCall.raw || ''), structured: input, finish: out.finish, mode: 'structured' }, ...stats({ stop: limited ? 'limit' : 'answer' }), tokens: { ...tokens }, model, billed };
    }
    if (!out.calls.length) {
      // A plain text reply is read with slice 1's prompt-then-parse and taken as the answer.
      if (out.text && out.text.trim()) return { answer: { text: out.text, finish: out.finish, mode: 'text' }, ...stats({ stop: 'text' }), tokens: { ...tokens }, model, billed };
      // Nothing at all: on the last round the AI didn't finish; before it, the service gave no answer (slice 1's sentence).
      if (limited) throw failed(new AiError(DIDNT_FINISH, 502, { kind: 'unfinished' }), { stop: 'unfinished' });
      throw failed(new AiError(NO_ANSWER, 502, { kind: out.finish === 'filter' ? 'filter' : 'empty' }), { stop: 'empty' });
    }
    if (limited) throw failed(new AiError(DIDNT_FINISH, 502, { kind: 'unfinished' }), { stop: 'unfinished' });
    const results = [];
    for (const call of out.calls) {
      calls += 1;
      const known = toolRegistry.LOOKUPS.includes(call.name) ? call.name : 'unknown';
      toolCalls[known] = (toolCalls[known] || 0) + 1;
      const value = calls > LIMITS.calls ? { error: NO_MORE } : toolbox.run(call, offeredNames);
      results.push({ id: call.id, value: fit(value, LIMITS.resultChars) });
    }
    conversation.push({ role: 'assistant', text: out.text || '', calls: out.calls.map((x) => ({ id: x.id, name: x.name, input: x.input, raw: x.raw })) }, { role: 'tool', results });
    // Tool results together at most 6,000 tokens on top of the ask's budget, the oldest shortened first.
    const all = conversation.filter((x) => x.role === 'tool').flatMap((x) => x.results);
    const size = () => all.reduce((n, r) => n + JSON.stringify(r.value).length, 0);
    for (const r of all) {
      if (size() <= LIMITS.resultsChars) break;
      r.value = fit(r.value, Math.max(60, JSON.stringify(r.value).length - (size() - LIMITS.resultsChars)));
    }
    for (const r of all) r.content = json(r.value);
    if (logPrompts) console.log(`[ai] tools ${name} round ${rounds}: ${toolbox.redact(JSON.stringify(conversation.slice(-2).map((x) => (x.role === 'tool' ? { results: x.results.map((r) => r.content) } : { calls: x.calls.map((k) => ({ name: k.name, input: k.input })) }))))}`);
    if (Date.now() >= deadline) throw failed(new AiError(TOO_LONG, 502, { kind: 'timeout' }), { stop: 'time' });
  }
  throw failed(new AiError(DIDNT_FINISH, 502, { kind: 'unfinished' }), { stop: 'unfinished' });
}

module.exports = { createAiTools, runToolLoop, LIMITS, NOT_FOUND, NO_MORE, DIDNT_FINISH, NO_ANSWER, TOO_LONG, fit };
