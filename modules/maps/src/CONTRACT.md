# Maps: the markup and behaviour contract

**Audience:** whoever writes `maps.js` (the modules side) and whoever styles it (`maps.html`, `maps.css`, the map style; the interface side). This is the agreement between them, in the same form as the Travel module's.

**What Maps is.** A map of every place the space has: a view with **no data of its own**. It draws every summary in the space that carries a `place` (the Places module's places, and any other module's objects that have one), grouped by the module they come from. Saving a new place from the map hands it to the Places module through the `newPlace` action; if nothing provides that action, the add tools are hidden and the sheet says "Install Places to save places".

**Canonical markup.** The elements a script clones are the `<template>` elements in `maps.html` (`tpl-pin`, `tpl-pin-cluster`, `tpl-callout`, `tpl-result` and the `tpl-state-*` blocks). The script fills a clone by hooks only, `[data-slot=name]` (textContent) and `[data-icon=name]` (the inline SVG from `host.ui.icon`), and toggles the state classes and data attributes below. If this text and the templates disagree, the templates win; tell the interface side. `design/map.html` is the reference rendering: open it in a browser to see every state, dark and light, at phone, pane and wide sizes. The map itself is a drawn stand-in there; the real one is MapLibre.

**How it works.** `maps.css` styles the elements by their classes and attributes. The script builds these elements and toggles states; it never sets a style. The one exception is a pin's position, which the map library sets on its marker element.

**Rules that hold everywhere**
- Colours come only from the theme tokens (`--bg`, `--bg-section`, `--bg-card`, `--border`, `--text`, `--text-dim`, `--accent`, `--on-accent`, `--danger`), in the page and in the map style. A light theme must give a light map.
- Nothing has a fixed pixel height; the module fills its pane. No `100vh`.
- Text from people goes in with `textContent`, never as HTML. An icon is `<span class="ic" data-icon="name">`.
- **The credit is always on the world map:** `.attribution` (`[data-slot=osm]`: "© OpenStreetMap contributors", linking to the licence page) is in the bottom-right of every map drawn from map data. No setting hides it, and the script never removes it. If the tile file's metadata names another credit (a tile builder's), the script appends it inside the same element. A picture map (below) is not OpenStreetMap's: there `[data-slot=osm]` is hidden and only the picture file's own credit shows, else `.attribution` is hidden.
- No default remote tiles and no call to any service unless the admin set one: the map reads the admin's file (`host.files.url`) and, if set, the search address.

## The page

```
<div id="app" class="app [narrow]">              the whole page; un-hidden when loaded
  <div class="stage">
    <div id="map" class="map [adding]">            the map library draws here; pins are markers in it
    <ul id="results" class="results">               what a search found, over the foot of the map (hidden when empty)
    <div id="ctrl-zoom" class="maplibregl-ctrl-top-right">   zoom in, out, locate me
    <div class="maplibregl-ctrl-bottom-right"><div class="attribution">
    <div id="banner" class="sdk-banner" data-kind="info">             'Click the map to place it' while adding
    <div id="callout" class="callout-box">         the selected place (hidden when none)
    <div id="state" class="sdk-empty">                 replaces the map (see States)
```

There is no list or panel over the map. The host draws the bands (title bar, toolbar row, status bar): the title bar's **+** has one entry, "Add a place", which opens Places' dialog at once, empty (a place need not be a pin), and the toolbar row has the module's search (`host.toolbar.set`, one `search` item with the id `find`: Enter searches, a pasted position or map link goes there; `.results.under-search` lists what it found just under the toolbar). As the destination's map the page's row has the search instead, and the module sends none. The status bar says how many places show, how many a search found, or "Click the map to place it" while a spot is being picked. The list of places is the Places module.

## Wide and narrow

The map fills the pane in both. The frame is narrow under 720 px (the script sets `.narrow`): the callout and the results list take the full width, and the controls are larger for a finger.

## Pins (markers on the map)

`<button class="pin" data-kind="place|object|cluster" data-id="…">` with `.pin-body` (an icon, or a count for a cluster) and `.pin-label`.
- `place`: a place added in Maps (accent fill, a location icon). `object`: another module's object with a `place` on its summary (card fill, that module's icon). Clusters replace pins that would overlap; a cluster is `.pin.cluster` and clicking it zooms in.
- State: `.selected` on the pin whose summary is open (drawn larger, with a ring, and above the others); `.draft` on the pin of the place being added (dashed).
- The label is hidden below a zoom level the script chooses (a CSS class on the pin is not needed: it omits `.pin-label`).

