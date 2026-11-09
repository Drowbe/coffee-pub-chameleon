# Whiteboard: notes for the documentation (draft, for the content-manager)

On `origin/main` the Whiteboard is 0.1.10 (`modules/whiteboard/module.json`, after PR #483; PR #481 brought 0.1.5 to 0.1.9
in one merge, PR #467 brought 0.1.4). The bullets for 0.1.4 to 0.1.10 were read from the code on `origin/main`. Versions
are those of the stage that brought each piece, as the guide's `_Since` lines give them. The later stages are on stage
branches only and are renumbered to the new plan: flowchart 0.1.11, fill, marker, brush and timer 0.1.12, text markup
0.1.13, note pointer and highlighter 0.1.14, table 0.1.15, save as image and print 0.1.16. Their bullets sit under
"Not on main yet" in each section and were read from the stage branches earlier (`wb-s7`), not from main; recheck each
against its code when it lands. Nothing here was verified live unless it says so. The user guide draft is
`whiteboard-guide.draft.md` beside this file; its "Coming (do not publish yet)" area at the bottom is not on main.

## User guide

- 0.1.4: new page `documentation/userguides/userguide-whiteboard.md` from the draft, up to the `NOT ON MAIN YET`
  comment only. Header and section order follow `userguide-vault.md` (Audience line, a "Who can" list with the Roles
  tab's exact permission labels, task headings). Each section carries a `_Since 0.1.x_` line; the content-manager decides
  whether those stay once the module is released.
- 0.1.4: the permission labels in the guide are the manifest's as they are now: **See the whiteboard**, and **Draw on the
  whiteboard, add pictures and change what is on it** (the second gained "add pictures" in 0.1.6). Defaults: view on for
  member, moderator, guest; edit on for member and moderator, off for guest.
- 0.1.4: the existing user guides write level and role words plainly (space, owner, member), not in `{braces}`; braces are
  only the manifest's placeholders (`{space}` in `module.json`'s description). The draft follows the guides.
- 0.1.4: link the new page from `userguide-modules.md` (and the wiki sidebar) where the other bundled modules are listed.
- 0.1.4: no screenshots in the draft (none asked for); `documentation/assets/` would need them if the house standard wants one.
- 0.1.5: undo, copy and paste live in the page's memory only; the guide says so (not across tabs, gone on reload).
- 0.1.6: say that deleting a picture block leaves its file, and that the file still counts toward the 500 per space.
- 0.1.8: the toolbar change is in the guide: "Open the whiteboard" (what is in the title bar and the toolbar), "Snap to
  grid" (new section), "Colours and widths" (rewritten: no Colour or Width button in the toolbar any more; the right-click
  **Colour** and **Line width**, and "The colour strip" with what Mixed, None, Matching and Default mean), "Zoom" (the
  title bar's Zoom out and Zoom in and the magnifier's menu), "Who can do what" (a row for colours, the strip and Snap to
  grid) and the shortcut table (the `=` key for zoom in, the Alt or Option row for snapping). The word **Usual** became
  **Default** everywhere; the guide says so once.
- 0.1.9: one line in "The colour strip": the strip lets presses through to the board and blocks under it.
- 0.1.10: lines with `_Since 0.1.10_` in "Copy, cut, paste and duplicate" (pasting words from elsewhere does nothing on
  the board and keeps the copied blocks), "Undo and redo" (several pictures are one step; linked parts and the note
  "Left a block as it is: someone else changed it since."), "Drag with the right mouse button" (a right-click straight
  after a right-drag opens its menu) and "Add pictures" (one step; each picture counts once against 30 a minute).
