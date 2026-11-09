# Spaces

**Audience:** a game master or owner setting up spaces in Coffee Pub Chameleon, and players moving between
them.

Each space is its own place: its people, its chat, its modules and its call. After signing in, a player lands on Home,
which lists the spaces they belong to, each with its members and a green dot on those in it right now, and enters one.
Entering a space does not put you in the call; joining the call is a separate choice once you are inside (see
[The call](userguide-call.md)). Owners may enter any space.
An environment set up from a template may call its spaces something else, such as a trip's stops;
the pages use its word (see [Templates](userguide-templates.md)).

## The top bar

The bar at the top of every page takes you around the environment. What is in it depends on where you are.

**On Home and the other pages**, from left to right:

- **The logo and the environment's name.** The logo is the picture the owner uploaded, or the home icon when there
  is none. Click either to go Home. On a narrower window (up to about 820 pixels wide) the name is left out and the
  logo stays. A number on the logo is the unread messages in Home's chat while you are not looking at it.
- **Spaces** (or the environment's word for its home page). Click the word to go Home. Click the small arrow beside
  it (**Switch space**) for a menu of the spaces you belong to: the one you are in says "You are here", and a space
  with people in it says how many ("3 here"), not counting anyone who has stepped into an aside. Pick one to go to it.
  Owners and the admin also have **New space** at the end.
- On the right, **the bell** and **your picture**, which opens the profile menu (see "The profile menu" below).

**In a space**, the word **Spaces** gives way to the space's own controls, from left to right:

- **The space's name with an arrow.** Click it for the same menu of your spaces, with **Leave space** at the end.
  In an aside it shows the aside's own name; picking the space it came from in the menu does what **Rejoin call**
  does: everyone goes back to that space's call. A long name is cut short with "…"; hover over it for the whole name.
- **The layout tabs**: **Workspace**, **Calendar**, **Map** and your favorite layouts (see "Layout tabs" below).
- **Who is here**: the people in the space (see [The call](userguide-call.md), "Who is here").
- On the right, **Layout** (an icon button beside the bell, opening the menu that shows and hides modules and arranges
  them; see [The call](userguide-call.md), "The Layout menu"), the bell, your picture, then, for owners, the admin and
  the space's moderators, **Set up** (see "Set up" below), and last **Full screen** and **Pop out**.

When the window is too narrow for everything, Who is here shrinks first (the names become a count, then the pictures
go); then the layout tabs go into a **…** after them, one at a time from the right; then the tools on the right fold
into a **…** (Pop out first, then Full screen).

A guest sees the logo, the environment's name and the space's name, and nothing else; in the narrow layout there is no menu
button either. An aside's bar is the switcher, **Rejoin call** and your picture. Guests always see the environment's
default light or dark look.

### Layout tabs

Every view of a space is a layout, and each layout is a tab. They sit right after the space's name:

- **Workspace** is always first. It is the canvas, the work area where modules open, docked beside each other or floating, and it
  remembers how you left it.
- **Calendar** and **Map** follow while those modules are on in the space (Map also needs a map file or a picture map
  to be set; see [Maps](userguide-maps.md)). Calendar is the Calendar and the To-do together for this space; Map is
  the map and Places together. Each fills the work area and loads as saved every time you press its tab. Opening one
  does not set you Away on the call.
- After them, each saved layout you have made a favorite, in the order you favorited them. There is no limit.

Press a tab to show it. The call and the chat stay where they are, in the column beside the work area (see
[The call](userguide-call.md)), whichever tab is shown. In the **Layout** menu, under **Layouts**, the **⋮** on a row
offers **Favorite** or **Unfavorite** (Calendar and Map can be taken off the tabs; the Workspace always stays),
**Rename** and **Change icon**. Your names, icons and favorites are yours alone, kept for each space. A guest has no
tabs, and neither has an aside.

### The profile menu

Click your picture at the right of the top bar. The menu has **View profile**, **Dark mode**, **Global Calendar** and
**Global Map** (when an owner has turned them on; see below), **Manage** (owners and the admin), **Host console** (a
host admin signed in to an environment on a hosted server), **Install as an app** (while the browser offers it) and
**Sign out**.

**Global Calendar** and **Global Map** are the environment's own pages: the Calendar and the To-do, or the map and
Places, gathered across your spaces. They are separate from a space's own Calendar and Map tabs. An owner turns each
on with **Show in the top bar** on the module's configuration page (see "Top bar" in
[Manage](userguide-environment-settings.md)). Opened while you are in a space, they open over it and you are marked
Away on the call until you go back. See [Calendar](userguide-calendar.md) and [Maps](userguide-maps.md).

