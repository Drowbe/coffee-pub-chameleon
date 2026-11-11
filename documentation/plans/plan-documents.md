# Documents Plan: shared written notes for a space

**Audience:** Thomas, who decides; experience-design (the module's pages and scripts); server-development (the manifest check, the checks, any host change); quality-assurance (an independent read of the safety rules before anything reaches a beta client); content-manager (the documents once it is built).

**Status:** Draft, 2026-11-11. Nothing is built and nothing was run for this plan. The request, as Thomas gave it when asked directly: a bundled **Documents** module for shared notes in a space (session notes, handouts, lesson plans), first used by his two beta clients, for tutoring and for collaborating on a project. Facts marked **(code)** were read in the code, **(docs)** in the documentation; **(memory)** is what the author recalls about a library or a browser and must be checked in the spike. The decisions below are Thomas's; the contract is a draft built on them, and anything in it that he has not decided is also listed under "Open questions".

## What it is today

- There is no module for written text. Research keeps notes, but they are research (tags, a place, a date, the AI) and one note is one value, at most about 60 KB **(docs)**. The Whiteboard has text and notes on a board, not documents. Chat's messages are not edited together.
- The host has a small, safe Markdown reader, `host.util.markdown`, for chat and the AI's replies: headings, bold, italic, code, lists, links, paragraphs **(code, `public/sdk/host.js`)**. It has no tables, checklists, quotes or maths, and it escapes all HTML and sets it as `innerHTML`. It is shared with chat, so it should not grow for this module.
- Storage is a key-value store per module and scope. A value is at most 60 * 1024 characters of its serialized JSON (the server counts `JSON.stringify(value).length`, so it is characters, not bytes). A module's 5 MB is the sum of every file under its `data/` folder, so it covers **every space of the environment together**, not one space. A write with `{ version }` is turned away with 409 and `err.current` if someone wrote first; version 0 matches a key that does not exist yet. Each scope's file is rewritten whole on a change **(code, `server/module-data.js`: `LIMITS`, `put`, `usage`)**. Saves are limited to 240 a minute for a person and module **(docs, `api-modules.md`, "Limits")**.
- The Whiteboard's shared "Present to everyone" is the model for an edit lock: one bookkeeping record (`_present:<board>:state`), written with compare-and-set (the version read), refreshed every 10 seconds, stale after 35 seconds of no change seen on the reader's own clock, and a first read of an old record given 12 seconds to change. The pure rules are in `modules/whiteboard/src/whiteboard-lib-q-present.js` and are tested on their own **(code)**.
- `host.live` (short, lossy messages between the people in a module) is in the SDK and `server/modules.js` (`cleanLive`) **(code)**, but [plan-module-live](plan-module-live.md) and the TODO still say nothing is built and its security steps are held for a read. Treat it as not available until that plan says it is.
- Bundled modules run **in the page**, in a shadow root, sharing its window; they can act as the signed-in person **(docs, `api-module-sdk.md`, "Running in the page")**. This is what makes safety the first concern below.
- The Vault keeps files, including Markdown up to 1 MB **(docs)**. A module that is not a library has no call to add a file to it: `host.library.*` is the Vault's own, and `host.files` only opens, resolves, picks and links. There is also no `host.files.save` yet (#469); the Whiteboard hands a file over with a download link made in the page, which works only for a module that runs in the page **(code, `whiteboard.js`, `deliver`)**.
- The standard Print action (`host.standard.set({ print })`) prints the module's content area alone, in the light colours **(docs)**. Whether a long, scrolling document prints on several pages through it is not known.

## Decisions

Thomas, 2026-11-11, asked directly.

1. **What it is for.** Shared notes for a space: session notes, handouts, lesson plans. One list of documents per space. Editors write; everyone in the space reads. *Reason:* the first real use is two beta clients, tutoring and project collaboration, and both are "write it down together" work.
2. **Its own module**, not part of the Whiteboard, and built so another module could reuse its list and editor shape. *Reason:* a document is read and edited top to bottom, a board is spatial.
3. **One editor at a time to start.** Everyone else reads it live. No co-editing yet. Live co-editing (ProseMirror and Yjs, a vendored bundle with a `THIRD-PARTY.md` as Maps has, the `host.live` publish permission) is a deliberate **second step**, described here and not built now. *Reason:* the first use needs to work, and co-editing needs the live channel to exist and a security read of it first.
4. **Formatting first:** headings, bold and italic, lists, checklists, links, quotes and code, then tables and maths.
5. **Links to other objects and to other documents now. Pictures in a later step.**
6. **Access:** editors edit; everyone views, including a person who may only view and a guest where the module's permission rules allow it. The same as the Whiteboard.
7. **Export:** a Markdown file, and Print / Save as PDF.

## Options and tradeoffs

Each choice lists what it costs and rules out. The lean is a suggestion for Thomas to accept or change.

### Storage

**S1. One record per document.** The whole text in one value. Simple, one compare-and-set, one write. A document is capped near 60,000 characters of JSON (about 9,000 words of plain prose, less with quotes, line breaks and non-Latin text, since JSON escapes them). Also, `storage.list('doc:')` returns every value in full, so opening the list would read every document's text.

**S2. A small record plus text chunks.** `doc:<id>` holds the title and the list of chunk ids; `text:<id>:<chunk>` holds a piece of the text. The list reads only small records. A long document is several chunks, each under the limit. Costs: a save of several chunks is not one write, so the small record must be the commit point (below), and a reader must cope with a chunk that is not there yet. Worst case a save writes every chunk plus one. Rules out nothing that S1 allows.

**S3. A record per block** (a paragraph, a heading, a table), ordered with a fractional index as the Whiteboard orders its blocks. This is the best base for co-editing, and a save writes only the block that changed. Costs: Markdown does not split cleanly into blocks (a list, a fenced block and a table span lines), a plain text box does not map onto blocks, and export has to join them. It is a rewrite of the storage anyway when Yjs arrives. Rules out nothing, but buys nothing before co-editing.

*Lean:* **S2.** S1's list problem alone settles it, and S2 costs little more when most documents are one chunk. S3 waits for co-editing, where the stored form changes in any case. The product is not released, so changing the keys then needs no migration.

**Whatever is chosen, the 5 MB is the real ceiling:** 5 MB across all spaces and all documents of the environment, about 250 documents of 20 KB. A tutor with a space for each pupil could reach it. See the open questions.

### Editor technology

**E1. A text box that holds Markdown, with a formatting bar and a rendered preview.** The text is the stored form. The bar is the Whiteboard's `lib-j-markup` idea (each button takes `{ value, start, end }` and returns it changed), extended with Heading, Quote, Checklist, Insert table (a skeleton to fill in) and Maths. Smallest by far, nothing to vendor for editing, works on a phone's own keyboard. Costs: a person sees Markdown marks while writing, and a table is typed as pipes. This is the weak point for people who are not technical.

**E2. A vendored source editor (CodeMirror 6, MIT** **(memory)**). Better selection, folding and highlighting in the source. Needs a bundle built once outside the repository and committed (as MapLibre is for Maps). Still Markdown on the screen, and it is not the editor Thomas named for the later step, so it would be thrown away at co-editing.

**E3. A rich-text editor now (ProseMirror, MIT** **(memory)** **, with Markdown reading and writing, tables, task lists and a maths node).** A person sees the result as they type, and this is the editor the later step needs anyway. Costs: the most work before first use (a schema for every block, an object-link node, a table editor, phone behaviour), a larger vendored bundle, and the Markdown conversion must round-trip.

*Lean:* **E1 for the first release, E3 together with co-editing.** The stored form is Markdown in both, so export stays trivial and the editor can change without touching the data. Changing the editor and the sync in one step is one change, not two. The risk is that tutors and clients find E1 too raw; the spike asks for a real tutor's reaction before this is final.

### Reading Markdown and keeping it safe

Because the module runs in the page with the viewer's session, a document that can run script is a stored attack on every reader, and every editor is trusted by nobody but the person who gave them the role. The rules do not depend on the editor.

**R1. Parse to tokens and build the page with the DOM, never with HTML text.** A parser (`marked`, MIT **(memory)**; `markdown-it` is the other) is used only to make tokens. The module walks the tokens and makes elements with `createElement` and `textContent`. A raw HTML token is shown as text. A link's address is checked against an allow-list (`http:`, `https:`, `mailto:` and the `object:` form below); anything else is shown as plain text. Nothing a person wrote is ever set as `innerHTML`. The one exception is maths, whose output comes from the maths library, not from the text.

**R2. Parse to HTML with the library, then clean it with DOMPurify** (Apache-2.0 or MPL-2.0 **(memory)**). Less code of our own, but a second vendored library and the parser's HTML is trusted up to the cleaner.

*Lean:* **R1.** It matches how the Whiteboard treats words (one HTML sink, `wbShowWords`), needs no cleaner, and a check can enforce it: fail on `innerHTML`, `insertAdjacentHTML` and `outerHTML` in the module's own source, except one named line for maths.

### Maths

**M1. KaTeX** (MIT **(memory)**). Fast, no network, the look people know, with the TeX kept as the stored form. It draws with HTML, CSS and its own fonts. A font declared inside a shadow root is not loaded by the browser **(memory)**, and bundled modules run in a shadow root, so the fonts must be registered on the page (the `FontFace` API from data URLs, or the host loading them). Run with `trust: false`, `throwOnError: false` and size and macro-expansion limits.

**M2. Temml** (MIT **(memory)**). Writes MathML and needs no fonts or CSS, so no font problem and a smaller file. Browsers draw MathML themselves, so the look varies and a PDF may differ by browser. Check against the supported browsers before relying on it.

**M3. MathJax** (Apache-2.0 **(memory)**). The most complete and best for screen readers, but the largest, and it loads parts as it needs them, which a single-file module cannot do.

*Lean:* **M1**, with M2 as the fallback if the font problem proves hard. The spike decides.

### The edit lock

Modelled on the Whiteboard's, with one difference that matters: **the lock is a courtesy, and the compare-and-set on the document's small record is the safety.** The server cannot enforce "one editor": any person with `edit` can write any key. If a lock goes stale while its holder's tab sleeps (browsers slow a hidden tab's timers), a second person may take it, and the first, coming back, must be stopped from overwriting. The save does that, because it carries the version of the small record it read.

