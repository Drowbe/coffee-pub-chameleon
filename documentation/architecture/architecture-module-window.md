# Module Window Architecture

**Audience:** developers building or changing a module's chrome, or the host code that draws it
(`public/module-host.js`, `public/canvas.js`, `public/sdk/host.js`).

Every module a person can open -- docked beside the call, floating over it, in a window of its own, its
own standalone page, a destination's page or the composite that holds a destination's parts -- is drawn by one
function, `createModuleFrame` (`public/module-frame.js`), with its styles in the moduleframe block of
`public/sdk/system.css` (the `mf-` classes; sizes in [design-theme](../designsystem/design-theme.md), "The module
frame"). This is what keeps a module's own code identical wherever it is shown: it never draws a band, and it never
needs to know whether it is docked, floating, popped out or on its own page. The built-in Chat and call use the
frame's band classes for their own title bars, Chat's view row and status bar, so they look the same.

The frame has a variant for where it sits: `window` (edge, corner and shadow; a floating or popped-out window),
`docked` (a column of the canvas: its left edge only, no divider in the narrow layout) and `page` (it fills a page: no edge).

## The four levels

```
+----------------------------------------------------+
| Title bar  name          [actions] [+] [More] [X]   |  host.header.set, host.add.set, the standard actions
+----------------------------------------------------+
| Toolbar    switch | title | [buttons]  [search][Filters 2] |  host.toolbar.set (optional)
+----------------------------------------------------+
|                                                      |
|  Content                                            |  the module's frame; the drop area
|                                                      |
+----------------------------------------------------+
| Status     12 of 40 . Mine                  09:41   |  host.status.set (optional)
+----------------------------------------------------+
```

- **Title bar** (36px). The module's icon and name, then its own actions (`host.header.set`) as icon buttons, the
  **+** (`host.add.set`: exactly one action runs at once, more open the host's menu with a category's leaves in a
  flyout, a drill-in in the narrow layout), the menu button and **Close** where the window closes. The menu holds the module's
  own actions marked for it, then the standard actions that apply -- **Dock as a panel**, **Open as a window**,
  **Open in its own window**, **Settings**, **Share**, **Print** -- then the destructive ones last, red (the module's
  own, then the host's **Clear**). The host owns the standard actions; a module cannot add one. When the bar is
  narrow the icons fold into the menu, the last first, before the title is cut. The title bar is drawn on a module's
  own page too.
- **Toolbar** (40px), one row. The start group is the view switches, then the title and short notes, then the
  buttons; the end group is always the search and one **Filters** button, 12px from the edge in every window. Every
  `chips` item the module sends is a group in the Filters menu (a single choice or switches, with counts), and the
  menu starts with **Clear filters**. A toolbar button may be placed in the title bar or its menu instead of the row.
  When the row is too narrow the frame folds it in a fixed order and cuts nothing: the Filters button, then the
  switch to icons, secondary buttons to icons, the search to a magnifier that opens over the row, then whole controls
  into **More**. A switch too wide for the row folds only its last choices into **More**; the chosen one always stays in the row, and the whole switch moves only when even the chosen choice alone does not fit (`foldChoices` in `public/module-frame.js`). A switch holds up to 12 choices (`TOOLBAR_LIMITS.tabs`) and is named **Tools** to a screen reader and in **More**, unless the module gives it a `label`. Not window-level (that is the title bar) and not the add actions (that is the **+**). See
  "Reusable toolbar tools" below before building one from raw items.
- **Content.** The module's frame or in-page root. This is the section that scrolls, and the drop target for a
  dragged ref, either as a whole or onto specific objects within it. A docked module's content fills the whole
  column: there is no bar in the canvas's shared bottom row for a module. `"content": "flush"` in the manifest
  removes the content's padding (Maps, Stream).
- **Status bar** (24px). Words with a dot between, read-only, cut with an ellipsis when narrow; the `end` item is
  never cut. It is a labelled region, and the non-quiet words are read out politely once they have been still for
  1.5 seconds. It is not the space's status strip, which is the header's
  ([architecture-canvas](architecture-canvas.md), "The status strip").

**Zones on a destination page.** A module never chooses where its toolbar items go. A host page that draws a toolbar of its own can give an item a `zone`: `start` or `end`. An item in the `end` zone is drawn after the search and **Filters**, at the row's far right, carries `mf-zone-end`, and with `pin: true` is never moved into **More**; giving any item a zone also keeps the items in the order the page gave them, instead of switches first. The Calendar destination uses this (`zones: true` in `public/destination.js`): on the left the date group (the Calendar's title, back, **Today**, forward), then the **Month | Week | Day** switch; at the far right the panel's switch (**Agenda | To-do**), with the shown panel's own items before it. **Filters** sits between, after the free space. `cleanToolbarItems` and `frameToolbar` in `public/module-chrome.js` keep a `pin` only on an item that carries a `send` function, which only a host page can give, and `tools/check-conformance.mjs` measures the zones.

**Zones in a module's own row.** A module may also say `zone: 'end'` (exactly `start` or `end`; anything else is dropped) on `host.ui.toolbarButton`, `host.ui.viewSwitch` and the items of `host.toolbar.set`. Its right-zone items sit at the far right, after the search and **Filters**, in the order made. A module cannot set `pin` and cannot change the order of the rest of the row. So that a module can never cut its own row, only its first two icon-only buttons in the right zone (`MODULE_PINS` in `public/module-chrome.js`; the Whiteboard's **Snap to grid** is one) are held in place and never go into **More**; every other right-zone item folds into **More** like the left zone's, and a right-zone switch folds its own choices first. In a destination page, `partItems` in `public/destination.js` drops a module's `pin` and `zone`, so its items stay a module's. A switch's `label` is cleaned by `switchName` (plain text, spaces collapsed, at most 30 characters; ignored when empty, not a string or containing `<` or `>`; direction and zero-width characters removed). Only the switch's name is cleaned of those characters; other labels are not. Known limit: at a width of 110px with three or more right-zone icon buttons the row overflows by 12px (reported by the build; not fixed).

