# Panel Stacking Plan

**Audience:** Thomas, who decides whether and how one docked module can sit on top of another in the same column of the canvas; and the sessions that would build it: experience-design (`public/canvas.js`, `public/layouts.js`, `public/style.css`, `public/sdk/system.css`, the Design System Prototype), server-development (`server/layouts.js` and its check, only if saved layouts carry stacks), quality-assurance (each step), content-manager (the architecture and user guides, the changelog).

**Status:** built and on main (#511, 2026-11-09). Steps 0 to 7 are built and checked; the documents are [architecture-canvas](../architecture/architecture-canvas.md), "Stacks", [api-modules](../api/api-modules.md), "Saved layouts" and [userguide-call](../userguides/userguide-call.md), "Stacking modules". Three things differ from the contract below, all decided later or found in the build: Window Mode puts stacks away and Panel Mode brings them back (Thomas, 2026-11-09, see "Window mode and the composite window frames" below); a module keeps its own width while it is stacked (`ownW`) and gets it back when it leaves; and the drop zones are drawn as a preview of the place the module would take ("Polls goes under To-do") and a line between columns ("Its own column here"), not as zones named Stack above and Stack below. Not checked here: Firefox and Safari, a real tablet's touch, a screen reader, a real call. Approved by Thomas, 2026-11-02; the Prototype was locked first (#453). From GitHub #387 (Layout: Stack docked panels by dragging one onto another). Thomas, 2026-11-02: "People like our window mode, but they tend to use the panel mode. In panel mode they could drag a panel into another panel and have them stacked. A good addition, especially for things like polls, which have less data." He then answered "Agreed" to all ten of the draft's questions, taking the planner's suggestions (decisions 1 to 10). Sections below that still say "suggestion" or "proposed" are now these decisions; the contract is the planner's detail of them.

A word on names. Thomas's "window mode" is a floating module and his "panel mode" is a docked one (the module frame's menu says **Open as a window** and **Dock as a panel**). The plan says docked module and column in its own sentences, and a module, never a pane. The place they sit is the canvas.

## Why

