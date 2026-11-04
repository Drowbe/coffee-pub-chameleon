// The write tools an AI may propose, made from the modules' manifests (plan-ai-integration.md, slice 2 step 12, decision 22).
//
// Each action a module provides may say, beside its name, label and input:
//   description  one plain sentence, up to 200 characters, saying what it does (in the template's words: {space} and the
//                other placeholders are filled as a label's are);
//   effect       what it changes: "write" (the default) or "destructive" (takes something away that can't be had back);
//   ai           false keeps it out of the catalog.
// The catalog is generated from the enabled manifests whenever it is asked for, so it can't drift from them. An action is a
// tool only when it acts on an object that already exists (a required pointer input, and no whole-object input: new
// objects already come as the answer's objects, each with Keep), is described, is not destructive (open question 6's lean),
// is not local (a view on one person's page) and not asker-only. A tool is named <module>__<action>; an input of type
// `ref` takes the number `n` the server gave an object in this question, never a pointer.
//
// Nothing here runs an action or proposes one (that is step 13): it answers what may be offered and what an input must be.
'use strict';

const { word } = require('./words');

const EFFECTS = ['write', 'destructive'];
const MAX_DESCRIPTION = 200;
// Both providers take tool names of 1 to 64 letters, digits, _ and -.
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SEP = '__';
// The bus's own text limits (busInput in server/index.js).
const MAX_STRING = 200;
const MAX_TEXT = 8000;
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

const oneLine = (s) => String(s).replace(/[\s\p{Cc}]+/gu, ' ').trim();

// An action's `description`, `effect` and `ai` from module.json, checked; `fail(message)` throws the manifest's error.
// Answers the fields to keep on the cleaned action: `effect` on every action that is not local ("write" when none is
// given), `description` when given, `ai: false` when given.
function cleanActionAi(p, name, local, fail) {
  const out = {};
  if (p.description !== undefined) {
    if (typeof p.description !== 'string') fail(`module.json: action "${name}" description must be text: one sentence saying what it does.`);
    const d = oneLine(p.description);
    if (!d) fail(`module.json: action "${name}" description is empty; say in one sentence what it does.`);
    if ([...d].length > MAX_DESCRIPTION) fail(`module.json: action "${name}" description is at most ${MAX_DESCRIPTION} characters.`);
    out.description = d;
  }
  if (p.effect !== undefined) {
    if (local) fail(`module.json: action "${name}" is local, which changes nothing, so it has no effect.`);
    if (!EFFECTS.includes(p.effect)) fail(`module.json: action "${name}" effect must be ${EFFECTS.join(' or ')}.`);
  }
  if (!local) out.effect = p.effect === undefined ? 'write' : p.effect;
  if (p.ai !== undefined) {
    if (typeof p.ai !== 'boolean') fail(`module.json: action "${name}" ai must be true or false.`);
    if (p.ai && local) fail(`module.json: action "${name}" is local, so it is never offered to the AI.`);
    if (!p.ai) out.ai = false;
  }
  return out;
}

const baseOf = (type) => String(type).replace(/\?$/, '');
const isRef = (base) => base === 'ref' || base.startsWith('ref:');
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

// Why a cleaned action is not a tool, or '' when it is one. `moduleId` for the tool name's length.
function whyLeftOut(moduleId, a) {
  if (a.local) return 'local';
  if (a.askerOnly) return 'asker-only';
  if (a.ai === false) return 'ai-off';
  if (a.effect !== 'write') return a.effect === 'destructive' ? 'destructive' : 'no-effect';
  if (!a.description) return 'no-description';
  const types = Object.values(a.input || {});
  if (types.some((t) => baseOf(t) === 'object')) return 'new-object';
  if (!types.some((t) => !String(t).endsWith('?') && isRef(baseOf(t)))) return 'new-object';
  if (!TOOL_NAME_RE.test(`${moduleId}${SEP}${a.name}`)) return 'long-name';
  return '';
}

