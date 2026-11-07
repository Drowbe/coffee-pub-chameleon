# Manage

**Audience:** an owner or the admin running a Coffee Pub Chameleon environment, working through the Manage page.

Open the Manage page from the menu under your picture in the top bar: choose **Manage**. It has seven tabs, in this order: **Environment**,
**Template**, **Theme**, **Spaces**, **Roles**, **Users** and **Modules**, plus **About**. In the narrow layout the row of tabs scrolls sideways within itself. (Old addresses still work: `/admin#server` and `#settings` open Environment, `#rooms` opens Spaces, and `#words` and `#home-icon` open the Template tab at that section.) Manage's tabs are in the bar under the top bar. The pages reached from here (a person's profile, a module's configuration, the AI configuration) have **Manage** at the start of that bar, to come back. Only owners and the admin (on a hosted server, the host admin) see it; anyone else asking for it is told "Owners only."

## Environment

- **Environment** (a hosted server only). The plan's name, each cap with what is used, the overdue banner when a payment has lapsed, **Upgrade**, **Download a copy** and **Ask for deletion**. See [Your environment](userguide-environments.md).
- **Name and icon.** The **Name** shows in the top bar and the browser tab. The icon is any image;
  it is used in the top bar's logo box (in place of the home icon), as the favicon, and on the sign-in page. Click it to change it, or paste a
  picture (see "Set a picture" in [Participant and Character Images](userguide-images.md)), and the
  small **x** over its corner to clear it.
- The home icon, the words and the module names are on the **Template** tab (below).
- **Call features.** Turns screen sharing, asides, private conversations and reactions on or off for
  everyone, and sets the highest video quality anyone can pick.
- **Calendar sharing.** One line, "Calendar sharing is set in Calendar's configuration.", links to the Calendar's configuration page, where the calendar switches are now (see "Calendar sharing (owner)" in [Calendar](userguide-calendar.md)). The **Top bar** and **Calendar apps** sections that used to be here are gone; their switches moved to the Calendar's and Maps' configuration pages (see "Top bar" below). The line shows only while a module that takes part in calendar sharing is installed.
- **Sign-in page.** A background picture behind the sign-in box, the text under the password field, and **Require two-step sign-in for everyone**: off (the default: anyone may set up an authenticator app on their profile) or on (everyone must, from their next sign-in; a session already open keeps working); see "Two-step sign-in" in [Accounts, roles and permissions](userguide-accounts.md). The switch is not shown when the server does not offer two-step sign-in (`ENABLE_MFA` in the compose file). The Users tab marks accounts that have set it up. Click the picture to upload your own, paste one, or choose **Choose from the library** for one of the pre-made backgrounds that ship with Chameleon (filter by theme and style, pick one, **Use this background**). New pre-made images are added by putting files in `public/assets/images/backgrounds/`; see the README there for the format and file names.
- **Sign-up.** Self-service `/register` on or off, and invite links into specific spaces. See
  [Accounts, roles and permissions](userguide-accounts.md).
- **Access key.** The key that a keyed page's link carries in place of a sign-in (the Stream module's
  OBS views, `?s=...`). Show, copy or regenerate it; regenerating stops every existing link working.
  How the OBS boxes look (borders, the name plate, dimming) is the Stream module's own settings now; see
  [Chameleon in OBS](userguide-obs.md).

## Top bar

Owners and the admin can add two pages of their own for the whole environment: **Global Calendar**, the Calendar and the To-do together, and **Global Map**, the map and Places together. They are separate from the **Calendar** and **Map** tabs inside a single space. Both are off unless you turn them on; an environment made from the Travel template starts with both on. Where they show: in the profile menu under each person's picture (wider than the narrow layout), or in the top bar's menu after the spaces (in the narrow layout), under their module's name and icon after the word Global. The setting is still called **Show in the top bar**.

1. Open Manage on the **Modules** tab.
2. Choose **Module Configuration** on the Calendar's card (for Global Calendar) or on Maps' card (for Global Map).
3. Under **Top bar**, switch on **Show in the top bar**. Its line reads "Adds Calendar to the top bar: events and tasks from every space in one place." on the Calendar's page and "Adds Maps to the top bar: places from every space on one map." on Maps' page, with the names your environment gives those modules. The switch saves as you flip it.

