# Documents Co-editing Plan: several people typing in one document at once

**Audience:** Thomas, who decides; experience-design (the editor, presence, the document Lock switch); server-development (the live channel's limits, on a held branch); quality-assurance (two real browser pages, the independent safety read); the project manager (the queue); content-manager (the documents once it is built).

**Status:** Decisions recorded, 2026-11-12 (Thomas chose in the option box); the plan is ready to build, starting from the spike. Nothing is built. The request, from Thomas: co-editing is the biggest gap in Documents; today one person edits (the edit lock) and everyone else sees the saved text live; he wants several people typing in one document at once, with the rich editor (ProseMirror) and Yjs, as [plan-documents](plan-documents.md) named it. The decisions are in "Decisions"; the options and leans stay below as the record. Facts are marked **(code)** (read at `1649a84f`, Documents 0.11.11) or **(memory)** (what I recall of a library, to confirm in the spike). Builds on [plan-documents](plan-documents.md), [plan-documents-rich-editor](plan-documents-rich-editor.md), [plan-documents-paper-layout](plan-documents-paper-layout.md) and [plan-module-live](plan-module-live.md).

## What it is today

- **One editor at a time.** `_lock:<id>` is one record written by compare-and-set, refreshed every 10 seconds, stale after 35 seconds seen on the reader's own clock. Others see "<name> is editing this. You can read it as it changes." **(code, `documents-lib-c-lock.js`)**.
- **The text** is in `text:<id>:<chunk>` records (at most 6 chunks and 150,000 characters); `doc:<id>` holds the version (`rev`), page colour, layout and `size`. The commit is compare-and-set on `doc:<id>` and is the real safety; the lock is a courtesy **(code)**. Readers get changes through `host.on` and the `reconnected` resync **(code, `documents-lib-j-resync.js`)**.
- **The rich editor** is ProseMirror (16 packages in one 282,652-byte vendored file) with our Markdown mapping. It sits behind an adapter (`getText`, `setText`, `onChange`, `revision`, `run`). Untouched blocks are written back exactly as stored, from a lookup kept beside the document, and the written text is read back and compared before it is saved **(code, plan-documents-rich-editor decisions 12 and 22)**.
- **Paper pages** are decorations on the blocks, not part of the document **(code, `documents-lib-t-editor-pages.js`)**.
- **`host.live`** carries short messages between the people using one module in one space. Nothing is stored. A message's data is at most **256 bytes** as JSON, 20 messages a second for one person in one module (burst of 20), 40 across modules; the server adds `from` (key, name, guest), `at` and a `seq` that counts up per module and space. A manifest `live.publish` names the permission needed to send; a viewer without it is refused with 403. `host.live.on('people')` says who has joined **(code, `server/module-live.js`, [api-modules](../api/api-modules.md) "Live messages")**.
- **Storage limits:** a value about 60 KB, a module's data 5 MB, 240 saves a minute per module and person **(code, [api-modules](../api/api-modules.md))**.

The two facts that shape everything: a live message is **small (256 bytes) and can be lost**, and storage is **the only truth**.

## Decisions

Decided by Thomas, 2026-11-12. Where a section further down still says "Edit", "Done" or "lean", this section wins.

1. **DECIDED: Yjs (`y-prosemirror`) in each page, `host.live` as the relay, storage as the truth, the Markdown record the saved form (option A).** *Reason:* it is the only model that lets two people type in one paragraph.
2. **DECIDED: the edit lock goes, and so does the Edit button.** Thomas: "why would there be an Edit button at all? wouldn't the doc just be editable like in Word and Google Docs? I can see being able to lock a doc, but we shouldn't need an edit button." There is no Edit button and no Done button. A document is editable for anyone with the module's `edit` permission, and saving is continuous (autosave). The exclusive claim `_lock:<id>` ("X is editing") is removed. *Locking* a document stays, as a per-document read-only switch (see "The Lock switch"). *Reason:* an Edit button is a step nobody expects in a shared document.
3. **DECIDED: the Markdown box is off while anyone else is editing.** *Reason:* it cannot merge character edits into a Yjs document.
4. **DECIDED: anyone with the module's `edit` permission may co-edit, enforced by the server.** A guest co-edits only if the guest role has `edit`.
5. **DECIDED: at most 8 editors at once.** Past the cap a person reads along (see "The cap").
6. **DECIDED: an editors list plus coloured named cursors, as their own build step.** *Reason:* cursors can be cut without cutting editing.
7. **DECIDED: offline, the page stays editable and merges on return, with a note; changes are kept in memory only.**
8. **DECIDED: the Yjs state is a snapshot in storage beside the text, rewritten at each save, rebuilt from the text if lost.**

## Options: the sync model

**A. Yjs in the page, `host.live` as the relay, storage as the truth (chosen).** Each page holds a Yjs document bound to ProseMirror with `y-prosemirror`. Edits go out as small Yjs updates over `host.live` (topic `doc.<id>`). A Yjs snapshot is also kept in storage (see "The contract"), so a late joiner starts from it and a lost message is repaired from it. The Markdown record stays the saved form that everything else reads (reader, list, thumbnails, export, search).

- *Gains:* no new server code except one limit; merging is Yjs's job (it is built for this and updates apply in any order, twice, or late); offline editing merges on return; per-person undo comes with it.
- *Costs:* one more vendored bundle; the 256-byte message limit needs a change or chunking; the stored-form rules need a careful bridge (below); two stored forms (snapshot and Markdown) that must stay in step.

**B. A record per block with compare-and-set, no CRDT (S3 in plan-documents).** Each paragraph, heading or grid is its own record, ordered by a fractional index; a save writes only the block that changed.

- *Gains:* no library, no snapshot, storage is the only form.
- *Costs:* two people typing in one paragraph is the common case and B has no answer: one overwrites the other, or a block lock returns. Markdown does not split into blocks cleanly (a list, a fence, a grid span lines). Cursors and per-person undo are all new work. Not co-editing as Thomas described it.

**C. Operational transform (a server that orders changes).** Needs a server-side transform engine and a dedicated endpoint; the libraries for it are not a fit for ProseMirror's schema without much work. Rules out the module-only design. Not recommended.

**Sub-choice: the relay.** (i) `host.live` with a raised size limit for this module (suggested, not yet decided; the spike confirms), (ii) `host.live` as is with each update cut into 256-byte frames, (iii) a dedicated server endpoint. (iii) is more code on the server and a second security surface for what `host.live` already does with a publish permission and rates. (ii) needs no core change but a paste of 5 KB becomes about 40 frames at 20 a second, which is 2 seconds of a stalled document and a long run of messages that can each be lost. (i) is a small core change: the manifest's `live` object may carry `bytes` (and `perSecond`) for that module, each capped by a server maximum from an environment variable. That change goes on a held branch and is read before merge. Whatever the relay, an update bigger than the cap is never sent; the page writes its snapshot to storage and sends a short "pull" message (see the contract).

## The contract

### The sync model on option A

**Where the pieces live.**

- **The live document** is a `Y.Doc` with the document's text as a `Y.XmlFragment` that `y-prosemirror` binds to the editor. Page colour, layout, page size and page numbers (the paper-layout fields) are a `Y.Map` in the same document, so two people changing the page colour merge instead of one getting a 409.
- **The saved form** is unchanged: `text:<id>:<chunk>` and `doc:<id>`, written by the commit.
- **The snapshot** is `ydoc:<id>:<n>` (chunks of at most 40 KB of base64 each, so every value stays under the 60 KB limit) and one header `ydoc:<id>` with `{ textRev, chunks, bytes, hash }`. It is the full state with garbage collection on. It is derived data: if it is missing or its `textRev` is not the saved text's `rev`, a page starts a new session from the saved text (see "Starting a session").

**Who writes the saved text.** One writer at a time, chosen by a rule every page computes the same way, with no election messages: the editor with the lowest key among those who have joined and are synced. Every beat (the module's existing autosave beat) the writer, if the document changed since the last save:

1. Takes the page's Yjs state and the ProseMirror document it renders.
2. Writes it to Markdown with the stored-form rules (below), parses it back and compares with that document (the rich editor's read-back rule). If they differ, nothing is saved, the last saved text stays, and the editors see one plain note. The writer tries again at the next change.
3. Writes the text chunks and `doc:<id>` by the existing commit (compare-and-set on `rev`), then the snapshot chunks and header. The snapshot comes after the text and carries its `rev`, so a crash in between leaves a snapshot older than the text, which is detected, never trusted.
4. A 409 means another page wrote first. The writer re-reads, and if the saved text already equals what it would write, it is done; otherwise it goes round once more.

If the writer leaves, the next lowest key becomes the writer at the next beat; if two pages both believe they are the writer for a moment, the compare-and-set settles it and nothing is lost. The writer writes on each autosave beat after a change. **The last one leaving or closing the page commits** as well: the page does this on `pagehide` and when it becomes hidden (`visibilitychange`). This is best-effort, because a browser may close a page before the write finishes. The snapshot and the periodic autosave are the repair: the next session starts from the newest snapshot or saved text, and no one has to press anything.

**Merge before write.** A page writes only when its Yjs state includes the snapshot of the current saved `rev` (`baseRev`). A page that was offline or just reconnected first reads the snapshot and applies it (Yjs merges it as an update), and only then may it write. This is what stops a page with an old state from saving over newer text.

**Untouched blocks stay exact.** The rule from the rich editor plan holds on one condition: the lookup of stored spellings is a function of the last saved text, so every page can rebuild it from the text it read, and a block whose content is the same as a stored block is written with its stored spelling. Alice changing paragraph 3 and Bob paragraph 5 gives a saved text where only those two blocks are re-spelled. The writer's lookup is rebuilt from the text it saved last (or read last) each time it writes; it does not depend on any other page's lookup. The corpus tests of the rich editor are run again on a Yjs-backed document. **To confirm in the spike:** whether the lookup by content survives a block moved by one person while another edits it (the lean: a moved block with the same content keeps its spelling; a changed one is re-spelled).

**Starting a session.**

1. Read `ydoc:<id>` and `doc:<id>`. If the header's `textRev` equals the saved `rev`, apply the snapshot.
2. If there is no snapshot or it is behind, and no other editor has joined (`host.live` people), seed a new Yjs document from the saved text. To avoid two pages seeding at once and doubling the text, the seed is written with `host.storage` create-if-absent on `ydoc:<id>` (version 0), so only one seed wins; the loser reads it.
3. Join `host.live` for the module, then publish a `sync` message with the state vector. Peers answer with the difference. Anything missed is repaired by the next step.

**Repairing lost messages.** A page watches the `seq` of live messages; a gap means a message was lost (or the stream dropped), and the page asks for a sync. Every 15 seconds each editor also sends its state vector, a few dozen bytes. A page that sees it is far behind reads the snapshot from storage.

**What goes over the wire.** Topics: `doc.<id>` for updates (base64 of a Yjs update, with the sender's `rev`), `sync` (state vector or difference), `pull` (a snapshot is in storage, read it), `cur` (a cursor, see Presence). Everything else is refused by the receiver.

**Large changes.** A paste or a rewrite whose update is over the cap is not sent: the page writes the snapshot (a normal write, with the usual rates) and sends `pull`. Peers read the snapshot and apply it. Because applying a snapshot to Yjs is the same as applying an update, this needs no new code path beyond the repair path.

### What replaces the edit lock

There is no Edit button, no Done button and no exclusive lock.

- **One view for people who can edit.** The reading view and the editing view become one: the rich editor is the view. A person with the module's `edit` permission opens a document and can type at once. The safe reader view (today's reader) is for readers, for locked documents and for people without `edit`. The Edit button, Done, the "Saved" and "<name> is editing" text, Back behaviour and the lock heartbeat go.
- **`_lock:<id>` and `documents-lib-c-lock.js` go**, with "<name> is editing this" and the 409 lost-lock path. In their place is the editors list from `host.live` (see Presence), which also replaces the "X is editing" text: a small bar entry "N editing" with names.
- **Joining.** Opening a document as an editor joins the live session. Leaving or closing the page leaves it. The last one out commits (see "Who writes the saved text").
- **A reader sees the same live document.** A reader joins as a listener: it gets the updates and draws them in the safe reader view, never publishes (and cannot: the manifest `publish` is `edit`, so the server refuses with 403). If the channel is closed, the reader falls back to the saved text with the resync.
- **The Markdown box (source mode) while others edit: off while anyone else is editing (decided).** The mode switch shows the box as unavailable with one sentence ("Others are editing. The Markdown box is off until you are alone."). If the box stays for a single editor, the way to it is the Markdown / Rich text switch (decision 29 of [plan-documents-rich-editor](plan-documents-rich-editor.md)), and it is only available when you are the only editor. Its text enters the document as one replacement when you switch back, and your undo history for the session restarts. If someone joins while you are in the box, your text is applied and you are switched back to the rich editor with a note. Not chosen: (b) source edits applied as a block diff (a later step if people ask), (c) the box for one person at a time (keeps the lock code, gains nothing).
- **Who may co-edit.** The module's `edit` permission per role, enforced by the server; the manifest becomes `"live": { "publish": "edit", ... }`. A guest co-edits only if the owner gave the guest role `edit` and the guest holds a valid pass. The names shown come from the server's `from` field, which a page cannot forge.
- **The cap.** At most **8** people editing at once; 16 is the next step up. Order is by the sequence number of each person's `join` message, which all pages see the same way. A ninth person opens the document with the editor read-only and one note ("The document has 8 editors; you can type when one leaves."). When an editor leaves, the ninth person's editor becomes editable by itself, with no button. Why 8: at ten keystrokes a second each, 8 editors is about 80 messages a second for every page to apply; cursors add to that. The cap is a constant in the module, not a setting.

### The Lock switch

Locking a document is a per-document read-only switch. It replaces nothing in the live session; it only decides whether the document can be typed in.

- **Who may lock:** any editor (a person with `edit`). **Who may unlock:** the editor who locked it, and the owner or admin always.
- **Where it is:** a "Lock document" entry in the Page menu (the paper-layout menu), which turns to "Unlock document" on a locked document. This is a suggestion for the builder to confirm with Thomas in the step; if the Page menu does not fit, a shared menu entry is the other place. It is not a toolbar button, because of the 16-entry cap (see "The toolbar").
- **The field:** `locked` on the `doc:<id>` record, with who and when (for example `{ by, name, at }`), like `layout` and `pageSize`. It changes on the record's compare-and-set path, not through the Yjs document, so there is one answer. A 409 means someone changed it first; the page re-reads and shows the result.
- **The banner:** a locked document shows a banner saying who locked it and when ("Locked by <name>, <time>."), with an Unlock button for those who may.
- **What a locked document does to a session in progress:** when the lock is heard (the `doc:<id>` change through `host.on`, and a short `lock` live message to speed it), every editor's editor becomes read-only at once and shows the banner. Typing not yet saved is committed by the writer first if it can be; whatever is in the Yjs document at that moment is what the document keeps. The editors list stays. A locked document is the safe reader view for everyone, including the person who locked it, until it is unlocked. Unlocking returns the editor to everyone with `edit`.
- **The server** enforces nothing extra about the lock in this plan; the compare-and-set on `rev` and the `edit` permission are what protect the text. A page that ignores the lock can still write what an editor may write. The lock is a safeguard against slips, as the old lock was a courtesy.

### The toolbar

Removing Edit and Done frees the editing row's cap. The Documents edit row was 14 shared items plus Done, at the 16-entry cap, since the title-bar zoom items moved to `host.header`. With Done gone it has room for one more entry. The editing toolbar is now always shown to editors; there is no separate reading toolbar for them. Readers, locked documents and people without `edit` get the reader's toolbar as today.

### Presence

- **A list** of who is editing (name and colour), in the bar, from `host.live.on('people')` plus a `join`/`leave` mark carrying "editing". It replaces the old "<name> is editing" text. Colours are `host.live.tint(key)`, the same as the Whiteboard's pointers. First build.
- **Cursors and selections,** drawn as ProseMirror decorations (a caret widget with the name, and a highlight over a selection), coloured from theme tokens by tint class; no inline colours (`check-no-raw-colours`). We do not use `y-prosemirror`'s cursor plugin (it takes a colour string and builds its own DOM) and we do not vendor `y-protocols`: a cursor is our own small `cur` message with a Yjs relative position pair (so it follows edits), sent at most 8 times a second while it changes, and dropped after 20 seconds without news. Names come from the server's `from`, never from the message. Decided: cursors are in the same release as co-editing but their own build step, so they can be cut without cutting editing.

### Undo per person

`y-prosemirror` has its own undo (`yUndoPlugin` with Yjs's `UndoManager`), which tracks only this page's own changes, so Undo undoes your typing and not another person's. It replaces `prosemirror-history` in co-editing mode (two histories on one document fight). The bar's Undo and Redo, and the keys, call the Yjs commands through the adapter's `run`. A block that undo brings back to its old content is written with its stored spelling, because the lookup is by content. Undo does not cross a mode switch to the Markdown box (as today), and the history restarts after a box replacement. A locked document has no undo. The editor's typing-merge window is Yjs's default (about half a second); the spike checks it feels like today's.

### Offline and reconnect

- **While the live channel is lost** the page stays editable (decided). Edits go into the local Yjs document and wait; the bar shows "Offline: your changes are kept and join in when you are back." The page does not write the saved text (merge before write).
- **On `reconnected`** (the module's existing resync): read the snapshot and the saved `rev`, apply the snapshot, send a `sync`, then the page may write again. Yjs merges both sides' changes.
- **Limits.** The changes live in memory only; closing the page while offline loses them (a local store such as IndexedDB is a later step, not in this plan). A page offline for a long time still merges, but the result may surprise the others; the note says "Others kept working. Your changes joined in." The 150,000-character cap holds after the merge: if the merged text is over, the commit is refused and every editor sees "This document is over its length limit. Cut some text before it can be saved." until it is under.
- **Not chosen: read-only while offline.** Simpler and safer to explain; costs a person their typing on a train.

### Size of what is kept

The saved text is at most 150,000 characters. The Yjs state for typed text is usually 1 to 3 times the text (memory: runs of typed characters merge into one entry, formatting and attributes add some); a document with many small edits by many people is more. Garbage collection on and a rewrite of the snapshot at every save keep it from growing without bound. A 150,000-character document may therefore need about 5 to 12 snapshot chunks. The module's data limit is 5 MB, and the snapshot doubles what each document costs; the spike measures a real document and a heavily edited one, and the plan's step 1 reports the number before step 2 starts. The snapshot is bookkeeping: it is deleted with the document, left out of an environment export (the text is the export), and rebuilt from the text if lost. **To confirm in the build:** how `_`-prefixed keys are treated by Clear, export and the list, to pick the key prefix.

### The bundle

- **Libraries:** `yjs`, `y-prosemirror`, `lib0` (and `y-protocols` only if the spike shows a need). All are by the same author and are MIT as far as I recall **(memory)**; **to confirm in the spike** (written from memory, not yet checked) by reading each package's licence file, copying it to `vendor/LICENSE.<package>` and writing it in `THIRD-PARTY.md`. Only MIT, Apache-2.0, BSD, ISC and MPL-2.0 are allowed; any other licence stops the plan.
- **Size:** about 150 to 200 KB minified and about 50 KB gzipped for Yjs, `y-prosemirror` and the parts of `lib0` they use **(memory; measured in the spike)**. The existing bundle is 282,652 bytes, so this is about 60 percent more.
- **One file with the editor.** `y-prosemirror` imports `prosemirror-model`, `-state`, `-view` and `-transform`; a second bundle would carry its own copies, and the editor's checks (`instanceof`, plugin keys) would fail. So the recipe in `THIRD-PARTY.md` is extended and the file `documents-lib-0-prosemirror.js` is rebuilt once with esbuild including the Yjs packages, with the same pinned versions for the existing ones. The lean is one file; the alternative (a second file with the editor packages aliased to the first) is a spike question.
- **Checks:** `check-vendored-hashes` (new SHA-256 for the rebuilt file and rows for each new package), `check-third-party-licences`, `check-no-outside-urls` (any URL in the bundle's comments is removed as `marked`'s source-map line was), and the named innerHTML exemptions (none are expected: Yjs does not touch the page, and we do not use `y-prosemirror`'s cursor plugin).
- **Names.** The bundle is not scanned by `check-names`; our module code is. Only the names the module code imports matter, and the module imports `Doc`, `applyUpdate`, `encodeStateAsUpdate`, `encodeStateVector`, `UndoManager`, `ySyncPlugin`, `yUndoPlugin`, `undo`, `redo`, relative-position functions. None is a banned word. If the spike finds one, it is aliased at export, as `tableEditing` was.
- **No outside service.** Nothing is loaded from outside, and there is no hosted sync provider.

### Security

- **Who may send:** the server. The manifest `"live": { "publish": "edit" }` makes the server refuse a viewer (403). A guest needs a valid pass and the `edit` permission. The `from` of each received message is set by the server and is the only identity the page trusts.
- **What an update can do:** Yjs updates are binary and a hostile or broken one is the main risk. The page treats them as untrusted input:
  1. A message is accepted only on a known topic, from a person on the editors list, and only up to the size cap; the update is decoded inside a `try` and a failed decode drops the message.
  2. `y-prosemirror` turns the shared content into ProseMirror nodes by the editor's schema; the page checks the resulting document against the schema (`doc.check()`) after each remote change and, if it fails, throws the update away and rebuilds the page from the last good snapshot. An update can therefore change only schema-valid nodes (**to confirm in the spike**: what `y-prosemirror` does with an unknown node name, and that a deliberately malformed update is caught).
  3. Nothing reaches `innerHTML`. The safety rules of the rich editor (plan-documents-rich-editor, "Safety") hold unchanged: link and object-chip values are cleaned by the existing writer and reader, whatever came over the wire.
  4. **The 150,000-character cap** is enforced in three places: the local editor refuses typing that would pass it (remote changes are not refused, they are merged); the commit refuses text over it (the existing `dlChunk` limit); and a receiver drops an update that takes its document more than 10 percent over the cap and re-reads the snapshot.
  5. **Rates:** the server's per-person limit (20 a second, raised for this module by a manifest `perSecond`, capped by the server) is the real limit. Pages batch their updates in a 50 ms window so typing is about 10 messages a second, and cursors are throttled to 8 a second. A page told 429 waits for `Retry-After` and keeps its changes.
  6. A hostile editor can already write anything an editor may write (garbage text). What they must not do is damage other people's work beyond that: the writer's read-back, the snapshot's `textRev` and the 10 percent rule are the guards, and an editor's undo restores.
- **The independent safety read** (quality-assurance, a real browser) covers the new live topics and limits, the snapshot read and write, the update handling in point 2 above with deliberately bad input, and the editor's new paths. It is required before co-editing is on by default and before any beta client uses it. Plan-documents already said the live channel needs a security read first; the channel has been read for the Whiteboard, but not for a binary payload from a person who may type.

### Paper, grids, the list and the other nodes

- **The list and thumbnails.** The "<name> is editing" text there is replaced by the count of people editing now (from presence), or removed if the list cannot read presence cheaply; the builder says which. A locked document shows a small lock mark. Search and excerpts are unchanged: they read the saved text. Export is unchanged: it writes the saved Markdown (and the lock is not exported).
- **Tags** are on the `doc:<id>` record and merge as today; the Lock switch does not change them.

- **Page spacers and breaks** are local decorations and a `page_break` atom node. They are not in the Yjs document, so each page works out its own spacers. `y-prosemirror` redraws changed nodes when a remote change arrives (it keeps the nodes that did not change), so a remote edit makes a page run its measuring pass; the builder checks that this does not cause a flicker or a caret jump. The manual page break is an ordinary node and merges like a paragraph.
- **Grids** are ordinary nodes, but the structure is the risk: one person adds a row while another adds a column, one deletes a column while another types in it, two people fix the same broken grid. ProseMirror's grid code repairs shape (`fixTables`) with a transaction of its own; if two pages repair the same break, both repairs sync and cells double. The spike tries these three collisions. If the result is not clean, the lean is to allow cell text edits for everyone and structure edits (add or remove a row or column) always, but with the repair run only on the writer's page. If that is not clean either, a grid is edited by one person at a time (a small mark on the grid) in the first release.
- **Formulas, object chips and the source node** are atoms or leaf nodes; they merge as whole nodes, so two people changing the same formula get one of the two.

## Left to build, in order

All steps by the smaller model (Sonnet), one small PR each, a try build unless marked, each with a module version bump if it changes the module, rebased on `origin/main`. Steps 2 and 5 touch core and go on a held branch, read before merge. The spike is the first step.

1. **Spike (M, experience-design, sonnet).** Yjs and ProseMirror in the module's shadow root; two simulated peers over a fake channel with loss, delay and duplicates. Measures the bundle, the snapshot size for a real document and a heavily edited one, and the cost of a remote change on a page-layout pass. Proves: the Markdown round trip from a Yjs-backed document with the corpus tests; untouched blocks exact after two people edit different blocks; the three grid collisions; a malformed update; the licence files of Yjs, `y-prosemirror` and `lib0`. A short report goes to the project manager before step 2.
2. **The live limit, server half (S, server-development, sonnet, held branch).** The manifest's `live` object accepts `bytes` and `perSecond`, each capped by a new environment variable; `api-modules` text is a content-manager job later. Tests in `check-module-live`. Not needed if the spike chooses frames.
3. **The vendored bundle (M, experience-design, sonnet).** The rebuilt file, `THIRD-PARTY.md` rows, licences, the hash and the checks. No page change.
4. **Sync and the snapshot (L, experience-design, sonnet).** The Yjs document bound to the editor, the live topics, session start, the writer rule, merge before write, repair, the large-change path, the last-one-out commit on page close, the Markdown box off while others edit. Behind a setting in the module (off by default) so main keeps working. Verified with two pages.
5. **Presence (M, experience-design, sonnet).** The editors list, the cap and its read-only note, the cursors and selections.
6. **Lock replacement (M, experience-design, sonnet).** Remove Edit and Done and the exclusive lock (`documents-lib-c-lock.js`, the lock record and its words, the heartbeat); make the rich editor the one view for editors and the safe reader view for readers; add the per-document Lock switch (`locked` field, banner, Page menu entry); offline and reconnect; the note texts; undo through Yjs.
7. **The independent safety read (M, quality-assurance).** As above, with bad input in a real browser. Required before step 8.
8. **On by default (S, production build).** After Thomas has tried it by hand with two real people, and on Safari and the phone. Then content-manager updates the user guide and architecture.

## Verify

- **Verified live (two Playwright pages as two people against the local server):** both pages type in one paragraph and in different paragraphs and converge; a late joiner gets the state; a page that loses and regains the stream converges; closing the last page saves; a locked document turns every editor read-only at once; an unlocked one returns; the saved Markdown has untouched blocks exactly as stored; the ninth editor is read-only; a viewer is refused by the server; the Markdown box is off while another is editing; per-person undo; the cap and over-length message.
- **Checked by a tool:** the pure rules (the writer choice, the cap order, merge before write, the update filters) in module tests like the lock's; the vendored hashes, licences and outside-URL checks; the corpus round trip on a Yjs-backed document.
- **Not verified here:** a real LiveKit call is not involved (the channel is the app's own server, so Playwright covers it), but **real devices, real networks, Safari, iPad and phone input methods under remote changes are not verified with real devices**; Thomas tests those by hand with two real people. Behaviour under load (many editors, long sessions, a slow network) is not measured.

## Risks

- **A remote change redraws the editor** (memory: `y-prosemirror` replaces changed nodes). Input methods and a caret mid-word on a phone are the worst case; the spike and step 4 test it, and a fix may need the larger model.
- **The snapshot and the text drift** if a writer dies between the two writes. Handled by `textRev`; the cost is a session that starts from the text.
- **5 MB per module** may bind sooner than today, since a document costs about 2 to 3 times its text.
- **Two stored forms to keep honest.** Mitigation: the Markdown is the one everything reads; the snapshot is only for sessions and is rebuilt when stale.
- **Grids** (above) and a **paste of a very large block** (handled by the pull path, slow on a poor connection).
- **A held-branch core change** (the live limit, a `bytes` / `perSecond` manifest object) delays step 4 if not read promptly.
- **Saving on page close is best-effort.** A browser may close a page before the write ends; the snapshot and the periodic autosave are the repair.

## Not decided

- The core change: `host.live` `bytes` / `perSecond` in the manifest, on a held branch; the spike may choose frames instead.
- The licences of Yjs, `y-prosemirror` and `lib0`: written from memory, to confirm in the spike. Any licence not on the allowed list stops the plan.
- Where the Lock entry sits (the Page menu is suggested), and whether the list shows a count of editors or nothing.
- Whether source-mode edits ever become diffs (option b).
- A local store for offline edits.
- Comments, suggestions and the history of who changed what (Yjs could carry them; none is in this plan).
- Cursors for readers who are not editing (no: they are not shown).
- Making the cap a setting.

## Questions for Thomas (answered 2026-11-12; see Decisions)

The options stay as the record. Chosen: 1 A, 2 (neither A nor B: no Edit button, no exclusive lock, a per-document Lock switch), 3 (a), 4 A, 5 B (8), 6 A, 7 A, 8 A.

1. **The sync model.** (A) Yjs in the page, `host.live` as the relay, storage as the truth; (B) a record per block with no Yjs (two people in one paragraph overwrite each other); (C) a server that orders changes (much more server work). Lean: A, because it is the only one that lets two people type in one paragraph.
2. **What replaces the edit lock.** (A) Edit joins a shared session, Done leaves, the last one out saves, the lock goes; (B) keep the lock as the default and let an owner turn co-editing on for a document. Lean: A, with the lock removed; B keeps two paths in the code and the product is not released.
3. **The Markdown box while others edit.** (a) Off while anyone else is editing; (b) edits applied as a block diff; (c) one person at a time in the box. Lean: (a). The box returns when you are alone.
4. **Who may co-edit.** (A) Anyone who has the module's `edit` permission, as today, enforced by the server; (B) a new separate "co-edit" permission; (C) members only, never guests. Lean: A. Guests co-edit only if you gave the guest role `edit`.
5. **The most people editing at once.** (A) 4; (B) 8; (C) 16. Past the cap a person reads along and Edit works when someone leaves. Lean: 8. Raise it only if you see a real need.
6. **Cursors and selections in the first build.** (A) The editors list and coloured cursors with names, as their own step; (B) the list only at first, cursors later; (C) both in one step. Lean: A, so cursors can be cut without cutting editing.
7. **Offline.** (A) Stay editable and merge on return, with a note, changes kept in memory only; (B) read-only when the live channel is lost; (C) editable and kept on the device for later (a local store, more work). Lean: A.
8. **Where the Yjs state is kept.** (A) A snapshot in storage beside the text, rewritten at each save, rebuilt from the text if lost; (B) no snapshot; the first editor sends the state to late joiners over the live channel (nothing in storage, but a person joining an empty session starts from the text and a lost message cannot be repaired); (C) a snapshot and a log of updates (finer, needs compaction, more writes). Lean: A. It uses about 2 to 3 times the text's storage; the spike gives the real figure.
