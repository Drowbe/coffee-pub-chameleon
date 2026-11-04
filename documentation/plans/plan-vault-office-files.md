# Vault Office Files Plan

**Audience:** Thomas decides which Office files the Vault takes, what it refuses, and how a person opens one. server-development
builds the types, the scan and the routes; experience-design builds how the files are drawn, the share sheet's note and
"Open in…"; quality-assurance reviews the scan as a security change; content-manager documents.

**Status:** draft, 2026-11-04, nothing built. GitHub #396. Thomas, in his words: "we need to support word and excel
files... at least for storage only. We can maybe include an "open in native app" if we can't do a viewer." This plan
adds to [plan-attachments-vault](plan-attachments-vault.md); that plan stays the contract for everything not said here.
The six questions at the end are Thomas's; until he answers, the contract below is written to the suggestions, and
each place that depends on an answer names the question.

## What it is today

Read as code only, 2026-11-04.

- **Types** (`server/vault-types.js`): the type is decided from the file's first bytes (`sniff`), then compared with the
  name and the type the browser sent (`claimRefusal`, `mismatch`). Office files and archives of any kind are refused
  with "That kind of file can't be added here. It takes pictures (JPEG, PNG, WebP, GIF), audio (MP3, OGG, WAV, M4A),
  video (MP4, WebM, MOV), PDF and Markdown." (`libraryKindSentence`, `server/index.js`). A `.docx` is a zip, so it is
  refused before the scan ever sees it.
- **The scan** (`server/vault-scan.js`, `server/vault-scan-worker.js`): every whole-file check runs in a worker with a
  clock (`VAULT_SCAN_SECONDS`, 5) and a memory limit (256 MB). A PDF goes to `server/pdf-scan.js`: what it positively
  finds (scripts, launches, embedded files, `file:` links) is refused with a sentence; what it cannot judge (encrypted,
  a filter it cannot decode, over its budget or its clock) is kept with `viewable: false` (decision 18).
- **Download only** (`server/index.js` `sendLibraryFile`, `server/vault-share.js`): a `viewable: false` file answers its
  inline content route with 404 and is sent only with `?download=1`, to someone with `download`. Every file is sent with
  `nosniff`, `Content-Security-Policy: sandbox; default-src 'none'` and, for PDFs, always `attachment`.
- **How it is drawn** (`public/file-viewer-views.js`, `public/file-viewer.js`): `fileView` shows `downloadOnlyView` for
  `viewable: false`: "This PDF can't be opened here. Download it." with **Download**, or "...and your role can't
  download it." The toolbar hides Download and Full screen for such a file. The Info panel shows the name, "Type:
  <kind> · <MIME type>", size, who added it, when, and Where it is used.
- **Kinds are guessed from the group.** `kindOf` in `public/file-viewer-views.js` and its copy in
  `modules/vault/src/vault.js` call every `document` that is not a PDF "Markdown". A new document type must change both,
  or a Word file would show as Markdown.
- **The chooser** (`modules/vault/src/vault.html`) offers only the accepted extensions in `accept=`.
- **Share links** (`server/vault-share.js`, `public/shared.js`, `public/share-sheet.js`): the server refuses
  `?download=1` on a view-only link. On a view-only link a download-only PDF shows "This PDF can't be opened here. The
  person who shared it has not allowed downloads." and nothing else. The sheet already says "Without download, people
  can still save what they see on screen, and a PDF can be downloaded."
- **A zip reader is already a dependency:** `yauzl` (`server/modules.js`, module installs), which refuses absolute
  paths, `..` and backslashes in names.

## The formats

| Kind | Extensions | Recognised by | Per file | First build |
|---|---|---|---|---|
| Word | docx | a zip (`PK 03 04` at byte 0) whose `[Content_Types].xml` names the main part as `wordprocessingml.document.main+xml` | 50 MB | yes |
| Excel | xlsx | the same, main part `spreadsheetml.sheet.main+xml` | 50 MB | yes |
| CSV | csv, tsv | text with no NUL and no control characters but tab, CR and LF, and a `.csv` or `.tsv` name | 10 MB | question 1 |
| PowerPoint | pptx | the same as Word, main part `presentationml.presentation.main+xml` | 100 MB | question 1 |
| Older Word and Excel | doc, xls | an OLE2 compound file (`D0 CF 11 E0 A1 B1 1A E1`) whose directory holds a `WordDocument` or `Workbook` stream | 50 MB | question 2 |
| With macros | docm, xlsm, xlsb, dotm, xltm, and any file holding `vbaProject.bin` | the main part's content type, or the part itself | | refused (question 3) |

