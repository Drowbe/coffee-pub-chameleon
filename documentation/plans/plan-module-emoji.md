# Module Emoji Plan: the environment's emoji for modules, and Whiteboard stickers

**Audience:** Thomas, who decides; experience-design, who builds the SDK picker and the Whiteboard's sticker;
server-development for the new check; quality-assurance and content-manager after them.

**Status:** Approved by Thomas, 2026-11-09 ("approve the plan"); nothing built. Steps 1 to 3 change `public/sdk/host.js`
and start only after the toolbar change on `pm/toolbar-right-zone` has merged. The request, relayed: the Whiteboard should have
stickers, "from the same set as the emoji used in chat and on video", the call's reactions tray and the chat's smiley
picker, configured per environment. It should be core: "a module needs to be able to get that set and, ideally, open the
same picker", so a person picks one and it lands on the board as a sticker. The Whiteboard session asked four things: an
SDK piece (`host.ui.emojiPicker({ onPick })` and/or `host.emoji.list()`), how the emoji are drawn, who may place stickers
and how many, and whether a sticker is a new block type.

Each fact below is marked: **code** (read in the code, with the place), or **inferred** (not checked here).

## What it is today

**One list, three users.** The environment's list is `settings.reactions`, `[{ id, glyph, label }]`
(`server/store.js:407-410`), starting as the 105 in `DEFAULT_REACTION_LIST` (`server/default-lists.js:8`). It is cleaned by
`cleanReactions` (`server/store.js:562`): `glyph` is text of 1 to 8 characters, `label` up to 40, `id` lower-case letters,
digits and hyphens, made up when missing. A template may carry the list, at most 120 (`MAX_REACTIONS`,
`server/templates.js:34`). An owner edits it on Manage's Template tab (`#reactions-section`, `public/admin.html:518`), not
only the admin. **code**

- The call's tray: `renderReactionTray(list)` (`public/space.js:4763`) draws one button per entry, the first six on keys
  1 to 6. A reaction is a LiveKit data message, never stored (`sendReaction`, `public/space.js:4795`), gated by the
  `allowReactions` setting and the `react` permission (`public/space.js:4796`, `server/store.js:194`). **code**
- The chat's smiley picker: `renderChatEmoji(reactions)` (`public/space.js:6380`) fills `#chat-emoji-popup` with
  `.chat-emoji-btn` buttons that put the glyph into the message at the cursor. It is hidden only when the list is empty
  (`public/space.js:6401`); it is not gated by `allowReactions` or `react`. It has no arrow-key movement and no search:
  each emoji is a button reached by Tab. **code**
- The OBS boxes: the Stream module reads the list from `host.presence.get()` (`modules/stream/src/stream-keyed.js:128`). **code**

**How an emoji is drawn: as text, in the device's own emoji font.** Every place sets `textContent = glyph`
(`public/space.js:4777`, `4788`, `6387`). There are no emoji image files in `public/`, no emoji font is bundled or named
(`--font-system` in `public/sdk/system.css:101` names no emoji family), and nothing loads from another host. **code** So the
"3D" look is the operating system's: glossy on an Apple device, flatter on Windows and Android. Two people can see the same
sticker drawn differently, and the product does not control that. **inferred** (how each system's emoji font looks)

**Modules can already read the list.** `GET /api/branding` is public, no sign-in (`server/index.js:3333`), and includes
`reactions` (`server/index.js:1653`). `GET /api/presence` spreads the same branding into its answer
(`server/index.js:3881`), and `host.presence.get()` hands a module `reactions: [{ id, glyph }]`, without labels
(`public/module-host.js:344`; documented at `public/sdk/host.js:2720`). There is no `host.emoji` and no picker in the SDK. **code**

**How a host-drawn piece reaches a module.** Two patterns exist. **code**

- Drawn by the SDK in the module's own document: `host.menu.show` (`public/sdk/host.js:1405` onward; its flyout block is a
  copy of `public/menu-flyout.js`, kept the same by `tools/check-host-menu.mjs`). It is placed at the button and stays inside
  the module's frame.
- Drawn by the page, over everything: `host.ui.confirm` (`public/sdk/host.js:2050` calls `ui.confirm`, answered by
  `confirmDialog` in `public/module-host.js:1484`) and `host.objects.pick` (`public/module-host.js:1489`). The module waits on
  a promise; the page answers with the choice or a cancel.

