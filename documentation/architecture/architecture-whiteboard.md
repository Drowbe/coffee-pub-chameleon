# Whiteboard Architecture

**Audience:** developers changing the Whiteboard module, or writing a module that keeps one object per key and pictures.

What a person does with the board is [userguide-whiteboard](../userguides/userguide-whiteboard.md). The module's
permissions and storage rules are those of every module ([api-modules](../api/api-modules.md)); the SDK it calls is
[api-module-sdk](../api/api-module-sdk.md). This document is the shape of the module and the reasons for it. The code is
in `modules/whiteboard/`, version 0.1.10.

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
| `lib-e-block-*` | One file per block type: note, text, shape (rectangle and ellipse), line, stroke, image |
| `lib-f-tool-*` | One file per tool or family: select, pen, place (note, text), shape (rectangle, ellipse, line, arrow), hand |
| `lib-g-history` | Undo and redo |
| `lib-h-clipboard` | Copy, cut, paste and duplicate |
| `lib-i-pictures` | Preparing and sending pictures |

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
or `ends`), `noun`, `linked`, and `refs` and `remap` (read by the clipboard; no block type on main has them yet).

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

## Checks

The module's own tests are in `modules/whiteboard/test/`: `check-whiteboard-sync.mjs`, `-history.mjs`, `-pictures.mjs`,
`-rightdrag.mjs` and `-live.mjs`. `npm run check:module -- whiteboard` runs them, and `tools/check-module-tests.mjs` runs
them inside `npm run check`. They are not in the module's zip. The right-drag and paste tests send synthetic events; a
headless browser has no computer clipboard and the suite has not run on Windows.