- **Templates** (`.dotx`, `.xltx`) are left out: nobody needs them in a trip's files, and they are the format remote
  template attacks use.
- **Refused, as today:** zips, `.rtf` (it can carry embedded objects), OpenDocument (`.odt`, `.ods`; it could come
  later, it is a zip with a `mimetype` entry), Pages and Numbers, and any OLE2 file that is not Word or Excel (an
  installer, `.msi`, is OLE2 too).
- **The group** is `document`, so the Vault's Type filter (Documents), `host.files.pick({ groups: ['document'] })` and
  the Planner's attachments take them with no change.
- **Claims:** browsers send the OOXML types, `application/zip` or nothing for these files, and Windows sends a `.csv` as
  `application/vnd.ms-excel`. Each is added to the type's `claims` so a real file is not refused as a mismatch.
- **The chooser's `accept=`** gains the new extensions.

## The scan

It runs in the existing worker, with the same clock and memory limit, and never on the main thread. It reads the zip's
central directory from the part file and inflates only the small XML parts it must read, never the whole file. The
builder may use `yauzl` from the file (not from a buffer) or a small reader of its own; QA reviews either.

### The zip itself (Word, Excel, PowerPoint)

Refused as "That file is built in a way we can't check, so it can't be added." when any of these hold:

- The first local header is not at byte 0, or bytes sit between the entries and the central directory (a file that is
  a zip and something else).
- More than 5,000 entries; a name over 255 bytes; a name with `..`, a leading `/`, a backslash, a drive letter, a NUL
  or a control character; two entries whose names match when compared without case.
- An entry with the encryption flag; a compression method other than stored or deflate.
- Declared sizes over 1 GB uncompressed in total, or an entry over 10 MB that declares more than 100 times its
  compressed size (a zip bomb aimed at the reader who downloads it).
- A part it reads inflates past 16 MB, or past 64 MB for all the parts it reads together (the PDF scan's numbers). The
  inflate is cut off at the limit, not after.
- An XML part it reads holds `<!DOCTYPE` or `<!ENTITY` (Office never writes them; they are how XML expands itself or
  reads local files). The XML is read with a tokenizer that never expands an entity.
- No `[Content_Types].xml`, no `_rels/.rels`, or a main part that is missing or does not match the extension: "That
  file is damaged or cut short." (the existing sentence).

### What the file holds

What is read: `[Content_Types].xml`, every `.rels` file, and for Word the main document, headers, footers, footnotes
and endnotes (for fields). Pictures, fonts and the cells' values are never read.

| Found | Answer | Sentence |
|---|---|---|
| `vbaProject.bin`, a `vbaProject` or `vbaData` content type, a macro-enabled main part, Excel 4 macro sheets (`xl/macrosheets/`) | refused | "That file holds macros, so it can't be added. Save it as .docx or .xlsx and add it again." |
| ActiveX controls (`activeX/` parts or content types), OLE objects (`oleObject` relationships, `.bin` parts under `embeddings/`) | refused | "That file holds programs or controls, so it can't be added." |
| Another Office file or package under `embeddings/` | refused | "That file holds files of its own, so it can't be added." |
| A relationship with `TargetMode="External"` that is not a hyperlink: an attached template, a frame, a sub-document, linked media, an OLE link | refused | "That file opens a file from elsewhere, so it can't be added." |
| A hyperlink relationship to anything but `http`, `https` or `mailto` (`file:`, a `\\server` path, `ms-msdt:` and the like) | refused | the same |
| Excel external links (`xl/externalLinks/`, which is also how DDE is kept), data connections (`connections.xml`), query tables | refused | the same |
| A Word field `DDE` or `DDEAUTO`; `INCLUDETEXT`, `INCLUDEPICTURE` or `LINK` whose target is not `http` or `https` | refused | the same |
| Web and email links, `INCLUDEPICTURE` from a web address (common in text pasted from a web page), comments, tracked changes, pictures | kept | |

Follows the PDF rule (decision 16): web and email links are taken; what runs, opens something local or fetches a file
to act on is not.

### What the scan cannot judge (follows decision 18)

- **A password-protected `.docx` or `.xlsx`** is not a zip at all: Office saves it as an OLE2 file with
  `EncryptionInfo` and `EncryptedPackage` streams. The scan reads the OLE2 directory (a few kilobytes, bounded) to tell
  it from an older Word or Excel file and from an installer. A protected Office file is kept as **download only, not
  checked**, as an encrypted PDF is, if its name says docx or xlsx.
- **The clock or the memory runs out:** download only, not checked, as for a PDF.
- The record keeps `viewable: false` for every file the app does not show, and gains `checked: false` for one the scan
  could not judge, so the window can say which. The existing download-only PDFs get `checked: false` too.

### Older Word and Excel (question 2)

The suggestion is to refuse them: "Older Word and Excel files (.doc, .xls) can't be added here. Save it as .docx or
.xlsx and add it again." They are where most Office malware has lived, and checking them for macros means reading the
OLE2 file's streams, not only its directory. If Thomas keeps them, the scan reads the OLE2 directory, refuses one with a
`Macros` or `_VBA_PROJECT_CUR` storage, an `ObjectPool` (embedded objects) or anything that is not Word or Excel, and
keeps the rest as download only, not checked.

### CSV (question 1)

- Read in full in the worker (at most 10 MB). Excel saves CSV in the computer's own encoding, not always UTF-8, so any
  encoding is taken; the bytes are kept as sent.
- **Formulas are refused:** a cell that starts with `=`, `+`, `-` or `@` and holds a `(` or a `|` is how a formula or a
  DDE call is written in a CSV, and Excel runs it on open. "That CSV holds formulas, so it can't be added." A number such
  as `-12.5` passes.

### The sentence for a kind not taken

`libraryKindSentence` names the new kinds: "That kind of file can't be added here. It takes pictures (JPEG, PNG, WebP,
GIF), audio (MP3, OGG, WAV, M4A), video (MP4, WebM, MOV), PDF, Markdown, Word, Excel and CSV." (adjusted to question 1).