### The page bar

Every page but a space has a second bar under the top bar. It starts with the page's name, then the page's own
controls:

- **Manage** and **Profile**: the name, then the page's tabs.
- Someone's profile opened from Manage: **Manage** (owners and the admin only) to go back to Manage, then the
  person's name, then the tabs.
- **AI configuration** and a module's configuration: **Manage**, then the page's name.
- The module settings page and a module's own page: the name only.
- **Global Calendar** and **Global Map** have their own controls there and no name.

In a space the row under the top bar is the status strip (see below).

To add a space from the top bar (owners and the admin only):

1. Click the arrow beside **Spaces**, or the space's name when you are in one.
2. Choose **New space**. Manage opens on its **Spaces** tab, over the space if you are in one.
3. **Add space** already has the focus: press Enter or click it. See "Set up" below.

An owner can rename the home page on Manage > **Template** > **Words** (see [Manage](userguide-environment-settings.md)).
Unless they do, it is called after the spaces: "Trips" where a space is called a trip.

### The bell

The bell shows a count of what is new: notices from modules, such as a To-do reminder, and, for owners and the
admin, how many module updates are waiting.

1. Click the bell. A list opens under it, newest first: each notice with its module, what it says and when.
2. For owners and the admin, a first line says "2 module updates available". Click it to open Manage on the
   **Modules** tab.
3. With nothing waiting, the list says "Nothing new."

Opening the list marks every notice read. A notice that arrives while it is open appears at the top, already read.
Press Escape or click elsewhere to close it. A notice does not yet take you to what it is about.

### Toasts and notices

Two things can pop up in a corner of the page for a few seconds, and they differ in what they leave behind.

- A **notice** comes from a module about something you should know, such as a reminder. It shows as a toast for about
  nine seconds, is kept on the bell until you read it, and clicking it opens the module.
- A **toast** on its own is a short line about what you just did: that a place was saved, or could not be. It goes
  by itself, or when you click it, and is never kept on the bell.

What is lasting for a space, such as how far along it is, is in the status strip instead.

### In the narrow layout

The top bar is the logo, where you are, the bell and the menu button (**Menu**, three lines). Everything else is in
the menu: the environment's name, the home page and your spaces, **Global Calendar** and **Global Map** when they are
shown, **New space** for owners and the admin, then your picture and the profile menu's entries. In a space the
layout tabs are not drawn; the tab bar at the foot of the page has a tab for each module open, with the Calendar and
Map as tabs of their own (see [The call](userguide-call.md), "In the narrow layout").

## The status strip

In a space whose environment has phases (the Travel template has them; see [Templates](userguide-templates.md)), a
thin strip under the top bar shows how the space is going. It is the same on every layout tab. From left to right:

- **The phase chip**: a dot in the phase's colour and one sentence about where the space stands. Examples:
  "Planning · Booking in 6 days", "Booking starts tomorrow", "Trip · day 3 of 10", "Trip · last day", "Post-trip ·
  back 2 days", "Trip finished". The words are your environment's phase names. The sentence does not say how far off
  the main phase is; the countdown does.
- **The journey bar**: the phases end to end, each a band in its own colour, with its icon (when the template gives
  one) and its name where there is room; where there is only room for one, the icon stays. Phases already past are paler, today's band is the strongest, and the
  main phase's name is set heavier. A pin marks today, with the day of the month.
- **The countdown**, one chip: "35 days to Trip", "1 day to Trip", or "Trip starts today" on the main phase's first
  day. It is gone once the main phase is under way, and then the sentence says "Trip · day 3 of 10".
- **Needs action**, at the right end, only when something does: "2 need action", or "1 needs action". Press it for
  the list: a heading for each module, a line saying how many ("2 to vote in"), and under it each entry. Pick one to
  open it. For now Polls reports the open polls in the space that you have not voted in; its count is what Polls last
  reported, kept for up to seven days. Voting clears it.

Press the chip, the bar or the countdown to open the phase sheet (see "Phases" below). The strip only informs: it opens
nothing but the sheet and the list.

As the strip runs short of room, things go in this order: the line of facts, the names in the bands (their icons stay),
the words after the number of days, the bar (down to a small least width, then out of sight), and last the end of the
sentence. In the narrow layout the strip is a thin line under the top row: the sentence, with the bar as a thin line along its foot.

The strip is not shown to a guest, in an aside, or while Home shows over the space. A space without phases has no
strip until something needs action; from then it stays for the visit. For a screen reader the strip is a region named
"Status", and the sentence and the count are read once when they change.

