#!/usr/bin/env node
/*
 * fake-model.mjs -- a local stand-in for an AI service, for every AI check (plan-ai-integration.md, step 1). It speaks
 * OpenAI's chat completions (/v1/chat/completions, also at /chat/completions) and Anthropic's messages (/v1/messages), and
 * lists models (/v1/models). No network beyond localhost.
 *
 * Scripted answers: push one with fake.next({...}) for the next request, or put a word in the last user message:
 *   ECHO (the system part and the last message back), CUTOFF (stopped for length mid-object), BLANK (an empty answer the
 *   service billed 900 tokens for), NOTJSON, MARKDOWN, FILTER (its own refusal, 400), ERR401, ERR429, ERR500, SLOW (waits
 *   fake.slowMs). Anything else gets a normal answer: plain text, or, when the request carries a schema (OpenAI's
 *   response_format, Anthropic's forced tool), JSON in that shape.
 * fake.refuseSchema = true makes it a compatible service that refuses a response_format with a 400.
 *
 * Every request is kept in fake.seen: { url, auth, apiKey, workspace, body }.
 *
 * As a program: `node tools/fake-model.mjs [--port 4000]` runs one until stopped, for trying the server by hand
 * (set the AI service to "compatible" at http://127.0.0.1:4000/v1 with any model name).
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ANSWER = 'A short answer.';

// What a structured answer holds for a schema: tags, or { answer, objects, used }.
function structuredFor(schema, scripted) {
  if (scripted && scripted.json !== undefined) return scripted.json;
  const props = (schema && schema.properties) || {};
  if (props.tags) return { tags: ['old town', 'food'] };
  return { answer: scripted && typeof scripted.text === 'string' ? scripted.text : ANSWER, objects: [], used: [] };
}

export async function startFakeModel({ port = 0, host = '127.0.0.1' } = {}) {
  const queue = [];
  const fake = {
    seen: [],
    refuseSchema: false,
    slowMs: 3000,
    next(answer) { queue.push(answer); return fake; },
    clear() { queue.length = 0; fake.seen.length = 0; fake.refuseSchema = false; },
    last() { return fake.seen[fake.seen.length - 1]; },
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = { unreadable: raw.slice(0, 200) }; }
      fake.seen.push({ url: req.url, auth: req.headers.authorization || '', apiKey: req.headers['x-api-key'] || '', workspace: req.headers['anthropic-workspace-id'] || '', body });
      res.setHeader('content-type', 'application/json');
      const send = (status, value) => { res.statusCode = status; res.end(typeof value === 'string' ? value : JSON.stringify(value)); };
      if (req.url.startsWith('/redirect')) { res.statusCode = 302; res.setHeader('location', '/v1/models'); return res.end(); }
      if (req.url.startsWith('/big')) return res.end('x'.repeat(2 * 1024 * 1024));
      if (/\/models(\?|$)/.test(req.url)) return send(200, { data: [{ id: 'fake-1', display_name: 'Fake one' }, { id: 'fake-2' }] });
      const anthropic = req.url.startsWith('/v1/messages');
      if (!anthropic && !/\/chat\/completions$/.test(req.url.split('?')[0])) return send(404, { error: { message: 'no such route' } });
      const msgs = (body && body.messages) || [];
      const lastMsg = msgs[msgs.length - 1];
      const textOf = (m) => (!m ? '' : typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((b) => b.text || '').join('\n') : '');
      const last = textOf(lastMsg);
      const system = anthropic ? String((body && body.system) || '') : textOf(msgs[0]);
      const schema = anthropic ? body && body.tools && body.tools[0] && body.tools[0].input_schema : body && body.response_format && body.response_format.json_schema && body.response_format.json_schema.schema;
      if (schema && fake.refuseSchema && !anthropic) return send(400, { error: { message: "response_format 'json_schema' is not supported by this model" } });
      const scripted = queue.length ? queue.shift() : null;
      const word = (w) => !scripted && new RegExp(`\\b${w}\\b`).test(last);
      if ((scripted && scripted.delayMs) || word('SLOW')) await new Promise((r) => setTimeout(r, (scripted && scripted.delayMs) || fake.slowMs));
      const status = scripted && scripted.status ? scripted.status : word('ERR401') ? 401 : word('ERR429') ? 429 : word('ERR500') ? 500 : word('FILTER') ? 400 : 200;
      if (status !== 200) return send(status, { error: { message: status === 400 ? 'content filtered' : `fake failure ${status}` } });
      let text;
      let finish = (scripted && scripted.finish) || 'stop';
      let tokens = (scripted && scripted.tokens) || [10, 2];
      let structured;
      if (scripted && scripted.raw !== undefined) return send(200, scripted.raw);
      if (word('ECHO')) text = `SYSTEM:\n${system}\n\nLAST:\n${last}`;
      else if (word('BLANK')) { text = '   '; tokens = [890, 10]; }
      else if (word('NOTJSON')) text = 'this is { not json at all';
      else if (word('MARKDOWN')) text = '## Heading\n\n- **one**\n- two\n\n```js\nconst a = 1;\n```';
      else if (word('CUTOFF')) { text = schema ? '{"answer":"Two places.","objects":[{"icon":"landmark","kind":"sight","title":"Tower","content":"Old","basis":"general","sources":[]},{"icon":"landmark","kind":"museum","title":"Tile Mu' : 'Two places.\n\n```objects\n[{"icon":"landmark","kind":"sight","title":"Tower","content":"Old","basis":"general"},{"icon":"landmark","kind":"museum","title":"Tile Mu'; finish = 'length'; }
      else if (scripted && scripted.text !== undefined && !(schema && scripted.json !== undefined)) text = scripted.text;
      // A scripted `text` is the content as it is (malformed JSON included); a scripted `json`, or no script, is a structured
      // answer when a schema was sent.
      if (text === undefined) {
        if (schema) { structured = structuredFor(schema, scripted); text = JSON.stringify(structured); } else text = scripted && scripted.json !== undefined ? JSON.stringify(scripted.json) : ANSWER;
      }
      if (anthropic) {
        const content = schema && structured !== undefined ? [{ type: 'tool_use', id: 'toolu_1', name: body.tools[0].name, input: structured }] : [{ type: 'text', text }];
        return send(200, { id: 'msg_1', model: body.model, content, stop_reason: finish === 'length' ? 'max_tokens' : schema && structured !== undefined ? 'tool_use' : 'end_turn', usage: { input_tokens: tokens[0], output_tokens: tokens[1] } });
      }
      return send(200, { id: 'cmpl_1', model: body.model, choices: [{ message: { role: 'assistant', content: text }, finish_reason: finish }], usage: { prompt_tokens: tokens[0], completion_tokens: tokens[1], total_tokens: tokens[0] + tokens[1] } });
    });
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  fake.url = `http://${host}:${server.address().port}`;
  fake.close = () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });
  return fake;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--port');
  const fake = await startFakeModel({ port: at > 0 ? Number(process.argv[at + 1]) : 4000 });
  console.log(`fake model listening on ${fake.url} (OpenAI-shaped at ${fake.url}/v1, Anthropic-shaped at ${fake.url}/v1/messages)`);
}
