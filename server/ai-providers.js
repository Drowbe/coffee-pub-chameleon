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

async function send(c, url, headers, body, guard) {
  try {
    return await request(url, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: FETCH_MS, maxBytes: MAX_BODY, guard });
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

module.exports = { AiError, HOSTS, DEFAULT_MODELS, ADDRESS_UNUSABLE, checkTypedKey, complete, listModelsFor, bodyFor, finishOf, tokensOf, refusedSchema };
