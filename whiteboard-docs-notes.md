# Whiteboard: notes for the documentation (draft, for the content-manager)

Read from the code on branch `wb-s7` (0.1.13, every version) and `origin/claude/great-volta-sjeedb` (0.1.7, what is pushed);
0.1.4 is on `origin/main` (PR #467). Versions are those of the commit that set `modules/whiteboard/module.json`. Nothing
here was verified live unless it says so. The user guide draft is `whiteboard-guide.draft.md` beside this file.

## User guide

- 0.1.4: new page `documentation/userguides/userguide-whiteboard.md` from the draft. Header and section order follow
  `userguide-vault.md` (Audience line, a "Who can" list with the Roles tab's exact permission labels, task headings).
  Each section carries a `_Since 0.1.x_` line; the content-manager decides whether those stay once the module is released.
- 0.1.4: the permission labels in the guide are the manifest's as they are now: **See the whiteboard**, and **Draw on the
  whiteboard, add pictures and change what is on it** (the second gained "add pictures" in 0.1.6). Defaults: view on for
  member, moderator, guest; edit on for member and moderator, off for guest.
- 0.1.4: the existing user guides write level and role words plainly (space, owner, member), not in `{braces}`; braces are
  only the manifest's placeholders (`{space}` in `module.json`'s description). The draft follows the guides.
- 0.1.4: link the new page from `userguide-modules.md` (and the wiki sidebar) where the other bundled modules are listed.
- 0.1.5: undo, copy and paste live in the page's memory only; the guide says so (not across tabs, gone on reload).
- 0.1.6: say that deleting a picture block leaves its file, and that the file still counts toward the 500 per space.
- 0.1.13: Save as image and Print are for view-only people too; the guide's "Who can do what" table says so.
- 0.1.8-toolbar: toolbar changes (pending, version 0.1.8-toolbar) are NOT in the guide: zoom moving to the title bar as
  Zoom in and Zoom out buttons, three colour swatches on the bar, "Usual" becoming plain default words, a line-width icon,
  and a snap-to-grid switch. When they land, the guide's "Colours and widths", "Zoom" and the shortcut table change, and
  "Usual" in "Colours and widths" is renamed.
- 0.1.4: no screenshots in the draft (none asked for); `documentation/assets/` would need them if the house standard wants one.

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
- 0.1.4: lib-d render: draws the board, the view (pan, zoom 0.2 to 4), handles, the selection frame, and `wbEditText`
  (editing words in place). 0.1.10: the formatting bar and `wbShowWords`, the one HTML sink for words.
- 0.1.4: lib-e block-* (one file per block type: note, text, shape, line, stroke; later image 0.1.6, connector 0.1.8,
  timer 0.1.9, highlight 0.1.11, table 0.1.12) and lib-f tool-* (one file per tool: select, pen, place, shape; later
  hand 0.1.5, connector 0.1.8, fill 0.1.9, highlight 0.1.11, table 0.1.12).
- 0.1.5: lib-g history (undo and redo), lib-h clipboard (copy, cut, paste, duplicate in page memory).
- 0.1.6: lib-i pictures (pictures from the computer, sent as uploads).
- 0.1.10: lib-j markup (what the formatting bar does to the words being edited: bold, italic, code, lists, heading cycle,
  link address checks; only http and https).
- 0.1.12: lib-k table (rows pasted from a spreadsheet read as a table's cells; HTML parsed by DOMParser into a document
  never shown, only text kept).
- 0.1.13: lib-l export (the board as a PNG, and the print copy).
- 0.1.4: block-type registry. Required: `create`, `clean`, `box`, `render`, `describe`. Optional hooks: `paint` (roles and
  extra choices `none`/`auto`), `weight`, `edit` (`'text'` | `'colour'`; 0.1.12 `'cells'`), `textField`/`textLine`/
  `textLabel`/`textMax`/`editLabel` (0.1.6, a picture's Describe), `resize` (`corners` with `min`, `height:false`,
  `keep`; `ends` with `attach`), `move`, `noun`, 0.1.8 `refs`/`remap`/`loosen`/`attached`/`layout`/`anchorIn`,
  0.1.9 `copied` (a timer's copy is not running), 0.1.10 `markup` (adds `size` and `align`), 0.1.11 `reach`, `grips`,
  `grip`, `actions`, 0.1.12 `role`, `gripBase`, `tap`, `actions(block, cell)`, `resize.minOf`/`measure`/`scale`,
  0.1.13 `exported(block, el, ctx)`.
- 0.1.5: `linked` field groups on each type: fields that only make sense together, put back together or not at all by
  undo. note/shape `[x, y, w, h]`; text `[x, y, w]`; line `[x, y, dx, dy]`; stroke `[x, y, points, widths]`; 0.1.8
  connector `[from, to]`; 0.1.9 timer `[x, y, w, h]` and `[length, state, startedAt, remaining]`; 0.1.11 highlight
  `[x, y, points]`; 0.1.12 table `[x, y, w, cols, rows, cells]`. The 0.1.6 image type declares no `linked` group, so an
  undo of a picture's resize can put back x, y, w and h separately (worth a look by the builder).
- 0.1.5: `wbApplyChanges(list, hooks)` in lib-g writes an undo or redo step back through the page's one path. Hooks:
  `get`, `remove`, `put`, `canChange`, `canCreate`, `clean`, `linkedOf`; 0.1.8 adds `pointsAt(block)` (blocks that point at
  others are put back after the rest, so a connector never returns before its block) and `missing(block)` (a connector
  whose block someone else deleted is left out). Returns `{ left, kept, touched }`; `wbUndoNote` turns it into the toast.
- 0.1.8: refs and remap. `refs(block)` lists the ids a connector points at; on copy, `remap(block, idMap)` points the copy
  at the copies; a connector copied without one of its blocks has that end made a free point where it is drawn now
  (`loosen`). The page copies every connector whose blocks are all in the copy. A connector is `attached`: no x, y of
  its own, laid out each time from its blocks' boxes (elbow router `wbRoute`), never stored.
- 0.1.8: deleting a block deletes its connectors first, in the same undo step. A connector whose block is not on the page
  is not drawn, and a page that may edit removes it about 2.5 s later once `sync.exists` says the block is gone (the
  "sweep"); that delete is in nobody's undo.
- 0.1.5: sync rules (lib-c header comment). Writes go one at a time per key, newest last (a lane per key); `saveSoon`
  waits 600 ms (arrow-key nudges). A change heard while this page writes the same key is `deferred` and judged, in
  order, after the write. `seen`: the newest version known per key; a change not newer is an echo or a repeat and is
  skipped. `gone`: after this page deletes a block, the key takes nothing but a delete until that delete is heard back
  (the server numbers a key afresh after a delete, so an old echo can share a version with a newer write). The wait ends
  on this page's own delete (same version), a later delete (higher version: someone else's, after this page's was
  missed), the echo of this page's own write since, a `load()`, or a refused delete (the block is read again). A 429 is
  retried after the server's wait, up to 8 times, unless a newer write for the key came meanwhile.
- 0.1.5: undo and history. Per person and per page (memory only; cleared on reload and on a whole-board Clear or restore).
  Only this page's own changes are recorded; one turn of the page's script is one step; tagged steps within 1.5 s merge
  (arrow keys). Cap 100 steps. Undo is field-wise three-way: for each field the step changed, the block's current value is
  compared with what this person left (`source`); a field someone else changed since keeps their value, and so do the
  fields `linked` with it (`wbMergeBack`); a block whose every such field changed is left as it is ("kept"). A block
  deleted since by someone else is left out ("left"). The result is written as a new whole-block change.
- 0.1.6: image block `{ upload, w, h, alt, stroke, weight }`: the bytes are never in the block. Pictures are prepared in
  the page (createImageBitmap, long edge 2000 px, thumbnail about 400 px; over 5 MB re-encoded as WebP and shrunk), sent
  with `host.uploads.inspect`/`put`/`thumb` (scope space), and only then is the block saved (one write, one undo step).
  Manifest `uploads`: JPEG, PNG, WebP, 5 MB, 500 files; a GIF is sent as a PNG of its first frame. Orphan uploads stay:
  deleting a picture block never removes its upload (undo, copies sharing one upload, other people's undo history, and
  only the uploader or an owner may remove a file). The only upload removed is one this page sent that never got a block.
- 0.1.9: timer sync. The block stores `length`, `state` (idle, running, paused), `startedAt` (server time, ms) and
  `remaining`; nothing is written while it runs. Each page counts from `startedAt` with its guess of the server's clock
  (`createServerClock` in lib-c): best evidence is the `updatedAt` of this page's own writes (half the round trip), then
  a floor from `updatedAt` on changes heard live, then a loose floor from the board read. A timer that ended more than
  10 s before the page saw it is not sounded.
- 0.1.12: table block `{ w, cols, rows, cells, head, ... }`. One stored value per table: at most 20 columns, 50 rows,
  500 characters a cell and 48,000 JSON characters of cells, so it stays under the 60 KB value limit; `clean()` enforces
  every limit. A cell edit does not hold the table: the edited cell is written into the newest table (`wbTableSetCell`),
  so other people's changes stay; a cell whose row or column went is not kept (the person is told). Otherwise last write
  wins. The active cell is a page mark (`data-cell`), never saved.
- 0.1.13: export (lib-l). Each block's element is copied into an SVG `<foreignObject>` with the module's CSS, the theme
  tokens read now and the page's fonts as data URLs; drawn on a canvas and saved as PNG (data: URL, since a blob: URL
  with a foreignObject taints the canvas in Chromium). No SVG export. Margin 32 board units round Everything and the
  selection; caps 16384 px a side and 64 x 1024 x 1024 pixels. Block types adjust their copy with `exported` (a picture
  inlines its upload, a timer drops its controls, a table its active cell). The file goes through `host.files.save`
  when the SDK has it, else an `<a download>` link (works for a bundled module running in the page; in a sandboxed frame
  it says it cannot). Print uses the host's standard Print (`host.standard.set({ print: { run } })`): a live copy in an
  SVG the width of the paper, removed on `printed`.
