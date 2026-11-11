# Documents Paper Layout Plan: pages like Word or Google Docs

**Audience:** Thomas, who decides; experience-design (the pages, the reader, the editor); quality-assurance (the real-browser measurement read); the project manager (the queue); content-manager (the documents once it is built).

**Status:** Decided by the PM under Thomas's delegation, 2026-11-11: decisions 1 to 8 are Thomas's, as the project manager passed them on, and decisions 9 to 15 are the project manager's under his delegation; all open questions are closed. Nothing is built. One thing was run: the vendored `marked` lexer on six candidate break lines. The request, as the project manager passed it on: Documents should be like Word or Google Docs, with a layout for each document, **Paper** (US Letter pages) or **Fluid** (today's continuous sheet). Facts are marked **(code)** (read at `a70c7ab7`, Documents 0.9.1), **(run)** or **(memory)** (to confirm in the build). Builds on [plan-documents](plan-documents.md) and [plan-documents-rich-editor](plan-documents-rich-editor.md).

## What it is today

- **One continuous sheet,** 48rem wide at a zoom level, scaled with CSS `zoom`. At Fit width the sheet fills the window (up to 120rem) and the text is not scaled **(code, `documents.css`, `documents-lib-h-view.js`)**.
- **The page colour** is `paper` in `doc:<id>`. It is changed only while editing and written by the commit with `rev + 1` (`dlPlanSave`, `dlIsDirty`). Tags sit in their own record so tagging never collides with an edit **(code)**.
- **`size` is already a field of `doc:<id>`:** the number of characters of text **(code)**.
- **A rule** is `{ t: 'rule' }` in the reader and one `horizontal_rule` node, with no fields, in the rich editor **(code)**. Grids (step 7) and maths (step 10) are not in the rich editor yet.
- **A thumbnail** shows the first 400 characters (`preview`); the list never loads a text **(code)**.
- **Print and export are not wired** in the page **(code)**. The font (Figtree) is served by the product. The module's window is 560 px wide by default **(code, `module.json`)**.

## Decisions

Thomas, 2026-11-11, as the project manager passed them on.

1. **A layout for each document: Paper or Fluid.** Fluid is today's sheet. *Reason:* like Word or Google Docs.
2. **US Letter by default; A4 is a choice for each document.**
3. **Page breaks are automatic, and a person can add a manual page break.**
4. **Only manual breaks are stored,** in the Markdown, as a rule line of its own: kept exactly by the rich editor, a break in the reader, harmless in other Markdown viewers. Automatic breaks are display only, worked out from the drawn height. *Reason:* Markdown stays the stored form.
5. **Now:** 1 inch margins and an optional page number at the bottom. **Later, with Print and PDF export:** headers and footers.
6. **The Layout switch is the shared `host.ui.viewSwitch`** (Fluid, Paper), as the List and Thumbnails chooser is.
7. **The choice is stored in the document's record, like the page colour, and every reader sees the same layout.**
8. **Zoom and Fit width keep working.** Paper at Fit width scales the page to the window's width.

Decisions 9 to 15 were made by the project manager under Thomas's delegation, 2026-11-11.

9. **Option A: one text, with pages drawn around it** by a measured break function, with decorations in the editor. *Reason:* untouched blocks stay stored exactly (the rich editor plan, decisions 12 and 22).
10. **Whole blocks move to the next page in the first build.** A split inside a paragraph, at a line, comes later.
11. **Narrow windows:** Fit width scales the page down to 60%; below that a Paper document is drawn as Fluid, with manual breaks shown as a dashed line.
12. **The page size's field is `pageSize`,** not `size`, which already means the text's length. **The layout fields change only in Edit,** on the page colour's path (the commit of the person holding the lock).
13. **The manual break is its own `page_break` node, spelled `_ _ _` in the Markdown.** It is kept exactly by the rich editor and reads as a rule in any other Markdown tool.
14. **A new document starts as Fluid.**
15. **The order:** step 6b of the rich editor plan (Link and the mode switch), the 0.9.3 gutter fix, steps 1 to 4 of this plan, step 7 of the rich editor plan (grids), step 5 of this plan, then the independent safety read. Steps 3 and 5 are built by the larger model at high effort (Fable), the rest by the smaller model (Sonnet). Each step's brief is sent to the project manager first.

**The numbers,** at 96 px to the inch: Letter is 816 by 1056 px, A4 is 794 by 1123 px, the margin is 96 px, so the text area is 624 by 864 px (Letter) or 602 by 931 px (A4). One constant (inches and millimetres, px derived) feeds the screen now and `@page` later.

