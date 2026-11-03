// Reading a model's answer back (plan-ai-integration.md, "The prompt registry": `parse`). Two ways in: a structured answer
// (the provider took the output contract's schema) read as JSON, and prompt-then-parse for a service without structured
// output, which reads one fenced objects block out of Markdown. Both keep only what cleanObject keeps, never more than
// MAX_SUMMARIES, and both keep the complete objects of an answer that was cut off and drop the partial one (ai-04).
// Moved here from server/ai.js (parseSummaries, parseTags, citedItems and their helpers), unchanged in what they read.
'use strict';

const { ICONS, KINDS, cleanObject } = require('../object-format');

const MAX_SUMMARIES = 20;
const MAX_TAGS = 6;
const MAX_ANSWER_CHARS = 16000;

const oneLine = (s, n) => String(s == null ? '' : s).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function cleanSummary(raw, count) {
  return cleanObject(raw, { count });
}

// Does a parsed value look like objects of ours, even if they would not all validate? A non-empty list of plain objects,
// each with a title or content and at least one of our own markers (an icon, kind or basis we know, or a sources list).
// Anything else (a user's JSON example, code) is not ours and is never touched.
const BASES_SEEN = ['general', 'items', 'both'];
function looksLikeObjects(parsed) {
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (!list.length || list.length > 100) return false;
  return list.every((o) => o && typeof o === 'object' && !Array.isArray(o)
    && (typeof o.title === 'string' || typeof o.content === 'string')
    && (ICONS.includes(o.icon) || KINDS.includes(o.kind) || BASES_SEEN.includes(o.basis) || Array.isArray(o.sources)));
}

