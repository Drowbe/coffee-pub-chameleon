# Places and Maps Plan: one module or two

**Audience:** Thomas decides whether Places and Maps stay two modules or become one, what it is called, and what the
games template's maps are. experience-design builds the modules, the destination's parts and the composite;
server-development builds the server's side (the destination rules, the layouts, the shared map folder, the templates
and the checks); content-manager merges or keeps the two user guides once it lands.

**Status:** Draft, nothing decided except the direction below (2026-11-12): Places is retired into Maps (GitHub #729). The 2026-10-30 draft that follows still stands as the background, but its recommendation (b), "keep the id `places`", is reversed by that direction; "Update 2026-11-12" replaces it. Nothing is built. Earlier text of the draft: the merge into one module is not built. Separate
fixes from the health audit of Maps and Places (MP-02 to MP-22) have landed (Maps 0.9.14, Places 0.12.18), including the
map style as `--map-*` tokens that read on every theme; they do not decide this plan. From GitHub #374, raised by Thomas on
2026-10-25: "Places and Maps may want to be one module." It brings in #293 (Maps should show Place category colours),
#44 (a map of the trip), the games template (where a picture map is a battle map) and the travel template.

## Update 2026-11-12: Places is retired into Maps (#729)

**Direction from Thomas (a clickable answer, 2026-11-12):** Places is retired into Maps. One module remains, **Maps**, id `maps`. This replaces option (b) and its recommendation to keep the id `places`; the rest of this document is background for the choices below. Under the no-compatibility rule of 2026-10-21 ids and stored keys may be renamed and test data reset.

**Goal.** One module for places and the map: one switch, one Roles row, one settings page, one place to look. **Non-goals.** A battle map with a grid and tokens (its own idea); routes between stops; migrating old data.

### Facts checked against the code on 2026-11-12 (`80ecd84e`)

Right as the spike said: `modules/places` is 0.12.22 with scopes `environment`, `space`, `person`; its manifest has the destination part `map` as `panel`, a page with `nav:false`, and a canvas 460 by 600; `view` and `edit`; Maps 0.9.15 has `requires` (line 126) and finds Places' actions by what they offer, not by module id (`maps.js` 220 to 262: `newPlace`, `searchPlaces`, `positionPicked`, `categoryColors`); `composites.js` line 19 holds `parts: ['maps','places']`; Travel picks with `modules: ['places']` (line 2378) and looks up `addPlace` by name (1881, 2348); `settings` exists in Places' manifest (line 191).

Corrections: Maps reads place summaries at `maps.js` 186 and 189 (`host.objects.search('', { has: 'place' })`), not line 92. `searchNote` is not in the code under that name; the by-name lookups are the action finds at 248 to 260, and those are what go. Counts differ from the spike's: 57 check files in `tools/` mention `places` (the spike said about 40), and `showCalendar` appears in 15 files (the spike said about 11); read them as "many", and the build lists them with a search, not from this plan. The allow-list `tools/check-names-allow.json` has 7 lines that mention `places`, not 4.

### What the retirement means

- **Maps takes over everything Places owns:** the `place` kind and `refs.produces` (key `place:{id}`), the actions `addPlace` and `setPlacePoint`, the geocoder block and its four environment settings (the categories, the search provider, the search address and whether to save results), the place dialog, the categories and the type library, and the person scope. Maps' scopes become `environment`, `space`, `person`. `requires: ["places"]` goes.
- **The surfaces go from three to what Maps has.** The Map destination's `main` stays Maps. Places' panel, page and canvas are removed. A place without a map point must still be listable and editable, so Maps gets a **List** view beside **Map** (the data already allows a place with no point). Without a map file the destination stays off (`needsFile`), so the List view is also what Maps' own window shows then; the Map view is offered only when there is a map file or a picture map.
- **Local actions become calls inside the module:** `newPlace`, `searchPlaces`, `positionPicked`, `categoryColors`, `sharePlace`, `showOnMap`, `pickPoint`. The few-second `page` and `pageUntil` windows and the `maps-category-colors` browser cache go, which closes #293.
- **Stored keys move from module id `places` to `maps`** (`place:<id>` in environment, space and person homes; the per-person bookmarks `saved:e:<id>` and `saved:s:<spaceId>:<id>`; the geocode cache `modules/places/geocode.json`, read by `server/geocode.js` and named by a pattern in `server/environment-export.js` near line 130). No migration. A reset costs the places people have saved on a test install; it costs nothing on a released one because there is none.
- **Server:** `server/geocode.js` and its route (generic), the "Add a region" path (`index.js` near 2900), the icon, visit and colour validation (near 7779 to 7785), and the admin route that counts and removes saved places (near 9993) change the module id they read. The kind `place` is generic in `object-format.js`, `ai-context.js`, `ai-tools.js`, `store.js` and `modules.js`; those need a search, not a change. `old-links.js` and the `check-names` allow-list lose their `places` lines.
- **Page side:** `composites.js` `dest:map` parts become `['maps']`, and the composite may go entirely (one module needs no composite). `opens-with.js` and `layouts.js` comments; saved layouts and `opensWith` lists that name `places` keep the id and so stop resolving (see question 2).
- **Other modules.** Travel: `pick({ modules: ['maps'], kinds: ['place'] })` and its three `addPlace` lookups keep finding the action by name, so only the pick line changes. `seed-demo.mjs` `MODULE_IDS` drops `places`; `tools/module-versions.json` drops it; 15 user guides mention Places (content-manager).

### Pointers held by other modules

Links are `{ module: 'places', kind: 'place', id, scope, space? }`, held by Travel's stops, the Planner, links, bookmarks and vault links. Once `places` is gone they stop resolving. See question 2.

## Left to build (for the retirement), in order

1. **Maps owns the data** (server-development, M). Manifest: scopes, `refs`, `actions`, `geocoder`, the four settings; the server paths above read `maps`. Ships with step 2 if the module cannot run half-moved. `check-geocode`, `check-links`, `check-module-versions`.
2. **Maps gets the List view and the place dialog** (experience-design, L). The code in `places.js` and its libraries moves into Maps, the actions become calls, and the map's libraries load only when the Map view first opens (MapLibre is about 1 MB inlined). `check-maps`, `check-places` (moved), `check-picture-map`, `check-region-cut`.
3. **Remove `modules/places`** (server-development, M). `composites.js`, `layouts.js`, `opens-with.js`, `seed-demo.mjs`, the three allow-lists, `old-links.js`, templates (travel and games lists), and the roughly 57 check files that name Places. Model tier: sonnet; this is wide, not risky. The change touches the core, so it gets the independent read.
4. **Documentation** (content-manager, M). One guide for Places inside Maps, the contract, `CONTRACT.md` and `design/` of Places moved or deleted. Production builds only.

Steps 1 to 3 should land together in one release; between them the product has two half-modules.

## What cannot be verified here

The map drawn from real tiles, pin colours by category, picking a spot, a dropped object getting a position and real Photon search need a real browser with WebGL. The List view, the dialog, the Filters and that a list-only window does not load MapLibre can be checked headless.

## Questions for Thomas

1. **What is the module's name, now that it holds both?**
   - Keep **Maps** for the module, tab and Global Map; the list inside is labeled Places (recommended)
   - Rename the module **Places and maps**
   - Rename it **Places** and keep the tab **Map** (the id would still be `maps`)
2. **What happens to links that name `places` (Travel stops, the Planner, bookmarks, vault links)?**
   - Nothing is kept: they stop resolving, test data is reset, and Travel's stops are re-picked (recommended; it follows the 2026-10-21 rule and the product is unreleased)
   - Re-mint: a one-off script rewrites `module: 'places'` to `maps` in saved pointers on the test installs
   - Alias: the server treats `places` as `maps` when it resolves a pointer (a compatibility layer the rule forbids)
3. **Maps' `edit` and Places' `edit`: how many permissions?**
   - Two, `view` and `edit`, with Maps' "put an object on the map" folded into `edit` (recommended; defaults are the same today)
   - Three: `view`, `edit` and a separate "place objects on the map"
4. **What does Maps show when there is no map file?**
   - The List view alone, with no switch (recommended)
   - The module stays hidden until a map file is set, and places are managed elsewhere
5. **Is the picture map or a battle map part of this?**
   - Keep the picture map as it is; a battle map is a separate idea in `TODO.md` (recommended)
   - Build a battle map module first
6. **Do the 2026-10-30 questions on "On the plan" (#44) and the games template still stand?**
   - Yes, unchanged, answered later; they do not block steps 1 to 3 (recommended)
   - Drop #44 from this plan


## What it is today (2026-10-30 draft)

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
