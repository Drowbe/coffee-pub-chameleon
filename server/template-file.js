// A template as a file (documentation/plans/plan-environment-templates.md, addendum 2, "Template files"; the shape:
// plan-templates-redesign.md, "The template, as stored"): `<name>.template.json`, holding { format: "template",
// formatVersion: 1, ...the template's fields } (the marker: server/file-format.js, plan-kind-names.md). At most 128 KB.
// Reading one checks it exactly as a bundled, host or owner's template is checked (server/templates.js): a key it does
// not know is refused, never dropped, since a file is the easiest way to hand a server a hostile template.
'use strict';

const templates = require('./templates');
const themeFile = require('./theme-file');
const { productName } = require('./product-name');
const fileFormat = require('./file-format');

const TEMPLATE_FILE_VERSION = fileFormat.FORMAT_VERSIONS.template;
const MAX_TEMPLATE_FILE_BYTES = templates.MAX_TEMPLATE_BYTES;
const NOT_A_TEMPLATE_FILE = `That isn't a ${productName()} template file.`;
const NEWER = `This template was made by a newer version of ${productName()}.`;
const OLD_TEMPLATE_FILE = fileFormat.OLD_SENTENCES.template;

class TemplateFileError extends Error {
  constructor(message, status = 400, problems = null) {
    super(message);
    this.status = status;
    if (problems) this.problems = problems;
  }
}

// The file for a template as the server keeps it (templates.cleanTemplate's shape, from any source): its fields, without
// those it leaves empty.
function templateToFile(t) {
  return { ...fileFormat.stamp('template'), ...templates.storedFields(t) };
}

function templateFileName(name) {
  return `${themeFile.safeFileStem(name, 'template')}.template.json`;
}

// Checks a file (its text, or JSON already parsed) and answers { raw }: the template's own fields, valid by problemsOf.
// Refusals, in order: too big, not JSON, not an object, format not "template", formatVersion missing or not a whole
// number -> NOT_A_TEMPLATE_FILE; a marker from before the formats were named by kind -> OLD_TEMPLATE_FILE; a newer
// formatVersion -> NEWER; then what is left must be a valid template (the first problem is the error; `problems` lists
// them all). `manifests`: the modules the template may name (server/templates.js problemsOf).
function readTemplateFile(input, { manifests = null, byteLength = null } = {}) {
  let file = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
    if (Buffer.byteLength(text) > MAX_TEMPLATE_FILE_BYTES) throw new TemplateFileError(NOT_A_TEMPLATE_FILE);
    try { file = JSON.parse(text); } catch { throw new TemplateFileError(NOT_A_TEMPLATE_FILE); }
  } else if (byteLength !== null && byteLength > MAX_TEMPLATE_FILE_BYTES) {
    throw new TemplateFileError(NOT_A_TEMPLATE_FILE);
  }
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new TemplateFileError(NOT_A_TEMPLATE_FILE);
  const marker = fileFormat.readMarker(file, 'template');
  if (marker === 'old') throw new TemplateFileError(OLD_TEMPLATE_FILE);
  if (marker === 'newer') throw new TemplateFileError(NEWER);
  if (marker !== 'ok') throw new TemplateFileError(NOT_A_TEMPLATE_FILE);
  // Every key but the marker, as own keys (fromEntries, never assignment, so a "__proto__" key stays a key and is refused).
  const raw = Object.fromEntries(Object.entries(file).filter(([key]) => key !== 'format' && key !== 'formatVersion'));
  const problems = templates.problemsOf(raw, { manifests });
  if (problems.length) throw new TemplateFileError(problems[0], 400, problems);
  return { raw };
}

module.exports = { TEMPLATE_FILE_VERSION, MAX_TEMPLATE_FILE_BYTES, NOT_A_TEMPLATE_FILE, NEWER, OLD_TEMPLATE_FILE, TemplateFileError, templateToFile, templateFileName, readTemplateFile };
