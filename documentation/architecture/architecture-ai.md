# AI

**Audience:** developers and operators who need to know how Collaborator asks an AI service, who may ask, what the server refuses and where the code lives.

This describes what is built. Larger plans (a tool-calling loop, tokens for outside AI apps, a prompt registry) are in [plan-ai-integration](../plans/plan-ai-integration.md) and are not described here.

## The shape

There is one AI service for an environment, set by its owner on **Manage**, **Modules**, **AI service** (see [userguide-modules](../userguides/userguide-modules.md)), or one the host offers as a managed service. The server holds the key and the address; a page never sees either. Two files carry the work:

- `server/ai.js` holds the setting (`DATA_DIR/ai.json`, the key encrypted with the host's secrets key), the month's use (`DATA_DIR/ai-usage.json`), the prompt, the answer parser and one adapter for each family of service: an OpenAI-style chat endpoint (OpenAI and any compatible address) and the Anthropic API.
- `server/ai-http.js` is the one way the server talks to a service: a plain request with a time limit (90 seconds), a size limit (1 MB), no redirects and, where the address was typed by an owner on a host, the address guard below.

The routes are in `server/index.js`: `GET`, `PUT /api/ai` and `POST /api/ai/models` (owners), `POST /api/modules/:id/ai` for a module's ask, and `GET`, `POST /api/spaces/:id/ai` for Chat's `/ai`. The contracts are in [api-modules](../api/api-modules.md), "Chat routes" and the runtime routes.

## What is sent

The model is given two kinds of text, kept apart. The **system turn** holds every instruction: who the model is, the task, the rule for the objects block and its example. The **user turns** hold only data: the material, each object between numbered `<item>` markers, and last the question between `<question>` markers. Data is escaped so nothing in it can close a marker, open another or start a code fence: `<`, `>` and `&` become `&lt;`, `&gt;` and `&amp;`, and a run of backticks becomes quotes. The system turn says this, so a marker the model sees is always ours. The model gets no tools and its answer is only text; nothing it says is run.

The example in the objects rule is made only of placeholders in angle brackets. A model that copies it writes an object whose title is still a placeholder, and the reader drops that object, so the prompt's own example never comes back as an answer.

An answer that ran out of room is flagged (`cut`), keeps the complete objects it had written and ends with a sentence saying so. Raw object JSON never stays in an answer's text. The objects format itself is in [architecture-modules](architecture-modules.md), "The objects format".

## Who may ask

One rule, `aiRefusalFor`, serves every door (Chat's `/ai` and a module's ask). It runs in this order, and each refusal has a `reason`:

1. Not signed in as a person, or a guest: `guest`. A guest never may.
2. The space has AI turned off (**Turn AI off in this space**): `space-off`.
3. The role does not have **Use AI in modules** (`useAi`, in the space where there is one): `role`. It starts on for moderators and members and off for guests; owners always may.
4. The service is not ready (not set up, or its saved key can't be read on this server): `not-set-up`.
5. The month's token allowance is used up, or, on a host, the plan's monthly AI calls: `allowance`.

`GET /api/spaces/:id/ai` and `GET /api/modules/:id/ai` answer `{ available, why, reason }` from the same rule, so a page says why before a question is typed. A module's ask is also held to the rule for the objects it names: a request from the environment's or a person's own page refuses an object from a space with AI turned off or where the role may not use AI, and a request in a space takes only that space's objects. Chat's `/ai` takes only the current space's objects, because the question and answer are kept in that space's chat.

Pasting research from another AI is not AI use. `objects/check` needs only a signed-in person who is not a guest, and the module's `write` permission.

## Counting, refunds and the monthly caps

A person may ask six times a minute, counted by `server/module-limits.js` (one count for Chat, one for each module). A bad ask (no question, nothing to work on, a question that is not text) is refused before it is counted. A failed ask is **given back** only when the service did no work: nothing was sent, the address was refused, the connection failed before an answer began, or the service said it was busy or down (429 or a 5xx) or refused the key. A timeout, an over-long answer and any other refusal count, because the service may have worked and billed. Tokens a failed ask reports are recorded all the same.

An environment's `monthlyTokens` (0 for none) answers 429 when used up. On a host, the plan's `aiCallsPerMonth` answers 429 with "This environment has used its N AI calls for this month." Both are checked before anything is sent and given back.

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

`npm run check` includes `tools/check-ai.mjs` (the service, its setting and the stand-in service), `tools/check-ai-prompts.mjs` (the prompt, the placeholder example, cut-off answers, the key and its address, the guard, who may ask, the availability answers, refunds and switching off and on, against a stand-in service on this machine) and `tools/check-ai-page.mjs` (the Assistant's page). None calls a real AI service.
