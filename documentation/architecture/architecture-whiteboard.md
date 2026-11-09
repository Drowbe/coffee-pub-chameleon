# Whiteboard Architecture

**Audience:** developers changing the Whiteboard module, or writing a module that keeps one object per key and pictures.

What a person does with the board is [userguide-whiteboard](../userguides/userguide-whiteboard.md). The module's
permissions and storage rules are those of every module ([api-modules](../api/api-modules.md)); the SDK it calls is
[api-module-sdk](../api/api-module-sdk.md). This document is the shape of the module and the reasons for it. The code is
in `modules/whiteboard/`, version 0.1.16.

## Shape

The module is one page, `src/whiteboard.html` with `whiteboard.css` and `whiteboard.js`, and a set of libraries,
`src/whiteboard-lib-*.js`. `server/module-build.js` joins the libraries in name order and puts them where `whiteboard.js`
has `/*__LIB__*/`, so `lib-a` loads first and its two registries exist before the block and tool files add to them.

| Library | Holds |
| --- | --- |
| `lib-a-core` | The block format, the palette, the widths, `wbClean`, the board state, `wbBetween` (layer moves) and the registries `blockTypes` and `tools` |
| `lib-b-policy` | The only place that reads `host.can` (`view` and `edit`) |
| `lib-c-sync` | The only code that touches `host.storage` and the `change` and `changes` events |
| `lib-d-render` | Drawing, the view (pan and zoom), handles, the selection frame, and `wbEditText` |
| `lib-e-block-*` | One file per block type: note, text, shape (rectangle, ellipse and the flowchart shapes), line, connector, stroke, highlight, timer, table, image |
| `lib-f-tool-*` | One file per tool or family: select, pen (pen, marker, brush), place (note, text, timer), shape (rectangle, ellipse, line, arrow and the flowchart shapes), connector, fill, highlight, table, hand |
| `lib-g-history` | Undo and redo |
| `lib-h-clipboard` | Copy, cut, paste and duplicate |
| `lib-i-pictures` | Preparing and sending pictures |
| `lib-j-markup` | What the formatting bar does to the words being edited, as plain text in and out (bold, italic, code, lists, heading, link) |
| `lib-k-table` | Rows copied from a spreadsheet, read as a table's cells (tab-separated text, or the words of an HTML table) |
| `lib-l-export` | The board as a PNG, and the copy that is printed |

`whiteboard.js` is the glue and the one path for every local change: `commit`, then `persist`, then history and sync. A new
kind of block or tool is a new file that registers itself; it does not edit the others.

## Blocks

A block is `{ id, type, x, y, z, fill?, stroke?, ink?, weight?, ...its own fields, by, at }`. `x` and `y` are board units (one
unit is a pixel at 100%), `z` is its place in the stack. Colours are stored by name (Ink and eight tints), never as a colour
value, so they follow the theme. There are three colour roles: stroke (Border), fill (Background) and ink (Words). `wbClean`
cleans every block read against its type, and its limits (`WB_LIMITS`: coordinates to 1,000,000, size and text to 4000,
6000 numbers in a drawing) are what keep a block under the server's 60 KB value limit. A layer move is one write:
`wbBetween` picks a `z` between the neighbours and renumbers only when the gap is too small.

A block type registers `create`, `clean`, `box`, `render` and `describe`, and may add hooks: `paint` (the roles it takes and
the extra choices `none` and `auto`), `weight`, `edit` (`'text'` or `'colour'`), `textField` with `textLine`, `textLabel`,
`textMax` and `editLabel` (the picture's Describe), `textEmpty`, `resize` (`corners` with `min`, `height: false`, `keep`;
or `ends`), `noun`, `linked`, and `refs` and `remap` (read by the clipboard and by the page's delete: the connector has them), `loosen`, `layout` and `attached` (a connector), `copied` (what a copy does not keep: a running timer), `grips` with `grip`, `gripBase` and `tap` (handles of the block's own), `actions` (right-click rows that change fields), `markup` and `reach`.

`linked` names groups of fields that only make sense together: a note or shape `[x, y, w, h]`, a text block `[x, y, w]`, a
line `[x, y, dx, dy]`, a drawing `[x, y, points]`, a picture `[x, y, w, h]`. Undo puts a group back whole or not at all.