## Storage only: how the file is drawn

- **Serving:** the stored OOXML type (`text/csv` for CSV), always `attachment`, with every header the Vault already
  sends. The inline content route answers 404, as for a download-only PDF. Nothing in the app opens the bytes.
- **Kinds:** `kindOf` and the `KINDS` table, in `public/file-viewer-views.js` and in `modules/vault/src/vault.js`, learn
  `word` (icon `file-word`, tint `blue`, word "Word"), `sheet` (`file-excel`, `green`, "Excel"), `csv` (`file-csv`,
  `green`, "CSV") and, with question 1, `slides` (`file-powerpoint`, `orange`, "PowerPoint"). An unknown type must fall
  to a plain file kind (`file`, "File"), never to Markdown. Icons go through `tools/check-icons.mjs`.
- **List and grid:** the type tile, no thumbnail (none is made, as for PDF), "Word · 240 KB" in the row.
- **The window:** the download-only state, worded per kind:
  - "Word files can't be opened here. Download it to open it in Word." with **Download** (and **Open in…** on a phone,
    question 5). Excel, CSV and PowerPoint read the same with their own word and app ("Excel or another spreadsheet app"
    for CSV).
  - Not checked: "This file has a password, so it couldn't be checked. It is kept for download only." with **Download**.
  - Without `download`: "Word files can't be opened here, and your role can't download them."
- **The toolbar** has **Download** where allowed, **Info**, Share where allowed; Full screen is hidden, as for a
  download-only PDF.
- **Info:** as today, with the type as "Word document" instead of the long MIME type, and "Not checked" for a file the
  scan could not judge.
- **Search** finds a file by its name and its kind word ("excel"), as today. The text inside is not searched.
- **Where it is used, linking from the Planner, "File removed":** unchanged; a linked Word file opens the same window.
- **The AI and summaries** see the name only, as for every file.

## Share links

A file the app can't show is of no use on a view-only link: the person outside sees its name and nothing else. Question 4.

- **Suggested:** no server change. The share sheet adds a line when the chosen files include one and Allow download is
  off: "Word and Excel files can't be opened on the link. Turn on Allow download, or people see only their names." The
  public page shows such a file with "This file can't be opened here. The person who shared it has not allowed
  downloads.", as it does for a download-only PDF today, worded for the kind.
- With download on, the page's file shows **Download** (and **Open in…** on a phone, question 5).

## "Open in native app"

What a browser can do, from a page behind a sign-in:

1. **Download, then open.** Works everywhere. On a computer the file lands in Downloads and opens in Word or Excel with
   a click; on an iPhone Safari offers it to Files and from there to Word, Excel or Numbers; Android opens it from the
   download notice. Office opens a downloaded file in Protected View, which is what it should do.
