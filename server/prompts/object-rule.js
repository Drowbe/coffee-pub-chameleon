// The objects rule: how a model is told to write the objects worth keeping (plan-object-handoff.md, "The prompt"), and
// the output contract's JSON schema (plan-ai-integration.md, "The prompt registry"). Moved here from
// server/object-format.js, which keeps the catalogue (KINDS, DETAILS, ICONS) and the reader (cleanObject, readObjects)
// this rule describes. The paste template and the in-app templates share these lines so they cannot drift.
'use strict';

const { KINDS, TRAVEL_KINDS, DETAILS, ICONS, BASES } = require('../object-format');

const listWords = (list, last = 'or') => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${last} ${list[list.length - 1]}`);

// The example. Every value is a placeholder in <angle brackets>, never a real-looking one: a model that copies the
// example writes an object whose title is still a placeholder, and the reader drops it (isPlaceholder, in cleanObject).
// A flight's when flights are taken, else a plain object.
const FLIGHT_EXAMPLE = '{"icon":"plane","kind":"flight","title":"<title>","content":"<notes; plain prose, or simple Markdown>","date":"<YYYY-MM-DD>","details":{"airline":"<airline>","number":"<number>","from":{"code":"<code>","name":"<name>"},"to":{"code":"<code>","name":"<name>"},"departs":"<YYYY-MM-DDTHH:MM>","arrives":"<YYYY-MM-DDTHH:MM>","reference":"<reference>"},"tags":["<tag>"],"place":{"name":"<name>"},"links":[{"title":"<title>","url":"<url>"}]}';
function promptExample(kinds, withProvenance) {
  const example = kinds.includes('flight')
    ? FLIGHT_EXAMPLE
    : `{"icon":"note",${kinds.length ? `"kind":"${kinds[0]}",` : ''}"title":"<title>","content":"<the text to keep; plain prose, or simple Markdown (headings, **bold**, *italic*, lists, links) if that reads better>","date":"<YYYY-MM-DD>","tags":["<tag>"],"place":{"name":"<name>"},"links":[{"title":"<title>","url":"<url>"}]}`;
  return withProvenance ? `${example.slice(0, -1)},"basis":"<basis>","sources":[<numbers>]}` : example;
}

// What a details field needs said beside its name. A `when` is explained once, in the dates line.
const FIELD_NOTES = { 'flight.minutes': 'time in the air', 'car.from': 'pick-up', 'car.to': 'drop-off', 'car.departs': 'pick-up', 'car.arrives': 'drop-off', 'restaurant.name': "the booking's name", 'cafe.name': "the booking's name", 'bar.name': "the booking's name" };
const TYPE_NOTES = { flag: 'true or false', options: '2 to 10 short answers' };
const KIND_NOTES = { hotel: 'any stay: hotel, rental, hostel' };

// One line per kind, or per run of kinds with the same fields ("restaurant, cafe, bar: ..."), for the kinds listed.
function detailsLines(kinds) {
  const lines = [];
  let pointsSaid = false;
  const empty = kinds.filter((k) => !Object.keys(DETAILS[k]).length);
  const groups = [];
  for (const k of kinds.filter((x) => Object.keys(DETAILS[x]).length)) {
    const last = groups[groups.length - 1];
    if (last && JSON.stringify(DETAILS[last[0]]) === JSON.stringify(DETAILS[k])) last.push(k);
    else groups.push([k]);
  }
  for (const group of groups) {
    const fields = DETAILS[group[0]];
    const both = fields.from === 'point' && fields.to === 'point';
    const words = [];
    let merged = false;
    for (const [name, type] of Object.entries(fields)) {
      const note = FIELD_NOTES[`${group[0]}.${name}`] || TYPE_NOTES[type.split(':')[0]];
      if (both && name === 'from' && !pointsSaid) {
        pointsSaid = true;
        merged = true;
        words.push(`from and to ({"code","name"}${note ? `; ${note} and ${FIELD_NOTES[`${group[0]}.to`]}` : ''})`);
      } else if (!(merged && name === 'to')) {
        words.push(note ? `${name} (${note})` : name);
      }
    }
    lines.push(`- ${group.map((k) => (KIND_NOTES[k] ? `${k} (${KIND_NOTES[k]})` : k)).join(', ')}: ${words.join(', ')}`);
  }
  if (empty.length) {
    const link = empty.includes('link');
    lines.push(`- ${listWords(empty, 'and')}: no details${link ? `; ${empty.length > 1 ? "a link's" : 'its'} address goes in "links"` : ''}.`);
  }
  return lines;
}

// The kinds a rule lists, in the catalogue's order.
const listedKinds = (kinds = TRAVEL_KINDS) => KINDS.filter((k) => kinds.includes(k));

// The lines about each object's fields, after the shape: one per thing, the kinds, dates, details, icons and the rest.
// `withProvenance`: an in-app answer's "basis" and "sources"; it also cannot stop to ask for a date, so it says which it needs.
// `numbers`: what an in-app answer's sources are called (the data's numbers "n").
function fieldLines({ noun, kinds = TRAVEL_KINDS, withProvenance, numbers = 'the item numbers you used' }) {
  const listed = listedKinds(kinds);
  const travel = listed.some((k) => TRAVEL_KINDS.includes(k));
  const hasDetails = listed.some((k) => Object.keys(DETAILS[k]).length);
  const lines = [`One ${noun} per thing.${travel ? ` A whole itinerary is one ${noun} for each flight, train, stay, meal, visit and event, in the order they happen; a return flight is its own ${noun}.` : ''} Never fold several into one ${noun}'s text.`];
  if (listed.length) lines.push(`Set "kind" to what the ${noun} is: ${listWords(listed)}. Leave it out only when none fits.`);
  // A booking at a set time is still its travel kind, so it lands in the trip's plan rather than the calendar.
  const travelListed = listed.filter((k) => TRAVEL_KINDS.includes(k));
  if (travelListed.length && listed.includes('event')) {
    lines.push(`For a booking or a stop on a trip, use its own kind (${listWords(travelListed)}) rather than "event", even when it happens at a set time; use "event" only for anything else on a day, such as an appointment or a party.`);
  }
  const missing = withProvenance
    ? 'If something happens on a day you were not told, leave its date out and say in your answer which dates you still need.'
    : 'If something happens on a day you were not told, ask me for the date before you write the block; if I do not know, leave the date out.';
  lines.push(`Dates and times: copy them from what I gave you; never guess a date or a year. ${missing} ${hasDetails
    ? 'Write a date as YYYY-MM-DD and a date with a time as YYYY-MM-DDTHH:MM, 24-hour, in the local time where it happens, with no time zone. If you know only the time, write HH:MM. Put the day in "date" as well.'
    : 'Write a date as YYYY-MM-DD.'}`);
  if (listed.length) {
    lines.push(hasDetails
      ? `"details" holds what a booking or plan says. Every field is optional; leave out what you do not know, and write nothing in "content" that is already in "details":`
      : 'These kinds take no "details":');
    lines.push(...detailsLines(listed));
  }
  const tail = withProvenance
    ? `"basis" says where the ${noun} comes from: "general" (your own knowledge), "items" (the data) or "both". "sources" are ${numbers}.`
    : 'Keep each title under 80 characters and each content under 6000. Links must start with http:// or https://.';
  const leave = hasDetails
    ? 'Leave out tags, place and links when you have nothing for them, and content when "details" says it all.'
    : 'Leave out tags, place and links when you have nothing for them.';
  lines.push(`The icon is one of: ${ICONS.join(', ')}. ${tail} ${leave} Add no fields other than these.`);
  return lines;
}