A third-party module runs in a frame with `sandbox="allow-scripts allow-forms"` and an opaque origin
(`public/module-host.js:2339`) under a policy that allows images only from `'self' data: blob:` (`server/index.js:9903`);
the bundled modules, the Whiteboard among them, run in the page. **code**

**The Whiteboard.** Version 0.1.16. A block type registers itself in its own file (`lib-e-block-*`) with `create`, `clean`,
`box`, `render`, `describe` and hooks such as `resize` and `linked`; the picture block is the closest model
(`modules/whiteboard/src/whiteboard-lib-e-block-image.js:32-94`: square corners with `keep: true`, `linked: [['x','y','w','h']]`).
The tool switch holds eight tools and is full; others are `apart` buttons or in a group menu
(`documentation/architecture/architecture-whiteboard.md`, "Toolbar"). Save as image copies each drawn block into an SVG
`foreignObject`, embeds the page's own font files as data URLs, uses the system's fonts as they are, and draws it on a canvas
from a `data:` URL so the canvas is not tainted; print uses the same copy (`whiteboard-lib-l-export.js`, "Save as image and
print" in the architecture). There is no limit on how many blocks a board holds: only one value's 60 KB and the module's
5 MB in all (`WB_LIMITS`, `whiteboard-lib-a-core.js:52`; architecture, "Pictures"). **code**

## Decisions

Thomas, 2026-11-09, relayed by the coordinator.

1. **The SDK piece is a list and a picker the SDK draws in the module.** "Q1 = B (host.emoji.list() plus an SDK-drawn picker
   host.ui.emojiPicker, the chat's picker moved onto the same code)". A popover at a button is drawn the way `host.menu.show`
   is, and there is one picker in the product, not two. The other options were a list only (every module drawing its own
   grid) and a picker the page draws over everything (larger, more moving parts).
2. **Device emoji for now.** "Q2 = device emoji for now (glyph stored; bundled image set stays a later plan)". A sticker
   stores its glyph, so a bundled image set can be added later without changing what is stored.
3. **A picked sticker lands at the next click on the board.** "Q4 = a picked sticker lands at the NEXT CLICK on the board".
   The flow is pick, then click to place.
4. **No limit on stickers per board.** Taken from the plan's lean (Q3). A sticker is bounded like every block, by the
   module's 5 MB, `edit` and undo.
5. **The Sticker tool has a key, chosen here.** Taken from the plan's lean (Q5): **S**, free on the board today (see the
   whiteboard user guide's "Keyboard shortcuts").
6. **The largest sticker is 800 board units.** Taken from the plan's lean (Q6).

## The contract

### 1. The SDK: `host.emoji.list()` and `host.ui.emojiPicker()`

- `host.emoji.list()` -> `[{ id, glyph, label }]`, in the environment's order; `[]` when the list is empty. Read from the
  branding the module host already fetches (`brandingOnce`, `public/module-host.js:323`); no server change.
- `host.ui.emojiPicker({ anchor | at })` -> `{ id, glyph, label }`, or `null` when cancelled or the list is empty. Drawn by
  the SDK in the module's own document, like `host.menu.show`: at the button, inside the module, with the same styles from
  theme tokens in `public/sdk/system.css`. Works the same in the page and in a sandboxed frame. A small module gets a grid
  that scrolls. One picker open at a time; opening a menu closes it, and the other way round.
- The chat's `#chat-emoji-popup` is drawn by the same code, kept the same the way `menu-flyout` is today
  (`tools/check-host-menu.mjs`), and still puts the glyph into the message at the cursor.
- **Keyboard:** focus goes to the first emoji; arrow keys move in the grid, Enter or Space picks, Escape cancels and puts
  focus back on the button. A search field at the top filters by label once the list is longer than one screen (the default
  list is 105).
- **Touch and phone:** on a coarse pointer each emoji is at least 44 pixels (`check-touch`); on a phone the picker opens as a
  sheet from the bottom of the screen or module, the way the menus drill in there.

### 2. What a module receives, and what a sticker stores

- Both calls give `{ id, glyph, label }` (contract 1).
- **The text form is `glyph`.** There is no image form, because nothing is an image (above, and decision 2). A module that needs
  pixels draws `glyph` on its own canvas with `fillText`, which loads nothing and taints nothing. **inferred**
- **A sticker stores the glyph and the label, not only the id.** `{ glyph, label, w, h }`. Stored that way it survives the
  owner reordering, relabelling or removing the emoji, or switching template: it is plain text and draws the same. An emoji
  removed from the list stays on every board it is on; it just cannot be picked again. The `id` is not stored: it means
  nothing once the list changes.

### 3. Rendering on the board, in Save as image, in print

A sticker is a square element with the glyph as its text, sized to the box (`font-size` from `h`), drawn with
`textContent` only. Save as image and print copy it as they copy any text: no fetch, no image, so the canvas stays
untainted and the picture holds what the screen showed on that device. **inferred**: that a system colour-emoji font is
used inside an SVG `foreignObject` drawn to a canvas in Chromium, Firefox and Safari. This needs a real browser to confirm and
is the riskiest fact in the plan.

Size: an Apple emoji is a picture at a fixed size inside the font and goes soft when very large; the Windows one is drawn
from shapes and stays sharp. **inferred**. So a sticker is 24 to 800 board units a side (decision 6).

### 4. Who may place stickers, and how many

- Placing, moving, resizing and deleting a sticker is the Whiteboard's `edit`, like every block; seeing it is `view`. The
  server checks `edit` on every save already.
- Opening the picker needs no permission of its own: it shows only what `GET /api/branding` shows anyone. Not tied to
  `allowReactions` or `react`, which are about the call (the chat picker is not tied to them either).
- **No limit per board** (decision 4), as with every other block, bounded by the 5 MB the module stores; a sticker is
  about 150 bytes, so that is tens of thousands **inferred**. Abuse is the same as pasting many notes, and `edit` and undo
  already answer it.

### 5. The Whiteboard: a new block type

A new type, `sticker`, not part of the note or text block: a note's words are markup, sized by the text size menu and
wrapped; a sticker is one glyph that scales with its box, like a picture. Its own file, `whiteboard-lib-e-block-sticker.js`:

- `{ ...block, glyph, label, w, h }`; `create` 96 by 96; `clean` refuses a glyph that is empty, over 8 characters (the
  list's own limit) or has no pictographic character (`\p{Extended_Pictographic}` or a regional indicator), and keeps `w`
  equal to `h`; `label` up to 40, plain text.
- `resize: { handles: 'corners', min: { w: 24, h: 24 }, keep: true }`, and `clean` holds `w` and `h` to 800;
  `linked: [['x', 'y', 'w', 'h']]`.
- No colour roles (`paint` none), no text editing. `describe`: "Sticker: Heart". `noun`: sticker. An `actions` row,
  **Change sticker**, opens the picker and writes the new glyph and label in one step.
- Copy, cut, paste, duplicate, undo and layers need nothing new: they work on any registered type. Export needs no
  `exported` hook. Connectors attach to it, since it has a box and corner handles.
- A version bump (0.2.0, a new block type).

### 6. The Sticker tool: pick, then click to place

A tool, `whiteboard-lib-f-tool-sticker.js`, `apart` (the tool switch is full), key **S**, `edits: true`. It is hidden for
someone who may only look (`policy.canUseTool`) and when the list is empty.

1. The **Sticker** button, or **S**, opens `host.ui.emojiPicker` under the button (the `toolbar` event's `x`, as the
   Whiteboard's menus are placed today). Pressing **S** while the board has the keyboard opens it under the button too.
2. A pick makes Sticker the tool, holding that emoji. Nothing is written yet. The board's status (`#say`, and the
   button's tooltip) names it: "Click the board to place Heart."
3. The next click on the board puts a sticker there, 96 by 96 units, centred on the click (on the grid when snapping),
   as the Note tool places a note. It is written in one step, picked, and the tool goes back to Select, the way the place
   tools do. One pick, one sticker; to place another, pick again.
4. **Escape.** With the picker open, Escape (or a click outside it) closes it, places nothing and leaves the tool as it was.
   While holding a pick, Escape drops the pick, places nothing and goes back to Select, as Escape does with every tool today
   (the whiteboard user guide: "Back to Select"). Pressing **S** or the Sticker button again while holding a pick opens the
   picker again to choose another.
5. **Touch screen:** the same steps; the tap that places is the click. A one-finger drag on the empty board, or two fingers
   anywhere, still moves the board and places nothing; only a tap places. Picking another tool also drops the pick.

**Change sticker** (the right-click row, or Enter on a picked sticker) opens the picker at the sticker and replaces the glyph
and label in place, one step, keeping its size and place.

### 7. Security

- A module learns nothing new: the list is public already (`/api/branding`) and in `host.presence.get()`. The picker answers
  with the one pick or null; nothing about what the person hovered or typed in the search.
- No HTML anywhere: the picker and the sticker set `textContent`; labels (owner's text) go in `aria-label` and `title` only.
  The block's `clean` caps the glyph so a sticker cannot carry a message, and a module that writes its own stored data cannot
  smuggle anything past `clean` into the page.
- Nothing loads from another host, so the offline rule, the frame's policy and `check-brand-hosts` are untouched.

## Core and module lanes

- **Core** (can be built and checked alone, with no module changed): `host.emoji.list()` and `host.ui.emojiPicker()` in
  `public/sdk/host.js` (the list read through `public/module-host.js`), the picker's styles in `public/sdk/system.css` from
  theme tokens, and the chat's picker moved onto it. No server change: the list already reaches the page. experience-design.
- **Module:** the Whiteboard's sticker block, tool, tests and version bump. experience-design.
- **Checks:** the new `tools/check-sdk-emoji.mjs`, server-development.

## Left to build, in order

**Before step 1:** steps 1 to 3 change `public/sdk/host.js`, so they start only after the toolbar change on
`pm/toolbar-right-zone` has merged into `main`. Steps 4 and 5 need step 2.

1. **The SDK list.** `host.emoji.list()`. Leaves: any module can read the set with labels.
2. **The SDK picker.** `host.ui.emojiPicker()` (contract 1), with keyboard, touch and phone behaviour, and
   `tools/check-sdk-emoji.mjs`. Leaves: a module can open the picker; nothing uses it yet.
3. **Chat on the same picker.** `#chat-emoji-popup` drawn by the step 2 code; it keeps putting the glyph at the cursor.
   Leaves: one picker; chat unchanged to a person except the keyboard and search.
4. **The sticker block.** `lib-e-block-sticker.js`, with tests. Leaves: a sticker that exists in data draws, moves, copies,
   undoes and exports; no way to add one yet.
5. **The Sticker tool and Change sticker** (contract 6): pick, then click or tap to place; Escape; the **S** key; the
   Whiteboard at 0.2.0. Leaves: the feature, end to end.
6. **Documentation** (content-manager): `api-module-sdk.md` (a new "Emoji" section under Shared tools), `architecture-whiteboard.md`
   (the block, its `linked` group, the tool), `userguide-whiteboard.md` (adding a sticker, who can, Limits, **S** in
   Keyboard shortcuts),
   `userguide-chat.md` and `userguide-call.md` line 169 if the chat picker changes, `CHANGELOG.md`.

## Verify

- Steps 1 and 2: `tools/check-sdk-emoji.mjs`, that the list matches
  branding's shape with labels, that the picker resolves the pick on Enter and null on Escape and outside click, that labels
  are set as text, and `check-touch`, `check-no-raw-colours` and `check-design-system` on the new styles. Checked by a tool.
- Step 3: `check-chat-page.mjs` still passes; inserting at the cursor, by hand in a browser.
- Steps 4 and 5: `modules/whiteboard/test/check-whiteboard-sticker.mjs`: `clean` refuses text that is not an emoji and
  over 8 characters, keeps the square and the 24 to 800 size, the `linked` group under undo, a copy keeps the glyph,
  `describe`. In `check-whiteboard-live.mjs` (needs Chromium): a pick writes nothing; the next click writes one sticker centred
  on it and goes back to Select; Escape while holding a pick writes nothing; a drag while holding a pick moves the board and
  writes nothing; resizing keeps the square.
- **Only in a real browser, by a person:** that Save as image and print show the emoji in colour in Chromium, Firefox and
  Safari, and how a sticker looks on Windows, an Apple device and Android. No LiveKit call is needed for any of this.

## Still open

The Sticker button's icon (experience-design picks one from the icon list and shows Thomas); a bundled 3D image set, the
same on every device, is a later plan of its own (decision 2). Neither blocks the build.
