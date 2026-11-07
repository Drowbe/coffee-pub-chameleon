# Theme and Design Tokens

**Audience:** anyone styling a page, a panel or a module against Coffee Pub Chameleon, who needs the
colors to follow whatever theme the admin has chosen.

Admins can re-theme Chameleon from the Theme tab of the Manage page, including light themes. A theme
changes colors only, never layout. Anything drawn with a fixed color will be unreadable on some
server, so every color must come from the tokens below.

## How a theme reaches a page

Every page links `/theme.css` after `style.css`. The server renders it from the active theme (`server/theme-css.js`)
with both of the theme's sets, the light one under `html[data-theme-mode="light"]` and the dark one under
`html[data-theme-mode="dark"]`, as overrides of the seven base tokens and of each optional token the theme sets. An
untouched server sends only the default theme's light set, so it looks exactly like the defaults in `style.css`.
`public/theme-mode.js` sets `data-theme-mode` from the person's own choice (their account's `themeMode`, or
`app.themeMode` in the browser for a guest), else the environment's default, and swaps it without a reload when
either changes; `branding()`'s `themeMode` and `themeVersion` and the notifications stream's `theme` and `mode`
events tell an open page. A person's own choice is `PATCH /api/me` `{ themeMode: 'light' | 'dark' | null }` (`null` follows the environment's default again; anything else answers 400 "the mode is light or dark, or null to follow the environment's default"), shown as `user.themeMode`. Draw every colour from the tokens and both modes follow. A theme is shared as a `.theme.json` file (`{ format: "theme", formatVersion: 1, name, author?, light, dark }`, each set with the 16 stored keys); the routes are in [architecture-overview](../architecture/architecture-overview.md), "Themes", and the owner's steps in [userguide-themes](../userguides/userguide-themes.md). Because it is an ordinary stylesheet link, the popped-out
call window picks the theme up too, when the page clones its stylesheets into the new window.

## The tokens

The theme editor sets the first seven, and may also set the thirteen in the second group. Every token in the second
group follows the base colors until a theme sets it (**Auto**), so a theme that never touches one keeps
working. The rest are derived with `color-mix`.

