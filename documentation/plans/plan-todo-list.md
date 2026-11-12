# To-do List Plan: a To-do destination, and tasks in the Calendar by choice

**Audience:** Thomas decides. If he approves, server-development builds the destination rule, the setting and the checks, and experience-design builds To-do's main part and its Manage switch. content-manager documents after.

**Status:** Draft, nothing decided (2026-11-12, by product-planner). Nothing is built. GitHub #730. From Thomas, as clickable answers: To-do gets a dedicated list, a real To-do destination like Calendar and Map, **plus** a "show in the calendar" option in To-do's own configuration when Calendar is installed ("some people like lists"). This builds on [plan-calendar-todo](plan-calendar-todo.md), which is partly built (steps 1 to 3), and reverses part of it.

## Why

[plan-calendar-todo](plan-calendar-todo.md) made To-do a panel of the Calendar and, with Calendar on, hides To-do's own canvas and page. Thomas said "There is no 'todo' without calendar, right?" on 2026-11-12 in the workspaces thread, then asked for a dedicated list because some people prefer lists. The two requests meet in one rule: To-do is a destination of its own, and whether it also appears in the Calendar is To-do's own choice.

**Goal.** A To-do entry in the top bar's middle zone (and a layout tab), a page that is only the list, and an option inside To-do to show the list also as the Calendar's panel. **Non-goals.** New task fields; a change to Calendar's markers; a mobile redesign; per-space destinations beyond what Calendar and Map already do.

## What exists

Checked in the code on 2026-11-12 (`80ecd84e`); the spike's facts held unless a correction is given.

- **To-do** (`modules/todo`, 1.15.29): scopes `environment` and `space`. Surfaces: destination part `{ id: 'calendar', part: 'panel', label: 'To-do', order: 20 }`, a page (the nav entry is on unless `nav: false`; it is not set here), a canvas 380 by 540, and a widget "Due soon". Permissions `view` and `edit`; hooks `schedule` and `notify`; actions `createTask`, `linkTask`, `setTaskDue` and the local `addTask`; command `/t`; kind `task`. It has **no `settings` array**.
- **Destinations are a fixed host list** (`server/destinations.js`): `calendar` (setting `showCalendar`, path `/calendar`) and `map` (`showMap`, `/map`, `needsFile`). A module takes part only by declaring a part for an id in that list; `cleanDestinationParts` (`server/modules.js`, near 819 to 839) allows one `main` and one `panel` per destination, and the environment scope is required. The nav reads `GET /api/destinations` (`public/primary-nav.js` `destinationTools`, `public/brand.js` `loadDestinations`).
- **The page side** keeps its own list: `public/composites.js` has `dest:calendar` with parts `['calendar', 'todo']` and `main: 'calendar'`.
- **`showCalendar`** is named in 15 files (the spike said about 11): `server/store.js`, `server/index.js`, `server/templates.js`, `server/destinations.js`, `public/module-config.js`, both templates, `architecture-environments.md` and six tools files. The build finds them with a search.
- **Panel parts are static manifest data.** `panelsOf` filters only on enabled and readable. Module `settings` (`showWhen`, `defaultIfSet`) shape the settings form only. So "also show as the Calendar's panel" **has no mechanism today**; it is new.

## Decisions

Only what Thomas decided (2026-11-12):

1. **To-do gets a dedicated list: a To-do destination of its own, like Calendar and Map.** Reason: some people like lists.
2. **To-do has an option, in its own configuration, to show in the Calendar when Calendar is installed.** Reason: the same.

Everything below is the planner's, for Thomas to decide.

## The contract (on the leaning options)

**Server half (server-development)**

