// The context builder (plan-ai-integration.md, "The context builder"): what a model is given beside the question, built fresh
// for every question at the moment of asking and only read through the policy (server/ai-policy.js). Nothing it makes is
// stored except the counts on the answer (`sent`) and the call's record.
//
// buildContext(who, space, { template, question, refs, tz }) answers
//   { context, history, material, numbered, leftOut, sent, sees }
// - context: the rollup -- the space (name, its words), today in the asker's time zone, the phases and their dates, the
//   asker, then the relevant objects, the linked objects, the chat and the members, each only as the owner's setting allows;
// - history: the asker's own last turns here (a question and its answer), oldest first;
// - material: the attached objects with their text, numbered from 1; the rollup's objects carry on the numbering;
// - numbered: the pointer behind each number (numbered[n - 1]), for `used` and `sources`;
// - leftOut: [{ part, why, count }] for each cut: what the budget cut, what the setting kept out, what was from another space;
// - sent: the counts per category and the pointers attached, kept on a stored answer so its AI used: line reads the same later.
'use strict';

const { moduleAllowed } = require('./ai-policy');

const chars = (v) => (typeof v === 'string' ? v.length : JSON.stringify(v).length);
const tokensOf = (v) => Math.ceil(chars(v) / 4); // about four characters to a token, rounded up
const MAX_ITEM_CHARS = 8000;
const MAX_SPACE_NAME = 200;
const MAX_PHASES = 12;
const MAX_RELEVANT = 15;
const MAX_ROLLUP_OBJECTS = 30; // the matched ones plus the dated ones
const DATED_DAYS = 7;
const MAX_LINKED_EACH = 5;
const MAX_LINKED = 20;
const MAX_CHAT = 20;
const CHAT_TOKENS = 1500;
const MAX_CHAT_TEXT = 500;
const MAX_MEMBERS = 50;
const MAX_TURNS = 6;

// Words too common to say what a question is about.
const STOP = new Set('the and for are but not you all any can had her was one our out has his how its may new now see two who did get him let say she too use what when where which while with this that from they them then than there these those have will would could should about into over your just like some more most very also only been were what does want need tell know make many much each other here their'.split(' '));
const wordsOf = (s) => [...new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)))];

// Today in a time zone: { date: YYYY-MM-DD, weekday, timeZone }. A zone this server does not know is the server's.
function todayIn(tz, fallback, now = Date.now()) {
  let zone = fallback || 'UTC';
  if (typeof tz === 'string' && tz && tz.length <= 64) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); zone = tz; } catch { /* not a zone: the server's */ }
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, timeZone: zone };
}
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// A date or time as text: a string as it is; a number as a time in milliseconds (a Polls closesAt) when it is one, else its
// digits (a note's `date: 20261105`); anything else none. A model reads text, and a template's inputs take only text.
function whenText(v) {
  if (typeof v === 'string') return v;
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  if (v >= 1e11 && v <= 8.64e15) return new Date(v).toISOString().slice(0, 16).replace('T', ' ');
  return String(v);
}
const placeText = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.name === 'string' ? v.name : '');
const dayOf = (when) => { const w = whenText(when); return /^\d{4}-\d{2}-\d{2}/.test(w) ? w.slice(0, 10) : ''; };

// A summary (redacted by the policy) as a rollup object: no text.
function rollupObject(n, s, extra = {}) {
  const when = whenText(s.when);
  const end = whenText(s.end);
  const place = placeText(s.place);
  return { n, ...(s.kindName || s.kind ? { kind: s.kindName || s.kind } : {}), title: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}), ...(when ? { when } : {}), ...(end ? { end } : {}), ...(s.done ? { done: true } : {}), ...(place ? { place } : {}), ...extra };
}

