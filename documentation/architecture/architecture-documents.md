# Documents Architecture

**Audience:** developers working on the Documents module (`modules/documents/`), or building another module on its shape.

The module is a bundled module that runs in the page. It keeps each space's documents in the module's storage, scope `space`. The user's view is [userguide-documents](../userguides/userguide-documents.md). Version 0.11.12. Written from the code and the plans ([plan-documents-rich-editor](../plans/plan-documents-rich-editor.md), [plan-documents-paper-layout](../plans/plan-documents-paper-layout.md)); the module's tests were not rerun for this document.

## Files

`src/documents-lib-*.js` hold the rules and have no page and no host, so another module can reuse them: `a-records` (cleaning the stored records), `b-chunks` (splitting and joining the text), `c-lock` (the lock rules), `d-reader` (Markdown to a plain description, then to DOM), `e-export`, `f-format` (the formatting bar's text changes), `g-save` (the save pace), `h-view` (zoom and list views), `i-tags`, `j-resync`, and since 0.7: `k-editor` (the one small object both editors sit behind), `l-schema` (the rich editor's document model), `m-parse` (Markdown to the reader's description to that model), `n-serialise` and `o-write` (the model back to Markdown, block by block), `p-rich-editor` (the rich editor), `q-rich-rules` (typing shortcuts and the bar's states), `r-rich-link` (the Link button, through `host.ui.prompt`), `s-pages` (Paper pages in reading) and `t-editor-pages` (page spacers in the rich editor). `documents-lib-0-prosemirror.js` is the vendored editor library. `documents-lib-0-marked.js` is the vendored Markdown lexer. `documents.js` is the page; `documents.html` and `documents.css` are its markup and styles. The tests are `test/` and `tools/check-documents-lib.mjs`.

## Stored keys

| Key | Holds |
|---|---|
| `doc:<id>` | The small record: `title` (up to 120), `rev`, `chunks`, `size`, `excerpt`, `preview`, `paper` (the page colour id), `layout` (`fluid` or `paper`), `pageSize` (`letter` or `a4`), `pageNumbers`, who made and last edited it. |
| `text:<id>:<c>` | A chunk of the text. A document is at most 150,000 characters in at most 6 chunks, each chunk record under 48,000 characters of serialized JSON, measured. |
| `_lock:<id>` | The edit lock: `holder`, `name`, `at`, `seq`. |
| `_trash:<id>` | A deleted document (its small record and the time), kept for 7 days. |
| `tags:<id>` | The tag ids of the document, in a record of their own so tagging never competes with a text save. |

Every record is cleaned on reading as well as on writing: a wrong type, unknown fields, control and direction characters and bad ids are dropped; a record that does not clean is shown as unreadable.

## Saving and the lock

An edit takes the lock with compare-and-set (`_lock:<id>`). The editor renews it every 10 seconds (`beat`); a lock nobody has seen change for 35 seconds (`stale`, on the reader's own clock) counts as free, and an old lock read at load waits 12 seconds for a change before it counts as stale. A save runs 3 seconds after the last key, at most 200 a minute (the rest of the 240 writes a minute the module is allowed is for the lock). It writes the changed text chunks first, then the small record under the version it read: that write is the commit, so a save that dies halfway leaves the old text readable. A save that finds the record changed by someone else stops the editing and keeps the person's text on the screen.

## Hearing changes

The page listens to `change`, so a reader sees a save as it lands. On `host.on('reconnected')` it reads the keys again (`resyncDocs`, `j-resync`) and merges. The list view and zoom are kept in the browser.

## Tags

`"tags": true` in `module.json`. The page uses `host.tags` (list, picker, chip, `filterOptions`) and hears `tags` ([api-module-sdk](../api/api-module-sdk.md), "Shared tags"). A document's ids sit in `tags:<id>`; a deleted tag's id is skipped when drawn.

## The rich editor and Paper

**Markdown stays what is stored.** The rich editor (ProseMirror, vendored; 16 packages in one file, see `THIRD-PARTY.md`) is a way of editing the same Markdown: the text is parsed into the editor's model on opening and written back by a Markdown writer on every save. Where Markdown cannot keep a block exactly, the block is saved as typed and the page says so once. The choice between the Markdown box and the editor is the person's, kept in the browser, not in the document. The bundle is modified in two ways: one source key is renamed (`tableRole` to `gridRole`) and one export aliased (`tableEditing` also exported as `gridEditing`), so module code can use both; the recipe is in `THIRD-PARTY.md`. A grid in the editor is limited to 200 rows and 20 columns, the same bound as the reader; **Tab** in the last cell adds a row up to the limit.

**Paper.** The document's `layout` is `fluid` (one continuous sheet) or `paper` (pages of `pageSize`, Letter at 8.5 by 11 inches or A4 at 210 by 297 millimetres, with a 1 inch margin). Nothing about where a page breaks is stored. In reading, the blocks are laid out once in a hidden box as wide as a page's text and cut into pages from their drawn heights (`s-pages`); a manual break is a line in the text (`DL_PAGE_BREAK_LINE`). In the rich editor, `t-editor-pages` adds spacer decorations where a page ends, so the page look holds while typing; the Markdown box is not paged. Below 60 percent of a page's width (`DL_PAGE_FLOOR`, with an 8 pixel hysteresis, `DL_PAGE_HYST`) a Paper sheet is drawn as Fluid. A document of more than 6000 blocks (`PAGES_MAX`) is one sheet. **Fit width** scales the whole sheet (`fitPaper`), up to 200 percent; the editor does not split a grid between pages, so its page count can differ from reading's for a very large grid. Thumbnails of a Paper document are drawn as a page of its size.

**The title bar.** Zoom out, Zoom in and the Zoom menu are `host.header` items (`host.header.set`), not toolbar items, because the editing row (Tags, the formats, Insert, the Editor and Layout switches, Page, Done) uses the toolbar's 16 entries. Insert holds Grid, Formula and Page break (the Grid group first while the caret is in a grid) and uses `host.menu.show` with `onClose` to give the keyboard back to the editor.

## Safety and licences

The Markdown reader builds DOM from a plain description and sets text with `textContent`; it never sets HTML from a document. Links are limited to `http`, `https`, `mailto` and `object`. The vendored library is marked 18.2.0 (MIT), used for lexing only; `modules/documents/THIRD-PARTY.md` lists each vendored piece with its licence and source, and `vendor/LICENSE.marked` is the licence file. The plan's rules bind every vendored library: only MIT, Apache-2.0, BSD, ISC or MPL-2.0, no outside service, no CDN, no telemetry. The licence, hash and outside-URL checks named in the plan are not built yet.
