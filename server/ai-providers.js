// The provider adapters (plan-ai-integration.md, "The provider adapters"): one per provider (openai, anthropic, compatible),
// each turning the registry's rendered messages into its request and its answer into
// { text, structured, finish, tokens: { in, out }, model, mode }. Structured output where the provider takes the output
// contract's schema: OpenAI's strict JSON schema response format, a single forced tool for Anthropic, and for a compatible
// service the JSON schema tried first, falling back to prompt-then-parse when it refuses it (decision 13; the caller
// remembers that per saved setting). The finish reason is one of stop, length, filter, error. Errors become plain sentences
// (AiError); the provider's own words go to the server log only. The key is sent only in the header of a request to the
// provider and address it was saved for (server/ai.js binds it), never in a page, a log, a record or an error.
//
// Model listing moved here from server/ai.js unchanged.
'use strict';

const { AiNetError, request } = require('./ai-http');

const HOSTS = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com' };
// One current, inexpensive model per company, so a key alone is enough to offer it -- the console lets an admin change it.
// Chosen 2026-09-23: gpt-4o-mini (OpenAI), claude-haiku-4-5-20251001 (Anthropic's Claude Haiku 4.5). No default for
// compatible: an arbitrary address has no catalog to default from.
const DEFAULT_MODELS = { openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5-20251001' };
const FETCH_MS = 90000;
const MAX_BODY = 1024 * 1024;
const ADDRESS_UNUSABLE = 'That address cannot be used.';
const ANSWER_TOOL = 'answer';

const oneLine = (s, n) => String(s == null ? '' : s).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// `refund`: the ask failed before the service did (or billed) any work -- nothing was sent, the connection failed before an
// answer began, or the service itself said it was busy or down (429, 5xx) or refused the key -- so the route gives the
// person's turn back. Any other failure after the service answered counts, as an answered ask does.
// `tokens`: what the service said the failed ask used, recorded all the same. `kind`: the error's kind for the call record.
class AiError extends Error {
  constructor(message, status = 400, { refund = false, tokens = 0, kind = '' } = {}) {
    super(message);
    this.status = status;
    this.refund = refund;
    this.tokens = tokens;
    this.kind = kind;
  }
}

// A typed key goes into a request header, so it must be one line of plain characters.
function checkTypedKey(key) {
  if (typeof key === 'string' && /[\u0000-\u001f\u007f]/.test(key.trim())) throw new AiError('a key is one line of text, without line breaks or tabs');
}

// The headers a provider's request carries, the key among them.
function headersFor(provider, key, workspace) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (provider === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    if (workspace) headers['anthropic-workspace-id'] = workspace;
  } else if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function chatUrl(provider, base) {
  if (provider === 'anthropic') return `${base}/v1/messages`;
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}${/\/v1$/.test(base) ? '' : '/v1'}/chat/completions`;
}

// The rendered messages as Anthropic takes them: the system part apart, and consecutive turns of one role joined into one
// message of several text blocks (the data message and the first history question are both the person's).
function anthropicMessages(messages) {
  const out = [];
  for (const m of messages.slice(1)) {
    const block = { type: 'text', text: m.content };
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content.push(block);
    else out.push({ role: m.role, content: [block] });
  }
  return out;
}

// One request's body. `structured`: send the schema (`rendered.schema`).
function bodyFor(provider, model, rendered, structured) {
  const maxTokens = rendered.maxTokens;
  if (provider === 'anthropic') {
    const body = { model, max_tokens: maxTokens, system: rendered.messages[0].content, messages: anthropicMessages(rendered.messages) };
    if (structured && rendered.schema) {
      body.tools = [{ name: ANSWER_TOOL, description: 'Give the answer in this shape.', input_schema: rendered.schema }];
      body.tool_choice = { type: 'tool', name: ANSWER_TOOL };
    }
    return body;
  }
  const body = { model, [provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']: maxTokens, messages: rendered.messages.map((m) => ({ role: m.role, content: m.content })) };
  if (structured && rendered.schema) body.response_format = { type: 'json_schema', json_schema: { name: rendered.name.replace(/[^A-Za-z0-9_-]/g, '_'), strict: true, schema: rendered.schema } };
  return body;
}

// A provider's stop reason as one of stop, length, filter, error.
function finishOf(provider, json) {
  const raw = provider === 'anthropic' ? json.stop_reason : json.choices && json.choices[0] && json.choices[0].finish_reason;
  if (raw === 'length' || raw === 'max_tokens') return 'length';
  if (raw === 'content_filter' || raw === 'refusal') return 'filter';
  if (raw === 'error') return 'error';
  return 'stop';
}

// The token counts a provider reported: { in, out }, each 0 when not said.
function tokensOf(provider, json) {
  const u = json.usage && typeof json.usage === 'object' ? json.usage : {};
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1e9) : 0; };
  if (provider === 'anthropic') return { in: num(u.input_tokens), out: num(u.output_tokens) };
  const tin = num(u.prompt_tokens);
  const tout = num(u.completion_tokens);
  if (tin || tout) return { in: tin, out: tout };
  return { in: num(u.total_tokens), out: 0 };
}

// The answer's text and, when the provider gave one, its structured value.
function answerOf(provider, json, structured) {
  if (provider === 'anthropic') {
    const blocks = Array.isArray(json.content) ? json.content : [];
    const tool = blocks.find((b) => b && b.type === 'tool_use' && b.name === ANSWER_TOOL && b.input && typeof b.input === 'object');
    const text = blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
    return { text: tool ? JSON.stringify(tool.input) : text, structured: tool ? tool.input : undefined };
  }
  const msg = json.choices && json.choices[0] && json.choices[0].message;
  const text = msg && typeof msg.content === 'string' ? msg.content : '';
  if (!structured) return { text, structured: undefined };
  try { const v = JSON.parse(text); return { text, structured: v && typeof v === 'object' && !Array.isArray(v) ? v : undefined }; } catch { return { text, structured: undefined }; }
}

// A compatible service refusing the schema rather than the question: a 400 or 422 whose message names the response format,
// the JSON schema or structured output. One that says nothing readable, or names something else, is not taken for it.
// Busy, down and the key are other failures.
function refusedSchema(res) {
  if (res.status !== 400 && res.status !== 422) return false;
  let message = '';
  try {
    const j = JSON.parse(res.text);
    const m = j?.error?.message ?? j?.message ?? j?.detail ?? '';
    message = typeof m === 'string' ? m : JSON.stringify(m);
  } catch { return false; }
  return /response_format|json_schema|schema|structured[ _-]?output/i.test(message);
}

async function send(c, url, headers, body, guard, timeoutMs = FETCH_MS) {
  try {
    return await request(url, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: Math.max(1, Math.min(FETCH_MS, timeoutMs)), maxBytes: MAX_BODY, guard });
  } catch (err) {
    if (!(err instanceof AiNetError)) throw err;
    // Never the key or the prompt. The detail goes to the log; the person gets a sentence.
    console.warn(`[ai] ${c.provider}/${c.model}: request failed (${err.code}: ${oneLine(err.message, 200)})`);
    // Given back only when nothing reached the service or the connection failed before it began answering; a timeout or an
    // over-long answer may have been worked on, and billed, so it counts.
    const refund = err.code === 'blocked' || (err.code === 'network' && !err.answered);
    throw new AiError(err.code === 'timeout' ? 'The AI service took too long to answer. Try again in a moment.' : err.code === 'toolarge' ? 'The AI service sent back too much.' : 'The AI service did not answer. Try again in a moment.', 502, { refund, kind: err.code });
  }
}

function statusError(c, res) {
  let providerMessage = '';
  try { const errJson = JSON.parse(res.text); providerMessage = String(errJson?.error?.message || errJson?.message || ''); } catch { /* not JSON */ }
  console.warn(`[ai] ${c.provider}/${c.model}: ${res.status}${providerMessage ? ` ${oneLine(providerMessage, 300)}` : ''}`);
  return new AiError(
    res.status === 401 || res.status === 403 ? 'The AI service refused the key.'
      : res.status === 429 ? 'The AI service is busy. Try again in a moment.'
        : res.status >= 500 ? 'The AI service had a problem. Try again in a moment.'
          : 'The AI service could not answer.',
    502,
    // Busy, down or the key refused: the service did no work. Any other refusal (a content filter, say) counts.
    { refund: res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 403, kind: `status-${res.status}` },
  );
}

// One answer. `c`: the effective service { provider, address, model, key, workspace }; `rendered`: the registry's render()
// for structured output (with its schema) -- `renderText` gives the same template rendered for prompt-then-parse, used when
// `mode` is 'text' or a compatible service refuses the schema. `mode`: 'structured' or 'text'. Answers
// { text, structured, finish, tokens: { in, out }, model, mode, schemaRefused }.
async function complete(c, { structuredRendered, textRendered, mode }, { hosts = HOSTS, guard = null } = {}) {
  const base = c.provider === 'compatible' ? c.address : hosts[c.provider];
  const url = chatUrl(c.provider, base);
  const headers = headersFor(c.provider, c.key, c.workspace);
  let useMode = mode === 'structured' && structuredRendered && structuredRendered.schema ? 'structured' : 'text';
  let schemaRefused = false;
  let rendered = useMode === 'structured' ? structuredRendered : textRendered;
  let res = await send(c, url, headers, bodyFor(c.provider, c.model, rendered, useMode === 'structured'), guard);
  if (useMode === 'structured' && c.provider === 'compatible' && refusedSchema(res)) {
    console.warn(`[ai] compatible/${c.model}: the service refused the answer's schema (${res.status}); asking again without it`);
    schemaRefused = true;
    useMode = 'text';
    rendered = textRendered;
    res = await send(c, url, headers, bodyFor(c.provider, c.model, rendered, false), guard);
  }
  if (res.status < 200 || res.status >= 300) throw statusError(c, res);
  let json;
  try { json = JSON.parse(res.text); } catch { throw new AiError('The AI service answered something unreadable.', 502, { kind: 'unreadable' }); }
  if (!json || typeof json !== 'object') throw new AiError('The AI service answered something unreadable.', 502, { kind: 'unreadable' });
  const tokens = tokensOf(c.provider, json);
  const { text, structured } = answerOf(c.provider, json, useMode === 'structured');
  const finish = finishOf(c.provider, json);
  if ((typeof text !== 'string' || !text.trim()) && !structured) {
    throw new AiError(finish === 'filter' ? 'The AI service would not answer that.' : 'The AI service gave no answer.', 502, { tokens: tokens.in + tokens.out, kind: finish === 'filter' ? 'filter' : 'empty' });
  }
  // A provider that reports no counts: estimated from characters (about four to a token).
  if (!tokens.in && !tokens.out) {
    tokens.in = Math.ceil(rendered.messages.reduce((n, m) => n + m.content.length, 0) / 4);
    tokens.out = Math.ceil(text.length / 4);
  }
  return { text, structured, finish, tokens, model: typeof json.model === 'string' ? json.model.slice(0, 120) : c.model, mode: useMode, schemaRefused };
}

