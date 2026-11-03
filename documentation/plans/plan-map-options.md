# Map Options Plan

**Audience:** Thomas decides which map themes ship, how a theme picks its default and what else goes in Map options.
experience-design draws the Prototype, then builds the map themes' tokens, the Maps module's **Map options** entry and its
panel; server-development builds the theme's default field in `/theme.css` and extends `tools/check-maps.mjs`;
quality-assurance checks the map reads on every theme; content-manager documents.

**Status:** Draft, 2026-11-03. This plan proposes; Thomas decides. Where it came from: a map in a dark app theme is hard
to read, and Thomas asked about a light version of the map. His direction, 2026-11-03: "we disconnect the map from
themes and create specific themes for the map experience. We can default it for a theme, but the user can click the
"..." menu and open map options for the space. We will want to add more to that at some point anyway, right? Like
details to show, etc." The same day Thomas decided the choice is each person's own, not the space's (decision 2).

Related: [plan-maps](plan-maps.md) (the themed style, "a light theme gets a light map"), [plan-themes](plan-themes.md)
(what a theme holds and how `/theme.css` is written), [plan-map-image](plan-map-image.md) (the picture map),
[plan-prototype-real-modules](plan-prototype-real-modules.md) (the Prototype), #44 (a map in the Planner).

## What it is today

- **The map follows the app theme.** `public/sdk/system.css` defines the `--map-*` tokens (land, water, park, wood,
  three roads, building, label, boundary) as mixes of the app theme's `--text-primary`, `--surface-panel` and tints, with
  a light override under `data-theme-mode="light"`. A dark app theme always gives a dark map.
- **How Maps reads them.** `modules/maps/src/maps.js` `tokens()` probes each token with `tokenProbe` (a span added to
  `#app`, its computed colour read) and hands them to `buildStyle` in `modules/maps/src/maps-lib-d-style.js`. On
  `host.on('theme')` the map calls `setStyle` again.
- **The readability clamp.** `guardMap` moves every colour until it holds `MAP_MIN` against the land (names 4.5:1, major
  road 3, minor 1.7, water 1.5 with a hue of its own, and so on). It mixes toward the app's text colour, else black or
  white. `tools/check-maps.mjs` holds the shipped app themes to it.
- **The layers.** Land, landcover, parks, water, buildings (from zoom 15), paths and three road classes, country and
  region borders, and three levels of place names. No points of interest, no transit, no terrain (the map files carry
  no elevation).
- **The "..." menu.** A module already puts an entry in its title bar's "..." menu with a toolbar entry of
  `placement: 'menu'` (`host.toolbar.set`, `public/sdk/host.js`). Maps uses `host.toolbar.set` for its search today and
  has no menu entries of its own.
- **A person's own data.** `host.storage` with `{ scope: 'person' }` is the viewer's own, in this environment, reachable
  by no one else (`server/index.js`, the storage guard). The module must list `person` in its `scope` (Maps lists
  `environment` and `space`), and `access.personWrite` (Research and the Vault use `"view"`) lets anyone who can open the
  module write it. Guests have no personal data: the server refuses them.
- **The picture map** is a raster picture; the map themes do not change it.

## Decisions

1. **The map has its own themes, apart from the app theme** (Thomas, 2026-11-03). A map theme is chosen on its own; an app
   theme can give a default.
2. **The choice is each person's own, not the space's** (Thomas, 2026-11-03). It needs no permission: anyone who can see
   the map can choose how it looks to them. A default set for a space is left as a possible later question (open
   question 6).
3. **It is chosen from the module's "..." menu, in Map options** (Thomas, 2026-11-03), a panel with room for more
   options later, such as which details to show.

## The contract

### What a map theme is

A map theme is a named set of the `--map-*` colours, fixed and not mixed from the app theme, plus three colours the clamp
mixes toward: its own ink, blue and green (`--map-ink`, `--map-blue`, `--map-green`). It is tokens only, in
`public/sdk/system.css` beside today's `--map-*` block, under a selector on the element that holds the map:

- `[data-map-theme="light"]` and `[data-map-theme="dark"]`: the two first map themes (open question 1).
- No attribute: today's tokens, mixed from the app theme. This is **Theme default** when the app theme names no map
  theme of its own.

Because `tokenProbe` already reads from inside `#app`, setting `data-map-theme` on `#app` is all the module does to switch;
`tokens()` also reads `--map-ink`, `--map-blue` and `--map-green` when they are set and passes them to `buildStyle` as the
`text`, `blue` and `green` the clamp uses, so a light map is clamped toward its own dark ink, not the dark app's pale text.

`guardMap` and `MAP_MIN` stay as they are and run last on every map theme. `tools/check-maps.mjs` adds each map theme as a
case: every colour holds its minimum with nothing moved by the clamp (a shipped map theme that needs the clamp is a
defect in the theme, not a case for the clamp).

### The app theme's default

