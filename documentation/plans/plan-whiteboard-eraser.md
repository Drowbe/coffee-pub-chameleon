# Whiteboard Eraser Plan: an eraser tool

**Audience:** Thomas, who decides; experience-design (the tool, the cursor, the toolbar); quality-assurance (a short pass once built); content-manager (the Whiteboard documents once it is built).

**Status:** Decisions recorded, 2026-11-12 (Thomas chose in the option box); the plan is ready to build, nothing is built or run. The request is GitHub #662: a user asked for an eraser on the whiteboard. Thomas chose a short plan first. Facts are marked **(code)** (read in the code) or **(docs)**. The Whiteboard calls what it holds blocks (the module's own word, as the architecture page uses it); they are the objects of the Names list.

## What it is today

- **There is no eraser.** A person removes a stroke by picking it (Select) and pressing Delete, or the Delete button, or its menu row **(code, `whiteboard.js`, `removeMany`)**.
- **A stroke is one block** of type `stroke`: `points` as flat numbers relative to `x, y` (at most 6000 numbers, 3000 points), `brush` (`pen`, `marker`, `brush`), optional `widths`, `stroke` colour and `weight` **(code, `whiteboard-lib-e-block-stroke.js`)**. The Highlighter is its own block type **(code, `lib-e-block-highlight.js`)**.
- **Who may delete:** `policy.canDelete(block)` is `edit && block exists && block.locked !== true` **(code, `lib-b-policy.js`)**. There is no rule about who made a block. The server checks `edit` again on every save (`access.write`).
- **Deleting several:** `wbDeleteSet` drops the locked ones, adds any connector attached to a deleted block, and `remove(id, { force: true })` records each in the history, then `sync.remove(id)` **(code, `lib-m-arrange.js`, `whiteboard.js`)**. A frame's delete takes the frame alone, not what is inside it **(code, `lib-e-block-frame.js`)**.
- **Undo** keeps 100 steps; one turn of the script is one step; `history.tag(tag, { join: true })` joins later steps to the newest step with that tag **(docs, architecture-whiteboard, "Undo and the clipboard")**.
- **Sync is last write wins, not compare-and-set.** The sync header says no version is sent on a write, and a delete is a plain delete, with the `gone` and `refetch` rules for hearing it back **(code, `lib-c-sync.js`; docs, "Storage and sync")**. A person's page keeps others' edits through `wbResyncPlan`, which never touches ids in `pending` **(code, `lib-r-resync.js`)**.
- **Finding what is under the pointer** is done by the page's elements: `renderer.blockAt(e.target)` **(code, `lib-d-render.js`)**. There is no geometry test of a point against a stroke.
- **The toolbar:** the **Tools** switch holds Hand, Select, Pen, Fill, Text, Note, Flowchart, Shape, Table and Frame (10 of its 12 choices). Pen, Shape and Flowchart are families whose kinds sit on the strip; the Pen family is `pen`, `marker`, `brush`, `highlight` **(code, `FAMILIES`, `SWITCH` in `whiteboard.js`)**. A toolbar holds 16 entries (`TOOLBAR_LIMITS.items`, `public/module-chrome.js`); the switch is one entry. With Timer, Present, Delete, Arrange, Undo, Redo, Overview, Grid and Snap the row is at most 11, and the host folds the rest into More on a narrow board **(code, docs, "Toolbar")**. The architecture page still describes the older Paint group; the families are what the code does.
- **Keys in use** in the tools: a, b, c, d, f, g, h, l, m, n, o, p, r, s, t, u, v and y (Timer). `e` is free in the tools; Ctrl or Cmd E is "code" while editing words **(code, `lib-f-tool-*.js`, `whiteboard.js`)**. The call's own keys were not checked.
- **The icon** `eraser` is in the shipped Font Awesome Free solid set **(code, `node_modules/@fortawesome/fontawesome-free/svgs/solid/eraser.svg`)**.
- **The write limit** for a module is 240 a minute for a person **(code, `server/module-limits.js`)**; a 429 is retried up to 8 times **(code, `lib-c-sync.js`)**.

## Decisions

Decided by Thomas, 2026-11-12. The options below stay as the record, with the chosen one marked **Chosen**.

