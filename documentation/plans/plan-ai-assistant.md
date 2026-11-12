# AI Assistant Plan: one module for the Assistant and the AI service

**Audience:** Thomas decides the open questions at the end. If he approves, server-development builds the module's server
side (the secret, the routes, the checks, the host path) and experience-design builds the Manage tab and the Assistant
surface. A security QA read is needed on the jobs marked below. content-manager documents after.

**Status:** Draft for Thomas, 2026-11-12, by product-planner. Nothing is built or decided except Thomas's words below.
Thomas answered the planning question on 2026-11-12: one module, with the setup inside it; Chat `/ai` and Research keep
working; AI stays optional and off by default.

## The brief

Thomas, 2026-11-12:

> "We need to combine "Assistant" and "AI Service" into a single module called "AI Assistant". They are completely dependent on each other."

His answer: rename Assistant to AI Assistant; move provider, key, model, usage and "what AI may see" into its own Manage
tab; Chat `/ai` and Research keep working through it; AI optional and off by default.

## Why

The service (Manage > Modules > AI service) is a special tab with a reserved id `ai`, apart from the module list. The
Assistant is a module that is "retired" on new installs and has no window; Chat's `/ai` does its work. Two things for
one purpose, with special cases in `modules.js` and `admin.js`. Making it one module removes the special cases and puts
the setup where a person looks for a module.

## Names

Module: AI Assistant (id `assistant`; see question 1 on the id). "AI service" as a word retires. The Assistant surface is
what Chat's `/ai` shows (below). A module's setting is a "setting"; an object is an object. No "room", "table", "stage",
"pane" or "item". The role action is `useAi`.

## What it is today

Read as code on 2026-11-12 (the spike). I re-checked in `server/modules.js`: `SETTING_TYPES` (line 614) has
boolean, choice, number, text, url, file, files, list, color and note; **there is no secret type**. `RESERVED_IDS = ['ai']`
at line 136; `server/templates.js` 372 to 373 skips `assistant` on new installs with 'retired: ask in Chat with /ai'
(plan-one-input step 8); `encryptSecret` is in `server/auth.js` 285 and used by `server/ai.js` 19; the host's routes
`/api/host/ai` exist at `server/index.js` 2816 to 2829. The rest below is the spike, read as code only.

- **The service is not a module.** Class `Ai` (`server/ai.js`, 682 lines) per environment, constructed at `environment.js`
  197 with `(dataDir, process.env, undefined, managed, secretsKey)`. Config `{ source: managed|custom, managedProvider,
  provider: none|openai|anthropic|compatible (default none), address, model, key, workspace, monthlyTokens, enabled, sees }`.
  `modules.aiReady = () => ai.ready()` where `ready()` is enabled and has an active service and the key is readable.
- **Files:** `DATA_DIR/ai.json` (setting and key), `ai-usage.json`, `ai-log.jsonl` (30 days, no content). Support code:
  `ai-providers.js` 388, `ai-http.js` 143, `ai-tools.js` 290, `ai-policy.js` 287, `ai-context.js` 276,
  `action-catalog.js`, `prompts/` (index 139, ask 92, object-rule 181, parse 238, inputs 96, others).