2. **"Open in…" on a phone, through the share sheet.** The page fetches the bytes with the person's session and hands
   them to `navigator.share({ files })`; the phone's own sheet then offers Word, Excel, Numbers, Mail. One tap fewer
   than downloading. It must run on the host page (the module frame is sandboxed; the viewer window is the host's),
   needs a tap, and needs `download` (it is a download). Safari takes Office files; Chrome on Android keeps a list of the
   types it will share and may refuse them, so the button shows only where `navigator.canShare({ files })` says yes. To
   be confirmed on Thomas's phones.
3. **Office's own links** (`ms-word:ofv|u|<address>`, `ms-excel:ofv|u|<address>`). The browser hands an address to the
   installed Office app, which fetches the file itself. That is why it often can't work here:
   - **Office has no session.** It does not carry the browser's cookie, so the address must open without signing in:
     a new public route with a short-lived token for one file, a small share link. Office fetches more than once
     (`OPTIONS`, `HEAD`, then `GET`, and again from its recent files list), so the token can't be single use; it would
     last a few minutes and then fail, and it sits in Office's recent list meanwhile.
   - **Office must reach the server.** A server on a home network, behind a VPN, or behind a proxy that asks for its
     own sign-in (Cloudflare Access, basic auth) is out of Office's reach even when the browser is in.
   - **The app must be installed**, and the browser can't tell whether it is: with no Office, the click does nothing or
     shows an error.
   - **It opens a read-only copy.** Edits stay on the person's computer; the Vault's file is not changed, which a person
     may not expect from "Open in Word".
   - It is a new public route, so it needs its own security review, and an environment variable to turn it on.
4. **Office for the web or Google's viewer** (sending the file's address to Microsoft or Google to draw): ruled out. It
   needs a public address, and it hands a trip's files to a third party.

**Suggestion (question 5):** 1 now, labelled plainly ("Download it to open it in Word."), and 2 on phones in the same
build. Not 3: it needs a public, unauthenticated address for a private file, and for most self-hosted installs it would
not work. If Thomas wants it later, it is its own plan.

## A viewer, later

Read-only drawing in the app, in a sandboxed frame like the PDF viewer (`sandbox="allow-scripts"`, a null origin, a CSP
of `default-src 'none'`, no network, the bytes handed in by `postMessage`), the library vendored under `public/sdk/` with
its licence and its hash pinned by a check, as pdf.js is (`tools/check-pdf-viewer.mjs`).

| Kind | Library | What it shows | Effort | Risk |
|---|---|---|---|---|
| CSV | none: split in the page, drawn with `textContent` | a plain table, the first 1,000 rows, a note when cut | S | small; text only |
| Excel | SheetJS community build (Apache 2.0, distributed from its own site, not npm) | each sheet as a read-only table of values, sheet tabs, the first 1,000 rows and 100 columns; no charts, no formatting | M | a large parser in the frame; values only, never formulas run |
| Word | mammoth (BSD 2) | the text: headings, paragraphs, lists, tables, pictures; no layout, headers or comments | M | its HTML must be cleaned to a small set of tags; pictures need `img-src blob:` in the frame's CSP |
| PowerPoint | none worth shipping | | | |

- The server's scan already bounds what reaches a viewer (entries, sizes, inflate), so a zip bomb cannot reach the
  frame; the frame's memory is the browser's.
- A file the viewer draws becomes `viewable`, so on a view-only link its bytes reach the page, as a PDF's do (the PDF
  rule of 2026-11-04 would then apply to it).

**Suggestion (question 6):** the CSV table in the first build (it is small and safe), and the Excel and Word viewers as
their own plan once storage has shipped and Thomas has seen how often people open these files. Excel first: budgets and
packing lists in spreadsheets are the likelier use on a trip.

## Left to build, in order

Each step can be built and checked on its own. Sizes are S, M, L. The Vault module gets a version bump.

| # | Step | Size | Agent | Kind |
|---|---|---|---|---|
| 1 | **Types and the scan.** The new types, claims and limits in `server/vault-types.js`; the zip and OOXML scan and the OLE2 directory read in a new `server/office-scan.js`, run by `server/vault-scan-worker.js`; the CSV rule; `checked: false`; the sentences; attachment-only serving; the kind sentence. `tools/check-vault.mjs` gains the cases under Verify | L | server-development | feedback build with a QA security review |
| 2 | **Drawn as storage only.** The kinds in both `KINDS` tables and the fallback kind; tiles, rows, the window's states and toolbar, Info; `accept=`; the Vault module's version bump | S | experience-design | try build |
| 3 | **Share links.** The sheet's line and the public page's words | S | experience-design | try build |
| 4 | **"Open in…" on phones** (question 5), on the viewer window and the public page | S | experience-design | try build, then Thomas on his phones |
| 5 | **The CSV table** (question 6) | S | experience-design | try build |
| 6 | **Security review** of step 1 with a corpus of crafted files (under Verify) | M | quality-assurance | before step 1 is called done |
| 7 | **Documentation:** the Vault user guide (what is taken, what is refused and why, download only), api-modules (types), the CHANGELOG | S | content-manager | after each step |

