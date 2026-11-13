# Maps' list part: the markup and behaviour contract

**Where this came from.** This was the Places module's contract. Places folded into Maps (plan-places-and-maps.md, jobs J1 to J5): the module id is now `maps`, the page is the destination panel `list.html` built from `src/maps-list.*`, the places are kept under module `maps` (`ref:maps:place`, pointers `{ module: 'maps', kind: 'place' }`) and nothing reads the old id. The List view (J2) will replace this part; until then it is the Map destination's panel and has no window of its own. Where the text below says Places, read Maps' list.

**Audience:** whoever writes `maps-list.js` (the modules side) and whoever styles it (`maps-list.html`, `maps-list.css`; the interface side).

**What Places is.** The space's saved places: named locations (a hotel, a restaurant, a viewpoint) with an address, an optional position, notes, a category and owners. It needs no map and no map file. Other modules point at a place through the links conduit (a trip stop, an event, a task); a place with a position also gives its summary a `place`, so the Maps module draws it. Maps stores no places of its own.

**Canonical markup.** The elements a script clones are the `<template>` elements in `maps-list.html` (`tpl-group`, `tpl-place`, `tpl-owner`, `tpl-link`, `tpl-conflict`, `tpl-readonly`, `tpl-state-*`). The script fills a clone by hooks only, `[data-slot=name]` (textContent) and `[data-icon=name]` (the inline SVG from `host.ui.icon`), and toggles the state classes and data attributes below. If this text and the templates disagree, the templates win. `design/list.html` is the reference rendering: open it in a browser for every state, dark and light, at phone, pane and wide sizes.

**Rules that hold everywhere**
- Colours come only from the theme tokens. A light theme must work.
- Nothing has a fixed pixel height; the module fills its pane and scrolls inside it.
- **Narrow means the pane, not the window:** the script sets `.narrow` on `#app` from `host.rootElement.clientWidth < 720` (a ResizeObserver, not `matchMedia`, since a bundled module runs in the page). The stylesheet keys on `.app.narrow`.
- Text from people goes in with `textContent`, never as HTML. A category is always an icon and a label.
- No inline styles, with one exception: the item menu's `top` and `left`.

## The page

```
<div id="app" class="app sdk-slot [narrow]">   the content slot; the host draws the title, the toolbar row, the "+" and the status line
  <p class="view-note">                     whose places these are (hidden for the space view)
  <main id="body" class="body">             the groups, or a state
  <div id="item-menu" class="menu">         the place menu (hidden)
  <dialog id="editor" class="sdk-editor">   the editor window for one place (host.ui.editor; closed until opened)
```

## The list

`#body` holds one `section.sdk-list-group` per category that has places, in the order do, eat, stay, travel, other: an `h2.sdk-group-head` (the category's icon and name) and `div.sdk-list.rows` of `article.sdk-card-banded.place-row`. The toolbar row (`host.toolbar.set`) holds the filter (a `search` item) and the categories (a single-choice `chips` item, **Category**, in the row's Filters menu: **Every category** with the number of places, then one entry per category with places and its count; none chosen shows every category). With a category chosen, only that group shows. The filter matches the title, address and notes as you type.

