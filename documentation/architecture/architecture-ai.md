# AI

**Audience:** developers and operators who need to know how Coffee Pub Chameleon asks an AI service, who may ask, what is sent, what the server refuses and where the code lives.

This describes what is built: slice 1 of [plan-ai-integration](../plans/plan-ai-integration.md), the prompt layer, and slice 2's steps 8 to 10 and 12: the look-up tools and the loop that runs them in Chat's `/ai`, the pages that show a look-up, and the catalog of write tools made from the modules' manifests. Not built, and not described as if it were: step 13 (the AI proposing a change, with **Keep** and **Drop**, and the request on Keep), tokens for outside AI apps and an MCP endpoint. Nothing the AI is offered can change anything. **Everything here has run only against the stand-in service on this machine. No real provider has answered a question with tools or without them;** see "Not yet tried against a real service" at the end.

## The shape

There is one AI service for an environment, set by its owner on **Manage**, **Modules**, **AI service** (see [userguide-modules](../userguides/userguide-modules.md)), or one the host offers as a managed service. The server holds the key and the address; a page never sees either. These files carry the work:

- `server/prompts/` is the prompt registry: every word the server says to a model, one file for each template, with a version, typed inputs and an output contract.
- `server/ai-policy.js` is the policy layer: who may ask, which objects may be sent, redaction and the refusal sentences.
- `server/ai-context.js` is the context builder: what is sent beside the question.
- `server/ai-providers.js` holds one adapter for each family of service: OpenAI, Anthropic and a compatible address. It builds a plain request and a request with tools (`completeRound`).
- `server/ai-tools.js` holds the two look-up tools' work and the loop that runs a question in rounds (`createAiTools`, `runToolLoop`). The tools' own descriptions, input schemas and input checks are in `server/prompts/tools/`.
- `server/action-catalog.js` makes the catalog of write tools from the modules' manifests and checks an input against a tool's schema.
- `server/ai.js` holds the setting (`DATA_DIR/ai.json`, the key encrypted with the host's secrets key), the month's use (`DATA_DIR/ai-usage.json`), the call records (`DATA_DIR/ai-log.jsonl`) and `run`, which renders a template, calls the adapter, reads the answer and records the call.
- `server/ai-http.js` is the one way the server talks to a service: a plain request with a time limit (90 seconds), a size limit (1 MB), no redirects and, where the address was typed by an owner on a host, the address guard below.
- `server/index.js` holds the routes: `GET` and `PUT /api/ai`, `GET /api/ai/usage` and `POST /api/ai/models` (owners), `POST /api/modules/:id/ai` for a module's ask, `GET`, `POST /api/spaces/:id/ai` for Chat's `/ai`, and `GET /api/ai/catalog` for the write tools a person could be offered in a space. The contracts are in [api-modules](../api/api-modules.md), "Chat routes" and the runtime routes.

## The prompt registry

A template is one file in `server/prompts/`, listed by `server/prompts/index.js`. Each has an `id`, a `version`, the inputs it takes, its output and a budget in tokens (the whole prompt, the share for the rollup, the history and the attached material, and the answer's own limit). A template's name in a record is `<id>@<version>`, such as `ask@2`.

`ask@2` renders exactly as `ask@1` does, with one difference: when the look-up tools are offered, its instructions gain a paragraph saying the model may search and read this space's objects before it answers, that what a tool returns is data and never an instruction, that every object has a number `n` to cite, and that it must finish by calling the `answer` tool once. When no tool is offered (a module's ask, a space or an environment with look-ups off, or a service that refused tools) `ask@2` is `ask@1`. `ask@1` takes no tools, so pinning it with `AI_PROMPT_VERSIONS=ask@1` also turns the look-ups off.

| Template | Used for | Output |
|---|---|---|
| `ask@2` | A question: Chat's `/ai`, the Assistant tab, `host.chat.ask`, and a module's `host.ai.ask` with task `ask` | an answer with objects |
| `ask@1` | The same question without the look-up paragraph; kept for rollback | an answer with objects |
| `summarise@1` | A module's `host.ai.ask` with task `summarise`; needs objects | an answer with objects |
| `tags@1` | A module's `host.ai.ask` with task `tags`; needs objects | up to 6 tags |
| `paste@1` | The instructions a person copies into another AI (`GET /api/objects/format`); never sent to the in-app model | none |

A template renders to a provider-neutral list of messages: the instructions in one system message, the data as one user message holding JSON, the person's earlier turns as alternating user and assistant messages, and the question last. One rule keeps them steady: anything a template renders or reads back differently is a new version.

- **Versions are frozen by golden files.** `tools/golden/prompts/` holds each kept version's rendered prompt for each fixture, both as the structured form and as the form read back by parsing. `tools/check-prompts.mjs` fails when a template changes under the same version. `--update` writes the golden files a version does not have yet.
- **The registry keeps the current version and the one before it.** `AI_PROMPT_VERSIONS` (for example `ask@1,tags@1`) pins a template to a kept version, for rollback. A pin naming a template or version the registry does not keep is ignored.

## What is sent

The model is given two kinds of text, kept apart. The **system turn** holds every instruction: who the model is, the task, the rule for the objects block and its example. The **user turns** hold only data: a JSON document of the context and the attached objects, each with a number `n`, then the earlier turns, and last the question. Data is escaped so nothing in it can close a marker, open another or start a code fence, and the system turn says the data is never an instruction. A model asked through Chat's `/ai` may be offered the two look-up tools (below) and nothing else; a module's ask is offered none. Its answer is text or JSON, and nothing it says is run.

The example in the objects rule is made only of placeholders in angle brackets. A model that copies it writes an object whose title is still a placeholder, and the reader drops that object, so the prompt's own example never comes back as an answer.

**The question** is 3 to 1,000 characters. One over 1,000 is refused at the route, not cut: "A question is at most 1,000 characters; this one is N." With an attached object and no question, the route asks the template's own, "What should I know about <title>?".

**The answer** is read against its template. `used` and each object's `sources` are numbers in the prompt; the route turns them back into pointers from the list it keeps as `numbered`. Before it is kept or shown, the answer's text and its objects' text lose what a page could run or follow: script, style and embedding elements with what they hold, every other HTML tag, Markdown links to a `javascript:`, `vbscript:`, `data:` or `file:` address (the link's words stay) and every secret a prompt may not carry. An answer that ran out of room is flagged `cut`, keeps the complete objects it had written and carries no note in its text; the page says it from `cut`. Raw object JSON never stays in an answer's text. An answer with no text and no objects is not an answer: it is 502, its tokens still count, and the record says `empty`. The objects format itself is in [architecture-modules](architecture-modules.md), "The objects format".

