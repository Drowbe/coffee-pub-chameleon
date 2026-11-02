# AI Integration Plan

**Audience:** Thomas decides how AI reaches the app and what it may do there (the open questions at the end).
server-development builds the prompt layer (slice 1: the prompt registry, the context builder, the policy layer, the
provider adapters, the fake model and the golden checks), then the catalog, the tool routes, the tokens, the MCP
endpoint and the tool-calling loop (slice 2 onward); experience-design builds what a person sees of an answer (what it
used, cut short, the ask box from availability), the AI usage view, and later the Profile and Manage pages for tokens
and the AI inbox; quality-assurance reviews the policy layer and its redaction as a security change, and later the
tokens, the OAuth pages and the MCP endpoint; content-manager documents.

**Status:** draft for Thomas, first written 2026-11-02; four decisions made on 2026-11-02 after the AI audit (below).
Slice 1, the prompt layer, is planned here and not built; it waits on the open questions marked as blocking it. The
cheap must-fixes from the audit are being built now, outside this plan (see "Being built now"). From GitHub #382,
raised by Thomas on 2026-11-02: today "a person pastes our custom prompt into the client, copies the JSON it returns,
and pastes that into the app. It works anywhere but is manual, error-prone and one-way", and inside the app "a prompt
goes out and JSON comes back that we parse". Thomas wants "a better process for both. Ideally ChatGPT (or Claude) could
talk to our server directly." After the audit he decided that the prompt layer is rebuilt first, and planned before it
is built.

Related: #64 (integration tokens), #232 (the Chrome extension), #373 (`hooks.ai` optional), #341 (the parsing
heuristics), [plan-object-handoff](plan-object-handoff.md) (the objects format, `takes`, Send to...),
[plan-research-import](plan-research-import.md) ("Later: a direct connection"), [plan-assistant-module](plan-assistant-module.md),
[plan-chat-model](plan-chat-model.md) (`/ai` answers are private; its decision 12 is replaced by decision 1 here),
[plan-one-input](plan-one-input.md), [plan-linked-objects](plan-linked-objects.md) (links between objects),
[plan-planner-phases](plan-planner-phases.md) (phases), [plan-attachments-vault](plan-attachments-vault.md) (files and
who may see their names), [plan-realtime-optional-livekit](plan-realtime-optional-livekit.md) (the live stream),
[plan-template-games](plan-template-games.md).

## What it is today

File and line numbers are at `d2d9897` (origin/main, 2026-11-02), the commit the audit read. The must-fixes being
built now move some of them.

### The AI service (`server/ai.js`)

