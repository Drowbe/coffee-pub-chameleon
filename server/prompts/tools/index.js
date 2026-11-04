// The tool registry (plan-ai-integration.md, "Slice 2: the first tools"): every tool the in-app AI may be offered, each a
// versioned entry with a plain description, an input schema, a result shape and an input check, golden-checked like the
// templates (tools/check-ai-tools.mjs, tools/golden/tools/). Any change to what a tool describes, takes or answers is a new
// version. Step 1 is core tools only, read only, with no change to any manifest: search_objects and read_object, and answer,
// the final answer as a tool.
//
// A tool's name in records is `<id>@<version>` (search_objects@1); the name sent to a provider is its id.
'use strict';

const KEPT = {
  search_objects: [require('./search_objects').tool],
  read_object: [require('./read_object').tool],
  answer: [require('./answer').tool],
};
const IDS = Object.keys(KEPT);
// The read tools (the look-ups), in the order they are offered; `answer` is offered with them and alone on the last round.
const LOOKUPS = ['search_objects', 'read_object'];
const ANSWER = 'answer';

const nameOf = (t) => `${t.id}@${t.version}`;
const tool = (id) => (Object.hasOwn(KEPT, id) ? KEPT[id][0] : null);
const allTools = () => IDS.flatMap((id) => KEPT[id]);

// A tool as a provider is offered it: { name, description, schema }. `words`: the template's words; `contract`: the answer's
// schema (the template's output contract), for `answer`.
function offer(id, words, contract) {
  const t = tool(id);
  if (!t) throw new Error(`no tool ${id}`);
  return { name: t.id, version: nameOf(t), description: t.description(words), schema: t.schema(words, contract) };
}

// The tools offered for one round: the look-ups and answer, or answer alone (`last`); none of the look-ups when `lookup` is off.
function offered({ words, contract, lookup = true, last = false }) {
  const ids = last || !lookup ? [ANSWER] : [...LOOKUPS, ANSWER];
  return ids.map((id) => offer(id, words, contract));
}

module.exports = { IDS, LOOKUPS, ANSWER, KEPT, nameOf, tool, allTools, offer, offered };