A theme gains one optional field per set (light and dark): `map`, one of `"light"`, `"dark"` or absent (Theme default,
today's mixed map). `server/theme-css.js` writes it as `--map-default: light;` (or `dark`) in that set's block, from a
fixed list of words, never free text. Maps reads `--map-default` with `getComputedStyle` and uses it while the person has
chosen nothing. The theme editor shows it as one choice, **Map**, under the set's colours. Import and export carry it.

### The person's choice

- Stored in Maps' own data, scope `person`, key `options`: `{ theme: "light" | "dark" }`. No key, or no `theme`, means
  Theme default. Later options are more fields of the same value.
- Maps' `module.json` adds `person` to `scope` and `"personWrite": "view"` to `access`, and its version goes up.
- The choice is the person's in every space of the environment, and on the Map layout, Global Map and the module's own
  page alike.
- A guest has no personal data on the server; see open question 4.
- On a change in another tab (the `change` event for `options`), the map switches.

### Map options

- **The entry.** **Map options** in the title bar's "..." menu, a toolbar entry with `placement: 'menu'`, icon `sliders` (proposed).
  It is there wherever Maps is drawn with a title bar, for everyone who can see the map.
- **The panel.** A small panel over the map's corner, opened by the entry and closed by Escape, a click outside or its
  close button. It saves on every change, with no Save button, and the map redraws at once.
- **First section, Map theme:** three choices, each with a small swatch of land, water and a road: **Theme default**,
  **Light**, **Dark**. The current one is marked. With a picture map the section shows one line instead: "A picture map
  keeps its own colours."
- **Room for later sections**, each a heading and its controls under the first, not built now: **Show on the map**
  (place names, buildings, borders, paths; transit once the style draws it; terrain only with an elevation file, which
  the map files do not carry), and **Units** (kilometres or miles, once the map has a scale or distances).
- Words a person reads, proposed: "Map options", "Map theme", "Theme default", "Light", "Dark".

### What stays where

- **SDK** (`public/sdk/system.css`): the map themes as tokens, so another module that draws a map (the Planner's, #44)
  can use them. Nothing new in `host.js`: the "..." entry is the existing `placement: 'menu'`.
- **Maps module:** the choice, its storage, the entry, the panel, the switch, the clamp and the style. If a second module
  ever needs the same options, the panel moves to the SDK then, not now.
- **Server:** only the theme's `map` field and its line in `/theme.css`.

## Left to build, in order

0. **Prototype first** (experience-design). Draw, for Thomas to look at before anything changes in the product:
   the Light and Dark map themes, each under a dark and a light app theme, with pins, a selected pin, place names on
   land and water and the search results over the map; the "..." menu with Map options; the panel on a desktop window
   and at 390px, with the three swatches; the panel with a picture map; a sketch of the later Show on the map section,
   marked as not built. The Maps design mock (`modules/maps/design/map.html`) or the Design System Prototype.
1. **The map themes' tokens** (experience-design), in `public/sdk/system.css`, and their cases in `tools/check-maps.mjs`
   (server-development).
2. **The Maps side** (experience-design): `module.json` scope and access, `tokens()` reading the new tokens, the
   `data-map-theme` switch, the `options` key, the menu entry and the panel. A version bump.
3. **The app theme's default** (server-development for `server/theme-css.js`, the field's checking, import and export;
   experience-design for the theme editor's **Map** choice). Can wait: until then Theme default is today's map.
4. **Documentation** (content-manager): `documentation/designsystem/design-theme.md` (The map), the Maps user guide and
   the module and theme API documents.

## Verify

- Step 1: `tools/check-maps.mjs` (checked by a tool): each map theme holds `MAP_MIN` untouched by the clamp (a map theme is
  the same under every app theme, so once each).
- Step 2: in headless Chromium, the entry is in the "..." menu, the panel saves `options` in person scope, a reload keeps
  it, a second tab follows, a guest gets what open question 4 decides. Drawing the map needs WebGL and a map file: the
  colours as drawn are verified only in a real browser (`tools/check-maps-live.mjs` where WebGL is there), and that must
  be said in the report.
- Step 3: `/theme.css` carries `--map-default` only for the fixed words; an unknown word is refused on save and import.
- None of this touches a call, so nothing here waits on a real LiveKit call.

## Effort and risks

- **Effort:** small to medium. Step 1 is a token block and test cases; step 2 is one panel and a stored value in an
  existing module; step 3 is one field through the theme store, `/theme.css` and the editor.
- **Pins and overlays.** Pins, the search results, the place card and the credit are drawn in the app theme's colours. On a
  light map in a dark app they must still read: the Prototype must show it; a pin may need a ring in the land colour.
- **Theme values that are not colours.** `/theme.css` has written only colours (plan-themes: "Only colors"). The `map`
  field is the first word; it must come from a fixed list.
- **A wider scope for Maps.** Adding `person` to Maps' scope may change what an install asks to approve; server-development
  confirms this in step 2.

## Open questions

1. **Which map themes ship first?** Recommendation: Light and Dark, beside Theme default. Ideas for later: Muted (grey, so
   pins stand out), Parchment (warm, for a game's world), High contrast.
2. **Do the shipped dark app themes default to the Light map?** That would answer the complaint for everyone without a
   choice. Recommendation: yes for the shipped dark sets; a new theme defaults to Theme default.
3. **Does Theme default (today's mixed map) stay a choice once Light and Dark exist?** Recommendation: yes; it is what an
   owner's own theme colours give, and removing it is a step back for a custom theme.
4. **What does a guest get?** Guests have no personal data on the server. Recommendation: the choice kept in the browser
   for a guest (local storage), so the panel works the same; the other option is no Map options for guests.
5. **One choice per environment, or across all of a person's environments?** Person scope is per environment.
   Recommendation: per environment, as built; across environments would need a profile field on the host.
6. **A default set for a space, later?** An owner or moderator could set a space's default, which a person's own choice
   overrides. Recommendation: not now; revisit only if a group asks for one look.
7. **Is the panel a panel or a menu flyout?** A flyout under "..." (Map theme, then the three choices) is less to build
   but has no room for later sections. Recommendation: the panel, as Thomas described.
