# Object Window Plan

**Audience:** Thomas, who decides how a person sees a whole object and how they start changing it, in every module and
on a phone; and the sessions that build it: experience-design (`public/sdk/host.js`, `public/sdk/host.css`,
`public/module-frame.js`, `public/module-host.js`, `public/canvas.js`, `public/module.js`, `public/space.js`, and each
module's page), server-development (the checks in `tools/`; no server route changes are planned), quality-assurance
(each step), content-manager (the API and architecture documents, the user guides, the changelog).

**Status:** draft, 2026-10-30, by product-planner. Nothing built. The direction is Thomas's, 2026-10-30, as relayed by
the project manager: cards show a summary; to see everything, a card (any module's object) opens in a read-only window,
the shared module frame window, with an **Edit** action in the window's title bar that switches it to editing; this is
one reusable SDK experience for every module (`host.*`), not per-module code. And, the same day: phone experiences must
be designed for the phone, not a shrunk desktop, because a large share of use will be on phones. Everything else below
is proposed and waits on the open questions at the end.

## Why

Today there is no one way to see a whole object. The Planner folds what a card has no room for under a **More** /
**Less** toggle inside the card; To-do, Calendar, Research and Places open their edit form, disabled, for someone who
cannot edit; a person who can edit has no way to read an object without opening its form. Each module decides this on
its own, and on a phone each of those shapes is a squeezed desktop shape.

## What it is today

Read from the code on 2026-10-30, unless marked otherwise.

### Cards and More / Less

- **The Planner** (`modules/travel`). A card shows the kind, the title, the time and a few slots. `moreInto(el, item)` in
  `travel.js` adds a `<details class="card-more">` (`tpl-card-more` in `travel.html`, "More" and "Less") holding what
  the card's face has no slot for: the note, who is on it, the booking reference, terminal, platform, coach, seat,
  class, pick up, drop off, room, guests, reservation name, address and cost. Which cards are open is kept in
  `state.expanded` so it survives redraws. Editing is a button (`data-action="edit-item"`) and the card's "..." menu;
  `openEditor()` returns at once when `host.can('edit')` is false, so a person without edit sees only the card and its
  More.
- **To-do, Calendar, Research, Places.** A click on a row opens the module's editor window (`host.ui.editor`). For a
  person who may not change that object the form is shown with every field disabled and no button row
  ([plan-editor-window](plan-editor-window.md), "Built": "A read-only form takes no input at all"). To-do says why in the
  form ("Only people who can add tasks in ... can change this.", `todo.js`).
- **Polls** shows a poll in its list; opening one scrolls to it.
- The design system decided "A card or row has at most one primary inline action" and "Rows are 44px high" on a phone
  ([plan-design-system](plan-design-system.md), "Cards and rows").

### The editor window

`host.ui.editor(dialog, { size, isDirty, onClose })` (`createEditor` in `public/sdk/host.js`) shows a module's own
`<dialog>` modal in the top layer: 560 px or 880 px, a full-screen sheet at 640 px and below, a close button in its
corner, "Discard your changes?" with **Keep editing** and **Discard** when `isDirty()` says so, Escape handled, focus
returned, popovers moved into the open dialog, reopened after `moveModule()` (the `moved` event), and for a module in a
sandboxed frame the frame lifted to the editor's size (`editor.lift`). It is not drawn with the module frame: it has
no title bar, only the module's own heading and its own button row.

### The module frame

`createModuleFrame` in `public/module-frame.js` draws every module window: the title bar (icon, title, the module's
bar actions, the "+", the menu, close), the toolbar row, the content and the status bar. Its menu holds the window's
standard actions (**Dock as a panel**, **Open as a window**, **Open in its own window**, **Clear**) and the module's
standard ones (**Settings**, **Share**, **Print**, through `host.standard.set`), with the host's words and icons. Share
shows the host's one Share dialog with a link and **Copy link**; Print prints the content area alone. No bundled
module calls `host.standard.set` yet. On a phone every title bar button has a 44 px tap area. `system.css`, which
holds the frame's styles (`moduleframe:start` to `moduleframe:end`), is already loaded into a module's shadow root by
`startInPage` in `public/module-host.js`.

### Opening an object from elsewhere

`host.objects.open(ref)` asks the page; on a space's canvas `openRef()` in `public/canvas.js` opens the owner module
(or brings its floating window forward) and delivers `objectopen`. What happens next is each module's own
`host.objects.onOpen` handler: To-do opens its editor, Places finds the place and opens its dialog, Polls scrolls to
the poll, Calendar, Research, Budget and Maps each do their own thing. On a module's own page the pointer comes in the
address as `#ref=<JSON>` (`refFromHash` in `public/module.js`). There is no address a person can copy that opens one
object inside a space, and nothing in `public/` uses `history.pushState` or `popstate`, so a phone's back gesture
leaves the page rather than closing an open sheet.

### Plans this touches

- [plan-unified-layout](plan-unified-layout.md) (approved): the host draws the bands, and later builders draw lists,
  cards, tables and forms (slices 10 to 13, not built, after the real-time steps). Its sketch of `host.ui.card` already
  has `onOpen()`. Decision 2 there: modules do not write markup for shared things. Domain content (a map, a calendar
  grid) stays the module's.
- [plan-editor-window](plan-editor-window.md) (built): the dialog, the discard question, the lift for a frame and the
  phone sheet this plan builds on.
- [plan-attachments-vault](plan-attachments-vault.md) (approved 2026-10-30, not built; there is no `modules/vault`):
  a file is the Vault's object, kind `file`; its viewer is drawn "inside the module's content area, one file at a time:
  a top row with **Back**, the name, previous and next, **Download** ... **Share** ...", and "the viewer full screen as
  a sheet" on a phone; `host.files.open(pointer)` opens it. This plan proposes that viewer becomes the Vault's read view
  in the object window (question 13, decided a on 2026-11-03, so the approved Vault plan now says a window too).
- [plan-places-and-maps](plan-places-and-maps.md) (draft, undecided): one module or two. Either way a place is an
  object of whichever module owns places, and Maps stores nothing; this plan works with both answers.
- [plan-chat-links](plan-chat-links.md) and [plan-linked-objects](plan-linked-objects.md): a link chip in Chat or in
  another module opens its object through `host.objects.open`, so it would open the object window too.
- [plan-phone-space-bar](plan-phone-space-bar.md) and [architecture-canvas](../architecture/architecture-canvas.md),
  "Phones": at 640 px and below one view shows at a time, the space bar is a tab bar at the foot, and `body.in-space`
  is `top: 0` with `height: 100dvh`.

## Decisions

Thomas, 2026-10-30:

1. **Cards show a summary.** The card is for scanning a list, not for holding everything.
2. **To see everything, a card opens the object in a read-only window,** the shared module frame window. One place
   to read an object whole, in the same frame every module window has.
3. **An Edit action in that window's title bar switches it to editing.** Reading is the default; changing is a step
   the person takes.
4. **One reusable SDK experience for every module** (`host.*`), not per-module code. Every module, and an uploaded
   one, gets the same window by asking for it.
5. **Phone experiences are designed for the phone,** not a shrunk desktop. A large share of use will be on phones.

Thomas, 2026-11-03: question 13 is answered (a). The Vault's viewers (pictures, audio, video, Markdown, PDF) open in one
of the app's windows, not a new browser window and not inside the Vault panel; the Vault panel lists, searches,
filters, selects, adds and shares files. A link to a file from another module (a Planner stay's booking PDF, a
Research note, Chat) opens the same viewer window over the canvas and does not bring the Vault forward. The
consequences, also answered by Thomas on 2026-11-03, are questions 17 to 20 below and decision 20 of
[plan-attachments-vault](plan-attachments-vault.md); only the title bar and toolbar contents stay open.

Thomas, 2026-11-01: question 15 (the queue) is answered "after the phone foundations": step 1 waits for
[plan-phone-experience](plan-phone-experience.md)'s steps 3 to 5, and the window is built on its shared sheet and history stack.

## The contract (proposed)

Everything in this section is the planner's proposal. Where an open question would change it, the question's number
is given.

### What a person sees

- **On a card.** The summary only: no More / Less (question 7). A tap or click anywhere on the card that is not its "..."
  menu or its one inline action opens the object window in read mode (question 8). Keyboard: the card's title is a
  button; Enter or Space opens it.
- **The window, read mode.** Drawn by the module frame (`createModuleFrame`, `variant: 'window'`) inside a modal
  `<dialog>` (question 3). Title bar, start to end: the kind's icon in the module's tint, the object's title,
  **Edit** (`pen`, with its word wider than a phone) when the person may edit, the menu, **Close** (`xmark`). The menu:
  the module's own object actions (Duplicate, Move to..., and so on), a line, **Share**, **Print**, **Open as a window**
  (question 3) and **Open in its own window**, then the module's destructive actions (Delete) last, red. No toolbar
  row unless the module gives one (the Vault's previous and next, say). The content: the read view (below). The status
  bar: who changed it last and when ("Changed by Ana, 2 hours ago"), and, when the person may not edit, why
  (question 5).
- **Edit mode.** The same window, the same size. Title bar: the icon, "Edit" and the title, then **Cancel** and
  **Save** (primary). The menu and Close are not shown; Escape and the corner's place are Cancel. The content is the
  module's form. **Save** saves and goes back to read mode on the saved object (question 4); **Cancel** asks "Discard
  your changes?" when something changed, then goes back to read mode.
- **A new object** (the "+" or a module's own add) opens the same window straight in edit mode, titled with the
  module's own words ("New task"); there is no read mode to go back to, so Cancel closes it (question 6).

### The SDK: registering an object kind

A module registers each kind of object it wants opened in the window, once, after it has loaded:

```js
host.objects.window.define('task', {
  icon: (task) => 'square-check',          // a Font Awesome name, or a function of the object
  size: 'medium',                          // 'medium' (560 px) or 'large' (880 px), as the editor window
  load: async (id) => taskById(id),        // the module's own copy of the object, or null when it is gone
  title: (task) => task.title,
  canEdit: (task) => writable(task) || 'Only people who can add tasks in Lisbon can change this.',
                                           // true, or a sentence saying why not (shown in the status bar), or false
  read: (task) => ({                       // the read view as data, drawn by the host (question 1)
    facts: [{ label: 'Due', value: '12 Nov', type: 'date' }, { label: 'Who', value: 'Ana, Tom' }],
    text: task.notes,                      // Markdown, through the SDK's safe renderer
    links: true,                           // the host draws Linked and Used by from host.objects.linksFrom / linksTo
  }),
  domain: (el, task) => cleanup,           // optional: the module's own part of the read view (a picture, a map, a PDF)
  edit: (el, task, ctx) => ({              // fills the window's content with the module's form; task is null when new
    isDirty: () => changed(),
    save: async () => savedTask,           // throws { status: 409 } when someone changed it; any other throw is shown
    focus: el.querySelector('#f-title'),
  }),
  actions: (task) => [{ id: 'duplicate', label: 'Duplicate', icon: 'copy' }, { id: 'delete', label: 'Delete', icon: 'trash', danger: true }],
  onAction: (id, task, win) => {},         // a menu action; `win.close()` after a delete
  updates: (fn) => off,                    // optional: the module tells the window its object changed (live)
});

const win = await host.objects.window.open({ kind: 'task', id }, { mode: 'read' | 'edit', returnTo });
win.close(); win.mode; win.refresh();
```

The name `host.objects.window` is the planner's suggestion (question 2). It sits with `host.objects` because the window
is about an object and its pointer, and `host.objects.open(ref)` from another module ends in it.

- **Read** is data, so every module's read view looks the same and the host can draw it for a phone, print it and
  read it to a screen reader. `facts` are label and value pairs (`type` one of `text`, `date`, `time`, `money`,
  `person`, `place`, `link`); `text` is Markdown; `links: true` adds the host's Linked and Used by lists, the same
  chips `host.objects.resolve` gives everywhere. `domain` is the only markup a module draws in read mode, for the
  domain content [plan-unified-layout](plan-unified-layout.md) already leaves to the module.
- **Edit** fills the content with the module's own form, as the editor window does today, until `host.ui.form`
  (unified layout slice 13) exists; then `edit` may return a `host.ui.form` handle instead (question 14). The host
  draws Save and Cancel; the module's form has no button row of its own.
- **Saving.** The host disables Save while `save()` runs and shows its error under the title bar. A 409 shows
  "Someone changed this since you opened it." with **See their version** (back to read mode, the draft dropped after
  the discard question) and **Keep editing**. Nothing saves as you go, as the action bar rule for pages says.
- **Live changes.** In read mode the window redraws when `updates` says the object changed. In edit mode it does not
  touch the form; it shows the same "Someone changed this" line at once, so the person knows before Save. An object
  deleted while open shows "This was removed." with **Close**.
- **Permissions.** Who may edit stays the module's rule and the server's check; the window only asks `canEdit`.
  `false` or a sentence hides **Edit** (question 5). Guests read what they can see, as today. A keyed page (the OBS
  view) never opens the window.
- **The standard actions.** **Share** is the host's Share dialog with the object's address (below) and the title; a
  module may give `share: (obj) => ({ url, title, message })` to share something else (a Vault share link) or
  `share: false`. **Print** prints the read view alone, in the light colours, as the frame's Print does. **Open in
  its own window** opens the module's own page with the object's address. **Open as a window** is question 3.

### Deep links and back

- **The address.** Opening the window adds `#object=<module>.<kind>.<id>` to the page's address (the space page, a
  module's own page, a destination's page), replacing `#ref=` on a module's own page (the product is not released, so
  no alias is kept). Opening that address opens the space (or page), the owner module, and the window in read mode
  (question 10). A person who may not see the object sees "This isn't available to you." in the window and nothing
  else, the same rule as `host.objects.resolve`.
- **Back.** Opening pushes one history entry; the browser's back, Android's back button and the iPhone's edge swipe
  pop it, which closes the window (in edit mode, through the discard question: the entry is pushed again while the
  question shows). Closing the window by its own button goes back one entry, so the history never fills with
  windows. Switching read to edit does not push.
- **From another module.** `host.objects.open(ref)` for a kind that has a window opens the window over where the
  person is, with the owner module opened on the canvas behind it as today (question 9). A kind with no window keeps
  today's `onOpen`.

### The phone (640 px and below)

Proposed, pending questions 11 and 12. The aim is a shape made for a thumb and one hand, not the desktop window made
smaller.

- **A full-screen sheet**, not a window: `top: 0`, `height: 100dvh`, the safe-area insets as padding, no backdrop and
  no rounded corners. It rises from the bottom (a fade instead under `prefers-reduced-motion`).
- **The title bar** keeps its order but becomes the phone's bar: **Back** (`chevron-left`, "Back") at the start in
  place of Close, the title, then Edit (icon and word) and the menu. In edit mode: **Cancel** (a word) at the start,
  the title, **Save** (a word, primary) at the end: the pattern a phone's own apps use.
- **A bottom action bar** only when the module names one primary action for the read view (the Vault's
  **Download**), full width, 48 px, above the safe area. Nothing else goes there.
- **Tap areas.** Every control at least 44 by 44 px; facts as 44 px rows; field text 16 px so the phone does not zoom
  (the design system's rule); the menu as the bottom sheet the kind picker uses.
- **The keyboard.** In edit mode the focused field is kept in view above the on-screen keyboard (`visualViewport`), and
  the title bar stays at the top, so Save never goes under the keyboard.
- **Gestures.** Back as above. No swipe-down to close in the first steps (it fights scrolling the content); question 11
  asks whether to add it later.
- **The rest of the page.** The space bar's tab bar is under the sheet while it is open; the call keeps running, its
  keys work, and the tab bar's call dot is not visible until the sheet closes.

### Vault files

The Vault's `file` kind registers a window: `read` gives the name, the group, the size, who added it and when, and the
links; `domain` draws the viewer (the picture fitted, the `audio` or `video` element with `controls` and
`playsinline`, the PDF viewer layer laid over the window's content, Markdown read only); the toolbar row holds
previous and next; the phone's bottom bar holds **Download** where allowed. **Edit** is **Rename** (the name, and
nothing else). Share is the Vault's share link (`share` given by the module). Full screen stays the host's. This
replaces the viewer "inside the module's content area" with **Back** in the approved Vault plan, as Thomas decided on
2026-11-03 (question 13a; decision 19 of the Vault plan). `host.files.open(pointer)` becomes the window, and so does
a link to a file from any module: `host.objects.open` opens the same window over the canvas and does not bring the
Vault forward (question 9a, which this agrees with for files). Until this plan's step 1 exists, the Vault's step 3
may build the viewer on the existing window mode and move it here later (Vault plan, decision 20).

### Places and Maps

- **A place** (Places' `place` kind) registers a window: the category with its colour, the address, the notes, the
  links, and a small map as its `domain` part when a map is available (drawn by the Maps code through the bus, or by
  the merged module if [plan-places-and-maps](plan-places-and-maps.md) chooses one module). Edit is today's place form
  with **Where**.
- **A pin on the Map** opens its object's window (a place, a Planner stop, a Calendar event), through
  `host.objects.open`, instead of a popup of its own. Maps registers no kind: it stores nothing.
- On a phone the Map is full screen under the sheet; closing the sheet returns to the Map where it was.

### Words a person reads

- Title bar: **Edit**, **Save**, **Cancel**, **Close**, **Back**.
- The question: "Discard your changes?" with **Keep editing** and **Discard** (the editor window's words).
- "Someone changed this since you opened it." with **See their version** and **Keep editing**.
- "This was removed." "This isn't available to you."
- The status bar: "Changed by <name>, <when>" and the module's sentence for why the person may not edit.
- Never "card" or "item" for the object in what a person reads (`check-names`).

## Left to build, in order

Each step is built and checked on its own, bumps every module it changes, and leaves `npm run check` passing. The kind
of build is Thomas's to name; the planner suggests a production build for steps 1, 3 and 4 (the SDK every module uses)
and feedback builds for the module steps.

| # | Step | Who | Blocked by questions |
|---|---|---|---|
| 1 | **The window, read mode, in the SDK.** `host.objects.window.define` and `.open`; the modal dialog holding a module frame; the read view from data (`facts`, `text`, `links`) and the `domain` slot; the title bar with Close and the menu (module actions only); sizes; the phone sheet with Back; focus, Escape and focus return; reopening after `moved`. No module uses it yet; a test page draws one. | experience-design | 1, 2, 3, 11 |
| 2 | **The check** `tools/check-object-window.mjs`: the define shape and its thrown sentences, sliced out of `host.js` and run; the read view's data drawn to the expected markup; the stylesheet's tokens and the phone block; `check-module-layout` failing a module that draws the window's bands. | server-development | none beyond step 1 |
| 3 | **Edit mode.** Edit, Save and Cancel in the title bar; `edit()` and its handle; the discard question; the 409 and live-change lines; `canEdit` and the status bar sentence; a new object opening in edit mode. | experience-design | 4, 5, 6, 12, 14 |
| 4 | **Address, back, Share, Print, Open in its own window.** `#object=` on the space page, a module's own page and a destination's page (replacing `#ref=`); the history entry and back; `host.objects.open` opening the window; Share and Print for the read view. | experience-design | 9, 10 |
| 5 | **To-do** on the window: a row opens read mode; **New todo** opens edit mode; its editor dialog for tasks goes. The smallest module, and its read-only form already exists. | experience-design | 6, 8 |
| 6 | **The Planner** on the window, `large`: a card opens read mode; `moreInto`, `tpl-card-more` and `state.expanded` go; read facts are today's More rows and the card's slots; edit is today's form; a person without edit can read every object. `CONTRACT.md` follows. | experience-design | 7, 8 |
| 7 | **Calendar**, then **Research**, then **Places**, then **Polls**, one step each. | experience-design | 8 |
| 8 | **Map pins** open their object's window. | experience-design | the Places and Maps decision |
| 9 | **The Vault's viewer** as the `file` kind's window (with Vault step 3, or after it; question 13 is decided, a). If Vault step 3 went first on the existing window mode, this step moves it onto the object window. | experience-design | the title bar and toolbar question (Vault plan question 6) |
| 10 | **Open as a window**: the read window as a floating, non-modal window on the canvas. Not on a phone. | experience-design | 3 |
| 11 | **A module in a sandboxed frame**: the frame lifted to the window's size (the editor's `editor.lift`), the read view's data sent over the bridge and drawn by the host. | experience-design | none beyond step 3 |
| 12 | **Documentation**: [api-module-sdk](../api/api-module-sdk.md), [architecture-module-window](../architecture/architecture-module-window.md), each changed module's `CONTRACT.md` and user guide, the changelog. | content-manager | each step as it lands |

Steps 5 to 9 depend only on steps 1, 3 and 4 and may go in any order after To-do. Step 10 and step 11 come last.

## Verify

- **Step 1.** In headless Chromium on a local server, the test page at 1280 and 390 px, light and dark: the window over
  every module and the header; Tab stays inside; Escape and Close close; focus returns; the facts, Markdown and the
  links drawn; a long object scrolls inside the window with the title bar fixed; at 390 px the sheet fills the screen
  inside the safe area with Back at the start. `check-conformance` measures the window's bands. Checked by a tool
  from step 2.
- **Step 2.** `npm run check`; the new cases fail on a copy with a broken define shape and on a module drawing the
  window's bands.
- **Step 3.** On the test page: Edit, a change, Cancel with and without the question; Save; a 409 from a second
  browser; a live change while reading and while editing; `canEdit` false hides Edit and shows the sentence; at 390 px
  Save stays above the on-screen keyboard (headless Chromium can only approximate the keyboard: a real phone is
  needed).
- **Step 4.** Copy the address with a window open, open it in a second browser signed in as another member and as a
  guest; back closes the window, a second back leaves; back in edit mode asks first; Share's link; Print's page. The
  back gesture on a real iPhone and a real Android phone can be checked only on those phones.
- **Steps 5 to 9.** Each module on its own page and on a space's canvas, docked and floating, at 1280 and 390 px:
  every way an object opened before now opens the window; read, edit, save, cancel, delete; a person without edit;
  a link from Chat and from another module. `check-modules` and `check-module-versions` pass.
- **Not checkable here:** a real call with the window open (its keys and mute), real phones (the back gesture, the
  keyboard, the safe areas, one-handed reach), Firefox, Safari and a screen reader.

## A separate plan for phones (suggested scope, not written)

Thomas's second decision reaches well past this window. The planner suggests a plan of its own,
`plan-phone-experience.md`, written next if Thomas wants it (question 16), covering:

- **Principles**, decided once: thumb reach, one view at a time, sheets over windows, back always means "up one level",
  words beside icons where there is room, nothing that needs a hover or a right click.
- **An audit at 390 px** of every page and module, as [plan-unified-layout](plan-unified-layout.md) audited the
  windows: what is a shrunk desktop today (the Planner's timeline, Calendar's month grid, the Map's panel, Set up,
  Manage, Home).
- **Navigation:** the back gesture for every sheet and panel (Set up, the editor window, the kind picker, menus), the
  tab bar, and what a deep link opens on a phone.
- **Touch instead of drag:** long press and **Move to** where the desktop drags (the Planner, Calendar, To-do's links).
- **Input:** the on-screen keyboard, `visualViewport`, the phone's own date and time pickers or the SDK's, the
  camera and photo library for uploads.
- **The installed app:** home-screen install, a share target (send a photo or a link from another app into a space),
  notifications on a phone.
- **How it is checked:** `check-conformance` and `check-narrow` at 390 px, and a short real-device pass (an iPhone and
  an Android phone) for every phone step.

## Open questions

Each has options and the planner's suggestion, marked as such. The table above says which step each blocks.

1. **What draws the read view.** (a) Data only: the host draws facts, text and links; no module markup. (b) The
   module draws it in its shadow root, as forms are today. (c) Data, plus a `domain` slot for what only the module
   can draw (a picture, a map, a PDF). (a) cannot show a Vault picture or a map; (b) brings back per-module looks,
   against unified layout decision 2. *Suggestion: (c).* Blocks step 1.
2. **The SDK's name.** (a) `host.objects.window.define` / `.open`. (b) `host.ui.objectWindow`. (c) Fold into
   `host.ui.editor` with a read mode. (c) would turn a built, checked call into something else. *Suggestion: (a),*
   since `host.objects.open` from another module ends in it. Blocks step 1.
3. **Modal, or a window that stays open.** (a) Modal, like the editor: the page waits behind it. (b) A floating,
   non-modal window on the canvas from the start. (c) Modal by default, with **Open as a window** in its menu making
   it a floating window that stays while the person works (a later step). (b) means building focus and drop rules by
   hand, as the editor plan's option A2 found. *Suggestion: (c).* Blocks steps 1 and 10.
4. **After Save.** (a) Back to read mode on the saved object. (b) Close the window. (c) Back to read mode for an
   existing object; close for a new one, with focus on its new card, so adding several in a row stays quick.
   *Suggestion: (c).* Blocks step 3.
5. **Edit for someone who may not edit.** (a) Hidden, with the reason in the status bar when there is one. (b) Shown
   disabled, with the reason as its tip. (c) Hidden, nothing said. (b) shows a control most people can never use,
   and a tip is not reachable by touch. *Suggestion: (a).* Blocks step 3.
6. **Add, and the editor window.** (a) A new object opens the object window in edit mode, and `host.ui.editor` stays
   only for forms that are not an object (the Planner's plan dates, settings). (b) Add keeps `host.ui.editor`; only
   Edit uses the window. (b) leaves two looks for one form. *Suggestion: (a).* Blocks steps 3 and 5.
7. **More / Less on cards.** (a) Removed: the card is the summary, the window is everything. (b) Kept as a quick peek
   beside the window. (b) keeps two ways to see the same thing and a taller card on a phone. *Suggestion: (a).*
   Blocks step 6.
8. **What opens the window.** (a) A tap anywhere on the card not on its "..." or its one inline action. (b) Only the
   title. (c) An **Open** button on each card. (a) is the largest target on a phone; the Planner already drags only
   by its handle, so a tap does not fight a drag. *Suggestion: (a).* Blocks steps 5 to 7.
9. **Opening from another module.** (a) The window opens over where the person is; the owner module is opened on the
   canvas behind it, as today. (b) The owner module is brought forward and the window opens in it. (c) The window
   opens without the owner module on the canvas (the host loads its code out of sight). On a phone, (b) switches tab
   under the person; (c) needs a new way to run a module's code with no window. *Suggestion: (a),* and on a phone the
   tab does not change. Blocks step 4.
10. **The address and back.** (a) `#object=<module>.<kind>.<id>` and one history entry per window, back closes it,
    `#ref=` removed. (b) The address only, no history entry (back leaves the page, as today). (c) A path
    (`/o/<module>/<kind>/<id>`) the server redirects into the right space. (b) breaks the phone's back gesture, which
    a person will use first; (c) needs a server route and a space lookup for little gain. *Suggestion: (a).* Blocks
    step 4.
11. **The phone's shape.** (a) A full-screen sheet rising from the bottom, Back at the start. (b) A page pushed in
    from the right (the way a phone's own apps drill into a list). (c) A half-height sheet for reading that grows to
    full for editing. (c) suits a quick look but needs drag handles and fights scrolling. Swipe-down to close: later,
    or never. *Suggestion: (a), and no swipe-down for now.* Blocks the phone part of step 1.
12. **Where the phone's actions go.** (a) The title bar only: Edit, and in edit mode Cancel and Save, as a phone's
    own apps do. (b) A bottom action bar for Edit, Save and Cancel, for one-handed reach. (c) The title bar, plus a
    bottom bar only for one primary action a module names (the Vault's Download). *Suggestion: (c).* Blocks the phone
    parts of steps 1 and 3.
13. **The Vault's viewer.** **Decided (a), Thomas, 2026-11-03:** the viewer is a window (not a new browser window, not
    inside the Vault panel), and a link from another module opens the same window. The other options were (b) staying
    inside the Vault's content area with Back and only links from other modules opening the window, which would have
    given files a second way of being seen. The approved Vault plan's section 10 is changed to match.
14. **The edit form before `host.ui.form`.** (a) Each module's existing form goes into the window now (its markup,
    as the editor window does). (b) Wait for unified layout slice 13 and build edit mode on `host.ui.form` only.
    (b) waits on the largest slice in that plan. *Suggestion: (a),* moving to `host.ui.form` when it exists. Blocks
    steps 3 and 5.
15. **Where this goes in the queue.** (a) Now, before unified layout slices 10 to 13. (b) After the cards builder
    (slice 11), so `host.ui.card`'s `onOpen` and the window land together. (c) After all four builders. Thomas put
    those builders after the real-time steps on 2026-10-26. *Suggestion: (a),* since steps 1 to 5 need no builder and
    `host.ui.card` can call the window when it comes. Blocks the start.
16. **The phone plan.** (a) Write `plan-phone-experience.md` next, with the scope above. (b) Fold phone rules into
    each feature's plan as they come. (b) is how the phone ended up as a shrunk desktop. *Suggestion: (a).* Blocks
    nothing here.
17. **Viewer windows, several at once.** **Decided, Thomas, 2026-11-03:** several at once, not one reused; a cap of 4
    (suggested, not yet confirmed) with the sentence "Close a window to open another.", **Close all**, and one sheet
    at a time on a phone. Opening a file that has a window brings it forward. This needs step 10's floating window to
    exist for the object window; until then the existing window mode carries it (Vault plan decision 20).
18. **Previous and next, when a file is opened from another module.** **Decided, Thomas, 2026-11-03:** they walk the
    files linked where the window was opened from, else they are hidden; from the Vault's list they walk its list.
    The title bar and toolbar split stays open until Thomas sees the prototype drawing (Vault plan question 6). Blocks
    step 9.
19. **The public share page.** **Decided, Thomas, 2026-11-03:** it keeps its own viewer inside the page and shares code
    with the window.
20. **The mechanism and the order.** **Decided, Thomas, 2026-11-03:** the existing window mode first (Vault step 3),
    the general object window later (step 9 here moves it).
