# Vault

**Audience:** members, moderators and owners who keep a space's files (photos, audio, video, PDFs and notes) in one place, and anyone who opens them.

The Vault holds the files of a space: tickets and confirmations as PDFs, photos, a voice note, a clip, a Markdown note. Everyone in the space sees the same files. In the Travel template the Vault is called Documents, and in the Games template it is called Handouts; the steps are the same. Other tools, such as the Planner, can link to a file, and a file can be shared by a link with people outside the space.

**Nothing changes yet for who sees which file.** The server has the rule for letting only some people see a file, but the Vault has no screen for it, so everyone in the space still sees the same files. This guide will say more when the screens arrive.

**Who can:** a member or a moderator can see, add and download files, and an owner always can. A guest never can: a guest sees no Vault, and the Roles tab cannot turn it on for guests. What each role may do is set on the **Roles** tab under the Vault ([Accounts, roles and permissions](userguide-accounts.md)):

- **See the space's files** shows the list and opens a file.
- **Add files** adds files and renames and removes the ones you added.
- **Download files** saves a file to your computer. It also lets you print a picture or a PDF.
- **Remove files other people added** removes or renames any file. It starts on for moderators and off for members.
- **Make share links** makes, changes and turns off share links (below). It starts on for moderators and off for members, and a guest never has it.

## Open the Vault

The Vault is a module like the others: open it from the **Layout** menu, under **Show**, and it opens on the canvas. If you are not in a space the Vault asks you to open it in one. Without the right to see the files it says "You can't see the files in this space." and names who to ask.

## See the files

The Vault shows the space's files as a **List** or a **Grid**; choose either at the left of the toolbar. Your choice is remembered for you. Each file shows its name, a small picture where it has one (pictures and videos), what it is, its size, who added it and when. A file other tools link to is marked with how many places link to it. A file that is in a share link that still opens carries a small share mark (**Shared by a link**), for people who can make share links. A long list shows the first files and a **Show more** button for the rest.

The line at the bottom says how many files there are and how much of the space's room they use ("42 files · 1.2 GB of 5 GB"). It says **Almost full** from four fifths and **Full** when no more fit.

## Find a file

1. Type in **Search files** to find files by name. The matching letters are marked.
2. Choose **Filters** to narrow the list. **Sort by** gives **Newest first**, **Oldest first**, **Name, A to Z**, **Largest first** and **Type**. **Type** keeps Pictures, Audio, Video or Documents. **Added by** keeps Everyone's, Mine, or one person's. **Linked** keeps files that are linked from other tools, or files that are not. People who can make share links also see **Shared**, which keeps the files that are in a link that still opens.
3. When nothing matches, the Vault says "No files match." and offers **Clear filters**.

A file someone else adds, renames or removes appears at once, without reloading. The Vault also asks again every 15 seconds, in case a message was missed.

## Add files

1. Choose the **+** in the Vault's title bar (**Add files**), or drag files onto the Vault anywhere. In an empty Vault there is also an **Add files** button.
2. Drop the files in the area, or choose **Choose files**. You can add several; they go one after another, each with a bar that shows how far it has got. **Try again** repeats one that failed, and the cross beside a file stops it or clears it from the list.
3. Optionally tick **Remove where it was taken** before you add pictures. It is off by default, so a picture keeps the place it was taken; tick it to take that place out of the picture. Your choice is remembered, for you only. Videos keep their details, which can include where they were taken, and the Vault says so.

Press **Esc** to close **Add files**; the keyboard goes back to the **+** that opened it.

What it takes: pictures (JPEG, PNG, WebP and GIF, up to 25 MB), audio (MP3, OGG, WAV and M4A, up to 200 MB), video (MP4, WebM and MOV, up to 2 GB), PDF (up to 100 MB) and Markdown (up to 1 MB). The Vault looks inside each file, not at its name, so a file whose name says one thing and whose contents say another is refused. It refuses what it does not take, such as SVG, web pages, Office files and programs; HEIC pictures are refused with "Save it as a JPEG."

Everyone in the space can see what you add. There is no private file.

**Adding many at once.** A person can add 400 files and their small pictures in a minute, and one environment 1,500 together, so a drop of a few hundred files goes through. If the Vault is told to wait ("<Vault> is busy. Wait N seconds and it will carry on.", or "You have sent a lot in the last minute. Wait N seconds and try again."), it waits as long as the server asked (up to two minutes) and tries that file again, up to eight times, before it shows a failure. A file that fails shows the server's own sentence, and **Try again** repeats it.