## Options: how pages are drawn

Kept as the record of the choice; A was chosen (decision 9).

**A. One text, with pages drawn around it (chosen).** The document stays one flow: one `article` in reading, one ProseMirror text in editing. A pure function takes each block's drawn height and returns where the breaks fall. The page draws a stack of fixed-size sheets behind the text and pushes the first block of each page down past the margins and the gap. In the editor the push is a decoration (a class and a style on the block): not in the document, not in undo, not in the Markdown **(memory)**. CSS alone cannot do the split: columns flow sideways, not down a stack of pages **(memory)**.

- *Costs:* a measuring pass after each change. Breaks fall only between blocks, a list's rows and a grid's rows, so a paragraph that does not fit moves whole and leaves a blank area (Word and Docs split at a line); this is accepted for the first build (decision 10). A paragraph, code block or formula taller than a page runs across the gap; nothing is hidden. A grid's header row is not repeated. In print the browser breaks the pages, so screen and print can differ by a few lines.
- *Keeps:* the stored-form rules, the caret, selection, undo and input methods as they are.

**B. Real page blocks (not chosen).** The content is cut into one element for each page; a block on two pages is cut in two.

- *Gains:* a paragraph splits at a line; each page is a real element, which headers and footers would use; the screen can match print.
- *Costs:* in the editor, pages become nodes of the document, or there is one editor for each page. Page nodes are rebuilt as a person types, which fights undo and input methods, and a paragraph cut in two is two nodes for one stored block, which breaks "untouched blocks are stored exactly" (the rich editor plan, decisions 12 and 22). One editor for each page cannot hold a selection across a break. B in reading only would make reading and editing break in different places.

## The contract (on option A, decision 9)

- **The record.** `doc:<id>` gains `layout` (`fluid` or `paper`; missing reads as `fluid`), `pageSize` (`letter` or `a4`; missing reads as `letter`) and `pageNumbers` (default false), cleaned in `dlCleanDoc`. A new document is written with `layout: 'fluid'` (decision 14). The existing `size` keeps its meaning, the text's length (decision 12). No server or manifest change.
- **Saving** (decision 12). A layout change is a record change, not text, and takes the page colour's path: made while editing by the lock's holder, written by the commit under the version read; a 409 is the usual lost-lock path. It cannot take the tags' path: any other write to `doc:<id>` turns the editor's next commit into a 409. So editors change it, in Edit; readers see it.
- **The bar.** The Layout switch sits beside the mode switch (the rich editor plan, decision 29). Page size and Page numbers go in a menu (the lean: the Page colour menu, renamed Page). The builder counts the bar against the 16-entry limit.
- **Reading.** Measured after the font has loaded and formulas are drawn, and again when the width, zoom or text changes.
- **The rich editor.** The caret, arrow keys and a selection across a break behave as in one text. When a block at the foot of a page no longer fits, it moves whole to the next page at the next measure and the caret goes with it (decision 10). Measuring waits for a pause in typing and never runs during composition. A text is at most 150,000 characters, about 50 pages; the step measures a long document (100 pages by manual breaks) and reports the cost.
- **The Markdown box is not paged:** one continuous sheet, the break shown as its line. Until step 5 lands, the rich editor is the same.
- **The manual break** (decision 13). A top-level rule line spelled exactly `_ _ _`. `marked` reads it as a rule; `\newpage` and `=====` read as words **(run)**. It draws as a rule in other viewers, the editor never writes it for an ordinary rule (it writes `---`), and underscores cannot be read as a list or a heading underline. An ordinary rule a person wrote as `_ _ _` becomes a page break. The reader makes it `{ t: 'pagebreak' }`: a new page in Paper, a dashed line in Fluid; inside a list or quote it stays a rule. The rich editor has its own `page_break` node, written back as the same line. It does not share `horizontal_rule`: kept blocks are matched by `Node.eq`, so a new rule typed before a kept break would take its stored line (read as code, not run). Both bars get a Page break entry.
- **Grids** break between rows; a wide grid scrolls sideways as today. **Code blocks** and **block formulas** stay whole. **Images,** later, stay whole too.
- **The page number.** Off or on for each document; bottom centre, in the bottom margin; the number alone, from 1 on the first page.
- **Zoom.** A level scales the page (100% is 816 px for Letter). Fit width scales it to the window, up to 200%. Measuring is in unscaled px.
- **Narrow windows and phones** (decision 11). Fit width scales the page down to 60% (a window of about 490 px for Letter); below that a Paper document is drawn as Fluid, with manual breaks as the dashed line. A zoom level still shows real pages, scrolling sideways. The module's default window (560 px) shows a Letter page at about 69%.
- **Thumbnails.** The page's shape and scaled margins, the top of the first page, stopping at a manual break. Only 400 characters are in the record, so not a whole page.
- **Colours.** Each sheet wears the document's page colour in both themes; the gap is `--surface-page`.
- **Unchanged:** search, excerpts and `preview` (a break adds no words), the Markdown export, the lock, the chunks.
- **Accessibility.** One text, same order, same headings. Sheets, gaps and page numbers are hidden from a screen reader; a manual break is a separator named "Page break".
- **Print, later.** `@page { size: 8.5in 11in; margin: 1in }` (A4: `210mm 297mm`) from the same constant, and a manual break as `break-after: page`.