| Token | Use |
|---|---|
| `--bg` | page background (labeled Page background in the theme editor) |
| `--bg-section` | section background: panels, popovers, the active tab (labeled Section background in the theme editor) |
| `--border` | outlines and dividers |
| `--text` | body text |
| `--text-dim` | secondary text |
| `--accent` | links, highlights and primary buttons |
| `--on-accent` | text and icons drawn on an `--accent` background |
| `--bg-card` | card background: the small items inside a section, such as member tiles, facts and thumbnails; Auto is `--bg-input` |
| `--header-bg` | header background, drawn as a soft gradient from this color; Auto is `--bg` |
| `--header-text` | header text, the server name, breadcrumb and signed-in name; Auto is `--text` |
| `--nav-brand-bg` | the top bar's branding area (the logo and the environment's name), labeled Branding area background; Auto is `--nav-primary-edge-bg` |
| `--nav-brand-text` | text in the branding area, labeled Branding area text; Auto is `--header-text` |
| `--nav-right-bg` | the top bar's right zone (the bell and your picture), labeled Right side background; Auto is `--nav-primary-edge-bg` |
| `--nav-right-text` | text in the right zone, labeled Right side text; Auto is `--header-text` |
| `--nav-primary-bg` | the top bar's left zone (Calendar, Map, the home word and where you are, up to the right zone); Auto is `--header-bg`. Not set by a theme |
| `--nav-primary-edge-bg` | the shared Auto of the branding area and the right zone, a whisper darker than the header: `color-mix(in srgb, var(--header-bg) 97%, black)`, opaque so the editor's colour box shows it truthfully. Not set by a theme |
| `--nav-secondary-bg` | the header's second row, in one colour: the status strip in a space, and the page bar on every other page; Auto is a 2% black overlay on the header colour. Not set by a theme |
| `--icon` | icons in the page, chat and header; Auto is dim text on the page and a softened header text in the header |
| `--icon-hover` | icon hover; Auto is `--accent` |
| `--primary-hover` | Primary buttons on hover; Auto is a lighter `--accent` |
| `--secondary` | Secondary buttons, and the toolbar buttons in the call; Auto is `--surface` |
| `--secondary-text` | text on Secondary buttons; Auto is `--text` |
| `--secondary-hover` | Secondary buttons on hover; Auto is `--surface-hover` |
| `--bg-input` | inputs |
| `--surface`, `--surface-hover` | raised surfaces and their hover state |
| `--shade` | recessed areas |
| `--ok`, `--danger` | status colors |
| `--on-danger` | the glyph or text on a solid `--danger` or `--ok` button (the call's leave button, dial back in); `#fff`, and the theme editor does not set it |
| `--selected-bg` | the fill of a selected, on, active or current control: 28% of `--accent` over what is behind it, `color-mix(in srgb, var(--accent) 28%, transparent)`. Derived, so it follows a theme's accent |
| `--danger-text`, `--accent-hover` | lightened forms of danger and accent |

## Rules

1. Take every color from these tokens. For a see-through tint use `color-mix`, for example
   `color-mix(in srgb, var(--text) 8%, transparent)`, never `rgba(255, 255, 255, .08)`.
2. Text on an `--accent` background uses `--on-accent`, not white or black.
3. Never assume a dark background. Test every new surface with a dark and a light theme.
4. Scrims and shadows may stay black, because they darken whatever is behind them rather than
   standing in for a theme color.
5. A button is Primary (`--accent` with `--on-accent`) or Secondary (`--secondary` with `--secondary-text`); do not invent a third look. Hover comes from `--primary-hover` and `--secondary-hover`. The square icon button of the bottom row is the action button (see "The action button" below), not a button of its own.
6. A fixed color is acceptable only where it carries a meaning the theme must not change, such as the
   red of a muted badge, and then its text is fixed too so the pair stays readable.
7. Anything drawn on its own, such as a canvas or SVG, reads the tokens with `getComputedStyle` and
   redraws when the theme changes.

8. **A selected, on, active or current state is a fill, never a border.** Show it with `--selected-bg` (and the text colour the control already has), not with an added border, outline or ring. No tab underline, no coloured edge, no inset shadow. See "Selected states" below.

A fixed dark background under theme-colored text is the classic failure: it looks correct on the
default theme and unreadable on a light one.

**The top bar's three areas.** The branding area, the left zone and the right zone each have a background and a text colour; each area sets `--header-text` to its own text token for what is inside it, so names, carets and icons that fall back on the header text follow. Until a theme sets them, the branding area and the right zone are `--nav-primary-edge-bg` with the header text, which is how the bar always looked. In the narrow layout only the branding area keeps its colour. How the bar is built is in [architecture-navigation](../architecture/architecture-navigation.md).

## Corner radii

A corner is never written as a number. Every `border-radius` is one of five tokens, defined once on `:root` in `public/style.css` and again in `public/sdk/host.css` for a module's page (the two must match), so a change to a corner is a change to one token.

| Token | Value | Use |
|---|---|---|
| `--radius-min` | 3px | tiny tags, scrollbar thumbs, `kbd`, checkboxes, the ends of bars |
| `--radius-small` | 5px | buttons, inputs, tabs, chips, menu items, the segments of a view switch |
| `--radius-medium` | 7px | cards, menus, popovers, list rows that are boxes |
| `--radius-large` | 11px | panels, windows, dialogs, sheets, the kind list |
| `--radius-round` | 999px | avatars, dots, badges, pills, the call toolbar's buttons; on a square box it is a circle |

Pick the token for the kind of thing, not the size it happens to be. Two shapes follow from this: the call tile's portrait when the camera is off is a circle (it was a rounded square), and the call toolbar's buttons are circles.

`tools/check-radius.mjs` (part of `npm run check`) fails on any `border-radius` that is not `var(--radius-*)`, `0`, `inherit` or `unset`, in every stylesheet and in the inline styles in scripts and pages, and when either file lacks a token. Its allow-list holds two things: the map pin, a teardrop drawn as `50% 50% 50% 4px` in the Maps and Planner stylesheets (a circle with one square corner, which a `999px` radius would round away), and MapLibre's own library files. SVG `rx` and `ry` are not read.

## Selected states

A control that is selected, on, active or current (a layout tab, a view switch, a pressed tool, a chosen day, a checked
option) shows it with a fill: `background: var(--selected-bg)`. It never adds a border, an outline or a ring to say so
(Thomas, 2026-10-14: "I found ANOTHER button border. Stop adding them."). A fill follows the theme's accent on a dark
and a light theme alike.

`tools/check-nav.mjs` enforces it. It reads `public/style.css`, the SDK's styles and every bundled module's styles, and
fails on any rule whose selector names a state (`.on`, `.active`, `.selected`, `.current`, `.today`, `[aria-pressed]`,
`[aria-selected]`, `[aria-current]`, `:checked` and the like) and that declares a border, an outline colour, or an inset
or ring shadow. A border colour that is the same as the rule's own fill does not count, since the fill covers it. These
stay allowed:

- **Focus rings.** `:focus` and `:focus-visible` keep their outline; it is how the keyboard shows where it is.
- **Hover borders.** A border that appears on hover is not a state.
- **Drag targets.** A drop target shows where a thing will land.
- **The phase band for today** (`.phase-band.current`) on the phase timeline. A band is a chart mark, not a control; its
  fill already carries the phase colour, so the ring is the only thing left to say "now".
- **The Maps selected pin** (`.pin.selected .pin-body`). A pin is drawn on a map, not a control; its ring picks it out on
  a busy map.

Anything else that needs an exception is added to the check's list with its reason, and Thomas decides.

**The Calendar's days.** Today and the chosen day are told apart. The chosen day is a solid accent fill with the on-accent text in the dark modes (`--cal-sel-bg`, `--cal-sel-text`) and a lighter fill (32% accent over the field) with the primary text in the light mode, so the brown is not the heaviest thing on the page. Today wears a 1px inset ring in both (`--cal-today-ring`) over its own fill. The focus ring on the chosen day is a double ring, the text colour outside and the on-fill colour inside, each 3 to 1 or more. A task still to do that is late is not dimmed like a past event: it takes `--text-danger`, which reads 4.5 to 1 on a raised step in the dark modes too.

The Calendar's sizes and shares are tokens in the `calendar` block of `public/sdk/system.css`: `--cal-cell-h` (74px, a cell's least height), `--cal-chip-h` (18px, an event chip), `--cal-hover` and `--cal-press` (10% and 16% of the text colour over a cell), `--cal-today` (14% of the accent), `--cal-tint` (22%, an event's tone over its cell), `--cal-out` (0.55, a day outside the month), `--cal-bar` (3px, the kept bar), `--cal-ph-wash` (16%, a phase's wash) and `--cal-dim` (muted text on a fill). The chosen day is `--cal-sel-bg`, `--cal-sel-bg-hover` and `--cal-sel-text`, and today's ring is `--cal-today-ring`.

