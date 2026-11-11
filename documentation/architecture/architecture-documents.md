# Documents Architecture

**Audience:** developers working on the Documents module (`modules/documents/`), or building another module on its shape.

The module is a bundled module that runs in the page. It keeps each space's documents in the module's storage, scope `space`. The user's view is [userguide-documents](../userguides/userguide-documents.md). Version 0.6.1. Written from the code; the module's tests were not rerun for this document.

## Files

`src/documents-lib-*.js` hold the rules and have no page and no host, so another module can reuse them: `a-records` (cleaning the stored records), `b-chunks` (splitting and joining the text), `c-lock` (the lock rules), `d-reader` (Markdown to a plain description, then to DOM), `e-export`, `f-format` (the formatting bar's text changes), `g-save` (the save pace), `h-view` (zoom and list views), `i-tags` and `j-resync`. `documents-lib-0-marked.js` is the vendored Markdown lexer. `documents.js` is the page; `documents.html` and `documents.css` are its markup and styles. The tests are `test/` and `tools/check-documents-lib.mjs`.

## Stored keys

| Key | Holds |
|---|---|
| `doc:<id>` | The small record: `title` (up to 120), `rev`, `chunks`, `size`, `excerpt`, `preview`, `paper` (the page colour id), who made and last edited it. |
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

## Safety and licences

The Markdown reader builds DOM from a plain description and sets text with `textContent`; it never sets HTML from a document. Links are limited to `http`, `https`, `mailto` and `object`. The vendored library is marked 18.2.0 (MIT), used for lexing only; `modules/documents/THIRD-PARTY.md` lists each vendored piece with its licence and source, and `vendor/LICENSE.marked` is the licence file. The plan's rules bind every vendored library: only MIT, Apache-2.0, BSD, ISC or MPL-2.0, no outside service, no CDN, no telemetry. The licence, hash and outside-URL checks named in the plan are not built yet.
