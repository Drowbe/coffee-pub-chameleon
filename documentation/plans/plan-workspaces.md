# Workspaces and a Dedicated Conference Plan

**Audience:** Thomas decides. If he approves, server-development builds the space record, the routes, the stored last-layout record and the checks, and experience-design builds the Conference view, the owner controls and the menu entry. The stored last-layout record (decision 20) is a core change (`server/`, the stored data format): it is held for an independent read and covered by the full `npm run check`. content-manager documents after.

**Status:** Draft for Thomas, 2026-11-12, by product-planner; updated 2026-11-12 with Thomas's answers to questions 2, 4 and 5 (decisions 12 to 14), to question 1 (decisions 15 to 18, the last about the collapsed call area) on 2026-11-12, to questions 3 and 6 to 12 (decisions 19 to 26) and, on 2026-11-12, to the four open points on the guest fallback, Start call, phones and In the workspace (decisions 27 to 30) and, on 2026-11-13, to the open points on the collapsed rail (decision 31) and, on 2026-11-13, to a correction of decision 28 after trying the call title bar build (decision 32) and, on 2026-11-13, to the two kinds of workspace, the Modules tab of a Fixed Workspace and its schema (decisions 33 to 35, step 12). Nothing here is decided except the lines marked "Thomas" and the decisions below. Nothing is built. From the feedback and from Thomas, in his words:

> "we've made conference (video) so secondary, there is no way to have a dedicated call without popping it out."

> "there are two modes of use: 1. Collaboration Mode: chat/video are NEXT TO the work being collaborated on; 2. Communication Mode: focused only on chat/video. We can easily accomplish this with both a dedicated workspace and an option in the "view" context menu that lets the user choose where to place the video in relation to the chat. I actually have ideas around workspaces too. We need to think through our set of "fixed" workspaces (that can't be changed). I am thinking: Workspace, Conference, Calendar, Map, Whiteboards, Documents. For a space an owner could dictate which space is default. They can say which show on the main nav (like we do with favorites). They can change the order of the fixed layouts."

> "There is no 'todo' without calendar, right? It is part of calendars now."

Thomas also asked for "Map and Places as one" (a separate decision; the Map entry here is Maps) and a dedicated To-do list with a "show in the calendar" setting (a separate decision in progress). This plan does not design either; it leaves room (see "The fixed set").

The popped-out window bug (module windows never return to where they came from) is a separate bug. It is mentioned only under "Pop-outs".

