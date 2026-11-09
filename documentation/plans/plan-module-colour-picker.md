# Colour Picker Plan

**Audience:** Thomas, who decides what the colour picker is and does; experience-design, who builds the SDK piece, the pages and the Design System entries; server-development, who builds the checks; and whoever builds the Whiteboard's use of it.

**Status:** approved 2026-11-09 (Thomas: "approve", with the answers in Decisions below); nothing built. Building starts next cycle (usage budget). The request came from the Whiteboard session: "we need a colour chooser where people pick and set their own colour for things. It should probably be provided by core, and may already exist." Thomas has said yes to a core SDK piece, `host.ui.colorPicker` (a palette, a hex field, recent colours, the browser's own chooser underneath), for the Whiteboard, Maps, Planner and Calendar to share, and has allowed a colour a person chose to be stored as a hex in module data. Nothing is built.

## What it is today

It partly exists. There is a colour picker, but only for the app's own pages, and it has no hex field, no recent colours and no theme colours. Each point below is marked **verified** (read in the code on `main`, 2026-11-09) or **inferred** (reasoned from the code, not tried).

- **The picker.** `public/colour-pick.js` (151 lines; verified). `colourPicker(input)` upgrades a native `<input type="color">`: a trigger button (`.sdk-picker`) with a swatch and the hex in words, and a popover (`.sdk-picker-pop`, `role="dialog"`) holding a grid of swatches (`role="radiogroup"`, one `role="radio"` each) and a **Custom** row, the browser's own colour input (lines 129-138). It sets the hidden input's value and sends `input` and `change` (67-72). Keys: the arrows move across the 8 columns, Home and End, Enter or Space choose, Escape closes and puts focus back on the trigger (74-89). It is placed under the trigger and kept inside the window (91-100). `upgradeColourInputs(root)` upgrades every colour input under a root (23-25).
- **Its palette is fixed, on purpose.** `PALETTE` (10-15) is 16 named hex colours (Amber, Orange, Red, Gold, Green, Teal, Cyan, Sky, Blue, Purple, Magenta, Pink, Stone, Brown, Sand, Ink). The comment (6-7) says why: "It does not follow the theme (a stored colour must look the same in every theme)". The swatch colour is passed as the custom property `--sw`, never as a declaration. Its validation is `/^#[0-9a-f]{6}$/i` (17).
- **Who uses it.** Only `public/module-settings.js` (verified): it imports it (8) and upgrades the `color` settings and the list settings' row colours (52, 194). A `color` setting is drawn as a native input with a hex check (89). Nothing else imports it. The admin theme editor's 40-odd colours (`public/admin.html:133-192`) are plain native inputs, not upgraded.
- **The module setting type `color` exists.** `server/module-settings.js:15` lists it; lines 52-55 refuse anything but `#rrggbb` ("must be a color, like #336699") and store it lowercase (verified). Stream declares ten of them (`modules/stream/module.json:41-78`), the plan in `plan-stream-module.md` (72, 93). The list setting's rows carry a hex `color` too (Planner's marker types, Budget's and Places' categories; `module-settings.js:15-23`). Planner draws one as `el.style.setProperty('--marker', type.color)` (`modules/travel/src/travel.js:414`; verified).
- **The styles.** The Pickers block of `public/sdk/system.css` (4482 on) styles `.sdk-picker`, `.sdk-picker-pop` and `.sdk-swatch`; selected is a check on a disc, not a border. A native colour input has its own rules (2808-2840). `tools/check-system-css.mjs:171-172` allows `--sw` as a per-element property (verified). A sandboxed frame has no `system.css` (`public/sdk/host.css:41`, verified), so a sandboxed module would not get the Pickers styles today (inferred).
- **The Design System.** `public/design-system/components.js:85-90` shows the colour picker trigger and the swatch grid under Pickers; `tools/shots-screens.json:1914` takes its screenshot (verified).
- **The theme's colours.** Eight tones (`--tint-gold`, `blue`, `green`, `teal`, `purple`, `red`, `orange`, `pink`), each with a dark and a light value, which a theme may override through the `tone-*` roles (`documentation/designsystem/design-theme.md`, "Tints" and "The optional roles"). Places stores a place's colour as one of these names, checked by the server (`server/index.js:6958, 7015-7017`; verified).
- **The Whiteboard.** `WB_PALETTE` (`modules/whiteboard/src/whiteboard-lib-a-core.js:21-34`) is Ink (`var(--text-primary)`) and the eight tints, stored by name, never as a colour, "so a block follows the theme and both modes". `wb.paint()` (128) refuses anything not in it. The renderer sets `--wb-fill`, `--wb-stroke` and `--wb-ink` to the token (`whiteboard-lib-d-render.js:91-97`). The board's background is a wash of a tint (`WB_WASH`, 18%, lib-a 68-76). The colour menus are `host.menu.show` rows with an `iconColor` swatch (`whiteboard.js:907-930`). `tools/check-no-raw-colours.mjs:16-18` exempts the palette's names in that module only (verified).
- **Contrast already exists, in the theme editor.** `public/theme-colour.js` (a plain script, also `require`d by the server) exports `hexOf`, `contrast(a, b)` and `pickOn(fill)`, which answers white or near-black, whichever reaches 4.5 to 1, with its ratio (102, 107-113, 205; verified). The SDK has no contrast helper (verified).
- **A known contrast bug this would fix.** `documentation/TODO.md:112`: the Planner's chosen marker icon is white on a yellow an owner chose (verified).
- **Recent choices, a precedent.** The kind picker keeps recent ids in `localStorage` under `app:kind:<module id>:<key>` (`public/sdk/host.js:983-986`; verified). The key has no person in it, so two people on one browser share the list (verified). In a sandboxed frame `localStorage` throws and the list is simply not kept (the `try` there; inferred).
- **Where SDK popovers draw.** `host.menu.show` draws inside the module's own root and is confined to the module's box (`host.js:1540-1548`; verified). `host.ui.confirm` is drawn by the page, over everything, through `call('ui.confirm')` (`host.js:2084-2088`; verified). A sandboxed frame reaches the server's scripts by URL as classic scripts (`/phases.js`, `host.js:28-40`; verified); an ES module import from a sandboxed frame would need CORS (inferred).
- **Not found:** no hex field, no recent colours, no theme colours in the picker, no "readable on" helper in the SDK, and the Whiteboard's "Override theme" is not in the repository yet (it was decided in the Whiteboard session).

