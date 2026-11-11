# Documents Rich Editor Plan: see the page as you type

**Audience:** Thomas, who decides; experience-design (the editor, the Markdown mapping, the bar); server-development (the licence, outside-URL and hash checks, the names check); quality-assurance (the independent safety read in a real browser); the project manager (the toolbar screenshots at each UI PR); content-manager (the documents once it is built).

**Status:** Draft on Thomas's decisions of 2026-11-11 (1 to 10) and the project manager's decisions under his delegation of the same day (11 to 21), and 22 to 28 from the stored-form design note; all open questions are closed; nothing is built and nothing was run for this plan. The request, as the project manager passed it on: Thomas regretted the split screen and wants a rich editor, where the person editing sees the finished look while typing. No spike has been run and no spike notes reached this plan, so every statement about a library is from memory. Facts are marked **(code)** (read in the code at `0c5fa780`, Documents 0.6.1), **(docs)** (read in the documentation) or **(memory)** (recalled, to confirm in the spike). This plan builds on [plan-documents](plan-documents.md) and changes only its editor; the contract below is a draft, and what Thomas has not decided is under "Open questions".

## What it is today

- **Editing is one Markdown text box** on the page sheet (`#edit-text`, monospace); the preview beside it (`#edit-preview`) was removed in 0.2.1 **(code, `documents.html`, `documents.css`, commit `4aff5782`)**. A person editing sees the marks, and types a table as pipes.
- **The text box meets the rest of the page in five places:** `openEditor()` fills and focuses it, `current()` reads it, `typed()` hears a change, `applyFormat(fn)` runs a text change from `documents-lib-f-format.js`, and `loseLock()` makes it read-only **(code, `documents.js`)**. The lock (`lib-c`), the save plan and autosave (`lib-g`), the chunks (`lib-b`) and the catch-up (`lib-j`) never look inside the text **(code)**.
- **The safe reader** is `dlDescribe(markdown, lex)` (tokens to a plain description) and `dlBuild` (description to elements, `createElement` and `textContent` only) **(code, `documents-lib-d-reader.js`)**. Its bounds: 150,000 characters, tables 200 by 20, lists 4 deep, quotes 8 deep, a formula 2,000 characters; beyond them the source shows as text. It also draws strikethrough and shows a level 5 or 6 heading as level 4 **(code)**.
- **Vendored today:** `marked` 18.2.0, the lexer only, MIT by `vendor/LICENSE.marked` **(code, `THIRD-PARTY.md`)**.
- **The bar** is 11 shared icon buttons (`host.ui.toolbarButton`) with `host.menu.show` menus for Heading, Page colour and Zoom; the table button reads "Grid" **(code)**. A button's `on` is drawn as `aria-pressed` **(code, `public/module-frame.js`)**. `host.toolbar.set` takes at most 16 entries and folds into **More** when narrow **(docs, `api-module-sdk.md`)**.
- **Not in the page yet at 0.6.1:** maths is not drawn (no `math` hook is passed and no maths library is in the repository), there is no object-link button or chip (`dlObjectLink` is in the library only), and export and Print are not wired **(code)**. They are steps 5 to 7 of plan-documents.
- **Checks not built yet:** `tools/check-third-party-licences.mjs`, `tools/check-no-outside-urls.mjs` and a hash check for vendored files **(code, `tools/`; `THIRD-PARTY.md` says so)**. `tools/check-names.mjs` skips the vendored `marked` file by its path **(code)**.
- **Where the module runs:** in a shadow root in the page, its page one file with every `documents-lib-*.js` inlined in name order **(code, `public/module-host.js`, `server/module-build.js`)**. The sheet is scaled with CSS `zoom` **(code)**. The space's call shortcuts skip a key typed in an editable element, found through the event's path **(code, `public/space.js`, `typing`)**.

## Decisions

Thomas, 2026-11-11.

