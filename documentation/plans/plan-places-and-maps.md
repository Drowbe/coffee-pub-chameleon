# Places and Maps Plan: Places folds into Maps

**Audience:** Thomas decides the open questions at the end. If he approves, server-development builds the host's side
(the checks, the templates, the stored keys, the seed) and experience-design builds Maps' side (the merged manifest, the
list view, the picker). content-manager merges the user guides after.

**Status:** Draft for Thomas, updated 2026-11-12: Places folds into Maps. Nothing is built. The first draft (2026-10-30,
"one module or two", from #374) is kept below under "Earlier draft, kept as history"; its recommendation (keep the id
`places`) is replaced by Thomas's words below.

## The brief

Thomas, 2026-11-12:

> "We need to officially retire "places" as a dedicated module and roll it into "Maps". The idea of a place without a map can be a thing, but it doesn't need to exist as its own module."

So: one module, `maps`, named Maps. `modules/places` is deleted. A place that has no position still exists; Maps lists it.
Related, not designed here: [plan-workspaces](plan-workspaces.md) keeps the Map layout as Maps, and says `map` does not
change if Places retires.

## Why

Two modules for one thing on screen costs people two switches, two Roles rows, two settings pages, and the five timed
local actions between them. The Map destination already shows one search, one Filters button and one "+". The CLAUDE.md
rule of 2026-10-21 (no compatibility layers, renames allowed, test data may be reset) removes the reason the first draft
kept the id `places`.

## Names

Module: Maps (`maps`). The thing it holds: a place (kind `place`), an object. The list of places without a position is
the **List** view; the drawn one is the **Map** view. The Map destination (`map`) and Map layout stay. No "room",
"table", "stage", "pane" or "item".

## What Places is today

Read as code on 2026-11-12 (the spike, `documentation/plans/` and `modules/*/module.json`). Counts are by module id or
the `place` kind, because "place" is also an ordinary word.

- **Places 0.12.22** (`modules/places`): scope environment, space and person. A destination panel in `map`; a page
  (`nav: false`); a canvas 460x600 that docks and floats; permissions `view` and `edit`. Actions `addPlace`,
  `setPlacePoint`, and the local `sharePlace`, `searchPlaces`, `positionPicked`, `categoryColors`, `mayAdd`, `newPlace`.
  Refs: produces kind `place` (key `place:{id}`, open and backlinks), consumes `*`. A `geocoder` block (provider
  `searchProvider`, address `search`, save `saveResults`, custom `custom`, providers `photon`). Four environment settings:
  `categories` (list of 11; `other` cannot be removed), `searchProvider` (none, photon, custom), `search` (an address,
  shown when custom), `saveResults` (boolean). No hooks, no uploads.
- **Maps 0.9.15** (`modules/maps`): `requires: ["places"]` (manifest line 126). Destination `map`, part `main`.
  Provides `pickPoint` and `showOnMap`. It finds Places' actions by name (`maps.js` 220 to 262: `newPlace`,
  `searchPlaces`, `positionPicked`, `mayAdd`, `categoryColors`) and reads place summaries from the shared object feed
  (`maps.js` 92), not from Places' storage. Its `searchNote` setting only points at "whichever module offers a place
  search". Its own settings: `map`, `imageMap`, `worldSource`, `searchNote`, `regionSource` and `pictureMap`.
- **Storage.** `place:<id>` sits in one home (space, person or environment). Per-person bookmarks `saved:e:<id>` and
  `saved:s:<spaceId>:<id>` hold `{ ref, title }`. The environment's geocode cache is
  `modules/places/geocode.json` (`server/geocode.js`; `server/environment-export.js` 130 has a pattern for it). The
  person-scope data is a person's private places and their bookmarks, the same in every space.
- **A place without a map already works at the data level:** a place may have no point, and Maps draws only those with
  one. What is missing is the screen that lists them once Places' own window is gone.