## Decisions

- **The picker is core, an SDK piece named `host.ui.colorPicker`**, with a palette, a hex field, recent colours and the browser's own chooser underneath, so the Whiteboard, Maps, Planner and Calendar share one. (Thomas, relayed from the Whiteboard session: one piece rather than one per module.)
- **A colour a person chose may be stored as a hex in module data.** The rule "colours come from the theme tokens" in `CLAUDE.md` is about colours in code, not about a person's own choice. (Thomas.)
- **The Whiteboard gets "Override theme":** exact colours instead of tints, stored as `#rrggbb` in a block's data. (Thomas, in the Whiteboard session.)
- **The palette is both** (option 1C): the fixed colours, and a row of the theme's colours shown only when a module asks (`tones: true`). Stream and the settings need exact colours; the Whiteboard needs both. (Thomas, 2026-11-09.)
- **It is drawn inside the module by the SDK**, as a popover (option 2A), so it works in a sandboxed module too. (Thomas, 2026-11-09.)
- **Recent colours are kept in the browser, per person**, keyed by environment and person (option 3A); nothing on the server. (Thomas, 2026-11-09.)
- **The helper is spelled `host.util.colorName`**, matching `color` in the API. (Thomas, 2026-11-09.)
- **A theme colour comes back only through `onChange`**; the hidden input stays a colour input. (Thomas, 2026-11-09.)
- **The Whiteboard's board background stays theme colours only**; an exact background would fight the grid's dots in one mode. (Thomas, 2026-11-09.)
- **The admin theme editor's colour inputs are not upgraded**; it is a different job, one exact value beside the contrast panel. (Thomas, 2026-11-09.)