// --- the tool rounds (plan-ai-integration.md, "Slice 2": the loop) ---------------------------------------------------------
// One round of a question with tools: the rendered messages, then the rounds so far (`conversation`, provider-neutral), with
// the tools offered and the provider's "must call a tool" choice. Neutral turns after the rendered messages:
//   { role: 'assistant', text, calls: [{ id, name, input, raw }] }  -- what the model asked for
//   { role: 'tool', results: [{ id, content }] }                      -- what the server answered, as JSON text
// OpenAI (and a compatible service): `tools` with `tool_choice: "required"`, or the one tool named on the last round.
// Anthropic: `tools` with `tool_choice: { type: "any" }`, or `{ type: "tool", name }` on the last round.

// The conversation as OpenAI takes it, after the rendered messages.
function openaiTurns(conversation) {
  const out = [];
  for (const turn of conversation) {
    if (turn.role === 'assistant') {
      out.push({ role: 'assistant', content: turn.text || null, tool_calls: turn.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.raw === 'string' ? c.raw : JSON.stringify(c.input ?? {}) } })) });
    } else if (turn.role === 'tool') {
      for (const r of turn.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    }
  }
  return out;
}

// The conversation as Anthropic takes it: a tool call is a tool_use block of the assistant's turn, its result a tool_result
// block of the next user turn.
function anthropicTurns(conversation) {
  const out = [];
  for (const turn of conversation) {
    if (turn.role === 'assistant') {
      out.push({ role: 'assistant', content: [...(turn.text ? [{ type: 'text', text: turn.text }] : []), ...turn.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input && typeof c.input === 'object' && !Array.isArray(c.input) ? c.input : {} }))] });
    } else if (turn.role === 'tool') {
      out.push({ role: 'user', content: turn.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })) });
    }
  }
  return out;
}

