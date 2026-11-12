# Whiteboard Boards Plan: several boards in one space

**Audience:** Thomas, who decides (here the project manager decides for him while he is away, by the defaults in "Questions for Thomas"); experience-design (the Whiteboard page, the switcher, the menus); quality-assurance (an independent read before the last merge, because this is stored data); content-manager (the Whiteboard documents once it is built).

**Status:** Decisions recorded 2026-11-12 by the project manager under Thomas's delegation (he was away): defaults taken; Thomas can revisit. Nothing is built or run. The request is GitHub #555: users asked to do several drawings at once. Facts are marked **(code)** (read in the code at `3d384153`, Whiteboard 0.1.52) or **(docs)**. The Whiteboard's own words are board, block and frame; a block is an object of the Names list. Builds on [plan-module-live](plan-module-live.md) (pointers) and the Whiteboard architecture page.

## What it is today

- **One board for each space, and the code already carries a board id.** `WB_BOARD = 'main'` is a constant **(code, `whiteboard-lib-a-core.js`)**, and its comment says several boards "is a list of ids and a switch". Every key has the id in it **(code)**:
  - blocks: `block:main:<id>`, one whole block per key (`createSync`, `lib-c-sync.js`);
  - the board's settings (its background): `_board:main:settings` (`WB_BOARD_PREFIX`, `lib-a-core.js`);
  - the shared presentation: `_present:main:state` (`WB_PRESENT.key`, `lib-q-present.js`).
- **The page builds two syncs once, with that constant:** `sync` for the blocks and `boardSync` for the settings **(code, `whiteboard.js` lines 445 and 488)**. Nothing in the page can change the board id after load.
- **Unsaved writes are kept in the browser** (0.1.51): `localStorage` under `wb-pending:<space>:<prefix>`, the newest intent for each key, at most 2,000,000 characters, for 10 minutes, and only for the same person **(code, `lib-c-sync.js`, `WB_PENDING_CAP`, `WB_PENDING_TTL`, `replay`)**. The prefix has the board id in it, so the entry is already one for each space and each board.
- **What each part keeps, and where:**
  - History: in the page's memory, one list of at most 100 steps, emptied by a reload of the board or a whole-board Clear **(code, `createHistory({ cap: 100 })`; `reload()` calls `history.clear()`; docs, "Undo and the clipboard")**.
  - The timer is a block of type `timer`, "the board's one timer" **(code, `whiteboard.js`, "timers")**, so it is already part of one board's blocks. Whether it is hidden is kept in this browser per board id (`whiteboard-timer-hidden:main`); where its clock sits (`whiteboard-timer-pos`), the mute, the grid, snap, the overview and the pointers switch are this person's, kept in this browser, not per board **(code)**.
  - The background is board data (`_board:main:settings`); the grid dots, snap and the overview are the person's own **(code)**.
  - Live pointers: one topic, `pointer`, and the message has no board in it (`{ x, y, tool }`) **(code, `lib-p-pointers.js`, `WB_LIVE`)**. With two boards, a pointer on board A would be drawn on board B.
  - Present: the record `_present:main:state` is one for the board; the page hears only that key (`hearShared`) **(code)**.
  - Save as image, Find, the overview and Print work on the blocks the page holds **(code, headers of `lib-l-export.js`, `lib-o-find.js`, `lib-n-overview.js`; to be confirmed as the build touches each)**.