The rules for cleaning what a module sends, and for what each call becomes, are pure functions in
`public/module-chrome.js` (`cleanAddEntries`, `addPlan`, `frameAdd`, `cleanToolbarItems`, `frameToolbar`,
`cleanHeaderItems`, `titlebarActions`, `cleanStatusItems`, `statusFrame`), run by `tools/check-module-chrome.mjs`.
`createFrameBands(frame, { send, box })` in `public/module-host.js` joins the two: it takes a module's calls, draws
them in the frame and sends a control's use back as the `add`, `header` or `toolbar` event. It is used by
`mountModule` for a window, by `public/canvas.js` for the composite and by `public/destination.js` for the page.
The calls answer `true` wherever a module is drawn; only a dashboard widget has no frame.

**Destinations.** A destination's page is one module frame whose parts fill its width (its panel's stacked row is
a frame of its own with only a row). The parts hand their adds, actions, toolbar items and status to the page,
which draws them in its one title bar, row and status bar. In the composite on a space's canvas the parts have no
title bar or status bar of their own; the composite's window has them.

**Typing** belongs in Chat, not in a module: a module registers a command (`commands` in `module.json`) and Chat
routes the text to it ([plan-one-input](../plans/plan-one-input.md)). The old action bar (`host.bar.set`) is gone;
a module that still calls it has its buttons folded into the **+** as plain leaves. The call's own bottom control
strip and the chat's input row are native and unchanged.

**What was removed.** The toolbar's `progress`, `slider` and `separator` items and the status item's `chip` are
gone, and so are the old helpers (`createToolbar`, `createAddSlot`, `createStatusSlot`, `drawHeaderItems`) and the
old modulechrome block (`.mod-header`, `.mod-toolbar`, `.mod-status`, `.sdk-titlebar`, `.sdk-toolbar`,
`.sdk-status-line`). `tools/check-module-layout.mjs` fails a module that styles an `mf-` class or draws a band.
`tools/check-conformance.mjs` measures the frame in a browser: the sizes above, that the end group sits 12px from
the edge in every window and that no toolbar is cut.