1. **DECIDED: whole strokes it touches (option 1A).** Parts of a stroke is a later step. *Reason:* it is small and reuses delete and undo.
2. **DECIDED: strokes and highlights only (option 2A).** Locked blocks are skipped and counted; frames and connectors are never erased. *Reason:* a stray sweep over a note or a table would lose real work.
3. **DECIDED: the eraser is its own choice in the Tools switch (option 3B), not a kind of Pen.** The switch goes from 10 of 12 choices to 11 of 12, which leaves 1 spare. A next tool needs the switch's cap raised or a different place. The key is `E`, the strip's colour swatch is hidden for it, and the icon is `eraser` from Font Awesome Free solid. *Reason:* Thomas chose it for being easier to find than a kind inside the Pen family.
4. **DECIDED: one size to start (option 4A).** *Reason:* a size menu can follow if people ask.
5. **DECIDED: key `E` (option 5A).** The call's own keys are checked when it is built.
6. **DECIDED: 100 blocks to a sweep, then the note "Lift and sweep again." (option 6A).** *Reason:* it stays inside the 240 writes a minute, and undo restores the lot.

## Options

### 1. What the eraser removes

- **A. Whole blocks** the pointer touches, as it sweeps. Costs: one delete per stroke touched; a long stroke goes for one touch. Rules out nothing; it uses the delete path as it is, with its undo. **Chosen.** *Lean: this one for the first build.*
- **B. Parts of a stroke.** The stroke is cut at the pointer and becomes two new blocks (new ids), the old one deleted. Costs: a data change (a split of `points` and `widths`, and a new rule for a stroke's end taper on a brush), a point-to-polyline test against the radius, and one delete plus up to two writes for each stroke hit; the undo step has to put back one block and remove two. Long strokes cost most (up to 3000 points to walk, only after the box test). *Later step, once A is in use and people say whole blocks are too coarse.*

### 2. Which blocks it acts on

- **A. Strokes and highlights only** (every freehand mark). **Chosen.** The eraser is a drawing tool; a stray sweep over a note, a table or a picture would lose real work.
- **B. Every kind except frames,** so notes and shapes go too. A sweep across a busy board then removes by accident what Select is for.
- Either way: a **locked** block is skipped and counted; a **frame** is never erased (it would take only itself and leave its contents), and a **connector** is not erased on its own. Someone without `edit` does not get the tool (`canUseTool`, as every tool with `edits: true`).

### 3. Where the button goes

- **A. A fifth kind of the Pen family** (with Pen, Marker, Brush, Highlighter), on the strip, with the key `E`. No new toolbar entry; it is next to the pen. The strip's colour swatch does not apply to it and is hidden for this kind. Not chosen.
- **B. Its own choice in the Tools switch** (11 of 12). Easier to find; one more choice to fold into More on a narrow board. **Chosen.** It leaves 1 spare choice; a next tool needs the switch's cap raised or a different place.
- **C. An `apart` button** after the switch (like the Timer). One more entry (about 12 of 16), and it is a toggle, not a tool of the switch.

### 4. Size

- **A. One size to start** (about 12 screen pixels across; board units at the zoom, so it feels the same at any zoom). **Chosen.**
- **B. Three sizes** (small, medium, large) from the strip's Width menu, which already exists for the pens.

## The contract (on the leans)

- **The tool:** a new `lib-f-tool-eraser.js`, `id: 'eraser'`, `edits: true`, `key: 'e'`, `icon: 'eraser'`, a choice in the Tools switch (`SWITCH`, 11 of 12), not in `FAMILIES`. The strip's colour swatch is hidden while it is active. It registers like the other tools; the one change outside the new file is the switch list in `whiteboard.js`, inside the module.
- **Hit test:** a pure function, `wbEraserHits(blocks, from, to, radius, kinds)`, in the tool's file, so it can be tested without a page. For each pointer move it takes the segment from the last point to this one, tests each candidate block's box first (grown by the radius), and only for those walks the stroke's points for a segment within `radius + weight / 2`. A highlight is tested the same way on its box. Boxes are read from the block, not the page.
- **While dragging:** each block hit is removed through `remove(id, { force: true })` (so `canLock` and the history apply), and the block is dimmed at once so it does not seem to be missed. A drag is **one undo step**: the page tags it `erase:<n>` with `join: true`. Undo puts them all back through the existing path; redo deletes them again.
- **The cursor:** a circle the size of the erase radius, drawn in the theme's tokens (a neutral border, no fill), following the pointer; on a touch screen no circle, the same radius. A stylus's eraser end is not used in the first build (browsers report it as `buttons & 32`; its support differs).
- **The limit:** at most 100 blocks to a drag. At the 101st the drag goes on drawing the circle but removes nothing, and the status line says "Erased 100. Lift and sweep again." Locked blocks passed over are counted in the usual locked note. *Reason for 100:* the write limit is 240 a minute, and the retry path already waits on a 429.
- **What others see:** exactly what a Select delete shows them, a block disappearing as each delete is heard. Nothing new is sent.
- **Pressed Escape or a lost pointer** ends the drag; what was already erased stays erased and is one undo step.
- **Permissions:** unchanged. No new right in `module.json`.

## Sync and conflicts

- A half-finished drag is not lost: each block is deleted when touched, so what has gone, has gone; the rest is untouched.
- Someone changing a stroke (a colour) at the moment it is erased is last write wins, as everywhere in this module. The delete uses the same `gone` rule that already guards a delete against a late change **(code, `lib-c-sync.js`)**. What happens to a colour change that lands just after another's delete is **not verified**; the build checks it live with two pages.
- After a dropped connection, `wbResyncPlan` keeps erased ids in `pending` until their delete is heard, so a resync does not bring an erased stroke back.
- Mass accidental erase is recovered by undo (one step). Only the person's own page undoes; another person cannot undo it for them.

## Performance

A board with thousands of strokes is safe because of the box test first: a move tests each block's box (a few numbers) and walks points only for the few near the pointer. A pointer move is not tested more often than once a frame. Nothing is indexed or stored; a grid index is a later step if a test with 5000 strokes shows a delay.

## Left to build, in order

1. **The hit test and its checks** (small, sonnet): `wbEraserHits`, with `check-whiteboard-eraser.mjs` (boxes, a stroke touched and not touched, locked, a frame, the 100 limit, a diagonal pass between two moves). Owner: experience-design.
2. **The tool, the cursor and the button** (medium, sonnet): the tool, its own choice in the Tools switch (11 of 12), key E, the hidden swatch, the status line, the one undo step, the keyboard help and the switch's hint text. Owner: experience-design. Module version bump.
3. **Two-page live check** (small, sonnet): quality-assurance, a short pass.
4. **Documentation** (small, sonnet): the Whiteboard architecture page and user guide, the CHANGELOG. Owner: content-manager.
5. **Later, only if asked:** parts of a stroke (option 1B), three sizes, the stylus end (medium each).

**Core changes: none expected.** Everything is inside `modules/whiteboard/`. The Tools switch is then at 11 of 12 choices.

## Verify

- **Checked by a tool, no browser:** the hit test as a pure function; the one-step undo and redo with `wbApplyChanges` on a set of strokes (read from `check-whiteboard-history.mjs`'s way); `npm run check`; `npm run check:docs`.
- **Live in a browser (Playwright, two pages as two people, as `check-whiteboard-live.mjs` does):** a sweep erases on both pages; undo brings the strokes back on both; a locked stroke stays; a sweep on a board of 2000 strokes stays smooth.
- **Not verified here:** a stylus or touch (a mouse only), Safari, and anything inside a real LiveKit call.

## Risks

- A sweep that deletes strokes the person meant to keep. Mitigation: strokes only, the cap, one undo step.
- The 240 writes a minute limit with a very large sweep. Mitigation: the cap, the retry path.
- The Tools switch is at 11 of 12 choices; one spare is left.
- The strip shows colour controls that mean nothing for the eraser. Mitigation: hide them for this kind; the build checks `updatePaint`.
- Reading `buttons & 32` for a stylus eraser differs by device; left out of the first build.

## Not decided

Parts of a stroke (1B), three sizes, the stylus end, and erasing notes or shapes. Where a twelfth-plus tool goes: the switch has 1 spare choice, so the next one needs its cap raised or a different place.

## Questions for Thomas (answered 2026-11-12; see Decisions)

1. **What should the eraser remove?** (a) Whole strokes it touches. (b) Only the part under the pointer, cutting a stroke in two. **Answered: (a).** *Recommend (a) now, (b) as a later step:* (a) is small and reuses delete and undo; (b) changes how a stroke is stored.
2. **Which things may it erase?** **Answered: (a).** (a) Strokes and highlights only. (b) Every kind except frames. *Recommend (a):* a stray sweep over a note or a table loses real work; Select and Delete is there for those.
3. **Where does the button go?** **Answered: (b), not the recommended (a).** (a) A fifth kind of Pen next to Marker, Brush and Highlighter, key E. (b) Its own choice in the Tools switch. (c) A separate button after the switch. *Recommend (a):* no new toolbar entry, and it sits by the pen. Thomas chose (b); the Tools switch goes to 11 of 12.
4. **How many sizes?** **Answered: (a).** (a) One to start. (b) Three (small, medium, large) in the Width menu. *Recommend (a):* a size menu can follow if people ask.
5. **Keyboard shortcut?** **Answered: (a).** (a) E. (b) None. *Recommend (a):* E is free in the Whiteboard's tools (the call's keys will be checked when it is built).
6. **How many blocks may one sweep erase?** **Answered: (a).** (a) 100, then "Lift and sweep again." (b) 200. (c) No limit. *Recommend (a):* it stays well inside the 240 writes a minute, and undo restores the lot.