Quick messages about what you just did are toasts, and events that are not immediate are on the bell (see "Toasts and
notices" above); neither goes on the strip.

## Phases

A template can give a space a list of phases, in order (the Travel template has Planning, Booking, Buffer, Pre-trip,
Trip and Post-trip, and Trip is the main one). A space dates them, and the dates make one timeline with no gaps:

- Each phase starts the day after the one before it ends. A phase with no dates is skipped.
- The first phase starts on the day the space was made, unless you give it a start.
- The main phase and the last phase can have an end of their own; setting any phase's **End** moves the start of
  the next one to the day after.
- Each phase has its own colour. The strip, the phase sheet, Set up, the Calendar and the Itinerary all use it.

Phases only inform. They do not lock anything; they say where the space is, what leads on a day, and where an
object with no date waits.

**Who can:** anyone in the space reads the sheet. Owners, the admin and the space's moderators change the dates.

To change the dates from the strip:

1. Press the phase chip, the bar or the countdown. The **Phases** sheet opens, with the bar of phases over one row for
   each, headed by the phase's icon when the template gives one.
2. Set a phase's **Start** or **End**. The row after it moves with it. A row that says "Not scheduled" has **Add
   dates**; **Skip** on a row clears its dates so its neighbours join. The first phase cannot be skipped.
3. With nothing dated yet, the sheet asks **Start the first phase on** and a day, then **Start**.
4. Choose **Save**. **Cancel** or Escape close it and ask "Discard changes?" first if you edited something.

A date that would break the order is refused with a sentence by its row, and the date snaps back. The same rows are
on the **Phases** tab of Set up (see below), where they are saved with everything else.

## Home

Home is the page you land on after signing in, and what the logo, **Spaces** and the narrow-layout 's home entry show.
Wider than 1200 pixels it has three columns, using the page's width:

- **Chat**, on the left: the environment's chat for everyone, with the **Discussion | Assistant** tabs a space's chat
  has (see [Chat](userguide-chat.md)). It is the chat the Lobby had; nothing said there was lost. Drag its right edge
  to make it wider or narrower, or focus the edge and use the arrow keys (Shift for more, Home and End for the
  least and the most, Shift and Enter for the default). It is not shown to guests, or to a role that cannot read chat.
- **Spaces**, in the middle: **Who's around**, then the heading with the home word, then the space cards. For owners
  and the admin the last item in the grid is **Add space**, a dashed empty card: it makes a space, makes you one of
  its members, and opens it with Set up so it can be named at once.
- **Modules**, on the right: the cards modules provide (see "The Modules column" below), headed with the module word.
  It is hidden while no module has a card.

Under 1200 pixels the Modules go under the space cards. At 760 pixels and below Home is one column: the spaces first,
then the chat at a height of its own, then the Modules.

The Lobby is no longer a card or a place you enter. Everyone is still in it, behind the scenes: it is what Home's chat
belongs to, and it is still listed first on Manage's **Spaces** tab.

Going Home from inside a space, with the logo, **Spaces** or the narrow-layout , does not leave the space or the call. You
stay in the call, set to Away, and the space's card reads **Back to <space>**. Home's chat shows while you are there,
and a number on the logo counts what was said in it while you were in a space. **Back to <space>** brings the space's
chat back, with whatever was said in it meanwhile.

### The space list

Pressing a space card, anywhere on it, enters the space; its **Enter** button (a door) comes first. After it comes
the space's launch link, if it has one. There is no pop-out button and no **Set up** on the card: open **Set up** from the
top bar once you are in the space (see "Set up" below). On a narrow
card the launch link moves to a line of its own under **Enter**. A space you are still connected to offers
**Back to <space>** instead of Enter; a long name is cut short with "…", and hovering over the button shows it in full.

**Enter** is the default word. The template or the owner can change it, for example to "Board" (see "The word on
the button for entering a space" in [Manage](userguide-environment-settings.md)).

An aside you are part of also shows on the list while it lasts, as a card with **Join** (the narrow layout) and a pop-out
button, "Join in a pop-out window". An aside is a call, so its button always reads Join, whatever the word for
entering a space.

The card says who is there: "3 here · 2 in the call", "3 here" when nobody is in the call, or "Nobody here". Someone
who has stepped into an aside is not counted as here. In the row of members, someone in the call has a small camera
mark beside their green dot; hover over it for "<name> is in the call". Someone who is not here has their dot off,
and hovering over them says where they are instead: "<name> is in <space>" for a space you belong to, "<name> is in
an aside" or "<name> is in a private conversation", or "<name> is in another space" for a space you don't belong to.

A member who is online but not where the stream is (the space an owner or the admin is in) is marked **off stream**.
When the stream is somewhere you can't see, everyone whose place you can see is marked off stream; people in another
space, or in an aside you aren't part of, are not marked, since they may be where the stream is.

### What you can see of where people are

You see where someone is only in the spaces you belong to. Owners and the admin belong to every space and every
aside. Someone in a space you don't belong to shows as "in another space", never with its name, and never as in the
call. Someone who has stepped into an aside from one of your spaces shows as "in an aside", or "in a private
conversation"; you are not told who else is in it. You always see where you are yourself. A guest sees only their own
space and the people in it.

### The Modules column

Home's right-hand column holds a card for each module that offers one, across all of your spaces. In the narrow layout it is
below the spaces. The Calendar's **Coming up** is a small month with a dot on each day that has something (click a day
to open it in the full calendar), over the next few events; the To-do's **Due soon** the tasks due within a week or
overdue, and Polls' **Need your vote** the open polls you have not voted in; each draws from every space you are in and
the environment's own data. Each entry shows its space's icon on the left and an arrow on the right that says clicking
goes there. Click an entry to go to it in its space, or click a card's heading to open that module in full. While
Global Calendar is on, the Calendar's and the To-do's headings open it, an event or a task opens there with its editor
open (a task on the **To-do** panel), and a day in the small month opens Global Calendar at that day; Polls' entries
still go to their space. While you are in a space (with Home shown over it), the module's page opens over the space
instead of leaving it: the call keeps running, you are marked Away on it, and **Back to <space>** returns you. A card's
own "open in full" link, a link to a module inside a card, and an entry that isn't in any space open the same way.
Ctrl-click, Cmd-click, Shift-click, a middle click, or Ctrl or Cmd with Enter, opens a new tab instead, and leaves
Home and the call alone. The cards are laid out by Chameleon, the same for everyone. Guests do not see them.

## Who is online, and inviting someone to talk

The **Who's around** strip, above the space cards, shows everyone who is online: signed in with Chameleon open in a
page you are looking at, whether or not they are in a space. Each person shows where they are, with the same words as
the space cards: "in <space>" for a space you belong to, "in an aside", "in a private conversation", "in another
space" for one you don't belong to, or "online" when they are in no space; and a video mark while they are in the
call. Beside everyone but you is a **people arrows** button: click it to invite them to a private conversation. It
makes a private aside for the two of you, off the record like a pull-aside, and takes you into it; they get a notice
wherever they have Chameleon open with **Join** and **Decline**. Join takes them straight into the aside. The
invitation lasts a couple of minutes, and the aside goes away when nobody is left in it. A person who is not online
cannot be invited, and you need the permission to start a private conversation (and the environment must allow them).

## What opens when you enter

The first time someone enters a space, what they see is decided by the space's **First visit** setting (see "Set up"
below): the Workspace with the modules switched on under **Opens with**, or the Calendar, the Map or a shared saved
layout. When the owner has chosen nothing, it is what the environment sets for a new space, else the chat and every
module on in the space. A guest with nothing set gets the chat and the call's tiles. The call is always out of the
call, showing **Start call** (or **Join call**): entering never joins it, for anyone (see [The call](userguide-call.md)).

