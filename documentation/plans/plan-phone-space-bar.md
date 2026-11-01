# Phone Space Bar Plan

**Audience:** Thomas, who decides what the space bar holds at 640 px and below and in a narrow popped-out window, and the session that builds it: experience-design (`public/nav-bar.js`, `public/space.js`, `public/canvas.js`, `public/style.css`, `tools/check-nav.mjs`). No server change.

**Status:** built 2026-10-03; approved 2026-10-03, with all six recommendations taken and the plan's own two choices (the 56 px least tab width and the `phone: 'bar'` marker) kept (decisions 1 to 8). Not built. From GitHub #160, found by QA on 2026-10-02 while testing the two-zone nav, and failing the same way on the code before it: "A module's nav tools on a phone. In a space at 390 px, a module that registers tools (`host.nav.set`) breaks the bottom tab bar: the module tabs collapse to zero width; the tools overlap Online; Leave is pushed off screen." And: "A pop-out narrower than 641 px. It draws the space bar without the phone styles. Online shows its full words, and the right zone, Leave included, runs past the window's edge." The issue's direction: "On a phone, a module's tools fold into the menu (or "…") instead of joining the tab bar. A narrow pop-out uses the phone layout." A third case, seen since: with five or more module tabs at 390 px, the last tab runs under Online's count. The TODO lists the pop-out case under the two-zone nav. [plan-layout-menu](plan-layout-menu.md) (decision 6, "No Layout on phones") says "A narrow pop-out follows #160".

**To be replaced in part:** on 2026-11-01 Thomas chose the fixed bottom bar in [plan-phone-experience](plan-phone-experience.md) (its decision 3); its step 6 replaces this plan's decisions 1 to 4 and 7 to 8 and `phoneTabs()`, cleanly.

## What it is today

**The space bar** (`#subnav`, built at the top of `public/space.js`) has two zones ([plan-two-zone-nav](plan-two-zone-nav.md), [architecture-navigation](../architecture/architecture-navigation.md), "The space bar"):