- **Who else names Places** (filtered): `travel.js` once as `host.objects.pick({ modules: ['places'], kinds: ['place'] })`
  (line 2378) and three times looks up `addPlace` by action name (1881, 2348); `maps.js` twice by name. Vault, Budget,
  Calendar, Polls, Research, Stream and Assistant: none.
- **Server:** `geocode.js` 1; `index.js` 4 (the geocode route found by `geocoder` in manifests, generic, about line
  9875; a host-level "Add a region" search at 2900; icon, visit and colour checks at 7779 to 7785; an admin route that
  counts and removes saved places at 9993). `destinations.js` names no module. `templates.js` and `environment.js` have no
  Places word. `old-links.js` 2 lines. `migrate-names.js` 12 hits; `check-names-allow.json` 4 lines. The kind `place` is
  used generically elsewhere (`object-format`, `ai-context`, `ai-tools`, `store`, `modules.js`, `live.js`), mostly as the
  English word or a `place` field in a summary.
- **Public:** `public/composites.js` 19 hardcodes `{ id: 'dest:map', dest: 'map', path: '/map', main: 'maps', parts: ['maps', 'places'], ask: true }`
  (the only page-side join). `opens-with.js` 23 and `layouts.js` 38 carry `{ maps: 'dest:map', places: 'dest:map' }`. One
  line in `chat-input.js`; a doc example in `sdk/host.js` 2965.

Re-checked by me in code: the composites line and the `requires` line match the spike. Everything else is the spike read
as code only; nothing was run.

## The pointer problem

Other modules hold pointers `{ module: 'places', kind: 'place', id, scope, space? }`: Travel's stops, links, bookmarks and
Vault links. When `modules/places` is deleted, these stop resolving. Actions also name `ref:places:place`.

**Option 1. Rename and reset (the clean option).** The owner of kind `place` becomes `maps`. Pointers are written as
`{ module: 'maps', kind: 'place', ... }`; `ref:maps:place` in actions. Existing test pointers stop resolving and test data
is reset. This is exactly what CLAUDE.md says to do while the product is unreleased. Cost: S in code; every test
environment must be reset (seed-demo does it). Rules out: nothing. Suggestion: this one.

**Option 2. Re-mint pointers once with a script.** A one-off tool rewrites `module: 'places'` to `maps` in the stored
links. This is a data migration, which CLAUDE.md forbids; it would need Thomas to say so. Cost: M. Not recommended.

**Option 3. Keep the kind id `place`, make `maps` its owner, and alias `places` to `maps`.** Old pointers keep working.
This is a compatibility layer and an alias, which CLAUDE.md forbids until release. It is listed only because the first
draft's reasoning ("no link moves") pointed here. It is **not allowed unless Thomas says so**; if he does, the alias lives
in `server/module-links.js` and is removed at release.

Whichever is chosen, the key `place:{id}` and the kind name `place` do not change; only the owning module id does.

## What moves into Maps