## Storage and sync

One board for each space: `WB_BOARD = 'main'`. Each block is one key, `block:main:<id>`, and the whole block is written
each time. Last write wins: no version is sent, and a 409 path is marked in `lib-c-sync`. Two people changing
the same block at once is therefore a lost change, which the user guide says.

The sync rules, from the header of `lib-c-sync`:

- Writes go one at a time for each key, newest last. `saveSoon` waits 600 ms, so a run of arrow-key presses is one write.
- A change heard while this page is writing the same key is deferred and judged, in order, after the write. `seen` keeps the
  newest version known for each key, and a change that is not newer is an echo and is skipped.
- A 429 is retried after the server's wait, up to 8 times, unless a newer write for the key came meanwhile.
- A delete is the hard case, because the server numbers a key afresh after a delete, so a version cannot tell an old change
  from a later one. While a delete of this page's is not heard back (`gone`), every change heard for that key is answered by
  reading the key again (`refetch`), and what the read returns is drawn only if it differs from what the page shows. The
  wait ends when the delete is heard (the oldest pending one, made by this person), when this page's own later write is
  echoed, or when the delete is refused. A read answered after a newer read was asked for, or while this page is writing the
  key, is not used. This closed GitHub #471.

The server checks `edit` on every save (`access.write` in the manifest), so `lib-b-policy` is only for what the page shows.

## Undo and the clipboard

Both live in the page's memory, for one person and one page. Reloading, or a whole-board Clear or restore, empties them.

History records only this page's own changes. One turn of the page's script is one step, and steps tagged alike within 1.5
seconds merge (arrow keys). `history.tag(tag, { join: true })` joins a step to the newest step with that tag however long
ago, even with other steps between; the page tags a picture batch `pictures:<id>` before each block's commit, so pictures
added together are one step whenever their uploads finish. The history keeps 100 steps.

Undo is field-wise and three-way. For each field the step changed, the block's current value is compared with what this
person left. `wbApplyChanges(list, hooks)` writes the result back through the page's one path, with the hooks `get`,
`remove`, `put`, `canChange`, `canCreate`, `clean` and `linkedOf`, and returns `{ left, kept, touched }`. The `linkedOf`
rule (`wbMergeBack`): a field goes back only when neither it nor any field in its linked group has been changed by someone
else since. A block with no field left to put back is kept; a block someone else deleted is left. The result is written as
a new whole-block change, and `wbUndoNote` turns the counts into the notice the person reads.

Copy and cut by key put a mark, the type `application/x-coffee-whiteboard-blocks`, on the computer's clipboard. A paste with
files and no mark adds pictures. A paste with no mark and no files, after a copy here, does nothing, so words copied in
another program do not put down the copied blocks. The copied blocks themselves stay in page memory.

## Pictures

An image block is `{ upload, w, h, alt, stroke, weight }`: the bytes are never in the block. The page prepares a picture
(`createImageBitmap`, long edge 2000 px, a thumbnail of about 400 px; over 5 MB it is re-encoded as WebP and shrunk), sends
it with `host.uploads.put`, then `thumb`, both with `scope: 'space'`, and only then saves the block, in one write.
`wbSniffType` reads the type from the first 16 bytes (JPEG, PNG, WebP, GIF), so the page does not call
`host.uploads.inspect` and each picture spends one of the server's 30 uploads a minute. A GIF is sent as a PNG of its first
frame.

The manifest declares `uploads`: JPEG, PNG and WebP, 5 MB a file, 500 files. Two limits are easy to confuse:

- **5 MB for each picture file** is the manifest's `uploads.maxBytes`. The server also refuses a picture over 100 million
  pixels (`MAX_PIXELS` in `server/vault-types.js`, used by `server/module-uploads.js`).
- **5 MB of stored board data in all** is `LIMITS.moduleBytes` in `server/module-data.js`: everything the module has stored
  for every space together. Pictures are uploads and do not count toward it. One block's value is limited to 60 KB
  (`LIMITS.valueBytes`).

