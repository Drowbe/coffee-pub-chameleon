// answer@1: the final answer as a tool (plan-ai-integration.md, "Slice 2": "The final answer is a tool too"). Its input is the
// ask template's output contract, { answer, objects, used } (server/prompts/object-rule.js answerSchema); the loop ends when
// the model calls it, and on the last round it is the only tool offered.
'use strict';

const tool = {
  id: 'answer',
  version: 1,
  final: true,
  description: () => 'Give your answer to the question. Always finish by calling this, once.',
  // The schema is the template's output contract, passed in (it depends on the kinds the environment's modules take).
  schema: (_w, contract) => contract,
  result: null, // the loop ends
  check: (raw) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? { ok: true, input: raw } : { ok: false, error: 'answer takes the shape it was given.' }),
};

module.exports = { tool };
