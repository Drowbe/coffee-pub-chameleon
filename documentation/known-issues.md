# Known Issues

**Audience:** anyone running Collaborator who wants to know what is broken before reporting it
as new.

A defect is recorded here once it has been observed, with a workaround if one exists, and moves to
the CHANGELOG once fixed.

## A call page left open across an update must be reloaded

After the server is updated to the version that renamed "the table" (step 3 of the Names plan), a call page
that was already open still listens for the old messages and asks the old addresses. Until it is reloaded, it
does not follow a pull aside, a recall or a return, and does not show who is online.

Workaround: reload the page once after the update.

## Opening a dashboard object a second time doesn't open the object

On the spaces page, clicking an object on the dashboard (a task, an event, a poll) opens its module and the object
the first time. Clicking it a second time opens the module but not the object.
GitHub #20.

Workaround: find the object in the module itself.

## Some data files are still readable by other users on the server

Since the security fix, `app.json`, `host.json`, `ai.json` and `secrets.key` are readable only by the server's own
user. The chat history and the modules' data files are not yet restricted the same way, and the checks do not yet
cover every case. GitHub #69.

Workaround: keep the data folder itself readable only by the user the server runs as.

## The console's Maps tab is too wide in the narrow layout

On the host console at narrow width, the Maps tab runs past the right edge of the screen.

Workaround: use a wider window or turn the phone sideways.

## Saving a bundled template reorders its module list

On the host console, saving an edit to a bundled template, such as Travel, rewrites the order of its module list,
even when only the description changed. **Review** then lists **Modules** as changed. Seen on 2026-09-30.

Workaround: none is needed for owners, since no offer is made to them. Ignore the **Modules** line in **Review**.

## The logo still reads the old name

The logo on the landing page and on the host console's bar reads "COFFEE PUB MAGPIE", the product's old name.
The words on those pages say Collaborator. GitHub #110.

Workaround: none.

## Opens with notes a module with no canvas as off in this space

A module that has no canvas at all, such as Stream, can be on a space's saved **Opens with** list when it was
put there through the API. The list keeps it switched on with the note "(off in this space)", where "(can't open on
the canvas)" is meant. Seen on 2026-09-30.

Workaround: none is needed; switch it off.

## Opens with shows an uninstalled module by its id

A module on a space's saved **Opens with** list that has since been uninstalled is listed with the note "(not
installed)", under its id rather than its name. Seen on 2026-09-30.

Workaround: none; switch it off to take it off the list.

## The bell's notices don't open what they are about, and there are no mentions

The bell in the top bar lists module notices, but clicking one does nothing: a notice does not carry a link to its
object yet. Nobody is notified when they are mentioned in chat. Both are the notifications step of
[plan-primary-nav](plans/plan-primary-nav.md) (decision 3, step 9), not built yet. Opening the bell marks every
notice read at once; there is no **Mark all read** and no way to keep one unread.

Workaround: open the module named on the notice (from its card on the spaces page, or the space it came from) and find
the object there.

## The Paste button on a picture only gets a PNG

In Chromium, the **Paste** button on a picture box receives a copied picture only as a PNG. A copied animated GIF
arrives as a still picture, and a copied JPEG photo arrives as a PNG, which can be larger than the photo and go over
the 20 MB limit where the same file would not. Where the browser won't let the page read the clipboard (and on a
server not reached over HTTPS, where there is no **Paste** button at all), only the keyboard paste works. Seen on
2026-09-30, in headless Chromium.

Workaround: Tab to the picture box and press Ctrl+V (Cmd+V on a Mac), which keeps a copied file as it is, or click
the box and choose the file.

## The Planner's first open in a space logs three 404s

The first time the Planner opens in a space, the browser's console shows three requests answered 404:
`_cursor:events`, `_moved:plan-keys` and `_moved:phases`. They are the Planner asking whether its stored
markers exist before it writes them, and they are expected; nothing is wrong and nothing is lost. They predate the
kind picker (Planner 0.15.1) and are noise to ignore when reading the console.

Workaround: none needed.

## Phases can look stale for up to 30 seconds, and for an admin who is not a member

The Calendar asks for a space's phases every 30 seconds to notice an edit, because modules are not told when a phase
changes. A phase edited in Set up can take up to 30 seconds to show on the Calendar. An admin who is not a member of
the space does not get the update at all and sees the old phases until the page is reloaded. GitHub #283 (a
phase-change event for modules).

Workaround: reload the page.

## The Calendar's Day view can scroll by itself at narrow width

At 390 pixels wide, the Calendar's Day view can scroll by itself, away from where you were. The phase bar now stays
in sight as you scroll (Calendar 1.24.9). Related: GitHub #287.

Workaround: scroll back to the place you want.

## Narrow bands in the status strip hide their label

A phase that lasts only a few days is a narrow band in the status strip. When the band is too narrow, its name is not
drawn; the band's colour and its icon (when the template gives one) still show.

Workaround: open the phase sheet (choose the chip) to read every phase and its dates.