After that, each person's own arrangement is remembered for each space: the modules open, how, and how big. In the narrow layout, the first tab shown is the first thing opened.

If you reload the page while you are in a space, you are put back in that space rather than on Home. It is remembered
for that browser tab only; leaving the space, being removed from it, or a space that cannot be joined clears it, and a
step-aside or private word is not remembered.

## Set up

Set up is where a space is named, pictured and arranged. It is one panel on the space's own screen, with tabs and one
**Save**.

**Who can:** owners and the admin see every tab. A space's moderators see **Phases**, **First visit** and, for the
modules, only each module's settings. A member has no **Set up**.

To open it:

1. In the space, press **Set up** in the top bar (it shows pressed while the panel is open). Home's **Add space**
   opens it for the space it makes. Manage's **Edit** button on a space (with your environment's word for it, such as **Edit trip**) does the same.
2. The space's name in the top bar becomes a box you can type in. The panel opens at the side (the whole screen in the narrow layout) with the tabs along its head.
3. Change what you need, on any tabs. A small dot on a tab means it has changes not yet saved.
4. Choose **Save** in the bar locked to the foot of the panel. It sends everything at once and closes the panel, with
   a line saying what was saved. **Cancel** drops every change. Escape does the same, and asks "Discard your changes?"
   first if you changed something. A click outside the panel does nothing.

If the server refuses something, the panel stays open on the tab it belongs to with the server's sentence, and says
what did save. Change it and press **Save** again.

