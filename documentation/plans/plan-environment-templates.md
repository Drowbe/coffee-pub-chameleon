# Environment Templates Plan

**Audience:** Thomas, who decides what a template sets and how an environment follows it, and the sessions that build it: server-development (`server/`, the host registry, the checks) and experience-design (the pages, the console, the SDK's words).

**Console wording (2026-11-09):** since the console redesign ([plan-host-console](plan-host-console.md), #509) the console's **Templates** tab is the **Templates** section (a list with **Used by** links and a **More** menu per row, the editor as its own page), and the environment card's Template choice, **Switch template** and the offer with **Review** are on the environment's own **Template** tab. The rules in this plan are unchanged; where it says the Templates tab or the environment's card, read those.

**Status:** Addendum 4, "the word for entering a space", approved by Thomas, 2026-09-30; built (2026-09-30). Addendum 2 (#68), "Templates grow", approved 2026-09-25: built (2026-09-25). The switching addendum (GitHub #59) is built (2026-09-25). Approved by Thomas on September 25, 2026 (reworked 2026-09-24); **done** (2026-09-25): steps 1 to 3 built. Deferred: the chat and the conference as modules a template can switch off stay in [plan-optional-conference](plan-optional-conference.md); more templates come later, each only a new file. Built right after [plan-names](plan-names.md) step 5c, before its steps 6 to 10. Asked for by Thomas: "Environment profiles: an environment can have a profile, e.g. "travel", that sets it up for that use: what things are called, icons, which modules are on, and possibly more." Named a **template**, since "profile" already means a space's profile and a person's profile page. On the words, Thomas (2026-09-24): "based on the template, the level name and code name NEVER change, but what's exposed to the user could change." Everything the first draft said about rooms and tables is done by plan-names and is not repeated here.

## What it is today

This is the code after plan-names steps 1 to 5a; steps 5b (the pages) and 5c (the SDK and the bundled modules) come before this plan is built.

- **Words.** Every word a person reads is typed into the pages and the server one at a time. The level and role words ("space", "spaces", "owner", "member") appear throughout `public/*.html`, `public/*.js` and the server's messages; the primary nav's Spaces link is `label: 'Spaces'` (`public/brand.js:181`). Pages fill branded text by `data-brand` attributes in `loadBranding()` (`public/brand.js:73-110`), from `GET /api/branding` (`branding()`, `server/index.js:833-835`). `tools/check-names.mjs --words` already scans what a person reads, for the old names only.
- **The environment's name** is `settings.environmentName` (`server/store.js:189`), set on first build by `environmentFor()` (`server/index.js:379`).
- **Icons.** `settings.homeIcon` (default `couch`, `store.js:47`, `190`), validated against the environment's own icon list (`iconIds()`, `store.js:708`, seeded from `STARTER_ICONS`, `store.js:40`), used for the home icon and the Spaces link. Each module's `icon` is its manifest's.
- **Module names.** A module's name is its manifest's `name` only. The Travel module's id is `travel` and its name "Planner" (version 0.7.30 today). The server sends `manifest.name` in about twelve places, among them the module's own context (`server/index.js:4014`), the nav, the widgets and the Modules tab.
- **The SDK.** `host.locale()` answers `{ language, clock, currency, currencies }` (`public/sdk/host.js:293`, `443`), the generic channel for how the environment shows things. No template id or environment identity reaches a module.
- **The Lobby** is seeded once as "Lobby", "Where everyone meets." (`store.js:493`). A new space starts with the `roleplaying` profile unless `addSpace()` is told otherwise (`store.js:1126`, `574`).
- **Which modules are on.** A bundled module is installed, enabled for the environment, then turned on per space (`allSpaces` or `spaces` on its registry entry, `server/modules.js:664`, `835`). `install.auto` installs and enables a bundled module once per environment, recorded (`autoInstallBundled()`, `server/index.js:424`). Conference and Chat are built in (`BUILTIN_MODULES`, `server/index.js:2634`): Conference has an environment-wide switch (`conferenceEnabled`); Chat has none. A billing plan's `modules` list is the hard limit on what an environment may enable.
- **Where an environment starts.** `hostRegistry.addEnvironment({ slug, name, plan })` (`server/host-registry.js:300`), from the console's `POST /api/host/environments` (`server/index.js:1058`) and the product page's `POST /api/product/signup` (`server/index.js:1612`). The first build of an environment runs `environmentFor()`. "Apply once and record it" is already how `install.auto`, the built-in themes, the starter icons and the names migration's parts work.

## Decisions

1. **The name is "template".** "Profile" already means a space's profile and a person's page; "plan" already means a billing plan.
2. **Mixed.** Words and icons follow the template live. Settings and modules are applied once, when the environment is created.
3. **Defaults, never locks.** The owner can change anything a template set. Only the billing plan limits what an environment may use.
4. **Picked at creation**: the host console's create form and the product page's sign-up form, and `TEMPLATE=` on a single-environment install. Unset, everything is as today. Amended 2026-09-25: an owner or the host admin can also give an existing environment a template, or switch to another (see "Addendum: switching a template"); `TEMPLATE=` stays creation only.
5. **Bundled only**: `templates/<id>.json` in the repository, released with the image.
6. **Separate from billing plans.** A template module the environment's plan does not include is skipped, and the skip is recorded and shown.
7. **A template's modules are on in every space**, and new spaces start with them.
8. **The words are the Names.** The keys are exactly the levels (`host`, `environment`, `space`, `aside`, `canvas`, `module`, `object`) and the roles (`admin`, `owner`, `moderator`, `member`, `guest`). A template maps each to its words. The code names never change; only what a person reads does.
9. **Modules keep their names; a template gives them a display name.** Thomas: "'Planner' is the module name. The host will enable that for the environment. BUT for travel, because of our templates, 'Planner' will be exposed to the user as 'Trip Planner' or 'Itinerary' or whatever is declared in the template. SO, in the settings for the environment, we will call it what the template declares... but it would behoove us to append the proper module name to the version number... so they see both the title 'Itinerary' and the version 'planner v123.34.455'." A template declares module display names and icons; Manage shows the display name, with the module's own name and version beside it.
10. **The travel template**: the modules Planner (`travel`), Places, Maps, Research, Calendar and Chat, with the Conference on (Thomas: "On"); the space word is **Trip**.
11. **Chat and Conference as optional modules is not a blocker.** The travel template turns both on, as they are today. Making them switchable belongs to [plan-optional-conference](plan-optional-conference.md), a later plan of its own.
12. **Words reach pages and modules without the template.** Pages read them through `data-word` and a `word()` helper; modules through `host.locale().words`. No template id reaches a page's logic or a module (the conduit rule).

Recommended, and accepted by Thomas at approval (September 25, 2026):

13. **`TEMPLATE` on a hosted server is ignored**, with a log line on start; there, templates come from the console and sign-up.
14. **The record is the template's own**, not a names migration part: `template: { id, appliedAt, skipped }` in `app.json`. A migration part means "data a newer build wrote", which an older build must refuse; a template is not that.
15. **The word check is a mode of `check-names`**: `--words` gains the level-word rule below, rather than a separate `check-words.mjs`. Template files get their own `tools/check-templates.mjs`, since that is checking data, not names.

Decided at approval (September 25, 2026):

16. **Beside a display name, Manage shows the module's own name and version**: "Itinerary", with "Planner v0.7.30" beside it (the manifest's `name`, not its id).
17. **The travel template's defaults**: Planner shown as "Itinerary"; the Lobby named "Home base", described "Everyone on every trip."; the home icon `suitcase-rolling`; new trips start with the Participants profile.
18. **Owners and templates can change every word except `host` and `admin`**, which are the host's own words. That is ten keys; `host` and `admin` always read their default words.

## The contract

### The vocabulary

| Key | Names | Default words (one / many) |
|---|---|---|
| `host` | the whole server | host / hosts |
| `environment` | what people sign in to | environment / environments |
| `space` | a space | space / spaces |
| `aside` | a temporary space for a quick call | aside / asides |
| `canvas` | where modules are used in a space | canvas / canvases |
| `module` | a tool on the canvas | module / modules |
| `object` | a thing a module holds | object / objects |
| `admin` | the server's admin | admin / admins |
| `owner` | who runs the environment | owner / owners |
| `moderator` | who runs things in one space | moderator / moderators |
| `member` | a person with an account | member / members |
| `guest` | a person in by a guest link | guest / guests |

- **A word's shape** is `{ one, many, a? }`: the singular, the plural, and the article when it is not the usual one ("an aside"). Capitals come from the helper, never from a second copy. English only, the one language there is; a later language adds a set per language under the same keys.
- **Where a word comes from, in order:** the owner's own (`settings.words.<key>`), else the template's, else the default. `host` and `admin` are the host's own words and always read their defaults (decision 18); neither an owner nor a template can change them. Resolved on the server, per request, so a template file's change is live on the next release.
- **No other keys.** The first draft's `call`, `chat`, `lobby` and `private` are not levels and are dropped. The Lobby's name is stored on the space (below). Chat and Conference are built-in modules, named by module display names. "Private" describes an aside and stays a fixed word. Adding a key means adding a level, which is a change to CLAUDE.md's Names first.

### Module display names and icons

- A template may give a module a display name and an icon (`moduleNames`, `moduleIcons`, by module id, bundled or built in: `travel`, `conference`, `chat`). The owner may change or clear either.
- The server sends the display name wherever it sends a module's name today (the Modules tab, the nav, the dashboard's widgets, the canvas's module switches, and `host.info.module.name` on the module's own page), and the icon likewise. A module that prints its own name reads it from there, never from its manifest text.
- **Manage shows both.** A module's card on the Modules tab shows the display name as its title and, where the version is shown, the module's own name and version: "Itinerary", with "Planner v0.7.30" beside it. With no display name, the card reads as today.
- A template naming module ids is data, like a billing plan's module list: nothing in the code knows which template names which module.

### The template file

`templates/<id>.json`, checked by `tools/check-templates.mjs`:

```json
{
  "id": "travel",
  "name": "Travel",
  "description": "Plan trips together: the itinerary, places, maps, research and a calendar.",
  "words": { "space": { "one": "trip", "many": "trips" } },
  "icons": { "home": "suitcase-rolling" },
  "moduleNames": { "travel": "Itinerary" },
  "moduleIcons": {},
  "modules": ["travel", "places", "maps", "research", "calendar", "chat", "conference"],
  "settings": {},
  "lobby": { "name": "Home base", "description": "Everyone on every trip." },
  "spaceDefaults": { "profile": "participants" }
}
```

- `words`: any of the ten changeable keys (every key but `host` and `admin`, decision 18); the rest keep their defaults. Live.
- `icons.home`: the home icon and the Spaces link's. A Font Awesome Free name. Live; applied once as well, by adding it to the environment's icon list so the owner's icon picker shows it.
- `moduleNames`, `moduleIcons`: live.
- `modules`: bundled module ids and the built-in `conference` and `chat`. Applied once. A bundled module listed is installed, enabled and on in every space (`allSpaces: true`), with its `requires` added (Maps needs Places). `conference` listed leaves `conferenceEnabled` on; left out, it is switched off. `chat` must be listed until plan-optional-conference gives Chat a switch; `check-templates` refuses a template that leaves it out.
- `settings`: values for a fixed list the owner can set anyway (language, clock, currency, `loginText`, `allowRegistration`, `mfaRequired`, the call features, the active built-in theme and its mode), each through `store.updateSettings`. Applied once.
- `lobby`: the Lobby's name and description, stored on the space. Applied once; afterwards they are the owner's, like any space's.
- `spaceDefaults`: what a new space starts with; `profile` only (`roleplaying`, `participants` or `characters`). Kept on the environment and read by `addSpace()` for every space made later.

The travel values above are decided (decision 17).

### Server

- **Loading.** `server/templates.js` reads `templates/*.json` at start, validates each with the same rules as `check-templates.mjs`, and refuses to start on an invalid one. `templates.get(id)`, `templates.list()` answering `[{ id, name, description }]`.
- **Recording.** `app.json` keeps `template: { id, appliedAt, skipped: [{ id, why }] }` (decision 14), so an export and a restore carry it. A hosted environment's registry entry keeps `template: id` too, for the console. An environment made before this plan has no `template` and is exactly as today. An environment whose recorded template id this build does not have reads the default words, and the log says so once.
- **Applying once.** In `environmentFor()`, after `buildEnvironment`, an environment with a template id and no `appliedAt` has it applied, in order: settings, the Lobby, the space defaults, the home icon into the icon list, then the modules (installed as `autoInstallBundled()` does, enabled, `allSpaces: true`; `conferenceEnabled` set), then `appliedAt` is written. It runs before `autoInstallBundled()`, and never twice. A module that fails to install is recorded in `skipped` with its reason.
- **Entitlement.** A module the plan's `modules` list does not include is not installed and is recorded as `{ id, why: 'not in the plan' }`. The template never widens a plan.
- **Live words and icons.** `branding()` gains `words` (every key, resolved) and the resolved `homeIcon`. For an environment made from a template, `settings.homeIcon` starts unset, meaning "the template's"; an owner's choice sets it. Module display names and icons are resolved the same way (the owner's, else the template's, else the manifest's).
- **The owner's changes.** `PUT /api/settings` takes `words: { <key>: { one, many, a? } | null }` for the ten changeable keys (`host` or `admin` answers 400) (null returns that key to the template's word or the default) and `homeIcon: null`. `PATCH /api/modules/:id` takes `displayName` and `displayIcon`, null to clear.
- **Creating.** `POST /api/host/environments` and `POST /api/product/signup` take an optional `template` (an id; an unknown one answers 400 "There is no template called <id>."). `GET /api/host/templates` and `GET /api/product`'s new `templates` list them. `GET /api/host/environments` shows each environment's template and its `skipped` list. `GET /api/environment` gains `template: { name, skipped }` for the owner's Environment panel.
- **`TEMPLATE=` on a single-environment install.** Checked at start: an unknown id refuses to start, listing the known ones. On a new data directory (no `app.json` yet), the template is recorded and applied as above. On an existing data directory with no template recorded, it is ignored with a log line, since a template is picked at creation only (decision 4). On one with a different template recorded, the recorded one wins and the log says so once. With `BASE_DOMAIN` set, `TEMPLATE` is ignored with a log line (decision 13).
- **Server messages** that name a level ("no such space", "you are not a member of that space") are built from the resolved words, through one helper.

