# AI

**Audience:** developers and operators who need to know how Collaborator asks an AI service, who may ask, what is sent, what the server refuses and where the code lives.

This describes what is built: slice 1 of [plan-ai-integration](../plans/plan-ai-integration.md), the prompt layer. The catalog, the tool routes, tokens for outside AI apps and the tool-calling loop are slice 2 onward and are not built or described here.

## The shape

There is one AI service for an environment, set by its owner on **Manage**, **Modules**, **AI service** (see [userguide-modules](../userguides/userguide-modules.md)), or one the host offers as a managed service. The server holds the key and the address; a page never sees either. These files carry the work:

- `server/prompts/` is the prompt registry: every word the server says to a model, one file for each template, with a version, typed inputs and an output contract.
- `server/ai-policy.js` is the policy layer: who may ask, which objects may be sent, redaction and the refusal sentences.
- `server/ai-context.js` is the context builder: what is sent beside the question.
- `server/ai-providers.js` holds one adapter for each family of service: OpenAI, Anthropic and a compatible address.
- `server/ai.js` holds the setting (`DATA_DIR/ai.json`, the key encrypted with the host's secrets key), the month's use (`DATA_DIR/ai-usage.json`), the call records (`DATA_DIR/ai-log.jsonl`) and `run`, which renders a template, calls the adapter, reads the answer and records the call.
- `server/ai-http.js` is the one way the server talks to a service: a plain request with a time limit (90 seconds), a size limit (1 MB), no redirects and, where the address was typed by an owner on a host, the address guard below.
- `server/index.js` holds the routes: `GET` and `PUT /api/ai`, `GET /api/ai/usage` and `POST /api/ai/models` (owners), `POST /api/modules/:id/ai` for a module's ask, and `GET`, `POST /api/spaces/:id/ai` for Chat's `/ai`. The contracts are in [api-modules](../api/api-modules.md), "Chat routes" and the runtime routes.

## The prompt registry

A template is one file in `server/prompts/`, listed by `server/prompts/index.js`. Each has an `id`, a `version`, the inputs it takes, its output and a budget in tokens (the whole prompt, the share for the rollup, the history and the attached material, and the answer's own limit). A template's name in a record is `<id>@<version>`, such as `ask@1`.

| Template | Used for | Output |
|---|---|---|
| `ask@1` | A question: Chat's `/ai`, the Assistant tab, `host.chat.ask`, and a module's `host.ai.ask` with task `ask` | an answer with objects |
| `summarise@1` | A module's `host.ai.ask` with task `summarise`; needs objects | an answer with objects |
| `tags@1` | A module's `host.ai.ask` with task `tags`; needs objects | up to 6 tags |
| `paste@1` | The instructions a person copies into another AI (`GET /api/objects/format`); never sent to the in-app model | none |

A template renders to a provider-neutral list of messages: the instructions in one system message, the data as one user message holding JSON, the person's earlier turns as alternating user and assistant messages, and the question last. One rule keeps them steady: anything a template renders or reads back differently is a new version.

- **Versions are frozen by golden files.** `tools/golden/prompts/` holds each kept version's rendered prompt for each fixture, both as the structured form and as the form read back by parsing. `tools/check-prompts.mjs` fails when a template changes under the same version. `--update` writes the golden files a version does not have yet.
- **The registry keeps the current version and the one before it.** `AI_PROMPT_VERSIONS` (for example `ask@1,tags@1`) pins a template to a kept version, for rollback. A pin naming a template or version the registry does not keep is ignored.

## What is sent

The model is given two kinds of text, kept apart. The **system turn** holds every instruction: who the model is, the task, the rule for the objects block and its example. The **user turns** hold only data: a JSON document of the context and the attached objects, each with a number `n`, then the earlier turns, and last the question. Data is escaped so nothing in it can close a marker, open another or start a code fence, and the system turn says the data is never an instruction. The model gets no tools and its answer is only text; nothing it says is run.

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

What is sent is the narrowest of three: the person's own read rights now, the current space (never another one's objects, whatever the setting), and the owner's setting **What AI may see**. The setting can only narrow. It is `sees` in `DATA_DIR/ai.json` (set by `PUT /api/ai`) and `aiSees` on a space (set by `PATCH /api/spaces/:id`; `null` follows the environment). Its keys are the switches `attached`, `relevant`, `linked`, `history`, `chat` and `members`, then `environment` (`never`, `attached` or `readable`: objects of the environment outside any space) and `modules` (`all` or a list of module ids). Left alone, it sends the attached, relevant and linked objects and the history, and not the chat, the members, or an environment's objects beyond those a person attached. The pages are on **Manage**, **AI service** and in a space's **Set up**, **Modules**; see [userguide-modules](../userguides/userguide-modules.md) and [userguide-spaces](../userguides/userguide-spaces.md).

**Redaction.** One list in `server/ai-policy.js` says which fields of an object's summary are sent (`SENT_FIELDS`: kind, title, subtitle, when, end, all-day, done, category, amount, planned, place name and text) and which never are (`REDACTED_FIELDS`: pointers, people's keys, the spaces it is marked into, copies, icon, colour and how the page draws it). `tools/check-prompts.mjs` checks the lists field by field. Any text sent also loses a link's secret query values (a guest link, the OBS access key, an invitation or sign-in token), a sign-in link's token, a calendar feed's token, a bearer header, the shapes of the providers' keys and the exact secrets this server holds (the access key, every space's guest token, every person's sign-in link token and the AI key).

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