## Overflow

Each zone that has one folds what it can't show into a "..." the host draws and opens (`openHostMenu` in
`public/host-menu.js`, which `public/module-host.js` imports and re-exports with `closeHostMenu`) -- the host's
own analogue of `host.menu.show`, needed because that one draws inside a module's own frame and these are
the host's chrome, outside it. The same menu serves the canvas title bars' "..." (`public/space.js`), the
profile menu under your picture and the space switcher in the top bar (`public/brand.js`) and the top bar's and the tab bar's "..." (`public/nav-bar.js`), see
[architecture-navigation](architecture-navigation.md). Only one is open at a time. It opens under its button,
flipped above when there is no room below. Its entries are `role="menuitem"`, or `role="menuitemcheckbox"` with `aria-checked` for an entry given `checked`,
and the button carries `aria-expanded`. From the keyboard: the first entry takes focus when it opens; Up, Down, Home and End move; Enter
or Space picks; Escape closes and puts focus back on the button; Tab closes. An entry is
`{ label, icon?, regular?, hint?, danger?, disabled?, checked?, badge?, onPick }`: `checked` (true or false) makes it
a checkbox entry that shows a tick while on (a toggle folded into the top bar's "..."), and `badge` is a count
shown after its label (the real number, no cap). An entry with `items` (a list of plain entries) is a category: a caret at its end and its entries in a flyout beside its row (a drill-in with **Back** in the narrow layout), which is how the titlebar's **+** shows a category. The "..." is drawn by
`drawMoreButton`, the same look as `host.ui.moreButton` (`.sdk-more`) inside a module. In every zone it sits
on the **left**, and leftover items come off the left, so the rightmost item stays. An item marked
`overflow: true` always goes into the "...", for something you always want tucked away (a destructive
action, say).

- **Title bar and toolbar.** At most five of a module's icons sit beside the title bar's menu; the rest go into
  the menu. The toolbar folds by the order above. Neither is a "..." that a module draws.

## Reusable toolbar tools

The toolbar is a small kit (`title`, `text`, `tabs`, `search`, `chips`, `button`), not a place for each module to
invent its own filter row from scratch. Where a pattern repeats, it gets a real helper in `host.ui`
instead of every module hand-rolling the same item array, the same signature-diffing (so a redraw does not
call `toolbar.set` when nothing actually changed) and the same `host.on('toolbar', ...)` wiring.

`host.ui.viewSwitch({ id, options, value, onChange, zone?, label? })` is the first of these: a labelled view or filter
switch, the toolbar's most common tool. It owns the diffing and the event listener; a module calls
`switcher.set(value, options?)` on every render and it only redraws when the value or a label actually
changed (an open count in one option's label, say). Four modules were duplicating this by hand before it
existed (Polls, Calendar, To-do, Planner, each with its own `headerSig`/`syncHeader` pair) -- all four now
call the one helper. Its name (`label`) is what a screen reader reads and the heading in **More**: **Tools** unless the module gives one. The bundled modules name theirs for what it chooses: Research **Whose** and **Layout**, Places **Whose**, Polls and To-do **Show**, and Calendar, the Vault and Budget **View**; Travel and the Whiteboard keep **Tools**. Reach for it, or add a new `host.ui.*` helper alongside it, before writing a second
copy of that boilerplate; see "Shared tools" in `api-module-sdk.md` for the same rule applied elsewhere in
the SDK.

## The action menu

A menu of independent actions with their own handlers -- a row's "...", a right-click, the + on a joint --
is `host.menu.show({ id, items, at, anchor })`, drawn inside the module's own frame (the one exception: opened
from inside an open editor window, below, it is drawn inside that dialog, so it is in the top layer with it). See
[api-module-sdk](../api/api-module-sdk.md) ("An action menu") for the shape. The host's own overflow menus
(above) are the same idea applied to the host's own chrome, where a module cannot reach to draw one itself;
they share no code with `host.menu.show` (different documents, in general -- a sandboxed module frame and
the space or module page around it), only the same visual language and the same "showing the same id again
closes it" rule.

## The editor window

A module's Add or Edit form is the one thing a module draws that is bigger than its window. It is a `<dialog>`
in the module's own root, shown modal through `host.ui.editor` (`createEditor` in `public/sdk/host.js`, its
styles in `/sdk/host.css` between `editor:start` and `editor:end`). A modal dialog is drawn in the browser's
top layer, above every module, the floating layer and the header, and no `overflow`, `z-index` or container
clips it, even from inside a shadow root; so the form is sized to itself (560 px, or 880 px for the Planner's
object form) rather than to a 240 px column, and is a full-screen sheet at 640 px and below. The dialog stays
in the module's tree, so the module's styles, the base stylesheet and the theme tokens still reach it. The
reasons and the options weighed are in [plan-editor-window](../plans/plan-editor-window.md); the contract a
module sees is in [api-module-sdk](../api/api-module-sdk.md), "An editor window".