1. **A rich, see-as-you-type editor.** The person editing sees the finished look while typing, with no visible marks; everyone else sees the rendered document. *Reason:* he regretted the split screen.
2. **Built right after the current Documents work.**
3. **Markdown stays the stored form.** *Reason:* export stays trivial and the editor can change without touching the data (plan-documents).
4. **One editor at a time, with the existing lock.**
5. **Licences:** only MIT, Apache-2.0, BSD, ISC or MPL-2.0; no GPL, AGPL or LGPL, nothing source-available or paid (plan-documents, decision 8).
6. **No outside service:** everything vendored and self-hosted, and the spike runs with outbound network blocked (plan-documents, decision 9).
7. **`markdown-it` is out.** *Reason:* its dependency `argparse` carries the Python Software Foundation licence, which is not on the list.
8. **Temml draws the maths;** KaTeX is the fallback.
9. **The bar uses shared pieces only** (`host.toolbar.set`, `host.ui.toolbarButton` icon buttons, `host.menu.show`). The project manager compares screenshots with the Whiteboard and Chat.
10. **The page-sheet look, the page colour, zoom and Fit width, the List and Thumbnails views and tags keep working** while editing.

Decisions 11 to 21 were made by the project manager under Thomas's delegation, 2026-11-11.

11. **Paste is plain text first,** read through `dlDescribe` (the safe reader). Kept formatting from Word, Docs or the web is its own later PR, after the safety read. *Reason:* kept formatting is a second way in.
12. **Untouched blocks are stored exactly; the first edit of a block writes that block in the editor's form,** with the fixed written list of changes (rule 4). This is a requirement, no longer priced by the spike. Rule 3 stands: opening a document and pressing Done write nothing.
13. **Browsers that must pass:** current Chrome, Edge, Firefox and Safari on desktop; Safari on iPhone and iPad; Chrome on Android. Safari and a phone cannot be checked here: Thomas tests his iPad and phone by hand before any beta client uses rich editing. Until then every report says "not verified on Safari/phone".
14. **Rich becomes what people get** only after steps 5 (text), 6 (bar and links) and 7 (tables) and the independent safety read. Until then the Markdown box stays the default and rich is reachable by a switch for Thomas to try. Maths and the object chip land later; Source covers them meanwhile.
15. **Toolbar limit:** group buttons into menus, in the module only. No core change to the 16-entry limit.
16. **Weight:** accept the bundle weight now; revisit loading on Edit later.
17. **Typing shortcuts** (`# `, `- `, `1. `, `> `, `**bold**`): yes.
18. **Strikethrough** is kept only, with no button.
19. **A formula** is typed as TeX in a small box; a typed `$` does not start one.
20. **Source** is a shared toolbar button, and the choice is remembered per person.
21. **Kind of build:** a try build per step; the safety read step and the final default switch are production builds. Order: wait for the spike's short report (the project manager reads it); then step 2, the three checks, on a held branch with an independent read before any editor code; then steps 3 to 7. Rules: rebase on `origin/main` before every SHA; screenshots next to the Whiteboard and Chat toolbars; the larger model at high effort only for the risky parts (the mapping, the shadow-root work, the safety read), the smaller model for the rest.

Decisions 22 to 28 were made by the project manager under Thomas's delegation, 2026-11-11, from the stored-form design note (block-level source preservation).

22. **Stored form:** untouched blocks are stored exactly; the first edit of a block writes that block in the editor's form; the accepted list is the one in rule 4 (this restates decision 12).
23. **The text is read back and compared before every save, Done, Copy and Source.** A kept block that reads differently is rewritten alone; a whole-document rewrite is the last resort and is logged in the test corpus.
24. **No text is read per key.** `typed()` uses a cheap "changed" test (`doc.eq`); `getText()` runs only at save, Done, Copy and Source. *Reason:* phones are slower. Build step 3 adds this.
25. **Build step 4 splits into 4a (the mapping) and 4b (the block-level write and the one-block-edit corpus test; the larger model at high effort).** The reader fields land before 4a as their own small Documents PR (smaller model, rebased, with tests): the code fence's first word as `lang` and the rest as `info` (this fixes the 0.6.2 mangling of a fence such as ```` ```js title="x" {1,3} ```` into `jstitlex13`), a heading's own `level` (5 and 6 drawn as 4, kept by a field), a link's `title`, the formula token for edited blocks, and the chip label escaped in the serialiser.
26. **Entities:** the reader shows what Markdown means. An entity such as `&amp;amp;` reads as `&amp;`, so the reader decodes entities in text and the serialiser escapes a literal ampersand that could form an entity. Corpus cases are added.
27. **A list is one block for now.** Writing by the row can come later if wanted.
28. **The corpus is run again on any `marked` upgrade.** This goes into the recipe in `THIRD-PARTY.md`.

