// The checks a tool's input shares (server/prompts/tools/). A model's tool input is untrusted: every tool checks it before it
// runs, and a bad one is a tool error naming the problem, sent back to the model, never run.
'use strict';

const MAX_WORDS = 200;
const MAX_KIND = 40;

const fail = (error) => ({ ok: false, error });
const listOr = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`);

// {} when `raw` is a plain object with only `keys`, else { error }.
function plainObject(raw, name, keys) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `${name} takes { ${keys.join(', ')} }.` };
  for (const k of Object.keys(raw)) {
    if (!keys.includes(k)) return { error: `${name} has no ${String(k).replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 40) || 'such field'}; give ${listOr(keys)}.` };
  }
  return {};
}

// A day as YYYY-MM-DD that is a real date, else ''.
function dayText(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return '';
  const day = v.trim();
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === day ? day : '';
}

module.exports = { MAX_WORDS, MAX_KIND, fail, plainObject, dayText };