// The rule for one fenced objects block, as the paste template writes it (the published instructions): the fence, the
// example inside it, then the field lines.
function fencedRule({ fence, noun, max, kinds = TRAVEL_KINDS }) {
  return [
    `single fenced block (exactly one, never one per ${noun}), at most ${max}:`,
    `\`\`\`${fence}`,
    `[${promptExample(listedKinds(kinds), false)}]`,
    '```',
    'Text in <angle brackets> is a placeholder: write a real value, never the brackets.',
    ...fieldLines({ noun, kinds, withProvenance: false }),
  ].join('\n');
}

// The same rule for an in-app answer read back by prompt-then-parse (a service without structured output). The example
// is never written inside a fence, so a model echoing its instructions gives back no block the parser reads.
function answerRule({ fence, noun, max, kinds = TRAVEL_KINDS, numbers }) {
  return [
    `Put every ${noun} worth keeping in one JSON array inside a single fenced block labelled ${fence} (three backticks and the word ${fence} on its own line before it, three backticks on their own line after it): exactly one block, never one per ${noun}, at most ${max}, after your answer. ${noun.charAt(0).toUpperCase()}${noun.slice(1)}s go only in that block, never inline in your answer text. Each one looks like this:`,
    promptExample(listedKinds(kinds), true),
    'Text in <angle brackets> is a placeholder: write a real value, never the brackets.',
    ...fieldLines({ noun, kinds, withProvenance: true, numbers }),
  ].join('\n');
}