### Pages

- **One helper.** `public/brand.js` gains `word(key, { many, cap, a })`, filled from `/api/branding`'s `words`, and a `data-word="space"` attribute (with `data-word-form="many"`, `"cap"`, `"a"`) that `loadBranding()` fills as it fills `data-brand`. Every level and role word typed into the pages becomes one or the other; the Spaces link's label becomes `word('space', { many: true, cap: true })`.
- **Nothing reads a template id.** No page branches on the template; pages only read words.
- **Manage.** The Environment tab gains a **Words** group: each of the ten changeable keys with its one and many, blank for the template's or the default word, and a note naming the template the environment was made from ("Made from the Travel template"). The Modules tab gains a display name and an icon on each module's card, and shows the module's own name and version beside the display name. The Environment panel lists what was skipped ("Not in your plan: Maps").
- **The host console.** The create form gains a **Template** choice (None, then each template's name and description). The environment list shows each one's template and what was skipped.
- **The sign-up form** on the product page gains the same choice when the host has any templates.

### SDK

- `host.locale()` gains `words`: the same resolved object the pages get. `host.util.word(key, { many, cap, a })` applies it, so a module never copies the capitals and plural rules.
- `host.info.module.name` and `.icon` are the module's display name and icon in this environment.
- No template id, template name or environment identity reaches a module. A module written against `host.locale().words` works under any template and none. Bundled modules that print a level word move to `host.util.word` and get a version bump.

### `check-names --words` and `check-templates`

- **`tools/check-names.mjs --words`** gains a rule: a level or role word (either form, any capital) typed into a page's text, the SDK's text or a server message, rather than going through `word()`, `data-word` or the server's word helper, fails. The allow-list takes the few places where the word is not the level (for example "a guest link" in the host console's own words, if any). It also checks that every key the pages use exists in the vocabulary with both forms.
- **`tools/check-templates.mjs`** checks each template file: known fields and types, known changeable vocabulary keys (not `host` or `admin`) with `one` and `many`, module ids that are bundled or built in, `chat` present, Font Awesome Free icon names, allowed settings only, a known `profile`; and runs the apply step twice against a throwaway store, with the same result both times, and with a plan that leaves one module out recording it as skipped.
- `npm run check` runs both.