Deleting a picture block never removes its upload. Undo can bring the block back, copies share one upload, other people's
undo history may point at it, and only the person who added a file or an owner may remove it. The one upload the page
removes is one it sent that never got a block. Orphan uploads stay with the space and count toward the 500 files, and there
is no tidy-up yet.

## Snap to grid and the colour strip

`WB_GRID = 24` board units, and the renderer's dots sit on its multiples; `wbSnap(v)` rounds. `ctx.snapping(event)` is the
page's answer: on when the toggle is on, turned round while `event.altKey`. The place and shape tools snap the new block's
corner, corners or ends; select snaps the held block's corner on a move (the others by the same amount) and the dragged
edges or a line's end on a resize, but not when the shape is kept; the **+** snaps the corner; the pen never does. The
toggle is a `host.ui.toolbarButton` with `id: 'snap'`, made again after Delete appears so it stays last. Its state is in
`localStorage` under `whiteboard-snap`, off at first, and never in the board's data.

The colour strip is `#paint` in `whiteboard.html`, filled by `paintShown` and `updatePaint` in `whiteboard.js`: one button
for each colour role and one for the width, each opening `colourMenu` or `widthMenu`. The marks use `data-state` (`colour`,
`none`, `auto`, `default`, `mixed`, `width`) and the theme tokens in `whiteboard.css`. It is hidden for someone who may only
look. `.wb-paint` has `pointer-events: none` and `.wb-paint-btn` has `auto`, so a press beside the buttons reaches the board.

The zoom buttons use `host.toolbar.set` with `placement: 'titlebar'` and are heard as the `toolbar` event (`{ id, x }`).

## Toolbar

The toolbar is the host's (`host.ui.viewSwitch`, `host.ui.toolbarButton`, `host.menu.show`); the module adds no control of
its own. `whiteboard.js` builds it, left to right:

- The tool switch holds every registered tool that is neither `apart` nor in a `group` (Select, Pen, Note, Text, Rectangle,
  Ellipse, Line, Arrow: eight, which is the most it holds).
- A tool marked `apart` is its own on/off button beside the switch (Hand, Timer). Its key and its button turn it on, and
  again off, back to the tool used before it (`toolBefore`).
- A tool with a `group` is a choice in that group's menu, opened by one button (`GROUPS` in `whiteboard.js`): **Paint**
  (Fill, then the Pen, Marker, Brush and Highlighter) and **Flowchart** (the Connector, the shapes, then the Table). The
  Pen is in the switch and is also offered in the Paint menu. The button is on while one of the group's tools is the tool.
  `split` puts a line in the menu after that many choices.
- Undo and Redo, then **Text size and alignment** and **Line style and arrowheads** (each opens a menu), then **Select many**
  (a coarse pointer only) and Delete (made when blocks are picked), and **Snap to grid** last (made again after Delete).

A tool declares `edits: true` when it changes the board; `policy.canUseTool` leaves it out for someone who may only look.

## Connectors

A connector is `{ from, to, style, head, label, stroke, weight }`. Each end is `{ block, side }` (`side` one of `auto`, `top`,
`right`, `bottom`, `left`) or a free point `{ x, y }`. Where it runs is never stored: `layout` works it out each time it is
drawn from the boxes of the blocks it is attached to (`wbRoute`, plain arithmetic, tested on its own), so a block that moves
or changes size moves its connectors with no write of their own. While a block it points at is not on the board the
connector is not drawn. `wbAttachable` says which blocks take a connector: a block with a box of its own and corner handles
(not a line, a drawing, a highlight or another connector).