These switches used to be in a **Top bar** section on the Environment tab; they are the same settings, so what you had chosen there still holds.

A switch that can't work yet is shown off and greyed, and its line says why instead: "Turn on Calendar on the Modules tab first.", "Turn on Maps on the Modules tab first.", or, for Map without a map file or a picture map, "Choose a file for "Map files" in Maps' settings first." (on a hosted server, "Ask the host's admin for a file for Maps."). The names are the ones your environment gives those modules. Each page shows only to people who may see its module for the whole environment, never to guests. How they work: [Calendar](userguide-calendar.md), "Global Calendar", and [Maps](userguide-maps.md), "Map in a space and Global Map".

## Language, time and money

On the Environment tab. **Language** is the interface language (English, until translations arrive). **Clock** is how every time is shown, across the environment and every module: 12-hour (10:30 PM, the default) or 24-hour (22:30). **Currency** is the one amounts are shown in (the Planner's costs and settling up), unless a trip names its own currency in Edit trip. The list has a **Common** group first, then **All currencies**, each by its name in your language: exactly the currencies the server accepts. The server refuses any other code ("XYZ is not a currency this server knows. Choose one from the list, such as USD."). A code saved before this check keeps working and still shows in the list. A trip in the Planner picks its own currency from the same list. Showing a trip's own currency with a conversion beside it needs a source of exchange rates, which is not set up yet.

## Template

The **Template** tab gathers what a template gives an environment. From the top:

- **Template.** Which template the environment uses ("Uses the Travel template.", or "No template."), and a
  **Switch to** choice for switching to another or to none. See "Switch a template" in
  [Templates](userguide-templates.md). While a switch has more to offer, the tab shows a small badge.
- **Words** (below).
- **Module names and icons.** Every module, the built-in Conference and Chat first, with what it is shown as here.
  See "Show a module under another name" in [Modules](userguide-modules.md).
- **Home icon.** The icon in the top bar's logo box, beside the environment's name, when no environment icon is
  uploaded (an uploaded icon takes its place). Choose
  one from the environment's icons (with a template, **Template's own** is first), then click this section's own
  **Save**. The icons offered are the **Icons** list (below).
- **Reactions.** The emoji tray in the call and on stream, also offered in chat. Add, remove, reorder
  and edit the emoji and label, or leave the list empty to turn reactions off. The first six are keys
  **1** to **6**. A new environment starts with 105, the first six being Heart, Black Heart, 100%, Hi, Thumbs up and
  Thumbs down.
- **Icons.** The icons you want available. Paste an icon's HTML from fontawesome.com, for example
  `<i class="fa-solid fa-dice"></i>`, and the preview shows it. These icons are the choices offered for a
  space's launch link, the home icon and a module's icon. Only the Free icons that ship with Chameleon will
  draw, unless you have added your own Pro package (see "Font Awesome Pro" under Theme). A new environment starts with
  113 icons.

An environment that was still on the old six reactions, or the old 21 icons, moved to the new lists once when the
server was updated. A list you had changed was kept.

An old link to `#reactions` or `#icons` on the Manage page opens this tab at that section.

## Words

On the Template tab, **Words** sets what people in this environment read for its eleven changeable words:
environment, space, the home page, aside, canvas, module, object, owner, moderator, member and guest. A travel group might call
a space a "trip" and a member a "traveller"; a game might have a "game master" and "players". The host's own words
(host and admin) can't be changed here.

1. On Manage > **Template**, find **Words**. Each word has a row showing its default. The **Home page** row is
   what the list of spaces is called in the top bar; blank, it follows the space word ("Spaces", or "Trips" where a
   space is a trip), or the template's own word when it gives one. It is a name, so type it as it should read, capital included
   ("Campaigns"); it has no article field.
2. Type the new word in lower case: its **Singular** and its **Plural** (both are needed). Capitals are added
   where a sentence needs one.
3. Fill in **With its article** only when the usual "a" or "an" is wrong for it, such as "an hour". Leave it blank
   otherwise.
