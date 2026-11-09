// A template's typed inputs (plan-ai-integration.md, "The prompt registry"), checked before anything is rendered. A wrong
// input is a server error (InputError, a plain Error with status 500), never a prompt: the routes refuse a person's bad
// question themselves, with a sentence, before an input is made.
'use strict';

const { KINDS } = require('../object-format');

const MIN_QUESTION = 3;
const MAX_QUESTION = 1000;
const MAX_MATERIAL = 12;
const MAX_TURNS = 6;
// Words a module attached to the question (host.chat.attach): their own part, as long as an attached object's text, and the
// label that names where they came from (plan-ai-pictures.md, decision 10).
const MAX_ATTACHED = 8000;
const MAX_ATTACHED_LABEL = 60;
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

// Attached words as a person's page may send them: line breaks kept, every other control character, the line and paragraph
// separators and the characters that turn text around (direction marks, embeddings, overrides, isolates) taken out. Plain
// text only: nothing here reads HTML, and the page draws it with textContent.
const DIRECTION = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
const cleanAttachedText = (t) => String(t == null ? '' : t).replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/(?![\n\t])\p{Cc}/gu, '').replace(DIRECTION, '').trim();
// The label: one short line, cleaned the same way, cut at MAX_ATTACHED_LABEL.
const cleanAttachedLabel = (t) => [...cleanAttachedText(t).replace(/\s+/g, ' ')].slice(0, MAX_ATTACHED_LABEL).join('').trim();

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
  attached(v) {
    if (v === null) return;
    if (!v || typeof v !== 'object' || !isText(v.label) || !v.label || !isText(v.text) || !v.text) throw new InputError('attached must be null or { label, text }');
    if ([...v.label].length > MAX_ATTACHED_LABEL || [...v.text].length > MAX_ATTACHED) throw new InputError(`attached is at most ${MAX_ATTACHED} characters, its label ${MAX_ATTACHED_LABEL}`);
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
    // An optional input (a template's `optional`) may be left out; one given is checked all the same.
    if (inputs[name] === undefined && (template.optional || []).includes(name)) continue;
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

module.exports = { InputError, checkInputs, cleanQuestion, cleanData, cleanAttachedText, cleanAttachedLabel, MIN_QUESTION, MAX_QUESTION, MAX_MATERIAL, MAX_TURNS, MAX_ATTACHED, MAX_ATTACHED_LABEL };