// deps: { store, chatHistory, moduleLinks, policy, word, listObjects(who, { scope, space }) -> summaries, roleWordOf(user, space),
// guestsIn(space) -> [names], serverZone() -> zone, now() -> ms, templatePhases() -> phases, timelineOf (public/phases.js) }.
function createContextBuilder(deps) {
  const { chatHistory, moduleLinks, policy, word, listObjects, roleWordOf, guestsIn, serverZone, timelineOf, templatePhases } = deps;
  // Whether the asker may read this space's chat now (an owner may; otherwise a member whose rights here have chatRead).
  const canReadChat = deps.canReadChat || (() => false);
  const now = deps.now || Date.now;

  // The asker's own turns in this space, oldest first: [{ question, answer }]. A question is their private /ai message; its
  // answer the AI message that replies to it (kept theirs when they made it public). Never anyone else's, never deleted ones.
  function turnsOf(spaceId, userKey) {
    const list = chatHistory.list(spaceId, userKey);
    const questions = new Map(list.filter((m) => m.by === userKey && m.kind === 'command' && m.command === 'ai').map((m) => [m.id, m]));
    const turns = [];
    for (const m of list) {
      if (m.kind !== 'ai' || m.by !== userKey || !m.replyTo || !questions.has(m.replyTo)) continue;
      const q = questions.get(m.replyTo);
      const text = String(m.text || '').replace(/[ \t]*\{\{summary:\d+\}\}/g, '').replace(/\n{3,}/g, '\n\n').trim();
      const titles = (Array.isArray(m.summaries) ? m.summaries : []).map((s) => s && s.title).filter(Boolean);
      const answer = titles.length ? `${text}\n\n(${word('object', { many: true, cap: true })} kept from this answer: ${titles.join('; ')})` : text;
      if (q.text && answer) turns.push({ at: q.at, question: q.text, answer });
    }
    return turns.sort((a, b) => a.at - b.at).map(({ question, answer }) => ({ question, answer }));
  }

  // Each attached object's text shortened evenly to fit `maxChars` in all: an object under its share keeps all of its own.
  function shortenEvenly(material, maxChars) {
    let total = material.reduce((n, m) => n + m.text.length, 0);
    if (total <= maxChars) return 0;
    const sorted = material.slice().sort((a, b) => a.text.length - b.text.length);
    let left = maxChars;
    let shortened = 0;
    sorted.forEach((m, i) => {
      const share = Math.floor(left / (sorted.length - i));
      if (m.text.length > share) { m.text = `${m.text.slice(0, Math.max(0, share - 1))}…`; shortened += 1; }
      left -= m.text.length;
    });
    total = material.reduce((n, m) => n + m.text.length, 0);
    return shortened;
  }

  // `history: false`: no earlier turns even where the template takes them (a module's ask is not a conversation).
  // `from`: the module asking (a module's ask): only what that module may read is admitted (server/ai-policy.js admit).
  function build(who, space, { template, question = '', refs = [], tz, history: withHistory = true, from = null } = {}) {
    const sees = policy.sees(space);
    const secretList = policy.secrets();
    const budget = template.budget;
    const takes = (name) => template.inputs.includes(name);
    const leftOut = [];
    const note = (part, why, count = 1) => {
      const at = leftOut.find((l) => l.part === part && l.why === why);
      if (at) at.count += count; else leftOut.push({ part, why, count });
    };
    const notSent = [];
    const keptOut = (why, module, moduleName) => {
      const at = notSent.find((x) => x.why === why && x.module === module);
      if (at) at.count += 1; else notSent.push({ why, module, ...(moduleName ? { moduleName } : {}), count: 1 });
    };

    // The space, today and the phases, and the person: always sent.
    const today = todayIn(tz, serverZone(), now());
    const context = {};
    if (space) context.space = { name: String(space.name || '').slice(0, MAX_SPACE_NAME), word: word('space'), objectWord: word('object') };
    context.today = today;
    if (space) {
      const bands = timelineOf(templatePhases(), space.phases, { today: today.date, created: space.createdAt }).slice(0, MAX_PHASES);
      context.phases = bands.map((b) => ({ name: b.label, ...(b.start ? { start: b.start } : {}), ...(b.end ? { end: b.end } : {}), ...(b.current ? { current: true } : {}) }));
    }
    context.asker = { name: who.user.displayName, role: roleWordOf(who.user, space) };

    // The attached objects, with their text.
    const material = [];
    const numbered = [];
    const seen = new Set();
    const keyOf = (r) => `${r.module}|${r.kind}|${r.scope}|${r.space || ''}|${r.id}`;
    for (const ref of (Array.isArray(refs) ? refs : []).slice(0, 12)) {
      if (!ref || typeof ref !== 'object' || seen.has(keyOf(ref))) continue;
      seen.add(keyOf(ref));
      const got = policy.admit(who, space, ref, { sees, part: 'attached', withText: true, secretList, from });
      if (!got.ok) {
        if (got.why === 'other-space') { note('attached', 'other-space'); keptOut('other-space', got.module); }
        else if (got.why === 'setting') { note('attached', 'setting'); keptOut('setting', got.module); }
        continue; // unreadable: left out, never named
      }
      const s = got.summary;
      const title = typeof s.title === 'string' ? s.title : String(s.title ?? '');
      const text = [s.text, s.subtitle].filter((x) => (typeof x === 'string' && x) || (typeof x === 'number' && Number.isFinite(x))).map(String).join('\n').slice(0, MAX_ITEM_CHARS) || title;
      const kind = s.kindName || s.kind;
      const when = whenText(s.when);
      const place = placeText(s.place);
      material.push({ n: material.length + 1, ...(typeof kind === 'string' && kind ? { kind } : {}), title, ...(when ? { when } : {}), ...(place ? { place } : {}), text });
      numbered.push(got.ref);
    }
    const attachedRefs = numbered.slice();

    // The relevant objects: the best by word match of the question (and the last turn), plus the dated ones in the next days.
    let history = [];
    if (takes('history') && withHistory && sees.history && space) history = turnsOf(space.id, who.user.key).slice(-MAX_TURNS).map((t) => ({ question: policy.redact(t.question, secretList), answer: policy.redact(t.answer, secretList) }));
    let relevant = [];
    if (takes('context') && sees.relevant) {
      const pool = [];
      if (space) pool.push(...listObjects(who, { scope: 'space', space: space.id }));
      if (sees.environment === 'readable') pool.push(...listObjects(who, { scope: 'environment' }));
      const asked = wordsOf(`${question} ${history.length ? history[history.length - 1].question : ''}`);
      const until = addDays(today.date, DATED_DAYS);
      const scored = [];
      for (const s of pool) {
        if (!s || !s.ref || seen.has(keyOf(s.ref)) || !moduleAllowed(sees, s.ref.module)) continue;
        const hay = new Set(wordsOf(`${s.title} ${s.subtitle || ''} ${s.kindName || ''} ${s.category || ''} ${(s.place && s.place.name) || ''}`));
        const score = asked.filter((w) => hay.has(w)).length;
        const day = dayOf(s.when);
        const soon = day && day >= today.date && day <= until;
        if (score > 0 || soon) scored.push({ s, score, soon, day });
      }
      const matched = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || String(a.day || '9').localeCompare(String(b.day || '9')) || a.s.title.localeCompare(b.s.title)).slice(0, MAX_RELEVANT);
      const dated = scored.filter((x) => x.soon && !matched.includes(x)).sort((a, b) => a.day.localeCompare(b.day));
      for (const x of [...matched, ...dated].slice(0, MAX_ROLLUP_OBJECTS)) {
        const got = policy.admit(who, space, x.s.ref, { sees, part: 'relevant', secretList, from });
        if (!got.ok) continue; // the policy has the last word; what it keeps out here was never asked for
        seen.add(keyOf(got.ref));
        relevant.push({ ref: got.ref, s: got.summary });
      }
    }

    // The objects each attached one links to and that link to it, one step.
    let linked = [];
    if (takes('context') && sees.linked) {
      attachedRefs.forEach((ref, i) => {
        if (linked.length >= MAX_LINKED) return;
        let each = 0;
        for (const other of [...moduleLinks.from(ref), ...moduleLinks.to(ref)]) {
          if (each >= MAX_LINKED_EACH || linked.length >= MAX_LINKED) break;
          if (!other || seen.has(keyOf(other))) continue;
          const got = policy.admit(who, space, other, { sees, part: 'linked', secretList, from });
          if (!got.ok) continue; // never named: the person attached the one it links from, not this
          seen.add(keyOf(got.ref));
          linked.push({ ref: got.ref, s: got.summary, linkedTo: i + 1 });
          each += 1;
        }
      });
    }

    // The chat: the space's last public messages (never a private one), only when the setting has it on and the asker may
    // read the chat here.
    let chat = [];
    if (takes('context') && sees.chat && space && canReadChat(who, space)) {
      chat = chatHistory.list(space.id, null).filter((m) => m.visibility !== 'private' && m.text).slice(-MAX_CHAT)
        .map((m) => ({ who: m.who, text: policy.redact(String(m.text).replace(/[ \t]*\{\{summary:\d+\}\}/g, '').slice(0, MAX_CHAT_TEXT), secretList), at: new Date(m.at).toISOString().slice(0, 16) }));
      while (chat.length && tokensOf(chat) > CHAT_TOKENS) { chat.shift(); note('chat', 'budget'); }
    }

    // The members: display names and role words only; a guest's name only while they are in the space.
    let members = [];
    if (takes('context') && sees.members && space) {
      for (const key of space.members) {
        const u = deps.store.userByKey(key);
        if (u) members.push({ name: u.displayName, role: roleWordOf(u, space) });
      }
      for (const name of guestsIn ? guestsIn(space) : []) members.push({ name, role: word('guest') });
      members = members.slice(0, MAX_MEMBERS);
    }

    // History within its own budget, the oldest turns first to go.
    while (history.length && tokensOf(history) > budget.history) { history.shift(); note('history', 'budget'); }
    // The attached text within its own budget, shortened evenly.
    const shortened = shortenEvenly(material, budget.material * 4);
    if (shortened) note('attached', 'shortened', shortened);

    // The whole prompt within its budget, cut in the plan's order: chat, linked, relevant (lowest first), history (down to
    // the latest turn), then the attached text. The question is never cut.
    const size = () => budget.instructions + tokensOf(context) + tokensOf(relevant.map((x) => x.s)) + tokensOf(linked.map((x) => x.s)) + tokensOf(chat) + tokensOf(members) + tokensOf(history) + tokensOf(material) + tokensOf(question);
    while (size() > budget.total) {
      if (chat.length) { chat.shift(); note('chat', 'budget'); continue; }
      if (linked.length) { linked.pop(); note('linked', 'budget'); continue; }
      if (relevant.length) { relevant.pop(); note('relevant', 'budget'); continue; }
      if (history.length > 1) { history.shift(); note('history', 'budget'); continue; }
      const spare = Math.max(0, (budget.total - (size() - tokensOf(material))) * 4 - material.length * 40);
      if (!material.length || !shortenEvenly(material, spare)) break;
      note('attached', 'shortened', material.length);
    }

    // The rollup's numbers carry on after the attached ones.
    if (relevant.length) context.relevant = relevant.map((x) => { numbered.push(x.ref); return rollupObject(numbered.length, x.s); });
    if (linked.length) context.linked = linked.map((x) => { numbered.push(x.ref); return rollupObject(numbered.length, x.s, { linkedTo: x.linkedTo }); });
    if (chat.length) context.chat = chat;
    if (members.length) context.members = members;

    const sent = {
      attached: attachedRefs,
      relevant: relevant.length,
      linked: linked.length,
      history: history.length,
      chat: chat.length,
      members: members.length,
      ...(notSent.length ? { notSent } : {}),
      ...(leftOut.some((l) => l.why === 'budget' || l.why === 'shortened') ? { cut: true } : {}),
    };
    return { context, history, material, numbered, leftOut, sent, sees };
  }

  return { build, turnsOf };
}

module.exports = { createContextBuilder, todayIn, wordsOf, tokensOf, whenText };