## The Planner's old "Spent" chip can stay on the strip after Budget is turned on

When Budget is on in a space, the Planner stops showing its **Money** view and its **Spent** chip. The strip keeps what
a module last reported for up to 7 days, and the Planner only clears its report when someone who can change the Planner
opens it. Until then the strip can show the Planner's old figure beside Budget's, and the two can disagree. It goes away
when a Planner editor opens the Planner in that space, or after 7 days.

Workaround: open the Planner once in the space as an owner, an admin or anyone who can change it.

## Budget is up to 30 seconds behind the Planner

Budget reads the Planner's priced bookings by asking again every 30 seconds, and when its window is shown or focused
again, because the SDK has no event that tells a module another module's objects changed. A cost saved in the Planner
can take up to 30 seconds to appear in Budget, and the strip's figure moves with it.

Workaround: switch away from Budget and back, or focus its window, to read again at once.

## Budget's burndown axis labels overlap at very large amounts

On Budget's **Overview**, when a target is very large (many digits), the labels along the burndown's amount axis can run
into each other. Reported by QA on 2026-10-14; not seen on a screen by the person writing this.

Workaround: the figures beside the chart ("Left", "Paid") are not affected; read them there.

## Places saved before a picture map keep their old positions

When an owner sets a picture map, places already saved keep the real-world positions they had. They are not moved, so
they may sit in the wrong place on the picture. Places added after the picture map is set are placed on the picture.

Workaround: edit each place and set its **Position** on the picture with the target button, or clear the picture map.

## A pop-out needs a browser that allows pop-ups

**Its own window** for the call, and **Open in its own window** for a module, use `window.open`. A browser that blocks pop-ups, or an installed app that restricts them, cannot show the window. The call and the module now stay where they were and the status line reads "The browser did not open the window. Allow pop-ups for this site to open it in its own window." (GitHub #288). Only the window itself is missing.

Workaround: allow pop-ups for Collaborator.

## A Calendar or Map editor in a narrow window is a narrow-layout sheet

When the window is narrower than the editor, the editor of a Calendar or Map part opens as the narrow-layout sheet at that width, not as a window the editor's own size. The page behind it keeps its layout.

Workaround: widen the window.

## Floating windows can draw over a lifted editor

While an editor from the Calendar or the Map is open, a floating module window can still be drawn over it.

Workaround: close or move the floating window first.

## Some muted text on tinted surfaces is under 4.5:1 in light mode

Muted text on a plain surface now meets 4.5:1 in Strong Coffee's light mode, but three cases on tinted surfaces do not: the dates on phase-tinted chips (3.85:1), the counts on a poll's voted bar (3.78:1) and the struck-through titles of done objects (3.81:1).

Workaround: none; use a dark theme if the text is hard to read.

## Research's notes, links and answers have no owner on the server

Research's server rules (its `guards`) hold a **photo** to the person who added it: someone else may change its caption,
and only a role with **Remove photos other people added** may remove it or change more. A **note**, a **link** and an
**answer** have no such rule (RS-01 in the health audit of Research). Anyone who may edit in Research can change or delete one that another
person added, by a request to the data route; the server does not refuse it.

Workaround: give **Edit** in Research only to people who may be trusted with each other's notes.

## An Undo refused after a restart says the time is over

A Clear is held on the server for its Undo, and the hold survives a restart. What became of a recent Clear's token (undone, replaced by a later clear) is only remembered in memory. If the server restarts and a page then presses **Undo** on a token that was already undone or replaced, it is refused with "The time to undo that clear is over." rather than the true reason. Nothing is restored or lost by it.

## Some shared pieces are still drawn 28 pixels high on a phone

At 640 pixels and narrower, buttons are 44 pixels and a small button keeps its 30 pixel look with a 44 pixel area to press. The shared title-bar and toolbar buttons, the view switch and the toolbar search are now drawn 44 pixels (GitHub #394). A few other shared pieces are still drawn at 28 pixels on a phone. They can be pressed, but the target is smaller than the 44 pixels the rest of the app gives. Reported by the project manager; the pieces were not listed and are not re-measured here.

Workaround: none needed to use them; they are harder to hit with a thumb.

## The keyboard focus ring can show an inner rectangle

In `public/sdk/system.css`, a control's focus ring can draw an inner rectangle as well as its outline on some pieces. The toolbar search box was fixed (GitHub #394); the other pieces were not listed. Reported by the project manager; the pieces were not listed and this entry's author has not seen it. It does not stop anything from working.

## Printing a PDF from the Vault can print an error page in a pop-out or a destination page

**Print** on a PDF opens the browser's print dialog from a hidden frame that holds the PDF as a blob. The pages for a module's pop-out (`public/module.html`) and for a destination (`public/destination.html`) have a content security policy with `frame-src 'self'`, which blocks that blob frame, so the print can show an error page. Pictures print fine there, and the main space page prints PDFs fine by this reading. Found by quality-assurance and read as code only. Printing a PDF has not been seen in a real browser.

Workaround: print the PDF from the space page, or use **Download** and print it from your device.