- **Left** (`.nav-left`): the Layout menu (`module-chooser`, `#modules-toggle` and its panel `#modules-menu`), **Join the call** (`join-call`, shown only out of the call, GitHub #165), Online (`who-here`, `fold: false`, with `fit`).
- **Right** (`.nav-right`, `.subnav-tools`): Full screen (`fullscreen-toggle`, order 11), Pop out (`popout`, 12), Pull participants back (`recall-button`, 51, a `labelled` button), Rejoin call (`rejoin-call`, 52, in an aside), a module's own tools (`host.nav.set`, `cleanModuleTools()`, orders 101 to 998), the **…** (`subnav-more`, 998, shown only while something is folded) and Leave (`leave-space`, 999).

**Wider than 640 px** `fitSecondary()` in `public/nav-bar.js` keeps the zones apart: Online shrinks to the width `fitWidth()` gives it, then `foldSteps()` and `foldCount()` fold the right zone into the **…**, whose menu (`openFoldMenu()`, `openHostMenu()` in `public/host-menu.js`) clicks the folded tool's own element. Leave never folds.

**At 640 px and below** (`max-width: 640px`):

- `placeSubnav()` in `space.js` asks `phoneWidth()` (the header's own window, so a popped-out window answers for its own width). On a phone it turns `#modules-menu` into the tab bar (`subnav-modules`, one `.modules-menu-item` per module, drawn by `update()` in `public/canvas.js`: the conference and the chat, then the space's modules), hides the Layout button, and moves `#subnav` to the end of `<body>`, so it sits at the bottom under the canvas. Popped out, it stays the header's second row (`topbarEl`) and only the tabs change.
- `fitSecondary()` does nothing on a phone (`phoneNow`): no tool folds and Online is not told to shrink. The comment says "On a phone the bar is the tab bar and none of this applies."
- The stylesheet's phone block for a space (`style.css`, "the space bar as a tab bar") makes `#subnav` a flex row 54 px tall: the tabs (`flex: 1 0 60px` each, icon over an 11 px name, never shrinking), Online as a count tab (48 px), Join as a tab reading "Join" (48 px), and Leave (48 px, in the danger colour). Full screen and Pop out are hidden (`#fullscreen-toggle`, `#popout`: "a phone has no use for either"). Everything else in the right zone is still drawn: Pull participants back, Rejoin call, and any module tool.
- While Join shows, the tabs narrow to `flex: 1 1 40px` so Join has room (#165's builder). Otherwise they keep 60 px and never shrink.
- At 560 px and below a second rule hides Full screen, Pop out and the bar's dividers, and the tabs' names; the phone block's own rule shows the names again inside a space.

**Why it breaks.** Read as code only (no browser here):

1. Nothing on a phone keeps the right zone narrow. A module's tools, Pull participants back or Rejoin call widen it, and the left zone (`min-width: 0`) gives way: the tabs' strip collapses and Leave goes past the edge. That is #160's first case.
2. Nothing limits the tabs. Five tabs at 60 px plus Online and Leave need 404 px at a 390 px window, so the last tab runs under Online's count.
3. In a popped-out window the bar stays inside the header, which at 640 px and below is a flex row (`.topbar { display: flex; justify-content: space-between }`), so the bar is squeezed onto the logo's row and its right zone runs out of the window. Why Online keeps its full words there is not clear from the code; the builder confirms the cause in a browser before fixing it. That is #160's second case. The pop-out opens at 480 by 300 px unless it was resized before (`prefs.popout`), so by default every pop-out is this case.

**What other plans already decided:** no Layout button and no Arrange anywhere on a phone ([plan-layout-menu](plan-layout-menu.md), decision 6); 640 px and below is the phone layout, a narrow popped-out window included, with one view at a time and no docked limit ([plan-docked-limit](plan-docked-limit.md)); a module's tools always go in the space bar's right zone, whatever `zone` they name ([plan-two-zone-nav](plan-two-zone-nav.md), "The registry"), so the host decides where they land; on a phone the top bar's right zone is the header's **Menu** (`phoneZones()`), and only a tool that says `phone: 'bar'` (the bell) stays in the bar.

## Decisions

From Thomas, 2026-10-03:

1. **A module's tools on a phone go in a … tab before Leave,** with Pull participants back. Reason: the space's actions stay in the space bar, and the fold's menu already does this wider (the issue's "…").
2. **Tabs that do not fit go in the same …,** and the view being shown always keeps its tab. Reason: a tab scrolled off sideways can't be seen to exist, and one overflow is simpler than two.
3. **Join takes its own place, and one tab fewer shows.** #165's narrowing of the tabs to 40 px goes. Reason: one least width for every tab, and the names stay readable.
4. **Rejoin call, in an aside, is a tab in the bar,** before the **…**. Reason: it is the aside's way back to the space's call, and the bar has room for it.
5. **A narrow pop-out's bar sits on the header's second row,** its own row, sliding away with the header when idle. Reason: an idle pop-out stays only the tiles, which is what it is for.
6. **Full screen and Pop out are entries in a narrow pop-out's ….** On a phone and in a narrow main window they stay hidden. Reason: in a pop-out both still do something.
7. **The least width of a tab is 56 px.** Reason: today's 60 px fits one tab fewer at 390 px.
8. **A right-zone tool that stays in the tab bar says `phone: 'bar'`,** the marker the top bar already uses for the bell. Reason: one marker for both bars, and `cleanModuleTools()` already keeps a module from setting it.

## The contract

### Phone or not

- The space bar is the phone's tab bar when **the window it is drawn in** is 640 px wide or less: a phone, a narrow desktop window, or a narrow popped-out window. `phoneWidth()` in `space.js` and `fitSecondary()` already ask that window; the rules below apply to all three. Crossing 640 px either way redraws the bar (both already listen).

### What the tab bar shows, left to right

1. **The module tabs** that fit (see "How many tabs fit").
2. **Join**, while it shows (out of the call, where the person may see the conference), as now: the phone over "Join".
3. **Online's count**, as now: an icon over the count, `fold: false`. Its list opens on screen: `.who-here-list` opens below its button (`top: calc(100% + 6px)`), which at the bottom of a phone puts it under the window's edge (read as code; no phone rule moves it), so on the tab bar it opens above it.
4. **Rejoin call**, in an aside (decision 4): a tab, its icon over "Rejoin".
5. **The …** (`#subnav-more`, kept), drawn as a tab (its icon over "More"), shown only when something is in it.
6. **Leave**, last, as now. It never folds and is always inside the window.

Nothing in the bar is ever drawn past the window's edge or under another control. The Layout button is not drawn (plan-layout-menu, decision 6).

### What goes in the … on a phone

- **Every right-zone tool but Leave** goes into the **…**, in the bar's order: Pull participants back and a module's own tools always; Full screen and Pop out only in a popped-out window (decision 6; on a phone or a narrow main window they stay hidden as now). Rejoin call stays in the bar (decision 4).
- **The tabs that do not fit** go in it too, ahead of the tools, with a divider between the two.
- A tool keeps its own `visible`: a hidden tool has no entry. A module tool is never in the tab bar itself on a phone.
- **How it is marked.** A right-zone page tool that stays in the tab bar says `phone: 'bar'`, the marker the top bar already uses for the bell (Leave and, per decision 4, Rejoin call). `cleanModuleTools()` already drops anything it does not know, so a module can never set it. This is the space bar's counterpart of `phoneZones()`.
- **The menu** is the existing one: `openFoldMenu()` and `openHostMenu()`, which already opens above its button when there is no room below. A folded tab's entry is its icon and its name; picking it clicks the tab's own element, so it shows that module exactly as the tab would. The tab of the view being shown is never in the menu (see below). A tool's entry is as today: a toggle as a checkbox entry, a count as a badge, a pick clicks its element.
- **Counts.** The **…**'s badge adds up the folded tools' counts (as today) and the folded tabs' unread counts. If the conference's tab is folded while the person is in the call, the **…** carries the conference tab's in-call dot (green, red while the microphone is live), so nobody talks unseen.
- Keyboard and focus follow today's fold rules (`fitSecondary()`): a pick that brings a tool back puts the focus on it, else on the **…**, else the first control in the left zone.

### How many tabs fit

- **The least width of a tab is 56 px** (`TAB_MIN`, decision 7: today's 60 px fits one fewer tab at 390 px; the builder confirms an 11 px name still reads, cut with an ellipsis as now). Tabs share what is left equally and never go below it. Join, Online, Rejoin call, the **…** and Leave keep 48 px each.
- **The count is a pure function** in `public/nav-bar.js`, for example `phoneTabs({ width, fixed, more, tabMin, tabs, shown, foldsTools })`:
  - `width`: the bar's inner width; `fixed`: the widths of the controls that always show (Join when shown, Online, Rejoin call when shown, Leave, and the gaps); `more`: the **…**'s width; `tabs`: the tab ids in order (the conference, the chat, then the space's modules); `shown`: the id of the view being shown; `foldsTools`: whether any tool is in the **…** already.
  - With nothing to fold (`foldsTools` false) and every tab fitting at `tabMin` in `width - fixed`, every tab shows and the **…** does not.
  - Otherwise the **…** shows and takes its width; the first `floor((width - fixed - more) / tabMin)` tabs show, at least one. If the view being shown is not among them, it takes the last place, so the shown view always has its tab.
  - Answers `{ shown, folded }`: tab ids in order. Pure: no DOM, the same answer for the same input.
- **For example** (at 56 px, Online and Leave only): 390 px holds five tabs, or four and the **…**; 320 px holds three and the **…**. With Join showing, one tab fewer.
- **Join no longer narrows the tabs** (decision 3): it takes its own 48 px and the tabs that no longer fit fold. The #165 rules (`.subnav:has(.join-call:not([hidden])) .subnav-modules` and its `flex: 1 1 40px`) go.
- **Where it runs.** `fitSecondary()` gets a phone branch in place of doing nothing: it measures the bar, asks `phoneTabs()`, marks the folded tabs with `nav-folded` (the class the fold already hides with `display: none !important`), folds every right-zone tool that is not `phone: 'bar'`, and shows the **…** when either list has anything. It runs on a resize, when Join, Online or Rejoin call show or hide (both already redraw the bar), and when the tabs change: `update()` in `canvas.js` does not redraw the bar today, so after drawing the phone's tabs it asks for the fold again (`nav.draw('secondary')`). Wider than 640 px nothing changes: no tab is ever folded there (there are no tabs).

### The narrow popped-out window

- At 640 px and below the popped-out window's bar is the same tab bar: the same tabs, the same **…**, Join, Online's count and Leave, with the phone's look (`body.in-space` already matches there; `body.popout` is added).
- **Where it sits** (decision 5): the header's second row, its own full-width row under the logo's, not on the logo's row. It slides away with the header when the window is idle (`.popout:has(.canvas.idle) .topbar`), so an idle pop-out is still only the tiles, as now. `placeSubnav()` keeps it in the header when popped out, as now; the stylesheet gives it its own row there (for example the header wrapping, with the bar `flex-basis: 100%`).
- **Full screen and Pop out** are entries in its **…** there (decision 6): Full screen makes the pop-out fill the screen, and Pop out reads as today's toggle ("Pop it back in" while popped out). On a phone and in a narrow main window they stay hidden.
- A pop-out wider than 640 px is unchanged: the wide bar with its fold.

### What stays the same

- Ids, classes and routes: `#subnav`, `#modules-menu`, `.subnav-modules`, `.modules-menu-item` and its `data-builtin` and `data-module`, `#join-call`, `who-here`, `#subnav-more`, `#leave-space`, `#rejoin-call`, `#recall-button`, `#fullscreen-toggle`, `#popout`.
- The wide bar: `foldSteps()`, `foldCount()`, `fitWidth()` and the fold's order are unchanged.
- The SDK: `host.nav.set` is unchanged for module authors; on a phone their tools are menu entries, as they already are wider when they fold.
- Words: "More" (the **…**'s name, as now), "Join", "Rejoin" (the tab's short word; its accessible name stays "Rejoin call"). Nothing else new.

## Left to build, in order

All experience-design. Documentation after each step is content-manager's: [architecture-navigation](../architecture/architecture-navigation.md) ("The space bar", "The fold", the phone rules), the user guide's space bar on a phone, the SDK reference's "Registering into the nav bars" (a module's tools are in the **…** on a phone), the CHANGELOG, and the TODO's pop-out line under the two-zone nav.

1. **The pure parts.** `phoneTabs()` and the phone fold of the right zone (for example `phoneFold(list, { popped })`, the ids that go into the **…**: every tool but those that say `phone: 'bar'`, and Full screen and Pop out only when `popped`) in `public/nav-bar.js`, exported on `nav`; `phone: 'bar'` on `leave-space` and on `rejoin-call` (decision 4). No behaviour changes yet.
2. **The tab bar on a phone.** `fitSecondary()`'s phone branch: the right zone into the **…**, the tabs that do not fit into the **…**, the **…** drawn as a tab, the folded tabs' entries, counts and in-call dot on the **…**; the stylesheet's tab least width, Rejoin as a tab, the #165 narrowing rules removed. This fixes #160's first case and the five-tab overlap.
3. **The narrow popped-out window.** The bar on its own row in the header at 640 px and below, sliding away with it when idle; Full screen and Pop out in its **…**; the cause of Online's full words found and fixed. This fixes #160's second case.

## Verify

- **Step 1.** Checked by `tools/check-nav.mjs`: `phoneTabs()` at 390 px with three, five and eight tabs (all shown; five shown; four and the **…**), with Join showing (one fewer), with a tool already folded (the **…** reserved), with the shown view past the cut (it takes the last place), at 320 px (at least one tab), and the same answer for the same input; the phone fold folding Pull participants back and module tools, keeping Leave and the tools that say `phone: 'bar'`, and folding Full screen and Pop out only when popped; `cleanModuleTools()` dropping a module tool's `phone`.
- **Step 2.** Checked by `tools/check-nav.mjs`: the stylesheet's tab least width, Rejoin's tab rule, and no `.subnav:has(.join-call` rule left; `fitSecondary()` no longer returning early on a phone (read in the source, as the existing cases do). Live in headless Chromium with the faked LiveKit, at 390 and 320 px, signed in as a member: two, five and eight modules in a space; out of the call (Join showing) and in it; in an aside (Rejoin call); a module tool registered from the console through `nav.register` with a module's shape (no bundled module calls `host.nav.set`): in each case Leave's box inside the window, no two controls overlapping, the tabs at least 56 px, the **…** holding the folded tabs then the tools, a pick showing that module or doing what the tool does, the **…**'s badge, the in-call dot on the **…** with the conference folded, Online's list opening on screen; crossing 640 px both ways.
- **Step 3.** Live in headless Chromium, as far as it goes: a popped-out window can't be opened there (the test browser blocks popups), so the check moves the header into a 600 px wide second document the way `setUpPopoutWindow()` does, or uses a browser that allows the popup if QA has one: the bar on its own row under the logo's, Leave's box inside the window, Online as its count, Full screen and Pop out in the **…**, the bar sliding away with the header when idle and back on a movement; at 700 px the wide bar as now.
- **Not checked by a tool:** that Leave stays inside the window is a layout fact, so it is a live check, not a `check-nav` case; the repository has no browser checks. **Needs a real call:** the in-call dot on the **…** with a live microphone; Online's count as real people come and go. Not checked here: a real phone (iPhone Safari, its bottom bar and safe areas), a real popped-out window, Firefox, Safari, a real screen reader.