## Tints

Eight named colours mark what a message or a module is from: a module's own colour (its manifest's `color`), and gold for the AI. They also mark a **phase**: each phase of a space's timeline wears one, by its place in the template's list. They are fixed, not part of a theme, and no theme sets them; each has a dark and a light value, tested on both. On a light page the darker value is used: under the stylesheet's light set (`data-theme-mode="light"`), or the environment's light default when the person has made no choice (`data-mode-shown="light"`, set by `public/theme-mode.js`).

| Token | Dark | Light |
|---|---|---|
| `--tint-gold` | `#d9a93c` | `#94680a` |
| `--tint-blue` | `#6aa6e8` | `#2a62b0` |
| `--tint-green` | `#6fbf73` | `#2e7d32` |
| `--tint-teal` | `#4fbfb2` | `#00796b` |
| `--tint-purple` | `#b18be0` | `#6a3fb0` |
| `--tint-red` | `#e07a6e` | `#b3372b` |
| `--tint-orange` | `#e8964a` | `#b35a00` |
| `--tint-pink` | `#e58ab8` | `#ad3a78` |

`data-tint="<name>"` on an element sets `--tint` to that token. A tint colours an icon and a thin edge only (a message's 3-pixel left edge and its portrait's icon, a module's icon in its titlebar and the Layout menu); text and backgrounds keep their usual tokens. The tokens are in `public/style.css` and in `/sdk/host.css`, so a module's page has them too.

**Phase colours.** A phase has no colour of its own in a template. Its place in the template's list picks one of the eight, in this order: `blue`, `green`, `teal`, `purple`, `orange`, `pink`, `gold`, `red`, and round again after the eighth (`Phases.tintOf()` in `public/phases.js`). The same phase has the same colour in the status strip, the timeline sheet, Set up's phase rows and a module that draws `host.util.phaseTimeline()`'s bands (each band's `tint` names it). A phase's colour is a fill and a dot, never a coloured border (Thomas, 2026-10-14: "no colored borders"): a band is a wash of `var(--tint)` mixed into transparent (`color-mix(in srgb, var(--tint) 22%, transparent)` ahead of today, 12% behind it, and a stronger mix of 50% with `--header-bg` for today's band) inside a neutral `--border` edge; the dot beside the phase chip is solid `var(--tint)`; and in the timeline sheet a band has a 4px top edge in the tint with a 16% wash. The colour never carries the meaning alone: every band is named, and today's band says "now".

## The map

The Maps module draws the map from the theme's tokens, so a light theme gives a light map and a dark theme a dark one. The tokens are in `public/sdk/system.css`, and the module reads them to build its style (`modules/maps/src/maps-lib-d-style.js`). They follow the SDK's own names (`--text-primary`, `--surface-panel` and the tints), not the older `--bg` and `--text` of the table above.