- 0.1.5: checks: `tools/check-whiteboard-sync.mjs` and `tools/check-whiteboard-history.mjs` (both in `npm run check`).

## API

- 0.1.5: `host.ui.toolbarButton({ id, label, icon, iconOnly, on, disabled, onClick })` takes `disabled`, and
  `set({ disabled })` changes it (`public/sdk/host.js`, on the pushed branch). `documentation/api/api-module-sdk.md`
  (the toolbarButton bullet, about line 514) still lists only `{ label, icon, on }` for `set`; add `disabled`.
- 0.1.9: the module `change` event carries `updatedAt` (the server's time of the write), so a module that counts time
  learns the server's clock from changes heard live. This is in `public/module-host.js` in the working tree only, not on
  `wb-s7` or the pushed branch: core PR pending. The Whiteboard already reads `e.updatedAt` when present and works
  without it. Document it in the SDK's live-changes section with the PR. `host.storage.set` already returns `updatedAt`.
- 0.1.6: the Whiteboard is the first bundled module to declare `uploads` in its manifest
  (`{ types: [jpeg, png, webp], maxBytes: 5242880, maxFiles: 500 }`) and to use `host.uploads.inspect`, `put`, `thumb`,
  `url` and `remove` with `scope: 'space'`. Worth a short example in `api-modules.md` beside the `uploads` rule.
- 0.1.13: the page uses `host.header.set([{ id: 'export', ..., overflow: true }])` for Save as image in the title bar's
  menu and `host.standard.set({ print })` with the `printed` event. Host asks not built (reported by the builder, not
  documented): `host.files.save`, `host.files.add` (save to the Vault), `host.standard.run('print')`, a print orientation
  option, `host.uploads.blob(id, { thumb })`.

## CHANGELOG

- 0.1.4: Whiteboard: separate border, background and word colours, line and border widths, four layer moves, and a soft
  shadow on notes.
- 0.1.5: Whiteboard: select several blocks, copy, cut, paste and duplicate, undo and redo your own changes, and move the
  board with Space, the middle mouse button, the wheel, two fingers or the Hand tool; dragging the empty board now picks.
- 0.1.6: Whiteboard: add pictures by pasting, dropping or "Add a picture".
- 0.1.7: Whiteboard: drag with the right mouse button to move the board; a right-click still opens the menu.
- 0.1.8: Whiteboard: flowchart shapes and connectors that follow their blocks, with line style and arrowheads.
- 0.1.9: Whiteboard: a Fill tool, a Marker and a Brush in a new Paint menu, and a timer everyone sees count down together.
- 0.1.10: Whiteboard: bold, italic, code, lists, headings and links in notes, text and shapes, with a formatting bar, and
  a text size and alignment.
- 0.1.11: Whiteboard: give a note a pointer, and a Highlighter.
- 0.1.12: Whiteboard: tables, and paste rows from a spreadsheet as a table.
- 0.1.13: Whiteboard: save the board as a picture, and print it.

## Known limits

- 0.1.5: missed-delete recovery gap (issue #471). The `gone` rules in lib-c recover when this page's own delete echo is
  missed, but there is a gap left for a missed delete (see the issue; not re-read here, as GitHub was not reachable from
  this session).
- 0.1.5: two people changing the same block at the same moment: the last write wins (no conflict check yet).
- 0.1.5: undo history and the clipboard are per page and in memory: gone on reload, not shared between tabs.
- 0.1.6: orphan uploads (pictures whose blocks are all deleted) stay with the space and count toward the 500-file limit;
  there is no tidy-up yet.
- 0.1.6: pasting a picture inside a sandboxed module frame was not proven live (the module runs in the page today).
- 0.1.7: the Windows right-drag menu timing (the menu asked for after the release) was tested only with synthetic events.
- 0.1.5: wheel and trackpad behaviour (two-finger pan, pinch zoom, 12% wheel step) on a real Mac not verified.
- 0.1.9: the timer's clock is rough on a page that never writes, until the `updatedAt` change to the `change` event lands:
  such a page falls back to its own clock, floored by the board read.
- 0.1.13: Print not tested in Safari or Firefox. Wide boards print portrait (an `@page` rule in a shadow root is ignored).
  Ctrl or Cmd P is the browser's own print, not the board's.
- 0.1.13: Save as image in a sandboxed frame cannot hand over a file until the SDK has `host.files.save`.
- 0.1.4: a real call and VoiceOver not verified (no LiveKit server locally).
- 0.1.4: the 5 MB storage limit is for everything the Whiteboard stores in all spaces together (the server sums the
  module's whole data folder), not per space.