What the SDK owns, so no module writes it twice: the close button in a sticky corner strip, the sticky button row
(`sdk-editor-actions`), Escape (handled on the key and stopped there, so the module's and the page's listeners
never see it; the dialog's own `cancel` event is prevented because a browser fires it only with a fresh user
activation, and a second Escape would otherwise close the dialog over the question), the "Discard your changes?"
row when the module's `isDirty()` says so, the backdrop that ignores clicks, the accessible name
(`aria-labelledby` the first heading) and focus on close. Focus is restored a microtask after `onClose`, because
a module that redraws its list after a save queues that redraw as a microtask too, and the row to return to is
in the redrawn list.

Three things follow from the dialog being modal, and are accepted (plan decisions 2, 4 and 9): the page behind
is inert, so the call's buttons cannot be clicked (its keys on `document` still work, since the dialog's keys
bubble to it; the SDK stops only Escape); nothing can be dropped on the module while its form is open (To-do's
drop onto the open form went, its link search stays); and the host's own overlays show under the backdrop.

**Popovers inside it.** `showMenu`, the date picker, the kind picker's list and `host.actions.pick` in
`public/sdk/host.js` ask `editorAt(anchor)`: the open `dialog.sdk-editor` the anchor is in, else the module's
topmost open editor (`pick` has no anchor and always takes the latter), else none. Inside an editor they append
to the dialog instead of the module's root, so they are in the top layer with it rather than inert under it, and
clamp to the window less 4 px rather than to the module's box. Each one's Escape is prevented and stopped, so it
closes only itself.

**The kind picker.** The one field inside a form that the SDK draws whole: `host.ui.kindPicker` (`createKindPicker`
in `public/sdk/host.js`, styles in `/sdk/host.css` between `kind:start` and `kind:end`) is the ARIA combobox
pattern over a list of named, iconed, coloured options in groups, with typing to filter and the recent choices
first, kept in `localStorage` under `app:kind:<moduleId>:<key>` as `host.actions.pick`'s `remember` keeps its
under `app:pick:...`. It is in the SDK rather than the Planner because the plan names two more users (Research's
note type, Places' category), and because the Planner's day "..." already lists the same kinds through
`host.menu.show`. The pure parts (`kindMatches`, `kindPickerGroups`, `kindRecentAdd`) are written so
`tools/check-module-window.mjs` can slice them out of `host.js` and run them, as it does the editor's sizes. In the narrow layout the picker's sheet is a stylesheet rule on `.sdk-kind.open .sdk-kind-sheet`, not a second element, so the
script only decides where the list is appended (the sheet in the narrow layout, the open editor or the root otherwise).
The contract is in [api-module-sdk](../api/api-module-sdk.md), "Choosing a kind"; the Planner's use of it, and
how one **Markers** group maps to the stored `block` and `lane` kinds through **Where** (`kindOf` and `tileAt` in
`modules/travel/src/travel-lib.js`), is in [plan-editor-window](../plans/plan-editor-window.md), Part 2.

**Moving.** `moveModule()` (below) takes the module's container out of the page and back, which drops an open
modal dialog out of the top layer. After the move the canvas delivers the event `moved` (`{ mode }`) and the SDK
reopens every editor the module has open (`openEditors`, dialog to `{ reopen }`): it removes the `open` attribute,
calls `showModal()` again and puts focus back on the last focused element inside.

**In a sandboxed frame** the top layer is the frame's own, so a modal dialog there would be clipped to the
module's window. The same `host.ui.editor` call therefore lifts the whole frame (step 11 of the plan; no bundled
module runs in a frame, so this is for uploaded modules). The SDK's `createEditor` gets a `lift(open, size)`
dependency only in a frame (`env.lift` from the frame boot, sending `editor.lift` `{ open, size }` over the
bridge); `open()` and `reopen()` ask for the lift just before `showModal()`, without waiting, and the dialog's
`close` asks for it to be put back only when no other editor of the module is open. When the host answers `true`
the dialog gets `sdk-editor-lifted` (`/sdk/host.css`): `position: fixed`, the frame's full width and height, no
border, radius or shadow, its backdrop the plain `--bg`, so the frame is the window and the dialog fills it.