// --- the output contract as a JSON schema (structured output) ---------------------------------------------------------
// Written to the strictest form the providers take (OpenAI's strict mode): every object closed, every property
// required, an unknown value given as null. The reader drops the nulls and checks each object with cleanObject, so the
// schema describes what to write and never decides what is kept.
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
function valueSchema(type) {
  switch (type.split(':')[0]) {
    case 'when': return { type: 'string' };
    case 'point': return { type: 'object', additionalProperties: false, required: ['code', 'name'], properties: { code: nullable({ type: 'string' }), name: nullable({ type: 'string' }) } };
    case 'count': case 'minutes': return { type: 'integer' };
    case 'flag': return { type: 'boolean' };
    case 'options': return { type: 'array', items: { type: 'string' } };
    default: return { type: 'string' };
  }
}
// One details object holding every field of the kinds listed (a field two kinds share has one type).
function detailsSchema(kinds) {
  const fields = {};
  for (const k of kinds) for (const [name, type] of Object.entries(DETAILS[k])) if (!fields[name]) fields[name] = nullable(valueSchema(type));
  const names = Object.keys(fields);
  return names.length ? nullable({ type: 'object', additionalProperties: false, required: names, properties: fields }) : null;
}
function objectSchema(kinds) {
  const listed = listedKinds(kinds);
  const properties = {
    icon: { type: 'string', enum: ICONS.slice() },
    ...(listed.length ? { kind: nullable({ type: 'string', enum: listed }) } : {}),
    title: { type: 'string' },
    content: nullable({ type: 'string' }),
    date: nullable({ type: 'string' }),
    tags: { type: 'array', items: { type: 'string' } },
    place: nullable({ type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' } } }),
    links: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } } },
    basis: { type: 'string', enum: BASES.slice() },
    sources: { type: 'array', items: { type: 'integer' } },
  };
  const details = detailsSchema(listed);
  if (details) properties.details = details;
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}
// `{ answer, objects, used }` for ask and summarise.
function answerSchema(kinds) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'objects', 'used'],
    properties: {
      answer: { type: 'string', description: 'The answer, in Markdown.' },
      objects: { type: 'array', items: objectSchema(kinds), description: 'The things in the answer worth keeping; empty when there are none.' },
      used: { type: 'array', items: { type: 'integer' }, description: 'The numbers "n" in the data that the answer drew on.' },
    },
  };
}
// `{ tags }` for tags.
const TAGS_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, required: ['tags'], properties: { tags: { type: 'array', items: { type: 'string' } } } });

module.exports = { listWords, promptExample, detailsLines, fieldLines, fencedRule, answerRule, answerSchema, objectSchema, TAGS_SCHEMA, listedKinds };