- `server/destinations.js`: add `{ id: 'todo', setting: 'showTodo', path: '/todo' }` after `calendar`. `needsFile` is not set. Nothing else in the file names a module.
- `server/modules.js` `cleanDestinationParts`: `todo` becomes an allowed id automatically (`DESTINATION_IDS`). To-do's manifest gains `{ id: 'todo', part: 'main', entry: 'page.html' }`.
- The environment option `showTodo`: in `server/store.js` (the settings and their default), `server/index.js` (the owner's settings route, near 11642), `server/templates.js` and both templates (travel on, games its choice), `public/module-config.js` (the Manage switch, where `showCalendar` is). `check-destinations` and `check-templates` change, and the template versions in `tools/template-versions.json` rise.
- **The option "show in the Calendar" (new mechanism).** See question 2 for the three ways. In the leaning one, the panel part in To-do's manifest gets one optional field naming a module setting (`"panelWhen": "showInCalendar"`), To-do gets a first `settings` entry (a boolean, environment scope, default on), and `panelsOf` is handed the environment's module settings and drops a panel whose named setting is off. The field is generic, so nothing in `destinations.js` names To-do.
- A save of that setting must reach the pages (the destination hub already refetches on change; the build confirms).

**Pages half (experience-design)**

- `public/composites.js`: a `dest:todo` composite with `main: 'todo'` and `parts: ['todo']`, or none if a one-part destination needs no composite (the build checks what the Layout tab needs).
- To-do's page is the full list at `/todo`; the destination page mounts it as main. Its Add, Filters and status line stay as the panel has them.
- The Calendar: while `showInCalendar` is on, its panel shows as it does now; while off, Calendar draws only its dated objects and markers (task due dates still appear as markers if kind `task` is `dated`; the build confirms this and says so in its report).
- **Reverses plan-calendar-todo's rule** "with Calendar on, To-do's own canvas and page are not offered; `opensWith` and saved layouts open the combined Calendar". With a dedicated list, To-do's page and canvas are offered again; a saved layout that names `todo` opens the list; `opensWith` stays as it is for the Calendar.
- The nav: a To-do entry in the top bar's middle zone and a layout tab, with the existing icon and the template's word if it has one.

## Left to build, in order

1. **The destination and its option** (server-development, M). `DESTINATIONS`, `showTodo` through store, route, templates and Manage; `check-destinations`, `check-templates`, `check-template-switch`, `check-module-config`. Ships alone: the option is off in existing installs, so nothing changes for a person.
2. **To-do's main part and the page** (experience-design, M). The manifest part, the `composites.js` entry, the nav and layout tab, To-do 1.16.0 (bump per CLAUDE.md). The Calendar-on hiding rule is removed. Needs step 1.
3. **"Show in the Calendar"** (server-development S, then experience-design S). The manifest field, `panelsOf` reading it, the setting and its default; the Calendar redraws when it changes. Model tier: sonnet. This is the only new mechanism and touches the core (`server/`, `public/sdk/`-adjacent rules), so it gets the independent read.
4. **Documentation** (content-manager, S). The To-do guide, the architecture of destinations, plan-calendar-todo's status. Production builds only.

All steps are sonnet; none is security.

## Verify

- **Checked by tool:** `check-destinations` (the third destination; a panel hidden when its setting is off), `check-templates`, `check-template-switch`, `check-module-config`, `check-names`, `check-module-versions`, To-do's own tests.
- **Live in headless Chromium:** the To-do nav entry and `/todo`; a saved layout that names `todo`; the Calendar with the option on and off; `/t` from Chat in each state; a template that leaves Calendar off while To-do is on.
- **Not verifiable here:** nothing needs LiveKit. A phone is only read as code.

## Risks

- **Two homes for one list.** With the option on, the same list is in the Calendar and at `/todo`; two mounts of one module in one session is the risk the Map plan also names. Test that a change in one shows in the other.
- **Template and nav crowding.** A third destination uses room in the top bar's middle zone on narrow windows.
- **Reversing a built rule.** Calendar-on layouts made since step 3 that name the combined Calendar keep working; ones that name `todo` change meaning (they open the list, not the Calendar).
- **The new field** is core: a wrong read could hide a panel for everyone, so it has a test for off, on and absent.

## Questions for Thomas

1. **Does To-do's destination replace the `calendar` panel, or exist beside it?**
   - Both: a `main` for `todo` and the `calendar` panel stays, shown by the option (recommended; it is what you asked for)
   - The destination only, and the Calendar shows tasks only as dated markers (drops the option)
2. **How does "show in the Calendar" work?**
   - A generic field on the panel part names a module setting, and `panelsOf` reads it (recommended; small, and no module is named in the host)
   - A host-level environment option `showTodoInCalendar` beside `showCalendar` (simple, but the host then knows To-do)
   - To-do hides its own panel from inside the page (the Calendar still reserves the space and shows an empty panel)
3. **Where does that option live and what is its default?**
   - To-do's own Manage config, environment scope, on by default so nothing changes (recommended)
   - Off by default, so the Calendar starts without the list
   - Per space, so one space can differ (more work; needs the setting at space scope)
4. **Does `showTodo` start on?**
   - On for every template where To-do is on (recommended)
   - Off until an owner turns it on in Manage
5. **Are To-do's own canvas and page offered again with Calendar on?**
   - Yes, reversing plan-calendar-todo's rule (recommended; the list is a destination now)
   - No, the canvas stays hidden and only the destination page is offered
6. **What does the tab and the nav entry read?**
   - **To-do** with the existing icon, themed by the template if it has a word (recommended)
   - **Tasks**
   - Thomas names it