| Token | Use |
|---|---|
| `--map-land` | the land: dark, a hair off the panel (4% of the text colour over `--surface-panel`); light, the panel itself |
| `--map-water` | water: the blue tint, 38% over the page (dark) or the panel (light) |
| `--map-park`, `--map-wood` | parks and woods: the green tint over the land, 16% and 9% |
| `--map-road-minor`, `--map-road-medium`, `--map-road-major` | roads, one ladder of the text colour over the land. Dark 20%, 30% and 42%; light 27%, 39% and 50% |
| `--map-building` | buildings: 10% (dark) or 12% (light) of the text colour over the land |
| `--map-label` | small place names: the text colour 40% over muted text |
| `--map-boundary` | borders between countries and regions: muted text |

**The guard.** A theme may set any of these badly, or have colours that put two of them together. So the Maps style moves every colour, last, until it holds a minimum against the land (`MAP_MIN` in `maps-lib-d-style.js`; the ratio is WCAG's, lighter plus 0.05 over darker plus 0.05). A colour that already holds is not touched.

| Part | Minimum against the land |
|---|---|
| Place names | 4.5 to 1 (3 to 1 on water, where the halo is thin) |
| Roads | minor 1.7, medium 2.3, major 3, and each class at least 1.1 times stronger than the one below |
| Water | 1.5, and a blue of its own: a visible distance in hue from the land, whatever the land's tint |
| Parks, woods, buildings | 1.15, 1.06 and 1.15 |
| Boundary line | 2, as drawn |

`tools/check-maps.mjs` holds every shipped theme to these. `tools/check-maps-live.mjs` checks the Maps and Places pair in a browser and says SKIPPED when there is no Chromium.

**The pin.** A pin's body has a thin ring (`--pin-ring`, the text colour 60% over the panel) so it reads on any land. The selected pin's wider ring is an allowed exception to the rule on selected states below. At low zoom only the selected pin and the one under the pointer or focus show their names.

## Layout tokens of the bars

Sizes and type that are not colours; no theme sets them, and they live in `:root` in `public/style.css`.

| Token | Use |
|---|---|
| `--status-strip-h` | the space's status strip, the header's second row wider than the narrow layout: 44px. The strip is one fixed line, so its words arriving never change the header's height |
| `--status-strip-slim-h` | the same strip in the narrow layout, a slim line of the header under the top row: 28px |
| `--mf-status-h` | the status bar at the foot of a module's window (`host.status.set`): 24px. It is not the status strip. The module frame's other sizes are below |
| `--nav-font-size` | the size of the nav text: 13px |
| `--nav-font-weight` | the weight of the nav text: 600 |
| `--nav-letter-spacing` | the nav text's letter spacing: `normal` |
| `--nav-line-height` | the nav text's line height: `normal` |

**The nav text.** One type for every word in the top bar and the status strip (Thomas, 2026-10-14: "the correct one is the Workspace, Calendar, etc."). The layout tabs and links (`.core-link`) are the reference, and every other element in the bars that carries words wears the class `.nav-text` (the space switcher, Who is here, your name, **Join the call**, the phase chip, a band's name, a page bar's name and tabs, a labelled button the registry draws). `.nav-text` and `.core-link` read the four tokens above, with the page's own font family, and take the bar's link colour at rest (`--icon`, else the header text softened); what is current, such as the tab shown, the phase chip, today's band and the page's name, says `--header-text` in its own rule. `.btn.nav-text` outweighs the button's own type and keeps the button's colours. No element restates a size or weight of its own. The exceptions are the environment's name (the wordmark, larger), the "days to <phase>" caption under the countdown (a small caption) and the narrow layout's menu rows and tab bar. The class is for the app's own bars, not for a module.

## The module frame

Every module window is one frame, `createModuleFrame` (`public/module-frame.js`), in four levels top down: the title bar, the toolbar (one row), the content and the status bar. Its styles are the moduleframe block of `public/sdk/system.css` (classes `mf-*`); no module draws or styles them. Every size and surface is a token at the top of the block, so changing one changes every window. The pieces live on the **Prototype** page of the design system pages ([architecture-module-window](../architecture/architecture-module-window.md) says how the host draws them).

| Token | Use |
|---|---|
| `--mf-title-h` | the title bar: 36px |
| `--mf-band-h` | the toolbar: 40px |
| `--mf-status-h` | the status bar: 24px |
| `--mf-ctl-h` | a control in the toolbar or title bar (a button, the switch, the search, a tab): 28px; 44px on a phone (see "Taps on a phone") |
| `--mf-chip-h` | the Filters button and a chip: 24px |
| `--mf-inset` | the toolbar's sides and the content's padding: 12px |
| `--mf-search-w`, `--mf-search-min` | the search field's width, 220px, and the least it gives way to before it folds to a magnifier, 120px |

On a touch screen (`@media (pointer: coarse)`, not a width) `--field-font` is 16px and the search field (`.mf-search-input`) is 16px, so iOS does not zoom when one is focused. A title bar with no actions hides its empty tools group (`.mf-titlebar-tools`), so its title ends 4px from the edge.

The title bar and the status bar are the same, darker surface (`--mf-surface-title`, the panel colour mixed 70% with black); the toolbar is a step lighter than the panel and the content is the panel colour. An object's row in the content is a gentle tint of the theme's accent (`--mf-surface-row`, a little more on hover): a hint, not a card. A count anywhere in the frame (the Filters button, a tab, a menu entry) is the one shared `.sdk-badge`, and it shows the real number. The badge is a circle for one digit and a small rounded corner for two or more (a CSS `clip-path`). A chip (`.mf-chip`) takes its corners from `--radius-small`. The status bar is words with a dot between, never pills. A filter is not shown as a row of chips: the toolbar has one Filters button, and its menu holds the groups and **Clear filters**.

`node tools/check-surface-steps.mjs` measures it: neighbouring surfaces differ by at least deltaE 2.0 in every theme and mode, and the status bar equals the title bar. A theme below the minimum is named in the check's known list, never fixed by lowering the minimum.

## The banded card

The card a module draws for an object (the shared banded card, `.sdk-card-banded` in `public/sdk/system.css`) has a band at the top and a body under it.

- **The stacked head.** The band holds the kind label above the title. The title is 16px bold and wraps; it is never cut. The kind label is 11px, capitals, bold, in the kind's colour (`--tint`), and never cut. A plain head, with no icon and no kind label, keeps the 30px band for one line and gets 4px of padding above and below when the title wraps.
- **The icon is a solid circle** (`.sdk-card-icon`), not a tinted tile. The disc is the kind's colour at a fixed lightness, and the icon on it takes the page colour (`--surface-page`), dark in a dark theme and light in a light one. It is 36px in a banded head and 28px in a row (`.sdk-row`), set by `--card-icon`. Two tokens keep the contrast at 4.5:1: `--card-disc-l` for the disc (0.74 in dark mode, 0.5 in light) and `--card-kind-l` for the kind label (0.88 in dark mode, 0.38 in light). With no `--tint` the circle is neutral (`--text-muted`).
- **Narrow cards.** The banded head is an inline-size container. Below 300px it puts the icon above the text, then the kind label, then the title, for every module, so the title keeps the card's whole width.
- **Bars on a phone.** On a phone (the top page 640px wide or narrower), the shared title-bar and toolbar buttons, the view switch and the toolbar search are drawn 44px, not only given a 44px hit area: the title bar is 52px, the toolbar 56px and the switch track 50px. `public/theme-head.js` sets `<html data-phone>` from the top page's width, so a page inside a frame follows the top page, and `system.css` sizes the bars from it. Desktop sizes are unchanged. A page that does not load `theme-head.js` (the design-system prototype pages, `keyed.html`) keeps the desktop sizes.
- **Taps on a phone.** A small button or icon button keeps its look and gets a 44px hit area: `::after` grows the area past the box by `--btn-hit`, which counts the 1px border (`(--btn-h-small - 2px - 44px) / 2`). A module narrower than 720px does the same for its own controls (the Planner, see [architecture-modules](../architecture/architecture-modules.md)).

The banded card's kind label and disc follow the light values (`--card-kind-l` 0.38, `--card-disc-l` 0.5) whenever the page is shown in light: under the stylesheet's light set (`data-theme-mode="light"`) and also when the environment's default is Light and the person has made no choice (`data-mode-shown="light"`). Before this the second case kept the dark values, and the kind labels were hard to read on a light card. `tools/check-light-default.mjs` checks it in a browser.

## Icon buttons and danger text

An icon-only button (`.sdk-icon-btn`) is a square the same height as a button of its size. On a touch screen (`@media (pointer: coarse)`) a small one (`.sdk-icon-btn.btn-small`) is at least 44px by 44px; the icon stays small. A module that draws such a button gets the rule with the SDK stylesheet.

`--text-danger` is danger as text on a row or a chip, for an overdue date or an overdue task's marker. It is lighter than `--status-danger-text` in the dark modes (40% of the danger fill mixed into the text colour, against 70%), which reads 4.5 to 1 on the raised step where the other is 3.5 to 4.3, and the same as it in the light mode. Use `--text-danger` for danger text on a card or row, and `--status-danger-text` for danger text on the page.

## The time field

A time input (`host.ui.timeField`, [api-module-sdk](../api/api-module-sdk.md), "Time fields") is drawn as a text field in the Fields family, with tabular figures (`.sdk-timefield`), so "10:30 PM" and "22:30" line up in a column of them. On a touch screen it is at least 44px tall with 16px text. It is invalid (`aria-invalid`) the way any field is, and takes no colour of its own. The block is `timefield` in `public/sdk/host.css`.

## The object picker

The window that chooses another module's object (`host.objects.pick`, [api-module-sdk](../api/api-module-sdk.md), "Picking an object") is a dialog in the Dialogs family: 560px wide (`--dlg-w-form`), at most 640px tall, `--surface-panel` on a hairline, `--radius-large`, `--shadow-3`, with the Dialogs head, title and foot. Under the head is a search box and a status line (`.sdk-pick-status`, 12px `--text-muted`: searching, nothing found, could not search), then the results in a scrolling list of shared rows (`.sdk-row`, the kind's icon in a disc, the title, the subtitle and the module). The row the keys are on is `--fill-selected`; a ticked row (when several may be chosen) shows a check. At 640px and below it is a full-height sheet with 44px rows and a 16px search box, and rows are 44px on any touch screen. The block is `objectpick` in `public/sdk/system.css`.

