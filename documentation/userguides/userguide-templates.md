# Templates

**Audience:** the host admin making environments, a server operator starting a single environment, and an owner
whose environment uses a template or could.

A **template** sets an environment up for one use when it is made: what things are called, which modules are
on, how the Lobby reads, how new spaces start, and, if it has them, its reactions, a theme and a set of icons. It is picked when the environment is made, and an owner or the
host admin can switch it later. An environment without one reads exactly as Coffee Pub Chameleon always has.

## The Travel template

The Travel template sets an environment up for planning trips together:

- Spaces are called **trips** everywhere people read them, and the home page **Trips**.
- The Lobby is called **Home base**, "Everyone on every trip."
- The Planner is shown as **Itinerary**.
- The Itinerary (Planner), Places, Maps, Research and the Calendar are turned on, with the chat and the call, in
  every trip. Home base keeps only the chat, the call and the Calendar, as the Lobby always does.
- **Global Calendar** and **Global Map** are on (**Show in the top bar** on each module's configuration page, which puts them in the profile menu; see "Top bar" in [Manage](userguide-environment-settings.md)), from version 4 of the template.
- **Private addresses** and **Other calendars and busy times** are on (Calendar sharing, on the Calendar's configuration page; see [Calendar](userguide-calendar.md)), from version 5 of the template.
- Like its other settings, these are set once, when the environment is made; an environment made from an earlier version, or switched to Travel later, turns them on on those configuration pages.
- The home icon is a rolling suitcase.
- A new trip starts with the **Participants** picture profile. The Lobby keeps its own profile.
- A trip goes through six phases: **Planning**, **Booking**, **Buffer**, **Pre-trip**, **Trip** (the main one) and
  **Post-trip**, each with an icon from version 6 of the template and a colour of its own. The status strip under the top
  bar shows which one a trip is in and how far along it is, and the Itinerary and the Calendar tint the days; see
  "The status strip" and "Phases" in [Spaces](userguide-spaces.md), and [Planner](userguide-planner.md).
- A new trip is set to open the Itinerary and the chat, not the call, the first time someone enters it. The call is
  never joined by entering. The owner can change this on the trip's **First visit** tab in **Set up**.

More bundled templates may come later, and the host admin can make their own (below).

## Choose a template

**On a server with environments,** the host admin picks it on the host console:

1. On the **Environments** tab, click **New environment**.
2. Fill in the slug, the name and the first owner as usual.
3. Under **Template**, choose one ("None" is first, for an environment made without one).
4. Under **Plan**, choose the plan, or leave "No caps, every module".
5. Click **Create**.

When the host has templates, the product page's sign-up form offers the same choice to someone making their
own environment.

**On a single server,** set `TEMPLATE` in the compose file (for example `TEMPLATE: "travel"`) before the first
start, on a fresh data folder. It is used only when the environment is made: on a data folder that already has
an environment, or on a server with environments, it is ignored and the log says so. A `TEMPLATE` naming a
template the server doesn't have stops the start, and the log lists the ones it has.

## What a template does, and what stays yours

Some of it is applied once, when the environment is made: its settings, its modules, the Lobby, how new spaces
start, its reactions, its icons (added to the icon list) and its theme (added and made the one in use). After that they are the owner's, like anything else in Manage. A template's modules go on in every space
except the Lobby, which keeps only the chat, the call and the modules made for it.

Its words, the words on the buttons for entering a space and for the canvas layout, its phases, its home icon and the names and icons it gives
modules keep following the template. Anything an owner changes wins, and **Reset** goes back to the template's, not
the default. Manage shows which is which:

- **Words**: a word the template set is marked "From the template", and a word the owner changed shows "The
  template's: <word>" beside it. The same goes for **Button for entering a space**, the last row (see "The word on
  the button for entering a space" in [Manage](userguide-environment-settings.md)). A template that doesn't set it
  leaves it at **Enter**; the Travel template doesn't set it.
- **Home icon**: the template's is marked "Template's own".
- **Shown as**, on a module's card: "From the template"; **Reset** reads "Back to the template's name and icon".

Manage's **Template** tab says which one the environment uses and its version ("Uses the Travel template.
Version 1").

## Switch a template

An owner can switch the environment to another template, or to none, on Manage's **Template** tab:

1. Under **Template**, choose one in **Switch to** ("No template" is first). Its description shows below.
2. Click **Switch**, and confirm. Words, icons and module names change at once; anything you set yourself still
   wins. Nothing is turned off or removed.
3. The tab then shows **What the <name> template can add**:
   - **Turn on**: the template's modules that aren't on in every space yet, ticked. One your plan doesn't include
     is shown unticked, with why. Each goes on in every space except the Lobby.
   - **Also**, unticked: the template's name and description for the Lobby, the picture profile new spaces
     start with and what a new space opens, in order (one line and one tick for both), **Use its reactions** (this replaces the reactions you have), **Add and use the <name> theme**, and
     **Add its icons to the icon list**. Each shows only when the template has it and it isn't already yours.
4. Untick anything you don't want, then click **Apply** (**Done** when there is nothing to add). Only what is
   ticked is applied, and the offer closes even with nothing ticked.

**Not now** puts the offer away; a line saying "The <name> template can turn on more." and a **Review** button
bring it back, and the tab keeps a badge until you apply it. A template's settings (language, clock, currency and
the rest) are not offered: they are yours by now. Switching to **No template** puts the default words and icons
back (or your own) and changes nothing else. A switched template is never applied on its own; only what you
confirm is.

**The host admin** can do the same from the host console: on the **Environments** tab, each environment's card has
a **Template** choice and **Switch**, then the same offer, with **Review** to bring it back later.

## When a template is updated

The host admin can edit a template, and a new release can bring a new version of a bundled one. Its words, home
icon, phases and module names and icons change at once in every environment using it; anything an owner set still wins.
The rest is offered, never forced:

1. Manage's **Template** tab reads "Version <N>, updated: review what's new", with a badge on the tab.
2. Click **Review**. The offer lists only what the template changed since you last applied or passed over it: a
   new module, new reactions, a new theme, new icons, a new Lobby, or a new profile or list of what a new space opens.
3. Tick what you want and click **Apply**. Nothing is turned off or removed, and a part you turned down is not
   offered again until the template changes it.

## Make your own templates

On a server with environments, the host admin makes templates on the host console's **Templates** tab. It lists
every template with where it comes from (**Bundled**, **Yours** or **Imported**), its version, how many environments
use it, and whether it is hidden. A bundled template can be edited (see "Edit a bundled template"), but never
deleted.

**Make one:**

1. Click **New template**.
2. Give it an **Id** (lowercase letters, digits and dashes; it can't be changed later), a **Name** and a
   **Description**.
3. Fill in what it should set: **Words** (blank keeps the default; give the singular and the plural; a blank **Home page** row follows the
   template's space word, "Trips" for "trip") and, under
   them, **Button for entering a space** (blank keeps **Enter**; at most 20 characters), the **Home
   icon**, the **Modules** and, under **Module names and icons**, what to show them as, and under **New
   environments** the **Lobby name**, **Lobby description**, what **New spaces use**, and what a new space opens:
   tick the modules, then order them with the arrows (the list is the template's modules, including the chat and
   the conference).
4. Under **Phases**, click **Add phase** for each one, up to 12: an id (lowercase letters, digits and dashes) and a
   label. Tick **Main** on at most one: its dates are the plan's own. Use the arrows to order them and **Remove**
   to take one out. Leave the list empty for none.
5. If it should, tick **Give reactions** and add them (up to 120; a template's icons can be up to 120 too, solid icons only), click **Choose a theme file…** to give it a theme (a
   `.theme.json` file, see [userguide-themes](userguide-themes.md)). The theme is checked as you choose it: its name
   shows, followed by "Left out: ..." when part of the file wasn't a colour Chameleon knows, and a file that can't
   be used is refused beside **Theme** with a sentence saying why. List **Icons** by their Font Awesome
   names, separated by spaces.
6. Click **Save**. It is version 1, and offered on the create form straight away. A problem, such as a phase id
   listed twice, shows beside the part it is about, and nothing is saved.

**Edit one:** click **Edit** on its row, change what you need, and click **Save**. Each save is a new version.
Every environment using it gets the words, the word for entering a space, phases, home icon and module names and icons at once, and is offered the
rest (see "When a template is updated").

**Duplicate one:** click **Duplicate** on any row, bundled or yours. Give the new template an id, then a name. It is
a template of your own at version 1, with everything the one you duplicated has now, and opens in the editor.

**Hide one:** tick **Hidden** on its row. It is no longer offered for new environments, on sign-up or for a
switch; the environments using it keep it. Untick it to offer it again.

**Delete one:** click **Delete** and confirm. A template an environment uses can't be deleted ("In use by <environments>.
Hide it instead."): hide it, or switch those environments to another first.

**Import a file:** click **Import…** and choose a `.template.json` file. If a template already has its id,
you are asked for another. Anything in the file Chameleon doesn't know is left out and listed. It keeps the
file's version.

**Export one:** click **Export** on any row, a bundled one included. An edited bundled template exports as you
have it, marked as edited.

## Edit a bundled template

The host admin can change a bundled template, such as Travel, in place. The id stays, so every environment made
from it gets the change.

1. On the **Templates** tab, click **Edit** on the bundled template's row. The editor says "Your edits are kept over
   the shipped template."
2. Change what you need and click **Save**. The first save is the shipped version plus one, and each later save
   adds one. Environments using it get the words, phases, home icon and module names and icons at once, and are
   offered the rest.
3. The row now shows **Edited**.

**Hidden** works as for your own templates and changes no version. **Delete** is never offered for a bundled
template: hide it instead.

**Reset to shipped**, on an edited row, removes your edits after you confirm ("Reset <name> to the shipped version?
Your edits are removed."). The shipped template is back, and the version still goes up by one, so environments
using it are offered what changed.

**When a new release changes a template you edited,** your edits are kept, and a notice above the list reads
"<name> was updated in this image: review". Click **Review** to see each part that differs, the shipped one beside
yours, then:

- **Keep mine** keeps your edits and closes the notice. The version stays as it is.
- **Take the new version** drops your edits (you confirm first: "This drops your edits to <name>.") and raises the
  version.
- **Close** leaves the notice for later.

If you never edited it, a new release's template simply replaces it, with no notice.

## Template files

A template can travel as a file, `<name>.template.json`, of at most 64 KB. Its theme travels inside it.
Chameleon refuses a file it can't read ("That isn't a Coffee Pub Chameleon template file."), one from a newer version ("This
template was made by a newer version of Coffee Pub Chameleon.") and one exported before 2026-09-30, which is in an older
format ("That template file is in an older format. Export the template again and import the new file."). Where the
server has been given another product name, the sentences use it.

**The owner of a single server** has **Template files** on Manage's **Template** tab:

1. **Export** saves the template the environment uses.
2. **Import…** adds a template from a file; you are asked for a new id if its id is taken. It is then among the
   choices under **Switch to**; switch to it to use it.
3. Each imported template is listed with its version, its own **Export**, and **Delete**. The one in use can't be
   deleted: switch to another first.

**An owner on a server with environments** has only **Export**, for the template their environment uses, for
example to take it to a single server. The host admin manages the templates there.

## Modules a template couldn't turn on

A template may list a module the environment can't have yet. It leaves it off and says why:

- **Not in the plan**: the environment's plan doesn't include it. The host can change the plan.
- **Needs** another module that was left off: turn that one on first.
- **Not on yet**: Research needs the AI service, so it waits until the service is set up and turned on.

The environment's card on the host console and Manage's **Template** tab list each one with how to fix it.
Turning it on later, once that is fixed, is the same as turning on any module.

## Backups

A backup carries the record of the template the environment uses, and a restore brings it back. The host
console reads the template from the environment itself.
