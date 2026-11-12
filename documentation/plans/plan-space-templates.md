# Space Templates Plan

**Audience:** Thomas decides every open question at the end. If he approves, server-development builds the data and the server's resolution of a space's words and phases, and experience-design builds the pages (the words on a space's page, the choice in Set up and in Add). Steps 1 and 2 are core changes (`server/`, the stored data format, what `public/module-host.js` sends to a frame) and are held for an independent read. quality-assurance reads the result; content-manager documents it after.

**Status:** Draft for Thomas, 2026-11-12, by product-planner (GitHub #750). Nothing is decided and nothing is built. From Thomas, 2026-11-12: "Right now we apply a template (e.g. travel) at the environment level. We discussed letting the default be set at the environment level but letting each space be able to use a different template (e.g. game)."

## Why

An environment has one template today. A group that runs a trip and a campaign in the same environment reads "trip", "Itinerary" and a six-step trip timeline in both, or the owner overrides every word by hand and still has the wrong timeline. The idea is that the environment keeps a template as the default and a space may choose another, so a trip space reads as Travel and a campaign space reads as Games.

This changes what the machinery of [plan-environment-templates](plan-environment-templates.md) is keyed on. Today everything about a template is resolved once per environment, per request. A space's template adds a second key, the space, and every place that resolves a word, a phase or a module name has to know which space it speaks for. That is the whole cost of the idea, and most of this plan is about where it lands.

## What it is today

All facts below were read in the code on `main` (2026-11-12). None of it was run.

- **One template per environment.** The record is `template: { id, appliedAt, appliedVersion, skipped, applied, switchedAt }` in `app.json` (`cleanTemplateRecord`, `server/store.js`, from line 124), with `templateHistory` (last 20). A switch changes only the live part; the applied-once part is an offer ([plan-environment-templates](plan-environment-templates.md), the switching addendum).
- **The live part is loaded onto the store.** `useLive(store, template)` (`server/templates.js:327`) sets `store.templateWords`, `templateVerbs`, `templatePhases`, `templateModuleNames`, `templateModuleIcons` and `templateHomeIcon`. These belong to the environment's store, so they are the same for every space in it.
- **Words are resolved per request, per environment.** `store.resolvedWords()` is the owner's own words, else the template's, else the default (`server/words.js`, `resolve`). The server's `word()` reads the request's environment through `useCurrent` (`server/index.js:355`). `home` is the eleventh changeable key and follows the plural of `space` unless set. The verbs (`enter`, `layout`) resolve the same way.
- **Pages read words once and keep them.** `/api/branding` sends `words`, `verbs` and `phases` (`branding()`, `server/index.js:1705`). `loadBranding()` calls `setWords` (`public/brand.js:155`). `public/words.js` keeps one module-level set and stores it in `localStorage` (`app.words`, `app.verbs`) so the next page paints with it. Home is not a page of its own: it is `#join` in `public/space.html`, drawn by `public/space.js`, the same page as a space ([plan-home-lobby](plan-home-lobby.md)). A person moves between Home and a space inside one page load.
- **Modules get words and phases from the context route.** `GET /api/modules/:id/context` (`server/index.js:10577`) answers `locale.words` (the environment's), `phases` (the template's, live), `space` (id, name, phase dates) and `module.name` and `.icon` through `shownModule()` (`server/index.js:4891`). The route knows the space (`ctx.spaceId`), so it could answer for it.
- **Module display names and icons** come from `store.moduleDisplay(id)`: the owner's own (`settings.moduleNames`), else the template's, else the manifest's. `shownModule()` is called in about a dozen places and none passes a space.
- **Phases.** The template's `phases` (`server/templates.js`, at most 12) reach the pages in `branding().phases` and modules in `host.phases()`. The dates are the space's: `space.phases: { <id>: { start?, end? } }` (`server/store.js:863`; the rule is `public/phases.js`). `problemOf()` refuses a date for a phase id the template does not have ("There is no phase called ..."), and `timelineOf()` walks the template's list and ignores stored ids that are not in it. The Set up panel saves the whole dates map (`datesCopy`, `public/space-setup.js`). [plan-one-bar](plan-one-bar.md) decisions 7 and 8: phases come from the template, the chip reads the current phase from them, and no phases means no chip.
- **Which modules are on is the environment's, not the space's.** [plan-layout-views](plan-layout-views.md) (decision 16) removed the per-space switches: an enabled module with the space scope is on in every space (`onInSpace()` ignores `allSpaces` and `spaces`), and in the Lobby only when its manifest says `surfaces.canvas.lobby`. A template's `modules` is applied once to the environment, or offered on a switch.
- **What a space already holds of its own** (`sanitizeSpace`, `server/store.js:828` to `868`): `profile`, `opensWith`, `defaultLayout`, `link`, `entry`, `phases`, `budget` and others. A new space starts from `settings.spaceDefaults` (`profile`, `opensWith`), which is where a template's `spaceDefaults` landed (`addSpace`, `server/store.js:1881`).
- **The Lobby** is the space with id `LOBBY`. Since [plan-home-lobby](plan-home-lobby.md) its name and description are kept as stored and no longer shown; Home's chat is its chat.
- **Asides** are their own records (`sanitizeAside`) with an `origin`, the space they were pulled out of.
- **Guests.** A link guest is in one space only (`{ guestSpace }`, [architecture-access](../architecture/architecture-access.md)); a door guest chooses among spaces whose `entry` is `guests`. The guest form reads the environment's words before the link is read (`GET /api/guest-link/:token`, `server/index.js:4126`).
- **Demo data** is per template id: `templates/demo/<template id>.json`, loaded for the environment's template (`server/demo-loader.js`, [plan-demo-space](plan-demo-space.md)). Only `travel` has one.
- **A template in use cannot be deleted** (addendum 2), and the console's "Used by" counts environments (`usedBy`).

## What a template carries, and whether a space could differ

For each piece: could it differ per space, and what breaks if it does.

| Piece | Today | Could differ per space? | What breaks, or what it costs |
|---|---|---|---|
| Words (the eleven changeable keys) | Environment, live; the owner's own words win | Yes, if the server and the pages can say which space they speak for | Pages that mix spaces (Home, the bell, the switcher, Manage) have no single space. Server messages and the browser's kept words need a space context. Question 2. |
| Verbs (`enter`, `layout`) | Environment, live | Yes, as words | `enter` is used on the list of spaces, outside any space, so it stays the environment's there. `layout` is in a space's own bar. |
| Phases | Environment, live; the dates are on the space | Yes, and it is the natural fit: the dates are already per space | Stored dates for phase ids the new template lacks (question 4). A template with no phases and one with six: the chip appears or not by space. |
| Module display names and icons | Environment, live; the owner's own win | Yes, if `shownModule()` learns a space | About a dozen call sites with no space (Manage's Modules tab, the nav, the dashboard). Inside a space they read the space's; in Manage they stay the environment's. |
| Which modules are offered | Environment, applied once or offered | Not without reversing plan-layout-views decision 16 | A per-space module list means per-space switches again, per-space entitlement against the billing plan, and the Layout panel's Show list changing by space. Out of version 1. |
| Default layouts and tabs (`opensWith`, `defaultLayout`, first visit) | A space's own fields; the environment's `spaceDefaults` seed new spaces | Already per space after creation | A space's template could seed its `opensWith` at creation as the environment's does. After that it is the owner's. |
| Profile (`spaceDefaults.profile`) | Seeds a new space | Already per space | The same. |
| Settings (language, clock, currency, sign-in text, theme mode, calls) | Applied once to the environment | No | They are the environment's by nature. Out. |
| Reactions, icon set, theme | Applied once to the environment | No | One theme and one reaction list per environment. Out. |
| Demo data | Per template id | Yes, for a space | The loader would take the space's template, else the environment's. Small (question 9). |
| The word for Home (`home`) and the home icon | Environment | No | Home lists the spaces and has no space. Always the environment's. |
| The Lobby's name and description | Applied once; no longer shown | No | The Lobby is not given a template. |

## The shape the suggestions add up to

Every question at the end has my suggestion first. Taken together they give the contract below. Where an answer changes the contract, the section says which question.

### Data (server-development)

- **The stored shape (question 7).** A space record gains an optional `template: "<id>"` (`sanitizeSpace`). Absent means the environment's template. No `appliedAt`, `skipped` or `applied` on a space: with the scope below nothing is applied once to a space. The Lobby never has the key (`id !== LOBBY`, as `entry` and `requestAccess` are handled). The product is not released, so there is no migration; a space made before this has no key and reads the environment's.
- **An unknown id** (a template the host later deleted or a release dropped) reads as the environment's, and the log says so once per id. Deleting a template is refused while any environment's record or any space names it: `DELETE /api/host/templates/:id` answers 409 "Environments or spaces use this template: <names>. Hide it instead.", and `usedBy` gains the number of spaces.
- **Resolution.** One new store method, for example `lookOf(spaceId)`, answers the words, verbs, phases, module display names and icons for a space: the owner's own (environment-wide, `settings.words`, `settings.moduleNames`) first (question 10), then the space's template, then the environment's template, then the defaults. With no space, or a space with no `template`, it answers exactly what `resolvedWords()`, `resolvedVerbs()`, `templatePhases` and `moduleDisplay()` answer today. `host` and `admin` always read the defaults.
- **The server's `word()`.** `useCurrent` reads the request's environment. It gains a second, optional context, the space the request is about (set from the route's `:id` or the module context's `spaceId`), so a message built inside a space's route says "no such trip" for a trip. Outside a space's route nothing changes.
- **Routes.**
  - `PATCH /api/spaces/:id { template: "<id>" | null }`: owner and host admin (question 3). Unknown id: 400 "There is no template called <id>." The same id as now: 200, nothing changed. `null` returns the space to the environment's. On the Lobby: 400 with one sentence. The answer is the space, as today.
  - `POST /api/spaces { ..., template }`: the same field at creation.
  - `GET /api/spaces` and `GET /api/spaces/:id` gain `template` (the id or null). `GET /api/spaces/:id` also gains `look: { words, verbs, phases }`, resolved for that space, so the page paints the space's words without a second request.
  - `GET /api/modules/:id/context` answers `locale.words`, `phases` and `module.name` and `.icon` from `lookOf(ctx.spaceId)`. No template id reaches a module (the conduit rule, decision 12 of the environment-templates plan).
  - The guest read (`GET /api/guest-link/:token`) answers the same `look` for the link's space (question 5c).
  - The routes and notices that name a level in a sentence about one space use that space's words through the new context.
- **A change of template** changes the live part at once and nothing else: words, verbs, phases and module display names follow on the next read. It does not touch the space's `phases` dates, `opensWith`, `defaultLayout`, `profile`, members, any module's data, or the environment's modules (the switching addendum's "never touched" list). It is not an offer, because with modules, settings, reactions and theme out of scope there is no applied-once part (question 5b asks whether to offer the new `spaceDefaults`).
- **Phase dates after a change (question 4).** Dates stored for phase ids the new template lacks stay on the record and `timelineOf()` ignores them. A save must not fail on them: the Set up panel sends the whole map and `problemOf()` refuses an unknown id. So `updateSpace` drops dates for ids the space's current template lacks before it checks, and the panel sends only the ids it shows. A phase id both templates share keeps its dates.
- **The off switch (question 6).** `settings.spaceTemplates` (boolean, absent means on). While off, `lookOf()` ignores every space's key and the choice is hidden. The keys are kept, so turning it on restores them.
- **Aside (question 5a).** An aside has no template. Its words and verbs resolve from its `origin` space's template while the origin exists, else the environment's.
- **Demo data (question 9).** A demo load for a space takes the space's template id, else the environment's, to pick `templates/demo/<id>.json` (`server/demo-loader.js`).