## File chips

A file a module's object is linked to (`host.ui.fileChips`, [api-module-sdk](../api/api-module-sdk.md), "Linking files from your objects") is the Chips block's tag (`.sdk-chip-tag`) with a type icon, the name, truncated with an ellipsis, and the size in `--text-muted` (`.sdk-file-chip`). The chips wrap in a row with `--space-2` between them (`.sdk-file-chips`). A file that was removed or whose bytes are gone is a muted tag that is not pressed ("File removed", "File missing"); a missing one has its name struck through and its icon and word in `--status-warn-text`. A file this person may not see reads "Not available to you" with a lock. **Remove link** and **Unlink** are small quiet buttons beside the chip (`.sdk-file-chip-remove`). The block is in `public/sdk/host.css`.

## The share sheet and the public page

The sheet that makes a share link and the list of links (`public/share-sheet.js`, styles in `public/share-sheet.css`) are dialogs in the Dialogs family, 480px wide for the sheet, 520px for editing a link and 560px for the list, never wider than the screen less `--space-6`. They use the form fields, the three-way switch for the days a link lasts, a choice row with the shared switch for **Allow download**, and the action bar. The public page of a link (`public/shared.html`, `public/shared.css`) takes the environment's theme from `/theme.css` and uses only tokens: `--surface-page` for the page, a grid of cards (`--surface-card` on a hairline, `--radius-medium`) at least 150px wide, and the file windows' own views (`public/file-viewer-views.js`) for a file opened on it. Read as code; the Prototype's "Sharing outside" and "The public page" are the drawings.