### Links

**L1. A strip under the document** of linked objects (the pattern other modules use: `host.objects.pick`, `setLinks`, chips). Simple, backlinks free. Not in the text.

**L2. Links in the text**, a Markdown link with an `object:` address that the reader draws as a chip, plus the same `setLinks` so the link shows from both ends. Needed for "see the lesson plan" in a sentence.

*Lean:* **L2** (it includes L1's effect). Links to other documents are the same form with Documents' own kind.

### The Vault gap

Two things people will ask for have no door: a document filed in the Vault, and a Vault Markdown file opened as a document. Neither can be built from a module today. **(a)** Leave it; Documents keeps its own text and exports a file. **(b)** Later, add a host call that files an export into the Vault (a server and SDK change, with the Vault's visibility rules). **(c)** Keep document text as Vault files; this needs a write call, makes visibility, quota and Clear different, and reverses the storage choice.

*Lean:* **(a) now, (b) when asked.** Related: the missing `host.files.save` (#469) means Export works only because bundled modules run in the page.

## The contract

Names: the module is `documents`, shown as "Documents"; the kind is `document`; the thing is a document, never an item or a card.

### Manifest (`modules/documents/module.json`)

- `id` `documents`, `name` `Documents`, `version` `0.1.0`, `scope` `["space"]`. Icon and colour: experience-design picks from the design system, one colour not used by another bundled module.
- `surfaces.canvas`: `entry` `canvas.html`, 560 by 640, `mode` `["dock", "float"]`.
- `permissions`: `view` ("See the documents") default member, guest and moderator true; `edit` ("Write and change documents") default member and moderator true, guest false. `access`: `{ "read": "view", "write": "edit" }`. The same as the Whiteboard.
- `refs.produces`: `{ kind: "document", name: "Document", open: true, backlinks: true, key: "doc:{id}", summary: { title: "title", subtitle: "editedByName", when: "editedAt", text: "excerpt" } }`. `refs.consumes`: `["*"]`, approved by the owner as for any module.
- No `uploads` and no `live` in the first release. Both are added by the later steps and each is an upgrade the owner sees.
- The module's version is added to `tools/module-versions.json`, and it is built with `node tools/build-module.mjs modules/documents`.

### Stored keys (scope `space`)

| Key | Value | Notes |
|---|---|---|
| `doc:<id>` | `{ id, type: 'doc', title, rev, chunks, size, excerpt, by, at, editedBy, editedByName, editedAt }` | `id` 8 to 16 lowercase letters and digits. `title` 1 to 120 characters. `rev` an integer from 1, up by one on every committed save. `chunks` the chunk ids in order, 1 to 6. `size` the characters of text, at most 150,000. `excerpt` the first 300 characters as plain text, for lists and search. `by` and `editedBy` user keys; `editedByName` up to 40 characters; `at` and `editedAt` ISO times. |
| `text:<id>:<chunk>` | `{ id: <chunk>, doc: <id>, text }` | `chunk` 8 lowercase letters and digits. The chunk's serialized JSON is at most 48,000 characters, measured with `JSON.stringify(value).length`, never estimated. |
| `_lock:<id>` | `{ id: 'lock', type: 'lock', doc, holder, name, at, seq, by }` | Leading `_`, so a list of `doc:` or `text:` does not hear it. `holder` is `host.user.key`; a guest has none and cannot edit. |

Every record is cleaned on reading, as `wbCleanPresent` does: a wrong type, unknown fields dropped, strings cut, control characters removed, ids matched against a pattern. A record that does not clean is ignored.

**Splitting text into chunks.** Cut at the last blank line before the limit; if there is none, at the last line break; if none, at a character boundary that does not split a surrogate pair. An empty document is one empty chunk. A save above 6 chunks or 150,000 characters is refused in the page before any write, with "This document is too long. Split it into two."

**Saving (the commit).** The editor holds the lock and the version `v` of `doc:<id>` it read.
1. Split the text. For each chunk whose text equals the old chunk at the same place, keep its id; give each other chunk a new id.
2. Write each new chunk (`set`, no version, new keys).
3. Write `doc:<id>` with `rev + 1`, the new `chunks`, `size`, `excerpt`, `editedBy`, `editedByName`, `editedAt`, and `{ version: v }`. **This is the commit.** 409 means someone else committed first: the save has not happened, nothing the person wrote is dropped (see "Losing the lock").
4. Delete the chunks the old record listed and the new one does not (best effort).
5. Set the document's links with `host.objects.setLinks` when the pointers in its text changed.

**Opening a document** reads `doc:<id>`, then `list('text:<id>:')` and joins the listed chunks in order. If a listed chunk is missing, read the small record again and retry (up to three times, then "This document could not be loaded. Try again."). Chunks the small record does not list are leftovers of a save that did not finish; the person who takes the lock deletes them. Nobody else deletes.

**Hearing a change.** A `change` of `doc:<id>` is the signal: when its `rev` is higher than the one shown, reading people load the chunks again and redraw, keeping their scroll position. A change to a chunk alone is ignored (it is not committed until the small record says so). A batch from Clear or its Undo arrives as `changes` and may come without values; read again with `list` as the SDK's note says.

### The lock

The constants are the Whiteboard's: refresh every 10 seconds, stale after 35 seconds with no change seen on this page's clock, an old record read at load given 12 seconds to change. Rules, all pure functions in the module's own library file with their own tests, as the Whiteboard's are:
- **Take:** an editor with a key presses Edit. No record, or a stale one: write the lock with the version read (0 when none). Success: the editor opens. 409: someone else holds it; the document stays in reading, with "Ana is editing this. You can read it as it changes."
- **Keep:** while the editor is open, rewrite the record every 10 seconds. When a hidden page becomes visible again, refresh first and save second. A 409 on a refresh means someone took it.
- **Release:** Done, or leaving the document, deletes the record with its version. A closed page cannot wait for that; the 35 seconds cover it.
- **Same person, second page:** the second page is read-only, with "You are editing this in another window." *(Draft; to be confirmed.)*
- **Take over:** none in the first release. A lock is free after 35 seconds. *(Draft; to be confirmed.)*
- **Losing the lock** (a 409 on a refresh or on the commit): the editor stops accepting keys, keeps the text on the screen, and says "You stopped editing because someone else saved first. Your changes are kept here." with **Copy** and **Save as a new document**. The text is never thrown away.

### What a person sees (pages half)

Three states in one module window: the list, a document in reading, a document in editing.
- **List:** each row has the title, the excerpt, who edited last and when, and "Ana is editing" when a live lock is there. Newest edit first. A search box filters by title and excerpt. **New document** for editors only. Empty: "No documents yet." for editors, "Nothing has been written here yet." for everyone else. Rows can be dragged as objects like other modules' (use the same `host.objects.draggable` helper).
- **Reading:** the rendered document. **Edit** for editors, disabled with the reason when the lock is held. A rendered object link is a chip that opens the object; one the viewer cannot see reads as hidden and one that is gone reads as removed, as everywhere else. Checklist boxes are not clickable in reading *(draft; see open questions)*.
- **Editing:** the title field, the formatting bar, the text, and the rendered document beside it (above it on a narrow window). A saved/saving/not-saved word in the status line. Autosave 3 seconds after the last key, on **Done**, and when the page is hidden; never more often than every 3 seconds. **Done** saves, releases and returns to reading.
- **Title bar menu:** Delete document (editors; asks first, and refuses while someone else holds the lock), **Save as Markdown file**, **Print** (the standard action).
- **Formatting supported:** headings 1 to 4; bold; italic; inline code; fenced code (no colouring); quotes; bullet and numbered lists to four levels; checklists (`- [ ]`, `- [x]`); links to `http:`, `https:` and `mailto:`; object links; tables with a header row and left, centre and right alignment; maths as `$...$` inline and `$$...$$` as a block; a rule; hard line breaks. **Shown as text, not drawn:** raw HTML, pictures (`![](...)`), footnotes.
- **Object links:** a toolbar button opens `host.objects.pick`; it inserts an ordinary Markdown link whose address is `object:<module>:<kind>:<id>`. The link's text is a label kept in the document; the chip shows the object's current title from `host.objects.resolve`. Only objects in the same space. Linking to another document is the same, with module `documents` and kind `document`. On save, the pointers found in the text are given to `setLinks`.
- **Words:** plain and short, the environment's word for the space and the module, no "item", "card" or "pane".

### Export

- **Markdown file:** the document's text exactly as stored, except that each link with an `object:` address becomes its text alone (an `object:` address means nothing outside the app), saved as `<title>.md`, UTF-8. Maths stays as `$...$`. Delivered by the in-page download link the Whiteboard uses, until `host.files.save` exists. A file name drops `/ \ : * ? " < > |` and control characters and is cut to 80 characters.
- **Print / Save as PDF:** the standard Print action. Its `run()` draws the rendered document at full height with no inner scroll, in the light theme, and returns; the host prints the content area and the module hears `printed` and goes back.

### Safety rules (checked, not only intended)

1. Nothing a person wrote reaches `innerHTML`, `insertAdjacentHTML` or `outerHTML`. The one exception is the maths library's own output, in one named function.
2. Link addresses are allow-listed; `javascript:`, `data:`, `vbscript:` and anything unknown are shown as text. Whitespace and control characters inside a scheme (`java\tscript:`) are not an escape.
3. A link out gets `rel="noopener noreferrer"` and `target="_blank"`.
4. The maths library runs with `trust: false`; a formula that fails shows its source text, not an error page.
5. Direction-control and zero-width characters are removed from titles and from rendered text, as `host.util.markdown` does.
6. A document's text, title and excerpt are length-checked on reading as well as on writing; a record that fails is shown as unreadable, not drawn.
7. A rendering that takes long (a huge table, a nested list) is bounded: tables to 200 rows by 20 columns, list nesting to 4, a formula to 2,000 characters. Beyond that the source is shown as text.

### Server half

Little is needed; this is a module, not a host feature. server-development: the module is accepted by `cleanManifest` with the manifest above; the module's versions entry; the module added to the checks that list bundled modules (`check-modules`, `check-module-versions`, `check-module-live` if it reads manifests, `check-sources-modules`); a safety check (below); and, only if Thomas decides it, a change to the 5 MB module limit (open question 3), which is a change to `server/module-data.js` and its documents, not to the module.

## Left to build, in order

1. **Spike** (throwaway; nothing committed from it except what it taught): see the list below. Owner: experience-design, with server-development for the storage questions. Thomas sees the results before step 2.
2. **The pure library** in `modules/documents/src/documents-lib-*.js`, no page and no host: cleaning of the three records, the chunk split and join, the lock rules, the reader (Markdown to a plain description, then to DOM), the Markdown export, and the formatting bar's text changes. Tests in `modules/documents/test/` for each, including the safety corpus. Owner: experience-design builds; server-development writes the safety check (`tools/check-documents-safety.mjs`: the source rule in safety rule 1, and a corpus of hostile text that must come out inert). Checkable alone.
3. **The list and reading** with the manifest, the stored keys, the object kind and live updates: create, list, open, rename, delete, hear another person's change. No editing yet except through a test seed. Owner: experience-design.
4. **Editing and the lock**: the formatting bar, the preview, autosave, the commit, losing the lock. Owner: experience-design.
5. **Tables and maths**: the vendored renderer parts, `THIRD-PARTY.md` with licences and versions, pinned hashes as `tools/check-vault.mjs` does for pdf.js. Owner: experience-design; server-development adds the hash check. (Tables and maths come after the rest only so that the first four steps can be tried; they ship together with them.)
6. **Object links and document links**: the picker button, the chip, `setLinks`, the draggable rows. Owner: experience-design.
7. **Export**: the Markdown file and Print. Owner: experience-design.
8. **Review and documents**: an independent safety read by quality-assurance (stored script in a document, a hostile link, a formula, a huge table, a held lock and a stale one); then content-manager writes the module's `CONTRACT.md`, `architecture-modules.md` and `api-module-sdk.md` notes if anything in them changed, the user guide and the CHANGELOG.

### Later, not built now

- **Pictures.** The module's `uploads` (as the Whiteboard and Research have), shown by the reader as `![](...)` pointing at an upload. Needs the reader's picture rule and a size choice. Not the Vault (see the gap above).
- **Live co-editing.** Replace the text box with ProseMirror and keep the document with Yjs; vendor the bundle (built once, committed, pinned hashes) with a `THIRD-PARTY.md`; add `"live": { "publish": "edit" }` so only editors can send updates and a viewer cannot inject one. `host.live` messages are lossy and not stored **(code, `host.js`)**, so the document's truth would still be storage: a stored snapshot and a short log under compare-and-set, with a state exchange when a page joins or reconnects. The lock goes away; the Markdown stays the export and a readable snapshot, so the first release's reader and export are kept. The value limit, the 5 MB, the 240 saves a minute and a security read of `host.live` must all be settled first. The stored keys change at that step; the product is unreleased, so there is no migration.
- **Sharing the shape.** The pure files (record cleaning, chunking, the lock, the reader) carry no Documents words. When a second module wants a list and editor, lift them into an SDK piece then, not before.

## Verify

Nothing is verified yet. When built:

- **Checked by a tool, on the development server, no LiveKit needed:** the pure library's tests; the safety check; compare-and-set on `doc:<id>` and `_lock:<id>` with two browser pages (take, refuse, refresh, go stale, take after stale, release); a save of a document of several chunks, a failed save halfway (kill after the chunks, before the commit) leaving the old text readable; opening with a leftover chunk; the manifest through `cleanManifest`; `npm run check`; `npm run check:docs`.
- **Verified live in a browser with two people:** the list and reading following another person's saves; the lock banner; losing the lock with a sleeping tab; tables and maths drawn; an object link chip and its backlink; the Markdown file and Print on a long document; the phone layout.
- **Cannot be checked here:** anything inside a real call (there is no LiveKit server here); how the documents behave with a guest link in a live call (the guest rule is read from the manifest, not exercised); a browser other than the one used; a real tutor's or client's use.

## The spike: what to prove first

1. **Compare-and-set and the lock on a real server.** `set` with version 0 on a missing key creates it, and a second 0 gets 409 with `err.current`. Two pages, the Whiteboard's timings, a stale holder taken over. Read as code only until run.
2. **The 5 MB and the 60 KB as they really are.** What happens at the edge: 48,000-character chunks of quotes and line breaks (the escaped worst case), the cost of rewriting the space's file on every save at 20 documents and at 200, and the exact message when storage is full. Settles open question 3.
3. **The reader and the safety check.** The chosen parser as a single inline file inside a module's HTML (its size), tokens to DOM for every supported form, and a corpus of hostile inputs (script and event handlers in raw HTML, `javascript:` with tabs and entities, a link inside a table cell, a deeply nested list, a 5 MB line).
4. **Maths in a shadow root.** KaTeX with fonts registered through `FontFace`, its size with the fonts, and the same formulas through Temml; both printed to PDF.
5. **Print of a long document** through the standard Print action: several pages, no cut-off, light colours, a table not split across pages in an ugly place.
6. **A tutor's reaction to E1.** One real tutor writes a handout with a table and a formula in the text box with the bar and the preview. If it is too raw, E3 moves into the first release and the plan's order changes.
7. **Typing speed** with a 100 KB document and the preview redrawn, on a phone.

## Risks

- **Stored script in a shared document** is the worst failure: it runs with the reader's session. Mitigation: tokens to DOM, no HTML sink, a check and an independent read before any beta client sees it.
- **5 MB for the whole environment.** A tutor with many pupils' spaces can fill it, and it fails for every space at once. Unsolved by the module alone.
- **Whole-file rewrite on every save.** A space's file holds all its module's data and is written whole; autosave at 3 seconds on a large store is heavy. The spike measures it.
- **A cooperative lock** can fail when a tab sleeps. The commit's compare-and-set means a loss of the lock never loses text, but a person can still be told to stop while typing.
- **One editor at a time may not fit tutoring**, where a tutor and a pupil often write together. If the beta clients say so, co-editing moves up and the live channel becomes the blocker.
- **No history.** A deleted paragraph or an overwritten document cannot be brought back, apart from the browser's own undo while editing. Any editor can delete any document.
- **Fonts for maths in a shadow root** may force a host change.
- **A heartbeat every 10 seconds counts toward 240 saves a minute,** with the autosaves and the chunk writes. A document of six chunks saved every 3 seconds is at the limit; the commit writes only changed chunks to keep it away.

## Open questions

Blocking the build (steps 2 and after):
1. **E1 or E3 for the first release.** Is a Markdown text box with a bar and a preview acceptable to the tutors and project collaborators, or must they see the result as they type?
2. **Is one editor at a time enough for the first real use?** Tutoring may want two writing together; if so, co-editing is the first step, not the second.
3. **The 5 MB limit is for all spaces together.** Accept it for the beta, or raise the limit for this module (a server change, and a choice of how high)? What should a person see when it is full?

Not blocking, but needed before release:
4. **Who may delete a document, and should there be a way back?** Today any editor can delete any document, and Clear (which needs `edit` here) wipes them all. Options: a separate permission to delete others' documents, a trash for seven days, a "previous version" kept on every save.
5. **Taking over a lock.** None in the draft (wait 35 seconds). Should an owner or moderator be able to take it at once? The displaced person's text is kept either way.
6. **A second page of the same person** is read-only in the draft. Or should it take over, as the Whiteboard treats the presenter's other page?
7. **Checklist boxes in reading.** Not clickable in the draft. A handout or a lesson plan is often ticked off; letting an editor tick without opening the editor would need its own small write.
8. **A document inside the Vault** and **a Vault Markdown file opened as a document.** Left out. Is that right for the beta?
9. **Reuse.** "Designed so other modules could reuse it" is read here as pure library files with no Documents words, lifted into the SDK when a second module asks. Is that what was meant?
10. **Whether the AI may read documents.** Only the excerpt reaches a summary now. Giving the Assistant or Research a document's full text would need a rule for who may.
11. **`host.live` status.** The plan says nothing is built and its security steps are held, but pieces are in the code. Co-editing waits on that answer.

## Not decided

The icon and colour; the exact words on screen beyond those above; the narrow-window layout of editing (side by side, or a toggle); how Documents appears in a template's modules list (travel, tabletop, tutoring); whether it has a page surface or a destination; the module's order in the nav.