A person may ask six times a minute. All AI is one count (Chat's `/ai` and every module's ask together), kept by `server/module-limits.js`. A bad ask (no question, nothing to work on, a question that is not text or is too long) is refused before it is counted. A failed ask is **given back** only when the service did no work: nothing was sent, the address was refused, the connection failed before an answer began, or the service said it was busy or down (429 or a 5xx) or refused the key. A timeout, an over-long answer and any other refusal count, because the service may have worked and billed. Tokens a failed ask reports are recorded all the same.

An environment's `monthlyTokens` (0 for none) answers 429 when used up. Before a call is sent, the allowance is checked against what the call is estimated to use (its prompt, at about four characters to a token, plus the template's answer limit) and against what asks already on their way have reserved, so several asks at once cannot pass the cap together. On a host, the plan's `aiCallsPerMonth` answers 429 with "This environment has used its N AI calls for this month." Both are checked before anything is sent and given back.

## The provider adapters

An adapter in `server/ai-providers.js` turns the rendered messages into its service's request and the reply into one shape: the text, the structured answer, a finish reason (`stop`, `length`, `filter` or `error`), the tokens in and out, the model and the mode. OpenAI gets a strict JSON-schema response format. Anthropic gets one forced tool whose input is the schema. A compatible service is tried with the schema first and, when it refuses it, with the prompt-then-parse form (the object block in fences, read back); that refusal is remembered for the saved provider, address and model until the setting changes. Errors become plain sentences; the service's own words go to the server log, never to a page.

`tools/fake-model.mjs` is a small stand-in service on this machine that the checks use, so no check calls a real AI service.

## Records and use

`ai.run` appends one line for each call to `DATA_DIR/ai-log.jsonl`, kept 30 days: when, the environment, space and person, the purpose (`chat` or `module`), the template and version, the provider and model, the mode, tokens in and out, the finish reason, how long it took, the outcome (`answered`, `refused` or `error`), the refusal's `reason` or the error's kind, `cut`, and the counts of what was sent and left out. A fixed list of fields (`LOG_FIELDS` in `server/ai.js`) is the only thing ever written; there is no question, material, answer, key or header. A refused ask is recorded too, with its reason.

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

`npm run check` includes `tools/check-ai.mjs` (the service, its setting and the stand-in service), `tools/check-prompts.mjs` (the golden prompts, parsed answers, hostile input, the context builder, the policy's refusals and availability, What AI may see, the reserved allowance, the records and usage with no content, the key bound to its address, structured output for each provider, `AI_LOG_PROMPTS` and `AI_PROMPT_VERSIONS`), `tools/check-ai-prompts.mjs` (the prompt, the placeholder example, cut-off answers, the key and its address, the guard, who may ask, refunds and switching off and on) and `tools/check-ai-page.mjs` (the pages: the Assistant, the **AI used:** line, citations, What AI may see and the use view). All run against the stand-in service on this machine; none calls a real AI service, so how a real provider answers (its model, its structured output, its limits) has not been seen by these checks.