A delete is the page's, not the block type's: `remove` in `whiteboard.js` removes the connectors that point at the block first
(`connectorsOf`, from each type's `refs`), then the block, in one history step, so one undo brings back the block and then
its connectors, each with its own id. A block removed by someone else takes its connectors from this page too
(`missingRefs`). The clipboard copies the connectors whose blocks are all in the copy; a connector copied without one of its
blocks has that end made a free point (`loosen`). `ctx.attachAt` finds the block under a point, with a reach of 12 screen
pixels (20 for a finger). With Snap to grid a free end goes on the grid; an end on a block does not.

The two menus (Line style, Arrowheads) are `WB_CONNECTOR_STYLES` and `WB_CONNECTOR_HEADS` in `lib-e-block-connector`.

## Paint, the Fill tool and the Highlighter

A freehand stroke has a `brush`: `pen`, `marker` (wide, round, a little see-through) or `brush` (a filled shape, thinner at
the ends). `widths` holds one percentage per point, kept only for a pen or a finger that reports force, and only while the
stroke has at most 2000 points (`maxWide`) so it stays under the 60 KB value limit. A stroke with no `brush` is a pen's.
Each kind has a `usual` width (Pen 3, Marker 12, Brush 8). The highlight is a block of its own (`points`, `stroke`, `weight`),
drawn as one path in a see-through wash of its colour so it is no darker where it crosses itself; the Shift straight band is
`straight` in the block type. It does not lock onto what it covers; the design for that is noted in `lib-a`, not built.

The Fill tool makes no block. `wbFillAction` (plain, tested on its own) decides: fill a block whose type has a `fill` paint
role, take its colour with Alt (`pick`), do nothing when it has that fill already, or refuse. The fill colour is the page's
`next.fill`, the same one the Colour menu sets for new blocks, Yellow at first. The tool unpicks everything when it is chosen
so that the colour strip and the Colour menu set the fill colour and not a picked block's.

## Words as markup

A note, text block, shape and table cell have `markup: true`: the words are stored as written in the small markup chat uses
and drawn by `wbShowWords` through the host's `host.util.markdown` (escaped first), the one place that puts a person's
words into the page. `wbPlain` makes the plain text for a screen reader and for a block's description through
`host.util.plain`. `size` (`WB_SIZES`: small, medium, large, huge) and `align` (`WB_ALIGNS`) are closed lists each type cleans
to; the usual is a type's own.

The formatting bar is `wbFormatBar` in `lib-d-render`, put on the board by `wbEditText` when the block type has `markup`.
Each button is a function in `lib-j-markup` that takes `{ value, start, end }` and gives back the same, so the text box's own
undo keeps each change; `wbLinkAddress` makes a typed address safe (only http and https, brackets escaped, at most 2000
characters). A link in the drawn words opens in a new tab from `openLink`, which accepts only http and https; the browser's
own click, middle click and drag on a link are stopped.

## The note pointer

A note's `pointer` is null or `{ dx, dy }`, the tip's offset from the note's middle. `wbPointerClamp` keeps the tip between
`WB_POINTER.min` and `max` (12 and 800) units outside the note on every clean and every resize. `wbPointerShape` works out the
outline each time it is drawn: the side facing the tip and the base along it are never stored. The pointer is part of the note
for a press and for the export, but not of its `box`; the type's `reach` takes in the tip (`renderer.reachOf`) for selecting by
rectangle, layers and the export. The tip's handle is a `grip` of the note type.

## The timer

A timer is `{ w, h, length, state, startedAt, remaining, fill, stroke, ink }`. `state` is `idle`, `running` or `paused`.
While it runs nothing is written: every page works out what is left from `startedAt`, the server's time in milliseconds, and
its own guess of the server's clock. Start, Pause, Reset and a new length are one write each (`wbTimerStart`, `wbTimerPause`,
`wbTimerReset`, `wbTimerSetLength`, plain functions).

The guess is `createServerClock` in `lib-c-sync`. Its evidence is the `updatedAt` the module host puts on every write and on
every `change` event ([api-module-sdk](../api/api-module-sdk.md)): a write of this page's gives the offset to within half the round
trip, a change heard live gives a floor, a board read gives only a loose floor. Pages whose own clocks differ therefore show
the same time. A copy of a timer is never running (`copied`). A timer that ended more than 10 seconds before the page saw it
is not sounded. The page plays a tone with the Web Audio API only after a press or key on the page, and keeps the mute choice
in `localStorage` under `whiteboard-timer-mute`; neither is in the board's data. The words read out (`say`) are in a live region
(`#say`).

## Tables

A table is one block and one stored value: `{ w, cols, rows, cells, head, fill, stroke, ink, weight, size, align }`. `cols`
holds the column widths, `rows` each row's least height (null: as tall as its words, measured on the page and never stored),
`cells[r][c]` the words, with empty cells at the end of a row and empty rows at the end left out. `w` is always the sum of
`cols`. The limits are in `WB_TABLE` (20 columns, 50 rows, 500 characters a cell, and `textMax` 48,000 characters for all the
cells as stored), enforced by `clean`, so one table always fits the 60 KB value limit. The operations (insert and delete a
row or column, set a cell, step to the next cell, scale, drag a line) are plain functions that return the fields to change or
`{ refuse }`.