- **One service per environment**, set by an owner on Manage > Modules, the AI service tab (`public/admin.js`, "The AI
  service"; `GET`, `PUT /api/ai` and `POST /api/ai/models`, all `requireOwner`). It is either the environment's own
  ("custom": provider, model, address, key) or one the host offers ("managed", per company, set on the console with
  `PUT /api/host/ai`). There is no key per person.
- **Providers:** `openai`, `anthropic` and `compatible` (any service speaking the OpenAI chat interface), plus `none`
  (`PROVIDERS`). Defaults: `gpt-4o-mini` and `claude-haiku-4-5-20251001` (`DEFAULT_MODELS`); `compatible` has no
  default. No temperature is set.
- **The key** is kept in `DATA_DIR/ai.json`, encrypted with AES-256-GCM under the host's secrets key, and never shown
  again (`view()` says only that one is set).
- **Three tasks:** `summarise`, `ask` and `tags` (`TASKS`). One request, one answer (`complete`), no tools, no stream,
  no retry: up to 12 objects (`MAX_ITEMS`), 8,000 characters each, 60,000 in all, the question cut to 1,000 characters
  and folded to one line, 1,200 answer tokens, 90 seconds. Budgets are counted in characters, not tokens.
- **Limits and costs:** a monthly token allowance per environment (`monthlyTokens`, `overCap`, `DATA_DIR/ai-usage.json`,
  tokens by task); on a host, `aiCallsPerMonth` per environment (`recordAiCall`); six AI calls a minute per person
  (`overLimit(..., 'ai')`). The modules' activity list notes "used AI to ... (N tokens)", the last 100 entries, in
  memory.

### Where every prompt lives

Every string sent to a model, as the audit read it and confirmed by echoing it back from a stub model:

| What | Where |
|---|---|
| The system frame for `ask` (Chat's `/ai`, a module's ask) | `server/ai.js:540` `ASK_FRAME` |
| The system frame for `summarise` and `tags` | `server/ai.js:541` `FRAME` |
| The `<item>` markers and the task sentences, with the question spliced into "Answer this question. ..." | `server/ai.js:545-558` `buildPrompt` |
| "Include objects only when..." | `server/ai.js:564-570` `KEEP_WORDS`, `summaryRule` |
| The objects rule, its example object, the kinds, details and dates rule | `server/object-format.js:317` `promptExample`, `:368-406` `objectRule` |
| The paste-flow prompt (the same rule, in the person's voice) | `server/object-format.js:409-410` `instructions` |
| The default questions | `modules/research/src/research.js:470`, `public/module-host.js:1418`, `modules/assistant/src/assistant.js:27` |

Answers are read back by `parseSummaries` (`server/ai.js:603-649`: a fenced ` ```objects ` block read leniently, then
`cleanObject`) and `parseTags` (`:660`). Nothing checks whether the answer was cut off (`complete`, `:530`).

**What the model is given:** one system message and one user message. No space name, no today's date, no phases, no
template words beyond "object", no person, no earlier turns. Material and the question share one user message with the
format rules.

### Who may use it, three rules in three places

- **Chat's `/ai`** (`GET`, `POST /api/spaces/:id/ai`, `server/index.js:5566-5641`): `chatAiSpace` (`:5556`, signed in
  and a member) and `chatAiRefusal` (`:5550`, not a guest, the space's AI not off). Not `useAi`, not the `chat`
  permission. This is [plan-chat-model](plan-chat-model.md)'s decision 12, now replaced (decision 1 below).
- **The module routes** (`GET`, `POST /api/modules/:id/ai`, `:7541` and `:7610`): `aiAllowed` (`:7535`) adds the role's
  `useAi`, which is off by default for moderators, members and guests (`server/store.js:221-223`).
- **Bringing in pasted objects** (`importRefusal`, `:7555`) reuses Chat's rule though it calls no AI.
- Refusal sentences are written out five times, in lower case, some with the provider's own text.

### Where material comes from

Both AI routes read the objects a person attached (`refs`, up to 12) with `resolveRef` (`:6638`) as that person. Chat's
route passes `skipConsumer` and does not pin the objects to the current space, so an object from another space the
person can read is sent, and the answer, stored in the current space, can be made public there (audit ai-12).

### The rest (unchanged by slice 1)

- **`hooks.ai` and the SDK.** `hooks.ai` is `true` or `"optional"` (#373). `host.ai.available()` and
  `host.ai.ask({ task, question, objects })` in `public/sdk/host.js`; `host.chat.ask({ question, refs })` posts a
  private `/ai` question in Chat. Research uses `host.ai.ask({ task: 'tags' })` and `host.chat.ask`; the Assistant uses
  `host.chat.ask`. No bundled module calls `summarise`.
- **The paste flow.** Chat's "Copy the prompt" copies `GET /api/objects/format`'s `instructions`; the person pastes the
  answer back, and `POST /api/spaces/:id/objects/check` reads it with `readObjects` and `cleanObject`.
  `GET /api/objects/format/schema` serves the JSON Schema.
- **Modules, actions and the bus.** Modules run no server code; the server reads a module's objects only through
  `refs.produces` (`resolveRef`, `objectSummary`, `GET /api/objects/search`). Actions (`actions.provides`) have a label
  and a typed `input`, no description and no mark of what they change. A request is carried out by the providing
  module's open page (`server/module-bus.js`).
- **Links between objects** are kept by `server/module-links.js` (`to`, `from`), pointers only, up to 20 per object.
- **Sign-in.** A session is a signed cookie, or the same token as `Authorization: Bearer`. There are no personal
  tokens (#64).
- **Phases.** A space's phases are the template's, with their dates on the space (`space.phases`, `public/phases.js`).
  A space has no time zone of its own; the server's is `ics.serverZone()`, and module-host sends the browser's `tz`
  with a data write.

### Being built now (the cheap must-fixes)

From the audit, outside this plan, built before slice 1 starts. Slice 1 keeps each one and moves it into the layer
that owns it:

- **On the server:** ai-03 (the prompt's example no longer parsed as an object), ai-04 (a cut-off answer: complete
  objects kept, the partial block dropped, "cut short" said), ai-05 (data that can't break out of its markers), ai-07
  (Chat's AI needs the `chat` permission), ai-11 (availability counts the monthly allowance), ai-12 (Chat's objects
  pinned to the current space), ai-13 (a saved key never sent to a new address), ai-14 (private addresses refused on a
  host unless allowed), ai-15 (the rate limit counted after validation, in Chat's own words), ai-16 (plain error
  sentences, details to the log), ai-18 (turning AI on again restores what it turned off), ai-27 (the host console's
  "AI this month"), ai-28 (the old thread routes and the `objects` alias removed).
- **On the pages:** ai-01 (typing `/ai` works), ai-09 (an attached object goes with one question and shows as a chip),
  ai-10 (a guest is not offered the ask box), ai-11 (the box says when AI is unavailable), ai-17 (the Assistant page's
  placeholder and advice), ai-20 (Research hides "Research this" where there is no Chat).

Not in either list, and taken up by slice 1: ai-02 (no conversation memory), ai-06 and ai-19 (one permission rule),
ai-08 (no date and no space), ai-21 and ai-22 (cuts that are not said), ai-29 (concurrent asks passing the cap), and
prompt smells 1, 2, 4, 6 to 11 from the audit. ai-23 to ai-26 are polish for the pages and stay outside this plan.

## The target

One prompt layer that owns everything said to a model, and three ways in that use it:

1. **Inside the app**, with the environment's AI service: Chat's `/ai`, the Assistant view and modules' asks, each a
   versioned prompt, given the space's context and the person's recent questions, answered in a structured shape where
   the provider has one (slice 1); later the model calls the catalog's tools instead of writing objects in its text
   (slice 2 onward).
2. **From outside**, ChatGPT, Claude or another client talks to the server through an MCP endpoint or a plain API with
   a personal token, acting as one person with no more than that person's rights (slice 2 onward).
3. **The paste flow** stays for any AI anywhere, its prompt one of the layer's templates (slice 1) and its schema made
   from the catalog later.

Anything an AI wants to change waits for the person to say yes in the app. An AI never does more than the person, and
never reads outside the space it is asked in.

## Decisions

Thomas, 2026-11-02, after the AI audit:

1. **One permission rule for AI, everywhere.** Using AI needs the role's **Use AI** permission (`useAi`) and the
   space's AI switch on; never a guest. Chat's `/ai`, the Assistant view, modules' asks and everything after them use
   the same rule. This replaces [plan-chat-model](plan-chat-model.md)'s decision 12 (which left `useAi` out of Chat)
   and answers open question 9. Reason: today who may use AI depends on where they ask (audit ai-06, ai-19), and an
   owner has no way to stop members spending the allowance in Chat except space by space.
2. **The AI remembers the conversation and knows the space.** The model sees the last 6 turns of that person's private
   AI thread in this space, capped in tokens, and a **context rollup** of what applies in the space: its name and
   dates, today's date (ai-08), its phases, the objects relevant to the question and summaries of the objects they
   link to. Reason: the Assistant view draws a conversation that is not one (ai-02), and the model can't answer "what
   do we do on day 3?" without the space's dates. The rollup's design is the contract below.
3. **The prompt layer is rebuilt first, planned before it is built.** One place owns versioned prompt templates with
   typed inputs; one context builder; one policy layer (permissions, redaction, and space scope: objects from the
   current space only); a fake-model test harness with golden outputs; structured output where the provider supports
   it, prompt-then-parse for other services. Reason: the prompt is concatenated strings in three files, untested as a
   whole, and the source of the parsing failures (#341, ai-03, ai-04, ai-05); the catalog and the outside clients need
   the same three pieces.
4. **Objects from other spaces never enter an answer,** enforced by the server, whatever the person can read
   elsewhere. Reason: an answer is stored in the space it was asked in and can be made public there (ai-12), and the AI
   setup page promises "never another" space.

### Choices the plan made

Thomas may overrule these; they are not his decisions.

- **Data is JSON, instructions are not.** The system message holds only instructions; the context, the history and the
  material go as data in their own messages, JSON-encoded, so no text in an object can close a marker or read as an
  instruction. The question is its own last message, never spliced into a sentence.
- **The asker's name and role word go in the context;** no other member's name does.
- **Default questions move to the registry.** A module asking about an object sends no question, and the template
  supplies "What should I know about <title>?". Research and the Assistant each take a patch version bump.
- **`summarise` stays a template** although no bundled module uses it, because `host.ai.ask` offers it to modules.
- **Prompts are ordered stable-first** (instructions, then the rollup, then history, then the question), so a
  provider's own prompt caching can reuse the start of the prompt between questions. The server keeps no cache of its
  own in slice 1.

## Slice 1: the prompt layer (the contract)

What the server half and the pages half each have to build, so the prompt is one tested thing with one door.

### The pieces and where they live

Names are proposals; the shape is the contract.

| Piece | Where | Owns |
|---|---|---|
| Prompt registry | `server/prompts/` (one file per template, an `index.js` that lists them) | The templates, their versions, typed inputs, output contracts and default questions |
| Context builder | `server/ai-context.js` | The rollup, the history window, the attached material, the token budget and what was left out |
| Policy layer | `server/ai-policy.js` | Who may ask, which objects may be sent, redaction, refusal sentences, availability, the rate limit and the cap |
| Provider adapters | `server/ai-providers.js` | The request shape per provider, structured output, the finish reason, token counts, error mapping, model lists |
| Fake model | `tools/fake-model.mjs` | A local OpenAI- and Anthropic-shaped server with scripted answers, for every check |
| Golden checks | `tools/check-prompts.mjs`, `tools/golden/prompts/` | Rendered prompts and parsed answers per template and fixture |

`server/ai.js` keeps the setting, the key, the monthly usage file and `run`, which becomes: policy, then context, then
render, then adapter, then parse, then record. It loses `ASK_FRAME`, `FRAME`, `buildPrompt`, `KEEP_WORDS`,
`summaryRule`, `parseSummaries`, `parseTags`, `citedItems`, `oneLine` for the question and `complete`.
`server/object-format.js` loses `promptExample`, `objectRule` and `instructions` to the registry and keeps `DETAILS`,
`KINDS`, `kindsTaken`, `schema()`, `readObjects` and `cleanObject`, which the registry's output contract uses.

### What slice 1 replaces

| Today | Replaced by |
|---|---|
| `server/ai.js:540-541` `ASK_FRAME`, `FRAME` | The `ask`, `summarise` and `tags` templates' system parts |
| `server/ai.js:545-558` `buildPrompt` | The registry's `render(template, inputs)` |
| `server/ai.js:461` `oneLine(question, 1000)` | The `question` input: 3 to 1,000 characters, line breaks kept, refused at the route when longer (ai-22) |
| `server/ai.js:530` `complete` | The adapters, which report the finish reason and the real token counts |
| `server/ai.js:564-570` `summaryRule` and `server/object-format.js:317, 368-406` `promptExample`, `objectRule` | The output contract: a JSON schema where the provider takes one, the same rule rendered as a schema description for the others |
| `server/object-format.js:409-410` `instructions` | The `paste` template, written for a person to paste, with its own version |
| `server/ai.js:603-649` `parseSummaries`, `:660` `parseTags` | The registry's `parse(template, answer)`: the structured answer read as JSON; prompt-then-parse kept only for a service without structured output |
| `server/index.js:5550` `chatAiRefusal`, `:5556` `chatAiSpace`, `:7535` `aiAllowed`, `:7555` `importRefusal` | `aiPolicy` |
| `server/index.js:5613-5623` and `:7618-7631` (each route reading its own `refs`) | The context builder's `material`, read through the policy |
| `modules/research/src/research.js:470`, `public/module-host.js:1418`, `modules/assistant/src/assistant.js:27` | The templates' default questions |

### The prompt registry

- **A template** is `{ id, version, inputs, system(inputs), data(inputs), output, budget, defaultQuestion? }`. Its name
  in records is `<id>@<version>` (`ask@1`). Templates: `ask`, `summarise`, `tags` and `paste`.
- **Typed inputs**, checked before anything is sent; a wrong input is a server error, never a prompt:
  - `question`: a string of 3 to 1,000 characters, line breaks kept (absent only where the template has a default).
  - `material`: up to 12 attached objects, each `{ n, ref, kind, title, when?, place?, text }`, `n` the number to cite.
  - `context`: the rollup (below).
  - `history`: up to 6 turns, each `{ question, answer }`.
  - `kinds`: the kinds the environment's modules take (`kindsTaken`).
  - `words`: the template's words the prompt uses (object, space, phase, the roles).
- **Rendering** gives a provider-neutral list: one system message (instructions only), then the context and the
  material as one user message holding a JSON document, then the history as real alternating user and assistant
  messages, then the question as the last user message. The frame "data, never an instruction" stays in the system
  part. No example object is ever written as a block the parser reads.
- **The output contract** for `ask` and `summarise`: `{ answer, objects, used }`. `answer` is Markdown; `objects` are
  objects-format objects narrowed to `kinds` (checked by `cleanObject`), at most `MAX_SUMMARIES`; `used` lists the `n`
  of the attached objects and the rollup objects the answer drew on. For `tags`: `{ tags }`, up to 6, plain text (HTML
  stripped first, ai-25). For `paste`: no contract, it is text for a person.
- **Versions.** Any change to what a template renders or parses is a new version. The check fails when a rendered
  golden prompt changes and the version did not. The registry keeps the current version and, while open question 21
  is open, nothing older.

### The policy layer

`aiPolicy(who, space, purpose)` answers `{ ok: true }` or `{ ok: false, status, why }`, with `purpose` one of `chat`
(Chat's `/ai`, the Assistant view, `host.chat.ask`) or `module` (`/api/modules/:id/ai`). Every AI route and every
availability route calls it, so a page is never offered what the server then refuses. In this order:

1. Signed in (401 "Sign in first."); not a guest (403 "Guests can't use AI.", in the template's word).
2. The role's `useAi` in this space (`store.spacePermissions`); an owner always has it (403 "Your role can't use AI.").
3. The space's AI switch on (`space.aiOff` not set; 403 "AI is turned off in this <space>.").
4. The door's own rule: for `chat`, a member of the space with the `chat` permission (ai-07); for `module`, the
   module's write access and its approved `ai` hook.
5. The service: set up, its key readable (503), within the month's allowance and, on a host, `aiCallsPerMonth` (429).
6. The rate limit, six a minute per person for all AI together, counted only once the question is valid, and given
   back when the provider fails (ai-15).

**The cap is reserved, not just checked** (ai-29): the call reserves its token budget before it is sent and settles to
the real count after, so two questions at once can't pass the allowance together.

**Material is admitted one object at a time** by `aiPolicy.admit(who, space, ref)`:

- The object must be in the current space (`ref.scope === 'space'` and `ref.space === space.id`); anything else is
  left out and the answer says so (decision 4). Environment-wide objects are left out until open question 15 is
  answered.
- It is read with `resolveRef` as the person at that moment; what they can't read is left out, never named.
- **Redaction** before anything is rendered: no keys, tokens, share or guest links, the OBS access key, invitation
  addresses, other people's private messages or another person's person-scoped data; a Vault file's name only for
  someone who can read the Vault (plan-attachments-vault, decision 8). Redaction is a list of fields in the policy, one
  place, with a check that each field is stripped.

**One set of refusal sentences,** plain and capitalised, in the template's words, used by every route and by
availability. Provider detail goes to the server log, never to the page (ai-16).

**Bringing in pasted objects** calls no AI; whether it follows this rule is open question 18. Until then it keeps
today's rule.

### The context builder

`buildContext(who, space, { template, question, refs, tz })` answers `{ context, history, material, leftOut, budget }`.
It runs after the policy and only reads through it. It is built fresh for every question, at the moment of asking, and
nothing it makes is stored except the record below.

**History (decision 2).** The person's own private AI messages in this space (`chatHistory`, the messages with
`command: 'ai'` and their answers, paired by `replyTo`), newest first, up to 6 turns, then cut to the history budget
oldest first. What a turn is, and the budget, are open question 12. Never another person's messages, never another
space's, never a deleted one. An answer goes back as its text and the titles of its objects, not their details. A
message the person made public still counts as theirs.

**The rollup (decision 2).** What goes in, in this order, each part with its own cap:

| Part | What | Cap |
|---|---|---|
| The space | Its name; the template's word for a space and for objects | 200 characters |
| Dates | Today's date and weekday in the asker's time zone (open question 14); the space's phases from the template with their dates (`space.phases`, `public/phases.js`), and which phase today is in | 12 phases |
| The person | The asker's display name and role word | |
| Attached objects | The objects the person attached, with their text, as `material` | 12 objects, the material budget |
| Relevant objects | Summaries (kind, title, when, place, no text) of the current space's objects chosen for the question (open question 13) | 15 objects |
| Linked objects | For each attached object, the objects it links to and that link to it (`module-links.js`, one step), as summaries | 5 per object, 20 in all |

Every object in the rollup goes through `aiPolicy.admit` as the person: from this space only, readable by them now,
redacted. An object they can't read never enters, and neither does the fact that it exists. The rollup holds no chat
messages in slice 1.

**Freshness and caching.** The rollup is read from live data for each question, so an edit made a second before shows.
The server keeps no cache in slice 1; the space part is small and the objects are per person, so a cache would have to
be per person and invalidated on every change. If cost or time later shows a need, the space part (name, phases,
words) may be cached per space and dropped on any change to the space.

**The privacy rule.** The rollup contains only what the person could open themselves, now, in this space. The answer
records which objects it drew on (`used`, as pointers); nothing else of the rollup is kept. When the answer is made
public, what others see of `used` is open question 16.

**The budget** (numbers proposed in open question 22). Tokens are estimated from characters before sending (about
four characters to a token, rounded up) and the real counts come from the provider afterwards. When the prompt is over
its budget, cut in this order and record each cut in `leftOut`: linked summaries, then relevant summaries (lowest
first), then history (oldest first, down to the latest turn), then the attached objects' text (each shortened evenly,
the object itself kept). The question is never cut: one over 1,000 characters is refused at the route.

### The provider adapters

- One adapter per provider (`openai`, `anthropic`, `compatible`), each turning the rendered messages into its request
  and its answer into `{ text, structured?, finish, tokens: { in, out }, model }`.
- **Structured output** where the provider takes a schema: OpenAI's JSON schema response format (strict), and for
  Anthropic its structured output or a single forced tool whose input is the output contract, whichever the adapter
  targets when built. A `compatible` service: open question 19.
- **The finish reason** is one of `stop`, `length`, `filter`, `error`. On `length` the complete objects are kept, a
  partial one is dropped and the answer is marked cut short (carries ai-04 into the adapters). An answer cut by the
  stored limit is marked too (ai-21).
- **Errors** map to the policy's sentences; the provider's text goes to the log only.
- **The key** is bound to the provider and address it was saved for (carries ai-13), sent only to that provider, never
  in a page, a log, a record or an error.
- Model listing moves here unchanged.

### Migrating every prompt onto the registry

Each existing prompt moves, and the old code is deleted in the same step; no old path is kept beside the new.

1. **Chat's `/ai` and the Assistant view** (`POST /api/spaces/:id/ai`): template `ask`, purpose `chat`, with history
   and the rollup. The route stores the template name and version on the answer (`prompt: "ask@1"`) beside `summaries`.
2. **`host.chat.ask` from modules** (Research's "Research this", the Assistant): the same route and template; the
   module sends the object and no question, and the template's default question is used and shown as the question.
3. **A module's ask** (`POST /api/modules/:id/ai`, tasks `ask`, `summarise`, `tags`; Research's Suggest tags): the
   matching template, purpose `module`, with the rollup but no history (a module's ask is not a conversation).
4. **The paste flow** (`GET /api/objects/format`'s `instructions`): template `paste`, rendered by the registry from the
   same output contract, in the person's voice, never sent to the in-app model.
5. **The default questions** in Research, module-host and the Assistant: removed from the pages, now in the templates.

### Observability

- **A record per call,** kept in `DATA_DIR/ai-log.jsonl` (how long is open question 23): when, the environment, space,
  person, purpose, template and version, provider and model, tokens in and out, the finish reason, how long it took,
  the outcome (answered, refused and why, or the error's kind), and counts of what was sent (history turns, attached,
  rollup and linked objects, and what was left out). Never the key, a header, the question, the material or the
  answer.
- **Full prompts** are never logged by default; a debugging switch is open question 20.
- **`ai-usage.json`** gains tokens by template version, by person and by space for the month, beside tokens by task.
- **The AI usage view** (pages half). On Manage > Modules, the AI service tab, for owners: this month's tokens and
  calls by template, by person and by space, refusals by reason, errors, cut-short answers, and the last 50 calls as
  records (no content). On the host console, for the admin, each environment's AI this month (the fixed ai-27) and
  its calls. The activity list's line becomes "asked the AI (<template>, N tokens)" in plain words (ai-26).

### Versioning and rollback

- Every stored answer and every record names the template version that made it, so a bad answer can be traced to a
  version and a model.
- A new version ships with its golden files; the check fails when they disagree.
- How to go back to the previous version without a new image is open question 21.

### What a person sees (the pages half)

Beyond the must-fixes already being built (the ask box from availability, chips for attached objects, `/ai` working):

- **Under an answer, one line of what it used:** the attached objects as links, then "and N other <objects> from
  <space>" and "your last N questions" when the rollup and history were used, and "Some <objects> were left out to
  fit" when `leftOut` is not empty. Citations `[1]` link to the object they name (ai-24).
- **A cut-short answer** says "The answer was cut short." under it, and keeps the objects that were complete.
- **A question over 1,000 characters** is refused in the box before sending, with the count.
- Answers look as they do now otherwise; nothing shows the template version to a person.

### What the outside clients will need later

Not planned here; slice 2 onward. What slice 1 must leave possible:

- The policy takes a third purpose for an outside client, with a personal token's scopes narrowing it, and the same
  space pinning and redaction for every tool result.
- The context builder's rollup is the answer to a read tool ("tell me about this space"), so an outside AI and the
  internal one see the same thing.
- The registry holds tool descriptions as templates once the catalog exists, so they are versioned and checked the same
  way.
- The adapters gain the tool-calling loop; the fake model gains scripted tool calls.
- The record gains the token's name.

## Slice 2 onward: the catalog, tools and outside clients

These are the options drafted before the audit, unchanged in substance, now built on slice 1. Nothing here is decided.

### (a) One catalog

What an AI may ask for, listed once and generated from the enabled modules' manifests at request time, filtered to the
person asking (their spaces, roles and each module's `access`).

- **Read tools, from the core**, built on what the server can already read: `list_spaces`, `search_objects` (a space,
  words, a kind, `has=place` or a date range), `read_object` (one pointer, with its text) and `list_actions`. Every
  result goes through slice 1's policy (decision 4 holds for tools too).
- **Write tools, from the modules**: one per `actions.provides` entry that is not `local`, named
  `<module>__<action>`. The input schema is made from the action's `input` types. Plus one core tool,
  `propose_objects`, for objects with no chosen destination.
- **What modules add to `module.json`**: on each action, a `description` (one plain sentence, up to 200 characters, in
  the template's words) and an `effect`, one of `read`, `write` or `destructive` (default `write`). An action may say
  `"ai": false` to stay out of the catalog.
- **A check** (`tools/check-catalog.mjs`) fails when a bundled module's action has no description, and when the
  generated schemas do not compile or do not accept the format's own example.

Options: **generate it from manifests, with the two new fields** (lean; a manifest field pair and a version bump for
each bundled module with actions; it can't drift); **generate it from manifests as they are, labels only** (no module
changes; rules out reliable safety marks); **a hand-written catalog in the core** (drifts, and names modules in the
core).

### (b) Inside the app: tool calling

**The loop.** Slice 1's adapters gain a tool-calling run: send the question, the rollup and the catalog's tools; when
the model calls a read tool, the server runs it as the person through the policy and sends the result back; repeat
until the model answers or a limit stops it. Writes are never run in the loop: a write tool's call becomes a proposal
in the person's AI inbox (section (e)). The final objects come from `propose_objects` calls.

**Providers.** Anthropic and OpenAI both support tools; a `compatible` service may or may not, and follows open question
19's answer.

**Limits** (proposed): at most 6 rounds and 20 tool calls per question; each tool result held to slice 1's per-object
budget; one question is one call against `monthlyTokens` and `aiCallsPerMonth` however many rounds it takes.

Options: **native tool calling for Anthropic and OpenAI, slice 1's run kept for services without it** (lean);
**structured output only** (slice 1 already gives this; no looking things up); **stop at slice 1**.

### (c) From outside: MCP and a plain API

**The endpoint.** `POST` (and `GET` for its event stream) at `/mcp` on the environment's own address, using MCP's
streamable HTTP transport. On a host with environments each environment has its own (`<slug>.<BASE_DOMAIN>/mcp`). The
tools are the catalog's, filtered to the person, with MCP's hints set from `effect`.

**Which clients work, and how** (to be confirmed against each client when built; these move often): Claude (claude.ai
and the desktop app) through custom connectors to a remote MCP server by OAuth, or a local bridge for the desktop app;
ChatGPT through connectors to a remote MCP server by OAuth, or a custom GPT's Actions over an OpenAPI description with
an API key or OAuth; anything else (a script, Coffee Pub Studio, the Chrome extension #232) through the plain API with a
personal token.

**Auth.** One token store, for #64 too: tokens hashed at rest, shown once, named, with an expiry, scopes, last used,
and revoke; made by hand on Profile, or through OAuth 2.1 (authorization code with PKCE) for connectors, with the
metadata documents and client registration MCP's authorization spec asks for. **Scopes, per token:** which spaces,
which modules, and how far (open question 4). Every call is checked as the person at that moment.

**Reaching a server at home.** ChatGPT and claude.ai call from their own cloud, so the server must be reachable at a
public HTTPS address: the address players already use, or a tunnel (Cloudflare Tunnel, Tailscale Funnel); or, for the
desktop app only, the local bridge. `TRUST_PROXY_HOPS` already covers the proxy.

**A switch.** An environment variable turns the endpoint, the OAuth routes and tokens on for the server (default off,
so a single-environment install behaves exactly as before); an owner's switch on Manage turns it on for the
environment.

Options for auth: **tokens first, OAuth after** (lean); **OAuth from the start**; **tokens only** (rules out the
connectors). Options for the API shape: **MCP plus a small REST twin** (lean: `GET /api/ai/catalog`,
`POST /api/ai/tools/:name`, an OpenAPI document for custom GPT Actions); **MCP only**; **REST only**.

### (d) The paste flow, kept

The copied prompt and the import checker stay. Slice 1 makes the prompt the `paste` template, rendered from the same
output contract as the in-app answer. Later, the kinds, details and limits, and the schema at
`GET /api/objects/format/schema`, come from the catalog's `propose_objects` schema, with a check that they agree.
Options: **regenerate from the catalog** (lean, small); **leave it at slice 1**; **retire it once MCP works** (rules out
every AI without a connector).

### (e) Safety

- **Content is data, never instructions.** Inside the app, slice 1 keeps data and instructions in separate messages.
  From outside we do not control the client's prompt, so the protection is the next points, not the wording.
- **Writes wait for the person.** A write tool call becomes an entry in that person's **AI inbox** for the space, in
  plain words, with Keep, Change and Drop; Keep sends the request through the bus as Chat's Keep does today.
- **Destructive actions** are left out of the catalog in the first build (open question 6).
- **Least privilege.** A token is limited to spaces, modules and a level; a guest gets none; a call is checked against
  the person's rights and the token's scopes, whichever is narrower, through slice 1's policy.
- **No secrets in results:** slice 1's redaction list, applied to every tool result.
- **The AI can never do more than the person.** There is no AI identity with rights of its own.
- **Limits:** per token, requests a minute and proposals waiting in an inbox (say 50); per environment, the existing AI
  allowances.
- **An audit trail:** every tool call through a token recorded as slice 1's records are (never the content), seen by
  the person for their own tokens and by owners for all.

Options for where a write waits: **an AI inbox per person and space** (lean); **queue the bus request directly** (no
confirmation); **server-side writes** (breaks "modules run no server code").

### (f) How it fits the rest

- **Live.** A new inbox entry is sent on that person's own live stream (`/api/live`); a kept object reaches everyone's
  open pages as any change does.
- **A trail people see.** An object kept from an AI carries its provenance (`basis`, and "from <token name>" or "from
  the AI service"), and the activity list names the person and the token.
- **The module frame.** Modules need no new SDK calls for the first steps.
- **The Vault.** Read tools list Vault files to people who can read the Vault: name, type, size and links, never the
  bytes.
- **Templates and games.** The catalog's descriptions use the template's words. The rule that an AI reads only what the
  person may see is what keeps a player's AI out of the game master's notes, so modules holding secrets must gate them
  by permission, not by hiding them on the page.

## Left to build, in order

Sizes: S (a day or less), M (a few days), L (a week or more). Each step can be built and checked on its own.

### Slice 1: the prompt layer

Starts once the must-fixes being built now are in, and once the open questions marked as blocking a step are answered.

1. **The fake model and the harness (M).** server-development: `tools/fake-model.mjs` (from the audit's stub: OpenAI
   chat completions and Anthropic messages shapes, scripted answers for normal, echo, cut off, empty, not JSON, 401,
   429, 500, slow, structured and Markdown); `tools/check-prompts.mjs` with `--update` to write golden files, run first
   against today's routes so the starting behaviour is recorded. Added to `npm run check`.
2. **The policy layer (M).** server-development: `server/ai-policy.js` with decision 1's rule, the door rules, the
   reserved cap, the rate limit, space pinning, the redaction list and the refusal sentences; every AI and availability
   route switched to it, and `chatAiRefusal`, `chatAiSpace`, `aiAllowed` deleted (`importRefusal` per open question 18).
   The Roles page's label becomes **Use AI** and its defaults follow open question 17. Security review by
   quality-assurance. Blocked by open questions 15 and 17 (and 18 for the import door).
3. **The registry and the adapters (L).** server-development: `server/prompts/` with `ask`, `summarise`, `tags` and
   `paste`, typed inputs, the output contract, `render` and `parse`; `server/ai-providers.js` with structured output,
   the finish reason, token counts and the key binding; every prompt migrated (the list above) and the old prompt code
   in `server/ai.js` and `server/object-format.js` deleted. Material only (no rollup or history yet). Golden files per
   template. Blocked by open questions 19 and 21.
4. **The context builder (M).** server-development: `server/ai-context.js` with the history window, the rollup, the
   budget and `leftOut`; `tz` accepted on the ask routes. Golden files for the rollup per role. Blocked by open
   questions 12, 13 and 14.
5. **Records and usage (S).** server-development: `DATA_DIR/ai-log.jsonl`, `ai-usage.json` by template, person and
   space, `GET /api/ai/usage` for owners and its host console counterpart, the activity line. Blocked by open
   questions 20 (the debugging switch only) and 23 (how long records are kept).
6. **What a person sees (M).** experience-design: the "what it used" line, linked citations, "cut short", the question
   length in the box, `tz` sent with each ask, the default questions removed from Research, module-host and the
   Assistant (Research and the Assistant each a patch version bump), the AI usage view on Manage and the host
   console. Blocked by open question 16 for public answers.
7. **Documentation (S).** content-manager: [api-modules](../api/api-modules.md) and the AI routes, the architecture's
   AI section, the user guide's AI and Roles pages, [plan-chat-model](plan-chat-model.md)'s status.

### Slice 2 onward

8. **The catalog (M).** server-development: `description`, `effect` and `ai` in `cleanBus`; the generated catalog and
   its schemas; `GET /api/ai/catalog`; `tools/check-catalog.mjs`; the bundled modules' descriptions, each a patch bump.
9. **Read tools (M).** server-development: `POST /api/ai/tools/:name` for the read tools, through slice 1's policy.
10. **Personal tokens (M).** server-development: the token store, scopes, expiry, revoke, last used, records and
    per-token limits; the server switch. experience-design: "Connected apps" on Profile, an owner's list on Manage.
    Security review by quality-assurance.
11. **MCP endpoint, read only (M).** server-development: `/mcp`, streamable HTTP, the read tools, personal tokens.
12. **The AI inbox and writes with confirmation (M).** server-development: write tools and `propose_objects` make inbox
    entries. experience-design: the inbox in Chat, Keep, Change, Drop.
13. **OAuth for connectors (L).** server-development: authorization code with PKCE, client registration, metadata.
    experience-design: the consent page. Security review by quality-assurance.
14. **Tool calling inside the app (L).** server-development: the loop in slice 1's adapters; the fake model's scripted
    tool calls. experience-design: an answer shows the steps it took.
15. **The paste flow from the catalog (S).** server-development: the `paste` template and the schema from the catalog.
16. **Token activity on the page (S).** experience-design: the person's own records per token on Profile, the owner's
    on Manage.
17. **An OpenAPI document for custom GPT Actions (S).** server-development, generated from the catalog.

## Verify

### Slice 1, checked by a tool with the fake model (no outside service)

- **Golden prompts:** for each template and fixture (the travel and games templates; no material; 12 objects; a long
  question with line breaks; a space with and without phases; today inside, before and after the phases) the rendered
  messages match their golden file, and a change without a version bump fails.
- **Hostile input:** an object whose title or text holds `</item>`, a "SYSTEM:" line, a fenced ` ```objects ` block,
  JSON-breaking quotes and braces, and instructions to ignore the rules; each stays inside its JSON string in the data
  message, and the system message is unchanged. A question that tries the same is the last user message and nothing
  else.
- **Parsed answers:** for scripted answers (normal, echoing the prompt, cut off at `length` mid-object, empty, not
  JSON, Markdown, objects of a kind not taken, more than `MAX_SUMMARIES`) the parsed result matches its golden file: an
  echoed prompt yields no object; a cut-off one keeps the complete objects and is marked cut short.
- **History windowing:** with 0, 1, 6, 7 and 20 earlier turns, the 6 newest are sent; over the history budget the
  oldest go first; another person's messages, another space's, and deleted ones never appear.
- **Rollup contents per role:** as owner, moderator, member, a member whose role can't read a module, a member without
  `useAi`, a member with `chat` off, and a guest (refused); an object attached from another space is left out and said
  to be; an environment-wide object follows open question 15; a linked object the person can't read never appears,
  and its existence is not named; redacted fields never appear in any rendered prompt.
- **The policy:** every refusal, status and sentence through `POST` and `GET /api/spaces/:id/ai` and
  `/api/modules/:id/ai`; availability agrees with the ask every time; two asks at once can't pass the allowance; a
  refused or failed ask doesn't use the rate limit.
- **Budget:** a prompt over budget is cut in the stated order, `leftOut` lists each cut, and the question is never cut.
- **Records:** a record per call with the fields listed, and a search of the log and the usage file for the seeded key,
  the question and the material finds none of them.
- **The key:** a saved key is never sent to an address it was not saved for (the fake model listens on two addresses).

### Needs a real provider key (can't be checked here)

How well real models follow the new prompts and the rollup; real token counts against the estimate; whether OpenAI's
and Anthropic's structured output behave as the adapters expect; a real cut-off answer; whether a given `compatible`
server takes a schema; provider prompt caching.

### Slice 2 onward

As drafted before: the catalog against every bundled manifest; the read tools and refusals as different people, roles
and scopes; token hashing, expiry, revoke and records; an MCP client script against a local server; inbox entries and
Keep through the bus; the OAuth flow driven by a script; the tool loop against the fake model. Needs a real client and a
public HTTPS address: adding the server as a connector in claude.ai and in ChatGPT, their OAuth sign-in, a custom GPT,
the desktop app's bridge, a tunnel.

No step needs a LiveKit call.

## Risks

- **Prompt injection** can't be solved by wording. Slice 1 makes it harder (data apart from instructions, no markers to
  break) and smaller (current space only, the person's own rights, redaction); it is held by confirmation and least
  privilege once tools exist.
- **The rollup spends tokens** on every question. The budget and the per-part caps hold it, the records show it, and
  the numbers can be lowered without a new version of a template.
- **Decision 1 changes who has AI by default:** with `useAi` off for members, as today, members lose Chat's AI until an
  owner ticks it (open question 17).
- **Structured output differs by provider and moves;** the adapters must be checked against the providers when built,
  not against this page.
- **The clients move.** ChatGPT's and Claude's connector rules and MCP's authorization spec change often.
- **Exposure.** An install that opens itself to the internet for a connector opens its sign-in too; the switch is off by
  default.
- **Writes are not instant,** by design, once outside clients come.
- **Hosted environments:** records, usage, tokens and OAuth's issuer are per environment, never shared across
  `BASE_DOMAIN`'s environments.

## What is not decided

### Open questions

Numbers 1 to 11 are from the first draft; 12 onward are new with slice 1.

1. **Where an AI's write waits.** (a) An AI inbox the person keeps from; (b) a bus request run when the module is next
   open; (c) server-side writes. Lean: (a). Today's code is already (a)-like: objects are proposals the person Keeps.
   Blocks step 12.
2. **"The person's own key."** (a) Keep the environment's (or host's) key only; (b) a key per person on Profile; (c)
   both, a person's own winning. Lean: (a) now. Blocks nothing now.
3. **Auth for outside clients.** (a) Personal tokens first, OAuth after; (b) OAuth from the start; (c) tokens only.
   Lean: (a). Blocks step 10.
4. **How far a token may go.** (a) Read only in the first build; (b) read and propose; (c) read, propose and act
   without a confirmation for some actions. Lean: (b), with (c) never for `destructive`. Blocks step 10.
5. **Who may connect an outside AI.** (a) Anyone signed in, not a guest; (b) a new role permission ("Connect an AI
   app"), owners always; (c) reuse `useAi`. Lean: (b); `useAi` is about spending the environment's allowance, which an
   outside client does not. Blocks step 10.
6. **Destructive actions.** (a) Never in the catalog; (b) in it, always confirmed one by one. Lean: (a) for now. Blocks
   step 8.
7. **The switches for outside access.** (a) A server environment variable, default off, plus an owner's switch; (b) the
   owner's switch only. Lean: (a). Blocks step 10.
8. **What the internal AI may read.** Partly answered 2026-11-02: the current space only, never another (decision 4),
   and the rollup beyond what the person attached (decision 2). Left: whether, with tools, it may search the current
   space itself (lean: yes, with the answer showing what it read). Blocks step 14.
9. **Chat's `/ai` and `useAi`.** Answered 2026-11-02: one rule, `useAi` and the space's AI switch, never a guest
   (decision 1).
10. **How long the outside clients' audit trail is kept.** (a) 30 days; (b) 90 days; (c) the owner chooses. Lean: the
    same as open question 23. Blocks step 10.
11. **The word on Profile** for tokens. (a) "Connected apps"; (b) "AI connections"; (c) "Outside AI". Lean: (a).
    Blocks step 10.
12. **What a "turn" is, and the history budget.** (a) A question and its answer, so 6 turns are up to 12 messages,
    capped at 3,000 tokens; (b) one message, so 6 messages (3 questions and their answers); (c) (a) with a smaller cap,
    1,500 tokens. Lean: (a), since a follow-up often points back two or three questions. Blocks step 4.
13. **How the rollup chooses "the objects relevant to the question".** (a) Words of the question (and of the last
    turn) matched against the current space's object summaries, the same summaries as `GET /api/objects/search`, the
    best 15, plus every dated object from today to seven days ahead; (b) only the dated objects near today and the
    attached ones, no word matching; (c) a first, cheap model call that picks them (a second call for every question).
    Lean: (a); it is cheap, explainable and needs no second call; tools later let the model look further. Blocks
    step 4.
14. **Which time zone "today" is in.** (a) The asker's browser time zone, sent with each ask as module-host already
    sends `tz` with a data write, the server's (`ics.serverZone()`) when absent; (b) the server's always; (c) a new time
    zone setting per space. Lean: (a); (c) is better for a trip across time zones but is a new setting, and can come
    later. Blocks step 4.
15. **Environment-wide objects** (scope `environment`, such as the environment's calendar or a module mounted on the
    environment rather than a space). They are not another space, but not this space either. (a) Never sent, the strict
    reading of decision 3; (b) sent when the person can read them; (c) sent only when attached by the person. Also: a
    module asking from an environment-wide page (no space) gets (a) no rollup and only its own environment-wide
    objects, or (b) is refused. Lean: (c), and for a module with no space, its own environment-wide objects with no
    rollup. Blocks step 2.
16. **A public answer that drew on objects some members can't read** (the rest of ai-12, inside one space: a module
    hidden from guests, person-scoped data). (a) Allowed; the "what it used" line shows each reader only what they may
    open, and "and N others"; (b) making it public is refused when any member can't read something it used; (c)
    allowed, nothing shown. Lean: (a); the answer's words are the asker's to share, as a message they type would be.
    Blocks step 6 only.
17. **`useAi`'s defaults, now that it gates Chat too.** (a) On for moderators and members, so Chat behaves as it does
    today and owners turn it off where cost matters; (b) off as today, so only owners have AI until they tick it for a
    role; (c) on for moderators only. Lean: (a); the monthly allowance and the space switch already hold cost, and
    members expect the Assistant view to answer. Blocks step 2 (the defaults in `server/store.js` only; test data may
    be reset).
18. **Bringing in pasted objects** (`importRefusal`), which calls no AI but shares Chat's rule today. (a) Not AI use:
    signed in, not a guest, the module's write access; neither `useAi` nor the space's AI switch; (b) the AI rule, as
    now. Lean: (a); pasting is how a person without the app's AI brings objects in. Blocks step 2 for that door only.
19. **Structured output from a `compatible` service.** (a) Try it, and fall back to prompt-then-parse when the service
    refuses the schema, remembered for that saved setting; (b) an owner's setting on the AI service tab ("Structured
    answers: on, off"); (c) always prompt-then-parse for `compatible`. Lean: (a), no new setting; the record says which
    was used. Blocks step 3.
20. **A switch to log full prompts for debugging.** (a) Never; (b) an environment variable (`AI_LOG_PROMPTS`), off by
    default and refused on a host with `BASE_DOMAIN`, that writes rendered prompts, redacted, to the server log; (c)
    an owner's switch per environment. Lean: (b), for a single-server owner chasing a bad answer. Blocks part of step 5.
21. **Rolling a prompt back.** (a) An environment variable pins a template to its previous version
    (`AI_PROMPT_VERSIONS=ask@1`), the registry keeping the current version and one before it; (b) only by running an
    older image. Lean: (a); one previous version is cheap to keep and a bad prompt is fixed without a release. Blocks
    step 3's shape.
22. **The token budgets** (proposed numbers): an `ask` prompt up to 12,000 tokens in all (instructions 1,500, the
    rollup 2,500, history 3,000 per open question 12, attached material 5,000), answers up to 1,500 tokens (1,200
    today); `summarise` the same without history; `tags` 4,000 in and 200 out. Lean: these, tuned once real counts are
    recorded. Blocks nothing; they are constants in each template.
23. **How long the per-call records are kept.** (a) 30 days, as private AI messages are; (b) 90 days; (c) the last
    1,000 calls. Lean: (a). Blocks part of step 5.
24. **The Assistant module and its `use` permission** (ai-18, ai-19). Plan-chat-model calls the Assistant retired, and
    under decision 1 its `use` permission gates nothing. (a) Remove the module and its permission, Chat's Assistant
    view being the assistant; (b) keep the module (as `optional`, per the must-fix) and remove only its `use`
    permission. Lean: (a). Blocks nothing in slice 1 beyond step 6's version bump.

Blocking slice 1: 15 and 17 block step 2 (18 its import door); 19 and 21 block step 3; 12, 13 and 14 block step 4;
16 blocks part of step 6; 20 and 23 block parts of step 5. Questions 1, 3, 4, 5, 7, 10 and 11 block step 10 onward;
6 blocks step 8; 8 blocks step 14; 2, 22 and 24 block nothing now.