Then, each its own plan: the Excel and Word viewers; Office's own links, if wanted.

## Verify

- **Checked by a tool** (`tools/check-vault.mjs`, a throwaway server): a real `.docx`, `.xlsx` and `.csv` taken with
  their type and `viewable: false`; a `.docx` renamed `.xlsx` refused as a mismatch; a `.docm` renamed `.docx`, and a
  `.docx` with a `vbaProject.bin` added, refused for macros; an external `oleObject` relationship to an `.html` (the
  2022 Follina shape), an external attached template, a `DDEAUTO` field, an `INCLUDEPICTURE` from `\\server\x`, an
  `.xlsx` with an external link (DDE), each refused; an `INCLUDEPICTURE` from `https://` taken; a zip with data before
  it, `../` and duplicate names, 5,001 entries, an encrypted entry, a part that inflates past 16 MB, an XML part with
  `<!DOCTYPE`, each refused; a password-protected `.docx` kept as download only with `checked: false`; an `.msi` and a
  `.doc` renamed `.docx` refused; a CSV with `=cmd|' /C calc'!A0` refused and one with `-12.5` taken; the inline route
  404 and the download route `attachment` for each; the scan's clock and memory still holding with a large `.xlsx`.
- **The corpus** for QA is built by the check from bytes it writes itself, so no real malware sits in the repository.
- **Verified live in a browser on a local server:** adding each kind, the tile and row, the window's states, Info,
  Download, a linked Word file from the Planner, a view-only share link holding an Excel file and its sheet line, the
  CSV table with planted HTML showing as text.
- **Only Thomas can verify:** a downloaded file opening in Word and Excel on his computer, "Open in…" on his iPhone and
  an Android phone, and files from his own Office (which may hold things the corpus does not).
- No LiveKit call is needed for any of it.

## Risks

- **Downloaded files run on people's computers.** The scan refuses what it knows is active; it is not a virus scanner
  and does not claim to be. Office's Protected View is the second guard, as a person's PDF reader is for PDFs.
- **Real files will be refused.** Business documents often carry macros or links to other workbooks; the sentence says
  what to do.
- **Two copies of `KINDS`** (the Vault module and the file viewer) can drift; step 2 should make the module read the
  viewer's table through the SDK if that is cheap.

## Questions for Thomas

1. **Which formats in the first build?**
   A) Word and Excel only (`.docx`, `.xlsx`).
   B) Word, Excel and CSV (`.docx`, `.xlsx`, `.csv`, `.tsv`). *(suggested: CSV is what spreadsheets export, and it is text)*
   C) B, plus PowerPoint (`.pptx`).
2. **Older Word and Excel files (`.doc`, `.xls`)?**
   A) Refused, with "Save it as .docx or .xlsx and add it again." *(suggested: they are where most Office malware lives)*
   B) Kept as download only, after a check that they are Word or Excel and hold no macros or embedded objects.
3. **Files with macros (`.docm`, `.xlsm`, `.xlsb`, or any file holding macros)?**
   A) Refused, like a PDF with a script. *(suggested)*
   B) Kept as download only, with "This file holds macros. Open it only if you trust who added it."
4. **A share link without download that holds a Word or Excel file?**
   A) Allowed; the sheet warns that people will see only the name. *(suggested: no change to what the server allows)*
   B) Those files can always be downloaded from a link, said on the sheet, as PDFs are.
   C) The sheet won't make a view-only link that holds them.
5. **"Open in native app"?**
   A) Download only, with the sentence "Download it to open it in Word."
   B) A, plus **Open in…** on phones through the phone's share sheet. *(suggested)*
   C) B, plus Office's own links on computers, which need a public address for the file that works without signing in
   (its own plan and security review).
6. **A viewer?**
   A) None for now; storage only.
   B) A plain table for CSV now; Excel, then Word, viewers as their own plan later. *(suggested)*
   C) Plan the Excel and Word viewers now, to build after storage.