## The callout (`#callout`)

`.callout[data-kind=place|object][data-cat][data-scope]`: `.callout-close`, `h3[data-slot=title]`, `.callout-where` (`[data-slot=where]`, `[data-slot=coords]` in monospace), for an object `.callout-source` (that module's icon, `[data-slot=from]`, `[data-action=open]`), and `.callout-actions`: `a[data-action=open-in-maps]` (its `href` is the platform's own link on Apple devices, `geo:` on Android and an ordinary web link elsewhere, from `host.util.geo.mapsLink`) and `button[data-action=copy-coords]`. Every place is read-only here; changing it happens in the module that owns it.

## Search (only when a search address is set)

The field (Enter) searches through Places. `ul.results#results` holds `li > button.result` (each with `[data-slot=title]` and `small[data-slot=sub]`) or a `.note` ("No results", "Search is not available right now"); the same results are drawn as `.pin.candidate` on the map. Picking a result (click) starts a place there: Places opens its own dialog with the spot filled in. Escape clears the results.

## Adding a place

Ways to add, all ending at Places' own dialog (the titlebar "+" opens it empty; the others fill the position in):
1. **Picking a spot.** When Places' dialog asks for a position (its Position field's target, the `pickPoint` action), the map turns on adding: `.map.adding` (a crosshair cursor) and `#banner`. A click on the map puts the `.draft` pin there. `data-action=cancel` in the banner (or Escape) leaves adding. The title bar's **+** does not turn it on; it opens the dialog.
2. **The field**: a coordinate pair ("38.7075, -9.1364") or a map link puts a draft pin there.
3. **A search result** (above).

Nothing here edits or deletes a place, and pins are not draggable.

## States