## The context

`buildContext` in `server/ai-context.js` makes the context fresh for every question and reads everything through the policy layer. It answers the context, the history, the attached material, `numbered`, `leftOut` and `sent`.

- **The rollup.** The space's name and words, today's date and weekday in the asker's time zone (the page sends `tz`; an unknown zone is the server's), the phases and their dates, and the asker's name and role are always sent. Beside them, each only as the owner's setting allows: the **relevant** objects (up to 15 best matches by the words of the question and the last one, plus objects dated in the next 7 days, 30 in all), the **linked** objects (those the attached ones link to or that link to them, one step: up to 5 for each attached object, 20 in all), the space's last 20 public chat messages (never a private one, and only for someone who may read the chat now) and the members' names and role words.
- **History.** The asker's own last 6 turns in this space (a question and its answer), oldest first, within 3,000 tokens. A module's ask has none, since it is not a conversation.
- **Attached objects.** Up to 12, each with its text (up to 8,000 characters), shortened evenly when the total passes its share (5,000 tokens).
- **The whole prompt** has a budget of 12,000 tokens for an `ask`. When it is over, the builder cuts in this order: chat, linked, relevant (the lowest scoring first), history (down to the latest turn), then the attached text. The question is never cut. Each cut is recorded in `leftOut` as `{ part, why, count }` (`why`: `budget`, `shortened`, `setting` or `other-space`), and `sent.cut` is true after a budget cut.
- **Numbering.** The attached objects are numbered from 1 and the relevant and linked objects carry on, so a citation `[n]` names one object whichever part it came from.
- **What an answer keeps.** A Chat answer stores `sent` (the count for each part, the attached pointers and, in `notSent`, the objects kept out because they were from another space or kept out by the setting), `numbered`, `leftOut` and `cut`, so the page can say later what it used. A module's ask returns the same and keeps nothing.