**Limits.** A space can hold a set amount and each person can add a set amount in all (an owner can lower either on the Vault's settings, **Most one space may hold, in GB** and **Most one person may add, in GB**, and the server has its own). When one is reached, the Vault says which and asks you to remove some files. It also asks you to wait when you have sent a lot in the last minute, or when other uploads are still running, and it cuts off an upload that stops moving for a minute.

**PDFs.** A PDF that holds scripts, links that open programs or files, a form that sends what is typed in it, or files of its own is refused, with the reason ("That PDF holds scripts, so it can't be added."). Links to web pages and fillable forms are fine. A PDF the Vault could not check, such as an encrypted one, is kept, but only for download: it shows **This PDF can't be opened here. Download it.**

## Rename or remove a file

Choose the **More** button on a file's row or card. You see **Open**, **Download**, **Print** (pictures and PDFs only), **Rename**, **Where it is used** and **Remove**.

- **Rename** opens a small window. Keep the ending (such as `.pdf`) as it is; a name can be 120 characters.
- **Remove** asks first. It says where the file is used, and that the places that link to it will show "File removed". The question ends: "It is removed from the Vault for everyone in this space, and from any share link it is in. A link left with no file ends. This can't be undone." (the Vault's and the space's names are your environment's words). After it is removed, the keyboard stays in the list, on the file next to it, or on the empty list's button, not at the top of the page.
- You can rename and remove files you added. Renaming or removing someone else's needs **Remove files other people added**.

## Select several files

Choose **Select** in the title bar to tick files. The toolbar then shows how many you chose, **Choose all** (or **Choose none**), **Download** and **Remove**, and **Done** leaves selecting. **Remove** is greyed out if you ticked a file you may not remove, and the status line says "Remove is only for files you added". Several downloads go one at a time, as your browser allows.

On a phone, or on any touch screen, the Vault's own small buttons (**More**, the cross beside an uploading file, **Close** on **Add files**) are 44 pixels, so they are easy to press.

## Open a file

Choose a file (or **Open** in its menu). It opens in a window of its own over the canvas and over the Vault, not inside the Vault.

- **A picture** fits the window; zoom with the buttons, the wheel or a pinch, and drag to move it.
- **Audio and video** play with the browser's controls.
- **Markdown** is drawn as text. Anything in it that looks like a web page is shown as plain text, never run.
- **A PDF** opens in the Vault's own PDF viewer, with page buttons, a page number, **Fit width**, and **Search in the PDF**. The viewer runs apart from the rest of Coffee Pub Chameleon and has no network, so a PDF cannot reach anything.
- **A download-only PDF** shows **This PDF can't be opened here. Download it.** with a **Download** button (or says your role can't download it).

You can have up to four windows open at once. Opening a file that already has a window brings that window forward. With four open, opening another says **Four windows are open**, "Close a window to open another."

Each window's bar has:

- **Previous** and **Next**, with "3 of 12", to walk the files in the order the Vault's list showed them. The left and right arrow keys do the same.
- **Info**, which shows the file's type, size, who added it and when, and **Where it is used**. A window that is very short has no Info.
- **Download**, **Print**, **Full screen** (not on a download-only PDF) and, in the window's menu, **Rename**, **Where it is used**, **Close all** and **Remove**.

**Print.** **Print** is for pictures and PDFs, for people who have **Download files**. It opens your browser's print dialog; choose "Save as PDF" there to keep a copy instead of printing. Other kinds of file have no **Print**. On a phone there is no **Print**, as there is no **Download**, and the public share page has none. A download-only PDF is not printed from the menu. Printing a PDF may not work from a pop-out window ([known issues](../known-issues.md)).

Close a window with its close button or **Esc**; focus goes back to where you opened it. **Close all** closes every file window. It is in each window's menu and in the **Layout** menu, under **Open files**, where the number open is shown. On a phone only one window shows at a time, as a full screen sheet, and opening another file replaces it.

## Where a file is used

Other tools link to files without copying them; the Planner attaches them to a stay or a journey ([Planner](userguide-planner.md), "Attach files to a stay or a journey"). **Where it is used** in a file's menu, and in a file window's **Info**, lists the objects that link to it that you may see, and says how many others there are. Where a link points at a file that was removed, that tool shows **File removed**.

## A file that is missing

If the server's data was restored without the files' own folder, the list still shows the file. Opening it says **File missing**, because its content is gone from the server and it cannot be shown or downloaded; choose **Remove** to take it from the list (the Vault's list does not mark it in any other way; read as code). Where other tools link to it they show **File missing**, with **Remove link** for people who can edit there.

## Share files with people outside the space

A share link opens one or more files for anyone who has the address, with no account and no sign-in. It is not for the space: only the files you choose are visible, nothing else about the space is, and the page shows no one's name but the first name of the person who made the link.

**Who can:** people with **Make share links** (moderators and owners by default). Allowing download also needs your own **Download files**.

1. Choose **More** on a file's row or card and then **Share**, or choose **Select**, tick the files and choose **Share**. In an open file's window, choose **Share**.
2. The sheet is **Share a file** (or **Share 3 files**). Give the link a **Name**; only you and the people with the link see it. For a single file it starts with the file's name.
3. Choose when it **Ends**: **1 day**, **7 days** (the start) or **30 days**. A link always ends. You can turn it off sooner.
4. Optionally type a **Password** of at least 8 characters. People need it to open the link; tell them another way.
5. Optionally turn on **Allow download**. Without it people can look at the files but not download them; they can still save what they see on screen, and a PDF that opens in the page can still be saved, because the viewer is given its bytes (the sheet says so). If your role cannot download, the sheet says so and the link cannot allow it.
6. Choose **Make link**. **Link made** shows the address once, with **Copy address**. It is the only time the address is shown; copy it before you close the sheet. If you lose it, turn the link off and make another.

A space can hold at most 200 links and a link at most 500 files. Links that have ended do not count.

**See and change the links.** Choose **Share links** in the Vault's title bar menu. The list shows each link's name, when it ends, whether it has a password, whether download is allowed, how many times it was opened and who made it. **Turn off** is offered to the person who made the link, an owner and a moderator of the space, and asks first ("The link stops working at once. People who have it will read "This link has ended.""). **Edit** changes the name and removes files from the link (it keeps at least one; to stop the link, turn it off), and is for the person who made the link or an owner. **Choose files** starts selecting files in the Vault, to make another link. A link that has ended disappears from the list.

**What the people with the link see.** The address opens a page headed with the link's own name (for example **Flight pack**; the browser tab shows the same name). Under it a line reads "Shared by <first name> · Ends <day> <month>", and the files show as a grid. Choose a file to open it in the page, with **Back**, **Previous file** and **Next file**. **Download** appears only where the link allows it; without it the page says "These files are for looking at. The person who shared them has not allowed downloads." A PDF the Vault could not check cannot be opened and, without download, cannot be had at all. A link with a password asks for it first: the page's heading is **This link has a password**, with a **Password** box and an **Open** button, and the browser tab reads **Password needed**. A wrong password is said under the box ("That password isn't right."); after too many wrong tries it says "Too many tries. Wait a few minutes." A link that is off, ended, or never existed reads **This link has ended.** with "Ask the person who sent it to make a new one.", and the page does not say which. The browser tab reads **Link ended**.

**When a link stops working.** It stops at its end, when you turn it off, when its last file is removed, when the Vault is turned off for the whole environment or uninstalled (for good: turn the Vault on again and its files return, but no old link does), when the Vault is off in that space (the link returns when it is turned on), and when the space is deleted. It also stops if the person who made it leaves the space, is removed, or no longer has **Make share links** (or **Download files**, for a link that allows download). A link is its maker's, so changing the roles changes what links work.

## Clear does not apply

The Vault holds files, not module data, so the **Clear** that other modules have in their menu is not offered for it. Remove files from the Vault itself.

## Notes for the person running the server

The files' bytes are kept in a folder of their own (`VAULT_DIR`), not in the data folder, so the in-app backups do not carry them. In the Docker image it is `/app/vault`, a second volume beside `/app/data`; the compose file mounts both. Back that folder up with the data folder: a data backup restored without it shows the files as **File missing**. See [Getting Started](userguide-getting-started.md), "Back up and restore an environment", and [Library modules: the Vault](../architecture/architecture-modules.md#library-modules-the-vault) for the folder, the limits and the settings.

Share links are public, so the server counts wrong passwords by the visitor's address. Set `TRUST_PROXY_HOPS` to the number of reverse proxies in front of the container (1 for the Nginx Proxy Manager in the compose file, 2 for Cloudflare in front of it, 0 when the container is reached directly). Set wrong, the limits either do nothing or make visitors limit each other. `SHARE_UNLOCKS_PER_MINUTE` (60) caps password checks for the environment. See [Getting Started](userguide-getting-started.md), "Behind a proxy, and the limits".

On the Modules page, uninstalling the Vault and keeping its data leaves the files on the disk (and counting against storage); deleting its data removes them. Either way its share links end. The server's answer says how many files were removed or kept; the Modules page does not show that count yet.