- **Who may do what:** two permissions, `view` (guests included) and `edit` (members and moderators; not guests), and `access` says read is `view` and write is `edit`. `lib-b-policy.js` only shapes the screen; the server checks `edit` on every save **(code, `module.json`, `lib-b-policy.js`)**. There is no finer rule, such as "only the owner deletes".
- **The toolbar** holds at most 16 entries (`TOOLBAR_LIMITS.items`, `public/module-chrome.js`). The Whiteboard has at most 11 today: the Tools switch (11 of its 12 choices), Timer, Present, Delete, Arrange, Undo, Redo, Overview, Grid and Snap **(code; docs, plan-whiteboard-eraser)**. A switch counts as one entry, holds up to 12 choices, and a choice's label is cut at 30 characters **(code, `TOOLBAR_LIMITS`: `tabs: 12`, `label: 30`)**. The title bar's menu (`host.header.set`) takes at most 10 entries **(code, `module-chrome.js`)**; the page sets at most 6 (Background, Save as image, Present, Present to everyone, Rejoin, Pointers) and four title-bar buttons (Zoom out, Zoom in, Zoom, Find) through `host.toolbar.set` **(code, `whiteboard.js`, `setHeader`)**. Whether those four buttons share the 10 was not checked.
- **The write limit** is 240 writes a minute for one person in one module; a refused write (429) is sent again after the wait it names, up to 8 times, then parked for a minute **(code, `server/module-limits.js`, `lib-c-sync.js`)**.
- **The size limit:** 5 MB of stored data for the module in all, for every space together (`LIMITS.moduleBytes`, `server/module-data.js`); one key's value is at most 60 KB. Pictures are uploads and do not count **(code, docs)**.
- **There is no delete by prefix.** The storage calls are `get`, `set`, `delete` and `list` **(code, `public/sdk/host.js`)**, so taking a board with 400 blocks away is 400 deletes, each one a write.
- **Clear** (the last entry of the module's title-bar menu) removes everything the module holds in the space, in one call, and Undo brings it back for a short time. A key starting with `_` is bookkeeping and is not counted **(docs, architecture-modules, "Clear and Undo"; code, `isBookkeeping`)**. It is the host's and knows nothing of boards.
- **The Whiteboard registers no objects of its own** that other modules can point at **(code, no `refs` in `module.json`)**. `refs.produces` exists for a module that wants to **(docs, api-modules)**.
- **How Documents does its list, a model:** one record for each document, `doc:<id>` with title, size, excerpt and an optional preview; a removed document goes to `_trash:<id>` and stays 7 days (`DL_TRASH_DAYS`), where an editor can bring it back or delete it for good **(code, `documents-lib-a-records.js`, `documents.js`)**.
- **Shared pieces that exist:** `host.ui.viewSwitch` (tabs in the toolbar), `host.ui.toolbarButton`, `host.menu.show`, `host.header.set`, `host.ui.prompt({ title, label, value, action, maxLength, validate })` for a name, `host.ui.confirm({ ..., typed })` for a delete **(code, `public/sdk/host.js`)**.

## Decisions

Decided 2026-11-12 by the project manager under Thomas's delegation (he was away); each is the recommended option A of the question at the end. Thomas can revisit any of them.

1. **DECIDED: boards are tabs in the toolbar (`host.ui.viewSwitch`), up to 12 choices.** *Reason:* shared piece, one entry, best for a few boards.
2. **DECIDED: the tabs are one new toolbar entry, first in the row (12 of 16); New, Rename, Delete and Deleted boards are one "Boards..." title-bar menu entry (7 of 10).** *Reason:* nothing is dropped, and room is left for Duplicate.
3. **DECIDED: today's board keeps the id `main` and its keys, and reads as "Board 1" until renamed.** No copy, no move, no migration. *Reason:* it costs nothing and loses nothing.
4. **DECIDED: delete is a confirm (with the count of blocks), then a 7-day trash like Documents; anyone who may edit can delete and restore; the last board cannot be deleted.** *Reason:* a mistake can be undone, and no new permission is needed.
5. **DECIDED: 10 boards for a space.** *Reason:* the tabs hold 12, and the module's 5 MB is shared by every space.
6. **DECIDED: Duplicate board is a later step.** *Reason:* it is a burst of one write for each block against 240 a minute.
7. **DECIDED: the timer is for each board.** *Reason:* it is a block, so it follows the board for free.
8. **DECIDED: a person lands on the board they used last in this browser, else the first.** *Reason:* it returns them to their work.

The other leans in the options (history kept for each board in memory, pointers on a topic for each board, present for each board) stand as the plan's contract.

## Options

### 1. The model: what a board is, and what happens to today's board

A board is a record in the module's space storage:

`board:<id>` = `{ id, type: 'board-record', name, order, by, at }`

- `id`: 1 to 16 lowercase letters and digits, made by the page (no `:` ever, as `wb.id` refuses it **(code, `lib-a-core.js`)**). It is the board part of every key.
- `name`: plain text, 1 to 40 characters, cut and cleaned like Documents' titles. Duplicate names are allowed (the list shows them in order).
- `order`: a number; the list is sorted by it, then by `at`. A new board goes last.
- The blocks stay at `block:<id>:<block id>`, the settings at `_board:<id>:settings`, the presentation at `_present:<id>:state`. Nothing about a key's shape changes; only the id in it stops being a constant.
- The list itself is read with `host.storage.list('board:')` and kept current by a third sync with the prefix `board:`, in the way `boardSync` already is for the settings **(code, `whiteboard.js` line 488)**. The record is small and clean, so it fits the 60 KB value limit with room to spare.

**What happens to today's single board (no migration code):**

- **A. Today's board becomes the first board with the same id, `main`, and so the same keys. (Chosen.)** Nothing is moved, copied or renamed. A space with no `board:main` record reads as one board named "Board 1" (the same way a missing `_board:main:settings` reads as the default background today **(code, `wbCleanBoard`)**); the record is written the first time someone renames it, or makes a second board. The reserved id `main` is what makes this work, and it costs one rule: `main` is never given to a new board.
- **B. Today's board is renamed to a new id** (a made id) with its keys moved. Rules out nothing, but needs a copy of every block (the burst below) and a rename of keys, which is a migration in all but name. Not recommended. The product is not released and the rule is no migrations.
- **C. Reset: today's board is dropped.** Test data may be reset **(CLAUDE.md)**, but a team's drawing is real work and A costs nothing. Not recommended.

A **Clear** removes the boards' records with the blocks (they are not `_` keys), and its Undo puts them back. After a Clear with no Undo, the space has no records, and reads as one empty board, "Board 1", as a new space does. A Clear is for the whole space; there is no "clear this board only" in the core, and this plan does not add one.

### 2. How boards are listed and switched

Three shapes. The first two use only shared pieces and need no change in the core.

- **A. A switch of tabs in the toolbar, `host.ui.viewSwitch`, one choice for each board.** One entry; the host folds it into More on a narrow board, as it does the Tools switch. Cap: 12 choices, 30 characters each. A name longer than that is cut in the tab and whole in the menu. Costs: the most boards you can list is 12. The best for 2 to 6 boards, which is how people use several drawings. **Chosen.**
- **B. One "Boards" button that opens a menu (`host.menu.show`)** with a row for each board (a check on the current one), then New board, Rename, Delete, Deleted boards. One entry, no limit of 12 (how a long menu scrolls is checked in the build). Costs: one more click to change board, and the current board's name is not on the screen unless the title shows it.
- **C. A list view like Documents,** with a thumbnail for each board (a picture of the blocks, kept in the record). Costs: a page of its own, a thumbnail to draw and keep current (the Whiteboard's export can draw one, but it would run for every change), and one more step between the person and the drawing. Right for 20 or more boards; not for a few. Later, if people ask.

Where it sits with the caps:

- **Toolbar:** the switch is one entry, 11 → 12 of 16, leaving 4. It is the first entry, before the Tools switch **(chosen)**, because it changes what everything else acts on.
- **Title-bar menu:** one entry, "Boards…" (icon `chalkboard`), which opens `host.menu.show` with **New board…, Rename board…, Delete board…** and **Deleted boards…** (later: **Duplicate board…**). 6 → 7 of 10. Nothing is dropped from either place. Not four entries: four would fill the title-bar menu to 10 and leave no room for Duplicate.
- **Who sees what:** a person who may only look sees the switch when there is more than one board, and no Boards… entry. An editor sees the switch always (one tab, "Board 1", on a new space), so a first board teaches that there can be more.
- **The name on the screen:** the active tab is the name. When the switch has folded into More, the board's name should still show; that is checked in the build (the Tools switch does the same for its choice).

### 3. Create, rename, delete, restore

- **New board…:** `host.ui.prompt({ title: 'New board', label: 'Name', value: 'Board 2' ... })` (the next free number), checks the limit, writes the record, and switches to the new board. Needs `edit`.
- **Rename board…:** the same prompt with the current name. Needs `edit`.
- **Delete board…:** `host.ui.confirm` naming the board and its count of blocks ("It has 38 blocks. Everyone who uses this board will be sent to {first board}. You can bring it back for 7 days."). The last board cannot be deleted; `main` can, once another exists.
  - **A. Trash for 7 days, like Documents. (Chosen.)** Delete moves the record to `_board-trash:<id>` with the time and who; the blocks stay where they are, so a restore is one write and loses nothing. **Deleted boards…** lists them with Restore and Delete for good. After 7 days an editor's page that opens the list purges it: deletes the blocks in pages of 100 with a pause, so it stays under 240 a minute (a purge is paced and may take a few minutes for a big board; if the page closes, the next page continues). Stored bytes stay in use for those 7 days. Costs: the purge code, and a trash list to look after.
  - **B. Delete at once, with a typed name** (`host.ui.confirm({ typed })` **(code)**). The record goes first; the blocks are then deleted in paced batches by the person's page, and a closed page leaves blocks with no board (orphans that fill the 5 MB but nobody sees). A later page sweeps keys `block:<id>:` where no record exists. Costs: no way back, and an orphan sweep. Not recommended, though it is the simplest to explain.
- **Who:** `edit`, for create, rename, delete and restore, as for everything else on the board. A finer rule (only an owner or moderator deletes a board) needs a third permission in `module.json`, and an existing space would have to be set by its owner. Not recommended for the first build; one line in "Not decided".

### 4. What each part does when there are several boards

| Part | With several boards | Cost |
|---|---|---|
| Blocks, background | Per board, by the prefix (the settings key and the blocks' key). | Free. |
| History (undo, redo) | **One list for each board, kept in memory while the page is open. (Chosen.)** Switching back to A finds A's steps; a deleted board's list is dropped. Undo only acts on the board shown. The alternative, empty it on a switch as `reload()` does today, is one line shorter and loses a person's steps when they glance at another board. | A Map of histories, up to 100 steps each (about the same memory as one for each board opened). |
| Clipboard | Stays in page memory, so copy on board A and paste on board B works. This is useful (moving blocks between boards) and needs no rule; the paste writes new blocks under B's keys. To be confirmed in the build that a paste makes B's own ids. | Free. |
| Timer | **One for each board (the timer is a block). (Chosen.)** Module-wide would need a record outside the boards and a rule for which board the card sits over. Its hidden state is already keyed by the board id (`whiteboard-timer-hidden:<board>`); its position is the person's. | Free. |
| Present | One record for each board, `_present:<id>:state`; the header's Present to everyone and Rejoin act on the board shown. A person on another board is not pulled in; they see nothing until they open that board. A mark on the list for "presenting now" is later. | The record key stops being a constant. |
| Save as image, Print | The board shown. The file name takes the board's name. | Small. |
| Import (#554, held) | Will put what it reads into the board shown, or make a new board from it. Not decided here. | None now. |
| Find, overview | The blocks of the board shown (confirm in the build). | Free. |
| Grid, snap, pointers switch, overview switch | The person's, in this browser, the same for every board (as now). | Free. |
| Live pointers | **A topic for each board, `pointer.<id>` (the topic may use `a-z`, `0-9`, dot, underscore and dash, up to 40 characters; the id is at most 16) (code, `host.live` topic rule in `public/sdk/host.js`). (Chosen.)** A switch unsubscribes from one topic, subscribes to the next and clears the drawn pointers. The other way, one topic with the board in the message and the receiver ignoring other boards, costs nothing to build but sends every move to people who cannot use it, inside the 20 a second limit. | A change in `lib-p` and in the page's subscribe code. |
| Who is on which board | The switch's tabs can show a count of people on each board (`count` on a choice **(code, `cleanToolbarItems`)**), from a small `presence` topic each page sends its board on (when it joins, when it switches, every 10 seconds). Live messages are not stored and may be lost, so a count is a hint and corrects itself. **Not in the first build** (the first build is correct without it); the pointers' topic per board already keeps people apart. | Later. |

### 5. How a board is found from outside

- **Inside the page:** the switch and the menu. The last board a person used is remembered in this browser, under the space (`whiteboard-board:<space>`).
- **A link from elsewhere (an object link, the Assistant, a chat chip):** the Whiteboard registers no objects today **(code)**. A board could be a kind in `refs.produces` with `open`, so Chat and the Assistant could point at it. This is not needed to have several boards and is **not in this plan**; it follows the plan for linked objects and Send to Assistant (#543, held) when those are decided. Leaving it for later costs nothing, because the record already has a stable id.
- **Send to Assistant (#543, held):** would send the board shown. Nothing to build for it here.

### 6. Duplicate board

A board is not copied by the server; the page copies it. There is no copy call and no batch **(code, `host.storage`)**: duplicate is a list of the source's keys, then one `set` for each block under the new board's prefix (and its settings).

- Blocks keep their ids across boards, because the board is in the key, not the id. A connector's references to its ends (`refs`) stay valid without a remap **(reasoning from `lib-a-core.js`; to be checked in the build)**. Pictures share the upload that is already there.
- Cost: one write for each block, 240 a minute for the person. A board with 400 blocks takes about two minutes, with 429 waits (sent again by the sync). The unsaved intents are kept in the browser (0.1.51), so a closed page loses nothing it had accepted, but that store is cut at 2,000,000 characters, oldest intents out first, so a very large copy could lose its start. A copy also doubles the board's bytes against the 5 MB.
- To be safe: the new board's record is written **last** (or marked `copying`) so no one switches to a half-copy; a progress note ("Copying 120 of 400") is shown; a copy larger than a set number of blocks (lean: 300) is refused with a plain word until the bursts are measured.
- **Lean: not in the first build.** The first build does the model, the switch, create, rename, delete and restore. Duplicate is a step of its own after it, once the first has been used.

### 7. Limits

- **Boards in a space: 10 (lean).** The switch holds 12 choices at most, so any number over 12 means shape C above. The storage is shared by every space (5 MB in all), and a board with no cap is a way to fill it; at 10 the list stays readable. The limit is the page's rule and the server does not check it, so two people creating at once can make 11; the page counts again when the record is heard, and the extra board is allowed to stand (no one's work is deleted for it).
- **Blocks on a board:** no new limit; the 60 KB for a key and the 5 MB for the module are the limits that exist **(code)**.
- **Writes:** unchanged, 240 a minute. Creating and renaming are one write each; deleting to the trash is two; a purge and a duplicate are the bursts (above).

## The contract (on the leans)

**New file `whiteboard-lib-s-boards.js`** (no page, no host, so it is checked on its own):

- `WB_BOARDS = { main: 'main', max: 10, nameMax: 40, idRe: /^[a-z0-9]{1,16}$/, prefix: 'board:', trash: '_board-trash:', trashDays: 7 }`.
- `wbCleanBoardRecord(v)`: the record or null; `name` cleaned (control characters out, cut), `order` finite, unknown fields dropped.
- `wbBoardList(records, trash)`: the boards in order; with no record for `main`, a first entry `{ id: 'main', name: 'Board 1', order: 0, implicit: true }` unless `main` is in the trash.
- `wbNewBoardId(taken)`: a random id not in `taken` and not `main`.
- `wbBoardKeys(id)`: `{ blocks: 'block:<id>:', settings: '_board:<id>:', present: '_present:<id>:state', live: 'pointer.<id>', pending: ... }`, so no other file builds a key by hand.
- `wbLanding(list, last)`: the id to open: `last` (from this browser) if it is in the list, else the first.

**Changes in the existing files:**

- `lib-a-core.js`: `WB_BOARD` and `WB_BOARD_PREFIX` stop being constants; they become functions of an id (`WB_BOARD_PREFIX` → `wbBoardPrefix(id)`). `main` stays as the reserved first id.
- `lib-q-present.js`: `WB_PRESENT.key` becomes `wbPresentKey(id)`.
- `lib-p-pointers.js`: the topic is `pointer.<id>`.
- `whiteboard.js`: the board id is a variable; `switchBoard(id)` is `reload()`'s work done for another id: flush the old syncs (`sync.flush()`, which keeps the unsaved intents), take their handlers off, clear the page's board, renderer, drafts, held and waiting sets, make the two new syncs, `load()`, `replay()`, set the history for that id, move the live subscription, load the present record, and set the switch. A stale answer from the old board's read must be dropped (a ticket that grows on each switch). `host.on('change')` and `'changes'` go to the current syncs only. `host.on('reconnected')` resyncs the board shown **(code, line 3926)**. The switch's `onChange`, the Boards… menu and the prompts and confirm are all shared pieces.
- A change that arrives for a board's key that is not the one shown is ignored by prefix **(code, `handle` returns when the key does not start with `PREFIX`)**; the list sync hears `board:` and `_board-trash:`.
- A board deleted by someone else while a person is on it: the page hears the record go (or the trash record come), says "This board was deleted by <name>.", opens the first board, and drops its history and its kept writes (below).

**Kept writes (0.1.51) and a deleted board:** the browser entry is `wb-pending:<space>:block:<id>:`. Three rules, all in the page:
1. A switch calls `flush()` on the old sync first (it sends what is waiting) and the entry stays until the server accepts the intents, as now.
2. When a board is deleted (here or heard), the page removes that board's `wb-pending` entries in this browser.
3. When the list loads, the page removes entries for this space whose board id is neither in the list nor in the trash. `replay()` only runs for the board being opened, so an entry for a deleted board is never sent; rule 3 clears what is left in the 10 minutes it would have lived. A person who was offline with writes for a board that has since been deleted loses those writes; the confirm says that the board goes for everyone.

**What a person sees:**
- A new space opens on one board, "Board 1", as today. A space that has the old single board opens on it, under "Board 1", with its blocks as they were.
- The switch shows the boards' names. Choosing one shows that board at its own view (pan and zoom are the page's and start fitted; remembering the view per board is later).
- Words: New board, Rename board, Delete board, Deleted boards, Restore, Delete for good. "Space" in any sentence a person reads comes from `word('space')` **(CLAUDE.md, Names)**.

**Requirements of the storage job (each with its test):**
- R1. A switch calls `flush()` on the old sync before anything else. Test: a write waiting on the 600 ms timer when the board is switched is sent under the old board's key and never under the new one.
- R2. A deleted board's `wb-pending` entries are removed from this browser, on deleting it here or hearing it deleted. Test: after the delete, no entry for that prefix remains and nothing is sent for it.
- R3. When the list loads, entries for this space whose board is neither in the list nor in the trash are removed. Test: a planted entry for an unknown board is gone after the load.
- R4. `replay()` runs only for the board being opened. Test: with entries for A and B, opening B sends B's only.
- R5. Pointers use the topic `pointer.<id>`, and a switch unsubscribes, subscribes and clears the drawn pointers. Test with two pages on two boards: a pointer on board A is never drawn on board B (in `check-whiteboard-live-pointers.mjs`, and again in step 4).

**The core:** no change expected. `host.ui.viewSwitch`, `host.menu.show`, `host.header.set`, `host.ui.prompt`, `host.ui.confirm` and `host.live` topics exist. `module.json` keeps its two permissions; its `description` and version change. If the build needs a change in `public/` or `server/` it is stopped and reported, not made.

## Left to build, in order

All steps are experience-design (the module page is in `modules/whiteboard/`); none touches `server/` or the core. The tier for each is sonnet. Sizes: S about an hour of work, M a few hours, L most of a day.

1. **Storage and sync for each board, with tests (L, sonnet).** The kept-writes rules and the pointer topic below are requirements of this job, not extras. `lib-s-boards.js`; the constants become functions of an id; `switchBoard`; the list sync; the kept-writes rules. New check `check-whiteboard-boards.mjs`, and `check-whiteboard-sync-persist.mjs` extended, so that: a write for board A never lands under board B's keys; a change heard for board A is not drawn while B is shown; after a reload on B only B's blocks are shown; a stale read from A's load is dropped after a switch; the persisted entry is keyed by board; an entry for a deleted board is not replayed and is removed; two boards with the same block id keep both. No switcher yet: a way to open a second board for the tests only.
2. **The switcher and the menu (M, sonnet).** The Boards switch, the Boards… menu, New, Rename, Delete (to the trash), Deleted boards, Restore, the purge in pages. Toolbar and header counts checked (`check-whiteboard-toolbar.mjs`). Last board remembered; landing.
3. **Per-board live pointers, present and export name (S, sonnet).** The topic per board, present per board, the file name.
4. **Live checks with two pages on two boards (S, sonnet, in a browser here).** Two pages, one on each board: draw, move, delete, undo, pointers, present, a reload mid-write, a board deleted under another page. No cross-talk.
5. **A feedback pass (S, sonnet).** One short regression pass; must-fixes only.
6. **Independent QA read (M, quality-assurance).** Before the last merge, because this is stored data. Reads the key building in every file, the delete and purge, and the kept-writes rules.
7. **Duplicate board (M, sonnet), later.** The copy with progress and the 300-block cap; its own check with a fake 429.
8. **Documentation (content-manager).** Architecture page "Storage and sync", the user guide, the TODO line, the module version bump (minor: 0.2.0, Thomas to say).

## Verify

- **Checked by a tool:** the pure functions in `lib-s-boards.js`; the sync with a fake host holding two boards (no cross-board write, a switch mid-write, a 429 during a switch, the persisted entry, the replay of a deleted board); the toolbar and header counts; `npm run check`; `npm run check:docs`.
- **In a browser here (step 4):** two pages on two boards against the local server; the switch, create, rename, delete and restore; a reload on each board.
- **Not verified here:** Safari, a phone or iPad (the switch folding on a narrow board, touch), a real call. Whether live pointers run without a LiveKit server here has to be checked when step 3 is built; if they do not, the pointers' topic is **read as code only**. Every report says so.

## Risks

- **Data loss: blocks under another board's key.** A page that switches while a write is on its way, or a late read, could put or draw A's block on B. The key is made from the sync's own prefix, so the write goes where it was made; the risk is in the page's state (`board`, `known`, `held`, `drafts`) after a switch. The tests in step 1 are for this, and QA reads it.
- **Delete of a board with blocks.** The trash keeps the blocks 7 days. The purge is a burst of deletes: a purge that stops half way leaves a board with some blocks, hidden, and the next page finishes it. A purge must never run on a board that was restored meanwhile (it reads the trash record again before each page).
- **Stale kept writes replayed into a deleted board.** The 10-minute entries in `localStorage` (0.1.51) for board A could be sent after A is deleted, making blocks under a board with no record: orphans in the 5 MB. The three rules above, and a test.
- **The 240 a minute limit on a duplicate or a purge.** Paced, with progress; a duplicate is later and capped.
- **Live pointers cross-talk.** Today the topic has no board in it (see above). The topic per board and a test with two pages.
- **Two people create a board at once.** Both ids are different (random), so both stand; the limit may be passed by one.
- **The toolbar cap.** 12 of 16 and 7 of 10 with the leans; a later tool has 4 toolbar entries before it needs a new place. A switch of more than 12 boards is not possible; the limit of 10 keeps it.
- **Size.** Each board adds its blocks to the same 5 MB for the module, for every space. A space with many boards can fill it for the others. A full store is a 413 the page already shows **(code, `LIMITS.moduleBytes`)**.
- **Clear.** A Clear takes every board of the space (not one). The Clear's own confirm should say so; the wording is the core's and not changed here.
- **History per board** holds blocks in memory for each board opened; 100 steps each is small, but a picture-heavy session should be watched.

## Not decided

- A finer right for deleting a board (owner or moderator only), which needs a third permission.
- Remembering pan and zoom for each board, and a board's thumbnail (shape C).
- "Presenting now" and "3 people here" marks on the tabs.
- Object links to a board, and Send to Assistant (#543).
- Import (#554) into a new board or the board shown.
- Moving blocks between boards by a menu ("Move to board…"), beyond copy and paste.
- Reordering the boards (a drag in the list). Until then, the order is the order made.
- The module's version for this change.

## Questions for Thomas

**Answered by default, 2026-11-12:** Thomas was away, and the project manager took the recommended option (A) of each, recorded in Decisions. Thomas can revisit. The recommendation is the first option.

**1. How are boards listed and switched?**
- A. Tabs in the toolbar (`host.ui.viewSwitch`), one for each board, up to 12. *Recommended.*
- B. One Boards button that opens a menu of boards.
- C. A list view with thumbnails, like Documents (a page of its own, more work).

Default if Thomas is asleep: A, tabs in the toolbar.

**2. Where does the Boards control go, given the toolbar's 16 entries (11 used) and the title bar's 10 (6 used)?**
- A. The tabs are one new toolbar entry, first in the row (12 of 16); New, Rename, Delete and Deleted boards are one "Boards…" entry in the title-bar menu (7 of 10). Nothing is dropped. *Recommended.*
- B. Everything in the title-bar menu (4 entries, 10 of 10), and switching by a menu.
- C. The tabs and a "+" button in the toolbar (13 of 16), the rest in the title-bar menu.

Default if Thomas is asleep: A.

**3. What happens to today's single board?**
- A. It becomes the first board with the same id, `main`, and the same keys; it reads as "Board 1" until renamed. Nothing is copied or moved. *Recommended.*
- B. It is copied to a new id and the old keys are removed (a migration in all but name).
- C. It is dropped (a reset).

Default if Thomas is asleep: A.

**4. How does delete work?**
- A. Confirm (with the count of blocks), then the trash for 7 days, like Documents; anyone who may edit can delete and restore; the last board cannot be deleted. *Recommended.*
- B. Confirm with the name typed, deleted at once, no way back.
- C. As A, but only an owner or moderator may delete (needs a new permission).

Default if Thomas is asleep: A.

**5. How many boards may a space have?**
- A. 10. *Recommended.* The switch holds 12 at most, and the module's 5 MB is shared by every space.
- B. 12 (the most the tabs can hold).
- C. 20 or more (needs the list view of question 1, C).

Default if Thomas is asleep: A, 10.

**6. Is Duplicate board in the first build?**
- A. No, a step of its own afterwards (it is a burst of one write for each block against the 240 a minute). *Recommended.*
- B. Yes, for boards up to 100 blocks only.
- C. Yes, for any size, with progress and 429 waits.

Default if Thomas is asleep: A, later.

**7. Is the timer for each board or for the whole module?**
- A. For each board; it is a block, so it follows the board for free. *Recommended.*
- B. For the whole module, the same clock over every board (a record of its own and a rule for the card's place).

Default if Thomas is asleep: A.

**8. Which board does a person land on when they open the Whiteboard?**
- A. The board they used last in this browser, else the first in the list. *Recommended.*
- B. Always the first board.
- C. The board someone is presenting on, else A.

Default if Thomas is asleep: A.