The host's side is `liftFrame()` and `releaseLift()` in `mountModule()` (`public/module-host.js`). `editor.lift`
answers `false` for a module in the page (`pageMode`) and for a mount made with `lift: false` (`public/module.js`
in a window of its own, where the frame fills the window already); otherwise it lifts and answers `true`. The lift
gives the frame `module-editor-lifted` (`module-editor-lifted-large` for `large`), inserts `div.module-editor-backdrop`
before it, and makes the rest of the page `inert` the way a modal dialog does it: walking from the frame up to
`<body>`, every sibling of the frame and of each ancestor that is not already inert (the header, the canvas's
other modules, the floating layer, this module's own bar and toolbar), remembering which so the release
un-inerts exactly those. The release removes the class and the backdrop, and puts focus back on what had it before
only when focus is on nothing (it stays in the frame throughout otherwise). Lifting again (a second editor, or
the same one after a move) rebuilds the inert set and keeps the one backdrop. The release runs on the frame's
`load` (the module started over: no editor is open in it), in the mount's `destroy()`, and through the mount's
`lift(false)`, which `moveModule()` in `public/canvas.js` calls before moving a module between docked and
floating, since the move takes the backdrop away with the old chrome and the SDK reopens the editor (and asks for
the lift again) on `moved`. The canvas also hears `onLift(open, size)` and brings a floating module's box to the
front while it is lifted, so no other floating module draws over it.

The styles are in `public/style.css` between `lift:start` and `lift:end`: the backdrop fixed over the viewport,
`color-mix(in srgb, var(--bg) 70%, transparent)`, and the frame fixed and centered, `width: min(560px, 100vw - 32px)`
(880 px for `large`) by `calc(100dvh - 48px)`, the theme's border and background, both at `--z-menu` (above the
floating layer, so a docked module's lift clears the floating modules, and under the pages opened over the call);
at 640 px and below the frame is a full-screen sheet (`top: 0` with `height: 100dvh`, never `inset: 0`) over a
solid `--bg`; a short fade unless `prefers-reduced-motion`. The frame is exactly the editor's size, not wider
with the module showing behind, so nothing of the module is drawn at the lifted size but the form.

**A composite's editor (the Calendar, the Map) is the exception.** The frame of a composite holds the whole page of the Calendar or the Map, so shrinking it to the editor's size would blank the window the person was working in, and would change the page's layout behind the editor. `createFrameLift` takes `cover: true` for a composite (`public/canvas.js`). The lifted frame then keeps its own width and left edge and is the screen's full height, the rest of the screen dimmed. It answers the page with the box it had (`cover: { top, right, bottom, left }`), and `coverPage()` in `public/destination.js` keeps the page drawn in that box (`body.dest-covered`, `--cover-top`, `--cover-bottom`, on a clear ground) while the part's editor opens as an ordinary modal dialog over the screen, so the list stays visible behind it. The page's layout does not change while the editor is open. The editor window itself is the size of any editor; when the window is narrower than the editor, it is the narrow-layout sheet at that width. This replaces step 11's "the frame is the window, exactly the editor's size" for a composite; an uploaded module's frame is still lifted to the editor's size. Closing or dismissing the editor puts the page back (`editordismiss`).

`tools/check-module-window.mjs` holds the six migrated modules to the shape (a `<dialog id="editor" class="sdk-editor">`,
no `.editor { position: absolute; inset: 0 }` overlay, Cancel through `editor.cancel()`, nothing reading
`$('editor').hidden`, icons waited for together), and runs the SDK's `EDITOR_SIZES`, its handle and its thrown
sentence sliced out of `host.js`, with `/sdk/host.css`'s widths held to the same numbers and its colours to the
tokens. It also holds the lift: the frame boot's `lift`, the asks around `showModal()` and `close`, `sdk-editor-lifted`
filling the frame, and `style.css`'s lift block (the two widths equal to `EDITOR_SIZES`, the backdrop, the narrow layout
sheet without `inset: 0`, no fixed colours). `tools/check-module-host.mjs` runs `liftFrame()` and `releaseLift()`
sliced out of `module-host.js` on a stand-in page: the classes, one backdrop, exactly the right elements inert and
un-inert again, what was inert before staying so, and `canvas.js` and `module.js` doing their parts.