The page does the rest in `whiteboard.js`: the cell being edited, the active cell (a mark on the cell, never saved), and the
merge when someone else changes the table while a cell is edited. The table is not held while a cell is edited: a change from
someone else is drawn at once, and the cell's words are then written into the newest table with `wbTableSetCell`, so their
other cells stay. Cells are found by their place, so a row or column added above or left of the cell meanwhile moves the words
to the cell now in that place; a cell no longer in the table is not kept, and the person is told. The cell editor is
`wbEditText` with `keys`, a hook that takes Tab, Shift+Tab and Enter first. In a cell, Escape puts back only the cell being
edited; cells kept earlier are their own saves and undo steps.

A paste of rows is read in `lib-k-table`: tab-separated text (a tab on at least half of the lines), or the words of the first
`<table>` in the clipboard's HTML. The HTML is parsed by `DOMParser` into a document that is never shown, only its text is
kept, and the HTML is never put anywhere. At most one row and one column past the limits are read, so a cut is seen.

## Save as image and print

`lib-l-export` copies each block's drawn element into an SVG `<foreignObject>` the size of the part of the board exported,
with the module's own CSS rules that apply, the theme's tokens as they are now and the page's fonts (fetched once, as data
URLs, at most 1 MB). Pictures are fetched and put in as data URLs, because an SVG image may load nothing from outside. The SVG
is a `data:` URL, since a `blob:` URL with a `foreignObject` taints the canvas in Chromium; it is drawn on a canvas and saved
as a PNG. The words go in only through `wbShowWords`. The selection frame, handles, grips, connection points, the Fill tool's
mark, a table's active cell and an open text box are left out. A canvas longest side is limited to 16,384 pixels and its
area to 64 mega-pixels (`WB_EXPORT`); a larger picture is made smaller and the person told.

`wbExportPick` chooses the blocks (everything; the picked blocks and every connector whose blocks are all picked; what
overlaps the view), `wbExportExtent` the part of the board (a margin of 32 units round everything or the selection, none
round the view), `wbExportName` the file name ("Whiteboard 2026-11-09 1432.png"). Not offered: an SVG file, because a
`foreignObject` is drawn by a browser but not by most drawing programs.

The file reaches the computer through `host.files.save` when the SDK has it; the SDK has no such call yet, so the page makes a
download link, which works for a module that runs in the page (the bundled ones). In a sandboxed frame a download is blocked,
and the page says it cannot.

Print uses the host's standard Print: `host.standard.set({ print: { run } })` ([api-module-sdk](../api/api-module-sdk.md)).
`run` puts the same copy, kept in the page so it follows the light colours the host shows while it prints, in an SVG the width
of the paper (`.wb-print` in `whiteboard.css`); the host prints the module's content and the module takes the copy away on
`printed`. Print is not started by a key or a button of the board's own: only the title bar's menu starts it. **Save as
image…** is a `host.header.set` item with `overflow: true`, so it is in the title bar's menu, before the host's standard
actions. Both are available to anyone who may see the board.

## Checks

The module's own tests are in `modules/whiteboard/test/`: `check-whiteboard-sync.mjs`, `-history.mjs`, `-pictures.mjs`,
`-rightdrag.mjs`, `-live.mjs`, `-connector.mjs`, `-timer.mjs`, `-markup.mjs`, `-pointer.mjs`, `-table.mjs` and `-export.mjs`. `npm run check:module -- whiteboard` runs them, and `tools/check-module-tests.mjs` runs
them inside `npm run check`. They are not in the module's zip. The right-drag and paste tests send synthetic events; a
headless browser has no computer clipboard and the suite has not run on Windows. The export test covers the sums only
(which blocks, the part of the board, the size, the file's name); drawing the picture needs a browser and is not in the
suite. Nothing prints in a test. `check-whiteboard-live.mjs` and `-rightdrag.mjs` need Chromium and say SKIPPED without it.