## The choices that were laid out

Kept for the record; Thomas chose 1C, 2A and 3A (Decisions above).

1. **Fixed colours or the theme's tones.** The existing palette is 16 fixed hex colours, chosen because a stored colour should look the same in every theme. The Whiteboard's palette is the theme's tones by name, chosen so a block follows the theme and both modes. The request asks for "a palette of the theme's tones".
2. **Where the picker is drawn**, which decides whether it works in a sandboxed module.
3. **Where recent colours are kept**, which decides whether they follow a person between devices.

### Option 1: the palette

| | What it costs | What it rules out |
|---|---|---|
| **A. The theme's tones only** (Ink and the eight, stored by name), plus a hex field | A module must store either a name or a hex, and handle both | One colour that looks the same everywhere, unless typed |
| **B. The fixed 16 only** (today), plus a hex field | Nothing new | Following the theme; the Whiteboard keeps its own menu for tones |
| **C. Both, in two rows**: **Theme** (Ink and the eight tones, follow the theme) above **Fixed** (the 16), then **Recent**, then the hex field and **Custom**; a module turns the Theme row on (`tones: true`) | A taller popover; two kinds of value | Nothing |

Suggestion, not a decision: **C**. The Whiteboard needs both (its tones today, Override theme tomorrow); Stream and the module settings need fixed colours only, and keep them by leaving `tones` off.

### Option 2: where it is drawn

| | What it costs | What it rules out |
|---|---|---|
| **A. Drawn by the SDK in the module's own root**, like `host.menu.show` | The code moves into `public/sdk/host.js` (one copy; the app pages use it too), the Pickers styles also go into `host.css` for sandboxed frames | A popover larger than a very small module |
| **B. Drawn by the page over everything**, like `host.ui.confirm` | A round trip per change, so no live preview while dragging the native chooser; a modal for a colour is heavy | Live preview |
| **C. The browser's own chooser only** | Nothing | The palette, recent colours, names for screen readers |

Suggestion: **A**, with the phone sheet the kind picker already uses on a narrow screen.

### Option 3: recent colours

| | Privacy | Cost |
|---|---|---|
| **A. In the browser**, per person: `app:colour:<environment>:<person key or guest id>`, one list for every module, 8 kept | Seen only on that browser; two people on one browser never share; nothing on the server | Lost on a new device. In a sandboxed frame the page keeps it for the module (a call), since the frame cannot |
| **B. On the server**, on the person's own record (`PATCH /api/me`) | Kept like the theme mode; a guest has none | A server route and a stored field for a small comfort |
| **C. None** | | Fewer steps lost |

Suggestion: **A**. Recent colours are a convenience, not data; a module never sees the list.

## The contract

Written for options 1C, 2A and 3A, as decided.

### The value

- A **colour value** is one string: `#rrggbb`, six lowercase hex digits, or a tone name: `ink`, `gold`, `blue`, `green`, `teal`, `purple`, `red`, `orange`, `pink`. Nothing else: no three-digit hex, no `rgb()`, no alpha, no `var()`, no other names.
- **A stored colour from someone else is untrusted.** Another person's block, setting or object reaches the page from a peer. A module passes every stored colour through `host.util.color.parse(value)` before it uses it anywhere. It answers `{ hex: '#rrggbb' }` (lowercase), `{ tone: 'blue' }` or `null`; `null` means "use your default". Never put a stored value into `innerHTML`, a `style` attribute in a template string, or `style.setProperty` without it. (A custom property accepts almost any text, `url(...)` included, so an unchecked value could make every viewer's browser fetch an address; inferred from how CSS custom properties work.)
- **What a tone draws as** is `var(--tint-<name>)`, or `var(--text-primary)` for `ink`, so it follows each viewer's theme and mode. **A hex draws as itself** for everyone. Two people with different themes see the same hex and different tones. That is the point of Override theme.