## Left to build, in order

Built after plan-names step 5c: the pages and the SDK already use the Names' code names, so the words go in once. plan-names steps 6 to 10 come after; anything they touch that a person reads already goes through `word()` and must keep doing so (`check-names --words` holds them to it).

1. **The words** (server-development, then experience-design). The vocabulary and its defaults in one server module; `branding()`'s `words`; `settings.words` and `PUT /api/settings`; the server's messages through the helper; `word()` and `data-word` in the pages, and every level and role word converted; `host.locale().words` and `host.util.word`; bundled modules that print a level word moved and bumped; the Words group on Manage; the `--words` rule.
   - Done when: `check-names --words` passes with the new rule, and an environment with no template reads exactly as before.
   - Verify: checked by the tool (every page's text before and after, word for word); live, an owner's word for `space` shown on every page and in a bundled module that prints it; server messages read as code where they only happen in a call.
   - **Built (2026-09-25).** `server/words.js`, `branding()`'s `words`, `settings.words` with `ownWords`, the server's messages through the words, Manage > Environment > **Words**, `public/words.js` with `data-word` and `data-fill`, `host.locale().words`, `host.util.word` and `host.util.fillWords`, the nine bundled modules converted and bumped, and `check-names --words` enforced in `server/`, `public/` and `modules/`. Two differences from the contract above: the words are saved with `PATCH /api/settings`, not `PUT`; and the pages have a `data-fill` attribute beside `data-word`, for placeholders in text and attributes. Not yet: text from a module's `module.json` still uses the default words (step 2). Documented in [architecture-overview](../architecture/architecture-overview.md) ("Words"), [api-module-sdk](../api/api-module-sdk.md) and the Manage guide. Verified live: with no words set, 44 page visits in every role and 28 API refusals read identically to the previous build; with words set, they read naturally everywhere checked; two hosted environments never leak words, the browser cache included. Read as code only: the call page in a real call.
2. **Module display names and icons** (server-development, then experience-design). The resolved display name and icon everywhere a module's name is sent, `host.info.module`, `PATCH /api/modules/:id`, the Modules tab's card with the module's own name and version.
   - Done when: `npm run check` passes and a module with no display name reads as today.
   - Verify: live, an owner's display name for Planner shown on the Modules tab (with "Planner v<version>" beside it), in the nav, on the dashboard and on the module's own page; `check-modules` covers the field.
   - **Built (2026-09-25).** **Shown as** on every Modules card (Conference and Chat too), `PATCH /api/modules/:id` `{ displayName, displayIcon }` with its refusals, `displayName`, `displayIcon`, `ownDisplayName` and `ownDisplayIcon` on `GET /api/modules`, the display name and icon everywhere a module is named and as `host.info.module`, and the text of `module.json` in the environment's words (the placeholders, all nine bundled manifests converted and bumped, and `check-names --words` reading manifests). Decided by the project manager while building: a module's own icon is always allowed as its display icon; a display icon must be a plain solid icon; and a widget keeps its own title, since the display name replaces the module's name, not a widget's label. Documented in [architecture-modules](../architecture/architecture-modules.md), [api-modules](../api/api-modules.md), [api-module-sdk](../api/api-module-sdk.md) and the Modules guide. Verified live.
3. **Templates** (server-development first, then experience-design). `server/templates.js`, `templates/travel.json`, `tools/check-templates.mjs`, the record, applying once in `environmentFor()`, entitlement skips, live words and icons from the template, `TEMPLATE=`, the create and sign-up fields, the console, Manage's note and skipped list.
   - Done when: `npm run check` passes with `check-templates`.
   - Verify: live on `BASE_DOMAIN=localhost` with a throwaway `DATA_DIR` under `/tmp`: create a travel environment on the console with a plan that leaves Maps out, sign in, and check the words ("trip" everywhere), the modules on in the Lobby and in a new trip, Planner shown by its display name, the Environment panel's skipped list, and an owner changing a word, the home icon and a module name back; sign up from the product page with the template. Without `BASE_DOMAIN`: `TEMPLATE=travel` on a fresh `DATA_DIR`; the same variable on an existing directory (ignored, logged); an unknown id refusing to start. The Conference in a real call is read as code only.
   - **Built (2026-09-25).** `server/templates.js`, `templates/travel.json` (copied by the Dockerfile) and `tools/check-templates.mjs`; the choice on the host console's New environment form (with a **Plan** choice), on the product page's sign-up and as `TEMPLATE` on a fresh single install; applied once and recorded in `app.json`'s `template` with what was skipped and why; the words, home icon and module names and icons followed live, under the owner's own; the marks in Manage and the **Template** panel; the record carried by backup and restore; Planner 0.7.35. Documented in [userguide-templates](../userguides/userguide-templates.md) and [architecture-environments](../architecture/architecture-environments.md) ("Templates"). Verified live on hosted and single installs.

The documentation (a user guide section on templates for owners, the host operator's `TEMPLATE` and console notes, the SDK's `host.locale().words` and `host.util.word`) is content-manager's, after each step lands.

## Note: the Lobby (2026-09-25)

The rule in [plan-modules](plan-modules.md) ("Addendum: the Lobby is for being together", GitHub issue #63) applies to templates. "In every space" here means every space except the Lobby, for any module that does not declare `surfaces.canvas.lobby: true` (the Calendar does). A template, applied at creation or offered on a switch, never puts another module in the Lobby. The Lobby's name and description still come from the template. In the Lobby, chat is always on, the conference follows the environment's switch and the Calendar is there only if it is on; a template turns none of them on there by force (Thomas, 2026-09-25). The switch's offer lists a module as missing only for the spaces it may be in.

## Addendum: switching a template

**Status:** approved 2026-09-25; **built** (2026-09-25), both steps. GitHub issue #59. As built: the question before a switch adds "Then you choose what else it turns on."; the choice sits on Manage's Template tab (addendum 2) rather than Environment; `GET /api/environment/template` and `GET /api/host/environments/:slug/template` read the offer again; a switched record carries `switchedAt`, so it is never applied on its own at a start; and the home icon is stored only when an owner picks one (an old stored default is cleared once). Documented in [architecture-environments](../architecture/architecture-environments.md), "Templates", and [userguide-templates](../userguides/userguide-templates.md).

### The decision

Asked whether an existing environment can take a template, or change to another, Thomas answered: "Yes, owner or host." This amends decision 4.

- An owner (Manage > Environment gains a **Template** choice) or the host admin (the console) can give an existing environment a template, or switch it to another, or to none.
- Switching changes the words, the home icon and the module display names and icons at once. The owner's own choices still win.
- Switching offers to turn on the template's modules. It never turns anything off, removes a module or touches data.
- A switch is recorded the way a template applied at creation is.

### What it is today

The record is `template: { id, appliedAt, skipped }` in `app.json` (`cleanTemplateRecord`, `server/store.js`). `useTemplate()` in `server/index.js` records a template only for a fresh environment and reads the live part from the recorded id on every build (`templates.useLive`). `applyRecordedTemplate()` runs `templates.applyTemplate()` once, while `appliedAt` is empty. Two things it does are wrong for a switch: it sets `conferenceEnabled` to whether the template lists the conference, which can turn the conference off, and it clears `settings.homeIcon`, which would undo an owner's own home icon. The console's `PATCH /api/host/environments/:slug` changes only the registry entry, and the owner's `PATCH /api/settings` passes its body to `store.updateSettings`.

### The contract

**Switching** changes only the live part, at once:

- The record's `id` becomes the new template's (or the record is removed for none). `templates.useLive()` runs against the new template, so the words, the home icon and the module display names and icons follow it on the next request. The owner's own words (`settings.words`), home icon (`settings.homeIcon`) and module display names and icons (`PATCH /api/modules/:id`) are untouched and still win. `appliedAt` and `skipped` are cleared: the new template's once-only part has not been applied.
- The template's icons are added to the environment's icon list, so the pickers show them. Nothing is removed from the list.
- **None** removes the record: the words, the home icon and the module names and icons go back to their defaults (or the owner's own), and nothing else changes.
- A hosted environment's registry entry follows the record, as today.

**The offer.** The answer to a switch lists what the new template would add, and the person switching confirms what they want:

- **Modules**: each module the template lists (with what it requires) that is not already on in every space, with whether the plan allows it. Confirmed modules are installed if needed, enabled and put in every space (`allSpaces: true`), as at creation; one the plan does not include is skipped and recorded, as at creation. The conference is offered when the template lists it and it is off; it is never turned off.
- **The Lobby's name and description, and the new-space defaults** (`spaceDefaults.profile`): offered, unticked, since the Lobby's words are the owner's by now; applied only when ticked.
- When the offer is confirmed (even with nothing ticked), `appliedAt` is written and `skipped` records what was skipped, so the offer is not made again for that template.

**Never touched by a switch:** a module's on or off (except turning on what is confirmed), a module's spaces beyond adding `allSpaces` for a confirmed one, any module's data, the spaces and their members, the environment's settings (decision 1 below), the owner's words, icons and module names, and the billing plan.

**Routes:**

- Owner: `PATCH /api/settings { template: "<id>" | "none" }`. `template` is taken out of the body before `store.updateSettings`; an unknown id answers 400 "There is no template called <id>."; the same id as now answers 200 with nothing changed. The answer is the settings, as today, plus `template` (the view Manage shows) and `offer: { modules: [{ id, name, allowed, why? }], lobby: { name, description } | null, spaceDefaults: { profile } | null }`.
- Owner: `POST /api/environment/template/apply { modules: [ids], lobby: boolean, spaceDefaults: boolean }` applies the confirmed part of the offer for the recorded template; 409 when there is no recorded template or it is already applied.
- Host: `PATCH /api/host/environments/:slug { template }` does the same switch on that environment (building it if it is not built yet) and answers the environment with `template` and `offer`; `POST /api/host/environments/:slug/template/apply` takes the same body as the owner's.
- `GET /api/environment` and the console's environment list show the template and, when its offer is still open, that it is.

**The record.** `template: { id, appliedAt, skipped }` as today. Each switch is also added to `templateHistory: [{ from, to, at, by }]` in `app.json` (`by` is the owner's key or `host`), kept to the last 20 and not shown to owners (decision 3 below).

**`TEMPLATE=`** is unchanged: it picks a template for a new data directory only. On an existing one it is ignored with its log line, as today; switching a single-environment install is done in Manage.

**The pages.**

- Manage > Environment: a **Template** choice (None, then each template's name and description) beside the note naming the current one. Choosing one asks "Switch to <name>? Words, icons and module names change now. Nothing is turned off or removed." Then the offer: the modules as ticked boxes (the plan's refusals shown, not ticked), the Lobby and the new-space profile as unticked boxes, and **Apply** (Apply with nothing ticked closes the offer).
- The host console: the same choice and offer on an environment's card.

### Left to build, in order

1. **The server** (server-development). The switch in the store and `templates.js` (a switch variant of `applyTemplate` that never turns the conference off, never clears `homeIcon`, and applies only what is confirmed); the offer; the four routes; `templateHistory`; `check-templates` running a switch twice against a throwaway store.
   - Done when: `npm run check` passes.
   - Verify: checked by the tool; live on `BASE_DOMAIN=localhost` with a throwaway `DATA_DIR` under `/tmp`: an environment made with no template switched to travel by its owner (the words read "trip" at once, the offer lists the modules, applying it turns them on in every space, a module the plan leaves out is skipped and recorded), then switched to none (the words go back, the modules stay on, their data untouched), and the same from the console; an owner's own word and home icon surviving both switches; a single-environment install switched in Manage.
2. **The pages** (experience-design). The Template choice and the offer on Manage > Environment and on the console's environment card.
   - Done when: the pages pass `npm run check`.
   - Verify: live in a browser on the same servers, both switches from both places. Nothing here needs a call.

The documentation (the owner's user guide on switching, the console's) is content-manager's, after each step lands.

### Decided at approval (2026-09-25)

Thomas answered the addendum's four questions as recommended:

1. **A switch does not offer the template's settings** (language, clock, currency, sign-in text and the rest of its allowed list). They are the owner's by now.
2. **Modules the previous template turned on are left on**, and in every space. A switch never turns anything off.
3. **`templateHistory` is kept**, the last 20 switches, for support and the console; it is not shown to owners.
4. **Switching back to a template used before makes its offer again**, listing only what is missing.

## Addendum 2: templates grow

**Status:** approved 2026-09-25; **built** (2026-09-25), step 3b's move of **Reactions** and **Icons** to Manage's Template tab included. Checked by the tools and a headless smoke test only; the live verification of steps 3a and 3b is still to come. GitHub issue #68. Documented in [architecture-environments](../architecture/architecture-environments.md), "Templates", and [userguide-templates](../userguides/userguide-templates.md). As built: the icon set is its own field, `iconSet`, and `icons` stays `{ home }`; the record also keeps `applied`, a fingerprint of each applied-once part, which decides what an update offers; the console has no one-step "Start from" (a bundled template is exported, then imported under a new id). Builds on the switching addendum (#59), the Lobby note (#63) and [plan-themes](plan-themes.md) (#67).

### The decision

Thomas (#68): "we need a 'template' tab in the environment to group the template-related stuff. In admin, we need to be able to define them too. My assumption over time is there will be more and more 'template' goodness... e.g. emoticons, icon sets, default theme choice, etc." He answered the questions that followed as recommended:

1. **The host defines templates.** They are made and edited on the host console and kept in `host.json`, beside the bundled ones. A single-environment install picks from the bundled templates plus template files it imports; it has no template editor in Manage.
2. **What a template holds grows: reactions, an icon set and a default theme, each applied once.** Only the display parts stay live: words, the home icon, module display names and icons.
3. **Editing a template in use.** Its live parts reach every environment made from it at once, unless the owner chose their own. New modules and the other applied-once parts are offered on the Template tab, never forced. A template has a version, and the offer lists only what is new since the version that environment applied.
4. **No role defaults in templates yet.**
5. **Template files.** `<name>.magpie-template.json`, with `magpieTemplate: 1`, embedding its theme in the theme file's shape ([plan-themes](plan-themes.md)).
6. **A Template tab in Manage** holds what the environment was made from and switching, the left-out modules, Words, module display names and icons (the Modules cards link there), and the home icon. Reactions and the icon list move there once templates hold them. Old links keep working.
7. **A template in use cannot be deleted**, only hidden from new choices.

The Lobby rule (#63) holds for every template, bundled, host-made or imported: a template never puts a module in the Lobby unless the Lobby allows it.

### What it is today

Templates are bundled files only (`templates/<id>.json`, read by `server/templates.js` at start); `GET /api/host/templates` lists them. The template controls are spread across Manage: the made-from note, the left-out modules and the home icon's template choice on Environment (`public/admin.html:284-313`), **Words** on Environment (`admin.html:324`), "Shown as" on each Modules card, and **Reactions** and **Icons** on Theme (`admin.html:154-172`, validated by `cleanReactions` and `cleanIcons`, `server/store.js:382`, `403`). The record is `template: { id, appliedAt, skipped }` in `app.json`, with `templateHistory` from the switching addendum.

### The contract

**Where templates come from.**

- **Bundled**: `templates/<id>.json`, read-only, released with the image.
- **Host**: `host.json` `templates: [{ ...the template, version, hidden, createdAt, updatedAt }]`, made and edited on the console.
- **Imported, single install**: `app.json` `templates: [...]`, from files an owner imports on the Template tab, so a backup carries them. On a hosted server owners do not import templates; they choose from the host's list.
- **Ids are unique across all of them.** A new or imported template whose id is already taken is refused with 409 "There is already a template called <id>." (the import offers a new id). If a later release ships a bundled template with an id a host or imported template already has, the existing one keeps the id and the bundled one is not offered on that server, with a log line; an environment's template never changes under it.

**The template's shape grows** (the same checks in `server/templates.js` and `tools/check-templates.mjs` for every source):

- `version`: a whole number. The host's templates count up on every save; a bundled file carries its own, raised by hand when its applied-once part changes.
- `reactions`: `[{ id, glyph, label }]`, the same shape and checks as `cleanReactions`. Applied once: at creation it becomes the environment's reactions list.
- `icons`: Font Awesome Free names. Applied once: added to the environment's icon list, never removing one.
- `theme`: an embedded theme in the theme file's shape (`{ name, author?, light, dark }`), checked as a theme import is. Applied once: added as a new theme (renamed "Name (2)" on a clash, never overwriting) and made active, with `settings.themeMode` if the template sets it. `settings.activeThemeId` naming a built-in keeps working for a template with no `theme`.
- No `roles` (decision 4).
- The rest is as today: `words`, `icons.home`, `moduleNames`, `moduleIcons` (live); `modules`, `settings`, `lobby`, `spaceDefaults` (once).

**The record** gains `appliedVersion`: `template: { id, appliedAt, appliedVersion, skipped }`.

**When a template changes** (a host edit, or a new release's bundled file):

- The live parts follow at once: the next request reads the words, home icon and module names and icons from the template's current version. An owner's own choices still win.
- The Template tab shows an offer when the template's `version` is above the environment's `appliedVersion`: the modules it now lists that are not on (outside the Lobby), and, unticked, its reactions, icons, theme, Lobby and new-space defaults when they differ from what was applied. Confirming (even with nothing ticked) records the new `appliedVersion`. This is the switching addendum's offer, run for the same template.
- Nothing is forced, turned off or removed, and no data is touched.

**Hidden and deleted.** A host template can be hidden: it is no longer offered on the create form, sign-up or a switch, and environments made from it keep reading it. Deleting answers 409 "Environments use this template: <names>. Hide it instead." while any environment's record names it; one no environment uses can be deleted.

**Template files.** `<name>.magpie-template.json`: `{ "magpieTemplate": 1, ...the template's fields, "theme": { the theme file's fields } }`, at most 64 KB. Import checks it as a template (a newer `magpieTemplate` refused: "This template was made by a newer version of Magpie."; unknown keys dropped and listed, as a theme import does). A bundled template can be exported too, so the host can start one of its own from it.

**Host routes** (host admin only):

- `GET /api/host/templates`: every template, `{ id, name, description, source: 'bundled' | 'host', version, hidden, usedBy: [slugs] }`.
- `POST /api/host/templates`: a new host template.
- `PATCH /api/host/templates/:id`: edit a host template (its `version` goes up); 403 "Bundled templates can't be edited; export one to start your own." for a bundled one.
- `PATCH /api/host/templates/:id { hidden }`: hide or show a host template.
- `DELETE /api/host/templates/:id`: only when unused (above).
- `GET /api/host/templates/:id/export` and `POST /api/host/templates/import`, answering `{ template, dropped }`.

**Owner routes.**

- `GET /api/environment/template`: the Template tab's view: made from (name, source, version), `appliedVersion`, the left-out modules, the open offer if any, and the choices for a switch (hosted: the host's shown templates and the bundled ones; single: the bundled ones and the imported ones).
- The switching addendum's `PATCH /api/settings { template }` and `POST /api/environment/template/apply` serve both a switch and an update offer.
- Single install only: `POST /api/templates/import` and `GET /api/templates/:id/export`; `DELETE /api/templates/:id` for an imported one no longer in use.

**Manage's Template tab** (`/admin#template`), top to bottom:

- **Made from**, with the template's name and version, the Template choice and the switch (the switching addendum), and the offer when one is open.
- **Left out**: what the plan skipped.
- **Words** (moved from Environment).
- **Module names and icons**: every module with its display name and icon, and "Planner v0.7.30" beside each; each Modules card's "Shown as" becomes a link to its row here.
- **Home icon** (the template's choice, moved from Environment).
- **Reactions** and **Icons** move here from Theme in the step that makes templates hold them.
- A single install also gets **Import a template** and **Export** here.
- Old links keep working: `#environment`, `#settings` and `#server` still open Environment, `#theme` still opens Theme, and a link to a moved section opens the Template tab at it.

**The host console** gains a **Templates** tab: the list (source, version, hidden, used by), a template editor for host templates (the fields above, with the module list showing that the Lobby keeps its own rule), Hide, Delete when unused, Export, Import, and "Start from" a bundled template (an export and import in one step).

### Left to build, in order

1. **Theme files** ([plan-themes](plan-themes.md), #67): the foundation for a template's `theme`.
2. **The Template tab, switching and the Lobby rule** (experience-design for the tab; server-development for the switching addendum's routes and [plan-modules](plan-modules.md)' Lobby addendum). The tab gathers what exists today; switching and the Lobby rule land with it.
   - Verify: live on `BASE_DOMAIN=localhost` and on a single install under `/tmp`: every control works from its new place, old links open the right tab, a switch and its offer, the Lobby keeping only what it allows.
3. **Templates grow** (server-development, then experience-design).
   - **3a. The server.** The shape's new fields and `version`, `appliedVersion` and the update offer, host templates in `host.json` with their routes, template files, the single install's imported templates, the id rules, hide and delete, `check-templates` for all of it.
     - Done when: `npm run check` passes.
     - Verify: checked by the tool (every source through the same checks; an update offer listing only what is new; apply twice gives the same result); live, a host template made on the console, an environment made from it, the template edited (the words change at once, a new module offered on the Template tab, nothing forced), hidden (gone from the create form, the environment unchanged), refused deletion while in use; a template exported and imported on a single install; a bundled template exported and started from.
   - **3b. The pages.** The console's Templates tab and editor; reactions and icons moving to the Template tab; the single install's import and export.
     - Verify: live in a browser on the same servers. Nothing here needs a call.
4. **The documentation** (content-manager): the owners' guide to the Template tab, the host's guide to templates on the console, and the template file.

### Decided (2026-09-25, by the project manager while building)

1. **`iconSet` is a separate field.** A template's icons for the environment's icon list are `iconSet: [names]`; `icons` stays `{ home }`.
2. **An owner on a hosted server can export** the template their environment uses, and only that one (open question 2, as recommended). Import and delete stay the host's.
3. **Applied fingerprints decide what an update offers.** The record keeps `applied`, a fingerprint of each applied-once part as it was when last applied or passed over; an update offers only the parts the template changed since, rather than whatever differs from the environment now.
4. **An import keeps the file's version.**
5. **A bundled template's version is raised by hand** (open question 3, as recommended), and enforced: `tools/template-versions.json` records each bundled template's version with a fingerprint of its applied-once part, `check-templates` fails when the part changed and the version didn't, and `node tools/check-templates.mjs --update` records the new ones.

### Open questions

1. **A host template edited while the offer is open.** Recommended: the offer always compares with the template's current version, so the owner sees one offer, never a queue.
2. **An owner on a hosted server exporting their environment's template as a file.** Recommended: yes, read-only (export only), so they can take it to a single install; import stays the host's.
3. **A bundled template's `version`.** Recommended: raised by hand only when its applied-once part changes; a change to words or icons alone needs no new version, since those are live.


## Addendum 3: editing a bundled template

**Status:** approved by Thomas 2026-09-26; **built** (2026-09-26), both steps, in pull request #97 (GitHub #91). As built: `base` also keeps `whole`, a fingerprint of the whole shipped template apart from its version (`templates.wholeFingerprint()`), per the decided open question below, so the stored-shape bullet's `{ version, fingerprint }` is `{ version, fingerprint, whole }`; the notice has a **Review** button that opens the compare panel; Duplicate asks for the id and name in two prompts. Documented in [architecture-environments](../architecture/architecture-environments.md), "Templates", and [userguide-templates](../userguides/userguide-templates.md). Checked by `tools/check-templates.mjs` and `tools/check-template-switch.mjs`, and the full `npm run check` passed on the Mac; the console was walked live on 2026-09-30 in headless Chromium on a throwaway hosted server: **Edit** on Travel (the hint, the id hidden, saved as a new version), the **Edited** mark and **Reset to shipped**, **Duplicate** and its 409 and 400 refusals, the "updated in this image: review" notice with **Keep mine** and **Take the new version**, and a word change reaching an environment at once; the refusals were also checked by curl, and at 390 px wide the console wraps without scrolling sideways. Not checked: keyboard only, and that a single install has no editor. Seen in that walk: saving rewrites the order of the module list (see [known-issues](../known-issues.md)). Reverses addendum 2's "Bundled templates can't be edited" on the host console. Duplicate is GitHub issue #91. Hosted servers only: a single install still has no template editor.

### Decided (2026-09-26)

1. **The host edits a bundled template in place.** The edits are a layer over the shipped file, kept in `host.json` beside host templates. The id stays, so environments made from it get the fix. Each edit raises the version, as a host template's edit does: words, home icon and module names and icons follow at once; the rest is offered on the Template tab.
2. **Edited** badge and **Reset to shipped**, which removes the layer and raises the version.
3. **A newer image ships a changed bundled template while the host has edits:** the edits are kept and the console shows "<name> was updated in this image: review", with take the new version (drops your edits), keep yours (clears the notice), or compare.
4. **Every edit goes through the same checks** (`templates.problemsOf`). An edited bundled template exports as the merged template plus `edited: true`.
5. **Duplicate (#91)** makes a separate host template at version 1.
6. **Delete stays refused for a bundled template; hiding it is allowed.**

### The stored shape

`host.json` gains `bundledEdits: [{ id, template, version, base, hidden, updatedAt }]`, one record per bundled id the host has touched:

- `template`: the whole edited template (the fields of `templates.FIELDS` except `version`), or `null` when not edited (after a reset, or a record that only hides).
- `version`: the version environments see. First edit: the shipped version + 1. Every later edit, a reset and a take-new: `version` + 1. It never goes down.
- `base: { version, fingerprint }`: the shipped file the edits were made against. `fingerprint` is `templates.appliedOnceFingerprint(shipped)`, the same value `tools/template-versions.json` records.
- `hidden`: a boolean.

**The merge rule is whole, not field by field:** while `template` is set it is the template, and the shipped file is not read. Why: the editor already sends and checks a whole template; "keep yours" then means exactly what the host sees, with no shipped change leaking into some fields and not others; and compare is two whole templates side by side.

**The template in use** (`templateCatalog`): for a bundled id with a record, `{ ...(record.template ?? shipped), id, version: record.version, source: 'bundled', edited: record.template !== null, hidden: record.hidden }`; without one, the shipped file as today with `edited: false`. A record whose id is no longer shipped is ignored, with a log line. A host template with a bundled id still wins, as today.

**At start**, for each record whose `base` differs from the shipped file's version or fingerprint: with `template: null`, set `version` + 1 and `base` to the shipped file (nothing to lose, so no notice); with a template, leave it: the notice is open while `base` differs.

### Routes (host admin, hosted server)

- `GET /api/host/templates`: each item adds `edited` (boolean) and `update`: `null`, or `{ shippedVersion }` while a notice is open.
- `GET /api/host/templates/:id`: for an edited bundled template adds `shipped`: the shipped template in full, for compare.
- `PATCH /api/host/templates/:id` on a bundled id: now allowed, the same body and checks as a host template (400 `{ error, problems }`). Creates or updates the record and raises `version`; `{ hidden }` alone changes no version. Answers `{ template }`. The 403 "Bundled templates can't be edited; export one to start your own." is removed.
- `DELETE /api/host/templates/:id/edits`: reset to shipped. Sets `template: null`, `version` + 1, `base` to the shipped file; answers `{ template }`. 404 "There is no template called <id>."; 400 "Only a bundled template can be reset." for a host template; 409 "<name> has no edits to reset." when not edited.
- `POST /api/host/templates/:id/update { keep: 'shipped' | 'mine' }`: answers the notice. `shipped` is a reset (above); `mine` sets `base` to the shipped file, version unchanged. Answers `{ template }`. 409 "There is no update to review for <name>." when no notice is open; 400 "keep must be shipped or mine."
- `POST /api/host/templates/:id/duplicate { id, name }` (#91): a new host template from the template in use (edited or not), `version: 1`, `hidden: false`. 201 `{ template }`; 409 "There is already a template called <id>."; 400 `{ error, problems }` from `problemsOf`; 404 as above. Works for host templates too.
- `DELETE /api/host/templates/:id` on a bundled id: still 403, now "Bundled templates can't be deleted. Hide it instead."
- `GET /api/host/templates/:id/export`: the template in use; an edited one's file adds `"edited": true`. Every import ignores `edited` without listing it in `dropped`.
- Every change above runs `refreshTemplateLive(id)` when the template in use changed.

### The console (Templates tab)

- A bundled row: "Bundled, version N", an **Edited** badge when edited, and **Edit**, **Hidden**, **Export**, **Duplicate**, and **Reset to shipped** (shown only when edited; confirm "Reset <name> to the shipped version? Your edits are removed."). No Delete.
- A host row adds **Duplicate**.
- The editor for a bundled template is the host template editor, titled "Edit <name>", with the hint "Your edits are kept over the shipped template."
- **Duplicate** asks for the new id and name, then opens the new template in the editor.
- **The notice**, above the list, one per open update: "<name> was updated in this image: review". **Review** opens a compare panel: each field that differs, shipped beside yours, then **Take the new version** (confirm "This drops your edits to <name>.") and **Keep mine**.

### Check cases (`tools/check-templates.mjs`)

1. First edit of a bundled template: version = shipped + 1, `edited: true`, the id unchanged; an environment made from it reads the new words at once and is offered a changed applied-once part.
2. An edit that fails `problemsOf` is refused with the same problems as for a host template, and nothing is stored.
3. Reset: `edited: false`, the shipped fields back, version + 1 (never back to the shipped number).
4. A changed shipped file (a new `base` fingerprint or version) with edits: `update` is set, the edits are kept; `keep: 'mine'` clears it with no version change; `keep: 'shipped'` drops the edits and raises the version.
5. The same with no edits: no notice, version + 1 at start.
6. Hide a bundled template: gone from `templateChoices`, still read by environments made from it, no version change.
7. DELETE of a bundled id: 403; reset of a host template: 400; reset of an unedited one: 409.
8. Duplicate: a host template at version 1 with the fields of the template in use; a taken id 409.
9. Export of an edited template carries `edited: true` and the merged fields; importing it (under a new id) succeeds and lists no `dropped`.
10. The single install: none of these routes exist.

### Acceptance

- On a hosted server the host edits Travel on the console; environments made from Travel show the new words without a reload of the server, and the Template tab offers any new module. The row shows **Edited**.
- **Reset to shipped** brings back the shipped template and the version still rises.
- With edits kept and a newer image whose Travel changed, the notice shows; each of its three choices works as above.
- Duplicate, hide and export behave as above; Delete is never offered for a bundled template.
- `npm run check` passes.

### Files to touch

`server/host-registry.js` (`bundledEdits`: get, put, remove), `server/index.js` (`templateCatalog`, `templateSummary`, the routes, the start-up pass), `server/template-file.js` (`edited` out, ignored in), `public/host-templates.js` and `public/host.html` (rows, badge, notice, compare, duplicate), `tools/check-templates.mjs`.

### Left to build, in order

1. **The server** (server-development): the stored shape, the catalog, the routes, the start-up pass, the checks. Done when `npm run check` passes. Verify: checked by the tool; live on `BASE_DOMAIN=localhost` with `DATA_DIR` under `/tmp`.
2. **The console** (experience-design): the rows, editor, notice, compare and duplicate. Verify: live in a browser. Nothing here needs a call.
3. **The documentation** (content-manager): the host's guide to templates and architecture-environments.

### Open questions

1. **A shipped change to live parts only** (words, home icon, module names or icons). Decided (PM, 2026-09-26): record a fingerprint of the whole shipped template in `base` as well, and raise the "updated in this image" notice when either fingerprint differs, so an edited template never silently keeps old words.

## Addendum 4: the word for entering a space

**Status:** Approved by Thomas, 2026-09-30; **built** (2026-09-30), steps 1 to 4. As built: the whole-template fingerprint (addendum 3's notice) counts `verbs` only when a template sets one, so a template without verbs keeps the fingerprint it had before the field existed and no edited bundled template's notice opens for it; `templateVerbs` is null with no template and `{}` for a template without verbs; in a template file a verb that isn't text, null included, is refused with "verbs: The enter verb must be text." (a file leaves the key out instead); the host editor's `PATCH` takes `verbs`, and null removes it. Beyond the contract: the space card's buttons were reordered so the main button comes first and the small buttons (link, pop-out, choose what opens, space settings, module settings) follow it as one group, moving to their own line on a narrow card; the main button's label is cut with "…" only when it is wider than the whole card, and its title always holds the full label; the **Open with** box opens above the row. Space settings' launch-link hint reads the verb ("Shown on the button next to <verb>…"). Verified live on a single install and with `BASE_DOMAIN`, in headless Chromium and by curl: the defaults, an owner's verb everywhere and **Reset**, a host template's verb reaching an environment at once, every refusal, an aside's card (presence faked), the guest form, and the space list at 1280, 1024 and 390 pixels wide with long words. Checked by tools: `check-templates` (34 groups), `check-template-switch` (14), `check-names --words` and `check-slot-names`. Not checked: **Back to <space>** and **Back to <aside>** in a real call (no LiveKit server here), and a screen reader. Documented in [architecture-environments](../architecture/architecture-environments.md) ("Templates"), [architecture-overview](../architecture/architecture-overview.md) ("Words"), [userguide-environment-settings](../userguides/userguide-environment-settings.md), [userguide-templates](../userguides/userguide-templates.md), [userguide-spaces](../userguides/userguide-spaces.md) and [userguide-accounts](../userguides/userguide-accounts.md). From the open question in [plan-entering](plan-entering.md) ("Should the guest form's 'Join' say Enter?"). Thomas (2026-09-30): "Yes, as a matter of fact in our 'template' settings, the template should drive what that button says. Default to 'enter' instead of join -- because a previous mandate was that we do not join calls by default." An addendum here rather than a new plan, since it adds one more live, owner-editable word to the machinery this plan built (addenda 1 to 3 follow the same pattern). **Changes what plan-entering Part 1 built for asides:** an aside's card says **Join**, not **Enter** (decision 2).

### What it is today

- plan-entering Part 1 is built: the space list's primary button reads **Enter** with `fa-door-open` (`public/space.html:58`), set in `public/space.js:415`, and **Back to <space>** with `fa-circle-left` when the page is still connected to that space. The pop-out button's title and label are "Enter in a pop-out window" (`space.html:59`). All typed text.
- The guest form still reads as joining a call: the heading "Join as {a guest}" (`space.html:39`), replaced by "Join <space>" once the link is read (`space.js:3891`), and the button **Join** with `fa-comments` (`space.html:41`).
- Prose that says a person "joins" a space: the guest link's hint, "Anyone with this link joins this {space} with just a name" (`space.html:233`); the Roles hint, "{Guest} is everyone who joins from {a space}'s {guest} link" (`admin.html:177`); and the product page, "guests can join a space with just a name" (`landing.html:83`), which is the host's page and has no environment words.
- "Join" that is about the call, and stays: the call control's **Join** and "Join the call" (`space.js:973`, `978`), the microphone note ("You join with your camera off"), the aside invitation's "Join them?" (`space.js:2279`), and the layout readout's hint (`admin.html:233`). "You're invited to join <environment>" (`register.js:14`) is about the environment and stays.
- The code names stay as they are, per CLAUDE.md: `#join`, `data-join`, `data-join-label`, `#guest-join`, `.join-with` and `POST /api/guest-join`.
- The words machinery (step 1 and addenda 2 and 3): `server/words.js` holds the ten changeable nouns, each `{ one, many, a? }`, resolved owner, then template, then default; `settings.words`, `PATCH /api/settings`, `branding().words`, `public/words.js` (`word()`, `data-word`, `data-fill`), Manage's **Words** panel on the Template tab, the host template editor's word rows (`public/host-templates.js:247`), the template file's `words` (checked in `server/templates.js`), and `check-names --words`. The vocabulary section above says "Adding a key means adding a level, which is a change to CLAUDE.md's Names first."

- An aside's card uses the same code (`space.js:411-420`), so today it also reads **Enter**.

### Decisions (Thomas, 2026-09-30)

1. **A small `verbs` map beside `words`**, starting with one key, `enter`. The action is a verb, not a level or role: it has no plural and no article, and the vocabulary stays exactly the Names. (A key in `words` would have broken the vocabulary rule; a setting applied once would not be driven live by the template.)
2. **An aside's button says "Join".** An aside is a call; choosing an aside is choosing the call. The enter word is for spaces only.
3. **Travel's word is "Enter"**, the default, so `templates/travel.json` gets no `verbs` entry.
4. **"Back to <space>" stays fixed text.** It is going back, not entering, and matches the header's "Back to" link (`brand.js:650`).
5. **The prose that says a person "joins" a space is reworded as fixed text** that says neither "join" nor the verb: the guest link's hint, the Roles hint, and the product page's "guests can join a space".
6. **The icon stays `fa-door-open`**; the template sets only the word.
7. **An aside's Join button has the phone icon, `fa-phone`, "for now"**, and its pop-out title reads "Join in a pop-out window" (Thomas, 2026-09-30, answering this addendum's one open question).

### The contract

- **The key** is `enter`, a code name that never changes; only what a person reads does. Default **Enter**. The map is named `verbs`, so later actions can join it without touching the Names.
- **Its shape** is one string, as it reads at the start of a button ("Enter", "Go to"): no plural, no article, no `cap` form. Tidied like a word; 1 to 20 characters; letters, spaces, hyphens and apostrophes (the `WORD_RE` rule). It is always used first in a label, followed by nothing, a space's name, or fixed text, so it is never lower-cased or conjugated.
- **Sentences built from it** (spaces only):
  - The space list's primary button: `<enter>`, with `fa-door-open`.
  - The pop-out button's title and label: `<enter> in a pop-out window`.
  - The guest form's button: `<enter>`, with `fa-door-open` in place of `fa-comments`.
  - The guest form's heading: `<enter> <space name>` once the link is read; before that, `<enter> as {a guest}`.
- **Fixed text:**
  - **Back to <space>**, with `fa-circle-left`, as built.
  - **An aside's card:** the primary button reads **Join** with `fa-phone` (for now, decision 7), and the pop-out button's title and label "Join in a pop-out window". When the page is still connected to that aside, it reads **Back to <aside>** as a space does. The words are fixed; an aside never reads the enter word.
  - **The reworded hints**, experience-design's wording, for example: "Anyone with this link can come into this {space} with just a name" (`space.html:233`); "{Guest} is everyone who comes in from {a space}'s {guest} link" (`admin.html:177`); "guests can come into a space with just a name" (`landing.html:83`, the host's page, no environment words).
- **"Join"** stays only for the call: the call control, the microphone note, the aside invitation, an aside's card, and the layout readout.
- **Server** (`server/words.js`, beside the words):
  - `VERBS = ['enter']` and `DEFAULT_VERBS = { enter: 'Enter' }`; resolved as the owner's (`settings.verbs.enter`), else the template's, else the default.
  - `PATCH /api/settings` takes `verbs: { enter: "<text>" | null }`; null returns it to the template's or the default. It answers 400 with one sentence for an unknown key ("There is no verb called x; the verbs are enter."), and for text that is too long or has other characters.
  - `branding()` gains `verbs` (resolved). The owner's settings view gains `ownVerbs` and `templateVerbs`, like `ownWords` and `templateWords`.
  - Not in `host.locale()`: no module enters a space.
- **The template file** gains an optional `verbs: { enter }`, checked by `problemsOf()`, kept by `cleanTemplate()`, and made live by `useLive()` (`store.templateVerbs`). It is a live part, so it is not in `PARTS`, the applied-once fingerprint or the switch's offer, and changing it needs no `version` bump. It is in `FIELDS`, so the whole-template fingerprint (addendum 3's notice) sees it. `format` and `formatVersion` stay `template` and 1: the field is optional, and an export leaves it out when it is not set. An older server refuses a file that has it, with its unknown-field sentence.
- **Switching templates**: the new template's verb shows at once, under the owner's own, as words do.
- **Pages:** `public/words.js` gains `verb('enter')` and a `data-verb="enter"` attribute that `loadBranding()` fills, with the default until `/api/branding` answers. `space.js` builds a space's button, pop-out title and the guest heading from `verb('enter')`, and an aside's from the fixed **Join**.
- **Manage > Template > Words** gains one row under the ten words: "Button for entering {a space}", one field, blank for the template's or the default, with the same "from the template" mark and Reset. **The host template editor** gains the same row and saves `verbs`; its compare panel lists **Verbs**.
- **`check-names --words`**: no new rule. A one-word string reads as code to its scanner, so it cannot tell a typed "Enter" label from `e.key === 'Enter'`. QA greps for it instead.
- **Travel** (`templates/travel.json`): unchanged; a trip reads **Enter** (decision 3).

### Left to build, in order

1. **The server** (server-development): `verbs` in `server/words.js`, `settings.verbs` and `PATCH /api/settings`, `branding().verbs`, `ownVerbs` and `templateVerbs`, the template field (`FIELDS`, `problemsOf`, `cleanTemplate`, `useLive`), export and import, and the check cases. Done when `npm run check` passes and an environment with nothing set answers `verbs: { enter: 'Enter' }`.
2. **The pages** (experience-design): `verb()` and `data-verb`; a space's button and pop-out title from the verb; an aside's card as **Join** with `fa-phone` and "Join in a pop-out window"; the guest form's heading, button and icon; the three reworded hints (`space.html:233`, `admin.html:177`, `landing.html:83`); the Manage row; the host template editor's row and compare label. Done when every place in "Sentences built from it" reads the verb, an aside's card reads **Join**, and no other typed "Join" or "Enter" for a space is left.
3. **QA** (quality-assurance): the checks below.
4. **The documentation** (content-manager): architecture-environments ("Templates"), the Manage, spaces and templates user guides, the API's settings and branding fields, and plan-entering's status (the guest form question answered, and an aside's card now **Join**).

### Verify

- **Checked by a tool:** `check-templates` (a valid `verbs`; an unknown key, too long, and bad characters refused; a live field, so no version bump required); `check-template-switch` (the verb follows a switch, the owner's own wins, null returns to the template's); `PATCH /api/settings` refusals.
- **Live on a local server** (`BASE_DOMAIN=localhost`, `DATA_DIR` under `/tmp`): a space's button and pop-out title; an aside's card reading **Join** (an aside needs a person to start one, so it may need to be made through the API); a guest link's form (heading, button, icon) before and after the link is read; an owner's verb set on Manage and cleared; a host-edited template's verb reaching an environment at once; a template export and import carrying it; the three reworded hints. A grep of `public/` for "Join" and "Enter" as label text finds only the call's and the aside's.
- **Not checkable here:** **Back to <space>** and **Back to <aside>** need a connected call, so they are read as code only until a real LiveKit server.

### Open questions

None. The aside card's icon and pop-out title were settled on 2026-09-30 (decision 7).