The tabs, with your environment's words for them:

- **Space** (named for the environment's word, such as **Trip**): the space's **Picture** (square; anything else is
  cropped to the middle), **Name**, **Description**, **Faces in the call** (what each person's tile shows while their
  camera is off: their own pictures, or their character pictures; see
  [Participant and Character images](userguide-images.md)), **Launch link** and its **Link icon**, **In the published
  calendar** (shown only while an owner has the published calendar on; see "The published calendar (owner)" in
  [Calendar](userguide-calendar.md)), and **Delete** at the foot.
- **Members** (named for the environment's word for members, such as **Planners**): who belongs to the space,
  **Allow guests**, then **Generate invite link** and the guest link (**Turn on**, **Copy**, **New link**, **Turn
  off**). Members and **Allow guests** are saved with **Save**. The links work at once and are not part of it.
  Under **Guests**, **Guests can see costs and booking codes** is off unless an owner turns it on. Off, a guest of
  this space never receives the amounts of Budget's costs or the Itinerary's booking codes, whatever the guest link
  shows. Only owners and the admin can change it. It is saved with **Save**.
- **Phases**: each phase's **Start** and **End** in rows, as in the phase sheet, then the **Budget** field. Saved with
  **Save**. Left out when the environment has no phases; then the **Budget** field is on the tab named for the space
  (an owner's), or on **First visit** (a moderator's).
- **Budget** (a field, not a tab): the space's budget, an amount and a currency, shown while a module that uses it (such
  as Budget) is on in the space, or when one is already set. Leave the amount empty and choose a currency to give the
  space a currency with no target; empty both to clear it. Owners, the admin and the space's moderators can set it
  (see [Budget](userguide-budget.md)).
- **First visit**: what someone sees the first time they enter. Choose the **Workspace**, with its **Opens with**
  switches (the chat, and each module on in the space), or **Calendar**, **Map** or a shared saved layout. Owners and the
  admin choose which; a moderator can change the **Opens with** switches. A switch that cannot open now stays in the
  list with a note saying why ("(not installed)", "(turned off)", "(can't open on the canvas)"), so turning it back
  on restores it. **Stop using it** returns to the Workspace. After a first visit each person's own arrangement is
  remembered.
- **Modules** (named for the environment's word): the modules that are on here, **Turn AI off in this space** and
  **What AI may see** (while the server has an AI service; owners only: tick **Same as the environment's choice** off to
  set what goes to the AI for this space alone, as described in [Modules](userguide-modules.md), "The AI service"; **Let AI look things up** can be turned off for one space, but not on when the environment has it off), and a section for each module with its settings for this space. Every module that
  is turned on is in every space; an owner turns one on or off on the **Modules** tab of Manage (see
  [Modules](userguide-modules.md)). A moderator sees the module settings only. A file a module holds is deleted at once,
  not on **Save**.

**Delete** (on the **Space** tab) asks first, inside the panel: "Delete <name>? Its members stay in the Lobby." Choose
**Delete** or **Keep**. It does not wait for **Save**. Afterwards you are on Home. The Lobby, Home's backing, has no
Delete, no member list and no calendar switch.

Older settings addresses still work: `/spaces/<id>` (with `#space`, `#members` or `#modules`) and
`/module-settings?space=<id>` take you to Set up on the same tab. The separate settings pages are gone.

## Step aside

While in a call, an owner can pull one or more people in their current space into a private word.
Click the door icon on each tile to pick who, which toggles a selection and does not move anyone
yet, then confirm with **Step aside with N**. Everyone picked moves together at once, with nobody
clicking anything on their own end.

Each pulled player, and the owner, gets a **Rejoin call** button in the top bar (in the narrow layout, in the tab bar). Clicking
it on any one of their screens brings the rest back too, to whichever space they were pulled out of. Everyone who was on
the call stays on it, into the aside and back again; anyone who was not arrives out of the call. The aside shows on
Home only for the people in it and owners, with **Join** (see "The space list"), and it disappears on its own once
everyone has left it.

Anyone left behind sees those tiles dim to a placeholder reading **In an aside**, naming who they
stepped out with, until they return. The names show to the people in the aside, to owners and the admin, and to anyone who
was on the call when the aside started and has not reloaded the page since; anyone else sees **In an aside** alone.

**Privately** is a second button on the confirmation, for a conversation that must stay off the
recording: the placeholder reads **In a private conversation** and never names anyone, also after a reload, and
Coffee Pub Studio hides everyone in a private conversation from the stream entirely,
where an ordinary aside only mutes and dims them. Who may step aside, and who may start a private
conversation, is set per role on the Roles tab.
