// The data message of an ask or a summary: the context builder's rollup and the attached material as one JSON document
// (plan-ai-integration.md, "Rendering"). Its parts in a fixed order, stable first, each left out when empty.
'use strict';

// One attached object as the model reads it: its number, kind, title, date and place, and its text.
const attachedOf = (m) => ({ n: m.n, ...(m.kind ? { kind: m.kind } : {}), title: m.title, ...(m.when ? { when: m.when } : {}), ...(m.place ? { place: m.place } : {}), text: m.text });

function document(context, material, attached = null) {
  const c = context || {};
  const doc = {};
  if (c.space) doc.space = c.space;
  if (c.today) doc.today = c.today;
  if (Array.isArray(c.phases) && c.phases.length) doc.phases = c.phases;
  if (c.asker) doc.asker = c.asker;
  if (material.length) doc.attached = material.map(attachedOf);
  // Words a module attached, their own part after the attached objects: quoted data, never an instruction (ask@3).
  if (attached) doc.attachedWords = { label: attached.label, text: attached.text };
  for (const part of ['relevant', 'linked', 'chat', 'members']) if (Array.isArray(c[part]) && c[part].length) doc[part] = c[part];
  return doc;
}

module.exports = { document, attachedOf };