- **The key:** sealed at rest with AES-256-GCM (`aesgcm$...`, `auth.encryptSecret`, the server's secrets key). A plain key
  is sealed on load. One restored onto another host is unreadable and must be entered again. It is never sent to a page.
  `environment-export.js` empties the key in `ai.json`. Environment variables: `AI_LOG_PROMPTS=1` (ignored when hosted),
  `AI_ALLOW_HTTP=1`, `AI_ALLOW_PRIVATE_ADDRESSES=1`. No key variables.
- **The managed service:** `host-registry.js` holds a managed AI per company (`data.ai[provider]`, sealed), shown on the host
  console; routes `/api/host/ai` (get, put, models).
- **Routes:** `GET /api/ai` (owner: view, usage, dependents), `GET /api/ai/usage`, `GET /api/ai/catalog` (signed in,
  `?space=`, checked by `ai-policy` for `chat`), `POST /api/ai/models`, `PUT /api/ai` (refuses turning AI off while
  dependents exist unless `force: true`, then cascades them off and remembers them: `rememberCascade`, `takeCascade`),
  `GET/POST /api/spaces/:id/ai` (Chat's `/ai`, lines 6769 and 6783), `GET/POST /api/modules/:id/ai` (the `ai` hook;
  9009 and 9071).
- **SDK:** `host.ai.available()`, `host.ai.ask({ task, question, objects })` (`public/sdk/host.js` 2658), `host.chat.ask`
  (about 2680). Callers: Research, `module-host.js`, `chat-input.js`, `ai-form.js`, `ai-sees.js`, `ai-use.js`, `admin.js`,
  `admin.html`, `space-setup.js`.
- **The Assistant module** (`modules/assistant` 0.1.26): scope space; a canvas only (`menu: false`); permission `use`; hook
  `ai: "optional"`; local action `askAssistant`; files `assistant.js` 36 lines, `assistant-lib.js` 80, html and css. No
  manifest declares `hooks.ai: true`, so `aiDependents()` is empty. Research has `ai: "optional"`.
- **Manage UI:** `admin.js` from 1631: the entry and tab `#modules/ai`, an enable switch (`data-ai-toggle`), the form
  `/ai-form.js` on `/api/ai`, "What AI may see" (`ai-sees.js`), the month's use (`ai-use.js`); in the Modules filters, never
  under Updates; `admin.html` 306 to 411. Space setup has a per-space `aiOff` and `sees` (`store.js` 854 to 1964). The role
  action `useAi` (`store.js` 203).
- **Not configured:** `ai.ready()` is false; asking throws `AiError('AI is not set up here.', 503)` with reason
  `not-set-up`; a module with `hooks.ai: true` shows "missing: ai" (`modules.js` 1398) and cannot be turned on; optional
  ones hide their buttons (`host.ai.available()` is false).
- **Checks:** `check-ai.mjs` 485, `check-ai-page.mjs` 664, `check-ai-prompts.mjs` 420, `check-ai-tools.mjs` 981,
  `check-ai-admin-only.mjs` 141, `check-assistant.mjs` 126: about 2,800 lines in 6 files, plus `tools/golden/prompts/`
  (for example `ask@3`) and `check-prompts`.
- **plan-ai-pictures** ([plan-ai-pictures](plan-ai-pictures.md), approved 2026-11-09, nothing built) adds Whiteboard "Save as
  image" and attachments; the Whiteboard has no AI call today.

## The design in one paragraph

One bundled module, AI Assistant, owns the setup and the Assistant surface. Its Manage tab replaces `#modules/ai`: the
enable switch, provider, key, model, usage, "What AI may see". Its server code is the existing `Ai` class and routes, moved
under the module rather than rewritten. The special `ai` id and the cascade become the ordinary `requires` dependency.
Chat `/ai` and Research keep working through `host.ai`; the questions below say what they do when the module is not
installed.

## The secret key: options

The key must stay sealed at rest, never be sent to a page, and be emptied by `environment-export`.

**Option 1. A new module setting type `secret` (suggested).** `SETTING_TYPES` gains `secret`. The host seals the value on
save (`auth.encryptSecret` with the secrets key), stores `aesgcm$...`, and the settings API returns only
`{ set: true }` or `{ set: false, unreadable }`, never the value. `environment-export` empties every `secret` setting by
type, which also protects future modules. The form shows a password field and "Replace key". Cost: M; one new rule, used
by the next module that needs a key too. Rules out: nothing. Needs a security read.

**Option 2. A host path outside module settings.** The module's tab calls `/api/ai` (kept as the host's route) and the key
stays in `ai.json` as now. The module is a front for a host feature. Cost: S. Rules out: a clean "the module owns it";
`ai.json` and its special cases stay, and the reserved id's reasons stay half alive. Reasonable if Thomas wants the
smallest change.

**Option 3. Environment variables for the key.** Rejected by the existing design (no key variables; owners type keys in
Manage) and it would break hosted installs. Listed so the choice is visible.

## The managed service for hosted installs

The host holds a sealed managed key per company (`host-registry.js`, `/api/host/ai`). That is a host thing, not a module
thing, and it stays a host path under either key option. The module reads "source: managed" from its settings and asks the
host for the active managed provider through the same `new Ai(..., managed, ...)` hand-in as now. The host console keeps
its AI tab. The module's Manage tab shows "Provided by your host" and hides the key field when the source is managed.

## Optional, off by default, no outside service

The default provider stays `none`; `enabled` starts false; `ai.ready()` keeps its meaning (enabled, an active service, the
key readable); asking when not ready is still `AiError('AI is not set up here.', 503)`. Nothing contacts an outside
service until an owner turns the module on, picks a provider and saves a key (or the host provides one). `hooks.ai: true`
modules still show as "missing" while not ready. The module is on or off like any module; off means `host.ai.available()`
answers false.