A docked module owns a whole column, top to bottom. A module with little to show (Polls with two open polls, To-do with four tasks, Budget's summary) leaves most of its column empty, and the only way to see it beside something else is to spend a column on it. The columns are limited by the window's width ([plan-docked-limit](plan-docked-limit.md): 2 from 641 px, 3 from 760, 4 from 1000, 5 from 1280), so a short module costs the most scarce thing. People already prefer docked modules to floating windows, so the fix belongs in docked mode, not in floating windows.

## What it is today

Read from the code and the documents on 2026-11-02.

- **One module per column.** The canvas is a CSS grid with one column per docked module; `syncDock()` in `public/canvas.js` writes `--canvas-cols`. One column is flexible (the conference when docked, else the first docked module); the others are pixel widths, 240 px at least (`DOCK_MIN`), the flexible one 280 px (`FLEX_MIN`). The docked limit decides how many columns a window holds ([architecture-canvas](../architecture/architecture-canvas.md), "The grid").
- **Dragging a title bar reorders columns.** `wireReorder()` handles a pointer press that moves more than 6 px on a docked module's title bar; the pointer's place among the columns gives the new order, and the canvas wears `.reordering` while it moves. Buttons in the bar still click. It reads only the horizontal position. Nothing in it can drop a module onto another module.
- **Every module is a frame.** `createModuleFrame` in `public/module-frame.js` draws the title bar (36 px, `--mf-title-h`), the toolbar row, the content and the status bar, with `variant: 'docked'` or `'window'`. The frame's menu has **Dock as a panel**, **Open as a window**, **Open in its own window** and **Clear**. `createFrameBands` in `public/module-host.js` joins a module's `host.*` calls (add, header, toolbar, status) to its frame and sends a control's use back to the module as an event.
- **Composites already share a frame.** `dest:calendar` and `dest:map` (`public/composites.js`) are one canvas module whose parts have no title bar or status bar of their own; the composite's one frame draws them and receives the parts' adds, header items and toolbar as one stream ([architecture-module-window](../architecture/architecture-module-window.md), "Destinations"). That is the code a tabbed stack would reuse.
- **What is remembered.** Per space, per browser, `localStorage` key `app.canvas.<space id>`: `__open` (module ids in column order), `__snap`, and per module `mode`, `dockW`, `box`, `snap`, `cell`, `placed`, `layout`, `win` ([plan-saved-layouts](plan-saved-layouts.md)). Saved layouts are on the server (`server/layouts.js`, `layouts.json`): `{ id, name, by, at, modules, snap? }`, ten own and ten shared per space, and `cleanLayout()` accepts only the keys it knows, so a new key needs a server change.
- **Opens with** is a list of module ids only. It holds no modes, sizes or places.
- **Phones.** At 640 px and below the canvas is one view at a time, with no Layout button, no docking and no splitters ([plan-layout-menu](plan-layout-menu.md) decision 6, [plan-phone-experience](plan-phone-experience.md) "What a phone does not offer").
- **The Layout menu** (the space bar's `#modules-menu`) has Show, Arrange and Layouts. Its notes go to `#modules-menu-note` and, for a screen reader, `#layout-announce`.
- **Every drag has a menu route** is already a rule: the Planner's card menu has **Move to another day...**, and the phone plan's decision 7 puts **Move to**, **Move up** and **Move down** in the menu for everything draggable. The title-bar reorder is the one canvas drag with no menu route today.

## What stacking is

A **stack** is a column of the canvas that holds two or more docked modules one above the other, instead of one. Each module in it keeps its own frame (title bar, toolbar, content, status bar), its own menu and its own events. A stack uses one column of the docked limit, whatever it holds. Dragging a module out, or closing all but one, leaves ordinary columns again. Nothing about the modules changes: a module is not told it is stacked, except by the size of its box.

## Decisions

Thomas, 2026-11-02, answering "Agreed" to the draft's ten questions:

1. **The shape is a vertical split with a draggable divider and a collapse on each section** (Option B). It matches "stacked", keeps every module's frame, menu and events unchanged, and does not hide the short module the stack is for. Tabs may come later as another view.
2. **The host decides which modules may stack:** every docked module except the conference, Chat and the composites (`dest:*`). No manifest key. Reason: nothing shows a need for one yet.
3. **At most three modules in a stack.** Three still leave about 180 px of content on a 700 px canvas.
4. **A stack is saved in the person's remembered layout and in saved layouts,** shared and personal, including a space's default layout. `cleanLayout()` in `server/layouts.js` changes to accept it. Opens with does not change.
5. **A floating window is stacked through the menu only at first** (**Stack with...**); dragging a floating window onto a column is later. Reason: one gesture should not mean both moving and docking.
6. **A new stack starts with equal heights;** the divider moves them.
7. **A stack counts as one column** against the docked limit. That is the point of the idea.
8. **A stack left with one module becomes an ordinary column at once.**
9. **The Layout menu's Arrange section gets Unstack all.**
10. **Built after the phone foundations and the object window,** with the rest of the queue. Reason: the object window is built on the phone foundations first ([plan-phone-experience](plan-phone-experience.md), decision 8), and this is a canvas plan that needs neither.

## The options

### Option A: a tabbed stack

One module shows at a time; a tab strip replaces the title bar, with one tab per module.

- **Costs.** Smallest on screen: the stack is exactly one module's size. But a hidden module cannot be glanced at, which is the whole reason for stacking a poll under a task list. The stack needs its own title bar and status bar, which means routing the active module's adds, header items, toolbar and status through one frame: the composite's stream, but with the modules switching in and out, and each module's menu and "+" needing to follow the tab. Hidden modules keep running (as a hidden view does on a phone) or are suspended, which is a second thing to decide.
- **Rules out.** Seeing two modules at once. It reads as "a different way to switch modules", which the Show list already is.
- **Good for.** A narrow column where nothing else fits; modules that need the whole height (a map, a long list).

### Option B: a vertical split with a draggable divider

Two or three modules share the column's height, each with its own frame, divided by a draggable bar.

- **Costs.** Each module spends 36 px on its title bar and some on its status bar, so a stack of three on a 700 px canvas leaves each about 180 px of content. A divider to draw, move, keep inside limits and remember. Heights are a new kind of stored geometry (fractions of the column). A canvas too short for the stack needs a rule (below).
- **Rules out.** Nothing; it is the least surprising reading of "stacked". The module frames and their events are used as they are, so the modules and the composite code are untouched.
- **Good for.** Short modules side by side with a tall one's neighbour: Polls under To-do, Budget's summary under the Planner.

### Option C: accordion sections

Every module in the stack is a section with a title bar; any number may be open at once, and a section's title bar collapses it to just the bar.

- **Costs.** An open and closed state per module, and the open ones share the height anyway, so it is Option B with the divider left out and a fixed split between the open sections. No divider to drag, which is cheaper and easier to use by keyboard and touch, but the person cannot choose how much room each gets.
- **Rules out.** Fine height control. Keeps what a closed section shows to its title bar and whatever a module puts in its status bar.
- **Good for.** Many small modules; also what a vertical split collapses into when the canvas is short.

### Chosen: Option B (decision 1)

**Option B, with a collapse on each section** (so the split degrades to Option C when there is not enough height). It matches what Thomas described ("stacked", polls "less data"), keeps every module's frame, menu and events exactly as they are, and needs nothing from the modules. Tabs (Option A) can be added later as a way to view a stack if wanted; it is the costliest of the three because of the event routing, and it hides the very thing a short module was stacked to show.

## Which modules suit it

Proposed rule, from the modules' own shape. Decision 2.

| Module | Stackable | Why |
|---|---|---|
| Polls, To-do, Budget, Research, Assistant | Yes | Lists or short forms; they scroll inside their own content. Polls and To-do are the cases Thomas named. |
| The Planner | Yes, but it wants the tall slot | It needs height for a day's cards; best as the module others stack under, or the upper section. |
| Places | Yes | A list; the map part belongs to the Map. |
| Calendar and Map composites (`dest:calendar`, `dest:map`) | No in the first build | They are one frame holding several parts and their own panel switch; a stack of a composite plus another module is two layers of layout. A later step if wanted. |
| The conference | No | It is the flexible column and has a bottom bar (`.mod-bar`) in the grid's bottom row; the call's tiles need the width and the height. |
| Chat | No | Its message box has a fixed place in the bottom row, and it must always be one tap away. |
| Stream | Not on a phone | Unchanged. |
| An uploaded module in a sandboxed frame | Yes | It is a frame in a box; the box is smaller. |

A module that cannot work below a height says so. No new manifest field (decision 2); the host rule is a section never gets less than its title bar plus 120 px of content (decision 3 sets the number).

## Drag, drop zones and the menu path

### The drag (pointer, any width above 640 px)

Today a docked title bar drag moves a module between columns and reads only the pointer's horizontal place. Proposed, on the same drag (the same 6 px threshold, the same `.reordering` class):

- While a docked module is being dragged, each other docked column (except the conference's and the chat's, which cannot hold a stack) shows its **drop zones**: the **upper half** and the **lower half** of the column's middle, labelled "Stack above" and "Stack below" with the target module's name; the **outer quarter** of the column's width keeps today's meaning, move between columns (a line where it would land, as now). A zone highlights as the pointer enters it, with the accent token; nothing is drawn until a drag starts.
- Dropping on an upper or lower zone moves the module into that column as a section above or below the target. If it was in a stack, it leaves that stack; a stack left with one module becomes an ordinary column.
- A drop that is not allowed (a column that already has the maximum, a canvas too short, a module that cannot stack) shows no zone there, and the drop does nothing; a one-line note says why in `#modules-menu-note` (and `#layout-announce`) as the docked limit's notes do.
- Dragging a section's title bar out onto the empty canvas, or onto the outer quarter of a column, unstacks it into its own column.
- The drag is never the only way (next).

### The menu path (keyboard, touch, screen reader)

Every title bar menu of a docked module gets these entries, in a group after **Dock as a panel**'s siblings. Their words, proposed:

- **Stack with...** opens the host's menu (`openHostMenu()`) listing the other docked modules that can hold a stack, by name; choosing one puts this module below it. Entries for "Above" and "Below" are two small sub-entries under each name, or a second step, so the drag's two zones both have a route.
- **Move up** and **Move down** in a stack (the phone plan's words), moving the section one place; at the end the entry is hidden.
- **Move out of the stack** (visible only in a stack).
- **Collapse** and **Expand** (visible only in a stack).
- On a floating module, **Dock as a panel** is unchanged (its own column) and **Stack with...** is also offered, docking and stacking in one step (decision 5: the menu only, at first).

These are plain menu entries, so the keyboard reaches them with the menu's keys, a screen reader reads them, and a tablet's finger can tap them. The Layout menu's Arrange section gains one entry, **Unstack all**, putting every stack back to separate columns (next to **Dock all**).

### Placing a divider

The divider between two sections is a bar 8 px tall (a 24 px hit area on a coarse pointer) that is drawn between the lower edge of one status bar and the upper edge of the next title bar. It moves with the pointer; a double click or double tap resets the split to equal heights (the menu has the same as **Equal heights**). Keys: see Accessibility.

## What happens at narrow widths and on a phone

- **641 to 759 px (the docked limit allows 2 columns).** Stacking works and is more valuable here: a stack is one column, so two columns hold up to six modules. The column minimum (240 px) is unchanged.
- **A narrow column.** A stack's column may be 240 px wide; each section is a frame like any docked module and already answers the module's own width (container queries). Nothing special.
- **A short canvas.** Each section needs at least its title bar plus 120 px. If the canvas, or a window that shrinks, cannot give that to every section, the lowest sections collapse to their title bars first, one at a time, and reopen by themselves when the height returns (as docked modules float and re-dock under the docked limit, decisions 3 and 4 there). The person's own collapse choice is not overwritten by this.
- **640 px and below (a phone).** Not offered: one view at a time, no docking, no splitters, no drag. The phone plan lists "the canvas's layout" among what a phone does not offer. A saved layout with a stack that is loaded on a phone shows its modules as separate views, and the stack is kept in what is stored, untouched, for the day the person is back on a wide window. Nothing to build on the phone.
- **A tablet or a narrow desktop window (641 px and over, coarse pointer).** The drag is not reliable by touch ([plan-phone-experience](plan-phone-experience.md): a touch press and move fires no `dragstart`; the title-bar reorder uses pointer events, so it may work, which needs a real tablet). The menu path is the supported way. The divider has a 24 px hit area on a coarse pointer, as the side column's splitters do. Long press to pick up is a later step, as the phone plan decided for lists.

## Window mode and the composite window frames

- **Floating windows (window mode) are untouched.** A floating module's box, its snapping and its z-order work as today. Stacking only exists in docked mode. **Open as a window** on a stacked module takes it out of the stack and floats it; the stack closes up. **Dock as a panel** on a floating module docks it into its own column as today.
- **Window Mode and Panel Mode (Thomas, 2026-11-09, as built).** Choosing **Window Mode** in Set up floats every module and puts each stack away: its modules top first, their shares, their collapse, their own widths and the column's width are kept in the remembered layout (`__stacks`). Choosing **Panel Mode** docks every floating module and rebuilds each stack from the modules still open, still floating and able to stack; a stack left with fewer than two is none and the rest close up. A reload in between keeps it; loading a layout in between forgets it.
- **A stack in a floating window is not planned.** It would be two kinds of layout in one box; the person can float a module or keep a stack docked.
- **Each section is a full docked frame.** Option B uses `createModuleFrame` unchanged per module, so `createFrameBands` (the shared event stream that joins a module's adds, header items, toolbar and status to its frame) is used once per module, as it is now. The stack is a container that holds frames; it has no bar, no events and no stream of its own. Nothing in `public/module-host.js` changes.
- **Composites are not stacked in the first build** (see the table). A stacked module that opens a composite's part (`host.objects.open` to a place, for example) brings the composite's own window forward as it does today.
- **If Option A were chosen,** the stack would draw one title bar and route the active module's bands through it: the composite's stream with a switch. That is the extra cost counted under Option A; it is a reason for the suggestion, not a barrier.
- **The pop-out.** A module opened in its own window (`/modules/<id>`) leaves the stack, as it leaves its column, and returns to a column when it comes back.
- **Object windows.** The [object window](plan-object-window.md) is a modal dialog over the canvas; it is unaffected by stacks. Its **Open as a window** (a later step there) creates a floating window, not a stack member.

## How a stack is saved

Proposed, in three places. Decision 4.

1. **The person's own remembered layout** (browser only, `app.canvas.<space id>`): each stacked module's record gains a stack identity and its place in the stack: `stack` (the id of the column it is in), `at` (its order), `h` (its share of the column's height as a fraction), and `folded` (collapsed or not). The geometry is in fractions, not pixels, so a window that is a different height still gets the same split; the column's width stays `dockW` as now. A module with no `stack` is an ordinary column, so records written before stay valid: this needs no compatibility code because the key is only read if present.
2. **Saved layouts** (the server, shared or personal): the layout's module entry gets the same `stack`, `at`, `h` and `folded`, so "Planning" can be the Calendar and a To-do over Polls. This needs `cleanLayout()` in `server/layouts.js` to accept the new keys with limits (a stack id up to 32 characters of `[a-z0-9]`, `at` 0 to 2, `h` between 0.1 and 0.9, `folded` boolean), the stored shape documented in [api-modules](../api/api-modules.md), and `tools/check-layouts.mjs` to hold the rules. Loading a layout through `placeLayout()` in `public/layouts.js` builds the stacks, passes them through the docked limit as one column each, and leaves a module out as it does now when it is not on in the space.
3. **Opens with** (a space's list of module ids, and the environment's template default): not changed. It is a list of modules and names no places, so it cannot say "Polls under To-do". A layout marked as the space's default can ([plan-layout-views](plan-layout-views.md), the default layout).

As built, a stacked module also keeps `ownW`, the width it had as a column of its own, in the remembered layout only (never in a saved layout), and gets it back when it leaves the stack. The server cleans a bad stack rather than refusing the layout: see [api-modules](../api/api-modules.md), "Saved layouts".

Not saved: which section has focus; the collapse a short canvas forced (only the person's own **Collapse**).

Per person or per space? The remembered layout is per person per space (the person's browser); a saved layout is per person (personal) or per space (shared). A stack is not a new kind of thing to own: it is part of a layout, and travels with whichever layout holds it. An environment template has no layouts, so nothing in templates changes.

## The contract (proposed)

Names follow the project: space, canvas, module, object; a column; no pane or stage. Code names in code format.

### Canvas and layout code (experience-design)

- **A stack in the canvas.** `public/canvas.js`: a docked module's record may carry `stack` (a string id shared by the modules in one column). `dockedModules()` groups by `stack`; `syncDock()` counts a stack as one column (the docked limit, the flexible-column rule and the column widths all apply to the column); a stack's column holds its sections in `at` order, each as the module's own frame.
- **Who may be a section.** Not the conference, the chat or a composite (`dest:*`); every other docked module. At most the maximum of three (decision 3) per stack.
- **Heights.** The sections split the column's height by `h` (fractions summing to 1), minus the dividers. A divider drag changes the two neighbours' `h` only. A section never goes below its title bar plus 120 px of content; collapsed, a section is its title bar (and, if its module has one, its status bar's summary is hidden). The last section to be opened takes the height of the one that collapses, when it does.
- **Drop zones.** Drawn by the canvas during the existing `.reordering` drag, as an overlay on each eligible column that is not part of the chrome. Names for the code are the experience-design builder's.
- **The menu path.** The module frame's menu gains, for a docked or floating module that can stack: **Stack with...**; and for a stacked module: **Move up**, **Move down**, **Move out of the stack**, **Collapse** or **Expand**, **Equal heights**. The frame draws them from the host's standard actions, so a bundled and an uploaded module get them without code of their own. The Layout menu's Arrange gains **Unstack all**.
- **Notes.** The same line as the docked limit's (`#modules-menu-note`, `#layout-announce`): "Polls was stacked under To-do." and "There is no room to stack here." Short, in the host's words.
- **Pure functions** go in `public/layouts.js` (no document), so `tools/check-canvas.mjs` and `tools/check-layouts.mjs` can run them in node: group by stack, split heights and clamp by the minimum, collapse order for a short canvas, resolve a layout into columns and stacks.
- **No SDK change** for the modules. The module learns only its box size, from the frame, as it does today. (If Thomas wants a module to refuse stacking, a manifest key is a later addition.)

### Server and saved layouts (server-development)

- `cleanLayout()` in `server/layouts.js` accepts `stack`, `at`, `h` and `folded` on a module entry with the limits above and **cleans** what does not fit; it does not refuse it (a saved layout is never lost to a bad stack). A stack key on a float, the conference, Chat or a composite is dropped; a stack of one member, and members past the third, become ordinary columns; members are put in `at` order, kept together and renumbered 0, 1, 2; `h` is kept (0.1 to 0.9) only when every member has one and they add up to 1 within 0.01, else all are dropped and the heights are equal. `LAYOUT_LIMITS` in `public/layouts.js` mirrors the limits.
- Nothing else on the server: no new route.

### What a person sees

- A module's title bar, drag it over another docked module: the zones appear; drop; the two share the column with a divider.
- Each section looks exactly like a docked module today, one under the other, with the divider between.
- The title bar menu has the entries above; the Layout menu's Arrange has **Unstack all**.
- Words (plain, no "pane"): **Stack with...**, **Move up**, **Move down**, **Move out of the stack**, **Collapse**, **Expand**, **Equal heights**, **Unstack all**; notes "<Module> was stacked under <Module>.", "<Module> has its own column again.", "There is no room to stack here."

## Accessibility

- **A divider is a separator** you can move: `role="separator"`, `aria-orientation="horizontal"`, `aria-valuenow` (the upper section's share, in percent), `aria-valuemin` and `aria-valuemax`, and a name ("Resize Polls and To-do"). It is a tab stop. Up and Down move it by 16 px (Shift: 64 px), Home and End to the smallest and largest the minimum allows, Enter or double click for equal heights.
- **The stack is a group:** `role="group"` with `aria-label` "Stacked: To-do, Polls", each section its module's frame as today. Focus order is the visual order, top to bottom.
- **The menu path is the equal of the drag.** Every drag result has a menu entry, and a keyboard-only or screen-reader user does not need the drag at all. The drop zones are visual only (`aria-hidden`), as they only exist during a pointer drag.
- **Announcements.** Every stack change is said in `#layout-announce` ("Polls stacked under To-do", "Polls has its own column"). After a menu move, focus returns to the moved module's title bar (or the menu button in it), not to the page.
- **Collapse** buttons are real buttons with `aria-expanded` and a name ("Collapse Polls"); a collapsed section's content is not in the tab order and not read.
- **Target sizes** at least 44 by 44 px on a coarse pointer (divider and collapse included), the design system's rule.
- **Reduced motion.** The split and collapse change without animation under `prefers-reduced-motion`. No state is carried by motion or colour alone: a zone's meaning is its label, not only its highlight.
- **Contrast.** The zones and divider use theme tokens ([design-theme](../designsystem/design-theme.md)) in both modes.

## What the Prototype must draw first

The design process is: draw it in the Design System Prototype, Thomas locks it, then build. Nothing is built until the Prototype is locked. The Prototype uses the real `createModuleFrame`, so it should draw a stack from real frames (the state of [plan-prototype-real-modules](plan-prototype-real-modules.md) permitting; a few sample frames with sample text are enough here). Needed:

1. A stack of two (To-do over Polls) and of three at 1280 px, in dark and light, in a column of 300 px and of 240 px.
2. The divider: rest, hover, focus (the keyboard ring), dragging, and the coarse-pointer size.
3. A collapsed section, and a stack on a short canvas where the lowest sections have collapsed by themselves.
4. The drag: a title bar being dragged, the zones on each eligible column ("Stack above", "Stack below" and the outer edge for moving between columns), the highlighted zone, an ineligible column (the conference, the chat) showing no zone, and the line for the move-between-columns case.
5. The menu: a stacked module's title bar menu with the new entries, the **Stack with...** list and its Above and Below step, and the Layout menu's Arrange with **Unstack all** and a note line.
6. A floating module's menu with **Stack with...**.
7. The state of a stack in the docked limit's squeeze at 760 px (two columns, one of them a stack).
8. A phone (390 px) showing that a saved layout with a stack is one view at a time, so nothing is drawn there.
9. Tabs (Option A) only if Thomas wants to see it before choosing; otherwise not drawn.

## Left to build, in order

Each step is built and checked on its own, and nothing starts until the Prototype is locked (step 0). The kind of build is Thomas's to name; the planner suggests a production build because it changes the canvas, the layout code and what a saved layout holds.

| # | Step | Who | Waits on |
|---|---|---|---|
| 0 | **The Prototype** draws the states above; Thomas locks them. | experience-design | the queue (decision 10); first when scheduled |
| 1 | **The stack in the canvas.** The `stack` record, grouping in `syncDock()`, the column holding frames, heights and the minimum, the collapse for a short canvas, the docked limit counting a stack as one column. Pure functions in `public/layouts.js`. Opened by the menu path only (step 2) for now; no drag. | experience-design | step 0 |
| 2 | **The menu path.** **Stack with...**, **Move up**, **Move down**, **Move out of the stack**, **Collapse**, **Expand**, **Equal heights** in the module frame's menu; **Unstack all** in the Layout menu; the notes and announcements. | experience-design | step 1 |
| 3 | **The divider**, with the pointer and the keys; the double click reset. | experience-design | step 1 |
| 4 | **The drag.** Drop zones on the existing title-bar drag; ineligible columns; the notes. | experience-design | steps 1 to 3 |
| 5 | **Remembering.** The browser's `app.canvas.<space id>` carries stacks; reloading the space restores them. | experience-design | step 1 |
| 6 | **Saved layouts.** `cleanLayout()` and its limits, `LAYOUT_LIMITS`, `captureLayout()` and `placeLayout()`, the stored shape in the API document. | server-development (the server half), experience-design (capture and load) | step 5 |
| 7 | **The checks.** `tools/check-canvas.mjs` (stack grouping, heights, the short canvas, the docked limit), `tools/check-layouts.mjs` (the new keys), `tools/check-nav.mjs` if the Layout menu's Arrange changes, and `check-conformance` measuring the divider's target. | server-development | steps 1 to 6 |
| 8 | **QA** of the whole, at 1280, 760, 640 and 390 px, light and dark, keyboard and screen reader. | quality-assurance | steps 1 to 7 |
| 9 | **Documentation.** [architecture-canvas](../architecture/architecture-canvas.md), [api-modules](../api/api-modules.md), the userguide for the canvas and layouts, the changelog. | content-manager | each step as it lands |

Steps 3 and 5 can go in either order after step 1. Step 4 comes after the menu path so the drag is a convenience on top of a complete feature.

## Verify

- **Step 1 to 4.** On a local server in headless Chromium at 1280 and 760 px, light and dark: two and three modules stacked; the divider by pointer and by key; the collapse; a shrinking window collapsing the lowest section and the height returning; the docked limit counting a stack as one column; the conference and the chat refusing to stack; a drag onto each zone and onto the outer edge; a drag that is refused with its note; Dock as a panel, Open as a window and a pop-out taking a module out of the stack.
- **Step 5 and 6.** Reload keeps the stacks, in the same split at a different window height; a saved layout (personal and shared) holding a stack is saved, loaded on a window with fewer columns, and loaded with a module not on in the space (the stack closes up and the note says so); `check-layouts` fails a copy with a one-module stack and a bad `h`.
- **Step 7.** `npm run check`; the new cases fail on a copy with the wrong grouping.
- **Accessibility.** The tab order, the separator's keys and values, the announcements and the focus return are checked in a browser by script (the keys and the attributes); how a screen reader reads them, and a real tablet's touch, cannot be checked here.
- **Not checkable here:** a real call with a stack open (the conference cannot be in it), a real tablet's touch on the divider and the drag, Firefox and Safari, a screen reader.

## What is not decided

- **Tabs as a second view of a stack** (Option A), if wanted after Option B.
- **Stacking the composites** (`dest:calendar`, `dest:map`).
- **A stack in a floating window.**
- **Long press to pick up** on a coarse pointer.
- **Whether stacks are in Opens with** or templates. They are not proposed.
- **A module saying how tall it needs to be** (a manifest key).

## Open questions

None. All ten of the draft's questions are decided above (Thomas, 2026-11-02). The items under "What is not decided" are later additions, not blockers.
