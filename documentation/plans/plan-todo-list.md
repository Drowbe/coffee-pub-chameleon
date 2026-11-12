# To-do List Plan: a dedicated To-do, with an optional place in the Calendar

**Audience:** Thomas decides the open questions at the end. If he approves, server-development builds the host's side
(the destination, the setting, the panel rule, the templates and the checks) and experience-design builds To-do's side
(the main part, its settings and the pages). content-manager documents after.

**Status:** Draft for Thomas, 2026-11-12, by product-planner. Nothing is built or decided except Thomas's words below.
Thomas answered the planning question on 2026-11-12: a real To-do destination, plus a "show in the calendar" module
setting that decides the Calendar's panel.

## The brief

Thomas, 2026-11-12:

> "We need to put back the ability for the user to have a dedicated todo list. Inside of the todo config we should have "show in the calendar" if the calendar module is installed. Some people like lists."

Earlier, 2026-11-12, in the workspaces thread: "There is no "todo" without calendar, right? It is part of calendars now."
That is how it is built today; this plan reverses it for people who want a list alone. Related, not designed here:
[plan-workspaces](plan-workspaces.md) lists a fixed set of layouts (Workspace, Conference, Calendar, Map, Whiteboards,
Documents) and says a returning To-do is one more row with the id `todo`.

## Why

Since [plan-calendar-todo](plan-calendar-todo.md) the To-do has no page or canvas of its own where the Calendar is on: its
list is a panel inside the Calendar. Some people want a list with no calendar around it. They should have one, and
people who use both should choose whether the list also sits in the Calendar.

## Names

Module: To-do (`todo`). Its objects are tasks (kind `task`, an object). The new place is the **To-do** destination
(`todo`), shown in the top bar and as a layout like Calendar and Map. The Calendar is `calendar`. No "room", "table",
"stage", "pane" or "item"; say "task", not "item".

## What it is today

Read as code on 2026-11-12 (the spike; I re-checked `server/destinations.js` and `server/modules.js` myself).

- **To-do 1.15.29** (`modules/todo`): scope environment and space. Surfaces: a destination panel
  `{ id: "calendar", part: "panel", label: "To-do", order: 20 }`, a page (nav default true), a canvas 380x540 that docks
  and floats, a widget "Due soon" (small, order 20). Permissions `view`, `edit`. Hooks `schedule`, `notify`. Subscribes to
  `*`. Actions `createTask`, `linkTask`, `setTaskDue`, and the local `addTask`. The command `/t`. Kind `task` (dated,
  marker). **No `settings` array**, so it has no config. Tasks are `task:<id>` at environment and space scope.
- **The destinations are a hard-coded host list** in `server/destinations.js` (103 lines): `calendar` (setting
  `showCalendar`, path `/calendar`) and `map` (`showMap`, `/map`, needs a file). Modules only declare parts. `partOf`,
  `mainOf` and `panelsOf` read `manifest.surfaces.destination`; panels sort by `order` then module id. In
  `server/modules.js` `cleanDestinationParts` (about 819 to 839) allows only ids in the host's list, at most two parts, one
  main and one panel per destination, and requires environment scope.
- **The page side:** `public/composites.js` has `dest:calendar` with parts `['calendar', 'todo']` and main `calendar`.
  `public/destination.js` (788 lines) draws the page and mounts the parts from `GET /api/destinations/<dest>`. The top bar
  entries come from `GET /api/destinations` (`primary-nav.js`, `brand.js`) as `dest-<id>` with the main module's name and
  icon.
- **`showCalendar`** appears in 15 files: `store.js` 2, `destinations.js` 1, `templates.js` 1 (`showCalendar: bool`,
  line 85), `index.js` 2, `public/module-config.js` 1, `check-destinations` 11, `check-templates` 3, `check-feed` 2, and
  five more tools with 1 each.
- **Settings types** (`SETTING_TYPES`, `modules.js` 614): boolean, choice, number, text, url, file, files, list, color,
  note. `showWhen` takes `{ key, value }` or `{ key, not }` and **only names another setting of the same module**.
- **There is no way today** for a module setting to decide whether a panel part appears. Panel parts are static manifest
  data; `panelsOf` filters only on enabled and readable.

## What changes for a person

- **A To-do destination.** When the owner turns it on, a **To-do** entry joins the top bar like Calendar and Map and opens
  `/todo`: the task list as a page. It is also a layout (see "Workspaces").
- **A setting in To-do's config: "Show in the Calendar".** On means the list is also the Calendar's panel, as now. Off means
  the Calendar has no To-do panel (tasks still show as markers on the days, since that is the Calendar reading the `task`
  kind, not the panel). The setting is shown only when the Calendar module is installed.
- **Calendar off or missing:** the To-do stands alone as page, canvas and widget, as it does today where the Calendar is off.

## Decisions

Thomas decided the shape (2026-11-12): a real destination, a Manage switch like Calendar and Map, a composite entry, and
the "show in the calendar" setting. The mechanism for that setting, and every default below, is open.

## The contract