## Chat `/ai` and Research when the module is not installed

**Option A. Chat `/ai` and Research require the module (suggested).** If AI Assistant is not installed or off,
`/ai` is hidden (as when AI is not set up) and `host.ai.available()` answers false. One owner of the service. Cost: S.
This follows Thomas's "completely dependent".

**Option B. A core minimal path.** Chat's `/ai` keeps working through the host with no module. Two homes for the service
again, which is what Thomas wants gone. Not suggested.

**Option C. Install the module by default and say so.** Like A, with the module on every new install (on, not
configured). Reverses the template skip below.

## Scope

The Assistant is scope `space`; the service is environment-wide. The module needs scope `environment` and `space`:
environment for the setup, the usage and the secret; space for the surface and the per-space `aiOff` and `sees` it
already uses. Manifests already allow several scopes (Calendar and To-do have both). The Manage tab is the
environment's module settings; the space surface is what a space sees.

## The "retired" template state and the surface

Plan-one-input step 8 retired the Assistant window because Chat's `/ai` does the job. This plan reverses the skip at
`templates.js` 372 to 373: the module is offered on new installs (on or off per template, question 4). The Assistant
surface is not a new window: it is **Chat's Assistant view** (the `/ai` answers, the conversation in Chat), and the
module's canvas, if kept, is a small canvas window that shows the same conversation and the month's use. Question 3
asks which. The module carries the `ai` hook and the `askAssistant` action. This plan does not design a new chat.

## The reserved id and the cascade

- `RESERVED_IDS = ['ai']` (`modules.js` 136) goes with its checks at 852; the pseudo id `ai` in `missing` and
  `aiDependents` (1042, 1392 to 1411) goes. A module that needed AI now says `requires: ["assistant"]` (or the new id)
  and the existing missing/dependents rules apply. "Can use the AI service" in the admin text becomes the module's name.
- `PUT /api/ai` with its refusal and `rememberCascade`/`takeCascade` becomes the module switch's ordinary dependents
  warning. The remembered-and-restored behaviour is kept only if the ordinary dependency code has it; if not, it is a
  small gap (risk 5).
- `admin.js` loses the special tab, the entry, `data-ai-toggle`, the filter entries and the `needsText` links to
  `#modules/ai`; they point at the module's own page. `ai-form.js`, `ai-sees.js`, `ai-use.js` move into the module's tab
  files and `admin.html` 306 to 411 shrinks.

## Files and routes

- **Stored:** `ai.json`, `ai-usage.json`, `ai-log.jsonl` move under `modules/assistant/` in the environment's data (key
  rename and reset allowed by CLAUDE.md; no migration). `AI_FILE` and `environment.js` 197 follow.
- **Routes:** `/api/ai`, `/api/spaces/:id/ai`, `/api/modules/:id/ai` may keep their paths: they are Chat's and the SDK's
  addresses, and renaming them is a separate, optional step (question 5). The owner-only ones (`GET /api/ai`, `usage`,
  `models`, `PUT`) become the module's settings and its own routes; `check-ai-admin-only` keeps the rule "owner only".
- **SDK:** `host.ai.available()` and `host.ai.ask` keep their names. The module answers them.
- **Hosted installs:** `/api/host/ai` and the host console stay.

## Roles and permissions

