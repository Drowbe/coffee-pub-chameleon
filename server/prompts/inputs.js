// A template's typed inputs (plan-ai-integration.md, "The prompt registry"), checked before anything is rendered. A wrong
// input is a server error (InputError, a plain Error with status 500), never a prompt: the routes refuse a person's bad
// question themselves, with a sentence, before an input is made.
'use strict';

const { KINDS } = require('../object-format');

const MIN_QUESTION = 3;
const MAX_QUESTION = 1000;
const MAX_MATERIAL = 12;
const MAX_TURNS = 6;
// The template's words a prompt uses (server/words.js's, for this environment).
const WORD_KEYS = ['object', 'objects', 'space'];

class InputError extends Error {
  constructor(message) {
    super(`prompt input: ${message}`);
    this.status = 500;
  }
}

const isText = (v) => typeof v === 'string';
const optionalText = (v) => v === undefined || typeof v === 'string';

// The question as a person typed it: line breaks kept, other control characters taken out, trimmed. Not cut: a question
// over MAX_QUESTION is refused at the route (ai-22).
const cleanQuestion = (q) => String(q == null ? '' : q).replace(/\r\n?/g, '\n').replace(/(?![\n\t])\p{Cc}/gu, '').trim();

const CHECKS = {
  question(v) {
    if (!isText(v)) throw new InputError('question must be a string');
    const n = [...v].length;
    if (n < MIN_QUESTION || n > MAX_QUESTION) throw new InputError(`question must be ${MIN_QUESTION} to ${MAX_QUESTION} characters`);
  },
  material(v) {
    if (!Array.isArray(v) || v.length > MAX_MATERIAL) throw new InputError(`material must be a list of up to ${MAX_MATERIAL}`);
    for (const m of v) {
      if (!m || typeof m !== 'object' || !Number.isInteger(m.n) || m.n < 1 || !isText(m.title) || !isText(m.text) || !optionalText(m.kind) || !optionalText(m.when) || !optionalText(m.place)) {
        throw new InputError('each material entry is { n, kind?, title, when?, place?, text }');
      }
    }
  },
  context(v) {
    if (v !== null && (typeof v !== 'object' || Array.isArray(v))) throw new InputError('context must be {} or null');
  },
  history(v) {
    if (!Array.isArray(v) || v.length > MAX_TURNS) throw new InputError(`history must be a list of up to ${MAX_TURNS} turns`);
    for (const t of v) if (!t || !isText(t.question) || !isText(t.answer)) throw new InputError('each turn is { question, answer }');
  },
  kinds(v) {
    if (!Array.isArray(v) || v.some((k) => !KINDS.includes(k))) throw new InputError('kinds must be a list of known kinds');
  },
  words(v) {
    if (!v || typeof v !== 'object' || !WORD_KEYS.every((k) => isText(v[k]) && v[k])) throw new InputError(`words must name ${WORD_KEYS.join(', ')}`);
  },
};

// Throws InputError unless `inputs` holds exactly what the template takes, each of its type.
function checkInputs(template, inputs) {
  if (!inputs || typeof inputs !== 'object') throw new InputError('inputs must be {}');
  for (const name of Object.keys(inputs)) if (!template.inputs.includes(name)) throw new InputError(`${template.id} does not take ${name}`);
  for (const name of template.inputs) {
    if (inputs[name] === undefined) throw new InputError(`${template.id} needs ${name}`);
    CHECKS[name](inputs[name]);
  }
}

// Every string in a data document with NUL taken out and a run of backticks written as quotes: the document is JSON (so no
// text can close a marker), and this keeps a model that reads it as Markdown from seeing a fence in it either.
function cleanData(v) {
  if (typeof v === 'string') return v.replace(/\u0000/g, '').replace(/`{3,}/g, "'''");
  if (Array.isArray(v)) return v.map(cleanData);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, cleanData(x)]));
  return v;
}

module.exports = { InputError, checkInputs, cleanQuestion, cleanData, MIN_QUESTION, MAX_QUESTION, MAX_MATERIAL, MAX_TURNS };