### Server half (server-development)

- `server/destinations.js`: add `{ id: 'todo', setting: 'showTodo', path: '/todo' }` to `DESTINATIONS`. `cleanDestinationParts`
  allows the id automatically because it reads the list.
- `server/store.js`: the environment setting `showTodo` next to `showCalendar` and `showMap`; `server/index.js`
  `ownerSettings` (about line 11642) accepts it; `server/templates.js` carries `showTodo: bool` and each template file sets
  its default (see "Templates").
- The `/todo` page route serves `public/destination.html`, which is generic; the page reads `GET /api/destinations/todo`.
- `GET /api/destinations` lists `todo` with the main module's name and icon when `showTodo` is on and the module is on and
  readable for the person.
- The panel rule (see the options below).

### Pages half (experience-design)

- `modules/todo/module.json` gains a `main` part: `{ id: "todo", part: "main", entry: ... }`, and keeps its
  `calendar` panel (a module may hold a main and a panel for different ids; one main per destination). It then holds two
  parts, which is the limit.
- `todo.js` reads `info.context.destination.part` (as `calendar.js` does at line 30) and draws the full list when it is
  `main` and the compact panel when it is `panel`.
- `public/module-config.js`: the Manage switch **To-do** next to Calendar and Map (same pattern as `showCalendar`).
- `public/composites.js`: a `dest:todo` entry `{ id: 'dest:todo', dest: 'todo', path: '/todo', main: 'todo', parts: ['todo'] }`.
  The existing `dest:calendar` entry keeps its parts; whether `todo` stays in its list is decided by the setting below.
- `public/opens-with.js` and `layouts.js`: `todo` maps to `dest:todo` when the destination is on, and to `dest:calendar`
  only while the setting puts the list into the Calendar (the open question on that mapping).
- Nav icon: the To-do module's own icon. The builder picks one that exists in the icon set; no new colours.

## The "show in the Calendar" setting: options

The setting is To-do's first. Its job is to decide whether the Calendar's panel appears. There is no mechanism today.

**Option A. A flag on the panel part naming a module setting (suggested).** The manifest part reads
`{ id: "calendar", part: "panel", showWhenSetting: "inCalendar" }`. `panelsOf` reads that module's environment settings
and drops the part when the value is false. `cleanDestinationParts` checks the name is a boolean setting of the same
manifest. Cost: S to M; one rule in the host, usable by any module later. Rules out: nothing. Weakness: `panelsOf` now
needs settings, which it does not read today.

**Option B. A host rule.** The host knows the setting name `calendarPanel` for any module with a Calendar panel and
reads it. Cost: S. Rules out: a module cannot name its own setting; it is a special case, which the module system avoids.

**Option C. No filter; hide the panel in the page.** The panel is always declared; `destination.js` reads the setting
through the SDK and hides it. Cost: S, but the server still lists the part, so the Show list, feeds and `check-destinations`
disagree with the screen. Not suggested.

**Where it is stored (A and B).** In To-do's environment settings, `DATA_DIR/modules/todo/` through the usual settings
store (a boolean setting `inCalendar`, default true so the list stays in the Calendar as it is now). Not a host setting,
because it is To-do's choice.

**"Only shown when Calendar is installed".** `showWhen` cannot express this: it names only a setting of the same module.
Options: (1) a new `showWhen` form `{ module: "calendar", enabled: true }` handled by the settings form (the module's
server answer already knows the registry); (2) a manifest field `settings[].needsModule: "calendar"`, which the form and
the module-config route read; (3) always show it and add a help line "Needs the Calendar". I suggest (2): it says what
it means, and the form's route already knows which modules are installed. This is a small new thing in
`cleanSettings` and `public/module-config.js`.

## What the stand-alone canvas, page and widget do

- **Calendar on, setting on (default):** To-do is the Calendar's panel. Its own canvas and page open the combined
  Calendar, as now. The `/todo` destination, if turned on, shows the list alone as well. Both can be on.
- **Calendar on, setting off:** the Calendar has no To-do panel. To-do's own canvas and page stay offered (no longer
  redirected to the Calendar), plus `/todo` if on. Markers for dated tasks still show on the Calendar.
- **Calendar off or not installed:** the setting is hidden and counts as off. To-do stands alone, as today.
- **The widget "Due soon"** is unchanged in all three.
- **The `/t` command:** `addTask` is local and needs an open To-do page. With the destination, the `/todo` page counts; the
  builder checks that `/t` still works with only the Calendar open (as `plan-calendar-todo` step 3 left it) and, if not,
  points `commands[].action` at `createTask`.

## Workspaces

[plan-workspaces](plan-workspaces.md) has a fixed set and says a To-do row would be one more row with the id `todo`,
listed only while the module is on. This plan fits that: `todo` is a layout id of the code list; the layout opens the
composite `dest:todo`. The Calendar layout shows task entries when the setting is on, and the markers always. Nothing
here edits that plan; its owner picks the final order.

## Roles and permissions