## Left to build, in order

Each is a small PR with a version bump, and each step's brief is sent to the project manager first (decision 15). The larger model at high effort (Fable) builds steps 3 and 5 only; the smaller model (Sonnet) builds the rest.

1. **The record and the switch** (small; Sonnet): `layout`, `pageSize` and `pageNumbers`, the save path, the Layout switch and the menu; Paper drawn as one unpaged sheet of the page's width with its margins.
2. **The manual break** (small to medium; Sonnet, with the corpus run): `_ _ _` in the reader, the `page_break` node, its parse and write, the bar entries.
3. **Pages in reading** (medium to large; Fable, high): the break function, the sheets, the page number, Fit width, the real-browser check.
4. **Thumbnails, narrow windows, both themes** (small; Sonnet).
5. **Pages in the rich editor** (large; Fable, high): the decorations, typing at a boundary, composition, a long document. Built after grids; it joins the independent safety read.
6. **Later, with Print and PDF export:** `@page`, headers and footers, the line-level split (decision 10).

**Where it goes in the queue** (decision 15):

1. Step 6b of the rich editor plan: Link and the mode switch.
2. The 0.9.3 gutter fix.
3. Steps 1 to 4 of this plan: the record fields and the Layout switch, the manual break, pages in reading, then thumbnails and narrow windows.
4. Step 7 of the rich editor plan: grids.
5. Step 5 of this plan: pages in the rich editor.
6. The independent safety read (step 8 of the rich editor plan).

*Reasons:* steps 1 to 4 touch the record, the reader and one leaf node, none of which grids change, and give Thomas pages in reading soonest. Step 5 is easier after grids: a grid's rows are the hardest break in the editor and the grid's drawn shape is not settled until step 7, so paging the editor first would mean opening it again. Grids are not made harder by waiting, since step 3 already breaks the reader's grids by row. Between steps 4 and 5 the rich editor shows a Paper document unpaged, as the Markdown box does.

## Verify

Nothing is verified yet. None of this needs a LiveKit call.

- **Checked by a tool:** record cleaning; the break function in Node; the marker through the reader and the rich editor's corpus (kept exactly, a rule typed beside a break); `npm run check`; `npm run check:docs`.
- **In a real browser, required for steps 3 and 5:** a fixed document in Chrome here, asserting that every block lies inside a page's text area, the page count, and a manual break starting a page, at 50%, 100%, 200% and Fit width, in both sizes.
- **Not verifiable here:** Safari, an iPad, a phone, a real input method; Firefox unless run by hand. Every report says "not verified on Safari/phone" until Thomas has tested by hand.

## Risks

- **Automatic breaks are not the same for everyone.** Browsers lay text out slightly differently, so a page can start a line or a block apart on two machines. Only manual breaks are certain.
- **Measuring under CSS `zoom`** differs between browsers **(memory)**.
- **A jump while typing** when a block moves to the next page.
- **Blank areas at the foot of a page,** where a whole block moved on (decision 10), until the line-level split is built.

## Open questions

None. The seven questions of the draft are answered by decisions 9 to 15: A or B (9), whole blocks moving to the next page (10), narrow windows (11), the field name (12), the break's spelling (13), what a new document starts as (14) and the queue (15).

## Not decided

The kind of build for each step; the words and icons; where Page size and Page numbers sit (the lean: the Page colour menu, renamed Page); a key for Page break (Ctrl or Cmd with Enter, as Word and Docs); "Page 1 of 3", another starting number and skipping the first page (the lean: with headers and footers); whether the record's `paper` (the colour) is renamed now that `paper` is also a layout value.