### Pages (experience-design)

- **Words follow the surface (question 2a).** Inside a space (its page, Set up, the chat, the call, the module frames, the Layout panel) the page uses the space's `look`. Everywhere else (Home, the bell, the switcher's list, the top bar outside a space, Manage, Profile, the guest door, the sign-in pages) it uses `/api/branding`'s. `public/words.js` gains a scoped set: `setSpaceLook(look)` when a space opens and `clearSpaceLook()` when the person goes Home or to another space, inside the same page load. The scoped set is never written to `localStorage`; the stored set stays the environment's.
- **Which keys the space's words change (question 2b).** `space`, `aside`, `canvas`, `module`, `object`, `moderator`, `member`, `guest`, and the verb `layout`. Keys that name things above a space stay the environment's: `environment`, `owner`, `home` and the verb `enter` (it is used on the list of spaces).
- **Phases.** The phase chip, the timeline sheet, Set up's Phases tab and `host.phases()` read the space's phases. A space whose template has none shows no chip.
- **Set up, Space tab** (owners and the admin): a **Template** choice: "Same as the {environment}" (the default, naming its template), then each template the owner may choose, with its description. Choosing asks "Change this {space} to <name>? Its words, {phases} and {module} names change now. Nothing is removed." Hidden while `settings.spaceTemplates` is off. The wording is experience-design's.
- **Adding a space** (Manage > Spaces, and Home's **Add {space}** card): the same choice, default "Same as the {environment}".
- **Manage > Template tab:** the switch "Let a {space} use its own template" (question 6), and a note on the Words panel: "Words you set here apply in every {space}, whatever its template."
- **The host console:** "Used by" shows environments and spaces; the delete message follows the server.
- **Cards and the switcher** show no template mark in version 1 (question 8).
- **Module frames** take their words, phases and names from the context route, so a module open in two spaces at once (a pop-out) reads each space's own. `public/module-host.js` passes nothing new.

### SDK and API

- No new SDK function. `host.locale().words`, `host.phases()` and `host.info.module` keep their shape and become the space's. That is the one change a module can see; no bundled module reads a template id.
- Documentation: [api-modules](../api/api-modules.md) (the context route). There is no spaces API document, so the space routes are documented in [architecture-environments](../architecture/architecture-environments.md).

## Behaviour by role and surface

| Who and where | What they see and do |
|---|---|
| **Owner** | Chooses a space's template in Set up and when adding a space; turns the feature off in Manage > Template. Sees the environment's words on Home and in Manage, the space's inside it. |
| **Admin (host)** | As an owner. The console's "Used by" shows spaces. |
| **Moderator** | Reads the space's words and phases. Cannot change the template (question 3). |
| **Member** | Reads the space's words and phases; Home and the bell in the environment's. |
| **Guest by link** | Sees only the link's space, in that space's words. The form's heading before the link is read stays the environment's. |
| **Guest by the door** | The door page is the environment's; once in a space, that space's. |
| **Home** (the list of spaces) | The environment's words, always. A trip card and a campaign card sit side by side, each under its own name. |
| **The bell** | Headings and counts in the environment's words. A notice about one named space is built with that space's words (question 2a). |
| **The switcher** | The heading and the Home entry in the environment's words; each row is the space's name. |
| **The call** | Inside a space, so the space's words. Fixed text such as "Join the call" is unchanged. |
| **An aside** | The origin space's words and verbs (question 5a); no phases or module names of its own. |
| **The Lobby and Home's chat** | The environment's. It has no template. |
| **Phones** | No layout change. Set up is already a full-screen sheet and the Template choice is a plain select in it. The chip appears or not by the space's template. The first paint of a space page has the same flash as on a desktop (risk 3). |

## Verify

**Checked by a tool** (new checks below): the resolution order for every piece (owner's own, space's template, environment's template, default); a space with no key reading what it reads today; an unknown id; the Lobby refusing the key; a delete refused while a space uses a template; stale phase dates kept and a save not failing on them; an aside inheriting; the guest read; the context route for two spaces with two templates; the off switch.

**Verified live** on a local server with two spaces (a Travel one and a Games one) in one environment: Home, the switcher and the bell in the environment's words; each space's page, Set up, chat, Layout panel and a module open in it in its own; a change of template and its words at once; a save with stale phase dates; a guest link; an aside from each; a hosted second environment never taking the first's words; a reload on a space page and on Home; the off switch and back. At 390 px wide for the phone cases.

**Not checkable here:** a real call (its labels are read as code only), a real phone, a screen reader.

## Tests and checks to add

- A new `tools/check-space-templates.mjs`: the resolution table, the refusals, the guest read, the context route, `usedBy`, the off switch.
- `tools/check-templates.mjs`: the delete refusal and `usedBy` count spaces.
- `tools/check-phases.mjs`: dates for an id the template lacks are dropped before the check and kept on the record; a shared id keeps its dates.
- `tools/check-names.mjs --words`: no new rule is needed if the contextual `word()` is the same function; the builder confirms.
- In the QA walk, a headless check that the scoped words are never written to `localStorage`.

## Risks, ranked

1. **A wrong word on a mixed page, or in a message.** The words machinery assumes one set per request and per page. Every server message built outside a space's route, and every page that lists spaces, must keep the environment's; every one inside must use the space's. A miss is a visible inconsistency ("trip" in a campaign). Mitigation: one context, one helper, and one rule for builders: inside one space, the space's; otherwise the environment's.
2. **Stale phase dates blocking a save.** The contract fixes it, but it is easy to miss in the whole-map save in `space-setup.js`.
3. **The first-paint flash.** Pages paint with the stored environment words, then the space's `look` arrives, so for a space whose words differ the page can show the environment's word for a moment. Mitigation: the space page waits for its `look` before drawing text that names the level. Remembering a last-seen set per space is not in version 1.
4. **The owner's own words beat the space's template** (question 10). The cost is that an owner who set a word of their own sees no change from a space template for that key. The Words panel says so.
5. **Module frames.** A frame loaded before a change keeps its old words until reloaded, because modules print words at load. The same as an environment switch today.
6. **A module that stores a word.** Any bundled module that keeps a level word in its own data keeps the old one after a change. The builder greps `modules/` for it; none is known.
7. **Hosted leakage.** A per-space context lost in a callback that outlives the request (the gotcha in [architecture-environments](../architecture/architecture-environments.md)) could answer for the wrong space. The space context must follow the environment context's rule.
8. **The Lobby reading a space's words by mistake.** The Lobby never has the key.

## Rollback and off switch

- **Off switch:** `settings.spaceTemplates` off makes every space read the environment's template at once, with the keys kept (question 6).
- **One space:** `PATCH /api/spaces/:id { template: null }`.
- **The build:** the key is optional; a build that does not know it drops it at the next save of the space, which is a return to the environment's template. No migration either way.
- **A single-environment install** with no space template set behaves exactly as before, because every path is the old one when no space has the key.

## Not in version 1

- Which modules a space offers (per-space module lists).
- A space's own theme, reactions, icon set, settings or language.
- Words an owner types for one space (per-space overrides of a template's words).
- A template mark on the cards or in the switcher.
- A moderator choosing a template.
- A change of template that offers the new `spaceDefaults` (unless question 5b says so).
- A template for an aside or the Lobby.
- A host-level lock per environment (the owner's off switch is the only lock).

## Overlap with other plans

- **[plan-workspaces](plan-workspaces.md)** (draft; decisions recorded up to 26): fixed workspaces and an owner's per-space default and favorites. It touches `space.js`'s layout and the space record, not words or phases. No conflict. If a template ever carried a default workspace it would add a row to the table above; that is not decided and not assumed.
- **[plan-places-and-maps](plan-places-and-maps.md)** (Places folds into Maps): it changes `modules` in `templates/travel.json` (version 8) and `templates/games.json` (version 2), `tools/template-versions.json`, `check-templates` and `check-template-switch`, the same files step 1 here touches. No design conflict; a merge to order. Its reliance on the environment-wide module list is one more reason `modules` stays out of a space's template.
- **[plan-ai-assistant](plan-ai-assistant.md):** its J3 edits `server/templates.js` (the "retired" template state, around line 372). A merge to order, no design conflict. The AI context builder (`server/ai-context.js`) already takes a `word` function; the builder checks it receives the space context.
- **[plan-home-lobby](plan-home-lobby.md):** steps 5 and 6 (the Lobby's words, Manage's Home row, phones) are not built. They are independent. This plan assumes what that plan decided: Home is the environment's page and the Lobby has no template.
- **[plan-one-bar](plan-one-bar.md)** and **[plan-setup-panel](plan-setup-panel.md)** are built; this plan changes the chip's source and Set up's Space tab. **[plan-demo-space](plan-demo-space.md):** its loader picks a file by template id (question 9).
- Nothing blocks on another plan. The only ordering is a merge order for the template files and `server/templates.js`.

## Left to build, in order

Sizes: S under a day, M a day or two, L several days.

1. **The data and the resolution** (server-development, M; core change, held for an independent read). `space.template`, `lookOf()`, the contextual `word()`, the routes and their refusals, the context route and the guest read, the delete rule and `usedBy`, the phase-date rule, `settings.spaceTemplates`, the checks above.
   - Done when: `npm run check` passes and a space with no key answers what it answers now.
   - Verify: checked by the tool; live with curl on a throwaway `DATA_DIR` and on a second hosted environment.
2. **The words and phases on a space's page** (experience-design, L; core change because the frames' context changes, held for an independent read). The scoped words in `public/words.js`, the Home and space switch, the chip and Set up reading the space's phases, module frames, the guest page, the stale-date save.
   - Done when: `check-names --words` passes and no scoped word reaches `localStorage`.
   - Verify: live in a browser on the two-space setup, at 1280 and 390 px, as owner, member and guest.
3. **The choices** (experience-design, S). The Template choice in Set up's Space tab and in Add, the Manage switch and Words note, the console's "Used by".
   - Verify: live in a browser.
4. **QA** (quality-assurance): the independent read of steps 1 and 2 and the live walk above.
5. **Documentation** (content-manager): see "Doc facts".

## Doc facts

What changes when this lands (content-manager's): [architecture-environments](../architecture/architecture-environments.md) ("Templates": where the live part is resolved, now per space, and the space routes), [architecture-overview](../architecture/architecture-overview.md) ("Words": the second context), [api-modules](../api/api-modules.md) (the context route), [api-module-sdk](../api/api-module-sdk.md) (`host.locale().words` and `host.phases()` are the space's), [userguide-templates](../userguides/userguide-templates.md), [userguide-spaces](../userguides/userguide-spaces.md) (Set up's Template choice), [userguide-environment-settings](../userguides/userguide-environment-settings.md) (the switch and the Words note), a pointer in [plan-environment-templates](plan-environment-templates.md), and `TODO.md`.

## Open questions for Thomas

My suggestion is first in each. "Blocks" means the build waits for the answer.

**1. What a space's template changes. Blocks.**
- **Suggested: words, verbs, phases and module display names and icons, with the space's starting defaults (`opensWith`, `profile`) seeded at creation. Not which modules exist, and not settings, reactions, icons or the theme.** It is everything a person reads plus the shape of the timeline, and it does not reverse plan-layout-views decision 16. A trip and a campaign can sit side by side with no change to the billing plan's module limit.
- Only words and phases: smaller, but a Games space would still show "Itinerary".
- Everything, including which modules: needs per-space module lists and per-space entitlement, which reopens a built decision. Not suggested for version 1.

**2a. Whose words on a page that mixes spaces. Blocks.**
- **Suggested: inside one space, the space's; everywhere else, the environment's.** Home, the switcher, the bell's headings, Manage and the top bar outside a space use the environment's. A notice about one named space uses that space's words.
- The environment's words everywhere, notices included: simplest, but a bell line about a campaign says "trip".
- The space's words in lists too (each card in its own word): a list of mixed nouns reads badly and has no heading word.

**2b. Which keys change inside a space. Blocks the page work.**
- **Suggested: `space`, `aside`, `canvas`, `module`, `object`, `moderator`, `member`, `guest` and the `layout` verb. Not `environment`, `owner`, `home` or the `enter` verb,** which name things above a space.
- Also `owner`: a "game master" in a campaign, an "owner" on a trip. But the owner manages the whole environment from Manage, where one word must read.
- All keys: the people words flip as a person moves, even where the same person is meant.

**3. Who chooses, when, and where. Blocks.**
- **Suggested: owners and the host admin, at creation and any time, in Set up's Space tab and in Add; a moderator reads it but does not choose.** A change alters what everyone in the space reads, and Set up gives moderators phases and settings only (plan-one-bar decision 5).
- Owners and moderators: moderators "manage specific things within a space", but this changes words for everyone.
- At creation only: simpler, with no switch rules, but a wrong choice cannot be fixed.

**4. What happens to phase dates and data when a space's template changes. Blocks step 1.**
- **Suggested: keep the dates on the record, ignore ids the new template lacks, drop them from a save, and keep dates for ids the two templates share.** Changing back loses nothing; module data is never touched.
- Clear the dates on a change (with a confirm): clean, but loses work on a mistaken click.
- Map the main phase's dates onto the new template's main phase: friendlier, but it guesses (a six-step trip to a three-step campaign).

**5a. Asides. Does not block.**
- **Suggested: an aside reads its origin space's words and verbs, falling back to the environment's.** It stays consistent with the button that started it.
- The environment's always: simple, but "whisper" on the button and "aside" in the aside.

**5b. Offering the new template's starting defaults on a change. Does not block.**
- **Suggested: no offer in version 1.** `opensWith` and `profile` seed a new space only; after that they are the owner's.
- Offer them unticked, as the environment switch offers the Lobby: more screens for little.

**5c. Guests. Blocks the guest page work.**
- **Suggested: a link guest reads the link's space's words; a door guest reads the door page in the environment's and the space in its own.** The guest read answers the space's `look`.
- The environment's for every guest: nothing to build, but a guest in a campaign sees "trip".

**6. The default, and an off switch. Does not block; step 1 builds the switch if yes.**
- **Suggested: the environment's template is the default (a space with no key). The owner has one switch, "Let a {space} use its own template", on by default, in Manage > Template.** Off ignores every key and keeps them.
- No switch: fewer settings; the only way back is clearing each space.
- A host-level lock per environment (a plan feature): not asked for, extra console work.

**7. The stored shape. Does not block.**
- **Suggested: `template: "<id>"` on the space, absent means the environment's.** Nothing is "applied", so no record of it. No migration (unreleased).
- A full record like the environment's (`{ id, appliedAt, skipped }`): only needed if question 1 takes modules or settings.

**8. A template mark on space cards and in the switcher. Does not block.**
- **Suggested: none in version 1.** A person sees the template in Set up and in the words.
- A small mark on each card: useful when words are similar, but adds a word to the environment's page.

**9. Demo data for a space. Does not block.**
- **Suggested: the loader takes the space's template id, else the environment's. Built with the demo plan, not this one.**
- Leave the loader on the environment's template: a Games space in a Travel environment loads the travel demo or nothing.

**10. The owner's own words against the space's template. Blocks step 1.**
- **Suggested: the owner's own words and module names win everywhere, and the space's template fills the rest.** This keeps "the owner can change anything" (decision 3 of the environment-templates plan), and the Words panel can say so.
- The space's template beats the owner's environment-wide words: a template would then override an explicit choice.
- Per-space owner words: a larger feature, not in version 1.