### `host.ui.colorPicker(input, options)`

- `input`: an `<input type="color">`; a module that stores theme colours takes the value from `onChange`. The piece hides it and puts a trigger before it, as `colour-pick.js` does now.
- `options`: `{ label, tones?: boolean, value?, onChange?(result) }`. `label` is what a screen reader hears ("Background").
- `onChange` gets `{ value, hex, tone }`: `value` is what to store; `hex` is always the colour as this viewer sees it now (a tone resolved in this page's theme), for a preview; `tone` is the name or `null`. The input's own `input` and `change` events still fire, carrying `#rrggbb`.
- Returns `{ set(value), open(), close(), destroy() }`.
- **What a person sees**, top down: **Theme** (Ink and the eight tones, only with `tones: true`), **Colours** (the 16), **Recent** (up to 8, only when there are some), then one row: a **Hex** field and **Custom** (the browser's own chooser). The chosen swatch shows the check, as today. The trigger says the name and hex ("Blue, #3b6fb6"); a tone says "Blue (theme)".
- **The hex field** takes `#` or not, three or six digits, any case, and shows `#rrggbb` lowercase once it is valid. While it is not, it says "Use 6 digits, like #3b6fb6." (`aria-invalid`), and Enter does nothing. A valid value is applied on Enter or when the field is left.
- **Contrast hint:** under the field, "Text on it: light" or "dark", from `readableOn`, and "Hard to read on this page" when the colour is under 3 to 1 against the page behind it (a hint, never a block).
- **Keys:** as today, plus Tab moves between the rows (one stop per row, arrows inside it). Escape closes without change.
- **Touch and phone:** on a narrow screen the popover is a bottom sheet (the kind picker's pattern); swatches are at least 44 px there.
- **Light and dark:** the popover uses the theme tokens; only the swatches carry the colour, through `--sw`.
- **Accessible names:** each swatch is named ("Blue", "Blue (theme)", "Recent: #3b6fb6, close to Blue").
- **What a module learns:** only the value the person chose. Not the recent list, not other modules' colours, not the person's key.

### Helpers in `host.util`

- `host.util.color.parse(value)`: above.
- `host.util.readableOn(value)`: `{ tone: 'light' | 'dark', ink: '#ffffff' | '#0a0a0a', ratio }`, the text colour that reads best on that fill, from `ThemeColour.pickOn` (the SDK loads `/theme-colour.js` the way it loads `/phases.js`). A tone is resolved in this page's theme first. A module may draw text in `ink` on a person's fill; a fixed pair is allowed by rule 6 of design-theme.
- `host.util.contrast(a, b)`: the ratio of two colour values.
- `host.util.colorName(value)`: the nearest of the palette's names, for screen readers and tooltips ("close to Blue").

### The module setting type `color`

- Unchanged on the server: `#rrggbb`, lowercase, refused otherwise (`server/module-settings.js:52-55`). A setting never stores a tone.
- The form draws `host.ui.colorPicker` without the Theme row, replacing the import of `public/colour-pick.js` in `public/module-settings.js`. `public/colour-pick.js` is removed once nothing imports it.

### Server

- Nothing new for the picker under options 2A and 3A. Module storage stays opaque to the server: a module validates what it stores and what it reads.

### Permissions

- None. Choosing a colour is part of whatever the module already lets a person change.

### Security

- No HTML from a colour: swatches and the trigger are built with `createElement` and `textContent`, and the colour reaches CSS only as `--sw` after `parse`.
- Recent colours are keyed by environment and person, so they never show for another person on the same browser or in another environment, and a module never reads them.
- A module learns nothing from the picker beyond the chosen value.

## Core and module lanes

- **Core (experience-design):** the SDK piece, the helpers, the styles in `system.css` and `host.css`, the module settings form, the Design System entries.
- **Core checks (server-development):** below.
- **Module lane:** the Whiteboard first (its own version bump); Maps, Planner and Calendar later, each by its own plan or request. The Planner's contrast bug (`TODO.md:112`) is one line once `readableOn` exists.

## Checks to add

- A new `tools/check-colour-picker.mjs` in `npm run check`: `parse` accepts exactly the values above and refuses `#abc`, `#ABCDEF` is stored as `#abcdef`, `url(x)`, `var(--x)`, `red`, `#12345g`, objects and a 7-digit hex; `readableOn` answers `dark` on `#ffffff` and `light` on `#000000` with the ratios; the picker builds no HTML from a value; the recent key holds the environment and person; `host.css` carries the Pickers styles; `public/module-settings.js` no longer imports `colour-pick.js`.
- `tools/check-design-system-catalog.mjs` and the screenshot list cover the new rows (Theme, Recent, the hex field and its error).
- The Whiteboard's own tests (`modules/whiteboard/test`): `wb.paint()` takes a tone or a valid hex and refuses everything else; a block stored with a bad colour draws with its default.

## Docs to update (content-manager)

- `documentation/api/api-module-sdk.md`, "Shared tools": `host.ui.colorPicker` and the helpers, and the rule that a stored colour is untrusted.
- `documentation/api/api-modules.md`: the `color` setting is drawn with the picker.
- `documentation/designsystem/design-theme.md`: a person's own colour (the exception) and the Pickers rows.
- `documentation/userguides/userguide-whiteboard.md`: Override theme and the picker.
- `CLAUDE.md`'s rule "Colors come from the theme tokens" could say, in one clause, that a person's own chosen colour is data; that file is Thomas's to change.

## Left to build, in order

Building starts next cycle (Thomas, 2026-11-09: the usage budget).

1. **The picker in the SDK** (experience-design). `host.ui.colorPicker` and `host.util.color.parse` in `public/sdk/host.js`, the new rows and the phone sheet, the Pickers styles in `host.css`, recent colours (option 3), the Design System entries and screenshot, the check's picker part (server-development). The module settings forms use it in the same step and `colour-pick.js` goes. Leaves working: every `color` and list setting with the new picker; any module can call it.
2. **The readability helpers** (experience-design). `readableOn`, `contrast` and `colorName`; the contrast hint in the picker; the check's helper part. Leaves working: the hint, and a helper modules can call.
3. **The Whiteboard uses it** (module lane, a version bump). Override theme: a block's colour roles take a hex as well as a tone (`wb.paint`), the colour menus gain **Custom colour...** which opens the picker, note words take `readableOn` on a hex fill; the board background stays theme colours only. Leaves working: exact colours on the board, seen alike by everyone.
4. **Later, each on its own:** the Planner's marker contrast fix; Maps, Calendar and Places, if and when they let a person choose a colour.

## Verify

- Steps 1 and 2: `npm run check`, then by hand on the local server in a light and a dark theme: a module setting's colour (Manage > Modules), the keyboard path through every row, the hex field's error, recent colours after a reload, and a second person on the same browser seeing none of them. A phone width in the browser's device mode for the sheet. A sandboxed module needs an uploaded test module; say so if it is not tried.
- Step 3: two browsers signed in as two people in one space, each choosing exact colours and tones, one in a light theme and one in a dark; a block saved with `url(x)` as its fill (written to storage by hand) must draw with its default.
- Nothing here touches LiveKit; no call is needed to verify any step.

## Still open

Nothing blocks the build. Whether `CLAUDE.md`'s rule on theme tokens gains a clause about a person's own colour is Thomas's to decide when he wants.