// The end index (exclusive) of the JSON value that starts at `at` in `text` (a [ or {), or -1.
function jsonEnd(text, at) {
  let depth = 0;
  let inStr = false;
  for (let i = at; i < text.length && i - at < 20000; i++) {
    const ch = text[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

// The complete objects at the start of a list that may stop in the middle: each `{...}` that closes and parses, in order, up to the
// first one that does not.
function salvage(body) {
  const list = [];
  let pos = 0;
  const lead = /^\s*\[/.exec(body);
  if (lead) pos = lead[0].length;
  while (pos < body.length) {
    pos += /^[\s,]*/.exec(body.slice(pos))[0].length;
    if (body[pos] !== '{') break;
    const end = jsonEnd(body, pos);
    if (end < 0) break;
    try { list.push(JSON.parse(body.slice(pos, end))); } catch { break; }
    pos = end;
  }
  return list;
}

// Prompt-then-parse. The answer with its valid summaries taken out and each replaced by a marker line {{summary:0}},
// {{summary:1}} for the page to draw in place, and the summaries. Blocks labelled objects are read, and, for a model that labels
// its block loosely, summary, json or no label. (A block with no closing fence is an answer that was cut off: see `cut` below.)
// Raw JSON never stays in the text (issue #341): a block labelled objects or summary that does not read is dropped; a json or
// unlabelled block, and JSON written inline outside any fence, is dropped when it looks like our objects (looksLikeObjects),
// and read as summaries when it validly parses. Other fenced code and other JSON are left alone.
function parseSummaries(text, count, max = MAX_SUMMARIES) {
  const summaries = [];
  let cut = false;
  const take = (parsed) => {
    const start = summaries.length;
    for (const raw of Array.isArray(parsed) ? parsed : [parsed]) {
      if (summaries.length >= max) break;
      const summary = cleanSummary(raw, count);
      if (summary) summaries.push(summary);
    }
    return summaries.slice(start).length ? '\n' + summaries.slice(start).map((_, i) => `{{summary:${start + i}}}`).join('\n') + '\n' : '';
  };
  const inline = (segment) => {
    let out = '';
    let i = 0;
    while (i < segment.length) {
      const ch = segment[i];
      if ((ch === '[' || ch === '{') && /^[[{]\s*(\{|")/.test(segment.slice(i, i + 20))) {
        const end = jsonEnd(segment, i);
        let parsed;
        if (end > 0) { try { parsed = JSON.parse(segment.slice(i, end)); } catch { parsed = undefined; } }
        if (parsed !== undefined && looksLikeObjects(parsed)) {
          out += summaries.length >= max ? '' : take(parsed);
          i = end;
          continue;
        }
        // Our objects' shape that closes but does not read (a placeholder such as [<numbers>] left in, a stray comma): dropped,
        // never shown raw (#341). Text that only mentions a field is not JSON and is left alone.
        if (parsed === undefined && end > 0 && /^[[{]\s*\{?\s*"(icon|kind|basis|title)"\s*:/.test(segment.slice(i, i + 40)) && /"(icon|basis|sources)"\s*:/.test(segment.slice(i, end))) {
          i = end;
          continue;
        }
        // Our objects that stop before they close: the answer ran out. Keep the complete ones, drop the rest.
        if (end < 0 && segment.length - i < 20000 && /"(icon|kind|basis|sources)"/.test(segment.slice(i, i + 300))) {
          cut = true;
          out += summaries.length >= max ? '' : take(salvage(segment.slice(i)));
          break;
        }
      }
      out += ch;
      i++;
    }
    return out;
  };
  const fenced = String(text).replace(/```(objects|summary|json)?[ \t]*\n([\s\S]*?)\n?```/g, (whole, label, body) => {
    const ours = label === 'objects' || label === 'summary';
    if (summaries.length >= max) return whole;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return ours ? '\n' : whole; }
    const marks = take(parsed);
    if (marks) return marks;
    return ours || looksLikeObjects(parsed) ? '\n' : whole;
  });
  // An objects block with no closing fence is an answer that stopped in the middle of it: the objects that are complete are kept,
  // the rest is dropped (never shown as raw JSON) and the answer is marked cut. Other unclosed code stays as it is.
  let rest = fenced;
  if ((rest.match(/```/g) || []).length % 2 === 1) {
    const at = rest.lastIndexOf('```');
    const open = /^```(objects|summary|json)?[ \t]*\n?([\s\S]*)$/.exec(rest.slice(at));
    if (open && (open[1] === 'objects' || open[1] === 'summary' || /^\s*[[{]\s*\{?\s*"(icon|kind|basis|sources)"/.test(open[2]))) {
      cut = true;
      rest = rest.slice(0, at) + (summaries.length >= max ? '' : take(salvage(open[2])));
    }
  }
  // What is left outside any fence (a leftover fence stays as it is: code the person asked for).
  const out = rest.split(/(```[\s\S]*?(?:```|$))/).map((part, i) => (i % 2 ? part : inline(part))).join('');
  return { text: out.replace(/\n{3,}/g, '\n\n').trim(), summaries, ...(cut ? { cut } : {}) };
}

// Tags from an answer: a JSON array of strings, or failing that the lines and commas of the text. HTML is stripped first
// (ai-25), then each is one short lower-case phrase.
function parseTags(input) {
  let list = [];
  if (Array.isArray(input)) list = input;
  else {
    const text = String(input == null ? '' : input);
    const m = /\[[\s\S]*\]/.exec(text);
    if (m) { try { const v = JSON.parse(m[0]); if (Array.isArray(v)) list = v; } catch { /* fall through to words */ } }
    if (!list.length) list = text.split(/[\n,]/);
  }
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string' && typeof t !== 'number') continue;
    const tag = oneLine(String(t).replace(/<[^>]{0,200}>/g, ' '), 30).toLowerCase().replace(/^[#\-*\d.\s]+/, '').replace(/[^a-z0-9 -]/g, '').trim();
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

// The numbers an answer names as [1], [2, 3]: only real ones.
function citedItems(text, count) {
  const used = new Set();
  for (const m of String(text).matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) for (const n of m[1].split(',')) if (+n >= 1 && +n <= count) used.add(+n);
  return [...used].sort((a, b) => a - b);
}

// A value with every null (and every empty string) taken out, as strict structured output writes an unknown field.
function dropNulls(v) {
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map(dropNulls);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined && x !== '') out[k] = dropNulls(x);
    return out;
  }
  return v;
}

// The string value that starts at `at` (just after its opening quote), read as far as it goes: { value, end } with end -1
// when the string never closes (an answer cut off in the middle of it).
function readString(text, at) {
  let raw = '';
  for (let i = at; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { raw += ch + (text[i + 1] ?? ''); i++; continue; }
    if (ch === '"') {
      try { return { value: JSON.parse(`"${raw}"`), end: i + 1 }; } catch { return { value: '', end: i + 1 }; }
    }
    raw += ch;
  }
  // Cut off: what was written, without a half escape at the end.
  const safe = raw.replace(/\\u?[0-9a-fA-F]{0,3}$/, '').replace(/\\$/, '');
  try { return { value: JSON.parse(`"${safe}"`), end: -1 }; } catch { return { value: '', end: -1 }; }
}

// A structured answer's JSON that may have stopped in the middle (finish `length`): the answer text as far as it got, the
// objects that closed, and whatever `used` holds. null when it is not the contract's shape at all.
function salvageStructured(text) {
  const s = String(text);
  const out = {};
  const a = /"answer"\s*:\s*"/.exec(s);
  if (a) out.answer = readString(s, a.index + a[0].length).value;
  const o = /"objects"\s*:\s*\[/.exec(s);
  if (o) out.objects = salvage(s.slice(o.index + o[0].length - 1));
  const u = /"used"\s*:\s*\[([\d\s,]*)\]/.exec(s);
  if (u) out.used = u[1].split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x));
  return a || o ? out : null;
}

// A structured `{ answer, objects, used }` (already parsed, or its text) read against `count` numbered objects: { text,
// summaries, used, cut? }. The answer text is read with parseSummaries too, so an object a model wrote into its answer
// anyway never shows as raw JSON (#341), and lands with the others.
function readAnswer(value, rawText, count, max = MAX_SUMMARIES) {
  let doc = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  let cut = false;
  if (!doc) {
    try { const v = JSON.parse(String(rawText || '')); if (v && typeof v === 'object' && !Array.isArray(v)) doc = v; } catch { /* below */ }
  }
  if (!doc) {
    doc = salvageStructured(rawText);
    if (doc) cut = true;
  }
  if (!doc) return null;
  const inText = parseSummaries(String(typeof doc.answer === 'string' ? doc.answer : '').slice(0, MAX_ANSWER_CHARS), count, max);
  const summaries = inText.summaries.slice();
  for (const raw of Array.isArray(doc.objects) ? doc.objects : []) {
    if (summaries.length >= max) break;
    const summary = cleanSummary(dropNulls(raw), count);
    if (summary) summaries.push(summary);
  }
  const used = [...new Set([...(Array.isArray(doc.used) ? doc.used : []), ...citedItems(inText.text, count)].filter((n) => Number.isInteger(n) && n >= 1 && n <= count))].sort((x, y) => x - y);
  return { text: inText.text, summaries, used, ...(cut || inText.cut ? { cut: true } : {}) };
}

module.exports = { MAX_SUMMARIES, MAX_TAGS, MAX_ANSWER_CHARS, cleanSummary, looksLikeObjects, jsonEnd, salvage, parseSummaries, parseTags, citedItems, dropNulls, readAnswer, salvageStructured };