## Scope and non-goals

**In:** the text box in editing is replaced by a rich editor, with a Source button that brings the Markdown text box back.

**Not in:** co-editing and Yjs (the later step of plan-documents; this is the editor that step needs); pictures; colouring in code blocks; comments, suggestions and history; checklist boxes that tick in reading; dropping an object onto the page; any change to the stored keys, the lock, the commit, the server or `host.util.markdown`.

## Options: which editor

Nothing here was run; licences, sizes and dependencies are all **(memory)** until the spike reads each `LICENSE` file.

- **ProseMirror with our own Markdown mapping.** MIT. Packages: model, state, view, transform, commands, keymap, history, inputrules, schema-list, gapcursor and tables, with `orderedmap`, `rope-sequence` and `w3c-keyname` beneath. `prosemirror-markdown` is not used: its reader is built on `markdown-it`. In: `marked` tokens, then the reader's own `dlDescribe`, then the editor's document, so the editor only ever receives what the safe reader allows. Out: a serialiser of our own. Costs: the mapping, the table editing and the maths and chip nodes are ours to write and test; about 300 to 400 KB minified. It is the editor plan-documents names for co-editing.
- **Tiptap.** A wrapper around ProseMirror with ready extensions. Not needed: there is no front-end framework here, the hard parts (the mapping, safety, the shadow root) stay ours, it adds a second API and more weight, and some of its extensions are paid or hosted, so each would need its own licence read.
- **Lexical.** MIT, its own model. Its Markdown support is made for typing shortcuts and import, not an exact round trip; tables in Markdown are weak; behaviour in a shadow root is uncertain. Not the editor named for co-editing.
- **Milkdown.** MIT, ProseMirror with `remark`, and the closest ready-made editor. It brings a second Markdown parser beside `marked`, so the editor and the reader could read one text two ways, and a large tree of small packages to licence-read. Its maths uses KaTeX.
- **Our own `contenteditable`.** Composition, selection, undo and each browser's own changes to the page are years of defects, and every safety property would be ours to prove.

*Lean:* **ProseMirror with our own mapping**; Milkdown only if the mapping fails the spike; the other three rejected.

## The contract

### Where it sits

- **Module only.** The editor replaces `#edit-text` and nothing else. Both the rich editor and the text box sit behind one small adapter: `getText()`, `setText(text)`, `setReadOnly(on)`, `focus()`, `onChange(fn)`, `run(action)`, `destroy()`. The five places above call the adapter.
- **Unchanged:** the lock, autosave (3 seconds), the commit, the chunks, losing the lock (Copy and Save as a new document take `getText()`), the catch-up, and their tests. The stored record, `preview`, `excerpt`, thumbnails, export and Print are unchanged, because they are made from the Markdown.
- **The manifest, `server/`, `public/sdk/` and `public/module-host.js`: no change expected.** Needed outside the module: the three checks named above (server-development, before any editor code merges), and the vendored file's path on the skip list of `tools/check-names.mjs`. No core change is planned: the 16-entry toolbar limit is met by grouping buttons into menus (decision 15), and the editor loads with the page (decision 16).

### Markdown in and out: what "exact" means

`P` is Markdown to the editor's document; `S` is the editor's document to Markdown. For every document `D` in the corpus:

1. **A fixed point.** `P(S(P(D)))` equals `P(D)` node for node, and `S(P(S(P(D))))` equals `S(P(D))` character for character.
2. **The same reading.** `dlDescribe(S(P(D)))` equals `dlDescribe(D)`, so nobody reading sees a difference.
3. **Opening changes nothing.** `getText()` returns the stored text exactly until the person changes the document. Open and Done writes nothing.
4. **Untouched blocks exactly, an edited block in the editor's form** (decisions 12 and 22). A document not in the editor's own form is shown faithfully. A block the person did not change is written word for word; a block they edited is written in the editor's form. In an edited block only, these changes are accepted: `__` and `_` to `**` and `*`; `*` and `+` bullets to `-`; indent to 2 spaces; `1)` to `1.`; typed numbers run on from the first; loose to tight; `[X]` to `[x]`; setext to `#`; closing `#` dropped; `***` and `___` to `---`; `~~~` and indented code to a backtick fence; a two-space break to a backslash; a line break inside a paragraph to a space; table pipes and spacing; a reference link to inline (its definition line stays); a bare address to `<address>`; escapes; a block formula on one line. One loss: table cells beyond the header's column count are dropped. Each is covered by rule 2. A heading of level 5 or 6 is drawn as 4 and written with its own level (`#####`), and a link's title and a code block's info string are kept by a field.
5. **Nothing is dropped or escaped in a source node.** Raw HTML and comments, pictures, footnotes, link-definition lines, a link with a refused address, a list, quote, table or formula past the reader's bounds, and anything the reader does not know, show as the reading view shows them and are held as a source node that writes its Markdown back word for word.
6. **The reader's bounds hold.** A command that would pass them (a fifth list level, a 201st row) does nothing. A text that grows past 150,000 characters is refused at the save with today's words.
7. **Read back before it is handed out** (decision 23). `getText()` is read back and compared with the document before a save, Done, Copy or Source; see "Stored form" below.

### Stored form: block-level source preservation

- **The table.** When the text is read, a table is made beside the document: one entry for each top-level marked token, holding its slice of the text, the blank lines after it, and the node it reads as in the whole text. `getText()` is a pure function of that table and the current document.
- **Unchanged.** A top-level node that is the same object as, or `Node.eq` equal to, a stored node writes its slice word for word. Blocks are matched same-at-start, same-at-end, then by the longest common run. Changed and new blocks go through the serialiser. An unclosed source box is flagged `open`.
- **Check.** The text is read back and compared before it is handed out (decision 23). A kept block that reads differently is rewritten alone; a whole-document rewrite is the last resort and is logged in the test corpus.
- **Per key.** `typed()` uses `doc.eq` only (decision 24).
- **Editor rules still needed in step 5,** because source nodes do not solve them: bold ending in punctuation against a letter, a bare address typed as plain text, and an empty paragraph.
- **Measured in the design note (not in this repository):** typing in one block leaves every other byte identical in 100% of corpus and fuzz runs of typing; all eight kinds of one-block edit, 99.65% (spike fuzz) and 95.92% (source-form fuzz); open then Done returns the stored text exactly, 8,067 of 8,067; "which blocks are unchanged" costs 0.008 ms a key, and the read-back and compare about 10 ms on a 56 KB document (24 ms on 142 KB).

The corpus is in `modules/documents/test/`: every supported block, text typed in the box in other Markdown forms, the hostile corpus, and the hard cases (a `$` in prose, a `|` or a formula in a table cell, backticks in code, loose and tight lists, a checklist line with blocks under it, emphasis inside a word, an empty paragraph).

### Blocks

Headings 1 to 4; bold, italic, inline code; bullet and numbered lists to 4 levels; checklists; quotes; links; object links (the button opens `host.objects.pick`, drawn as the chip, stored as an ordinary Markdown link whose address is `object:<module>:<kind>:<id>`); tables with a header row and alignment; maths through Temml, `$...$` inline and `$$...$$` as a block, each an editable node (open it, type the TeX, see the result); code blocks, no colouring; rules; hard breaks. Strikethrough is kept because the reader draws it, with no button (decision 18). Typing shortcuts turn `# `, `- `, `1. `, `> ` and `**bold**` into the format as typed (decision 17). A formula is typed as TeX in a small box, and a typed `$` does not start one (decision 19).