The module has `use` (today's Assistant permission). The owner (and the admin) manage the setup; no one else sees the key
or the usage. The role action `useAi` stays and means what it does now. A moderator may not change the key. A guest
cannot ask unless the owner has given `useAi` to guests.

## Phones and accessibility

The Manage tab is a form: single column, 44 px targets. The key field is a password input with a visible label and a
"Replace key" button; the status ("key saved", "key unreadable, enter it again") is text, not colour alone. The Chat
Assistant view keeps what Chat has now.

## What changes in code, by job

| Job | Who | Files | Size | Security read |
|---|---|---|---|---|
| J1 `secret` setting type (or the host path) | server-development | `modules.js`, `auth.js` use, settings route, `environment-export.js` | M | **Yes** |
| J2 Move the `Ai` class and files under the module; settings from `ai.json` | server-development | `ai.js`, `environment.js`, store of files, `environment-export.js` | M | **Yes** |
| J3 Retire the reserved id and the cascade | server-development | `modules.js`, `index.js` (`PUT /api/ai`), `templates.js` 372 | M | No |
| J4 The Manage tab | experience-design | `admin.js`, `admin.html`, `ai-form.js`, `ai-sees.js`, `ai-use.js` | M | **Yes** (the field, no echo) |
| J5 The module: manifest, scope, rename, surface | experience-design | `modules/assistant/*` | S to M | No |
| J6 Callers and wording | experience-design | `chat-input.js`, Research, `space-setup.js`, `module-host.js` | S | No |
| J7 Checks | server-development | the 6 files and `golden/prompts` | M | No |
| J8 Docs | content-manager | `architecture-ai`, `userguide-assistant`, others | S | n/a |

## Build order

1. **J1** alone. Check: a unit case that a saved secret is never in any API answer, is `aesgcm$...` on disk, and is
   empty in an export.
2. **J2**. Check: `check-ai`, `check-ai-admin-only`; `new Ai` still gets `managed`; a hosted throwaway server reads the
   managed key.
3. **J5** and **J4** (manifest and tab). Live in headless Chromium: the tab saves a provider and a key, the key is not in
   the page source or the network list, the use bar draws.
4. **J3**, then **J6**. Live: Chat `/ai` with the module on and off, Research's button present and absent.
5. **J7**, then `npm run check`. **J8** on production builds only.

## Verify

- **Checked by a tool:** `check-ai`, `check-ai-page`, `check-ai-prompts`, `check-ai-tools`, `check-ai-admin-only`,
  `check-assistant`, `check-prompts` and the golden prompts, `check-modules`, `check-templates`, `check-names`,
  `check-docs`. The golden prompt files should not change if the prompt code is only moved.
- **Live:** the tab, the off state, and `not-set-up` as a 503.
- **Not verifiable here:** a real call to OpenAI, Anthropic or a compatible service (no outside service and no key here);
  the answer's quality; a hosted install's managed key beyond a stub. Say so in the report.
- No LiveKit call is involved.

## Risks, ranked

1. **The key.** Any change to how it is stored, shown or exported is security-sensitive. J1, J2 and J4 need a security QA
   read (the key never in an answer, a page, a log, an export or an error text).
2. **Chat `/ai` breaks** for people who never installed the module (question 2 decides what they see).
3. **The managed hand-in** on hosted installs may be missed when the class moves; test with a hosted throwaway server.
4. **2,800 lines of checks** and the golden prompts: a move that changes a byte fails them.
5. **The cascade** loses the remember-and-restore behaviour if the ordinary dependency code lacks it.
6. **Id question:** keeping `assistant` while the word says "AI Assistant" is fine; renaming the id touches layouts and roles.

## Not in v1

New providers, image generation and attachments ([plan-ai-pictures](plan-ai-pictures.md) stays as approved and
unbuilt), a new chat, per-space keys, spend limits beyond the monthly tokens, renaming the prompt code, anything in
[plan-workspaces](plan-workspaces.md).

## Doc facts

Words a person reads: "AI Assistant", "Provided by your host", "Replace key", "AI is not set up here." Names in code: module
`assistant` (or the new id), setting `secret` type, hook `ai`, action `useAi`, `host.ai`. Environment variables kept:
`AI_LOG_PROMPTS`, `AI_ALLOW_HTTP`, `AI_ALLOW_PRIVATE_ADDRESSES`.

## Open questions for Thomas

Nothing here is decided.

1. **The module id.** (a) Keep `assistant`, show the name "AI Assistant" (suggested; no rename of ids). (b) Rename the id
   to `ai-assistant`. (c) Rename to `ai`, which needs the reserved id lifted.
2. **Chat `/ai` and Research without the module.** (a) They need the module (suggested; follows "completely
   dependent"). (b) Chat `/ai` keeps a minimal core path. (c) The module is on by default in every new environment.
3. **The Assistant surface.** (a) Chat's Assistant view only; the module has no canvas (suggested; matches the retired
   window). (b) Chat's view plus a small canvas window. (c) A full canvas conversation again.
4. **New installs.** (a) Offered, off (suggested; AI stays off by default). (b) On but not configured. (c) Not offered
   until an owner adds it.
5. **The key.** (a) A `secret` setting type (suggested). (b) A host path; `/api/ai` stays. (c) Another way you prefer.
6. **The routes.** (a) Keep `/api/ai` and the other two paths (suggested; no renaming unasked). (b) Rename them under the
   module.
