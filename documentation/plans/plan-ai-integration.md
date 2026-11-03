# AI Integration Plan

**Audience:** Thomas decides how AI reaches the app and what it may do there (the open questions at the end).
server-development builds the prompt layer (slice 1: the prompt registry, the context builder, the policy layer, the
provider adapters, the fake model and the golden checks), then the catalog, the tool routes, the tokens, the MCP
endpoint and the tool-calling loop (slice 2 onward); experience-design builds what a person sees of an answer (what it
used, cut short, the ask box from availability), the AI usage view, and later the Profile and Manage pages for tokens
and the AI inbox; quality-assurance reviews the policy layer and its redaction as a security change, and later the
tokens, the OAuth pages and the MCP endpoint; content-manager documents.

**Status:** draft for Thomas, first written 2026-11-02; fifteen decisions made on 2026-11-02 after the AI audit (below: four
on the direction, then Thomas's answers to the open questions). Slice 1 has no open questions left and is ready to build.
Slice 1, the prompt layer as this plan describes it (the prompt registry, the context builder, the policy layer, the
provider adapters, the fake model and the golden checks, `AI_LOG_PROMPTS`, `AI_PROMPT_VERSIONS`, What AI may see), is
not built. The cheap must-fixes from the audit landed outside this plan, in `4eccbae`, `fe3dea9`, `3eef7b9`, `1f3cf33`
and `bb5910f` (instructions and data in separate messages, the one permission rule, availability with a reason, the
hosted address guard, fair refunds, the monthly calls cap; Chat's `/ai` takes only the current space's objects); what
is built is described in [architecture-ai](../architecture/architecture-ai.md). From GitHub #382,
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

From the audit, outside this plan, built before slice 1 starts. The server half landed in `4eccbae` (2026-11-02):
it already applies decision 1's rule to Chat (`aiRefusalFor`, `aiServiceRefusal`), added `server/ai-http.js`, and
added `tools/check-ai-prompts.mjs` with a stand-in service, which step 1 grows into the fake model. The file and line
numbers in this plan are at `d2d9897` and have moved; the functions named are what slice 1 replaces. Slice 1 keeps each one and moves it into the layer
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

Thomas, 2026-11-02, answering open questions 12, 13, 15 and 17:

5. **Use AI is on by default for moderators and members, off for guests** (open question 17). Guests are refused
   whatever their role says (decision 1). Reason: Chat's AI stays available to members as it is today; the monthly
   allowance, the role tick and the space's switch hold cost.
6. **A turn is a question and its answer.** Up to 6 turns, capped at 3,000 tokens, the oldest turns dropped first (open
   question 12).
7. **Relevant objects are chosen by word match** on the space's object summaries, the best 15, plus the dated objects
   in the next 7 days; objects the person can't read never enter (open question 13).
8. **The owner sets what AI may see** (open question 15, answered with none of its options): "the space owner can set
   what to send." Environment-wide objects, asks with no space, and the other parts of the rollup are governed by an
   owner's setting, **What AI may see**, designed below. The setting can only narrow what is sent, never widen it past
   the person's own read rights or past the current space.

Thomas, 2026-11-02, approving the rest:

9. **What AI may see is approved as designed:** the switches, the defaults, owners and the admin setting it, the
   **AI used:** line, and that it can only narrow.
10. **Today is in the asker's browser time zone,** the server's as the fallback (open question 14).
11. **A public answer may draw on objects some members can't open;** each reader's **AI used:** line shows only what
    they may open (open question 16).
12. **Bringing in pasted objects is not AI use:** signed in, not a guest, and the module's write access; neither
    `useAi` nor the space's AI switch (open question 18).
13. **Structured output from a `compatible` service is tried,** with a fall back to prompt-then-parse when the service
    refuses the schema, remembered per saved setting (open question 19).
14. **Full prompts are logged only through an environment variable,** off by default and refused on a hosted install;
    **a prompt is rolled back by an environment variable** that pins the previous version (open questions 20 and 21).
15. **Call records, with no content, are kept 30 days** (open question 23).

### Choices the plan made

Thomas may overrule these; they are not his decisions.

- **Data is JSON, instructions are not.** The system message holds only instructions; the context, the history and the
  material go as data in their own messages, JSON-encoded, so no text in an object can close a marker or read as an
  instruction. The question is its own last message, never spliced into a sentence.
- **The asker's name and role word go in the context;** other members' names only when the owner's setting allows
  (decision 8).
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
  golden prompt changes and the version did not. The registry keeps the current version and the one before it, for
  rollback (decision 14).

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

- The object must be in the current space (`ref.scope === 'space'` and `ref.space === space.id`), or an
  environment-wide object (`ref.scope === 'environment'`) where the owner's setting allows it; an object of another
  space is left out whatever the setting says, and the answer says so (decision 4).
- It must pass the owner's setting, **What AI may see** (below): its module allowed, its category on.
- It is read with `resolveRef` as the person at that moment; what they can't read is left out, never named.
- **Redaction** before anything is rendered: no keys, tokens, share or guest links, the OBS access key, invitation
  addresses, other people's private messages or another person's person-scoped data; a Vault file's name only for
  someone who can read the Vault (plan-attachments-vault, decision 8). Redaction is a list of fields in the policy, one
  place, with a check that each field is stripped.

**One set of refusal sentences,** plain and capitalised, in the template's words, used by every route and by
availability. Provider detail goes to the server log, never to the page (ai-16).

**Bringing in pasted objects** calls no AI and is not AI use (decision 12): `aiPolicy.importRefusal` checks only that
the person is signed in, not a guest, and has the module's write access.

### What AI may see (the owner's setting, decision 8)

An owner chooses, for the environment and for each space, which parts of the context may be sent to the AI. It is
part of the policy layer and built in step 2.

**The switches.** Each is a category of what the context builder can send:

| Key | What it sends | Default |
|---|---|---|
| `attached` | Objects the asker attaches from this space, with their text | On |
| `relevant` | Summaries of this space's objects chosen for the question (decision 7) | On |
| `linked` | Summaries of the objects linked to an attached object | On |
| `history` | The asker's own earlier turns (decision 6) | On |
| `chat` | The space's recent public chat messages the asker can read: the last 20, up to 1,500 tokens, never a private one | Off |
| `members` | The display names and role words of the space's members (never a login, an address or a contact detail) | Off |
| `environment` | Environment-wide objects: `never`, `attached` (only when the asker attaches one), or `readable` (also chosen as relevant, when the asker can read them) | `attached` |
| `modules` | The modules whose objects may be sent: `all`, or a list of module ids | `all` |

Always sent, not switchable: the space's name, today's date, the phases and their dates, and the asker's own name and
role word (the rollup's first three parts). Turning AI off for the space stays the space's **Turn AI off** switch.

**Safe defaults** are the table's: the current space only; environment-wide objects only when the asker attaches
them; no other member's names; no chat messages.

**Where it lives and who changes it.**

- **The environment's default:** on Manage > Modules, the AI service tab, a **What AI may see** section with the
  switches above. Stored with the AI setting in `DATA_DIR/ai.json` as `sees`, changed by `PUT /api/ai`
  (`requireOwner`). It is also the setting for asks with no space (a module on an environment-wide page).
- **A space's own:** in the space's Set up, the AI section, under **Turn AI off in this <space>**: **What AI may see**,
  either **The <environment>'s choice** (the default) or **Choose for this <space>**, which shows the same switches.
  Stored as the space field `aiSees` (absent means the environment's choice), changed by `PATCH /api/spaces/:id`
  with `aiSees` (an object of the keys above, or `null` to go back to the environment's choice). Owners and the
  admin only, as **Turn AI off** is: `aiSees` is not in `MODERATOR_SPACE_FIELDS`.
- Unknown keys or values are refused (400) with a sentence naming the allowed ones. A module id no longer enabled is
  dropped when read. No migration: a space without the field follows the environment, an environment without `sees`
  has the defaults.
- **Who sees it:** owners and the admin on Set up and Manage. Members and guests do not see the setting itself; they
  see its effect on each answer (below).

**What the policy enforces.** What is sent is the narrowest of three: the person's own read rights now, the current
space (never another, decision 4), and the owner's setting. The setting can only narrow; no value of it lets in an
object the person can't read or one from another space. The context builder asks the policy for the effective
setting once per question and builds only what it allows; `aiPolicy.admit` checks each object against it again.

**How it appears to the asker.** Each answer carries one line, **AI used:**, built from what was actually sent:
"AI used: 2 attached notes, 9 other <objects> from <space>, 3 linked <objects>, your last 4 questions" (and "the
chat", "who is in this <space>" when those were on). When the setting kept something out that the asker attached, a
second line says so: "Not sent: this <space> doesn't send <module> <objects> to AI." The answer's stored message keeps
the counts and the categories (`sent`), so the line reads the same later.

**The record** of each call (Observability) lists the categories that were on and the counts sent per category.

### Who may see the rollup's parts (check cases for step 2)

- The defaults: an asker's attached environment-wide object is sent; one chosen as relevant is not; no member names,
  no chat messages.
- An owner turns a module off for a space: its objects are never in the rollup; attaching one gives the "Not sent"
  line; the record shows it left out.
- `environment: readable`, and a member who can't read that module: the object is not sent and not named.
- `members` on: names and role words only; a guest's name only while they are in the space.
- `chat` on: only public messages, only ones the asker can read, never another space's.
- A moderator sending `aiSees` gets 403; a member gets 403; an owner and the admin succeed; `null` returns to the
  environment's choice; an unknown key or value gets 400.
- No value of the setting sends an object from another space.
- A module asking from an environment-wide page uses the environment's setting, with no space part in the rollup.

### The context builder

`buildContext(who, space, { template, question, refs, tz })` answers `{ context, history, material, leftOut, budget }`.
It runs after the policy and only reads through it. It is built fresh for every question, at the moment of asking, and
nothing it makes is stored except the record below.

**History (decision 2).** The person's own private AI messages in this space (`chatHistory`, the messages with
`command: 'ai'` and their answers, paired by `replyTo`), newest first. A turn is a question and its answer;
up to 6 turns, capped at 3,000 tokens, the oldest turns dropped first (decision 6). Only when the owner's setting has
`history` on. Never another person's messages, never another
space's, never a deleted one. An answer goes back as its text and the titles of its objects, not their details. A
message the person made public still counts as theirs.

**The rollup (decision 2).** What goes in, in this order, each part with its own cap:

| Part | What | Cap |
|---|---|---|
| The space | Its name; the template's word for a space and for objects | 200 characters |
| Dates | Today's date and weekday in the asker's browser time zone, sent as `tz` with the ask, the server's (`ics.serverZone()`) when absent (decision 10); the space's phases from the template with their dates (`space.phases`, `public/phases.js`), and which phase today is in | 12 phases |
| The person | The asker's display name and role word | |
| Attached objects | The objects the person attached, with their text, as `material` | 12 objects, the material budget |
| Relevant objects | Summaries (kind, title, when, place, no text) of the current space's objects: the best 15 by word match of the question (and the last turn) against the summaries `GET /api/objects/search` makes, plus every dated object from today to 7 days ahead (decision 7) | 15 matched, plus the dated ones up to 30 |
| Linked objects | For each attached object, the objects it links to and that link to it (`module-links.js`, one step), as summaries | 5 per object, 20 in all |
| Chat | The space's last public chat messages the asker can read, only when the owner's setting has `chat` on | 20 messages, 1,500 tokens |
| Members | The members' display names and role words, only when the owner's setting has `members` on | 50 names |

Every part after the person is sent only when the owner's setting allows it (What AI may see, above). Every object in
the rollup goes through `aiPolicy.admit` as the person: from this space (or environment-wide, as the setting allows),
readable by them now, redacted. An object they can't read never enters, and neither does the fact that it exists.

**Freshness and caching.** The rollup is read from live data for each question, so an edit made a second before shows.
The server keeps no cache in slice 1; the space part is small and the objects are per person, so a cache would have to
be per person and invalidated on every change. If cost or time later shows a need, the space part (name, phases,
words) may be cached per space and dropped on any change to the space.

**The privacy rule.** The rollup contains only what the person could open themselves, now, in this space. The answer
records which objects it drew on (`used`, as pointers); nothing else of the rollup is kept. When the answer is made
public, it may have drawn on objects some readers can't open; each reader's **AI used:** line shows only what that
reader may open, and "and N others" for the rest (decision 11).

**The budget** (numbers proposed in open question 22). Tokens are estimated from characters before sending (about
four characters to a token, rounded up) and the real counts come from the provider afterwards. When the prompt is over
its budget, cut in this order and record each cut in `leftOut`: chat messages (oldest first), then linked summaries,
then relevant summaries (lowest first), then history (oldest first, down to the latest turn), then the attached objects' text (each shortened evenly,
the object itself kept). The question is never cut: one over 1,000 characters is refused at the route.

### The provider adapters

- One adapter per provider (`openai`, `anthropic`, `compatible`), each turning the rendered messages into its request
  and its answer into `{ text, structured?, finish, tokens: { in, out }, model }`.
- **Structured output** where the provider takes a schema: OpenAI's JSON schema response format (strict), and for
  Anthropic its structured output or a single forced tool whose input is the output contract, whichever the adapter
  targets when built. A `compatible` service: tried with the schema first; when it refuses the schema the adapter falls back to
  prompt-then-parse and remembers that for the saved setting, until the setting changes (decision 13). The record
  says which was used.
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

- **A record per call,** kept in `DATA_DIR/ai-log.jsonl` (kept 30 days, decision 15): when, the environment, space,
  person, purpose, template and version, provider and model, tokens in and out, the finish reason, how long it took,
  the outcome (answered, refused and why, or the error's kind), and counts of what was sent (history turns, attached,
  rollup and linked objects, and what was left out). Never the key, a header, the question, the material or the
  answer.
- **Full prompts** are never logged by default. `AI_LOG_PROMPTS=1` writes each rendered prompt, redacted and without
  the key, to the server log; it is off by default and refused (ignored, with one line in the log at start) on a
  hosted install with `BASE_DOMAIN` (decision 14).
- **`ai-usage.json`** gains tokens by template version, by person and by space for the month, beside tokens by task.
- **The AI usage view** (pages half). On Manage > Modules, the AI service tab, for owners: this month's tokens and
  calls by template, by person and by space, refusals by reason, errors, cut-short answers, and the last 50 calls as
  records (no content). On the host console, for the admin, each environment's AI this month (the fixed ai-27) and
  its calls. The activity list's line becomes "asked the AI (<template>, N tokens)" in plain words (ai-26).

### Versioning and rollback

- Every stored answer and every record names the template version that made it, so a bad answer can be traced to a
  version and a model.
- A new version ships with its golden files; the check fails when they disagree.
- **Rollback** (decision 14): `AI_PROMPT_VERSIONS` pins a template to its previous version (`AI_PROMPT_VERSIONS=ask@1`);
  a pin naming a version the registry doesn't keep is ignored with one line in the log at start. The previous
  version keeps its golden files until it is dropped.

### What a person sees (the pages half)

Beyond the must-fixes already being built (the ask box from availability, chips for attached objects, `/ai` working):

- **Under an answer, the AI used: line** (What AI may see, above): the attached objects as links, then the counts of
  the other parts sent, the "Not sent" line when the owner's setting kept out something attached, and "Some
  <objects> were left out to fit" when `leftOut` is not empty. Citations `[1]` link to the object they name (ai-24).
- **The What AI may see section** on the space's Set up and on Manage's AI service tab, for owners and the admin.
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

Ready to build: no open question blocks it. Sizes: small (a day or less), medium (a few days), large (a week or more).
Each step is built, checked, reviewed and committed before the next starts.

1. **The fake model and the harness (medium).** server-development: `tools/fake-model.mjs`, grown from the stand-in in
   `tools/check-ai-prompts.mjs` (OpenAI chat completions and Anthropic messages shapes; scripted answers for normal,
   echo, cut off, empty, not JSON, 401, 429, 500, slow, structured, a refused schema and Markdown);
   `tools/check-prompts.mjs` with `--update` to write golden files, run first against today's routes so the starting
   behaviour is recorded. Added to `npm run check`.
2. **The policy layer and What AI may see (large).** server-development: `server/ai-policy.js` with decision 1's rule,
   the door rules, the import door (decision 12), the reserved cap, the rate limit, space pinning, the redaction list,
   the refusal sentences and the effective What AI may see setting (`sees` in the AI setting, `aiSees` on a space,
   their cleaning and refusals, the check cases above); every AI, import and availability route switched to it and
   the old refusal functions deleted. The Roles label becomes **Use AI**, on by default for moderators and members
   (decision 5, `ROLE_DEFAULTS` in `server/store.js`; test data may be reset). experience-design: the What AI may see
   section on the space's Set up and on Manage's AI service tab.
   **Needs the larger-tier review.** This step is security work: who may ask, what may leave the server, redaction,
   and the owner's setting only ever narrowing. The project manager gives its build and its review the larger model,
   and quality-assurance reviews it as a security change before it is committed.
3. **The registry and the adapters (large).** server-development: `server/prompts/` with `ask`, `summarise`, `tags`
   and `paste`, typed inputs, the output contract, `render` and `parse`, the previous-version pin
   (`AI_PROMPT_VERSIONS`); `server/ai-providers.js` with structured output, the `compatible` try-and-fall-back
   (decision 13), the finish reason, token counts and the key binding; every prompt migrated (the list above) and the
   old prompt code deleted. Material only (no rollup or history yet). Golden files per template. The adapters send the
   key and read untrusted answers, so quality-assurance reads that part as security too.
4. **The context builder (medium).** server-development: `server/ai-context.js` with the history window, the rollup,
   the budget and `leftOut`, each part built only as the owner's setting allows; `sent` stored on the answer; `tz`
   accepted on the ask routes. Golden files for the rollup per role and per setting. Its permission filtering joins
   step 2's security review (the larger tier).
5. **Records and usage (small).** server-development: `DATA_DIR/ai-log.jsonl` kept 30 days, `AI_LOG_PROMPTS` (refused
   on a hosted install), `ai-usage.json` by template, person and space, `GET /api/ai/usage` for owners and its host
   console counterpart, the activity line. Checked that no record or log line holds the key, the question, the
   material or the answer.
6. **What a person sees (medium).** experience-design: the AI used: and Not sent lines (per reader on a public
   answer, decision 11), linked citations, "cut short", the question length in the box, `tz` sent with each ask, the
   default questions removed from Research, module-host and the Assistant (Research and the Assistant each a patch
   version bump), the AI usage view on Manage and the host console.
7. **Documentation (small).** content-manager: [api-modules](../api/api-modules.md) and the AI routes, the
   architecture's AI section, the user guide's AI, Roles and Set up pages (What AI may see), the environment variables
   `AI_LOG_PROMPTS` and `AI_PROMPT_VERSIONS`, [plan-chat-model](plan-chat-model.md)'s status.

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
  to be; a linked object the person can't read never appears, and its existence is not named; redacted fields never
  appear in any rendered prompt; the relevant objects are the best 15 by word match plus the next 7 days' dated ones.
- **What AI may see:** the check cases listed with the setting, each also as a golden rollup: the defaults, each
  switch off in turn, a module left out, `environment` at each value, and an ask with no space.
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
- **Use AI on by default** (decision 5) means every member's questions spend the environment's allowance until an
  owner unticks it for a role; the monthly allowance is the backstop.
- **An owner can make the AI less useful** by turning parts of What AI may see off; the AI used: line is what tells
  the asker why an answer knew less.
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
10. **How long the outside clients' audit trail is kept.** (a) 30 days; (b) 90 days; (c) the owner chooses. Lean: (a),
    as slice 1's call records (decision 15). Blocks step 10.
11. **The word on Profile** for tokens. (a) "Connected apps"; (b) "AI connections"; (c) "Outside AI". Lean: (a).
    Blocks step 10.
12. **What a "turn" is, and the history budget.** Answered 2026-11-02: a question and its answer, up to 6 turns,
    capped at 3,000 tokens, the oldest dropped first (decision 6).
13. **How the rollup chooses "the objects relevant to the question".** Answered 2026-11-02: word match on the
    object summaries, the best 15, plus the dated objects in the next 7 days; objects the person can't read never
    enter (decision 7).
14. **Which time zone "today" is in.** Answered 2026-11-02: the asker's browser time zone, the server's as the
    fallback (decision 10).
15. **Environment-wide objects and asks with no space.** Answered 2026-11-02, with none of the drafted options: the
    owner sets what to send (decision 8, What AI may see).
16. **A public answer that drew on objects some members can't read.** Answered 2026-11-02: allowed; each reader's
    **AI used:** line shows only what they may open (decision 11).
17. **`useAi`'s defaults, now that it gates Chat too.** Answered 2026-11-02: on for moderators and members, off for
    guests, who are refused whatever it says (decision 5).
18. **Bringing in pasted objects.** Answered 2026-11-02: not AI use; signed in, not a guest, the module's write
    access (decision 12).
19. **Structured output from a `compatible` service.** Answered 2026-11-02: tried, falling back to prompt-then-parse,
    remembered per saved setting (decision 13).
20. **A switch to log full prompts.** Answered 2026-11-02: an environment variable, off by default, refused on a hosted
    install (decision 14).
21. **Rolling a prompt back.** Answered 2026-11-02: an environment variable pins the previous version (decision 14).
22. **The token budgets** (proposed numbers): an `ask` prompt up to 12,000 tokens in all (instructions 1,500, the
    rollup 2,500, history 3,000 (decision 6), attached material 5,000), answers up to 1,500 tokens (1,200
    today); `summarise` the same without history; `tags` 4,000 in and 200 out. Lean: these, tuned once real counts are
    recorded. Blocks nothing; they are constants in each template.
23. **How long the per-call records are kept.** Answered 2026-11-02: 30 days, no content (decision 15).
24. **The Assistant module and its `use` permission** (ai-18, ai-19). Plan-chat-model calls the Assistant retired, and
    under decision 1 its `use` permission gates nothing. (a) Remove the module and its permission, Chat's Assistant
    view being the assistant; (b) keep the module (as `optional`, per the must-fix) and remove only its `use`
    permission. Lean: (a). Blocks nothing in slice 1; if answered before step 6, the Assistant's version bump there follows it.

Nothing blocks slice 1: every question for its steps is answered (12 to 21 and 23), and 22 and 24 have working
leans that block no step. Questions 1, 3, 4, 5, 7, 10 and 11 block step 10 onward; 6 blocks step 8; 8 blocks step 14;
2 blocks nothing now.