## Muted text and Strong Coffee in light

The text colours are checked against their surfaces by `tools/check-theme-contrast.mjs`. In Strong Coffee's light mode, muted text is `#63564b` (5.07:1 on a card) and the accent fill is `#a6682a` (white text on it is 4.53:1). Some muted text on tinted surfaces is still under 4.5:1 in light mode; it is listed in [known-issues](../known-issues.md).

## The design system pages

`/design-system/` serves four pages with the same links at the top (the pages and how they fit are described in `public/design-system/README.md`):

- **Design System**: what is in production, each family drawn from the product's own stylesheets. `tools/check-design-system-catalog.mjs` (in `npm run check`) fails when an example uses a class no stylesheet defines, when a block of `system.css` has no family, and when the moduleframe family does not link to the Prototype page. `tools/check-design-system.mjs` opens the page in headless Chromium, served and as its snapshot from disk, and fails on a console error, an example frame that does not load, a sideways scroll or a page that does not finish drawing; it runs per scenario (`--scenario=1280:light`, `1280:dark`, `390:light`, `390:dark`). `npm run check` runs 1280:light; `npm run check:design` runs all four, and so does `.github/workflows/design-check.yml`, as parallel jobs on every push to main and every pull request.
- **Proposed**: changes staged for the design system, each with what, why and its status. Nothing is staged now.
- **Prototype**: the module frame drawn by the real `createModuleFrame` in four states, in each shipped theme, Light or Dark, at a width chosen at the top. A tweak made here is staged on Proposed, then built into production. The **Planner** section runs the Planner's own markup and stylesheets (`public/design-system/sources.js`, written by `node tools/design-system-snapshot.mjs --sources`, and `prototype-planner.js`) on a sample week, with a jump list to each part. A **Maps** section (design-process only; nothing in it ships) draws the map themes and the Maps module's **Map options** panel from [plan-map-options](../plans/plan-map-options.md), step 0, on a picture of a map made from the map tokens, in the app's dark and light themes side by side, for Thomas to judge before anything is built; its decisions of 2026-11-04 are drawn as decided and one question stays open. The pages are `prototype-maps.js` and `map-screen.html`. A **Light** switch, for Strong Coffee in light only, shows the current light mode and four candidates on the same screen: Paper, Cool mist, Cream and Contrast (`?look=`). The candidates are not shipped. `tools/check-prototype-parity.mjs` (in `npm run check`) starts a throwaway server with the screenshot seed, opens the real Planner and the Prototype's Planner at the same width in headless Chromium and fails when: the strip, Unscheduled, the phase bars, the day card and head, the cards, the joint and its +, the suggestions, the empty-day box or the more buttons differ in left edge, right inset or height by more than 1px (at 1280 light and dark, 700 and 390); the parts of a column do not share one left and right edge; the gap above and below a joint's + differs by more than 2px; a button at a real 390px viewport is under 44px; the Prototype at `?w=390` in a wide window does not draw as a real 390 window; or the Prototype's templates are not character for character those of `modules/travel/src/travel.html`, or `sources.js` is not what the stylesheets produce. With no Chromium it says SKIPPED and exits 0, and it fails when `CI` is set.
- **Legacy**: frozen records (the app's inventory before the design system, and System v1). System v1 is only checked to load: no console error, every frame drawn.

## The action button

`.action-btn` is the one square icon button of the bottom row: the call's controls and the chat's Send, and a module's own buttons that belong in such a row. (A module's add actions are the titlebar's **+** now, not a bar along the bottom.) It is Secondary, or Primary with `.primary`, and red for **Leave the call** (`.danger` on the call's toolbar). Two layout tokens size it; they are not colours and no theme sets them:

