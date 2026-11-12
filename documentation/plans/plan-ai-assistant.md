# AI Assistant Plan: one module, with the AI service's setup inside it

**Audience:** Thomas decides. If he approves, server-development builds the secret handling, the routes and the checks (the secret part gets an independent read), and experience-design builds the module's Manage tab and moves the pages that link to the old AI tab. content-manager documents after.

**Status:** Draft, nothing decided (2026-11-12, by product-planner). Nothing is built. GitHub #731, "combine Assistant and AI service". From Thomas, as a clickable answer: **One module, setup inside it.** Rename Assistant to **AI Assistant** and move the AI service's setup (provider, key, model, usage, what AI may see) into that module's own Manage tab. Chat `/ai` and Research keep working through it. AI stays optional and off by default: no outside service by default. Background: [plan-ai-integration](plan-ai-integration.md), [plan-assistant-module](plan-assistant-module.md), [plan-one-input](plan-one-input.md) (step 8), [plan-ai-pictures](plan-ai-pictures.md).

## Why

Today there are two things to switch on: the AI service (a card on its own tab, `#modules/ai`, not a module) and the Assistant module, which is already "retired" for new installs ("ask in Chat with /ai") yet still ships. Thomas wants one thing a person turns on and sets up. A module is also the unit a template, a Roles row and the Modules page already understand.

**Goal.** One module, **AI Assistant** (id `assistant`, kept: no rename for its own sake), that owns the setup of AI, its switch, and its use. **Non-goals.** A new provider; the pictures feature (its plan stays approved and unbuilt); a move of the managed per-company service off the host.

## What exists

Checked in the code on 2026-11-12 (`80ecd84e`). The spike held unless corrected.

- **The AI service is not a module.** `RESERVED_IDS = ['ai']` (`server/modules.js` 136, used at 852); `'ai'` appears in `missing` and `aiDependents` (1392 to 1411) and in the hooks cleaner (1146). `admin.js` has a special tab `#modules/ai`, a card with an enable switch (line 1669) and the links "Set it up on its tab" (1663, 1339, 1392).
- **Assistant** (`modules/assistant`, 0.1.26) is scope `space`, has `use` as both read and write, a canvas with `menu: false`, hooks `ai: "optional"`, and the action `askAssistant`. Its description says it has no window of its own. `server/templates.js` 373 gives it `retired: ask in Chat with /ai`. Research also uses `ai: "optional"`. **No manifest declares `hooks.ai: true`**, so `aiDependents()` is always empty and the `PUT /api/ai` cascade that switches dependents off never runs in practice.
- **The service.** `server/ai.js` (682 lines), `ai-providers.js` (388), `ai-http.js` (143), `ai-tools.js` (290), `ai-policy.js` (287), `ai-context.js` (276), `prompts/`. One `Ai` object **per environment** (`server/environment.js` 197). Config: `source` (`managed` or `custom`), `managedProvider`, `provider` (`none`, `openai`, `anthropic`, `compatible`), `address`, `model`, `key`, `workspace`, `monthlyTokens`, `enabled`, `sees`. Files in `DATA_DIR`: `ai.json` (the setting and the key, sealed with AES-256-GCM through `auth.encryptSecret`, never sent to a page, emptied by `environment-export.js`), `ai-usage.json`, `ai-log.jsonl` (30 days, no content).
- **Not set up is the default.** The provider is `none`; `ready()` is `enabled && hasActiveService() && !keyUnreadable`; asking when not ready throws `AiError('AI is not set up here.', 503)`. A module with `hooks.ai: true` would show "missing: ai"; an `optional` one hides its buttons.
- **Managed AI.** `server/host-registry.js` holds the host's managed service per company; the routes are `/api/host/ai` (get, put) and `/api/host/ai/models`. Hosted installs use it; nothing like it exists for a module.
- **Routes:** `GET/PUT /api/ai` (owner), `GET /api/ai/usage`, `GET /api/ai/catalog`, `POST /api/ai/models`, `GET/POST /api/spaces/:id/ai` (Chat `/ai`), `GET/POST /api/modules/:id/ai` (the `ai` hook). `PUT /api/ai` refuses switching AI off while dependents exist unless `force: true`.
- **SDK and pages:** `host.ai.available()`, `host.ai.ask({ task, question, objects })`, `host.chat.ask`; users are `research.js`, `module-host.js`, `chat-input.js`, `ai-form.js`, `ai-sees.js`, `ai-use.js`, `admin.js`, `space-setup.js`. Per-space `aiOff` (`store.js` 855) and `aiSees`; the role action `useAi` (`store.js` 203).
- **Module settings have no secret type.** `SETTING_TYPES` in `server/modules.js` (614) is `boolean, choice, number, text, url, file, files, list, color, note`. A key cannot be stored as a module setting without a new type.
- **Environment variables:** `AI_LOG_PROMPTS`, `AI_ALLOW_HTTP`, `AI_ALLOW_PRIVATE_ADDRESSES`.
- **Checks:** `check-ai` 485, `check-ai-page` 664, `check-ai-prompts` 420, `check-ai-tools` 981, `check-ai-admin-only` 141, `check-assistant` 126: 2,817 lines, plus the golden prompts.