**What was read.** Read in full or in the parts that matter: `CLAUDE.md`; [plan-layout-views](plan-layout-views.md) (decisions, model, Phase 2), [plan-favorite-layouts](plan-favorite-layouts.md), [plan-one-bar](plan-one-bar.md) (decisions), [plan-optional-conference](plan-optional-conference.md), the head of [plan-call-as-module](plan-call-as-module.md) and of [plan-phone-experience](plan-phone-experience.md) (decision 16); [architecture-navigation](../architecture/architecture-navigation.md) (the layout tabs), [architecture-canvas](../architecture/architecture-canvas.md) (the always-on column, narrow windows, remembered layouts, saved layouts); `documentation/TODO.md` and `known-issues.md` (searched for the call, layouts and pop-outs, not read end to end); in code, `public/opens-with.js` (all), `public/primary-nav.js` (`layoutTabs()`, `tabOverflow()`), `public/canvas.js` (`restore()`), `public/space.js` (`DEFAULT_PREFS`, `popOutCall()`, `setCallPosition()`, `callPlaceItems()`, `layoutMenuItems()`, `systemRowItems()`, `pressLayoutTab()`), `public/composites.js` (head), `server/layouts.js` (system layout parts), `server/index.js` (`systemLayoutsFor()`, the layouts routes), `server/store.js` (`defaultLayout`), `server/destinations.js` (head), `modules/*/module.json` (destination parts). **Not read:** `public/destination.js`, `public/nav-bar.js` beyond a search, `public/module-stream.js` (it is the page's event stream hub, not the call), the call's tile code, `userguide-call.md` beyond a search. Nothing here was run: no server was started and there is no LiveKit.

## Why

Chat and video sit beside the work in an always-on column ([plan-one-bar](plan-one-bar.md), decision 2). That is right for working together. It is wrong for a briefing, a game night or a plain call, where the call is the work. Today the nearest things are a wide column (the splitter lets the chat take the whole window, but the call strip is still capped at 55% of the column height, `CALL_MAX_SHARE` in `public/space.js`) and **Its own window**, which needs a second window and, after the pop-out bug, does not come back cleanly. An Aside is call-only, but it is a different, temporary thing and is made from outside the space.

A second gap shows in Set up. The Modules tab is the canvas menu in every layout today, so Calendar's Modules tab lists modules no one could run beside a calendar. Decisions 33 to 35 split the workspaces into two kinds and give a Fixed Workspace a Modules tab that shows only what it offers.

Thomas's two modes, in the words this plan uses:

| Mode | What a person sees | How it is reached |
|---|---|---|
| **Collaboration** | The work, with the chat and the call beside it | Any layout except Conference (today's default) |
| **Communication** | The call and the chat, filling the page | The Conference layout |

Thomas, 2026-11-13, on the two kinds of workspace (decisions 33 to 35):

> "there are two kinds of workspaces. The first type is what we have today, which is a canvas where the user can configure any number of modules into that space, name that space, and put that space on their navigation bar. The second kind of a workspace is not as flexible for the user. This is a fixed layout workspace where the admin or the mod or our software controls the content and behaviors of that workspace. For instance, we have a workspace called calendar. When you go into the calendar workspace, it is fixed. And going forward, probably should not be configurable. So when you go into the settings for that workspace, and you have the modules tab selected, only the modules that you can turn on and off there should exist. And we should control that with some sort of a schema. So for calendar, there's really nothing you'd want to run next to that. For map, there's nothing you'd want to run next to that. For conference, there's nothing you'd want to add next to that. So for those configurations, we just put a message saying there's nothing configurable."

> "If they are two kinds of the same thing we should NAME them accordingly."

## What it is today

Most of the structure Thomas describes already exists, built under [plan-layout-views](plan-layout-views.md) (built 2026-10-13). This plan extends it; it does not start a new system.

- **Every view is a layout.** `systemLayoutsFor()` in `server/index.js` makes three system layouts per space, never stored: `workspace` (always), `calendar` (while the Calendar destination answers here) and `map` (while Maps is on and has a map file). Ids are in `SYSTEM_IDS` in `server/layouts.js`; the client has its own copies (`SYSTEM_TAB_DEFAULTS` in `public/primary-nav.js`, `SYSTEM_TABS` in `public/opens-with.js`, `SYSTEM_DEFAULTS` in `server/store.js`).
- **Tabs.** `layoutTabs()` draws Workspace first, then Calendar and Map, then the person's favorite saved layouts, in the top bar after the space switcher. `tabOverflow()` moves the ones that do not fit into a **...** menu. There are no tabs for a guest, in an Aside, or in the narrow layout.
- **Who chooses.** Today the choices are each person's own, per space: a name, an icon and `tab: true|false` per system layout (`layouts.json`, `system.<user key>`). The owner's override and reordering are Phase 2 of plan-layout-views (issues #266 and #267), not built.
- **The default.** A space's `defaultLayout` (a shared layout id, or `calendar`, or `map`) says what a first visit opens; PATCH goes through `updateSpace()` in `server/store.js`; owners, the admin and moderators may set it (`MODERATOR_SPACE_FIELDS`). `firstVisitLayout()` in `public/opens-with.js` decides; after the first visit a person's remembered arrangement wins. A guest gets the Workspace.
- **Only the Workspace remembers** (plan-layout-views, decision 15). While another layout is shown, `pressLayoutTab()` calls `canvas.holdMemory()`; going back to Workspace calls `canvas.resumeMemory()`. Entering a space always shows the Workspace tab (`currentLayoutTab = 'workspace'`, `public/space.js` 5837).
- **The call and the chat** are in the always-on column (`#side-column`), in every layout, not on the canvas (`columnMode()`). **Call position** (`callPlaceItems()`, `setCallPosition()`) puts the call Top, Bottom or Left of the chat, Floating over the Workspace, or in Its own window. It lives in the call's titlebar **...** and in Chat's **...** (Thomas's screenshots show **Pop out the call** and **Call position** on the chat's menu, beside **Save the chat** and **Delete the chat**), the call's title bar ("Call · 00:36", with its own pop-out and collapse buttons) is drawn only while a call is active, and is kept in the browser's call preferences (`prefs.callPosition`, `prefs.callFloat`, key `app.call`), which are not per space.
- **Phones** (640px and below): no column, no layout tabs; the call and the chat are tabs of the narrow layout. [plan-phone-experience](plan-phone-experience.md) decision 16 (call in the top bar, four module buttons) is drawn on the Prototype and not built in the product.
- **Asides** are a call-only screen: no chat pictures, no modules, and the column is the whole screen (`inAside()` in `public/space.js`).
- **The Modules tab** of Set up is the canvas menu in every layout, fixed or not: it lists the modules and the arrangement controls (Arrange, Layouts, the module menu **Open for you**, adding and removing modules on the canvas), whatever layout is shown. It does not know that a Calendar, Map or Conference layout is not a place to arrange anything. The To-do switch **Show To-do in the Calendar** is an ordinary module setting: the `inCalendar` setting of the To-do module, with `needsModule: calendar` and the panel flag `showWhenSetting` (merged 2026-11-13, #783).
- **There is no "View" menu.** The nearest are the **Layout** menu (Show, Arrange, Layouts; `layoutMenuItems()`) and the call's **Call position** entries.

## Decisions

Thomas, 2026-11-12 (from the brief above). Everything else in this plan is a suggestion until he answers.

1. **Two modes of use,** Collaboration and Communication, as in the table under "Why".
2. **A dedicated Conference layout** is the way to reach Communication, and **an option in the View menu** lets the person choose where the video sits in relation to the chat.
3. **A set of fixed layouts that cannot be changed:** Workspace, Conference, Calendar, Map, Whiteboards, Documents.
4. **Owner controls, per space:** which fixed layout is the default, which show in the main nav (like favorites), and their order.
5. **To-do is part of the Calendar** for this plan. Maps is the Map layout.

Thomas, agreeing with the planner's opinion ("I think you are correct"), the starting point:

6. The call is **a page-size view of its own,** not an easier pop-out.
7. The choice is remembered **per person and per space.**
8. **Today's layout stays the default,** so nothing changes for anyone who likes it. The call is not made bigger by default.
9. **Phones** get the call full screen with a one-tap way back to the canvas.
10. **Pop-out stays** for second monitors.
11. **No separate calls-only product mode.** That is what an Aside is. The gap is choosing it inside an ordinary space.

Thomas, 2026-11-12, answers to the open questions (DECIDED):

12. **The call's share of the Conference page (question 2): no fixed percentage.** In his words: "it should honor whatever the chat area already takes and then fill the workspace area." In the Conference layout the chat column keeps the width it already has and the call takes all the rest of the page. There is no percentage setting.
13. **Who controls tabs (question 4): the owner sets what shows and the order.** A person may hide more, rename and re-icon. The owner's hide wins. A person cannot reorder. This builds the planned "Phase 2" owner override of plan-layout-views (issues #266 and #267).
14. **New tabs on day one (question 5): all three new tabs show** (Conference, Whiteboards, Documents). The **...** overflow keeps the bar from crowding, and people can hide them.

Thomas, 2026-11-12, answer to question 1 (DECIDED), after showing two screenshots: the Discussion column with the chat's three-dot menu holding "Save the chat", "Delete the chat" and "Pop out the call", and "Call position" with its flyout (Top of the column, Bottom of the column, Left of the chat, Floating window, Its own window); and the call's title bar ("Call · 00:36") with its own pop-out and collapse buttons over the participant tile and call controls. In his words: "Part of our issue now is that we do not show the call titlebar area unless a call is active. We should have it shown all the time and have the menus for it where they belong, which is not on a different window like they are now. So I would say there are two options missing: to the right of chat; in the workspace."

15. **The call title bar area is shown all the time,** not only during a call. With no call active it holds the title "Call", a **Start call** button and the call's menu.
16. **The call's menu items live on the call's own title bar menu,** not on the chat's three-dot menu: **Pop out the call**, **Call position** and the other call options. The chat's menu keeps only chat items: **Save the chat** and **Delete the chat**.
17. **Call position gains two positions** to the existing five (Top of the column, Bottom of the column, Left of the chat, Floating window, Its own window): **Right of the chat** and **In the workspace** (the call becomes a tile in the workspace area instead of a column). What it means is set by decision 30: the same call area, sitting in the canvas area, with no new chrome.

18. **The conference icon stays visible when the call area is collapsed** (Thomas: "we should also show the conf icon when the area is collapsed"). When the column is collapsed, the call's icon stays in the collapsed rail so the person can see the call area exists and reopen it with one click. While a call is active it shows the live state. This goes with decision 15; decision 31 settles the details.

Thomas, 2026-11-12, answers to questions 3 and 6 to 12 (DECIDED). Two of them differ from the planner's suggestion (decisions 20 and 21).

19. **Only the six fixed layouts (question 3):** Workspace, Conference, Calendar, Map, Whiteboards, Documents. No preset for Budget, Polls, Vault, Research, Planner, Stream or the others. They are reached through the Workspace, or through a saved layout and a heart.
20. **The last layout is remembered on the server, per person and per space (question 6).** Not the browser-only option the planner suggested. Entering a space opens the layout the person last used there. This reverses today's "entering opens on the Workspace" for a person who has a remembered choice. Decision 8 stands: a person with no remembered choice gets today's default. This adds a stored record and a route, so it is a core change (see "The last layout, on the server").
21. **Guests follow the owner's default (question 7).** Not the always-Conference option the planner suggested. What a guest sees when the owner's default is a layout a guest can hardly use is answered by decision 27: the Workspace.
22. **Owners, the admin and moderators set the default, the tabs and their order (question 8),** as `defaultLayout` is set today.
23. **Icons (question 9):** each module's own icon where it has one, and a video glyph for Conference.
24. **Asides stay their own thing (question 10),** sharing the column code with the Conference layout.
25. **No cap on the main nav (question 11).** The **...** overflow handles a crowded bar.
26. **"Bring everyone to the Conference" is left out of version 1 (question 12).** It is listed under "Not in version 1".

Thomas, 2026-11-12, answers to the open points (DECIDED).

27. **Guest fallback.** When the owner's default layout is one a guest cannot use, the guest gets the Workspace, as today, not the Conference. Decision 21 stands: a guest follows the owner's default where they can use it.
28. **SUPERSEDED on 2026-11-13 by decision 32 (the large button rule only; the title bar part stands).** Earlier wording: **Start call with no call active** sits in two places: on the always-shown call title bar (decision 15) and as a large button in the call's own area. The call area shows a large **Start call** button when it is empty, as the Conference layout does.
29. **Phones.** **Right of the chat** and **In the workspace** are not offered on phones. The call stays a full-screen tab with its menu.
30. **"In the workspace" adds no new chrome.** Thomas: "We discussed this in the planning. The functionality above the chat says exactly like it is." Read as: the call keeps exactly the title bar, menu and controls it has above the chat (decisions 15 and 16). **In the workspace** only changes where that same call area sits: in the canvas area instead of a column. How it is saved and restored with an arrangement is an implementation detail for the build, not a question for Thomas. The builder reports back only if it would need new chrome or a new stored shape.

Thomas, 2026-11-13, answers to the open points on the collapsed rail (DECIDED).

31. **The collapsed rail (decision 18's open points).**
    - **Where.** The conference icon sits beside the chat button in the collapsed rail.
    - **The live state** is a small dot while a call is active. It is not the elapsed time.
    - **What pressing it does.** It reopens the call area. It does not start a call. **Start call** is on the call title bar (decision 15) and, where the call fills an area of its own, in that area (decision 32), not in the rail.
    - **Keyboard and screen reader.** It is a button in the tab order with an accessible name such as "Show the call". It says the call is active to a screen reader, as the unread badge does.
    - **Phones are unchanged.** There is no column and no rail on a phone, so nothing is added there.

Thomas, 2026-11-13, after trying the merged call title bar build (#767) and seeing a large **Start call** button in the empty call area of the side column (DECIDED, a correction). In his words: "I misunderstood this. I only expected that button if the conf was opened in the workspace area, not there."

32. **Decision 28 is corrected: where the large Start call button shows.**
    - **On the call title bar, in every position:** **Start call** stays on the always-shown call title bar (decision 15) while no call is active. This part of decision 28 stands.
    - **The large Start call button in the call's own area** shows only when the call fills an area of its own: **In the workspace** (decisions 17 and 30) and on the **Conference** layout (step 4).
    - **Not in the side column.** The large button does not show for Top of the column, Bottom of the column, Left of the chat, or Right of the chat when it is built. There the title bar's **Start call** is the only one.
    - The earlier wording of decision 28 is kept above, marked superseded, so the history reads.

33. **Two kinds of workspace, named Customizable Workspace and Fixed Workspace (the two names are Thomas's).** In his words: "If they are two kinds of the same thing we should NAME them accordingly."
    - **Customizable Workspace** is today's canvas: a person arranges any number of modules in it, names it and puts it on their own bar. Today's **Workspace** and the saved layouts a person hearts are Customizable Workspaces.
    - **Fixed Workspace** is a workspace whose content and behaviour the admin, a moderator or our software controls: Conference, Calendar, Map, Whiteboards and Documents. The person cannot configure it. This is what the plan so far calls a fixed layout (decision 3); the ids and routes do not change.
    - The Names section of `CLAUDE.md` is Thomas's and still lacks both names. This plan does not edit it (see "Doc facts").
34. **The Modules tab of a Fixed Workspace shows only the switches that workspace offers.**
    - The switches come from a schema (decision 35). With none, the tab says plainly that there is nothing to configure. Suggested sentence: "There is nothing to configure here."
    - The canvas arrangement controls do not apply in a Fixed Workspace and are not offered there: Arrange, Layouts, the module menu **Open for you**, and adding or removing modules on the canvas.
    - Why, in Thomas's words: for Calendar, Map and Conference "there's nothing you'd want to run next to that".
35. **The schema is one list in our software (the host), per Fixed Workspace** (Thomas chose option A of three).
    - It names which module settings appear on that workspace's Modules tab. Today Calendar offers the To-do switch, **Show To-do in the Calendar**: the `inCalendar` setting of the To-do module, which uses `needsModule: calendar` and the panel flag `showWhenSetting` (#783). Map, Conference, Whiteboards and Documents offer none.
    - A module cannot add controls to a Fixed Workspace on its own. The two rejected options were modules declaring it in their manifest, and each page drawing its own.
    - Adding a switch to a Fixed Workspace later is a one-line change in the list, in our software.
    - **What stays as it is:** the owner's controls over which Fixed Workspaces show in the bar, their order and which opens first (steps 2 and 3). The module's own header and menus inside a Fixed Workspace, such as the Whiteboard's board dropdown and the Documents title-bar select, are module behaviour, not workspace configuration.

## Names

`CLAUDE.md` (Names) does not list **Workspace** or **Layout**, though both are in the product: the Workspace is the first layout tab and the Layout menu is in the top bar. Thomas says "workspaces", "fixed workspaces" and "fixed layouts".

| Option | What it means | Cost |
|---|---|---|
| **A. Layout (suggested)** | The word already in the menu, the API (`/api/spaces/:id/layouts`), the stored file and the code. A fixed one is a **system layout** (already `kind: 'system'`). **Workspace** stays the name of the one free-form layout, renamable by the person as now | None in code. Thomas adds two lines to Names: **Layout, `layout`** (an arrangement of the canvas, a tab in the top bar) and **Workspace, `workspace`** (the free-form layout, the default one) |
| B. Workspace for all | Every tab is a "workspace", the general one included | The general layout and the family share a word, so "the Workspace" is ambiguous. Renames the Layout menu and API words |
| C. View | A new word for a tab | Collides with `host.ui.viewSwitch` and the narrow layout's "one view at a time" |

Collisions checked: **Space** (a place people enter), **Canvas** (the work area; a layout arranges it), **Aside**, **Home**, **Module** are all different things. "Workspace" is safe only as the free-form layout. Thomas adds the words to Names; this plan does not edit `CLAUDE.md`.

**Decision 33 adds two names, over this section.** **Customizable Workspace** and **Fixed Workspace** name the two kinds. Option A above still holds for the code and the menu (`layout`, `system layout`, the API). In words, this plan now says Fixed Workspace for what it called a fixed layout, and Customizable Workspace for the free-form kind. The Names section of `CLAUDE.md` does not list them either; Thomas adds them.

## The fixed set

Fixed means fixed **content**, not fixed position (the owner reorders, below). A fixed layout is a system layout: made per space from what is on, never stored, with stable ids.

| Layout | Id | What it shows | Call and chat | When it is missing |
|---|---|---|---|---|
| Workspace | `workspace` | The free-form canvas: what the space opens with, then what the person arranged. The only layout that remembers | Column beside it, as today | Never; always there |
| Conference | `conference` (new) | The call and the chat, filling the page; the canvas is hidden, not closed | Is the page (see "The Conference layout") | Not listed with no call service, the environment's switch off, or no "See and join the conference" permission (`conferenceAllowed()` in `public/opens-with.js`) |
| Calendar | `calendar` | The composite `dest:calendar` (the Calendar page; the To-do panel is inside it today, `modules/todo` declares a destination panel) | Column beside it | Not listed while the Calendar destination does not answer for this person |
| Map | `map` | The composite `dest:map` | Column beside it | Not listed without Maps or a map file |
| Whiteboards | `whiteboard` (new) | The Whiteboard module docked, filling the canvas (`modules: [{ id: 'whiteboard', mode: 'dock' }]`) | Column beside it | Not listed while the module is off here or unreadable for the person |
| Documents | `documents` (new) | The Documents module docked, filling the canvas | Column beside it | Same |

- **Two kinds (decision 33).** The Workspace is a Customizable Workspace. Conference, Calendar, Map, Whiteboards and Documents are Fixed Workspaces: their content and behaviour are controlled by the admin, a moderator or our software, and the person cannot configure them. What Set up shows for each is in decisions 34 and 35.
- **Workspace is the free-form layout; the others are presets** that open one thing large. This is how Calendar and Map already work, and it is the suggestion (point 2 of the planner's list). Treating Workspace as a preset too would lose the remembered arrangement.
- **Modules without a preset** (Budget, Polls, Vault, Research, Planner, Stream, Assistant, Places while it lasts) live in the Workspace, and a person can save any arrangement as their own layout and favorite it. **Decided (Thomas, decision 19):** only the six fixed layouts; no owner-pinned presets and no extra preset for the Planner.
- **To-do:** if a dedicated To-do list returns, it is one more row in this table with its own id (`todo`) and the same two rules: listed only while the module is on, and the Calendar layout shows its entries when the "show in the calendar" setting says so. Nothing in this plan blocks that: the list of ids is a code list (below), the owner's order and default accept any id in it.
- **Map and Places as one:** the Map layout is Maps. If Places retires into Maps, `map` does not change.
- **Call strip in each preset** is the existing column. The two modes and the placement setting cover both: in a preset the setting says where the call sits in the column; in Conference it says where the call sits against the chat on the whole page.

## The Conference layout (experience-design, risky)

- **What it is.** Pressing the **Conference** tab hides the canvas (`#canvas`, not closed: its modules and its remembered arrangement stay) and gives the always-on column the whole work area. The call and the chat are both there. No new frame, no new module, no new call code: the same `#side-column`, called wider.
- **The layout rules change in this layout only:**
  - The chat keeps the width it already has in the column (Thomas, decision 12); the call takes all the rest of the page. The fold handle (`#side-column-toggle`) is hidden, because there is nothing to fold to. The builder decides whether the splitter stays to change the chat width, and says so in the report.
  - The 55% rule (`CALL_MAX_SHARE`) is lifted. There is no call percentage: the call is whatever the chat leaves, and the chat keeps at least `COLUMN_MIN` (220px).
  - The tiles grow with the space (the strip height clamp, `clampStripHeight()`, gets a Conference ceiling).
  - Not in a call: the page shows the chat and one large **Start call** (or **Join call**) button, not an empty page. This is the Communication mode's front door. By decision 32 the large button shows only where the call fills an area of its own (this layout and **In the workspace**), not in the side column placements; the **Start call** on the title bar shows in every position.
- **Placement, the menu option.** Per decisions 16 and 17, the choice lives on the call's own title bar menu (below). In Conference it offers: **Beside the chat** (call left, chat right; the default in Conference), **Right of the chat**, **Above the chat**, **Below the chat**, and **Call only** (the chat is folded away, one tap brings it back). In the other layouts the same menu offers Top of the column, Bottom of the column, Left of the chat, Right of the chat, Floating window, In the workspace and Its own window.
- **The call title bar is always there** (decision 15), and the conference icon stays in the rail when the column is collapsed (decision 18). In Conference, with no call active, the page shows the call title bar ("Call", **Start call**, the call's menu) over the large Start area, and the chat beside it.
- **In the workspace** in Conference: Conference hides the canvas, so the call fills the area the canvas would have had. Suggested, and it follows from decision 30: the call area is the same, only where it sits changes. The builder confirms it in the report.
- **Remembered:** the placement is kept per person and per space for Conference, separately from the placement used beside the work (the two modes want different answers). See "Where choices are kept".
- **Memory.** Like Calendar and Map (decision 15), the Conference layout does not write the Workspace's arrangement: `pressLayoutTab('conference')` calls `canvas.holdMemory()`. Going back resumes the Workspace as it was.
- **A screen share** lifts into the canvas today (`syncShareLift`). In Conference the share stays in the call's tiles and gets the large area. The planner has not read the share code; the builder reads it first.
- **Pop out from Conference:** **Its own window** works as now (the call moves to a window; the Conference page shows the chat and a "The call is in its own window. Bring the call back." line).

## The call's menu and Call position

Decided (Thomas, decisions 15 to 17): the call's title bar is always shown and carries the call's menu. **Pop out the call**, **Call position** and the other call options are on that menu and leave the chat's menu, which keeps **Save the chat** and **Delete the chat**. This answers question 1: there is no View menu and no entry in the Layout menu. Build it from the existing `callPlaceItems()` in `public/space.js`, moved to the call title bar's **...**. Reuse only the shared pieces: `host.menu.show` (the menu), `openHostMenu()` for the row **...**, the nav registry for the tabs. No new chrome. The call's own pop-out and collapse buttons stay.

| Where | Choices | Marked |
|---|---|---|
| Any layout but Conference | Top of the column, Bottom of the column, Left of the chat and Right of the chat (each only in a column at least `CALL_LEFT_MIN`, 560px, else disabled with the reason), Floating window, In the workspace, Its own window | The saved one |
| Conference | Beside the chat, Right of the chat, Above the chat, Below the chat, Call only; Floating is not offered; **Its own window** stays. In the workspace is the page itself here (suggested) | The saved one for Conference |

Labels are plain and short. Screen-reader: the group is a `radiogroup` as `callPlaceItems()` is today; the change is announced through the existing `#layout-announce`.

## Owner controls

In Set up, where **Opens with** and the default layout already are (`public/space-setup.js`, built on `public/switch-list.js`). One section, **Layouts**, with one row per fixed layout that is available in this space:

- a **Show in the bar** switch (the favorites pattern; the heart is for people, the switch for owners);
- **Move up** and **Move down** buttons (keyboard-first; dragging is optional and not needed);
- an **Opens first** choice, one radio across the rows (this is the default). The existing **Opens with** list stays for what the Workspace holds.

This section is unchanged by decisions 33 to 35. It is the owner's control over the bar, and it stays for Fixed Workspaces. What the owner does not get is a way to arrange modules in one; a Fixed Workspace's own Modules tab is described under "The contract" (the schema) and in step 12.

Words (plain): "Layouts", "Show in the bar", "Opens first", "Move up", "Move down". The Workspace's switch is on and disabled ("The Workspace is always shown.").

## The contract

### Data (server-development)

The owner's choices are a field on the space record, beside `opensWith` and `defaultLayout`:

```json
"tabs": { "order": ["conference", "workspace", "calendar", "map", "whiteboard", "documents"], "hide": ["documents"] }
```

- `order`: ids in the owner's order. Any known id left out is added at the end in the default order. Unknown ids are dropped.
- `hide`: ids not in the bar for anyone. They stay in the Layout menu's list. `workspace` can never be in `hide`.
- `defaultLayout` (existing key) also accepts `conference`, `whiteboard` and `documents`, while they are available in the space. `workspace` still means "none" (unchanged).
- Unset `tabs` means today's order (Workspace, Calendar, Map) with Conference, Whiteboards and Documents added after, and nothing hidden. **Decided (Thomas, decision 14):** Conference, Whiteboards and Documents show for everyone on day one, so every space gains three tabs when this ships. The overflow **...** holds what does not fit, and people can hide them.
- **Who may write it:** the same people as `defaultLayout`: owners, the admin and moderators (`MODERATOR_SPACE_FIELDS`). **Decided (Thomas, decision 22).**
- **A person's own choices stay** (`system.<user key>`: name, icon, `tab`). Order of precedence, **decided (Thomas, decision 13):** the owner's `hide` wins (a hidden tab is hidden for everyone); a person may hide more for themselves; a person may rename and re-icon any tab. A person cannot reorder; the owner's order is what everyone sees.
- **Per person, per space:** the layout last shown is stored on the server (decision 20; "The last layout, on the server" below). The call placements stay in the browser ("Where choices are kept").
- **The remembered call position gains two values** (decision 17): `right` (Right of the chat) and `workspace` (In the workspace), beside the existing top, bottom, left, floating and its own window (`prefs.callPosition` in `public/space.js`; the builder uses the existing value names and adds these two). Conference keeps its own remembered value with the Conference choices above. No server field, no environment variable.

**The schema of a Fixed Workspace (decision 35).** One list in the host, in `server/`, beside the other layout lists. Suggested shape (the builder may name the file and the keys):

```json
{
  "calendar":   [ { "module": "todo", "setting": "inCalendar" } ],
  "map":        [],
  "conference": [],
  "whiteboard": [],
  "documents":  []
}
```

- The keys are the ids of the Fixed Workspaces (`calendar`, `map`, `conference`, `whiteboard`, `documents`). Each value lists the module settings that appear on its Modules tab, in order. Today only Calendar has one: `todo` / `inCalendar` (label "Show To-do in the Calendar", from the module's own setting).
- Every named setting must exist in the module's manifest, be a boolean, and belong to a module that can be on in the space. The switch is the module's ordinary setting: it reads and writes as now, and keeps `needsModule` and `showWhenSetting`. The list only decides where it is offered.
- The list is the only place that can add a switch to a Fixed Workspace. A module's manifest cannot, and no page draws its own. A check validates the list (step 12).
- The client gets the list for the layout in question from the layouts answer (the `GET /api/spaces/:id/layouts` entry gains `settings`, an array of `{ module, setting }`, empty for none), so the page does not carry a copy. A Customizable Workspace has no entry: its Modules tab is the canvas menu, as today.
- No new environment variable, no change to the stored settings.

Routes:

- `GET /api/spaces/:id/layouts` adds, to each entry of `system`, the available fixed layouts including `conference`, `whiteboard`, `documents`, in the owner's order, and a `shown` flag (false when the owner hid it). Also adds `tabs` for the owner's controls (`canSetDefault` already says who may set the default; the same flag gates `tabs`). A guest still gets `system: []`.
- `PATCH /api/spaces/:id { tabs }` and `{ defaultLayout }`: `200` with the space. `400` with a sentence for an unknown id ("There is no such layout here."), for `workspace` in `hide` ("The Workspace is always shown.") and for a `defaultLayout` that is not available now. `403` for a member. Aside ids answer `404`, as the layouts routes do.
- The existing `PUT` and `DELETE .../layouts/:id/favorite` for system ids set the person's `tab`; they refuse an id the owner hid (`409`, "The owner has hidden this layout." suggested).
- Code tables to widen together (all four, then one check that they agree): `SYSTEM_IDS` and `SYSTEM_ICONS` in `server/layouts.js`, `SYSTEM_DEFAULTS` in `server/store.js`, `SYSTEM_TAB_DEFAULTS` in `public/primary-nav.js`, `SYSTEM_TABS` in `public/opens-with.js`. Icons, **decided (Thomas, decision 23):** each fixed layout uses its module's own icon (Whiteboards, Documents, and the Calendar and Map as today), and Conference uses a video glyph from the product's Font Awesome set. Thomas does not pick them one by one.
- The last layout has its own two routes, `PUT` and `GET`, described under "The last layout, on the server"; `GET /api/spaces/:id/layouts` also answers it, so the page needs no extra request on entering.
- No new environment variable. No change to LiveKit, tokens or the call's server routes.

### Pages (experience-design)

- **The Modules tab (decisions 34 and 35).** In a Fixed Workspace, the Modules tab of Set up draws only the switches in that workspace's `settings` (ordinary module-setting switches, built on `public/switch-list.js`), or, with none, the sentence "There is nothing to configure here." The canvas arrangement controls (Arrange, Layouts, **Open for you**, adding and removing modules) are not drawn in a Fixed Workspace. In a Customizable Workspace the tab is as today. Step 12.
- `layoutTabs()` takes the owner's order and `shown`; `tabOverflow()` is unchanged.
- `pressLayoutTab('conference')` is the one new branch: hold memory, set `body.view-conference`, call `syncCallPlace()` and `applyLayout()`. Whiteboards and Documents are ordinary `loadLayout()` of one docked module, as Calendar and Map are.
- `firstVisitLayout()` and `SYSTEM_TABS` take the new ids. A guest follows the owner's default (decision 21); for a default a guest cannot use, the guest gets the Workspace, as today (decision 27).
- The call title bar is drawn all the time (decision 15), with the title "Call", **Start call** while no call is active, and the call's menu; with no call active the call's own area shows a large **Start call** button only when the call fills an area of its own, **In the workspace** and on the Conference layout (decision 32), not in the side column placements; `callPlaceItems()` and **Pop out the call** move from the chat's menu to it (decision 16), gain the Conference variant, **Right of the chat** and **In the workspace** (decision 17). **In the workspace** moves the same call area, with the same title bar, menu and controls, into the canvas area (decision 30); how it is saved and restored with an arrangement is the builder's to choose. **Right of the chat** and **In the workspace** are not offered on a phone (decision 29).

## Where choices are kept

| Choice | Owner or person | Stored | Reaches |
|---|---|---|---|
| Default layout | Owner | Space record, `defaultLayout` | First visit and guests |
| Which fixed layouts show, and order | Owner | Space record, `tabs` | Everyone in the space |
| Name, icon and own hide of a tab | Person | `layouts.json`, `system` (exists) | That person's other browsers |
| Last layout shown | Person | **Server**, `layouts.json`, `last` (decision 20) | That person's every browser; never another person |
| Call placement beside the work, and in Conference | Person | Browser, with the column's own keys (`app.column.<space id>`) (suggested; only the last layout was decided) | This browser |

**Decided (Thomas, decision 20):** the last layout shown is kept on the server so it follows the person to another browser. The planner had suggested the browser; Thomas chose the server. The Workspace's own arrangement (`__open`, `app.canvas.<space id>`) stays in the browser as it is. **Suggested, not decided:** the call placements stay in the browser with the column's own keys, per space, like the column's fold and width. That needs no server change and matches how the call preferences are kept now (they are per browser, not per space; moving them per space is a small change in `DEFAULT_PREFS` handling). If Thomas wants the placements to follow the person too, they would join the `last` record below; that is not planned.

## The last layout, on the server

Core change: `server/layouts.js`, `server/index.js`, the stored data format. Held for an independent read; the full `npm run check` covers it.

**What is stored.** In `layouts.json`, beside `shared`, `people` and `favorites`, one more map per space:

```json
"last": { "<user key>": { "layout": "<layout id>", "at": 1731400000000 } }
```

- `layout`: one layout id. A system id (`workspace`, `conference`, `calendar`, `map`, `whiteboard`, `documents`) or the id of a layout the person can see (their own or a shared one). A string of at most 64 characters, checked against the ids that exist.
- `at`: when it was set, in milliseconds. The server writes it; the request cannot.
- **Size bounds.** One entry per person per space: about 100 bytes. The file grows by members times spaces and by nothing else. No list, no history. The key is left out of a space's entry while nobody there has one (as `favorites` is). `forgetPerson` and `forgetSpace` remove the entries, so a removed person or space leaves nothing behind. Writes are limited like the other layouts routes; the page writes only when the layout changes, not on every press of the same tab.

**Routes.**

- `PUT /api/spaces/:id/last-layout` `{ layout }` writes the signed-in person's own record. `200 { layout }`. `400` with a sentence for a missing or unknown id ("There is no such layout here."). `403` for a guest. `404` for an Aside or a space the person is not in.
- The person's record comes back in `GET /api/spaces/:id/layouts` as `last: "<layout id>"` (or absent). Nothing in the answer ever names another person's record.
- There is no `DELETE`. A person with no remembered choice is a person who has never pressed a tab; a later press overwrites.

**Who may read and write.** Only the person, for their own record. The user key comes from the session (`req`), never from the request body or the address, so one person cannot ask for or set another's, and the admin, owners and moderators have no route to read it either. This is the rule `moduleAccess` follows for the `person` scope.

**Guests.** A guest has no record and gets none. By decision 21 a guest follows the owner's default every time, so there is nothing to remember. A guest session ends on its own (`GUEST_SESSION_HOURS`, the epoch, a text change, a switch going off; see [architecture-access](../architecture/architecture-access.md), "The guest door"), so nothing a guest does outlives it and nothing needs to expire. If Thomas later wants a guest to be remembered inside one session, the key would be the guest's id and the record would be dropped when the session ends; that is not planned.

**When the layout it names is gone or hidden.** The record is not rewritten when this happens; it is read, checked and passed over, so it comes back by itself if the layout does.

- A saved layout that was deleted, a system layout whose module is off or whose permission the person lost, Conference when the call service or the permission is gone: not available. Falls through to the owner's default, then to the Workspace (the order in "First visit and restore").
- A layout the owner hid from the bar (`tabs.hide`): by decision 13 the owner's hide wins, so it is passed over in the same way. It stays in the Layout menu, where a person can still choose it; choosing it sets the record again.
- Deleting a saved layout also clears any `last` that names it, as `remove()` already clears favorites.

**How this reverses today's entering, and decision 8.** Today entering always shows the Workspace tab (`currentLayoutTab = 'workspace'`), and `firstVisitLayout()` uses the owner's `defaultLayout` on a first visit only. After this plan the person's `last` is read first. A person with no `last` (never pressed a tab here, or a new member) gets exactly what they get today: the owner's `defaultLayout` on a first visit, else the Workspace with the arrangement they left. Decision 8 therefore holds: today's layout stays the default for anyone with no remembered choice, and nothing changes for anyone until they press a tab other than the Workspace. The Workspace's own arrangement is still the browser's, and it is still held while another layout is shown (decision 15 of plan-layout-views).

## Behaviour by mode and surface

| Surface | Collaboration (any layout but Conference) | Communication (Conference) |
|---|---|---|
| Desktop, 1280px | Work left, column right, as today. Call per Call position | The page is the call and the chat. Beside the chat by default: the chat keeps its width, the call fills the rest. A tab "Conference" is current |
| Narrow desktop window (641 to 1000px) | The column keeps its `CALL_LEFT_MIN` rule; Left falls back to Top | Beside the chat needs about 560px; narrower, it stacks above the chat and the saved choice is kept (the `callPlaceFor()` rule) |
| Phone, 390px | Tab bar as today; the call is a tab | Same: the call tab is full screen (see "Phones") |
| Light and dark | The tiles, the Start button and the tab use theme tokens only (`design-theme.md`); no raw colours (`check-no-raw-colours`) | The same; the empty "not in a call" page uses the card surface and the accent button |

A Customizable Workspace and a Fixed Workspace differ in what they allow, not in where they sit:

| Surface | Customizable Workspace | Fixed Workspace |
|---|---|---|
| Content | Any modules the person arranges | Set by the admin, a moderator or our software |
| Modules tab of Set up | The canvas menu: modules, Arrange, Layouts, **Open for you**, add and remove | Only the switches in the schema; with none, "There is nothing to configure here." |
| Name, own bar | The person names it and puts it on their bar | The owner's Layouts controls (steps 2 and 3) and the person's own rename, re-icon and hide, as decided |
| Chat and call column | Beside it | Beside it (Conference: the page, as above) |

## Roles and permissions

| Role | Sees tabs | Sets default, tabs, order | Notes |
|---|---|---|---|
| Admin, owner | All available | Yes | Same as `defaultLayout` today |
| Moderator | All available | Yes (decision 22) | `MODERATOR_SPACE_FIELDS` |
| Member | Those shown | No | Renames, re-icons and hides tabs for themselves; picks their own Call position |
| Guest | None (no tabs, as now) | No | Follows the owner's default (decision 21); has no stored last layout; a default they cannot use gives the Workspace (decision 27) |

Who sees the Modules tab content, by kind (decisions 34 and 35):

| Role | Customizable Workspace | Fixed Workspace |
|---|---|---|
| Admin, owner, moderator | The canvas menu, as today | The schema's switches, or the message; no arrangement controls |
| Member | As today (what the space allows) | Not changed by this plan: the tab shows the same switches only to those who see Set up today; no arrangement controls for anyone |
| Guest | No Set up, as now | No Set up, as now |

Permission to see the call is unchanged: no Conference tab without "See and join the conference". A member without that permission never gets the tab and a default of `conference` falls back to the Workspace for them.

## Asides

**Decided (Thomas, decision 24):** an Aside **stays its own thing.** It is already the Conference layout without the work (call only, no modules, column is the whole screen), and it has no space id, no layouts and no tabs. The new Conference layout is the same screen reached from inside a space, with the work one tap away. The two share the column code, so the builder uses `inAside()`'s layout path as the model for Conference. Making an Aside "a space whose default is Conference" would give Asides a space record, members and layouts, which the product deliberately does not have (they are deleted when the last person leaves, `pruneAsides()`). 

## Phones

- A Fixed Workspace is not arranged on a phone either: the narrow layout shows its modules as tabs, as now, and decisions 33 to 35 change nothing there. The Modules tab rule (decision 34) applies to Set up on any width.
- No layout tabs on a phone, as now (the narrow layout shows module tabs; the composites are among them). Whiteboards and Documents are module tabs there already when on.
- **Right of the chat and In the workspace are not offered on a phone** (Thomas, decision 29): there is no column or canvas area to place the call in. The call stays a full-screen tab with its menu.
- **Conference on a phone is the call tab,** full screen. Suggested: an owner's default of Conference opens the call tab first on a phone (`restore()` already opens "the first module opened" as the first tab and a guest's first tab is the call).
- **One-tap way back:** the narrow layout's tab bar stays under the call, so the work is one tap away. If plan-phone-experience decision 16 is built first (call in the top bar), the way back is the bottom bar's module buttons. Either way the plan adds no new chrome. **Not read:** the phone tab bar code, so how the call tab looks full screen is unchecked; a builder checks it at 390px.
- **Cap on the main nav:** none. Phones have no layout tabs, and on a desktop `tabOverflow()` already folds extra tabs into **...** without cutting names. At most six fixed layouts plus favorites. **Decided (Thomas, decision 25):** no cap.

## First visit and restore

Today: request, then remembered arrangement, then `opensWith`, then environment, then product default (`restore()`, `whatOpens()`, `firstVisitLayout()`). Suggested order after this plan:

1. A fresh request to open one object (wins, as now).
2. The person's own last layout for this space (`last`, stored on the server, decision 20), if they have one, are not a guest, and it is still available and not hidden by the owner. This **reverses** line 5837 ("entering a space opens on the Workspace tab", plan-layout-views) and Thomas's decision 15 note that the current tab is not remembered across visits, for the person's choice only.
3. The owner's `defaultLayout`, on a first visit, and for a guest every time (decision 21). A default the person cannot use falls to step 4; for a guest too, the Workspace (decision 27).
4. The Workspace with the remembered arrangement or `opensWith`, as now.

A first visit to `conference` opens the Conference layout with the call out of the call (nobody joins by itself unless the environment's auto-join switch is on; `shouldAutoJoin()` is unchanged). The Workspace behind it opens as step 4, so a tap on its tab shows it.

## Pop-outs

A call in its own window stays supported and stays the second-monitor answer: **Its own window** from Call position, `popOutCall()`. In Conference it is offered, and the page says where the call went. The module window return bug is a separate bug and is not touched; no step here depends on its fix, but the builder must not make Conference depend on a window returning. Blocked pop-ups already show the message in `known-issues.md` and `POPUP_BLOCKED` in `public/space.js`.

## Accessibility

- Tabs are buttons reached in order by Tab (as `layoutTabs()` does); the current one has `aria-current="page"`. Conference is one more.
- **Move up** and **Move down** are real buttons, so reorder never needs dragging. After a move, focus stays on the pressed button and a live region says "<name> moved to position N."
- The Call position group is a `radiogroup`; the Left option, when disabled, says why in its hint.
- Every new target is at least 44px on a phone and 32px on a desktop (the existing `check-touch` and `check-phone-targets` rules).
- Moving into Conference moves focus to the page's heading ("Conference") and announces "Conference layout" through `#layout-announce`; pressing the Workspace tab returns focus to that tab.
- Not checked: a real screen reader, Firefox, Safari.

## Left to build, in order

Each step is one try build, leaves the app working and can be checked alone. Size by job: S about a short sitting, M about half a day, L a day or more. Steps 8 to 10 come from Thomas's answer to question 1 (step 10 is settled by decision 31); steps 8 and 10 are small and can be built before step 1. Step 11 comes from decision 20 (the last layout on the server); it is a core change, so it is held for an independent read, and step 6 waits for it.

| Step | Job | Agent | Files | Size | Risk |
|---|---|---|---|---|---|
| 1 | **The ids.** Add `conference`, `whiteboard`, `documents` to `systemLayoutsFor()` (available rules above), the four code lists, the icons; `defaultLayout` accepts them. Whiteboards and Documents tabs work as Calendar and Map do. Conference is listed but pressing it only loads an empty layout | server-development, then experience-design for the tab | `server/layouts.js`, `server/index.js`, `server/store.js`, `public/primary-nav.js`, `public/opens-with.js`, `public/space.js` | M | Low |
| 2 | **Owner's tabs.** `tabs` on the space record, `PATCH` rules, `GET` returns the owner's order and `shown`; precedence with the person's `tab` | server-development | `server/store.js`, `server/index.js`, `tools/check-layouts.mjs` | M | Low |
| 3 | **Owner controls in Set up.** The Layouts section: Show in the bar, Move up and down, Opens first | experience-design | `public/space-setup.js`, `public/switch-list.js`, `tools/check-setup-tabs.mjs` | M | Low |
| 4 | **The Conference layout.** `body.view-conference`, the chat column keeps its current width and the call fills the remaining width (no percentage setting), the lifted 55% cap for this layout, the empty "not in a call" page with the large Start button (also in the call's own area when the call is **In the workspace**, and not in the side column placements, decision 32), hold-memory behaviour | experience-design | `public/space.js`, `public/canvas.js`, `public/style.css` | L | **High:** layout and canvas work |
| 5 | **The placement option.** The Conference variant of Call position on the call's menu, per-space storage | experience-design | `public/space.js` (`callPlaceItems()`, `DEFAULT_PREFS`), `tools/check-canvas.mjs` | M | Medium |
| 6 | **First visit and restore.** Read the person's `last` from `GET .../layouts`, write it with `PUT .../last-layout` when the layout changes, the order in "First visit and restore", a guest follows the owner's default, and a default a guest cannot use gives the Workspace (decision 27). Needs step 11 | experience-design | `public/opens-with.js`, `public/canvas.js`, `public/space.js`, `tools/check-canvas.mjs` | M | Medium (changes what opens) |
| 7 | **Phones and an Aside check.** Conference as the call tab, a default of Conference at 390px, Right of the chat and In the workspace not offered on a phone (decision 29), no change to Asides | experience-design | `public/space.js`, `public/style.css` (the `max-width: 640px` blocks) | S | Medium |
| 8 | **The call title bar, always shown, with its menu.** Draw the call title bar with no call active (title "Call", **Start call**, the call's menu) and make sure no large **Start call** button shows in the call's empty area in the side column placements (decision 32; the large button belongs to step 4 and step 9), and the conference icon stays in the collapsed rail (decision 18); move **Pop out the call** and **Call position** from the chat's menu to the call's menu; the chat's menu keeps **Save the chat** and **Delete the chat** | experience-design | `public/space.js`, `public/style.css`, `tools/check-canvas.mjs` | S | Low |
| 9 | **Two new positions.** **Right of the chat** and **In the workspace** in Call position, the two new remembered values, the Conference variants; not offered on phones (decision 29); **In the workspace** moves the same call area into the canvas area with no new chrome (decision 30) and, with no call active, shows the large **Start call** button there (decision 32), saved and restored with the arrangement in a way the builder chooses, reporting back only if it needs new chrome or a new stored shape | experience-design | `public/space.js`, `public/canvas.js`, `public/style.css`, `tools/check-canvas.mjs` | M | Medium (layout and canvas work); no longer waits on Thomas |
| 11 | **The last layout on the server.** `last` in `layouts.json` (cleaned layout id and `at`, one entry per person per space), `PUT /api/spaces/:id/last-layout`, `last` in `GET .../layouts`, the clean-up in `forgetPerson`, `forgetSpace` and `remove()`, `403` for a guest, `404` for an Aside. Build it before step 6 | server-development | `server/layouts.js`, `server/index.js`, `tools/check-layouts.mjs` | M | Medium: **core change** (`server/`, stored data format); independent read, full `npm run check` |
| 12 | **The Modules tab of a Fixed Workspace.** Server half: the schema list in the host (one entry per Fixed Workspace, today `calendar` offers `todo` / `inCalendar`, the rest none), `settings` in the `GET .../layouts` entries, and the check that validates the list. Pages half: the Modules tab of a Fixed Workspace draws only the schema's switches or the message "There is nothing to configure here.", and the canvas controls (Arrange, Layouts, **Open for you**, add and remove) are not offered there but stay in a Customizable Workspace. Independent of steps 4 to 9; it can follow step 3 | server-development for the list, the answer and the check; then experience-design for the tab and the message | `server/layouts.js` (or a new file beside it), `server/index.js`, `tools/check-layouts.mjs` or a new `tools/check-fixed-workspaces.mjs`; `public/space-setup.js`, `public/switch-list.js`, `tools/check-setup-tabs.mjs` | S to M | Low |
| 10 | **The conference icon in the collapsed rail.** The call's icon sits beside the chat button when the column is collapsed. A small dot shows while a call is active (not the elapsed time). Pressing it reopens the call area and does not start a call. It is a button in the tab order named "Show the call" (or similar) and says the call is active to a screen reader, as the unread badge does. Phones unchanged (decisions 18 and 31) | experience-design | `public/space.js` (the rail beside `#side-column-rail-chat`), `public/style.css`, `tools/check-canvas.mjs` | S | Low |

Documentation after each step is content-manager's: [architecture-navigation](../architecture/architecture-navigation.md) (the layout tabs), [architecture-canvas](../architecture/architecture-canvas.md) (the column, remembered layouts), the API document for `tabs` and `defaultLayout`, [userguide-call](../userguides/userguide-call.md), [userguide-spaces](../userguides/userguide-spaces.md), and the CHANGELOG. The Names section of `CLAUDE.md` is Thomas's.

## Verify

- **Step 1.** `tools/check-layouts.mjs`: the three new ids come and go with their module, the permission and the switch; a guest gets `system: []`; `defaultLayout: 'conference'` is accepted while available and refused after. `tools/check-nav.mjs`: the tabs and their order. A check that the four code lists name the same ids (new, small).
- **Step 2.** `tools/check-layouts.mjs`: `tabs` round trip; unknown id, `workspace` in `hide` and a member's write refused; a missing id is added at the end; the person's `tab` is overridden by the owner's `hide`; an Aside answers `404`.
- **Step 3.** `tools/check-setup-tabs.mjs` for the section's words and switches. Live in Chromium (the planner's expectation for the builder): an owner hides Documents and moves Conference first; a member's bar follows after a reload; keyboard-only reorder works.
- **Step 4.** `tools/check-canvas.mjs` for the pure clamps (the chat keeps its width, the call takes the rest, the least chat). Live in Chromium at 1280, 900 and 641px, light and dark: the page is the call and the chat; not in a call it shows the Start button; the Workspace comes back as it was (modules, positions); Chat keeps its least width; the fold handle is gone. **Cannot be checked without a real LiveKit call:** the tiles at large size, a screen share in Conference, audio and video, a second person joining. The large Start call button shows on the Conference layout with no call (decision 32); live in Chromium.
- **Step 5.** Check the choices persist across a reload and differ between Conference and the other layouts; Left is disabled below `CALL_LEFT_MIN` with a hint.
- **Step 11.** `tools/check-layouts.mjs`: round trip of `last` for one person; a second person's `GET` never shows it and their `PUT` cannot reach it; an unknown id, a missing id and a long id refused (`400`); a guest refused (`403`); an Aside `404`; the entry removed with the person, the space and the layout it names; the file stays small after many writes (one entry). Full `npm run check`, then an independent read. A real browser round trip across two browsers is checked live in Chromium if the build allows.
- **Step 6.** `tools/check-canvas.mjs` for the new order (pure `firstVisitLayout()` and `whatOpens()` cases: the person's `last` wins, no `last` gives today's answer, the owner's default on a first visit and for a guest, a layout that is gone, off, or hidden by the owner falls through). The guest fallback cases: a default a guest cannot use (Calendar, Map, Whiteboards, Documents, a saved layout) gives the Workspace.
- **Step 8.** Live in Chromium: the title bar shows with no call, **Start call** is there, no large **Start call** button shows in the call's empty area in Top of the column, Bottom of the column or Left of the chat (decision 32), the call's menu holds the call items, the chat's menu holds only the two chat items; light and dark; the touch-target checks. Starting a call needs LiveKit: cannot be checked here.
- **Step 12.** Server half, a check by a tool: every Fixed Workspace id is a key of the schema; every setting it names exists in its module's manifest, is a boolean, and belongs to a module that can be on; an unknown key or setting fails the check; `settings` in the `GET .../layouts` answer matches the list (one entry for Calendar, empty for Map, Conference, Whiteboards and Documents); the To-do switch still writes `inCalendar` as an ordinary module setting. Pages half, `tools/check-setup-tabs.mjs`: the message shows for the Fixed Workspaces with no switches; Calendar shows only the To-do switch; the canvas controls are absent in a Fixed Workspace and present in a Customizable one. Live in Chromium: Set up in Calendar, Map and Conference, light and dark, keyboard only. The To-do switch changing what a real Calendar shows is checked live as far as the page allows; nothing here needs a LiveKit call, and Conference's message needs none.
- **Step 10.** Live in Chromium: collapse the column, the conference icon shows beside the chat button with no call and without the dot; one press reopens the call area and does not start a call; Tab reaches it, it has an accessible name, and the active state is in its label or a live region as the unread badge does (checked in the page's accessibility tree); a phone width shows no rail and no change. The dot while a call is really active cannot be checked here (no LiveKit); a test can only set the state the page reads.
- **Step 9.** `tools/check-canvas.mjs` for the pure placement rules (the two new values, the fallback when the column is too narrow). Live in Chromium at 1280, 900 and 641px: Right of the chat and In the workspace place the call (In the workspace with the same title bar, menu and controls), neither is offered at 390px, persist across a reload, and return cleanly to the other positions. **Cannot be checked without a real LiveKit call:** the call tile in the workspace at real size, a screen share, audio and video. With no call, the large Start call button shows In the workspace and not in the side column placements (decision 32); live in Chromium.
- **Step 7.** Live at 390px (headless Chromium): the call tab is full screen, the tab bar is one tap to the work; `tools/check-narrow.mjs`, `tools/check-phone-targets.mjs`.
- **Always:** `npm run check` and `npm run check:docs`. Not checked by any step: a real phone, a real screen reader, Firefox, Safari, a real call.

## Tests and checks to add

The new id-agreement check (step 1); the schema check and the Modules tab cases (step 12); new cases in `check-layouts`, `check-nav`, `check-canvas`, `check-setup-tabs`, `check-narrow` as above. No new tool is needed beyond the one small agreement check.

## Risks, ranked

1. **The Conference layout fights the column's rules** (the 55% cap, the fold handle, the Left minimum, the share lift). A wrong change squeezes the chat or leaves a dead page. Mitigation: step 4 alone, behind a flag-free but small change set, checked at three widths; the cap lifts only in Conference.
2. **What opens changes** (step 6): remembering the last view could open someone on a layout they did not expect, or on Conference with no call. Mitigation: the order above, a fall-through for an unavailable or hidden layout, and the Workspace as the safe floor.
2a. **A new stored record and route** (step 11, decision 20): a bug could let one person read or set another's record, or let the file grow. Mitigation: the key is taken from the session only, one entry per person per space, a size and id check, the clean-up on removal, an independent read and the full `npm run check`.
2b. **Guests and the owner's default** (decision 21): an owner's default of Calendar, Map, Whiteboards, Documents or a saved layout is one a guest cannot use. Decided (decision 27): the fallback is the Workspace, as today.
3. **Four code lists of the same ids** drift apart. Mitigation: the agreement check.
4. **Three new tabs everywhere** crowd the bar on day one (decided to show, decision 14). Mitigation: the existing overflow, and people can hide them.
5. **Real-call behaviour is unproven here,** so large tiles and the share are unverified until Thomas or a tester joins a real call.

## Rollback and off switch

None as a setting. Each step is its own commit; reverting step 4 leaves Conference listed but inert, so revert steps 4 to 6 together (step 11 can stay; with no page reading it, `last` is unused). Owners can hide any fixed layout but Workspace, which is the off switch for a space. The product is unreleased, so nothing migrates; unset `tabs` reads as the defaults and a space with no `last` entries reads as today.

## Not in version 1

- **"Bring everyone to the Conference":** a moderator putting everyone into the Conference layout for a briefing. Left out of version 1 (Thomas, decision 26).
- Cursors, a "follow me" view, shared layouts changing for everyone in real time.
- Reordering across fixed layouts and favorites (fixed first, then favorites).
- Per-person order of the fixed tabs.
- A separate calls-only mode (that is an Aside).
- Owner-set names and icons for the fixed layouts (plan-layout-views Phase 2, #266 for names and icons; this plan does #267, the order, and the owner's show and default).
- A To-do layout and Places inside Maps (separate decisions).
- Remembering the call placements on the server, and remembering anything for a guest.
- Presets for modules beyond the six, and owner-pinned presets (decision 19).

## Doc facts

These are the facts the documents will carry, so content-manager does not guess: the six fixed layouts and their ids; that Workspace is always shown; that Conference needs the call service, the environment switch and the permission; the owner's three controls and who may use them; the precedence rule (owner's hide wins); that the last layout is kept on the server, per person and space, and a guest has none; the Conference placement choices; that **Start call** is on the call title bar in every position and the large **Start call** button shows only when the call fills an area of its own, **In the workspace** and on the Conference layout (decision 32); that an Aside is unchanged; that pop-out stays. Words people read: "Conference", "Whiteboards", "Documents", "Layouts", "Show in the bar", "Opens first", "Call position", "Beside the chat", "Above the chat", "Below the chat", "Call only". The Names entries for **Layout** and **Workspace** are Thomas's. For Thomas: the Names section of `CLAUDE.md` is his and still lacks **Customizable Workspace** and **Fixed Workspace** (decision 33); this plan does not edit it. Also the facts of decisions 33 to 35: the two kinds and what each allows; that a Fixed Workspace's Modules tab shows only the switches in the host's schema, or "There is nothing to configure here."; that Calendar offers the To-do switch (`inCalendar`) and Map, Conference, Whiteboards and Documents offer none; that the canvas controls are not offered in a Fixed Workspace; that only our software can add a switch to the schema; that the module's own header and menus inside a Fixed Workspace are module behaviour.

## What is not decided

Every numbered question is answered (decisions 12 to 26), and so are the guest fallback, Start call, phones and In the workspace (decisions 27 to 30) and the collapsed rail (decision 31), with the large Start call button corrected by decision 32. "Open questions for Thomas" below is empty. Decisions 33 to 35 (two kinds, the Modules tab, the schema) are answered. What is left is one point for the builder, and two questions for Thomas from decisions 33 to 35. None blocks step 12.

- **A shared Customizable Workspace (not decided).** Is a Customizable Workspace that an owner shares for everyone (the owner-made shared layouts of plan-layout-views, #266 and #267) also called a Customizable Workspace? Suggested: yes. It is the same kind, arranged by the owner instead of the person.
- **The chat column in a Fixed Workspace (not decided).** May a person still collapse or resize the chat column in a Fixed Workspace? Suggested: yes. It is the page's own chrome, not workspace configuration, and decision 34 names only the canvas arrangement controls.

- **Right of the chat** when the column is narrow: suggested to follow the Left rule (`CALL_LEFT_MIN`, falls back to Top). A suggestion for the builder of step 9; it does not block it.

## Open questions for Thomas

None for the build. All twelve questions are answered and recorded as decisions 12 to 26, the four follow-up points as decisions 27 to 30, the collapsed rail as decision 31 and the two kinds of workspace as decisions 33 to 35. What is still undecided is under "What is not decided".
