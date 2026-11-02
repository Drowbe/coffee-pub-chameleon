# The design system pages

Four pages, with the same links at the top of each (`pages.css` styles them): **Design System**, **Proposed**, **Prototype**, **Legacy**.

- **Design System** (`index.html`, `/design-system/`): what is in production. Today's components, exactly as the product draws them,
  read from the product's own stylesheets. It loads nothing that starts with `proposed`.
- **Proposed** (`proposed.html`): only staged changes to the design system. Each entry says what, why, where it was tweaked in the
  Prototype, and its status (staged, building, in production). Nothing is staged yet.
- **Prototype** (`prototype.html`, `prototype.js`, `prototype.css`): the panel we are building, the one module panel drawn by
  `createModuleFrame` (`public/module-frame.js`) in four states, with a theme, Light or Dark, and a width chosen at the top. What a
  tweak here changes is staged on Proposed; a Proposed change moves into the Design System once it is built into production. Its
  themes are `themes/<id>.css`, the three shipped themes written by `server/theme-css.js`: run `node tools/design-system-themes.mjs`
  after a shipped theme changes (`--check`, in `npm run check`, fails when they differ). Its Planner, Phone and Vault sections are
  jumped to from the Sections list. The Vault section (design-process only, nothing ships) is `prototype-vault.js` (the section, its
  switches and its questions for Thomas), `prototype-vault-app.js` (the module), `-ui.js`, `-viewers.js`, `-dialogs.js`, `-more.js`,
  `-sets.js`, `-shared.js` (the public page), `-data.js` (the made-up files, drawn in the page; no big assets) and
  `prototype-vault.css`, whose rules marked "to system.css" are what the build would move into the shared stylesheet.
- **Legacy** (`legacy/index.html`): frozen records.
  - `legacy/inventory/`: the inventory of the app before the design system, with its screenshots in `img/` ("before" is commit
    `c9fc16e`; "now" was `417b646`).
  - `legacy/system-v1/`: System v1, built 2026-10-22, the drawings the production system was built from (the old Proposed page,
    `proposed.html`). Its `ds.css` is a frozen copy of the page chrome.
  - Each later version is stored here as a snapshot: a git tag and its screenshots.

The product host (`PRODUCT_DOMAIN`) serves everything under `/design-system/`; a folder address serves its `index.html`.

## How System v1 is put together

Each family has its own files in `legacy/system-v1/`, and the checks still hold them to the decided rules.

| File | What it holds |
| --- | --- |
| `proposed.html` | The page. It names no family. |
| `proposed.js` | The page engine: the menu, the example frames, the Dark/Light, fonts (Today's or Proposed) and width switches, the forced hover, focus and pressed states, and the list of families still to decide. |
| `proposed.css` | Only the rules more than one family uses (the button height tokens). |
| `proposed-families.json` | The list of families, in the order they are drawn. |
| `proposed-<id>.js` | One family: it draws its examples and registers itself. |
| `proposed-<id>.css` | One family: its rules, all under `.ds-proposed`. |
| `fonts/` | Figtree and Fraunces, as the drawings used them, with their licences. |

`tools/check-design-system.mjs` checks the page.

## The families

One entry each in `proposed-families.json`, in the order they are drawn.

- `colour`: Colour
- `buttons`: Buttons
- `fields`: Fields and forms
- `typography`: Typography
- `tabs`: Tabs and view switches
- `chips`: Chips, badges and counts
- `cards`: Cards, panels and rows
- `menus`: Menus and popovers
- `foundations`: Foundations (spacing, elevation, the one scrim, radius, motion, icons, layout)
- `calendar`: Calendar cells
- `markers`: Markers
- `days`: Day cards and day chips
- `tables`: Tables and Manage lists
- `dialogs`: Dialogs and sheets
- `tooltips`: Tooltips
- `states`: Empty, loading and error states (owns the one skeleton, `.sdk-skel`)
- `toasts`: Toasts and banners
- `modulechrome`: Module window
- `chat`: Chat
- `journey`: Journey bar
- `tabbar`: Phone bottom bar
- `links`: Links
- `pickers`: Pickers
- `progress`: Progress bars and meters
- `avatars`: Avatars and portraits
- `choices`: Choice rows

A class has one owner. A family may use another family's class (Tables draws its loading bars with the States skeleton) but
never defines it again.

## Check it

- `node tools/check-design-system.mjs` opens the production Design System page in a real browser, served from the app and its
  snapshot, in four scenarios (1280 or 390 wide, light or dark). System v1 gets a load smoke test. `npm run check:design` runs
  all four scenarios; `npm run check` runs 1280:light; CI runs all four on every push.
- `node tools/design-system-themes.mjs --check` checks the Prototype's themes.
- `node tools/check-names.mjs` checks the words.

## The review copies

`node tools/design-system-snapshot.mjs` builds the Design System page as a folder that works from a disk;
`PAGE=proposed OUT=/tmp/dsP node tools/design-system-snapshot.mjs` builds System v1 the same way, with the fonts and every file its
manifest names, and writes the list into `index.html`.