## Decisions

Only what Thomas decided (2026-11-12):

1. **One module, setup inside it.** Assistant is renamed **AI Assistant**, and the setup of the AI service (provider, key, model, usage, what AI may see) moves into that module's own Manage tab.
2. **Chat `/ai` and Research keep working through it.**
3. **AI stays optional and off by default.** No outside service is used until an owner sets one up.

Everything else below is for Thomas.

## The contract (on the leaning options)

**Server half (server-development)**

- **The module owns the setup.** `modules/assistant` is renamed in words only (`name: "AI Assistant"`, id `assistant`). The reserved id `'ai'` goes: remove `RESERVED_IDS`, the `'ai'` branches in `missing` and `aiDependents` (the cascade has never run), and the hooks cleaner's special case. A module with `hooks.ai: true` instead gets `requires: ["assistant"]`, which the module system already understands. Research stays `ai: "optional"`.
- **The routes keep their paths** (`/api/ai`, `/api/ai/usage`, `/api/ai/catalog`, `/api/ai/models`, `/api/spaces/:id/ai`, `/api/modules/:id/ai`); they are owner-checked as now. What changes is who may reach the setup: the module's Manage tab calls them. This is the leaning in question 2: the secret never becomes a module setting.
- **`ready()`** gains one condition: the module is installed and on in the environment. Not ready answers the same 503 and the same words.
- **Chat `/ai`** keeps using `ai.ready()`. If the module is not installed or is off, `/ai` says AI is not set up here (question 3). The hosted managed service is turned on from the host console as now, and the module's Manage tab shows "managed by your host" with no key field.
- **Files:** `ai.json`, `ai-usage.json` and `ai-log.jsonl` stay where they are, as the environment's own. No migration. A reset (for test data) costs: the key (re-entered), the month's usage and the 30 days of call records, nothing else.
- **Per-space `aiOff` and `aiSees`** stay on the space (they are the space's own words and set in Space setup). The environment's "What AI may see" moves from its card to the module's Manage tab; the narrowing rule stays in `ai-policy.js`.
- **Scope.** The module is scope `space` today and the service is environment-wide. The leaning is both scopes: `environment` for the setup and the switch, `space` for the module's canvas, if it keeps one (question 4).
- **Names.** Words: "AI Assistant", "AI" inside it; no new use of the old words. The role action `useAi` stays.

**Pages half (experience-design)**

- `public/admin.js`: remove the special tab `#modules/ai` and the AI card; the module's Manage tab shows `ai-form.js`, `ai-sees.js` and `ai-use.js` (reused). Links that said "the AI service" read "AI Assistant" and lead to its Manage tab. The Modules page's switch for AI Assistant replaces the card's switch; turning it off while another module requires it follows the ordinary `requires` message.
- `space-setup.js`, `chat-input.js` and the hook's missing-text change words only.
- Templates: `server/templates.js` drops the `retired` line for `assistant`; each template decides whether AI Assistant is on (off in all, per decision 3), so the template versions rise.

## Left to build, in order

1. **Server: the service stops being special** (server-development, M, sonnet). Remove the reserved id and the special cases, `requires` instead of the cascade, `ready()` knows the module. `check-ai`, `check-assistant`, `check-modules`, `check-templates`. Ships with step 2 in one release; between them the AI tab would point nowhere.
2. **Pages: setup in the module's Manage tab** (experience-design, M, sonnet). The tab, the links, the words, `check-ai-page`, `check-ai-admin-only`.
3. **Independent read of the secret path** (quality-assurance, S). Security: the key stays sealed, is never sent to a page, never logged, emptied by the export, and owner-only; the routes are the same, so the read is on the moved caller and the new `ready()` rule. Model tier: the larger model for the read, since it is security.
4. **Fold in the retired state** (server-development, S). `templates.js` and the module's description (it now has a Manage tab, not "no window"). Bump the module.
5. **Documentation** (content-manager, M). The AI guide, the Modules guide, `architecture-ai` and `api` pages, plan-assistant-module and plan-one-input status. Production builds only.

## Verify

- **Checked by tool:** the six ai checks above, `check-modules`, `check-templates`, `check-names`, `check-module-versions`, and a grep that nothing still reads `RESERVED_IDS`.
- **Live in headless Chromium against a stub provider:** the Manage tab saves a key (never echoed back), shows usage, narrows "What AI may see"; `/ai` answers "not set up" with the module off and answers with a stub provider on; Research's buttons hide when off.
- **Cannot be verified here:** a real OpenAI, Anthropic or compatible provider (key, model list, answers, token counts), the hosted managed service, and the 30-day log pruning over time. No LiveKit call is involved.

## Risks

- **Secrets in a module's page.** The key must never become a module setting or reach the module's frame. Mitigated by keeping the routes and the sealed file as they are.
- **Hosted installs.** The managed service is a host feature; if the module is off on a hosted environment the managed key is unused. The host console needs a way to turn the module on for the environment (question 5).
- **Two scopes in one module** has no precedent among the bundled modules; the build confirms the manifest allows it or falls back to one scope.
- **Check churn.** About 2,800 lines of ai checks name routes and the old tab; most should pass unchanged because the routes stay, but `check-ai-page` and `check-assistant` change.
- **plan-ai-pictures** lands on `/api/spaces/:id/ai`, which does not move; it needs no change except its words.

## Questions for Thomas

1. **If AI Assistant is off, does Chat `/ai` still work?**
   - No: off means off; `/ai` says AI is not set up here (recommended; one switch means one switch)
   - Yes: `/ai` and Research use the service through a host API even with the module off (the module then only adds its window)
2. **How is the key kept now that the setup is in a module?**
   - The module's Manage tab calls the existing owner-only routes; the sealed file is unchanged (recommended; smallest and safest)
   - A new module setting type `secret`, sealed and never sent back (a core change for any module to use)
3. **What does a module that needs AI do?**
   - Declare `requires: ["assistant"]` for a hard need, or `ai: "optional"` as now (recommended; the system already knows both)
   - Keep a separate `hooks.ai` check next to `requires`
4. **Which scope does AI Assistant have?**
   - Environment for the setup and the switch, space for the canvas if it keeps one (recommended)
   - Environment only; the canvas goes, Chat is the only window
   - Space only, with the setup in the owner's Manage tab (keeps today's scope but splits the environment's switch)
5. **Hosted installs and the managed service.**
   - Keep `/api/host/ai` as it is; the module's tab shows "managed by your host" and the host turns the module on per environment (recommended)
   - Move the managed service into a host-level module setting (large; later)
6. **Does the Assistant window itself stay?**
   - Keep it, off in every template, now with a Manage tab (recommended; no loss for people who use it)
   - Remove the window and keep the module as setup and Chat only (matches "no window of its own" in its description)
7. **What happens to the old tab and data?**
   - Remove the tab; no redirect (the no-compatibility rule); reset the usage and log on test installs (recommended)
   - Keep a redirect from `#modules/ai` (a compatibility layer the rule forbids)