**A place** (`article.sdk-card-banded.place-row[data-id][data-cat=do|eat|stay|travel|other]`, focusable, Enter opens it), the shared banded card (Cards, `system.css`): its band `header.sdk-card-head` holds `.sdk-card-main` (`.sdk-card-icon` with the category icon, its colour the card's `--tint`, set from `--tone`, and `h3.sdk-card-title.title`, the name on one line) and `button.item-menu[data-action=menu]`; then `div.sdk-card-body` with `p.sub[data-slot=address]` (absent when there is no address) and `.meta` with **exactly one of** `[data-slot=pinned]` ("On the map", when the place has a position) or `[data-slot=nopos]` ("No position yet"), then `[data-slot=owners]` (`.owner`, one initial each) and `[data-slot=links]` (`.link` pills for the items that point at this place: an icon, `<b>` the kind, the title). Clicking the row opens the dialog; the menu opens `#item-menu`.

## The place menu (`#item-menu`)

A popover the script places under the button that opened it. Entries: `edit` (its label reads "View" for someone who may not edit), `open-in-maps` (an `a` whose `href` is `geo:lat,lng?q=lat,lng(name)` where that works and the platform's own maps link on iOS, or a search by the address when there is no position; the script chooses), `copy-coords` (hidden without a position) and `delete` (`.danger`, hidden without edit rights). `[hidden]` closes it; a click elsewhere or Escape closes it.

## The dialog (`#editor`)

A `<dialog class="sdk-editor">` the script opens through `host.ui.editor` (size `medium`): the editor window, drawn over everything in the browser's top layer (beside the map, over the whole destination page) and sized to the form, a full-screen sheet on a phone, never clipped by the module's box. The SDK adds the close button in its corner, traps focus, and on Escape or Close asks "Discard your changes?" (**Keep editing**, **Discard**) when a field differs from what the form opened with (`state.editing.opened`, a snapshot of the fields; a read-only place never asks). **Cancel** in the button row (`.editor-buttons.sdk-editor-actions`, stuck to the dialog's bottom so Save is always in view) goes the same way (`editor.cancel()`); a read-only form hides the row, so the corner Close is the only one. A save or a delete closes at once. Focus returns to the place's row after an edit, else to what had it before.

For someone who may edit: `form#form.sdk-form` (the SDK draws every field; the module writes no field rule) with `f-title`, `f-category`, `f-address`, `f-point` (a paste field: "38.6916, -9.2160", a `geo:` link or a map link with `?ll=`, `@lat,lng` or `#map=zoom/lat/lng`; the result shows in `#f-point-note`, "Coordinates found." or "No coordinates in that."), `f-notes`, `#f-owners` (a `label.check` per person of the room), `#f-links-out` with `a#f-open-in-maps`, `#f-used-by` (hidden when nothing points at the place) with `.links` of the `.link` pills, `#f-by` (who last changed it), `#f-error`, and `#f-save`, `#f-cancel` ("Cancel"), `#f-delete` (only when editing). The dialog for **a new place** has the title "Add a place" and no `#f-used-by`, `#f-delete` or `#f-links-out`.

For someone who may not edit: the same card with `tpl-readonly` in place of the fields (a `dl` of category, address, position, whose, then the notes), no Save or Delete.

**Conflict:** if someone else changed the place while it is open, a `tpl-conflict` bar is added above the buttons (`use-theirs`, `keep-mine`), and `#f-error` stays empty.

## Adding

On its own, "Add a place" is the titlebar "+" (`host.add.set`, one action: it opens the dialog; the status line says how many places show, whose, and the filter). The "+" is the host's wherever Places is drawn: the window's titlebar, popped out, the module's own page and the Map's panel. There is no quick-add field: the list's only field is the filter. `data-action=add-place` in the empty state opens the dialog too. Another module can ask for a place through the `addPlace` action; that creates one without opening anything.

## States

| State | What the script renders |
|---|---|
| Loading | `#body` holds `tpl-state-loading` |
| No places at all | `#body` holds `tpl-state-empty` with `[data-action=add-place]` (hidden for someone who may not edit); the toolbar row is empty |
| A filter matches nothing | `tpl-state-noresults` with `[data-action=clear-filter]` |
| Someone changed a place that is open | the conflict bar above |
| Error | `p#note.sdk-form-error` at the top of the slot |

## What the map shows

A place with a position gives its summary a `place` (`{ lat, lng, name }`), so it appears on the Maps module's map with this module's icon; opening it there brings you here. A place with only an address is listed here and opens its address in the person's maps app, and can be given a position later. That is why "On the map" and "No position yet" are shown: they say whether the map has it.

## Views: mine, this space, everyone

The same places at three scopes (see plan-places-views.md). The switch itself (an icon and "Mine", "This space", and the environment's name, `info.context.environment.name`, "Everyone" only when it is not known) is drawn in the toolbar by `host.ui.viewSwitch`, not markup in `maps-list.html` -- see `architecture-module-window.md`. At the top of the slot, `p.view-note[data-slot=view-note]` (hidden for the space view) says whose they are: "Only you see these. They follow you into every space." for mine, "Everyone in this environment sees these, and anyone who can edit can change them." for everyone. The script builds the switch's options from what the person has (Mine needs a signed-in person, the environment's own needs the environment scope and shows only where the person may see it) and skips it entirely with only one view available. The list, chips, counts, menu and dialog are the same in each view; in a view the person may not change (everyone, without the right), the menu says "View", there is no Delete and the dialog is read-only, as for a viewer today. The copies ("Share to this space", "Save to mine") are gone since 0.12.0: see "Shows in" below.

## Find a place (only when a search address is set)

Beside the map (the Map destination's panel), Enter in the page's search with a search address set looks for new places: `div#found.sdk-card-banded.found` (a banded card) opens over the bottom of the window: its band `header.sdk-card-head.found-head` ("Results for" as the meta, the text in a `b.sdk-card-title`, and `button.found-close[data-action=close-found]`), then `.found-rows` of `.found-row[role=option][tabindex=0]` (`.mark` with an icon, `.title`, `.sub` with the address, `p.source[data-slot=source]` under it saying where the result came from: "Already in <list>" (a place there already: its button reads "Open it" and opens it), "From earlier searches", "From Photon" or "From the search service", quiet and small with a dot in the accent colour, hidden when empty, and `button[data-action=save-found]` "Save", `.btn-primary` on the first result only). Enter or a click on a row saves it; arrow keys move between rows. States: searching (a `.skeleton` in `.found-rows`), nothing found (`p.found-state`: "Nothing found. Try a fuller name, or paste coordinates or a map link.") and an error (`p.found-state`: "Search is not available right now."). Where no address is set none of this exists. The reference rendering has the states `mine`, `everyone`, `searching`, `found` and `notfound`.

## Not decided yet

Tags beyond the five categories, sorting other than by name inside a group, importing a list, and sharing a place between spaces.

## As the Map destination's panel (0.9.0)

Places declares `surfaces.destination` `{ id: 'map', part: 'panel' }` (plan-map-destination). On that mount (`#app.part`) it has no view switch or search of its own (the page's row holds the search; this part puts its category group in the page's Filters menu), and lists in one list Mine, the environment's own and each of the viewer's spaces' places (`host.spaces()`, `host.storage.list('place:', { scope: 'spaces' })`), those the page's filter has on (`host.destination.onState`: `mine`, `environment`, `spaces`).
- **Add a place** is the page's "+" (`host.add.set`), shown to anyone who may add a place somewhere.
- **A place** gets `data-where` (`my`, `global` or `in:<space id>`) and a `.scope-mark` in its `.meta`: the person icon and "Mine", the globe and the environment's name (`info.context.environment.name`, as the Map destination's filter and Where name it, decision 19; "Everyone" only when it is not known), or the space's own icon and name. The selected place has `.on`.
- **The search text** (`q`) filters the list as the old filter box did; a pasted position filters nothing. With a name typed and a place search set up, `tpl-find-more` ("Search for new places", `data-action=find-new`) is at the foot. On Enter (`find`) the results show in `#found`, moved above the list; **Save** on a result opens the dialog with it filled in.
- **Selecting:** a place with a position sets the page's `selected` (the map flies to it); one without opens its dialog. A place the map selects is marked and brought into view.
- **Nothing on in the filter:** `tpl-state-none` with "Pick at least one in <Spaces>." **No places:** `tpl-state-empty` reads "No places here yet."
- **The dialog** has **Shows in** at the top (below). `#f-readonly` says why a place is read only ("Only people who can add places in <space> can change this.").

## One way to add a place

Every way to add a place (the host's "+", the empty list's "Add a place", a search result, a click on the Map, a dropped object) opens the same dialog, "Add a place", in every context (a space's canvas, a pop-out, the module's own page, the Map's list).
- **Shows in** (`fieldset#f-where`) is in every form for someone who may edit; see below.
- After a save a toast (`host.ui.toast`) says "Saved in <store>, which is not shown now." only when the place is not on the list in front of the person (switched off in the Map's Show menu, or not the one shown); nothing is said when the place is visible. Every short note in Places is a toast, never inline text. A new place with a position is shown on the map: selected beside the Map (the page flies there), or, on a space's canvas or a pop-out, shown through the `showOnMap` action when a map offers it.
- While the environment has a picture map (`host.environment.pictureMap`) there is no maps app, latitude or longitude: `#f-links-out`, the menu's "Open in my maps app" and "Copy coordinates" are hidden, Position says "A position on the map (optional)", and the outside place search is off. This follows the picture map live (0.10.9): when the owner sets, replaces or clears it, the host updates `host.environment.pictureMap` and Places hears `host.on('environment')`, closes an open place menu (it is built when it opens), turns the outside search on or off, and puts the open dialog's Position wording and `#f-links-out` right, without a reload.
- `newPlace` refuses with "you may not add places here" when no store is open to the viewer; the Map reads that to take its add tools away.
- **The target button** (`#f-pick`, beside Position; accessible name "Pick the position on the map", tooltip "Click the map to set the position") shows only while some module offers `pickPoint` (the map) and the host lists it as `open: true`: a mount of it is in this same page (its window, the frames in it, a window it popped out). Asked each time the dialog opens, so it shows again once a map is open here. It tucks the dialog (the fields stay as typed), asks the map for a spot with `{ here: true }` and waits; Places provides `positionPicked` (`{ lat, lng }`, or `{}` when the person left the mode), which brings the dialog back with Position filled or unchanged. Only the asking page's map may take the request, and only for a few seconds (the host's `page` and `pageUntil` in the input, which `pickPoint` and `positionPicked` declare): a map in another tab never takes it, and one that comes later never does. If no map in the page answers in that time the dialog comes back at once with the toast "The map could not be used: no map is open." and the target is hidden until the dialog next opens with a map here; a map that cannot start brings it back with "The map could not be used: the map could not start."
- **`categoryColors`** (local, input only the host's `page` and `pageUntil`) answers `{ colors: { <category id>: '#rrggbb' } }`: the colours the owner chose in the category list (not the grey that means automatic), after the list has been read, so the map in the same page colours its pins as this list does. A place with an empty Position is valid: it is listed as a place without "On the map" and is not a pin.

## The library (0.11.0; plan-places-library.md, Part B)

- **Categories.** The `categories` setting starts as eleven rows (food, stay, sights, nature, activities, nightlife, shopping, transport, services, health, other), each grey, which means automatic: the row takes one of the eight theme tints (`--tint-blue`, green, teal, purple, orange, pink, gold, red) by its place in the list, round again after the eighth. The page sets `--tone` on the row and group from that (or from the colour the owner chose); a category's chip in the toolbar shows its tint on its icon (a colour the owner chose does not show there); the stylesheet no longer turns the accent by category id. A place or request that carries `eat`, `do` or `travel` is read as `food`, `activities` or `transport` (and the other way round against a list stored before the library); nothing is rewritten.
- **Types.** `maps-list-lib-types.json` (inlined by the build as `LIB_TYPES`): `{ id, label, category, icon, aliases, osm? }`, 153 of them, checked by `tools/check-maps-list.mjs`. A place keeps `type` (a type id), and optionally `icon` with `iconOwn: true` (the person chose it), `color` (one of the eight tint names) and `status` (`want`, `booked`, `visited`, `favorite`). What is drawn: icon is the place's own, else its type's, else its category's; colour is the place's own, else its type's, else the category's chosen colour, else its automatic tint. The drawn icon is stored in `icon` so the summary carries it (`icon`, and `visit` from `status`).
- **The form** is, in order: Name; `#f-look`, one row (`role=group`) of `#f-type` (a `host.ui.kindPicker`, one group per category of the list, Other last, found by name and aliases; a type is always set, Custom Location by default; the category follows the type and is not a field), `button#f-icon` (opens a searchable list, first entry "Same as the type") and `button#f-color` (opens the eight tints, first entry "Same as the category"); then Shows in, Address, Position, `#f-status` (`.status-btn` toggles, `aria-pressed`, pressing the chosen one clears it), Notes and Whose is it. The place menu gains a **Status** submenu.
- **A row** shows `.visit` (the status's icon and word) in `.meta` when the place has a status. The filter also matches the type's name and aliases.

## Shows in: one place, one home, marks (0.12.0; plan-places-library.md, Part A)

- **The record** gains `spaces` (up to 20 space ids): the spaces an environment's place is marked into. Only an environment's place carries marks; they only filter lists and maps, and the summary carries them (`spaces`). A record without `spaces` has none.
- **The home follows from the ticks:** Everyone ticked keeps the place in the environment's store (the ticked spaces as marks); one space alone keeps it in that space's store; Mine alone keeps it private in the person's store. Two spaces or more without Everyone is refused ("To show it in more than one <space>, it must be in <environment> too."). Another space can be the home only from an environment page; a space's canvas reaches only its own store.
- **Mine beside a shared home** is a bookmark in the person's own store: `saved:e:<id>` or `saved:s:<space id>:<id>`, holding `{ ref, title }` (the home's pointer). Never written on the shared record.
- **A move** (a change of ticks that changes the home) keeps the id, writes the new home first (only over nothing, or over that store's own forward), then a forward in the old home: `place:<id>` = `{ title, movedTo: { scope, space? } }`, no address, position or notes. Links move to the new pointer. Lists hide forwards; a pointer to the old home is followed (opening it says "This place is no longer shared here." when the new home is not readable). A failed second write says so in a toast and leaves the place readable in its new home.
- **The form:** `fieldset#f-where.sdk-section` (legend **Shows in**, `aria-describedby="f-where-line"`): `#f-where-ticks` of `label.sdk-choice-row` (`tpl-tick`: a native checkbox, `[data-slot=label]`, `[data-slot=hint]`) for **Everyone in <environment>**, this space, the other spaces where the viewer may add places (on a space's canvas under `details#f-where-more`, "More <spaces>"), and **Mine** ("On your own list. Only you see that you saved it."); a tick the viewer may not change is disabled with its reason in the hint. `#f-where-line` says who will see it ("Everyone in Coffee Pub sees it.", "Only people in <space> see it.", "Only you see it.", or why it cannot be saved). `#f-where-notes` says "Its notes will be seen by everyone in <where>." when a private place with notes is being shared. Rows are 44 px on a phone.
- **The default** for a new place: Everyone (when the viewer may add there), plus this space on a space's canvas or its Map, plus Mine in the Mine view; without Everyone, where the person is.
- **Narrowing** (Everyone to a space or Mine, a space to Mine) asks first with `tpl-narrow` above the buttons: "People in <environment> will no longer see it." with **Keep it shared** (the ticks go back) and **Take it away**.
- **A change of marks only** is retried once on a 409 (read again, the same add or remove applied), so two people ticking two spaces at once both win.
- **The place menu:** **Take off <this space>** (in a space, on an environment's place marked for it), **Add to my list** / **Take off my list** (a shared place), and **Delete**, armed as "Delete it for everyone? It is in <spaces> and Everyone in <environment>." when it shows in more than one place.
- **A row** shows `[data-slot=marks]` (`tpl-mark`, one per space it is marked into that the viewer is in, not the one being looked at). A saved place the page cannot show is a row with `.saved-only` and `[data-slot=saved-state]`: "In <space>" (another space's, which a space's canvas does not read; its menu offers **Open in <space>**) or "No longer shared with you" (its menu offers **Take off my list**).
- **The lists:** this space's is the places kept there and the environment's marked for it; Everyone's is the environment's; Mine is the person's own and their bookmarks, each followed to its home. Each place once, keyed by its home. A guest on a guest link reads only the space's store.
- **Actions:** `addPlace` takes `in` ("environment space person"; default Everyone and this space, else this space) and answers the home's pointer; a request that is not the person's own never adds to a private list. `sharePlace` (local, so only the person's own page carries it out) takes `{ place, in? }`, moves or marks the place as the form would, and answers the new pointer. `setPlacePoint` follows a forward.