4. Click **Save**. Every word is saved together, and if the server refuses one, nothing is saved and the message
   says which word and why ("The word for the home page…" for the home page row): it needs both its singular and its plural, it can be at most 30 characters, it can use
   only letters, spaces, hyphens and apostrophes, or its article form must be the singular with the article in
   front ("a trip").

A blank row uses the default. **Reset** on a row puts that word back to its default at once. Only owners (and the
admin) can change the words.

### The words on two buttons

Two rows at the end of **Words** set the word on a button rather than a level or role.

#### The button for entering a space

The last row under the words, **Button for entering a space**, sets the word on each space's main button on the
space list and on the guest form. It is **Enter** unless the template or you set another, such as "Board" or
"Go to". An aside's button always reads **Join**, since an aside is a call.

1. On Manage > **Template**, find **Button for entering a space** at the end of **Words**. Its hint says what it
   reads now.
2. Type the word as it should read at the start of the button, with its capital: at most 20 characters, using only
   letters, spaces, hyphens and apostrophes.
3. Click **Save**. It is saved with the words; if the server refuses it, nothing is saved and the message says why.

#### The button for the canvas layout

The row **Button for the canvas layout** (with your environment's word for canvas) sets the word on the **Layout** button in the top bar, which shows and hides modules and arranges them on the canvas. It is **Layout** unless the template or you set another. Set it the same way: at most 20 characters, only letters, spaces, hyphens and apostrophes, then **Save**.

Leave the field blank for the template's word, or **Enter** with no template. When the template gives a word, the
row says "From the template", or "The template's: <word>" once you have set your own. **Reset** puts it back to
the template's word, or to **Enter**. Only owners (and the admin) can change it.

Everything people read in this environment follows: the pages, the server's messages, the Roles grid, the texts
of the built-in modules, the names new spaces get ("New trip", "Trip 3"), and the bundled modules' own words. Until
the next step of the templates plan, the text a module's `module.json` carries (its description, its settings'
labels and help) still uses the default words.

## Theme

- **Theme.** The environment's colours, in a light and a dark version, with **Dark by default** choosing which one
  people see until they pick their own. Choose a theme, change its colours, preview, then **Apply**; **Export** and
  **Import…** share a theme as a file. See [Creating themes](userguide-themes.md).
- **Default Images.** The Participant pictures a member shows once neither they nor the space they are
  in has set one; the last fallback before the box goes transparent.
- **Guest images.** The Participant pictures every guest shows, since a guest has no account of their
  own.
- **Font Awesome Pro (optional).** If you have a Pro licence, drop your own "Web" download from your
  Font Awesome account (the folder with `css/`, `webfonts/` and `svgs/` in it, the Classic style) at
  `DATA_DIR/fontawesome-pro/` on the server and restart it. Chameleon serves and draws from it ahead of
  the bundled Free set, falling back to Free for any style or icon it does not have. Nothing about your
  licence or your package ever leaves your own server: it is never built into the shared image, never
  uploaded, and no token for it lives in this repository.

The tab ends with a line pointing to **Reactions** and **Icons**, which are on the Template tab.

## Spaces and Users

Both are rosters: a thumbnail, a name and a link to that one thing's own page. A space's button, **Edit** with your environment's word for space (such as **Edit trip**), enters the
space and opens its **Set up** panel; the old settings page is gone (see "Set up" in [Spaces](userguide-spaces.md)). See also
[Accounts, roles and permissions](userguide-accounts.md).

## Roles

The grid of what each role can do. See [Accounts, roles and permissions](userguide-accounts.md).

## Modules

Upload and manage add-on features. See [Modules](userguide-modules.md). An enabled module is on in every space; there is no
per-space switch. **Module Configuration** on Maps' card also holds the **Picture map**, the upload that replaces the
world map with your own picture (see "Picture map" in [Maps](userguide-maps.md)); the largest file it takes is
`MAP_IMAGE_MAX_MB` in the compose file, 100 megabytes unless set.

## About

The version, the licence, and the credits for the open-source software Chameleon is built on. The product's name is printed once.