| Token | Use |
|---|---|
| `--action-btn-h` | the button's width and height: `--bar-control-h` (38px) on the app's pages, 38px on a module's page; a compact call toolbar and the narrow layout's sizes set it smaller (40, 34 or 30px) |
| `--action-icon-ratio` | the icon's size as a share of the button, `calc(20 / 38)`: a 20px icon in a 38px button, the same share at every size |

A smaller button sets `--action-btn-h` only, never the icon's size. The rules are written once in `public/style.css` and once, word for word, in `public/sdk/host.css` (between `action-btn:start` and `action-btn:end`); `tools/check-buttons.mjs` holds the two copies equal, the call controls and Send on `.action-btn`, and the bundled modules from sizing it or setting the tokens.

## The action bar of a page

The Save and Cancel bar of a settings or edit surface (`.action-bar`, from `actionBar()` in `public/action-bar.js`; [architecture-canvas](../architecture/architecture-canvas.md), "Set up") is locked to the bottom of its surface: `--bg-section` with a 1px `--border` line above, 12px by 16px of padding (the bottom padded by the safe-area inset), and `position: sticky; bottom: 0` so the content above it scrolls (`.action-content`, `overflow-y: auto`). Its status line ("Saved", a refusal) is `--text-dim`, 13px, semibold. **Save** is Primary and **Cancel** Secondary (small buttons); Save is disabled until something changed. The "Discard changes?" row replaces the buttons in the same place, with **Keep editing** and a danger-styled **Discard**. It uses no colour of its own. It is for the app's pages; a module's form uses the editor window's button row (`.sdk-editor-actions`), which looks the same.

## The switch