- 0.1.10: "Limits" corrected: the 5 MB is for the whole module (every space's board together) and pictures do not count
  toward it; 500 picture files per space; the server also refuses a picture with a very large pixel size (no number given).
- Not on main yet: 0.1.11 to 0.1.16 sections and table rows are in the guide's "Coming" area, with a list of the lines
  each puts back into the main sections (intro, "Who can", the **+**, undo with connectors, Limits, shortcuts).
- Not on main yet, 0.1.16: Save as image and Print are for view-only people too; the "Who can do what" table will say so.

## Architecture

- 0.1.4: module structure. One page (`src/whiteboard.html`, `.css`, `.js`); the libraries `src/whiteboard-lib-*.js` are
  joined in name order and put where `whiteboard.js` has `/*__LIB__*/` by `server/module-build.js`, so lib-a loads first
  and the registries exist before the block-type and tool files register. `whiteboard.js` is the glue and the one path
  for every local change (`commit` -> `persist` -> history and sync).
- 0.1.4: lib-a core: the block format `{ id, type, x, y, z, fill?, stroke?, ink?, weight?, ...own fields, by, at }`, the
  palette (Ink plus eight theme tints, stored by name, never a colour), the colour roles (stroke/Border, fill/Background,
  ink/Words), the widths, `wbClean` (every block read is cleaned against its type), the board state, `wbBetween` (a layer
  move is one write: a z between neighbours, renumbering only when the gap is too small) and the two registries
  (`blockTypes`, `tools`).
- 0.1.4: lib-b policy: the only place that reads `host.can`. `view` and `edit` today; the server checks `edit` on every
  save (`access.write`). Any later "only the maker may move it" rule goes here.
- 0.1.4: lib-c sync: the only code that touches `host.storage` and the `change`/`changes` events. One key per block,
  `block:main:<id>` (one board per space: `WB_BOARD = 'main'`), the whole block written each time, last write wins (no
  version sent; a 409 path is marked in the header comment for later).
- 0.1.4: lib-d render: draws the board, the view (pan, zoom 0.2 to 4; "Show everything" never past 1), handles, the
  selection frame, and `wbEditText` (editing words in place).
- 0.1.4: lib-e block-* (one file per block type: note, text, shape (rect and ellipse), line, stroke; image since 0.1.6)
  and lib-f tool-* (one file per tool or family of tools: select, pen, place (note, text), shape (rect, ellipse, line, arrow); hand
  since 0.1.5).
- 0.1.5: lib-g history (undo and redo), lib-h clipboard (copy, cut, paste, duplicate in page memory).
- 0.1.6: lib-i pictures (pictures from the computer, sent as uploads).
- 0.1.4: block-type registry. Required: `create`, `clean`, `box`, `render`, `describe`. Optional hooks on main: `paint`
  (roles and extra choices `none`/`auto`), `weight`, `edit` (`'text'` | `'colour'`), `textField`/`textLine`/`textLabel`/
  `textMax`/`editLabel` (0.1.6, a picture's Describe), `textEmpty`, `resize` (`corners` with `min`, `height:false`,
  `keep`; `ends`), `noun`, `linked`, and `refs`/`remap` (used by the clipboard; no block type on main has them yet).
- 0.1.5: `linked` field groups on each type: fields that only make sense together, put back together or not at all by
  undo. note/shape `[x, y, w, h]`; text `[x, y, w]`; line `[x, y, dx, dy]`; stroke `[x, y, points]`. 0.1.10: the image
  type declares `[x, y, w, h]` too (before, an undo of a picture's resize could put back x, y, w and h separately).
- 0.1.5: `wbApplyChanges(list, hooks)` in lib-g writes an undo or redo step back through the page's one path. Hooks:
  `get`, `remove`, `put`, `canChange`, `canCreate`, `clean`, `linkedOf`. Returns `{ left, kept, touched }`; `wbUndoNote`
  turns it into the toast ("Left out a block someone else deleted.", "Left a block as it is: someone else changed it
  since.", or both).
- 0.1.5: undo and history. Per person and per page (memory only; cleared on reload and on a whole-board Clear or restore).
  Only this page's own changes are recorded; one turn of the page's script is one step; tagged steps within 1.5 s merge
  (arrow keys). Cap 100 steps. Undo is field-wise three-way: for each field the step changed, the block's current value is
  compared with what this person left (`source`).
- 0.1.10: the linkedOf rule (`wbMergeBack`): a field goes back only when neither it nor any field in its linked group has
  been changed by someone else since, whether this step changed that other field or not; otherwise the whole group keeps
  their values. A block with no field left to put back is "kept" (left as it is). A block deleted since by someone else is
  "left" (left out). The result is written as a new whole-block change.
- 0.1.10: `history.tag(tag, { join: true })` joins a step with the newest step carrying that tag, however long ago and
  even with other steps between (without `join`, only within 1.5 s of the last). The page tags each picture batch
  `pictures:<id>` and calls it in `onPlaced` before the block's commit, so pictures added together are one undo step
  whenever their uploads finish.
- 0.1.5 to 0.1.10: sync rules (lib-c header comment). Writes go one at a time per key, newest last (a lane per key);
  `saveSoon` waits 600 ms (arrow-key nudges). A change heard while this page writes the same key is `deferred` and judged,
  in order, after the write. `seen`: the newest version known per key; a change not newer is an echo or a repeat and is
  skipped. A 429 is retried after the server's wait, up to 8 times, unless a newer write for the key came meanwhile.
- 0.1.10: the sync rewrite in lib-c for deletes. While a delete of this page's is not heard back (`gone`), every change
  heard for that key is answered by reading the key again (`refetch`), because the server numbers a key afresh after a
  delete and the version cannot tell an old change from a later one; what the read gets is drawn only when it differs
  from what the page shows. `gone` keeps an ordered list of this page's deletes not heard yet (`pending`, oldest first,
  each with its version and the writes made after it). The wait ends on a delete whose version is the oldest pending
  one and whose `by` is this person (`me`, now passed to `createSync` by the page), on the echo of this page's own write
  made after a pending delete, or on a refused delete (the block is read again). A successful write or a `load()` no
  longer ends the wait. A read answered after a newer read was asked for or a change for the key was taken (a ticket per
  key), or while this page is writing the key, is not used.
- 0.1.6: image block `{ upload, w, h, alt, stroke, weight }`: the bytes are never in the block. Pictures are prepared in
  the page (createImageBitmap, long edge 2000 px, thumbnail about 400 px; over 5 MB re-encoded as WebP and shrunk), sent
  with `host.uploads.put` then `thumb` (scope space), and only then is the block saved (one write). Manifest `uploads`:
  JPEG, PNG, WebP, 5 MB, 500 files; a GIF is sent as a PNG of its first frame. Orphan uploads stay: deleting a picture
  block never removes its upload (undo, copies sharing one upload, other people's undo history, and only the uploader or
  an owner may remove a file). The only upload removed is one this page sent that never got a block.
- 0.1.10: `wbSniffType` in lib-i reads a picture's type from its first 16 bytes (JPEG, PNG, WebP, GIF) in the page, in
  place of asking the server (`host.uploads.inspect` is no longer called), so each picture spends one of the server's 30
  uploads a minute (the put; the thumbnail is not counted).
- 0.1.8: Snap to grid. `WB_GRID = 24` board units (the renderer's dots sit on its multiples) and `wbSnap(v)` in lib-a.
  `ctx.snapping(event)` is the page's: on when the toggle is on, turned round while `event.altKey`. The place and shape
  tools snap the new block's corner, corners or ends; select snaps the held block's corner on a move (the others by the
  same amount) and the dragged edges or a line's end on a resize (not when the shape is kept); the **+** snaps the
  corner; the pen never. The toggle is a `host.ui.toolbarButton` (`id: 'snap'`), made again after Delete appears so it
  stays last; its state is in `localStorage` (`whiteboard-snap`), off at first, never in the board's data.
- 0.1.8: the swatch strip, `#paint` in `whiteboard.html`, filled by `whiteboard.js` (`paintShown`, `updatePaint`): one
  button for each colour role and one for the width, under the toolbar's left end, each opening `colourMenu` for its
  role or `widthMenu`. The marks use `data-state` (`colour`, `none`, `auto`, `default`, `mixed`, `width`) and the theme
  tokens in `whiteboard.css`. Hidden for someone who may only look.
- 0.1.9: the strip's pointer-events rule: `.wb-paint { pointer-events: none }` and `.wb-paint-btn { pointer-events:
  auto }`, so a press on the strip outside its buttons reaches the board and the blocks under it.
- 0.1.10: copy and paste through the browser's events: copy and cut (by key) put a mark, the type
  `application/x-coffee-whiteboard-blocks`, on the computer's clipboard; a paste with files and no mark adds pictures; a
  paste with no mark and no files, after a copy here put the mark, does nothing.
- 0.1.10: checks: the module's own tests live in `modules/whiteboard/test/` (`check-whiteboard-sync.mjs`,
  `-history.mjs`, `-pictures.mjs`, `-rightdrag.mjs`, `-live.mjs`) and run with `npm run check:module -- whiteboard`, and in
  `npm run check` through `tools/check-module-tests.mjs`. They are not in the module's zip. (Before 0.1.10 the sync and
  history checks were `tools/check-whiteboard-*.mjs`.)
- Not on main yet, 0.1.11 (flowchart): lib-e block connector, lib-f tool connector. Block-type hooks `refs`/`remap`/
  `loosen`/`attached`/`layout`/`anchorIn`; linked `[from, to]`. A connector is `attached`: no x, y of its own, laid out
  each time from its blocks' boxes (elbow router `wbRoute`), never stored. On copy, `remap` points the copy at the
  copies; a connector copied without one of its blocks gets a free end where it is drawn now (`loosen`). Deleting a block
  deletes its connectors first, in the same undo step. A connector whose block is not on the page is not drawn, and a page
  that may edit removes it about 2.5 s later once `sync.exists` says the block is gone (the "sweep"); that delete is in
  nobody's undo. `wbApplyChanges` gains `pointsAt(block)` and `missing(block)`.
- Not on main yet, 0.1.12 (timer, fill, marker, brush): lib-e block timer, lib-f tool fill; hook `copied` (a timer's copy
  is not running); timer linked `[x, y, w, h]` and `[length, state, startedAt, remaining]`; stroke linked gains `widths`.
  Timer sync: the block stores `length`, `state` (idle, running, paused), `startedAt` (server time, ms) and `remaining`;
  nothing is written while it runs. Each page counts from `startedAt` with its guess of the server's clock
  (`createServerClock` in lib-c): best evidence is the `updatedAt` of this page's own writes (half the round trip), then
  a floor from `updatedAt` on changes heard live (on main since #479), then a loose floor from the board read. A timer
  that ended more than 10 s before the page saw it is not sounded.
- Not on main yet, 0.1.13 (text markup): a markup lib (lib-j on the stage branch; the letter may change now that main
  has lib-i): bold, italic, code, lists, heading cycle, link address checks (only http and https). lib-d gains the
  formatting bar and `wbShowWords`, the one HTML sink for words. Hook `markup` (adds `size` and `align`).
- Not on main yet, 0.1.14 (note pointer, highlighter): hooks `reach`, `grips`, `grip`, `actions`; block highlight,
  linked `[x, y, points]`; tool highlight.
- Not on main yet, 0.1.15 (table): a table lib (lib-k on the stage branch): rows pasted from a spreadsheet read as a
  table's cells; HTML parsed by DOMParser into a document never shown, only text kept. Block `{ w, cols, rows, cells,
  head, ... }`, one stored value per table: at most 20 columns, 50 rows, 500 characters a cell and 48,000 JSON characters
  of cells, so it stays under the 60 KB value limit; `clean()` enforces every limit. A cell edit is written into the
  newest table (`wbTableSetCell`), so other people's changes stay; a cell whose row or column went is not kept (the person
  is told). The active cell is a page mark (`data-cell`), never saved. Hooks `edit: 'cells'`, `role`, `gripBase`, `tap`,
  `actions(block, cell)`, `resize.minOf`/`measure`/`scale`; linked `[x, y, w, cols, rows, cells]`.
- Not on main yet, 0.1.16 (save as image, print): an export lib (lib-l on the stage branch). Each block's element is
  copied into an SVG `<foreignObject>` with the module's CSS, the theme tokens read now and the page's fonts as data
  URLs; drawn on a canvas and saved as PNG (data: URL, since a blob: URL with a foreignObject taints the canvas in
  Chromium). No SVG export. Margin 32 board units round Everything and the selection; caps 16384 px a side and
  64 x 1024 x 1024 pixels. Hook `exported(block, el, ctx)`. The file goes through `host.files.save` when the SDK has it,
  else an `<a download>` link. Print uses `host.standard.set({ print: { run } })`: a live copy in an SVG the width of the
  paper, removed on `printed`.

## API

- 0.1.5 (on main since #481): `host.ui.toolbarButton({ id, label, icon, iconOnly, on, disabled, onClick })` takes
  `disabled`, and `set({ disabled })` changes it (`public/sdk/host.js`). `documentation/api/api-module-sdk.md` (the
  toolbarButton bullet, about line 514) still lists `{ id, label, icon, iconOnly, on, onClick }` and `set({ label, icon,
  on })`; add `disabled` to both.
- 0.1.6: the Whiteboard is the first bundled module to declare `uploads` in its manifest
  (`{ types: [jpeg, png, webp], maxBytes: 5242880, maxFiles: 500 }`) and to use `host.uploads.put`, `thumb`, `url` and
  `remove` with `scope: 'space'`. Worth a short example in `api-modules.md` beside the `uploads` rule.
- 0.1.8: the Whiteboard uses `host.toolbar.set` with `placement: 'titlebar'` for its Zoom out, Zoom in and Zoom buttons,
  and hears them as the `toolbar` event (`{ id, x }`). Already documented in `api-module-sdk.md`; the Whiteboard can be
  named as an example there.
- 0.1.10: the Whiteboard no longer calls `host.uploads.inspect` (it reads a picture's type itself, `wbSniffType`).
- Since #479 (core, on main): the module `change` event carries `updatedAt`, the server's time of the write as an ISO
  string (`public/module-host.js`). The Whiteboard on main does not read it yet; the timer stage (0.1.12) will, to learn
  the server's clock from changes heard live. `documentation/api/api-module-sdk.md` shows `updatedAt` only for
  `host.storage.set`'s answer (about line 103); document it in the live-changes section for `change`.
- 0.1.10: module tests: `modules/<id>/test/*.mjs`, run with `npm run check:module -- whiteboard` (or every module's in
  `npm run check`). Worth a line where the module guide describes how to check a module.
- Not on main yet, 0.1.16: the page uses `host.header.set([{ id: 'export', ..., overflow: true }])` for Save as image in
  the title bar's menu and `host.standard.set({ print })` with the `printed` event. Host asks not built (reported by the
  builder, not documented): `host.files.save`, `host.files.add` (save to the Vault), `host.standard.run('print')`, a print
  orientation option, `host.uploads.blob(id, { thumb })`.

## CHANGELOG

- 0.1.4: Whiteboard: separate border, background and word colours, line and border widths, four layer moves, and a soft
  shadow on notes.
- 0.1.5: Whiteboard: select several blocks, copy, cut, paste and duplicate, undo and redo your own changes, and move the
  board with Space, the middle mouse button, the wheel, two fingers or the Hand tool; dragging the empty board now picks.
- 0.1.6: Whiteboard: add pictures by pasting, dropping or "Add a picture".
- 0.1.7: Whiteboard: drag with the right mouse button to move the board; a right-click still opens the menu.
- 0.1.8: Whiteboard: zoom buttons in the title bar, a strip that shows the colours and line width and opens their menus,
  "Default" in place of "Usual", and Snap to grid (hold Alt or Option to do the opposite for one drag).
- 0.1.9: Whiteboard: the colour strip no longer blocks clicks on the board under it.
- 0.1.10: Whiteboard: pasting words copied elsewhere no longer puts down the copied blocks; several pictures added at
  once are one undo step; undo leaves a line's ends, a box's place and size, a drawing or a text block as someone else
  left them; a right-click straight after a right-drag opens its menu; each picture counts once, so about 30 a minute.
- Not on main yet, 0.1.11: Whiteboard: flowchart shapes and connectors that follow their blocks, with line style and
  arrowheads.
- Not on main yet, 0.1.12: Whiteboard: a Fill tool, a Marker and a Brush in a new Paint menu, and a timer everyone sees
  count down together.
- Not on main yet, 0.1.13: Whiteboard: bold, italic, code, lists, headings and links in notes, text and shapes, with a
  formatting bar, and a text size and alignment.
- Not on main yet, 0.1.14: Whiteboard: give a note a pointer, and a Highlighter.
- Not on main yet, 0.1.15: Whiteboard: tables, and paste rows from a spreadsheet as a table.
- Not on main yet, 0.1.16: Whiteboard: save the board as a picture, and print it.

## Known limits

- 0.1.4: a real call and VoiceOver not verified (no LiveKit server locally).
- 0.1.4: the 5 MB storage limit is for everything the Whiteboard stores, all spaces together (the server sums the
  module's whole data folder), not per space. Pictures are uploads, kept apart, and do not count toward it.
- 0.1.5: two people changing the same block at the same moment: the last write wins (no conflict check yet).
- 0.1.5: undo history and the clipboard are per page and in memory: gone on reload, not shared between tabs.
- 0.1.5: wheel and trackpad behaviour (two-finger pan, pinch zoom, 12% wheel step) on a real Mac not verified.
- 0.1.6: orphan uploads (pictures whose blocks are all deleted) stay with the space and count toward the 500-file limit;
  there is no tidy-up yet.
- 0.1.6: pasting a picture inside a sandboxed module frame was not proven live (the module runs in the page today).
- 0.1.6: in the sandboxed run mode a picture shows "Picture not found": the frame's origin is `null`, so the upload's
  address does not load there.
- 0.1.6: a member who is removed may still load a picture for up to an hour, from the upload cache.
- 0.1.7 and 0.1.10: right-drag on a real Windows browser (the menu asked for after the release) was tested only with
  synthetic events (`modules/whiteboard/test/check-whiteboard-rightdrag.mjs` sends synthetic event orders, then two rows
  with the real mouse; never on Windows).
- 0.1.8: the colour swatches are not in the toolbar row and Snap to grid is not at the toolbar's right end, because a
  module can do neither (a toolbar button holds only an icon; there is no right-hand place for a module's own button).
  The project manager filed an Ideas issue for the host.
- 0.1.8: the magnifier's Zoom menu opens at the top of the module's content, not under its button in the title bar.
- 0.1.10: copy and cut by key replace what is on the computer's clipboard (with the board's mark). Thomas accepted this.
- 0.1.10: pasting from another program was tested only with synthetic paste events
  (`modules/whiteboard/test/check-whiteboard-live.mjs`; a headless browser has no computer clipboard).
- 0.1.10: the missed-delete recovery gap (issue #471) is closed in the sync lib: while a delete is not heard back, every
  change for the key is answered by reading the key, and a missed echo of a delete no longer holds the key. The old
  limit text is removed. (Checked by `check-whiteboard-sync.mjs`, read as code here; not verified live.)
- Not on main yet, 0.1.12: the timer's clock on a page that never writes: until the timer stage reads `updatedAt` from
  `change` (on main since #479), such a page falls back to its own clock, floored by the board read.
- Not on main yet, 0.1.16: Print not tested in Safari or Firefox. Wide boards print portrait (an `@page` rule in a shadow
  root is ignored). Ctrl or Cmd P is the browser's own print, not the board's. Save as image in a sandboxed frame cannot
  hand over a file until the SDK has `host.files.save`.