Maps 0.10.0 (the version is the builder's call) takes Places' manifest and source:

- **Refs:** produces kind `place` (key `place:{id}`, open, backlinks), consumes `*`.
- **Actions:** `addPlace`, `setPlacePoint`, `sharePlace`. `searchPlaces`, `positionPicked`, `categoryColors`, `mayAdd`,
  `newPlace` and `pickPoint` stop being bus actions and become plain calls inside the module. `showOnMap` stays.
  The few-second `page` and `pageUntil` windows go.
- **Geocoder block** and the four settings (`categories`, `searchProvider`, `search`, `saveResults`). The `searchNote`
  setting goes (there is nothing else to point to). The `geocoder` block is found by manifest, so
  `server/index.js` needs no change except the path below.
- **Scope:** Maps becomes environment, space and person. The `requires: ["places"]` line goes.
- **Permissions:** both have `view` and `edit` with the same defaults. Maps' `edit` gets Places' words (add, change and
  delete a place) plus "put an object on the map". Roles' stored choices for `places` are dropped.
- **Data:** the stored keys move from module id `places` to `maps`: the `place:<id>` homes, `saved:e:` and `saved:s:`
  bookmarks, and `modules/maps/geocode.json`. No migration (CLAUDE.md); test data is reset. `environment-export.js` 130
  gets the new path.
- **Dropped:** the Places page, canvas, destination panel and its manifest; `modules/places` (its `src/CONTRACT.md` and
  `design/` fold into Maps' contract where still true).

## The List view

Where: the module's own view switch (`host.ui.viewSwitch`), **List | Map**, in Maps' toolbar, as the first draft proposed.
The List shows every place the person may see, whether it has a position or not, with the same filter field, the
**Category** chips and the page's Mine, this space and environment group in Filters. One "+" (**Add a place**). Wide, the
Map view may keep the list beside the map as the destination does now (the old question 4); that is an open question
below. The shared pieces are `host.ui.viewSwitch`, `host.toolbar.set` and `host.menu.show`; no new pieces. Colours come
from the theme tokens. Without a map file or a picture map there is no switch: it is a list, and the map libraries
(MapLibre, about 1 MB inlined) are not loaded until the Map view first opens. A place with no position shows a small
"not on the map" mark and **Place on the map** in its menu, which starts `pickPoint`.

## Travel's picker

`travel.js` 2378 becomes `host.objects.pick({ modules: ['maps'], kinds: ['place'] })`. The three `addPlace` lookups by
action name keep working because the action keeps its name and moves to Maps; the builder checks they find it
(`check-travel`). The doc example at `sdk/host.js` 2965 changes to `modules: ['maps']`.

## The Map destination, composites and layouts

- **Destination:** Maps is `main`; the Places panel goes with the module. `server/destinations.js` needs nothing. The
  Map page has one part.
- **`public/composites.js`:** the `dest:map` entry becomes `{ id: 'dest:map', dest: 'map', path: '/map', main: 'maps', parts: ['maps'], ... }`.
  With one part it may stay a composite (the frame, the Show list entry and the layout tab already read it) or be
  dropped for the module itself; I suggest it stays this build, to touch less (question below).
- **`opens-with.js` 23 and `layouts.js` 38:** the `places: 'dest:map'` alias goes. Saved layouts and `opensWith` lists
  that name `places` die with the test data (CLAUDE.md).
- **The Map layout tab and Global Map** are unchanged for a person.

## Templates and the host

Travel (`templates/travel.json`, version 7): `places` removed from `modules`, version 8. Games (version 1): Places and Maps
were off but offered; it offers only Maps, version 2. `tools/template-versions.json` follows. `tools/module-versions.json`
loses `places` (line 22) and bumps `maps`.

## The tools and the checks

About 40 check files name Places (spike counts, read as code). The builder moves `check-places` into `check-maps` and
changes the rest by search for `places` in the module-id sense. Largest: `check-places` 27, `check-stacking` 25,
`check-geocode` 18, `check-host-registry` 15, `check-canvas` 12, `check-templates` 12. Under 10: `check-modules` 8,
`check-prompts` 7, `check-picture-map` 6, `check-drop` 5, `check-layouts` 5, `check-sdk-pick` 5, `check-template-switch` 5,
`check-maps` 3, `check-catalog` 3, `check-travel` 2, and about 25 others with 1 to 4. Tools: `seed-demo.mjs` 5
(`MODULE_IDS` includes `places` and it sets Places' `searchProvider`), `shots-seed.mjs` 3, `shots-screens.json` 10,
`vendored-scope.json`. Allow-lists, one line each: `check-module-layout-allow`, `check-no-raw-colours-allow`,
`check-spacing-allow`. `check-names-allow.json` 4 Places lines go or change; `migrate-names.js` is not extended.

## The user guides

Merge `userguide-places.md` into `userguide-maps.md` (content-manager). Edit the other 13 that mention Places: accounts,
calendar, call, chat, environment-settings, getting-started, modules, planner, spaces, templates, themes, vault,
whiteboard. Architecture and API documents, `plan-map-places`, `plan-places-library` and the other plans that mention
places get a status line pointing here; about 50 plans mention places, and only status lines change.

## Build order

Small jobs; each leaves the app working. J1 and J2 may be done in either order but not together.

1. **J1. Merge the manifest and source** (experience-design, L but split in two sittings): Maps takes the refs,
   actions, geocoder, four settings and scope; the by-name lookups become calls; `searchNote` and `requires` go. Check:
   `check-maps`, `check-modules`, `check-geocode`; live that the Map still draws and a place saves.
2. **J2. The List view** (experience-design, M): the switch, the list, Filters, the lazy map libraries. Live in headless
   Chromium without WebGL: the list, a place with no position, the switch absent without a map file, MapLibre not in
   the network list for a list-only window.
3. **J3. Remove `modules/places`; destination, composite, alias line** (experience-design, S): `composites.js`,
   `opens-with.js`, `layouts.js`, Travel's picker. Check: `check-canvas`, `check-layouts`, `check-sdk-pick`,
   `check-travel`, `check-stacking`.
4. **J4. Server and tools** (server-development, M): `environment-export.js`, the geocode path, `module-versions`,
   templates (travel 8, games 2), `seed-demo`, `shots-*`, allow-lists. Check: `check-templates`, `check-template-switch`,
   `check-host-registry`, `check-names`.
5. **J5. The checks** (server-development, M, can run in parallel with J4 in a separate worktree): the 40 files, in
   three batches (largest six; the middle ten; the rest). `npm run check` whole.
6. **J6. Documentation** (content-manager, M; production builds only): the guides, architecture, API, plan statuses.

## Verify

- **Checked by a tool:** `check-maps` (with Places' cases moved in), `check-geocode`, `check-picture-map`,
  `check-region-cut`, `check-links` (the pointers use `maps`), `check-drop`, `check-canvas`, `check-layouts`,
  `check-templates`, `check-names`, `check-docs`.
- **Live, headless Chromium, no WebGL:** as J2 and J3, plus the Planner's **Save it as a place**, Travel's picker, and a
  link to a place opening from Chat.
- **Only in a real browser with WebGL (Thomas):** the map from real tiles, the picture map, pin colours, picking a spot,
  a dropped object getting a position, real Photon search, a phone.
- No LiveKit call is involved.

## Risks, ranked

1. **The map cannot be seen here.** All behaviour moved in J1 is read as code until Thomas looks in a real browser.
2. **J1 is large.** About 2,800 lines of script meet; build it alone.
3. **Test data is lost** (pointers, bookmarks, saved layouts). Accepted by the rule of 2026-10-21; reset and re-seed.
4. **Forty check files** edited by many hands may hide a missed pin; `npm run check` whole is the gate.
5. **Load size** if the map libraries are not lazy.

## Phones and accessibility

The List is the phone's default view (a narrow window has no side-by-side map). The switch and "+" are real buttons with
names; list rows are focusable and open on Enter; the not-on-the-map mark has text, not colour alone.

## Not in scope

A battle map (grid, tokens), routes and lines between stops, **By day** in #44, a themed name for the games template, and
anything in [plan-workspaces](plan-workspaces.md). #44 **On the plan** (a Filters group from backlinks) may follow as its own job.

## Doc facts

Maps' contract absorbs Places'. Words a person reads: "Maps", "List", "Map", "Add a place", "Place on the map". Module ids
`maps`; kind `place`; keys `place:{id}`; action names unchanged.

## Open questions for Thomas

Nothing here is decided.

1. **The pointers.** (a) Rename and let test data reset (suggested). (b) Rewrite stored pointers once with a script (a
   migration; you would have to allow it). (c) Alias `places` to `maps` until release (a compatibility layer; you would
   have to allow it).
2. **The wide Map view.** (a) List beside the map when wide, one mount (suggested). (b) The map alone, with the switch
   to reach the list. (c) Always the switch, wide or narrow.
3. **The `dest:map` composite.** (a) Keep it with one part this build (suggested). (b) Drop it, so the module is the Map.
4. **Permissions.** (a) Maps' `edit` covers adding places and putting objects on the map (suggested; the defaults match).
   (b) A third permission for placing objects.
5. **The module's name.** (a) Maps (suggested; your words). (b) "Places and maps". (c) Map.

---

# Earlier draft, kept as history

The text below is the first draft of 2026-10-30. Its options (a), (b), (c) and its recommendation of keeping the id
`places` are replaced by the brief above. Its facts about the code were true on 2026-10-30; the section on today is
re-checked above.

**Earlier status:** draft, 2026-10-30, by product-planner. Nothing decided, and the merge into one module is not built. Separate
fixes from the health audit of Maps and Places (MP-02 to MP-22) have landed (Maps 0.9.14, Places 0.12.18), including the
map style as `--map-*` tokens that read on every theme; they do not decide this plan. From GitHub #374, raised by Thomas on
2026-10-25: "Places and Maps may want to be one module." It brings in #293 (Maps should show Place category colours),

## What it is today

Verified in code on 2026-10-30, unless marked otherwise.

### Two modules, one Map already on screen

- **Places** (`modules/places`, 0.12.17) owns every place: `place:<id>` in three stores (Mine, this space, the
  environment's), the categories and the type library (`places-lib-types.json`, 153 types), the place search and its
  cache (`geocoder` in the manifest, `server/geocode.js`), and the place dialog. It works with no map. Scopes
  `environment`, `space`, `person`. Its own window has a view switch (`host.ui.viewSwitch`: Mine, This space, the
  environment's name), a filter field and a **Category** chips group, and one "+" (**Add a place**).
- **Maps** (`modules/maps`, 0.9.12) stores nothing. It draws every summary that carries a `place`, from any module
  (`host.objects.search('', { has: 'place' })`), with MapLibre and PMTiles. It owns the map files (`map`, the host's
  shared `map-tiles` folder on a hosted install), the picture map (`imageMap`, declared as `pictureMap`) and region
  cutting (`worldSource`, declared as `regionSource`). It `requires: ["places"]`. Scopes `environment`, `space`.
- **The Map destination and the composite.** Maps declares `surfaces.destination` `{ id: 'map', part: 'main' }`, Places
  `{ id: 'map', part: 'panel' }` (`server/destinations.js`; `public/destination.js` mounts both in one page). On a
  space's canvas, `public/composites.js` turns the two into one `dest:map` composite (Maps' name, icon and tint) while
  Maps is on and a map file exists. There the person already sees one search, one Filters button (the page's
  Mine / environment / spaces group plus Places' category group) and one "+". The Map layout tab and **Global Map** are
  the same page. `server/index.js` `systemLayoutsFor` names `maps` as the Map tab's module by id.
- **Where the person still sees two.** Without a map file the composite is off, and Places and Maps open as two
  windows (Maps showing "no map file"). On the Modules page and in Set up they are two switches, and on the Roles tab two
  rows. Places' own window chooses whose places with a view switch; the Map chooses them in Filters.

### How the two talk

Five local actions carried by the module bus, each with the host's `page` and `pageUntil` so only the asking page
answers within a few seconds: Places provides `newPlace`, `searchPlaces`, `positionPicked` and `categoryColors`; Maps
provides `pickPoint` and `showOnMap`. Maps finds them by what they offer, never by module id.

### #293, category colours

Mostly built, read as code only: Maps 0.8.11 asks Places' `categoryColors` whenever a Places is open in the same page
(always true on the Map destination and in the composite), and keeps the last answer in this browser
(`localStorage` `maps-category-colors`). The gap left: a map in a browser that has never had a Places open beside it
falls back to the automatic colours. The place's summary carries `color` (the place's own tint, if any), not the
category's chosen colour.

### What other modules hold

- **Links to a place** are pointers `{ module: 'places', kind: 'place', id, scope, space? }` (`server/module-links.js`,
  `refs.produces` in Places' manifest, `ref:places:place` in action inputs). The Planner keeps them on its plan objects;
  Research's notes carry a `place` of their own. Nothing outside the two modules names `maps`, except
  `composites.js`, `systemLayoutsFor` and the Show list's aliases (`layouts.js`, `opens-with.js`).
- **Actions others use:** `addPlace` (**Save it as a place**, from the Planner, Chat and drops), `sharePlace`,
  `setPlacePoint`. All Places'.

### Permissions

Both have `view` and `edit`, with the same defaults (member and moderator yes; guest view yes, edit no). Maps' `edit`
does one thing (`maps.js` 867): dropping another module's object on the map to give it a position. Who may add a place
is Places' `edit`, even from the map.

### Templates

- **Travel** (`templates/travel.json`, version 7): `places` and `maps` both on, `showMap` on. No themed names.
- **Games** (`templates/games.json`, version 1): Places and Maps off but offered, `showMap` off
  ([plan-template-games](plan-template-games.md), decision 7). Its plan notes that a campaign map works only with a
  picture map.

### The picture map

One per environment ([plan-map-image](plan-map-image.md)), a raster PMTiles file the owner uploads in Maps' settings.
While it is set it replaces the world map in every space, place search looks only at saved places, and places are
pinned on the picture. That makes it a campaign's world map (towns, dungeons, regions), not a map per encounter. A
battle map in the usual sense (one picture per fight, a grid, tokens that move) does not exist anywhere in the code.

### Past plans that already chose

[plan-map-places](plan-map-places.md) (2026-10-13) chose "one thing seen, two modules behind it", as the Calendar and
To-do did, mainly to keep the Planner's links to places safe. That was before the no-compatibility rule of 2026-10-21;
under it, renaming ids or stored keys is allowed and test data may be reset. [plan-places-views](plan-places-views.md)
set the direction that Places is complete alone and Maps is a view of it.

## The options

### (a) Keep two modules, close the gaps

Maps keeps drawing, Places keeps owning. The work: close #293's last gap, make Places' own window choose whose places
in Filters as the Map does, and treat the pair as one where people turn them on and grant rights.

- **What a person sees:** one Map where there is a map file (as now). Without one, Places alone (Maps hidden from the
  Show list while it has nothing to draw). Two switches on the Modules page, unless turning on Maps also turns on Places
  there. Two rows on the Roles tab.
- **Data and permissions:** nothing moves. Two permission sets stay.
- **Links:** unchanged.
- **Templates:** unchanged.
- **Games:** the picture map stays in Maps' settings.
- **Cost:** S to M. **Rules out:** nothing; (b) stays possible later.
- **Stays fragile:** the five local actions and their few-second windows, and the colour cache in the browser.

### (b) One module, List and Map views, the picture map inside

Places takes Maps in. Its id stays `places` (the owner of the objects, so every pointer, stored key and action stays as
it is); `maps` goes away.

- **What a person sees:** one module, one "+" (**Add a place**), one search, one Filters button (whose places, spaces,
  categories, and later "on the plan"), and a view switch **List | Map** in the toolbar, the shared frame's `switch`.
  The Map view shows only while there is a map file or a picture map; without one there is no switch and it is a list.
  Wide, the Map view may keep the list beside the map, as the destination does now (question 4).
- **Data:** places stay where they are. Maps' settings (map files, picture map, world file) move to Places' settings
  page. The host's shared map folder moves with the module id (the admin copies the tile files again; test data may be
  reset).
- **Permissions:** Places' `view` and `edit` stay; Maps' two go. Dropping an object on the map to give it a position
  falls under `edit` (question 3). Roles' stored choices for `maps` are dropped, not migrated.
- **Links:** unchanged, since the id stays `places`. `showOnMap` moves to Places. `newPlace`, `pickPoint`,
  `positionPicked` and `categoryColors` stop being bus actions and become calls inside the module, so #293's gap
  closes by itself.
- **Destination and composite:** Places declares the Map destination's main (and, if the list stays beside the map,
  its panel; `cleanDestinationParts` allows one main and one panel per module). The `dest:map` composite is not needed:
  the module is the Map. `systemLayoutsFor` and the Show list's aliases stop naming `maps`.
- **Templates:** travel lists `places` only; games offers one module instead of two. The Map tab and Global Map take
  their name from the module (`systemLayoutsFor` uses the main module's name), so the tab would read "Places" unless it
  keeps "Map" as its own default (question 2).
- **Games:** the picture map stays a kind of map inside the module, the campaign's world map.
- **Cost:** L in all (about 2,800 lines of script brought together, the destination's parts, server names).
  **Rules out:** a third party's map that draws places without Places (none exists).
- **Risk:** MapLibre is about 1 MB inlined; a list-only window must not load it (load the map's libraries only when the
  Map view first opens).

### (c) One module for places, picture maps in their own module for games

(b), and the picture map moves out to a new module the games template turns on (a working name: Battle maps).

- **What a person sees:** in travel, as (b). In games, two modules again: Places on the world map, and the picture map
  apart.
- **The catch:** a picture map today is where places are pinned. Moved out, either places lose the picture (a campaign
  has no world map to pin towns on) or the new module needs objects of its own (markers, tokens), which is a new
  design, not a move.
- **Links, data, permissions:** as (b), plus the new module's own.
- **Cost:** (b) plus M to L for a module whose behaviour is not designed yet. **Rules out:** nothing, but it builds a
  module before anyone has said what a battle map does.

### Recommendation (product-planner's suggestion, not a decision)

**(b), keeping the id `places`.** The composite already shows people one Map; (b) makes the code match what they see,
removes the five timed local actions and the colour cache, and gives one switch, one Roles row and one settings page.
Under the 2026-10-21 rule nothing has to be kept for old data, and keeping the id `places` means no link moves at all.
For games, keep the picture map inside as the campaign's world map, and treat a real battle map (per encounter, grid,
tokens) as a separate idea with its own plan, not as (c). If (b) is too large now, (a)'s first step (#293) is useful
either way, but the rest of (a) is work (b) would throw away.

## #44, a map of the trip

Independent of the choice, but easier in (b). The Planner's objects link places by pointer; Places already gets
backlinks for each place. A map of the trip is the Map with a Filters group **On the plan** (the places a Planner object
in this space points at), and later **By day** (the days of the objects that point at them). No Planner-specific code in
the map: it reads backlinks by kind. Routes and lines between stops stay out of scope (Maps' contract, "Not decided
yet").

## The contract, if Thomas chooses (b)

Written to the level needed to decide; it is filled in once the questions are answered.

**Server half (server-development)**
- `server/destinations.js`: the map destination's main is whichever enabled module declares it, as now; nothing names
  `maps`. `server/index.js` `systemLayoutsFor`: take the module id from the destination's main, not the literal
  `maps`; the Map tab's default name stays "Map" if question 2 says so.
- The host's shared `map-tiles` folder follows the module that declares `regionSource` (already by declaration); the
  host console's Maps tab keeps its words.
- Templates: travel's `modules` without `maps` (version 8); games without change unless question 5 themes the name
  (version 2). `tools/template-versions.json`, `check-templates`, `check-template-switch`.
- Remove `maps` from `tools/module-versions.json`; the `dest:map` composite's parts become `places` alone, or the
  composite goes (step 3).

**Pages half (experience-design)**
- Places 0.13.0: the Map view under **List | Map**; whose places move from the view switch into Filters, as on the
  destination; one search (filters as you type; Enter searches for new places when a place search is set up, or goes
  to a pasted position); one "+".
- Maps' settings, `pictureMap`, `regionSource`, `showOnMap` and the map's styles and libraries in Places' manifest and
  `src/`; the map's libraries loaded only when the Map view opens.
- The destination page: Places as main (and panel, per question 4); the composite and the Show list read `places`.
- Category colours read directly from the categories list; the `maps-category-colors` cache goes.
- `modules/maps` removed.

## Left to build, in order (for (b))

1. **#293's last gap** (experience-design, S). Only if (a) is chosen or (b) waits: Places puts the category's chosen
   colour in each place's summary, so a map with no Places beside it colours pins right. Skipped if (b) is next.
2. **The server stops naming `maps`** (server-development, S). `systemLayoutsFor` and the destination rules by
   declaration; `check-destinations`, `check-layouts`. Ships alone: nothing changes for a person.
3. **Places takes the map** (experience-design, L). Places 0.13.0 with the Map view, the settings, `pictureMap`,
   `regionSource` and `showOnMap`; whose places into Filters; the lazy map libraries; `modules/maps` removed; the
   destination's parts and the composite read `places`. One step, because two modules cannot both declare the
   picture map. `check-maps` and `check-places` (moved to Places' files), `check-picture-map`,
   `check-picture-map-page`, `check-region-cut`, `check-geocode`, `check-destinations`, `check-canvas`,
   `check-module-versions`.
4. **Templates** (server-development, S). Travel without `maps`; games' name if question 5 says so.
5. **#44, On the plan** (experience-design, M). The Filters group from backlinks; By day after it if wanted.
6. **Documentation** (content-manager, M). One user guide for Places with the map, the architecture and API documents,
   the Places contract absorbing Maps', and the status of plan-map-places, plan-map-image and this plan. Production
   builds only.

## Verify

- **Checked by tool:** steps 2 and 4 by `check-destinations`, `check-layouts`, `check-templates`,
  `check-template-switch`; step 3 by `check-maps`, `check-places`, `check-picture-map`, `check-picture-map-page` (read
  as code), `check-region-cut`, `check-geocode`, `check-links` (the Planner's pointers), `check-drop`, `check-canvas`,
  `check-module-versions`, `check-names`.
- **Live in headless Chromium, without WebGL:** the list, the switch absent without a map file, Filters, the "+", the
  dialog, the destination's list-only state, a saved layout naming `places`, the Planner's **Save it as a place**, and
  that a list-only window does not load MapLibre (the network list).
- **Only in a real browser with WebGL (Thomas):** the map drawn from real tiles, the picture map, pin colours by
  category, picking a spot for the dialog, a dropped object getting a position, real Photon search, a phone.
- No LiveKit call is involved.

## Risks

- **The map cannot be seen here.** Every map behaviour moved in step 3 is verified only as code until Thomas looks in a
  real browser.
- **Step 3 is large.** It moves the most code of any step and touches the destination page and the composite in
  `canvas.js`; build it alone, with nothing else in `canvas.js` at the same time.
- **Two mounts of one module in one page** (main and panel both `places`) has not been done before; the Calendar's
  parts are two modules. Question 4 can avoid it.
- **Load size** if the map's libraries are not loaded lazily.

## What is not decided

1. **One module or two?** (a) two, gaps closed; (b) one module, List and Map, picture map inside; (c) as (b) with
   picture maps in a games module. Recommended: (b). Blocks everything after step 1.
2. **The name.** Places (id `places`, name "Places"); "Places and maps"; or "Map". And the layout tab and Global Map:
   keep "Map" whatever the module's name, or follow it. Recommended: the module is **Places**, the tab and Global Map
   stay **Map**. Blocks step 3.
3. **Permissions.** Fold Maps' "put objects on the map" into Places' `edit`, or keep it as a third permission. Recommended:
   fold it in; the defaults are the same today. Blocks step 3.
4. **Wide Map view.** The list stays beside the map (as the destination now; the module declares main and panel), or
   the map alone with the switch to go to the list. Recommended: the list beside the map when wide, drawn by the one
   mount, not two (avoids the two-mounts risk). Blocks step 3.
5. **The games template.** What a battle map is: the picture map as it is (the campaign's world map, places pinned on
   it), or a per-encounter map with a grid and tokens (a new module, its own plan). And whether games themes the
   module's name (say, "Locations"). Recommended: the picture map stays the world map inside Places; battle maps become
   a separate idea in `TODO.md`; no themed name until someone uses it. Does not block steps 2 to 4.
6. **#44's scope.** **On the plan** only, or **By day** too, or a route line. Recommended: On the plan first, By day
   after; no route. Blocks step 5 only.