## What AI may see

What is sent is the narrowest of three: the person's own read rights now, the current space (never another one's objects, whatever the setting), and the owner's setting **What AI may see**. The setting can only narrow. It is `sees` in `DATA_DIR/ai.json` (set by `PUT /api/ai`) and `aiSees` on a space (set by `PATCH /api/spaces/:id`; `null` follows the environment). Its keys are the switches `attached`, `relevant`, `linked`, `lookup`, `history`, `chat` and `members`, then `environment` (`never`, `attached` or `readable`: objects of the environment outside any space) and `modules` (`all` or a list of module ids). Left alone, it sends the attached, relevant and linked objects and the history, lets the AI look things up, and does not send the chat, the members, or an environment's objects beyond those a person attached. The pages are on **Manage**, **AI service** and in a space's **Set up**, **Modules**; see [userguide-modules](../userguides/userguide-modules.md) and [userguide-spaces](../userguides/userguide-spaces.md).

`lookup` is the one switch where the environment and the space do not simply replace each other: the effective value is the environment's **and** the space's (`effectiveSees` in `server/ai-policy.js`). A space can turn look-ups off for itself, never on when the environment has them off. In a space's **Set up**, the switch is shown off and locked, with "Off for the whole <environment>." as its line, while the environment has look-ups off. What a look-up may return is narrowed by the other keys as well: `modules` and `environment` apply to every result, and an object's own part is `lookup` (`admit` in `server/ai-policy.js`).

**Redaction.** One list in `server/ai-policy.js` says which fields of an object's summary are sent (`SENT_FIELDS`: kind, title, subtitle, when, end, all-day, done, category, amount, planned, place name and text) and which never are (`REDACTED_FIELDS`: pointers, people's keys, the spaces it is marked into, copies, icon, colour and how the page draws it). `tools/check-prompts.mjs` checks the lists field by field. Any text sent also loses a link's secret query values (a guest link, the OBS access key, an invitation or sign-in token), a sign-in link's token, a calendar feed's token, a bearer header, the shapes of the providers' keys and the exact secrets this server holds (the access key, every space's guest token, every person's sign-in link token and the AI key).

## The look-up tools

In Chat's `/ai` (and so in the Assistant tab) the model may look things up before it answers. It is offered three tools, each a versioned entry in `server/prompts/tools/` with golden files in `tools/golden/tools/`:

| Tool | Takes | Answers |
|---|---|---|
| `search_objects@1` | at least one of `words` (up to 200 characters), `kind` (one kind, such as a note), `from` and `to` (days, `YYYY-MM-DD`; `from` may not be after `to`) and `has` (only `"place"`). Every field is listed and an unused one is `null` (the strict form both providers take) | `{ objects: [...] }`, up to 15, best first, each `{ n, kind, title, when?, end?, place?, done?, module }` with no text; `more: true` when more matched; `{ objects: [] }` when nothing did |
| `read_object@1` | `n`, a number | `{ n, kind, title, when?, place?, text, links }`: the text (up to 8,000 characters, with the subtitle) and one step of links, up to 5, each with its own number; or `{ error: "Not found." }` |
| `answer@1` | the ask template's output contract (`answer`, `objects`, `used`) | nothing: calling it ends the question |

A look-up is offered when the question is in a space and What AI may see has `lookup` on for it. Without that, only `answer` is offered, and the question runs as it did before.

**Numbers, never pointers.** The model never sees or sends a pointer. Every object it is shown, whether attached, in the rollup or found by a tool, carries a number `n`, and `read_object` takes only a number the server gave out in this question. A number the server did not give out, an object that has gone and an object the person can no longer read are all `Not found.`, in the same words, so a model can name no object of another space and learn nothing by guessing. The route turns the numbers in the answer back into pointers (`numbered`), including the ones the tools gave out.