// One input type as a JSON schema (the plain subset both providers take).
function fieldSchema(type) {
  const base = baseOf(type);
  if (isRef(base)) {
    const kind = base === 'ref' ? '' : base.split(':')[2];
    return { type: 'integer', minimum: 1, description: kind ? `The number n of ${article(kind)} ${kind} shown in this question.` : `The number n of ${word('object', { a: true })} shown in this question.` };
  }
  if (base === 'string') return { type: 'string', minLength: 1, maxLength: MAX_STRING };
  if (base === 'text') return { type: 'string', minLength: 1, maxLength: MAX_TEXT };
  if (base === 'date') return { type: 'string', pattern: DATE_PATTERN, description: 'A date, YYYY-MM-DD.' };
  if (base === 'datetime') return { type: 'string', format: 'date-time', description: 'A date and time, ISO 8601.' };
  if (base === 'boolean') return { type: 'boolean' };
  if (base === 'number') return { type: 'number' };
  throw new Error(`no schema for input type ${type}`);
}

function inputSchema(input) {
  const properties = {};
  const required = [];
  for (const [field, type] of Object.entries(input || {})) {
    properties[field] = fieldSchema(type);
    if (!String(type).endsWith('?')) required.push(field);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

// The catalog for a list of cleaned manifests (the enabled ones, in this environment's words): { tools, leftOut }.
// `tools`, sorted by name, each { name, module, action, label, description, effect, input, schema }: `input` the action's
// own field types (for turning numbers back into pointers), `schema` what the model is given. `leftOut`: every other action
// a module provides, { module, action, why }.
function buildCatalog(manifests) {
  const tools = [];
  const leftOut = [];
  for (const m of manifests || []) {
    for (const a of (m && m.actions && m.actions.provides) || []) {
      const why = whyLeftOut(m.id, a);
      if (why) { leftOut.push({ module: m.id, action: a.name, why }); continue; }
      tools.push({ name: `${m.id}${SEP}${a.name}`, module: m.id, action: a.name, label: a.label, description: a.description, effect: a.effect, input: { ...a.input }, schema: inputSchema(a.input) });
    }
  }
  tools.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  return { tools, leftOut };
}

// A model's input for a tool, checked against its schema: { ok: true, input } or { ok: false, error } with one sentence the
// model is sent back. Numbers stay numbers; turning them into pointers, and the bus's own checks, are the caller's.
function checkToolInput(tool, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: "The input must be named fields, as the tool's schema says." };
  const { properties, required } = tool.schema;
  for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) return { ok: false, error: `${tool.name} takes no ${String(key).slice(0, 40)}.` };
  for (const key of required) if (value[key] === undefined || value[key] === null) return { ok: false, error: `${key} is needed.` };
  const input = {};
  for (const [key, s] of Object.entries(properties)) {
    const v = value[key];
    if (v === undefined || v === null) continue;
    if (s.type === 'integer') {
      if (!Number.isInteger(v) || v < s.minimum) return { ok: false, error: `${key} must be the number n of ${word('object', { a: true })} shown in this question.` };
    } else if (s.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `${key} must be a number.` };
    } else if (s.type === 'boolean') {
      if (typeof v !== 'boolean') return { ok: false, error: `${key} must be true or false.` };
    } else {
      if (typeof v !== 'string') return { ok: false, error: `${key} must be text.` };
      if (s.pattern && !new RegExp(s.pattern).test(v)) return { ok: false, error: `${key} must be a date, YYYY-MM-DD.` };
      if (s.format === 'date-time' && Number.isNaN(new Date(v).getTime())) return { ok: false, error: `${key} must be a date and time.` };
      if ([...v].length > (s.maxLength || Infinity)) return { ok: false, error: `${key} is at most ${s.maxLength} characters.` };
      if (s.minLength && !v.trim()) return { ok: false, error: `${key} is needed.` };
    }
    input[key] = v;
  }
  return { ok: true, input };
}

module.exports = { cleanActionAi, buildCatalog, inputSchema, checkToolInput, whyLeftOut, EFFECTS, MAX_DESCRIPTION, TOOL_NAME_RE, SEP };