`view` and `edit` stay. The `todo` destination is listed only to those who may `view` To-do. Guests with view see the list
and cannot edit, as in the module now. Manage switches are the owner's, like Calendar and Map.

## Templates

Each environment template sets `showTodo`. Suggested defaults (a decision for Thomas): travel and games off (the list is
in the Calendar), a plain Workspace template on if it has no Calendar. Each template file's version rises
(`tools/template-versions.json`); existing environments keep what they chose, since changing a template does not reset
an owner's choice (as today).

## Phones

The To-do page is one column, the list on top and "+" in the toolbar; the destination page already collapses on phones.
Targets stay 44 px. In the Calendar the panel stays under the grid on a phone as now.

## Accessibility

Ticking a task is a checkbox with the task's name; the switch for Manage has a label; the setting's help line says
"The list also appears in the Calendar's side panel." The Calendar-needs-line is text, not colour.

## What changes in code, by job

| Job | Who | Files | Size |
|---|---|---|---|
| J1 Destination | server-development | `destinations.js`, `store.js`, `index.js`, `templates.js`, `templates/*.json`, `template-versions.json` | S |
| J2 Manage switch and nav | experience-design | `module-config.js`, `primary-nav.js`, `brand.js` (read only if no change), `composites.js` | S |
| J3 To-do main part and settings | experience-design | `modules/todo/module.json`, `todo.js`, `todo.html`, `page.html` | M |
| J4 The panel rule | server-development | `modules.js` (`cleanDestinationParts`, `cleanSettings`), `destinations.js` (`panelsOf`) | M |
| J5 Layouts and Show list | experience-design | `opens-with.js`, `layouts.js`, `canvas.js` read | S |
| J6 Checks | server-development | `check-destinations`, `check-templates`, `check-feed`, `check-layouts`, `check-canvas`, `check-module-versions` | S |
| J7 Docs | content-manager | guides, architecture | S |

## Build order

1. **J1** (server only). Check: `check-destinations` (new cases for `todo`: 404 or empty when off), `check-templates`.
   Live with `curl` on a throwaway server (`PORT=`, `DATA_DIR=/tmp/<name>`).
2. **J4** (the panel rule, server). Check with a test manifest; `check-destinations`, `check-modules`.
3. **J3** (To-do's parts and settings). Live in headless Chromium at `/todo`; the setting toggled; the Calendar's panel
   present and absent.
4. **J2** and **J5** (nav, switch, composite, layouts). Live: the top bar entry, the Manage switch, a saved layout that
   names `todo`.
5. **J6**, then `npm run check`; **J7** on production builds only.

## Verify

- **Checked by a tool:** `check-destinations`, `check-templates`, `check-feed`, `check-modules`, `check-layouts`,
  `check-canvas`, `check-module-versions`, `check-one-input` (for `/t`), `check-names`, `check-docs`.
- **Live in headless Chromium:** the three Calendar states, the page at 1280 px and at a phone width, the Manage switch
  saved and read back.
- **Only Thomas:** the feel on a real phone; a real Google subscription still showing task markers (task markers use the
  feed; the feed is not changed).
- No LiveKit call is involved.

## Risks, ranked

1. **J4 changes how panels are chosen** for every destination; a mistake could hide the Calendar's Agenda. Cover with
   cases in `check-destinations`.
2. **Two ways to reach the list** (Calendar panel and `/todo`) may confuse; the words in Manage must say which is which.
3. **The `/t` command** may lose its target; see above.
4. **Templates:** a changed default does not reach environments that already exist; this is by design but must be said.
5. **Names:** `todo` the module and `todo` the destination share a word; a lookup that confuses them (as `dest:map`
   and `maps` already can) is the likely bug.

## Not in v1

Several lists, lists per person, sharing a list, drag between lists, a To-do that works with no Calendar installed beyond
what it does now, Google or other sync of tasks, any redesign of the Calendar page, anything in
[plan-workspaces](plan-workspaces.md).

## Doc facts

New: setting `showTodo`; path `/todo`; destination `todo`; setting `inCalendar` (name suggested) of To-do. Words a person
reads: "To-do", "Show in the Calendar", "Needs the Calendar". Names in code: `todo`, `task`, `dest:todo`.

## Open questions for Thomas

Nothing here is decided.

1. **The mechanism for the setting.** (a) A flag on the panel part naming the module's setting (suggested). (b) A host
   rule with a fixed setting name. (c) Hide the panel in the page only.
2. **"Only when the Calendar is installed".** (a) A `needsModule` field on the setting (suggested). (b) A new `showWhen`
   form naming a module. (c) Always show it, with a help line.
3. **The default.** (a) On, so the list stays in the Calendar as it is now (suggested). (b) Off, so a new install gets a
   plain list.
4. **The `/todo` destination in new environments.** (a) Off for travel and games, on for others (suggested). (b) Off
   everywhere until an owner turns it on. (c) On everywhere.
5. **A saved layout that names `todo` while the setting is on.** (a) Opens the Calendar, as now (suggested). (b) Opens
   `dest:todo`, the list alone.