**As the person asking.** There is no identity of the AI's own. At each call the server reads the space's objects as the person asking and passes each one through the policy's `admit` with the part `lookup`, so the space pinning, What AI may see, the person's read rights, the modules' guards and redaction hold for tool results exactly as for the rollup. `search_objects` searches this space only, and the environment's objects outside any space only when What AI may see has `environment` set to `readable`. It matches the words against what the model may read (the redacted title, subtitle, kind, category and place name), never the raw text, so a secret in a title cannot be found by searching for it. An object the policy keeps out is left out and never named.

**The loop** (`runToolLoop` in `server/ai-tools.js`). The question is sent with the tools; each tool call is checked (the name must be one offered this round and the input must pass its tool's check), run, its result capped and sent back as a tool result, and the model is asked again. It ends when the model calls `answer`, or answers in plain text (read by the same prompt-then-parse as slice 1 and taken as the answer), or reaches a limit:

- **4 rounds, 8 look-ups and 120 seconds** for one question, each request at most 90 seconds. On the last round, or once 8 look-ups are used, only `answer` is offered and it is forced. A look-up asked past the eighth gets `No more look-ups; answer now.`
- **Result sizes.** One result at most 8,000 characters as JSON; all results together at most 24,000 (6,000 tokens), the oldest shortened first. A result is shortened by cutting a read object's text, then dropping the last objects of a search (`more` is set) and a read object's links, and as a last resort becomes `That was too long to send.` Nothing is cut in the middle of a JSON value.
- **What the model sees when it gets something wrong**, as a tool result and never as a failed question: `There is no tool <name> here; use <the offered ones>.`, `The input to <tool> could not be read as JSON.`, the tool's own sentence for a bad input (for example `Give at least one of words, kind, from, to or has.`, `from is after to.`, `read_object takes { "n": a number you were given }.`) and `Not found.`
- **A question that does not finish** ends with 502 and one of slice 1's sentences: `The AI didn't finish its answer.` (a last round with no answer), `The AI service gave no answer.` (a round with neither text nor a call) or `The AI service took too long to answer. Try again in a moment.` (the 120 seconds). The allowance can stop it too: a round that would not fit is refused with 429 and the allowance sentence, and rounds already billed stay counted.

**What a tool result is.** Tool results are data from the space, like the first user message, and the instructions say so. They go back as JSON cleaned like the data message (no NUL, no run of backticks).

**Counting.** A question with rounds is one turn at the rate limit and one call against the host's monthly calls, however many rounds it takes. Every round's tokens count against the month's allowance. Each round reserves its estimate before it is sent and settles to the real count, as in slice 1. A question is a call only when a round was billed: one that fails with nothing billed is given back; one that fails after a paid round counts once.

**A service that refuses tools.** A compatible service that answers the first round with a 400 or 422 saying tools, `tool_choice` or function calling are not supported is asked again once without tools, and that is remembered for the saved provider, address and model (`toolsRefused` in `DATA_DIR/ai.json`) until the setting changes or a later question succeeds with tools. A context-length error that mentions tools is not a refusal. Such an answer has no `lookup`, and its record says `tools: refused`.

**What an answer keeps.** A Chat answer that looked things up stores `sent.lookup`: `{ searches, read }`, the number of searches and the objects it read as pointers. The read objects join `used`. `numbered` holds the numbers the look-ups gave out as well. The call's record keeps counts only (below).

**Who reads the pointers.** An answer shared with the space keeps pointers (`numbered`, `used`, the objects attached, the objects read and each object's sources), and a reader who is not the asker may open only some of them. `GET /api/spaces/:id/chat` returns another reader's copy of an AI answer with each pointer kept only when that reader can open the object (`aiAnswerForReader` in `server/index.js`, the page's own rule); `numbered` keeps its places and a pointer the reader cannot open is `null` there. Making an answer public sends the live `chat-visibility` event with the message and no pointers at all, one object for every reader, so a page reads its own copy from the list. The asker's own copy is not filtered.

## The catalog of write tools

Slice 2's second half is the list of changes an AI could be asked to propose, made from the modules' manifests. `server/action-catalog.js` generates it whenever it is asked for, from the manifests of the modules that are on, so it cannot drift from them. **Nothing in it runs an action or proposes one**: that is step 13, not built. It says what may be offered and what an input must look like.

**The manifest fields.** An entry in `actions.provides` may carry `description` (one plain sentence, up to 200 characters, in the template's words like a label), `effect` (`write`, the default, or `destructive`: takes something away that cannot be had back) and `ai: false` (keeps the action out). A manifest is refused at install with `module.json: action "<name>" description must be text: one sentence saying what it does.`, `... description is empty; ...`, `... description is at most 200 characters.`, `... effect must be write or destructive.`, `... ai must be true or false.`, and, for a `local` action (a view on one person's page), `... is local, which changes nothing, so it has no effect.` or `... is local, so it is never offered to the AI.` The contract is in [api-modules](../api/api-modules.md).

**Which actions become tools.** One that acts on an object that already exists: it has a required pointer input (`ref` or `ref:<module>:<kind>`) and no whole-object input (new objects already come as the answer's objects, each with **Keep**). It must be described, `write` and not `local`, not asker-only and not `ai: false`, and `<module>__<action>` must be a name of 1 to 64 letters, digits, `_` and `-`. Every other action is left out with one reason (`local`, `asker-only`, `ai-off`, `destructive`, `no-description`, `new-object`, `long-name`). The bundled modules make four tools today: `places__setPlacePoint`, `todo__linkTask`, `todo__setTaskDue` and `travel__addToDay` (`tools/golden/catalog.json`). Destructive actions are left out for now, following the plan's lean on its open question 6.

**The schema.** Written to the strictest form both providers take: an object with `additionalProperties: false`, every property listed in `required`, and an optional input (a type ending in `?`) allowed to be `null`, meaning absent. A pointer input is an integer of at least 1, "the number n of a <kind> shown in this question", never a pointer. `string` is 1 to 200 characters, `text` 1 to 8,000, `date` a `YYYY-MM-DD` pattern, `datetime` an ISO 8601 `date-time`, with `boolean` and `number`. `checkToolInput` checks a model's input against it and answers one sentence the model can be sent back (`<field> is needed.`, `<tool> takes no <field>.`, `<field> must be the number n of a place shown in this question.`, `<field> must be a date, YYYY-MM-DD.`). An optional text left empty counts as left out, an empty required date is refused, and a date or date and time must be a real day. Turning numbers back into pointers and the bus's own checks are the caller's, in step 13.

**`GET /api/ai/catalog?space=`.** For a signed-in person who is not a guest. It applies the same AI rule as Chat's `/ai` (so the refusals and their sentences are the same), then lists the tools whose module is on, allowed by What AI may see and one the person could change in that space (the module's `write` access). Each entry is `{ name, module, moduleName, action, label, description, effect, schema }`. The contract is in [api-modules](../api/api-modules.md).

The bundled modules' actions were described for this, each as a patch version: Budget 0.1.23, Calendar 1.24.36, Places 0.12.21, Research 0.4.32, To-do 1.15.26 and the Planner 0.16.5.

## Who may ask

One rule, `check` in `server/ai-policy.js`, serves every door (Chat's `/ai` and a module's ask). It runs in this order, and each refusal has a `reason`:

1. Not signed in as a person, or a guest: `guest`. A guest never may.
2. The role does not have **Use AI in modules** (`useAi`, in the space where there is one): `role`. It starts on for moderators and members and off for guests; owners always may.
3. The space has AI turned off (**Turn AI off in this space**): `space-off`.
4. At Chat's door, the person is not in the space (`member`) or their role may not chat there (`chat`). At a module's door, their role lacks the module's `write` permission in that place (`module`).
5. The service is not ready (not set up, or its saved key can't be read on this server): `not-set-up`.
6. The month's token allowance is used up, or, on a host, the plan's monthly AI calls: `allowance`.

`GET /api/spaces/:id/ai` and `GET /api/modules/:id/ai` answer `{ available, why, reason }` from the same rule, so a page says why before a question is typed. A module's ask is also held to the rule for the objects it names. A module may send only its own objects and those it was approved to link to. A request in a space takes only that space's objects. A request from the environment's or a person's own page refuses an object from a space with AI turned off or where the role may not use AI. Chat's `/ai` takes only the current space's objects, because the question and answer are kept in that space's chat.

Pasting research from another AI is not AI use. `objects/check` needs only a signed-in person who is not a guest, and the module's `write` permission.

## Counting, refunds and the monthly caps

A person may ask six times a minute. All AI is one count (Chat's `/ai` and every module's ask together), kept by `server/module-limits.js`. A question that runs in rounds takes one turn, not one for each round. A bad ask (no question, nothing to work on, a question that is not text or is too long) is refused before it is counted. A failed ask is **given back** only when the service did no work: nothing was sent, the address was refused, the connection failed before an answer began, or the service said it was busy or down (429 or a 5xx) or refused the key. A timeout, an over-long answer and any other refusal count, because the service may have worked and billed. Tokens a failed ask reports are recorded all the same. A question counts as a call against the host's monthly AI calls only when the service billed a round, in Chat and in a module's ask alike; one that failed before any round was billed does not.

An environment's `monthlyTokens` (0 for none) answers 429 when used up. Before a call is sent, the allowance is checked against what the call is estimated to use (its prompt, at about four characters to a token, plus the template's answer limit) and against what asks already on their way have reserved, so several asks at once cannot pass the cap together. On a host, the plan's `aiCallsPerMonth` answers 429 with "This environment has used its N AI calls for this month." Both are checked before anything is sent and given back.

## The provider adapters

An adapter in `server/ai-providers.js` turns the rendered messages into its service's request and the reply into one shape: the text, the structured answer, a finish reason (`stop`, `length`, `filter` or `error`), the tokens in and out, the model and the mode. OpenAI gets a strict JSON-schema response format. Anthropic gets one forced tool whose input is the schema. A request with tools carries them in each family's own form, and a tool result goes back as that family's tool-result message; a service that refuses tools is handled as under "The look-up tools". A compatible service is tried with the schema first and, when it refuses it, with the prompt-then-parse form (the object block in fences, read back); that refusal is remembered for the saved provider, address and model until the setting changes. Errors become plain sentences; the service's own words go to the server log, never to a page.

`tools/fake-model.mjs` is a small stand-in service on this machine that the checks use, so no check calls a real AI service.

## Records and use

`ai.run` appends one line for each call to `DATA_DIR/ai-log.jsonl`, kept 30 days: when, the environment, space and person, the purpose (`chat` or `module`), the template and version, the provider and model, the mode, tokens in and out, the finish reason, how long it took, the outcome (`answered`, `refused` or `error`), the refusal's `reason` or the error's kind, `cut`, and the counts of what was sent and left out. For a question asked with the look-up tools it also has `tools` (`on`, `off`, or `refused` when a compatible service refused them), `rounds`, `toolCalls` (a count for each tool name; a name the model made up is counted under `unknown`), `looked` (`{ found, read }`: how many different objects its searches found and its reads linked to, and how many it read) and `stop` (`answer`, `limit` or `text` for an answer; `unfinished`, `time`, `allowance` or `empty` for a failure). A fixed list of fields (`LOG_FIELDS` in `server/ai.js`) is the only thing ever written; there is no question, material, answer, key or header, and no tool's input or result. A refused ask is recorded too, with its reason.

`DATA_DIR/ai-usage.json` holds the month's tokens and calls, in all and by task, by template version, by person and by space. `GET /api/ai/usage` (owners) answers this month's use with the calls by template, the refusals by reason, the failures by kind, the count of answers cut short, and the last 50 records. **Manage**, **AI service**, **AI use this month** draws it.

## Environment variables

| Variable | Effect |
|---|---|
| `AI_PROMPT_VERSIONS` | Pins templates to a kept earlier version, such as `ask@1,tags@1`. At start the server logs a line for a pin it ignores and for one that points to an earlier version. |
| `AI_LOG_PROMPTS` | `1` writes every prompt sent to the AI service to the server log, without the key, for a developer to read. Refused on a host: with `BASE_DOMAIN` set it is ignored, with a line in the log. |

The address variables below are for a developer running a host on one machine. `AI_KEY` and `AI_ADDRESS` set the managed Other service on a host.

## The key and its address

A saved key belongs to the service and address it was saved for. Changing the provider, or the address of an Other service, drops the saved key unless a key is typed in the same request. Listing a service's models uses the saved key only at the address it was saved for. On a host, the managed Other service's key from the server's environment (`AI_KEY`, with `AI_ADDRESS`) is sent only to `AI_ADDRESS`; if a host admin saves another address, that key is not used there. A key is one line of text: one with a line break or another control character is refused when typed.

## The address guard on a host

On a single server, the admin is trusted with their own network and nothing is guarded. With `BASE_DOMAIN` set, an owner types the address of an Other service, so the request is guarded in `server/ai-http.js`:

- `https` only, and never to a private, loopback, link-local, shared (carrier-grade), documentation or multicast address, or the cloud metadata address. IPv6 forms that can carry a private IPv4 address (the mapped, NAT64, 6to4, Teredo and compatible forms) are refused whole.
- The address is checked when it is saved (`400 "That address cannot be used."`) and again on every connection, on the address the name resolved to, so a name that points inside after it was saved is refused too.
- Every failure in listing models or asking says the same sentence, and nothing about the address or what it answered. The detail goes to the log; the key and the prompt never do.

A developer running the host on one machine can relax the guard with environment variables:

| Variable | Effect |
|---|---|
| `AI_ALLOW_HTTP` | `1` allows a plain `http` address. |
| `AI_ALLOW_PRIVATE_ADDRESSES` | `1` allows private, loopback and link-local addresses. |

Each is shown commented out in `docker-compose.yml`. On start the server prints a warning for each that is set, to unset it on a real host. The host's managed services are never guarded; they are the host's own.

## Switching AI off and on

Turning the AI service off while a module needs it (a module whose `ai` hook is `true`) asks first, and then turns those modules off too, remembering which. Turning it on again turns the same modules back on. A module whose hook is `"optional"` stays on and hides its AI controls.

## Checked by

`npm run check` includes `tools/check-ai.mjs` (the service, its setting and the stand-in service), `tools/check-prompts.mjs` (the golden prompts for each kept version, parsed answers, hostile input, the context builder, the policy's refusals and availability, What AI may see, the reserved allowance, the records and usage with no content, the key bound to its address, structured output for each provider, `AI_LOG_PROMPTS` and `AI_PROMPT_VERSIONS`), `tools/check-ai-prompts.mjs` (the prompt, the placeholder example, cut-off answers, the key and its address, the guard, who may ask, refunds and switching off and on), `tools/check-ai-tools.mjs` (the look-up tools and the loop: the tools' golden files, numbers, the policy on every result, the limits, the rounds' reserve and settle, the errors a model is sent, the service that refuses tools, the shared answer's pointers), `tools/check-catalog.mjs` (the manifests' new fields and their refusals, the generated schemas, the golden catalog and `GET /api/ai/catalog`) and `tools/check-ai-page.mjs` (the pages: the Assistant, the **AI used:** line, citations, What AI may see, the look-up switch and the use view). All run against the stand-in service on this machine (`tools/fake-model.mjs`, which can script tool calls in both providers' shapes and a service that refuses tools).

## Not yet tried against a real service

No real provider has answered a question for these checks, with or without tools. Unseen: how real models use the tools and stop, real token counts for each round, Anthropic's forced `answer` tool and OpenAI's required tool choice with strict schemas, and a real compatible service (Ollama, LM Studio) with tools. The plan holds the 13-step test script for the first real try ([plan-ai-integration](../plans/plan-ai-integration.md), "Before step 1: slice 1 against a real provider"). To run it the owner supplies one provider key with a spending limit set on the provider's console (the plan suggests about US$10, and `monthlyTokens` at 500,000 on the environment), a local server or a test environment no real people use, and optionally a compatible service on the same machine. Until then, treat how an answer reads, and what a look-up costs, as unknown.
