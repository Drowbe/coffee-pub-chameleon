# Documents

**Audience:** members, moderators and owners who write shared notes in a space (session notes, handouts, lesson plans), and anyone who only reads them.

Documents holds written notes for a space. Each space has its own list. One person writes a document at a time, and everyone else reads it as it changes. It works only in a space. This guide was written from the code and the plans, not by using the module; the Documents module's versions 0.1.0 to 0.11.12 are covered.

**Who can:** set on the **Roles** tab under Documents ([Accounts, roles and permissions](userguide-accounts.md)):

- **See the documents** lists and reads them. It starts on for members, moderators and guests.
- **Write and change documents** makes, edits, renames and deletes them. It starts on for members and moderators and off for guests.

An owner always can do both. Tags follow the same rights: reading them needs the first, making one needs the second. Renaming, recolouring and deleting a tag is a separate right ([Spaces](userguide-spaces.md), "Set up").

## The list

Open Documents from the **Layout** menu, under **Show**. The list shows each document's title, a few words of its start, who last changed it and when.

- **View** switches between **List** and **Thumbnails** (a small picture of the page). A Paper document's tile shows a page of its size, with the text up to its first page break. Your choice is kept in your browser.
- **Search documents** in the toolbar narrows the list as you type. It does not match tag names yet ([known-issues](../known-issues.md)).
- **Tags** in the toolbar filters by tag; with several chosen, a document must have all of them.
- **New document** (the **+**) makes one. Titles are up to 120 characters.

## Read a document

Open a document from the list. It shows as a page, in the page colour chosen for it. **Back to the documents** (the arrow) returns to the list.

- **Zoom** in the title bar: **Zoom in**, **Zoom out** (the magnifier icons) and the **Zoom** menu with **Fit width**, **Actual size** and the levels 50, 75, 100, 125, 150 and 200 percent. **Fit width** is the usual. The same icons are in the title bar while you edit. On a Paper document, **Fit width** scales the page to the window, up to 200 percent.
- If someone else is editing, you see **<name> is editing** and the page changes as they save. You do not need to refresh.
- A document can hold headings, bold and italic, lists, checklists, quotes, code, links, tables and formulas. Links use only web addresses, email addresses and links to other objects. Nothing is loaded from outside the server.

## Write a document

1. Open the document and choose **Edit**. If someone else is already editing, **Edit** is off and the page says who. Try again when they are done.
2. Type. The formatting bar has **Bold**, **Italic**, **Code**, **Heading**, **Bulleted list**, **Numbered list**, **Checklist**, **Quote**, **Link** and **Insert**. **Insert** (the plus) holds **Grid**, **Formula** and **Page break**. **Link** asks for the address in a small box, and an existing link can be edited or removed.
3. It saves itself about three seconds after you stop typing. Choose **Done** to finish and let the next person edit.

The edit bar has more at its right end: **Editor**, **Layout** and **Page**, described next.

### Markdown or Rich text

**Editor** switches between **Markdown** (the text with its marks, the usual) and **Rich text** (you see headings, bold and lists as you type, with the usual shortcuts such as Ctrl or Cmd with B and I). The text goes from one to the other as Markdown; what is not saved yet stays unsaved. The choice is yours, kept in your browser. A block that Markdown cannot keep exactly is saved as typed, and the editor says so: "This block has formatting Markdown cannot keep exactly; switch to Markdown to check."

In **Rich text**, grids are tables you edit in place. Press **Tab** in the last cell to add a row, up to 200 rows; a grid has at most 200 rows and 20 columns. While the cursor is in a grid, **Insert** shows the **Grid** group (rows, columns and alignment) first.

### Paper and Fluid

**Layout** is the document's own, for everyone: **Fluid** (the usual: one page the width of the window) or **Paper** (separate pages of a real size). With **Paper**, the **Page** button's menu has **Page colour...**, a **Page size** (**Letter** or **A4**, with a 1 inch margin) and **Page numbers**. Pages show the same in reading and in the Rich text editor, which adds space where a page ends. **Page break** starts a new page at that line.

- The Markdown box is one sheet: it is not split into pages while you type.
- In a window narrower than 60 percent of the page's width, a Paper document is drawn as Fluid until the window is wide again.
- A Paper document of more than 6000 blocks is drawn as one sheet, not paged.
- The page count in the editor and in reading can differ for very large grids: the editor does not split a grid between pages.

Good to know:

- **One editor at a time.** Editing holds a lock that your page renews every 10 seconds. If your page goes quiet for about 35 seconds, others can take over.
- **If someone else saved first,** you see "You stopped editing because someone else saved first. Your changes are kept here." and your text stays on the screen so you can copy it. **Close without saving?** asks before it is thrown away. If a save did not go, it says "Not saved. Try Done again."
- **Page colour.** **Page colour** (the palette) sets the document's paper for everyone: **Pure White** (the usual), **Creme**, **Light Grey**, **Light Blue**, **Slate**, **Dark Blue** or **Black**. These are fixed colours, the same in light and dark mode.
- **Rename** and **Delete** are in the menu of an open document.
- A document is at most about 150,000 characters.

## Tags

Choose **Tags** (the tag icon) on an open document to tick the tags it has, or type to find one or to create it with **Create "x"**. A document holds at most 8 tags. A tag name is up to 24 characters, lower case, with letters, digits and dashes. The tags are the space's shared list; the same ones are offered to every module that has tags. Tagging does not need the edit lock. Rename, recolour and delete tags in Set up ([Spaces](userguide-spaces.md)).

## Trash

**Delete** puts a document in the trash, after asking. Choose **Trash** in the toolbar (with a count) to see them. **Restore** brings one back; **Delete for good** removes it and its text. Anything that has been in the trash for a week is deleted for good the next time an editor opens the list. Only people who can write see the trash.

## If your connection drops

When the connection to the server drops and comes back, Documents reads the list again and catches up on what it missed. Read from code; not tried with a real dropped connection.

## What it does not do yet

Pictures in a document, links to other documents, export to Markdown and Print are planned, and so is writing together at the same time ([plan-documents-coediting](../plans/plan-documents-coediting.md): decided, not built).