| State | What the script renders |
|---|---|
| Loading | `#state` (un-hidden) holds `tpl-state-loading` |
| No map file | `#state` holds `tpl-state-nomap`, the same for everyone; the list is shown full width (`.app.listonly`) |
| The map file will not load | `tpl-state-error` with `[data-action=retry]` |
| No WebGL on this device | `.app.listonly`, and a `tpl-notice` at the top of the list: the places are listed, each with open-in-my-maps-app |
| No places yet | the map, and `tpl-empty` in the list |
| Search not set up | `#search` hidden; nothing else changes |
| A place changed by someone else while it is open in the editor | `#f-error` says so (the script's version conflict message) |

## The map style (`maps.css` is not enough: the map is drawn by the library)

The script builds the map's style from the theme tokens at load and again when the theme changes (reading `getComputedStyle` of the root), so the map is never a fixed dark or light picture. The style is the interface side's to specify and the script's to build; the mapping, by the basemap schema's layer names:

The colours are map tokens (`--map-*`, in `public/sdk/system.css`, the dark values and a light block that overrides some), each a mix of the theme's own tokens, so a theme that sets one wins. The page reads them with `getComputedStyle` and hands them to the style; a style built without them (the checks) works the same ladder out itself (`mapColours` in `maps-lib-d-style.js`).

| Layer | Token | Dark | Light |
|---|---|---|---|
| background, `earth` | `--map-land` | `--text-primary` 4% over `--surface-panel` | `--surface-panel` |
| `landcover` | `--map-wood` | `--tint-green` 9% over the land | same |
| `landuse` (parks, woods) | `--map-park` | `--tint-green` 16% over the land | same |
| `water`, waterways | `--map-water` | `--tint-blue` 38% over `--surface-page` | `--tint-blue` 38% over `--surface-panel` |
| `roads` paths and minor | `--map-road-minor` | `--text-primary` 20% over the land | 27% |
| `roads` medium | `--map-road-medium` | 30% | 39% |
| `roads` major and highways | `--map-road-major` | 42% | 50% |
| `buildings` (from zoom 15) | `--map-building` | `--text-primary` 10% over the land | 12% |
| `boundaries` | `--map-boundary` | `--text-muted`, dashed, country and region level only | same |
| `places` small labels | `--map-label` | `--text-primary` 40% over `--text-muted` | same |
| `places` cities and regions | `--text-primary` and `--text-muted` (the style's own, not tokens) | halo: the land, 2 px | same |
| `pois` | not drawn: the pins are the points of interest | | |

The map reads on every theme: whatever the tokens give, the style clamps them last (`guardMap` in `maps-lib-d-style.js`, its minimums in `MAP_MIN`). Each colour is nudged toward the text colour (else black or white) until it holds its minimum against the land, and a colour that already holds is not touched: place names 4.5 to 1 on the land (and 3 to 1 on the water where both can hold), a major road 3, a medium road 2.3, a minor road 1.7 (each road class at least 1.1 times the one below), water 1.5 from the land and with a blue of its own, a park 1.15, a wood 1.06, a building 1.15, and a border as drawn (70% opacity) 2. Names have a 2 px halo in the land colour.

What `check-maps` holds: those minimums on every shipped theme (Strong Coffee, Cream, Calming Teal, Burnt Orange), dark and light, from the real `--map-*` lines of `system.css`, and also with no tokens, with every token set to the land or the page, and on 400 random themes. Parks are green and not the accent, and nothing draws a neighbourhood's boundary.

No sprite or icon font is needed. Labels use one Latin glyph set at first (see the plan). Fewer layers than a general basemap on purpose: it keeps the file small to read and the map calm behind the pins.

## Where a place comes from

- **Every summary in the space with a `place`** (`{ lat, lng, name? }`), through the objects conduit. Places produces them (a place with a position); Travel, the Calendar and others may too. Maps names no module: it draws the module's icon from the summary and groups the list "From <module>".
- **Picking a spot for the dialog.** Maps provides `pickPoint` (local; its input is only the host's `page` and `pageUntil`, see below): Places' dialog has a target button beside Position, shown while a Maps is open in the same page, which tucks the dialog away and asks Maps for a spot. Maps goes into the click-the-map mode of the + on the map (banner and a toast, "Click the map to place it"; on a phone the map's tab is shown) and answers at once; the click is then told back by requesting Places' `positionPicked` with `{ lat, lng }`, and leaving the mode (Escape, Cancel, the + again) with `{}`. Places puts the dialog back with every field kept, and Position filled when a spot came. Maps finds `positionPicked` by what it offers, never by name of module.
- **Only the asking page answers (0.8.11).** Both requests are asked with `host.actions.request(..., { here: true })`: the host puts the asking page's id (`page`) and a time limit a few seconds on (`pageUntil`, ms) in the input, both declared in the action's input, and only a mount in that same page (its window, the frames inside it such as a Workspace's Map composite, and a window it popped out) hears the request, and only until the limit. A Map open in another tab never takes the pick, and a pick nobody took in time is never taken later; `pickPoint` itself also refuses one whose `pageUntil` has passed when it starts, so a late start never puts the map into the mode. `positionPicked` goes back the same way, to the Places in this page only.
- **Category colours (0.8.11).** A pin and the callout of a place with a category use the colour the owner chose for that category in Places' list, used as it is (the text on it black or white by its lightness), as Places' own list does. Maps asks Places' `categoryColors` (local, `{ here: true }`; answered `{ colors: { <id>: '#rrggbb' } }`, only the chosen ones) whenever a Places is open in the same page (when the actions are looked up: at the start, every 90 seconds and when the page comes back) and keeps the last answer in this browser (`localStorage` `maps-category-colors`) for a map with no Places beside it. With no chosen colour, the five built-in categories keep the stylesheet's colours and any other category turns the accent by an amount taken from its id, as before.
- **Listeners on the page.** The Escape listener (while picking) and the page-comes-back listener are on the page's document; they are taken off when the map's markup goes (the module closed, the space or page left, the module opened again), and the 90-second look-again stops at its next turn.
- **A new place** is created by the module that provides `newPlace` (Places today), never stored by Maps. If nothing provides it, Maps is view-only. Who may add is Places' decision, not Maps' `edit` permission: the add tools show whenever `newPlace` is listed (and not `may: false`), and if Places refuses ("you may not add places here") the tools go away with no message. On a phone (the parts are tabs) the map asks the page to show the list (`host.destination.set({ reveal: 'panel' })`) so Places' dialog is seen. The words: "Add a place" everywhere (Places' own button too); "Click the map to place it" is the banner and the status line. An empty position is allowed in the dialog (a place with no spot on the map). A short note (a refusal, a confirmation) is a toast (`host.ui.toast`), never text in the module.
- **Giving another module's object a place** stays with that module.

## Once search and saving move to Places (see plan-places-views.md)

Maps becomes a view of places and a gesture to choose a point. What stays: the pins, clusters, the map file, the credit, `add-place` (click the map to choose a point), `open-in-maps` and `copy-coords` on a selected place. What changes in the design (the scripts follow when Server Development builds the actions):
- **The search** is the toolbar's field (`find`), not an element of the map. Its results come from Places (an action that returns a few results), so they are the same as the ones Places shows when its quick-add searches. A result is drawn as a **candidate pin** (`.pin.candidate`: dashed outline, surface fill, no count); picking one (`data-action=save-found` in its callout) asks Places to save it.
- **Saving** is Places' dialog: after a click on the map the map asks Places to add a place at that point (the `newPlace` action with the position) and Places opens its own dialog. The map's `#editor` goes away, with `f-title`, `f-notes` and `#f-where`; the draft pin stays until Places has saved or the person cancels.
- **No list panel.** Maps requires Places, so Places is the list (decided by the author). `#panel`, its rows, groups and the phone sheet go away; the map shows pins, and an object from another module opens in its own module. Selecting a pin shows its callout on the map.
- **A pin from mine** (the person scope) has `data-scope="person"`, which draws the small person mark on it.
- **Views** (mine, this space, everyone): Maps draws whichever view Places has selected, and a pin from mine wears a small person mark so it is not mistaken for a shared one.

## As the Map destination's main part (0.8.0)

Maps has the `environment` scope and declares `surfaces.destination` `{ id: 'map', part: 'main' }` (plan-map-destination). On that mount (`info.context.destination.part === 'main'`) it reads every place across the viewer's spaces (`host.objects.search('', { scope: 'spaces', has: 'place' })`), their own and the environment's, and follows the page's state (`host.destination.onState`):
- **The filter** (`mine`, `environment`, `spaces`): only those pins are drawn.
- **The search text** (`q`): a pin that does not match it (by title and address), or a cluster none of whose pins do, gets `.pin.dim` (set back; full again on hover or focus).
- **Enter** (`find` raised): a name asks the place search (`searchPlaces`, near the map's centre) and draws `.pin.candidate` pins; the results are listed by the panel beside, so `#results` stays hidden. A pasted position puts the `.draft` pin there and asks `newPlace`.
- **On a phone** (the page's `phone`, its parts are tabs): the callout has **Show in list** (`data-action=show-in-list`), which sets the page's `reveal: 'panel'`, and the page shows the list's tab with the place selected.
- **The selection** (`selected`): either part may set it. A pin clicked here sets it; one set by the panel is selected here (the map flies to it), read again first when it is new.
- There is no host bar and no **+** on the map itself: the **+** is the title bar's (`host.add.set`), shown when something offers `newPlace`. The map's last view is kept in this browser (`maps-destination-view`).

**The environment page on its own** (`/modules/maps`, when the Map destination is not shown) draws the same pins with no filter, no panel and no adding (the actions it would ask are carried out by a Places page that is not open there); its search field takes pasted coordinates or a map link to go there.

## A picture map (0.8.8, plan-map-image)

While the environment has a picture map (`host.environment.pictureMap`, `{ file, minZoom, maxZoom, tileType }`, from Maps' `imageMap` setting), the map draws only that picture, in every space and on the Map destination; the `map` files are not read. A change to `imageMap` while the page is open switches the map at once.
- **The style** is `buildPictureStyle()`: a `background` layer (`--bg-section`) and one `raster` layer from a `raster` source `pmtiles://<address>` (`tileSize` 256, the file's own zooms and bounds). The file is read by range from `host.files.url(file)` with `?folder=image-map`.
- **Zoom and panning** (`pictureLimits()`): the map's `maxZoom` is the file's own maximum (no zoom past it: it only blurs; this replaces the earlier "plus two"), `landZoom` (where a selected place, a new pin and a fit land) is one level above it and never above the file's minimum, `minZoom` the file's minimum, and `maxBounds` the file's bounds (the whole web map square when the header has none). It opens on the whole picture, or where it was last left (the world map's key with `.picture` added, so the world map's own view is kept). Every fixed zoom (a pin, a new place, a pasted position, a cluster, a remembered view) goes through `capZoom()`. A pin's label shows from three levels under the file's maximum.
- **Left out:** "Show where I am", `a[data-action=open-in-maps]` (removed from the callout), the callout's `[data-slot=coords]` ("Copy coordinates" stays), the OpenStreetMap credit, and the no-WebGL state's `[data-slot=maps-app]` words.
- **Search** looks only at the places drawn: the toolbar's field (placeholder
- Positions stay `{ lat, lng }`; pins, clusters, the callout, the draft pin, the drop and the selection are unchanged.

## Not decided yet

Routes and directions (out of scope), an offline area, and heat or category layers.
