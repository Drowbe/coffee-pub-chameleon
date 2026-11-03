// The prompt registry (plan-ai-integration.md, "Slice 1: the prompt layer"): every word the server says to a model lives in
// a template here, with a version, typed inputs and an output contract. One file per template; this one lists them,
// renders a template into a provider-neutral list of messages, and reads an answer back.
//
// A template's name in records is `<id>@<version>` (ask@1). Any change to what a template renders or parses is a new
// version, with its own golden files (tools/golden/prompts/, tools/check-prompts.mjs). The registry keeps the current
// version and the one before it; AI_PROMPT_VERSIONS (ask@1,tags@1) pins a template to a kept version, for rollback.
'use strict';

const { checkInputs, cleanData, cleanQuestion, InputError, MIN_QUESTION, MAX_QUESTION, MAX_MATERIAL, MAX_TURNS } = require('./inputs');
const { parseSummaries, parseTags, citedItems, readAnswer, MAX_SUMMARIES } = require('./parse');

// Each template's kept versions, newest first: the current one and, once there is one, the one before it.
const KEPT = {
  ask: [require('./ask').template],
  summarise: [require('./summarise').template],
  tags: [require('./tags').template],
  paste: [require('./paste').template],
};
const IDS = Object.keys(KEPT);
// The templates a model may be asked through (paste is for a person to copy).
const TASKS = ['ask', 'summarise', 'tags'];

const nameOf = (t) => `${t.id}@${t.version}`;

// AI_PROMPT_VERSIONS as { pins: { <id>: <version> }, lines: [sentences for the log] }. A pin naming a template or a version
// the registry doesn't keep is ignored, with one line.
function pinsFrom(env = process.env) {
  const pins = {};
  const lines = [];
  const raw = String((env && env.AI_PROMPT_VERSIONS) || '').trim();
  if (!raw) return { pins, lines };
  for (const part of raw.split(/[\s,]+/).filter(Boolean)) {
    const m = /^([a-z]+)@(\d{1,4})$/.exec(part);
    const kept = m && KEPT[m[1]] ? KEPT[m[1]].find((t) => t.version === Number(m[2])) : null;
    if (!kept) { lines.push(`AI_PROMPT_VERSIONS: ${part} is not a prompt version this server keeps; it is ignored.`); continue; }
    pins[m[1]] = kept.version;
    if (kept !== KEPT[m[1]][0]) lines.push(`AI_PROMPT_VERSIONS: ${m[1]} is pinned to its earlier version, ${part}.`);
  }
  return { pins, lines };
}
let PINS = pinsFrom(process.env);

// Read again (a check sets it per case); answers the log lines.
function setPins(env) {
  PINS = pinsFrom(env);
  return PINS.lines;
}

// The template in use for `id`: the pinned version, else the newest.
function template(id) {
  const kept = KEPT[id];
  if (!kept) throw new InputError(`no template ${id}`);
  const pinned = PINS.pins[id];
  return (pinned && kept.find((t) => t.version === pinned)) || kept[0];
}

// Every kept version of every template (for the golden check).
const allTemplates = () => IDS.flatMap((id) => KEPT[id]);

// A template's messages for the providers: [{ role: 'system' | 'user' | 'assistant', content }], instructions in the one system
// message, then the data document as one user message holding JSON, then the history as alternating user and assistant
// messages, then the question as the last user message. `structured`: the provider takes the output contract's schema, so
// the system part says so and `schema` comes with it. Answers { name, messages, schema, maxTokens, structured }.
function render(t, inputs, { structured = false } = {}) {
  if (!t || !t.system) throw new InputError('that template is not rendered for a model');
  checkInputs(t, inputs);
  const messages = [{ role: 'system', content: t.system(inputs, { structured }) }];
  messages.push({ role: 'user', content: JSON.stringify(cleanData(t.data(inputs))) });
  for (const turn of inputs.history || []) {
    messages.push({ role: 'user', content: turn.question });
    messages.push({ role: 'assistant', content: turn.answer });
  }
  if (inputs.question !== undefined) messages.push({ role: 'user', content: inputs.question });
  return { name: nameOf(t), messages, schema: structured ? t.schema(inputs) : null, maxTokens: t.budget.answer, structured };
}

// How many numbered objects a template's inputs hold (attached, then the rollup's relevant and linked): what `used` and
// `sources` may name.
function numbered(inputs) {
  const c = inputs.context || {};
  return (inputs.material || []).length + (Array.isArray(c.relevant) ? c.relevant.length : 0) + (Array.isArray(c.linked) ? c.linked.length : 0);
}

// An answer read against its template. `answer`: { text, structured?, finish } from an adapter. For ask and summarise:
// { text, summaries, used, cut }; for tags: { tags, cut }. A structured answer is read as JSON; a text answer (or a structured
// one that does not read) by prompt-then-parse. `cut`: the provider stopped for length, or the answer stops mid-object.
function parse(t, answer, inputs) {
  const finish = answer && answer.finish;
  const cutByLength = finish === 'length';
  if (t.output === 'tags') {
    const s = answer && answer.structured;
    const tags = parseTags(s && Array.isArray(s.tags) ? s.tags : (answer && answer.text) || '');
    return { tags, cut: cutByLength };
  }
  const count = numbered(inputs);
  const text = String((answer && answer.text) || '');
  if (answer && (answer.structured || answer.mode === 'structured')) {
    const read = readAnswer(answer.structured, text, count, MAX_SUMMARIES);
    if (read) return { ...read, summaries: narrow(read.summaries, inputs.kinds), cut: Boolean(read.cut || cutByLength) };
  }
  const parsed = parseSummaries(text.trim().slice(0, 16000), count);
  return { text: parsed.text, summaries: narrow(parsed.summaries, inputs.kinds), used: citedItems(text, count), cut: Boolean(parsed.cut || cutByLength) };
}

// Objects narrowed to the kinds the environment's modules take: a kind no module takes is dropped, with its details; the
// object is kept without them (its title as its content when it had none), so the answer's {{summary:N}} places still hold.
function narrow(summaries, kinds) {
  if (!Array.isArray(kinds)) return summaries;
  return summaries.map((s) => {
    if (!s.kind || kinds.includes(s.kind)) return s;
    const { kind, details, ...rest } = s;
    return rest.content ? rest : { ...rest, content: rest.title };
  });
}

// The copied instructions (the paste template) for this environment's words and kinds.
function pasteText(inputs, { product }) {
  const t = template('paste');
  checkInputs(t, inputs);
  return { name: nameOf(t), text: t.text(inputs, { product }) };
}

module.exports = {
  IDS, TASKS, KEPT, nameOf, template, allTemplates, render, parse, pasteText, pinsFrom, setPins, numbered,
  cleanQuestion, InputError, MIN_QUESTION, MAX_QUESTION, MAX_MATERIAL, MAX_TURNS, MAX_SUMMARIES,
};