// One tool round's request body. `tools`: [{ name, description, schema }]; `force`: the one tool's name the model must call
// (the last round), or '' for any of them.
function toolBodyFor(provider, model, rendered, conversation, tools, force = '') {
  const maxTokens = rendered.maxTokens;
  if (provider === 'anthropic') {
    return {
      model,
      max_tokens: maxTokens,
      system: rendered.messages[0].content,
      messages: [...anthropicMessages(rendered.messages), ...anthropicTurns(conversation)],
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })),
      tool_choice: force ? { type: 'tool', name: force } : { type: 'any' },
    };
  }
  return {
    model,
    [provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']: maxTokens,
    messages: [...rendered.messages.map((m) => ({ role: m.role, content: m.content })), ...openaiTurns(conversation)],
    // OpenAI's strict mode where it is OpenAI; a compatible service is sent the plain shape, which more of them take.
    tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema, ...(provider === 'openai' ? { strict: true } : {}) } })),
    tool_choice: force ? { type: 'function', function: { name: force } } : 'required',
  };
}

const MAX_CALLS_READ = 20; // more calls than this in one reply are not read at all
const CALL_ID = /^[A-Za-z0-9_-]{1,64}$/;
// The tool calls of a reply: [{ id, name, input, raw }]. `input` is the parsed object, or undefined when the model's
// arguments are not JSON (the loop answers that as a bad input). An id the provider did not give, or one that is not plain,
// is made here, so a tool result always names its call.
// An id already used in this reply, or in `taken` (the ids of the earlier rounds), is made anew: the next request never
// carries two calls, or two results, with one id.
function callsOf(provider, json, round, taken = []) {
  const calls = [];
  const used = new Set(taken);
  const idOf = (id, i) => {
    let out = typeof id === 'string' && CALL_ID.test(id) && !used.has(id) ? id : `call_${round}_${i}`;
    for (let n = 2; used.has(out); n += 1) out = `call_${round}_${i}_${n}`;
    used.add(out);
    return out;
  };
  if (provider === 'anthropic') {
    const blocks = Array.isArray(json.content) ? json.content : [];
    blocks.filter((b) => b && b.type === 'tool_use').slice(0, MAX_CALLS_READ).forEach((b, i) => {
      calls.push({ id: idOf(b.id, i), name: typeof b.name === 'string' ? b.name.slice(0, 64) : '', input: b.input && typeof b.input === 'object' && !Array.isArray(b.input) ? b.input : undefined });
    });
    return calls;
  }
  const msg = json.choices && json.choices[0] && json.choices[0].message;
  const list = msg && Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  list.slice(0, MAX_CALLS_READ).forEach((tc, i) => {
    const fn = tc && tc.function;
    const raw = fn && typeof fn.arguments === 'string' ? fn.arguments.slice(0, 20000) : fn && fn.arguments && typeof fn.arguments === 'object' ? JSON.stringify(fn.arguments) : '';
    let input;
    try { const v = JSON.parse(raw || '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) input = v; } catch { input = undefined; }
    calls.push({ id: idOf(tc && tc.id, i), name: fn && typeof fn.name === 'string' ? fn.name.slice(0, 64) : '', input, raw });
  });
  return calls;
}

// A compatible service refusing tools rather than the question: a 400 or 422 whose message names tools, tool_choice or
// function calling (the plan's rule, as decision 13's for the schema). Busy, down and the key are other failures.
function refusedTools(res) {
  if (res.status !== 400 && res.status !== 422) return false;
  let message = '';
  try {
    const j = JSON.parse(res.text);
    const m = j?.error?.message ?? j?.message ?? j?.detail ?? '';
    message = typeof m === 'string' ? m : JSON.stringify(m);
  } catch { return false; }
  // A context-length or size error may mention the tool definitions; only a message saying tools are not supported is a refusal.
  if (/context[ _-]?length|too (?:long|large|many tokens)|maximum (?:context|number)|token limit/i.test(message)) return false;
  const subject = /\btools?\b|tool_choice|tool[ _-]?calls?\b|function[ _-]?call(?:ing|s)?\b/i;
  const refusal = /\bunsupported\b|not\s+(?:be\s+)?supported|(?:does(?:\s*n['’]t|\s+not)|do(?:\s*n['’]t|\s+not)|cannot|can['’]t)\s+support|unrecogni[sz]ed|not\s+recogni[sz]ed|unknown\s+(?:parameter|field|argument|request argument)|extra inputs? are not permitted|not\s+(?:allowed|available|enabled)/i;
  return subject.test(message) && refusal.test(message);
}

// One tool round. Answers { text, calls, finish, tokens, model } or, for a compatible service on the first round that
// refuses tools, { toolsRefused: true } (nothing was answered or billed). `timeoutMs`: what is left of the question's time,
// never more than one request's 90 seconds.
async function completeRound(c, { rendered, conversation, tools, force = '', round = 1 }, { hosts = HOSTS, guard = null, timeoutMs = FETCH_MS } = {}) {
  const base = c.provider === 'compatible' ? c.address : hosts[c.provider];
  const url = chatUrl(c.provider, base);
  const headers = headersFor(c.provider, c.key, c.workspace);
  const res = await send(c, url, headers, toolBodyFor(c.provider, c.model, rendered, conversation, tools, force), guard, timeoutMs);
  if (round === 1 && c.provider === 'compatible' && refusedTools(res)) {
    console.warn(`[ai] compatible/${c.model}: the service refused tools (${res.status}); asking again without them`);
    return { toolsRefused: true };
  }
  if (res.status < 200 || res.status >= 300) throw statusError(c, res);
  let json;
  try { json = JSON.parse(res.text); } catch { throw new AiError('The AI service answered something unreadable.', 502, { kind: 'unreadable' }); }
  if (!json || typeof json !== 'object') throw new AiError('The AI service answered something unreadable.', 502, { kind: 'unreadable' });
  const tokens = tokensOf(c.provider, json);
  const calls = callsOf(c.provider, json, round, (conversation || []).flatMap((t) => (Array.isArray(t.calls) ? t.calls.map((x) => x.id) : [])));
  const { text } = answerOf(c.provider, json, false);
  const plain = c.provider === 'anthropic' ? (Array.isArray(json.content) ? json.content : []).filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : text;
  const finish = finishOf(c.provider, json);
  if (!tokens.in && !tokens.out) {
    tokens.in = Math.ceil(JSON.stringify(rendered.messages).length / 4 + JSON.stringify(conversation).length / 4);
    tokens.out = Math.ceil((plain.length + JSON.stringify(calls).length) / 4);
  }
  return { text: typeof plain === 'string' ? plain : '', calls, finish, tokens, model: typeof json.model === 'string' ? json.model.slice(0, 120) : c.model };
}

// The models a service offers, from its own list: [{ id, name }]. Plain errors: no key, unreachable, refused. With a `guard`
// (a hosted environment's own address, see server/ai-http.js) every failure is the same sentence and says nothing of the
// address or what it answered.
async function listModelsFor({ provider, address, key, workspace }, hosts = HOSTS, guard = null) {
  if (!['openai', 'anthropic', 'compatible'].includes(provider)) throw new AiError('choose a service first');
  checkTypedKey(key);
  let base = hosts[provider];
  if (provider === 'compatible') {
    const a = String(address || '').trim();
    let u;
    try { u = new URL(a); } catch { throw new AiError('give the service\'s address first'); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new AiError('the address must be http or https, without a user name or password');
    base = u.href.replace(/\/$/, '');
  } else if (!key) throw new AiError('enter the key first');
  const headers = { Accept: 'application/json' };
  if (provider === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    if (workspace) headers['anthropic-workspace-id'] = workspace;
  } else if (key) headers.Authorization = `Bearer ${key}`;
  const root = base.replace(/\/chat\/completions$/, '');
  const url = provider === 'anthropic' ? `${base}/v1/models?limit=100` : `${root}${/\/v1$/.test(root) ? '' : '/v1'}/models`;
  const guarded = provider === 'compatible' ? guard : null; // the companies' own addresses are not the owner's to choose
  const couldNot = (why) => new AiError(guarded ? ADDRESS_UNUSABLE : why, guarded ? 400 : 502);
  let res;
  try {
    res = await request(url, { headers, timeoutMs: 15000, maxBytes: MAX_BODY, guard: guarded });
  } catch (err) {
    if (!(err instanceof AiNetError)) throw err;
    console.warn(`[ai] ${provider}: listing models failed (${err.code}: ${oneLine(err.message, 120)})`);
    throw couldNot(err.code === 'toolarge' ? 'The service answered too much.' : provider === 'compatible' ? 'That address could not be reached.' : 'The service could not be reached.');
  }
  if (res.status < 200 || res.status >= 300) throw couldNot(res.status === 401 || res.status === 403 ? 'The service refused the key.' : provider === 'compatible' && res.status === 404 ? 'That address did not list its models (check the address, or type the model name).' : 'The service could not list its models.');
  let json;
  try { json = JSON.parse(res.text); } catch { throw couldNot('The service answered something unreadable.'); }
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  let list = rows.filter((m) => m && typeof m.id === 'string').map((m) => ({ id: m.id.slice(0, 120), name: oneLine(m.display_name || m.id, 120), created: Number(m.created) || 0 }));
  if (provider === 'openai') list = list.filter((m) => /^(gpt-|chatgpt-|o1|o3|o4)/.test(m.id) && !/(embed|tts|whisper|dall-e|moderation|transcribe|realtime|audio|image)/.test(m.id)).sort((a, b) => b.created - a.created);
  else if (provider === 'compatible') list.sort((a, b) => a.id.localeCompare(b.id));
  return list.slice(0, 200).map(({ id, name }) => ({ id, name }));
}

module.exports = { AiError, HOSTS, DEFAULT_MODELS, ADDRESS_UNUSABLE, FETCH_MS, checkTypedKey, complete, completeRound, listModelsFor, bodyFor, toolBodyFor, callsOf, finishOf, tokensOf, refusedSchema, refusedTools };