## Reuse across dock and float

Switching a docked module to floating (or back) does not rebuild it: `moveModule()` in
`public/canvas.js` hands the module's frame (`createModuleFrame`) and its mount to the new place, which draws the
same frame in the other variant, so whatever the module is holding onto (a conversation, a draft, a scroll position)
survives the switch. The module is told with the `moved` event (the SDK uses it to reopen an editor window, above).
A window is a real new page, so that still goes through `closeModule` + `popOut` instead -- a frame cannot move
between windows without reloading.

Because the bands belong to the frame and the frame is what moves, whatever `host.toolbar.set` and
`host.status.set` last drew goes with it.

## Rules

- **The "..." is one icon, and one control.** Every "more" affordance -- the host's overflow in a titlebar, a
  toolbar, a card's own menu, a day's, a place's, a poll's, the call's More -- is Font Awesome's
  `ellipsis-vertical`, centered. Inside a module it is `host.ui.moreButton` (class `.sdk-more`, styled by the SDK);
  in the host's chrome it is `drawMoreButton`, with the same class. Not the
  horizontal `ellipsis`, and not a text glyph standing in for it. It opens `host.menu.show` (a module's own) or
  the host's overflow menu; both look the same. Found by hand once (a vertical glyph on a poll, a horizontal
  icon everywhere else), which is what the check below is for.
- **A menu is one of two things.** `host.menu.show` inside a module, `openHostMenu` (`public/host-menu.js`) for the host's own chrome,
  and `host.actions.pick` (the drop menu, a choice) draws in `menu.show`'s look. Nothing draws its own list of
  actions.

`tools/check-module-window.mjs` enforces the first rule mechanically (the icon, and a `<button>` in a module's markup
with `ellipsis-vertical` must carry `sdk-more`; the call's own More is exempt), as part of `npm run check`, the way
`check-canvas.mjs` enforces the canvas grid's; add a rule there when the next drift shows the shape of one.

## What is not built yet

- **More enforcement.** The zones themselves (a bespoke action list instead of `menu.show`) are not checked yet; worth adding to
  `check-module-window.mjs` once a violation shows what to match.

Every module's own "..." menu that was a flat list of actions is on `host.menu.show` now (Places, Research,
Travel's gap-add, Polls). What is deliberately still native: Travel's item menu (`#item-menu`); and every
module's edit form is a real form with selects and fields, not a list of independent actions, so it is an editor
window (above), never a menu -- forcing those onto `host.menu.show` would be a regression, not a retrofit, since
it only draws a flat list of `{ label, icon, onClick }` rows.