### Source

A shared toolbar button, `on` while the text box shows; the choice is remembered per person (decision 20). Rich to Source gives `getText()`; Source to rich gives `P(text)`. Lossless both ways: switching with no typing changes neither the text nor the document.

### Paste, copy and drop (the project manager's requirement)

- The module takes the `paste` and `drop` events before the library does, so the library's own HTML clipboard reader never runs **(memory, to confirm)**. The clipboard's plain text is read as Markdown through `dlDescribe`, the same path as loading: no raw HTML kept, links only `http`, `https`, `mailto` and `object:`, pictures as text, the reader's bounds applied.
- Every attribute in the schema is checked on every way in (loading, paste, the browser's own changes to the page, undo): an address through `dlSafeAddress`, a chip's ids by the reader's patterns, a formula's length.
- Copy gives Markdown as the plain text.
- Only plain text is kept from a paste (decision 11); a paste that keeps formatting is a later PR after the safety read.

### Bar, keys and undo

Buttons are grouped into `host.menu.show` menus to stay within 16 entries (decision 15). The bar's actions apply to the rich selection, and a button is `on` when the selection has that format. Undo and redo are the editor's own history. Draft keys: Ctrl or Cmd with B, I, K (link), Z and Shift+Z; Tab and Shift+Tab indent a list line and move between table cells; Escape leaves the editor so the keyboard is never trapped. Ctrl or Cmd with `+`, `-` and `0` stay the zoom **(code)**.

### Phone, input methods and accessibility

Works at 390 px: touch selection with the phone's own handles, the bar folding by the toolbar's rule, the caret kept above the virtual keyboard. Input methods and a phone keyboard that composes each word lose and double nothing. The editor is `role="textbox"`, `aria-multiline="true"`, labelled "Text" as the box is; every button has a name; a formula and a chip have a text name.

### The shadow root

ProseMirror reads the selection from its root and works in a shadow root in Chrome and Firefox; Safari needs a recent version of the view package **(memory)**. The toolbar is outside the module's root, so a button press takes the focus away and the editor must take it back with its selection. The spike checks these in a copy of the module, in its shadow root, at each zoom level.

### Vendoring

One file, built once outside the repository and committed (draft name `src/documents-lib-1-editor.js`), with each package's `LICENSE` in `vendor/`. `THIRD-PARTY.md` lists each package, version and licence, the SHA-256 of the built file, and the recipe (entry file, bundler and version, command) so the hash can be made again. It must pass the licence, outside-URL and hash checks. The file loads nothing and touches no page at load, so the tests can run it in Node **(memory)**.

## The spike: what to prove first

Throwaway, outbound network blocked, in Chrome here and Firefox and Safari by hand.

1. **Licences:** each package's own `LICENSE` file, and its dependencies; the built size.
2. **The round trip:** rules 1 to 5 on a first corpus, and how long `P` and `S` take at 150,000 characters.
3. **The shadow root:** caret and selection by mouse, keyboard and touch; focus back after a toolbar button and after a menu; copy, cut and paste by key and by the browser's menu; composition, with a real input method where there is one and scripted composition events in Chrome; the caret at 50% to 200% zoom and Fit width; the call shortcuts not firing while typing.
4. **Paste:** hostile HTML on the clipboard, with a stop on the library's HTML reader to show it is never reached.
5. **Tables and maths nodes:** adding and removing rows and columns, alignment, a formula opened and closed, Temml inside the editor.
6. **The bar:** how many entries it needs against the limit of 16, and its look at 390 px.

## Left to build, in order

Each is one small PR with a module version bump, a try build (decision 21) except where marked; each rebases on `origin/main` before its SHA, and every PR that changes what a person sees carries screenshots beside the Whiteboard's and Chat's toolbars for the project manager. The larger model at high effort is for the mapping, the shadow-root work and the safety read; the smaller model for the rest.

1. **Spike.** experience-design. The project manager reads its short report before step 2.
2. **The checks** (licence, outside URL, hash; the names skip). server-development, in `core/tools`, on a held branch with an independent read before any editor code.
3. **The adapter**, with the text box behind it; nothing a person sees changes. It adds the cheap `doc.eq` "changed" test for `typed()` (decision 24). experience-design.
- **Reader fields** (before 4a; decision 25): its own small Documents PR, smaller model, rebased, with tests. `lang` and `info` for a code fence, a heading's `level`, a link's `title`, the formula token for edited blocks, the chip label escaped in the serialiser, and entities decoded in text (decision 26). experience-design.
4a. **The vendored file and the mapping** (`P`, `S`, the stored-form table, the corpus tests including the entity cases); no page change. experience-design, larger model at high effort.
4b. **The block-level write** (`getText()` from the table, the read-back, the one-block-edit corpus test); no page change. experience-design, larger model at high effort.
5. **The rich editor for text:** paragraphs, headings, bold, italic, code, lists, checklists, quotes, code blocks, rules, hard breaks, the source node, paste, undo, and Source. Rich is reachable by a switch for Thomas; the Markdown box stays the default. experience-design.
6. **The bar and the keys** on the rich selection; links. experience-design.
7. **Tables.** experience-design.
8. **The safety read** (production build): the builder tells the project manager when the editor and the renderer are ready, and quality-assurance reads both independently in a real browser. Required before rich becomes the default and before Thomas's beta clients use rich editing.
9. **The default switch** (production build): rich becomes what people get (decision 14), after Thomas has tested Safari, iPad and phone by hand (decision 13). Then content-manager writes the documents.
10. **Maths nodes and the object chip** (after Temml and the chip land in the current work). experience-design.
11. **Phone, input methods and accessibility.** experience-design.
12. **Kept formatting on paste** (later, after the safety read). experience-design, with its own safety read.

## Verify

Nothing is verified yet.

- **Checked by a tool:** the round-trip corpus and the hostile corpus in Node; the lock, save and chunk tests unchanged and passing; the licence, outside-URL and hash checks; `npm run check`; `npm run check:docs`.
- **In a real browser** (Chrome is on this machine; whether a scripted run works here is not known): typing, selection, paste, undo, Source, the lock and losing it with two people, the bar at 390 px, zoom, no request leaving the server.
- **Not verifiable here (reports say "not verified on Safari/phone" until Thomas has tested by hand):** Safari, an iPhone or Android phone with its real keyboard, a real input method, a screen reader, a real call (there is no LiveKit server), and a tutor's use.

## Risks

- **The round trip is the whole risk.** A mapping that is nearly exact changes people's text quietly. Rule 2, the read-back (decision 23) and the corpus are the guard.
- **A `marked` upgrade** can change how a kept block reads. The corpus is run again on every upgrade (decision 28).
- **A whole-document rewrite** is the last resort and must stay rare; the corpus logs each one. The one-block-edit rate (95.92% in the source-form fuzz) is the number to improve.
- **Read-back cost:** about 10 ms on 56 KB and 24 ms on 142 KB, so it runs only at save, Done, Copy and Source.
- **A second way in for stored script.** The editor draws what a person typed and pasted. The guard is the one path through `dlDescribe`, the schema's checks and the independent read.
- **Safari and phones** cannot be checked here and are where a shadow root hurts most.
- **Weight:** every reader downloads the editor, because the page is one file.
- **The source rule** (no `innerHTML`) cannot cover a vendored file; the read must.
- **The order:** maths and the chip are not built yet, so step 10 waits on the current work; Source covers them meanwhile.

## Open questions

None. The eleven questions of the draft are answered by decisions 11 to 21 (stored form further settled by 22 to 28): paste (11), the first-edit rewrite (12), browsers (13), when rich becomes the default (14), the 16-entry limit (15), weight (16), typing shortcuts (17), strikethrough (18), the formula (19), Source (20) and the kind of build (21).

## Not decided

The keys beyond the draft; the words on screen; the table controls (a menu, or handles on the table); the icon for Source; whether the text box is removed once the rich editor has proved itself.