A view or filter switch (**Month | Week | Day | Agenda**, **Open | Done | All**, **All | Private | Public**) is one row of segments, each an icon beside its word, the chosen one marked. It is one radio group: the row is `role="radiogroup"`, each segment `role="radio"` with `aria-checked` (not `aria-pressed`), and only the chosen segment is a Tab stop. The arrow keys move to the next segment and choose it, **Home** and **End** go to the first and last, **Space** and **Enter** choose, and **Tab** leaves the row. The same switch (`.mf-switch`) is used by the module frame's view switch, Chat's **Discussion | Assistant** and a choice in a form (the Planner's **How you get there**); the keyboard is one listener in `public/sdk/host.js` (`hostSwitch.keydown`, `hostSwitch.rove`). When the row is too narrow for the words, every segment shows its icon only (`.tb-tabs-compact`), and the word stays the tooltip and the accessible name; a segment with no icon always shows its word. It takes its colours from the tokens above and needs no tokens of its own. The rules are in `public/style.css` for the app's pages and in `public/sdk/host.css` for a module's (`.tb-tabs`, `.tb-tab`, `.tb-tab-glyph`, `.tb-tab-word`, `.tb-tabs-compact`); a module draws one with `host.ui.viewSwitch` ([api-module-sdk](../api/api-module-sdk.md)) and never sizes it, which `tools/check-switches.mjs` holds.

## The editor window

A module's Add or Edit form opens as a window over the whole page: a modal `<dialog class="sdk-editor">` drawn by the SDK (`host.ui.editor`, [api-module-sdk](../api/api-module-sdk.md), "An editor window"). It is 560 px wide (`.sdk-editor-large`, 880 px, for the Planner's object form), at most the window less 48 px tall, centered, and a full-screen sheet at 640 px and below. It takes `--bg-section`, `--text` and `--border`, a `--radius-large` radius and a shadow; its backdrop is `color-mix(in srgb, var(--bg) 70%, transparent)`, the tint the modules' own overlays used before, and plain `--bg` in the narrow layout. The close button in the corner (`.sdk-editor-close`) is `--text-dim`, `--text` on hover with a 10% text tint behind it, and an `--accent` focus ring; the button row a module marks `.sdk-editor-actions` and the "Discard your changes?" row (`.sdk-editor-discard`) stick to the bottom on `--bg-section` with a `--border` line above. In the narrow layout the close button and the row's buttons are 44 px tall (the row sets `--action-btn-h`). No theme sets any of this, and the rules use no colour of their own (`tools/check-module-window.mjs` fails a fixed colour there). A module's form inside it sets only the layout of its fields, never a box, a width or a background of its own. The rules are in `public/sdk/host.css` between `editor:start` and `editor:end`.

## The kind picker

The field a form asks what a thing is with (`host.ui.kindPicker`, [api-module-sdk](../api/api-module-sdk.md), "Choosing a kind"; the Planner's **What is it**) is one row, `--bar-control-h` (38 px) tall, drawn as a field: `--bg-input` on a 1 px `--border` with a `--radius-small` radius, `--text`, and when focused an `--accent` border with a 2 px ring of the accent at 30%. A disabled picker is at 60% opacity. The chosen kind's icon sits on a 26 px round (`--radius-round`) chip at the start of the row, and each option in the list carries the same chip: its colour is `--kind-color`, a custom property the SDK sets on the chip and on the row from the option's `color` (any CSS colour; the accent until a kind has one), the chip's background `color-mix(in srgb, var(--kind-color) 22%, var(--bg-card))` and its icon `--kind-color`. The chosen option's chip is filled with `--kind-color` and its icon `--on-accent`, and its name is semibold. A marker type's colour is the owner's, not the accent, so on a light theme the chosen marker's icon can be low-contrast (white on a yellow); an open point for Thomas. The Planner's colours are its cards' own: the accent's hue turned by the kind's family (`TURNS` in `modules/travel/src/travel-lib.js`, with `oklch(from var(--accent) ...)` where the browser has relative colours, else a 65% mix of the accent and `--text`), and a marker type's own colour from the Planner's settings, so the kind in the field and its card on the plan look alike under any theme. The chevron is `--text-dim`.

The list (`.sdk-kind-list`) is `--bg-card` on a 1 px `--border` with a `--radius-large` radius, a shadow and 4 px padding, at most 360 px tall; group titles are `--text-dim`, 10 px, bold, upper-case, letter-spaced, and groups are divided by a `--border` line. The active option (the one the keys are on) is a 14% accent tint; "Nothing matches" is `--text-dim`. At 640 px and below the open picker is a sheet fixed to the bottom of the screen (`.sdk-kind.open .sdk-kind-sheet`): `--bg-section` with a `--border` line above, 12 px top corners, a shadow and the safe-area insets, over a tint of `--bg` at 60%; the field grows to 44 px and the input to 16 px so a phone does not zoom, and each option is at least 44 px tall. The chevron turns when the list is open, with a short transition unless `prefers-reduced-motion` is set. No theme sets any of this, and the rules use no colour of their own except the shadows' black (`tools/check-module-window.mjs` fails a fixed colour there). The rules are in `public/sdk/host.css` between `kind:start` and `kind:end`.

## Modules

A module runs in a sandboxed frame, so it cannot see Chameleon's stylesheet. The host reads the current theme from the page's computed style and hands it to the module on start, and the module SDK sets it on the frame's `:root` as CSS custom properties. A module written to the rules above follows the theme with no code. Chameleon also adds a small base stylesheet to each module page (`.btn`, `.btn-primary`, `.action-btn`, `.card`, styled inputs) built from the same tokens. The rules apply to module authors too; see [api-module-sdk](../api/api-module-sdk.md).
