# Vault

**Audience:** members, moderators and owners who keep a space's files (photos, audio, video, PDFs and notes) in one place, and anyone who opens them.

The Vault holds the files of a space: tickets and confirmations as PDFs, photos, a voice note, a clip, a Markdown note. Everyone in the space sees the same files. In the Travel template the Vault is called Documents, and in the Games template it is called Handouts; the steps are the same. This guide is about the Vault as it is built so far. Linking a file from another tool, and sharing a file with people outside the space, are not built yet and are not described here.

**Who can:** a member or a moderator can see, add and download files, and an owner always can. A guest never can: a guest sees no Vault, and the Roles tab cannot turn it on for guests. What each role may do is set on the **Roles** tab under the Vault ([Accounts, roles and permissions](userguide-accounts.md)):

- **See the space's files** shows the list and opens a file.
- **Add files** adds files and renames and removes the ones you added.
- **Download files** saves a file to your computer.
- **Remove files other people added** removes or renames any file. It starts on for moderators and off for members.

## Open the Vault

The Vault is a module like the others: open it from the **Layout** menu, under **Show**, and it opens on the canvas. If you are not in a space the Vault asks you to open it in one. Without the right to see the files it says "You can't see the files in this space." and names who to ask.

## See the files

The Vault shows the space's files as a **List** or a **Grid**; choose either at the left of the toolbar. Your choice is remembered for you. Each file shows its name, a small picture where it has one (pictures and videos), what it is, its size, who added it and when. A file other tools link to is marked with how many places link to it. A long list shows the first files and a **Show more** button for the rest.

The line at the bottom says how many files there are and how much of the space's room they use ("42 files · 1.2 GB of 5 GB"). It says **Almost full** from four fifths and **Full** when no more fit.

## Find a file

1. Type in **Search files** to find files by name. The matching letters are marked.
2. Choose **Filters** to narrow the list. **Sort by** gives Newest first, Oldest first, Name, A to Z, and Largest first. **Type** keeps Pictures, Audio, Video or Documents. **Added by** keeps Everyone's, Mine, or one person's. **Linked** keeps files that are linked from other tools, or files that are not.
3. When nothing matches, the Vault says "No files match." and offers **Clear filters**.

The Vault checks for new files every 15 seconds, so a file someone else adds appears without reloading, though not at once.

## Add files

1. Choose the **+** in the Vault's title bar (**Add files**), or drag files onto the Vault anywhere. In an empty Vault there is also an **Add files** button.
2. Drop the files in the area, or choose **Choose files**. You can add several; they go one after another, each with a bar that shows how far it has got. **Try again** repeats one that failed, and the cross beside a file stops it or clears it from the list.
3. Optionally tick **Remove where it was taken** before you add pictures. It is off by default, so a picture keeps the place it was taken; tick it to take that place out of the picture. Your choice is remembered, for you only. Videos keep their details, which can include where they were taken, and the Vault says so.

What it takes: pictures (JPEG, PNG, WebP and GIF, up to 25 MB), audio (MP3, OGG, WAV and M4A, up to 200 MB), video (MP4, WebM and MOV, up to 2 GB), PDF (up to 100 MB) and Markdown (up to 1 MB). The Vault looks inside each file, not at its name, so a file whose name says one thing and whose contents say another is refused. It refuses what it does not take, such as SVG, web pages, Office files and programs; HEIC pictures are refused with "Save it as a JPEG."

Everyone in the space can see what you add. There is no private file.

**Limits.** A space can hold a set amount and each person can add a set amount in all (an owner can lower either on the Vault's settings, **Most one space may hold, in GB** and **Most one person may add, in GB**, and the server has its own). When one is reached, the Vault says which and asks you to remove some files. It also asks you to wait when you have sent a lot in the last minute, or when other uploads are still running, and it cuts off an upload that stops moving for a minute.

**PDFs.** A PDF that holds scripts, links that open programs or files, a form that sends what is typed in it, or files of its own is refused, with the reason ("That PDF holds scripts, so it can't be added."). Links to web pages and fillable forms are fine. A PDF the Vault could not check, such as an encrypted one, is kept, but only for download: it shows **This PDF can't be opened here. Download it.**

## Rename or remove a file

Choose the **More** button on a file's row or card. You see **Open**, **Download**, **Rename**, **Where it is used** and **Remove**.

- **Rename** opens a small window. Keep the ending (such as `.pdf`) as it is; a name can be 120 characters.
- **Remove** asks first. It says where the file is used, and that the places that link to it will show "File removed". Removing a file takes it from the Vault for everyone in the space and cannot be undone.
- You can rename and remove files you added. Renaming or removing someone else's needs **Remove files other people added**.

## Select several files

Choose **Select** in the title bar to tick files. The toolbar then shows how many you chose, **Choose all** (or **Choose none**), **Download** and **Remove**, and **Done** leaves selecting. **Remove** is greyed out if you ticked a file you may not remove, and the status line says "Remove is only for files you added". Several downloads go one at a time, as your browser allows.

## Open a file

Choose a file (or **Open** in its menu). It opens in a window of its own over the canvas and over the Vault, not inside the Vault.

- **A picture** fits the window; zoom with the buttons, the wheel or a pinch, and drag to move it.
- **Audio and video** play with the browser's controls.
- **Markdown** is drawn as text. Anything in it that looks like a web page is shown as plain text, never run.
- **A PDF** opens in the Vault's own PDF viewer, with page buttons, a page number, **Fit width**, and **Search in the PDF**. The viewer runs apart from the rest of Collaborator and has no network, so a PDF cannot reach anything.
- **A download-only PDF** shows **This PDF can't be opened here. Download it.** with a **Download** button (or says your role can't download it).

You can have up to four windows open at once. Opening a file that already has a window brings that window forward. With four open, opening another says **Four windows are open**, "Close a window to open another."

Each window's bar has:

- **Previous** and **Next**, with "3 of 12", to walk the files in the order the Vault's list showed them. The left and right arrow keys do the same.
- **Info**, which shows the file's type, size, who added it and when, and **Where it is used**. A window that is very short has no Info.
- **Download**, **Full screen** (not on a download-only PDF) and, in the window's menu, **Rename**, **Where it is used**, **Close all** and **Remove**.

Close a window with its close button or **Esc**; focus goes back to where you opened it. **Close all** closes every file window. It is in each window's menu and in the **Layout** menu, under **Open files**, where the number open is shown. On a phone only one window shows at a time, as a full screen sheet, and opening another file replaces it.

## Clear does not apply

The Vault holds files, not module data, so the **Clear** that other modules have in their menu is not offered for it. Remove files from the Vault itself.

## Notes for the person running the server

The files' bytes are kept in a folder of their own (`VAULT_DIR`), not in the data folder, so the in-app backups do not carry them. See [Library modules: the Vault](../architecture/architecture-modules.md#library-modules-the-vault) for the folder, the limits and the settings.
