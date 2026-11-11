# Documents

**Audience:** members, moderators and owners who write shared notes in a space (session notes, handouts, lesson plans), and anyone who only reads them.

Documents holds written notes for a space. Each space has its own list. One person writes a document at a time, and everyone else reads it as it changes. It works only in a space. This guide was written from the code and the plan, not by using the module; the Documents module's versions 0.1.0 to 0.6.1 are covered.

**Who can:** set on the **Roles** tab under Documents ([Accounts, roles and permissions](userguide-accounts.md)):

- **See the documents** lists and reads them. It starts on for members, moderators and guests.
- **Write and change documents** makes, edits, renames and deletes them. It starts on for members and moderators and off for guests.

An owner always can do both. Tags follow the same rights: reading them needs the first, making one needs the second. Renaming, recolouring and deleting a tag is a separate right ([Spaces](userguide-spaces.md), "Set up").

## The list

Open Documents from the **Layout** menu, under **Show**. The list shows each document's title, a few words of its start, who last changed it and when.

- **View** switches between **List** and **Thumbnails** (a small picture of the page). Your choice is kept in your browser.
- **Search documents** in the toolbar narrows the list as you type. It does not match tag names yet ([known-issues](../known-issues.md)).
- **Tags** in the toolbar filters by tag; with several chosen, a document must have all of them.
- **New document** (the **+**) makes one. Titles are up to 120 characters.

## Read a document

Open a document from the list. It shows as a page, in the page colour chosen for it. **Back to the documents** (the arrow) returns to the list.

- **Zoom** in the title bar: **Zoom in**, **Zoom out**, **Fit width** and **Actual size** (50, 75, 100, 125, 150 and 200 percent). **Fit width** is the usual.
- If someone else is editing, you see **<name> is editing** and the page changes as they save. You do not need to refresh.
- A document can hold headings, bold and italic, lists, checklists, quotes, code, links, tables and formulas. Links use only web addresses, email addresses and links to other objects. Nothing is loaded from outside the server.

## Write a document

1. Open the document and choose **Edit**. If someone else is already editing, **Edit** is off and the page says who. Try again when they are done.
2. Type. The formatting bar has **Bold**, **Italic**, **Code**, **Heading**, **Bulleted list**, **Numbered list**, **Checklist**, **Quote**, **Link**, **Grid** (a table) and **Formula**.
3. It saves itself about three seconds after you stop typing. Choose **Done** to finish and let the next person edit.

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

Pictures in a document, links to other documents, export to Markdown and Print are planned, and so is writing together at the same time.
