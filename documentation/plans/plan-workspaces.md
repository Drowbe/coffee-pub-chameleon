# Workspaces and a Dedicated Conference Plan

**Audience:** Thomas decides. If he approves, server-development builds the space record, the routes, the stored last-layout record and the checks, and experience-design builds the Conference view, the owner controls and the menu entry. The stored last-layout record (decision 20) is a core change (`server/`, the stored data format): it is held for an independent read and covered by the full `npm run check`. content-manager documents after.

**Status:** Draft for Thomas, 2026-11-12, by product-planner; updated 2026-11-12 with Thomas's answers to questions 2, 4 and 5 (decisions 12 to 14), to question 1 (decisions 15 to 18, the last about the collapsed call area) and, on 2026-11-12, to questions 3 and 6 to 12 (decisions 19 to 26). Nothing here is decided except the lines marked "Thomas" and the decisions below. Nothing is built. From the feedback and from Thomas, in his words:

> "we've made conference (video) so secondary, there is no way to have a dedicated call without popping it out."

> "there are two modes of use: 1. Collaboration Mode: chat/video are NEXT TO the work being collaborated on; 2. Communication Mode: focused only on chat/video. We can easily accomplish this with both a dedicated workspace and an option in the "view" context menu that lets the user choose where to place the video in relation to the chat. I actually have ideas around workspaces too. We need to think through our set of "fixed" workspaces (that can't be changed). I am thinking: Workspace, Conference, Calendar, Map, Whiteboards, Documents. For a space an owner could dictate which space is default. They can say which show on the main nav (like we do with favorites). They can change the order of the fixed layouts."

> "There is no 'todo' without calendar, right? It is part of calendars now."

Thomas also asked for "Map and Places as one" (a separate decision; the Map entry here is Maps) and a dedicated To-do list with a "show in the calendar" setting (a separate decision in progress). This plan does not design either; it leaves room (see "The fixed set").

The popped-out window bug (module windows never return to where they came from) is a separate bug. It is mentioned only under "Pop-outs".

**What was read.** Read in full or in the parts that matter: `CLAUDE.md`; [plan-layout-views](plan-layout-views.md) (decisions, model, Phase 2), [plan-favorite-layouts](plan-favorite-layouts.md), [plan-one-bar](plan-one-bar.md) (decisions), [plan-optional-conference](plan-optional-conference.md), the head of [plan-call-as-module](plan-call-as-module.md) and of [plan-phone-experience](plan-phone-experience.md) (decision 16); [architecture-navigation](../architecture/architecture-navigation.md) (the layout tabs), [architecture-canvas](../architecture/architecture-canvas.md) (the always-on column, narrow windows, remembered layouts, saved layouts); `documentation/TODO.md` and `known-issues.md` (searched for the call, layouts and pop-outs, not read end to end); in code, `public/opens-with.js` (all), `public/primary-nav.js` (`layoutTabs()`, `tabOverflow()`), `public/canvas.js` (`restore()`), `public/space.js` (`DEFAULT_PREFS`, `popOutCall()`, `setCallPosition()`, `callPlaceItems()`, `layoutMenuItems()`, `systemRowItems()`, `pressLayoutTab()`), `public/composites.js` (head), `server/layouts.js` (system layout parts), `server/index.js` (`systemLayoutsFor()`, the layouts routes), `server/store.js` (`defaultLayout`), `server/destinations.js` (head), `modules/*/module.json` (destination parts). **Not read:** `public/destination.js`, `public/nav-bar.js` beyond a search, `public/module-stream.js` (it is the page's event stream hub, not the call), the call's tile code, `userguide-call.md` beyond a search. Nothing here was run: no server was started and there is no LiveKit.

## Why

Chat and video sit beside the work in an always-on column ([plan-one-bar](plan-one-bar.md), decision 2). That is right for working together. It is wrong for a briefing, a game night or a plain call, where the call is the work. Today the nearest things are a wide column (the splitter lets the chat take the whole window, but the call strip is still capped at 55% of the column height, `CALL_MAX_SHARE` in `public/space.js`) and **Its own window**, which needs a second window and, after the pop-out bug, does not come back cleanly. An Aside is call-only, but it is a different, temporary thing and is made from outside the space.

Thomas's two modes, in the words this plan uses:

| Mode | What a person sees | How it is reached |
|---|---|---|
| **Collaboration** | The work, with the chat and the call beside it | Any layout except Conference (today's default) |
| **Communication** | The call and the chat, filling the page | The Conference layout |

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
17. **Call position gains two positions** to the existing five (Top of the column, Bottom of the column, Left of the chat, Floating window, Its own window): **Right of the chat** and **In the workspace** (the call becomes a tile in the workspace area instead of a column). What "In the workspace" means in detail is open (see "What is not decided").

18. **The conference icon stays visible when the call area is collapsed** (Thomas: "we should also show the conf icon when the area is collapsed"). When the column is collapsed, the call's icon stays in the collapsed rail so the person can see the call area exists and reopen it with one click. While a call is active it shows the live state (a dot or the elapsed time as a badge; which one is open). This goes with decision 15.

Thomas, 2026-11-12, answers to questions 3 and 6 to 12 (DECIDED). Two of them differ from the planner's suggestion (decisions 20 and 21).

19. **Only the six fixed layouts (question 3):** Workspace, Conference, Calendar, Map, Whiteboards, Documents. No preset for Budget, Polls, Vault, Research, Planner, Stream or the others. They are reached through the Workspace, or through a saved layout and a heart.
20. **The last layout is remembered on the server, per person and per space (question 6).** Not the browser-only option the planner suggested. Entering a space opens the layout the person last used there. This reverses today's "entering opens on the Workspace" for a person who has a remembered choice. Decision 8 stands: a person with no remembered choice gets today's default. This adds a stored record and a route, so it is a core change (see "The last layout, on the server").
21. **Guests follow the owner's default (question 7).** Not the always-Conference option the planner suggested. What a guest sees when the owner's default is a layout a guest can hardly use is an open point (see "What is not decided").
22. **Owners, the admin and moderators set the default, the tabs and their order (question 8),** as `defaultLayout` is set today.
23. **Icons (question 9):** each module's own icon where it has one, and a video glyph for Conference.
24. **Asides stay their own thing (question 10),** sharing the column code with the Conference layout.
25. **No cap on the main nav (question 11).** The **...** overflow handles a crowded bar.
26. **"Bring everyone to the Conference" is left out of version 1 (question 12).** It is listed under "Not in version 1".

## Names

`CLAUDE.md` (Names) does not list **Workspace** or **Layout**, though both are in the product: the Workspace is the first layout tab and the Layout menu is in the top bar. Thomas says "workspaces", "fixed workspaces" and "fixed layouts".

| Option | What it means | Cost |
|---|---|---|
| **A. Layout (suggested)** | The word already in the menu, the API (`/api/spaces/:id/layouts`), the stored file and the code. A fixed one is a **system layout** (already `kind: 'system'`). **Workspace** stays the name of the one free-form layout, renamable by the person as now | None in code. Thomas adds two lines to Names: **Layout, `layout`** (an arrangement of the canvas, a tab in the top bar) and **Workspace, `workspace`** (the free-form layout, the default one) |
| B. Workspace for all | Every tab is a "workspace", the general one included | The general layout and the family share a word, so "the Workspace" is ambiguous. Renames the Layout menu and API words |
| C. View | A new word for a tab | Collides with `host.ui.viewSwitch` and the narrow layout's "one view at a time" |

Collisions checked: **Space** (a place people enter), **Canvas** (the work area; a layout arranges it), **Aside**, **Home**, **Module** are all different things. "Workspace" is safe only as the free-form layout. Thomas adds the words to Names; this plan does not edit `CLAUDE.md`.

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
  - Not in a call: the page shows the chat and one large **Start call** (or **Join call**) button, not an empty page. This is the Communication mode's front door.
- **Placement, the menu option.** Per decisions 16 and 17, the choice lives on the call's own title bar menu (below). In Conference it offers: **Beside the chat** (call left, chat right; the default in Conference), **Right of the chat**, **Above the chat**, **Below the chat**, and **Call only** (the chat is folded away, one tap brings it back). In the other layouts the same menu offers Top of the column, Bottom of the column, Left of the chat, Right of the chat, Floating window, In the workspace and Its own window.
- **The call title bar is always there** (decision 15), and the conference icon stays in the rail when the column is collapsed (decision 18). In Conference, with no call active, the page shows the call title bar ("Call", **Start call**, the call's menu) over the large Start area, and the chat beside it.
- **In the workspace** in Conference: Conference hides the canvas, so the call fills the area the canvas would have had. Suggested; open (see "What is not decided").
- **Remembered:** the placement is kept per person and per space for Conference, separately from the placement used beside the work (the two modes want different answers). See "Where choices are kept".
- **Memory.** Like Calendar and Map (decision 15), the Conference layout does not write the Workspace's arrangement: `pressLayoutTab('conference')` calls `canvas.holdMemory()`. Going back resumes the Workspace as it was.
- **A screen share** lifts into the canvas today (`syncShareLift`). In Conference the share stays in the call's tiles and gets the large area. The planner has not read the share code; the builder reads it first.
- **Pop out from Conference:** **Its own window** works as now (the call moves to a window; the Conference page shows the chat and a "The call is in its own window. Bring the call back." line).

## The call's menu and Call position

Decided (Thomas, decisions 15 to 17): the call's title bar is always shown and carries the call's menu. **Pop out the call**, **Call position** and the other call options are on that menu and leave the chat's menu, which keeps **Save the chat** and **Delete the chat**. This answers question 1: there is no View menu and no entry in the Layout menu. Build it from the existing `callPlaceItems()` in `public/space.js`, moved to the call title bar's **...**. Reuse only the shared pieces: `host.menu.show` (the menu), `openHostMenu()` for the row **...**, the nav registry for the tabs. No new chrome. The call's own pop-out and collapse buttons stay.

| Where | Choices | Marked |
|---|---|---|
| Any layout but Conference | Top of the column, Bottom of the column, Left of the chat and Right of the chat (each only in a column at least `CALL_LEFT_MIN`, 560px, else disabled with the reason), Floating window, In the workspace, Its own window | The saved one |
| Conference | Beside the chat, Right of the chat, Above the chat, Below the chat, Call only; Floating is not offered; **Its own window** stays. In the workspace is the page itself here (open) | The saved one for Conference |

Labels are plain and short. Screen-reader: the group is a `radiogroup` as `callPlaceItems()` is today; the change is announced through the existing `#layout-announce`.

## Owner controls

In Set up, where **Opens with** and the default layout already are (`public/space-setup.js`, built on `public/switch-list.js`). One section, **Layouts**, with one row per fixed layout that is available in this space:

- a **Show in the bar** switch (the favorites pattern; the heart is for people, the switch for owners);
- **Move up** and **Move down** buttons (keyboard-first; dragging is optional and not needed);
- an **Opens first** choice, one radio across the rows (this is the default). The existing **Opens with** list stays for what the Workspace holds.

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

Routes:

- `GET /api/spaces/:id/layouts` adds, to each entry of `system`, the available fixed layouts including `conference`, `whiteboard`, `documents`, in the owner's order, and a `shown` flag (false when the owner hid it). Also adds `tabs` for the owner's controls (`canSetDefault` already says who may set the default; the same flag gates `tabs`). A guest still gets `system: []`.
- `PATCH /api/spaces/:id { tabs }` and `{ defaultLayout }`: `200` with the space. `400` with a sentence for an unknown id ("There is no such layout here."), for `workspace` in `hide` ("The Workspace is always shown.") and for a `defaultLayout` that is not available now. `403` for a member. Aside ids answer `404`, as the layouts routes do.
- The existing `PUT` and `DELETE .../layouts/:id/favorite` for system ids set the person's `tab`; they refuse an id the owner hid (`409`, "The owner has hidden this layout." suggested).
- Code tables to widen together (all four, then one check that they agree): `SYSTEM_IDS` and `SYSTEM_ICONS` in `server/layouts.js`, `SYSTEM_DEFAULTS` in `server/store.js`, `SYSTEM_TAB_DEFAULTS` in `public/primary-nav.js`, `SYSTEM_TABS` in `public/opens-with.js`. Icons, **decided (Thomas, decision 23):** each fixed layout uses its module's own icon (Whiteboards, Documents, and the Calendar and Map as today), and Conference uses a video glyph from the product's Font Awesome set. Thomas does not pick them one by one.
- The last layout has its own two routes, `PUT` and `GET`, described under "The last layout, on the server"; `GET /api/spaces/:id/layouts` also answers it, so the page needs no extra request on entering.
- No new environment variable. No change to LiveKit, tokens or the call's server routes.

### Pages (experience-design)

- `layoutTabs()` takes the owner's order and `shown`; `tabOverflow()` is unchanged.
- `pressLayoutTab('conference')` is the one new branch: hold memory, set `body.view-conference`, call `syncCallPlace()` and `applyLayout()`. Whiteboards and Documents are ordinary `loadLayout()` of one docked module, as Calendar and Map are.
- `firstVisitLayout()` and `SYSTEM_TABS` take the new ids. A guest follows the owner's default (decision 21); for a default a guest cannot use, the fallback is an open point (see "What is not decided"), and until it is answered the page keeps today's answer, the Workspace.
- The call title bar is drawn all the time (decision 15), with the title "Call", **Start call** while no call is active, and the call's menu; `callPlaceItems()` and **Pop out the call** move from the chat's menu to it (decision 16), gain the Conference variant, **Right of the chat** and **In the workspace** (decision 17).

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

## Roles and permissions

| Role | Sees tabs | Sets default, tabs, order | Notes |
|---|---|---|---|
| Admin, owner | All available | Yes | Same as `defaultLayout` today |
| Moderator | All available | Yes (decision 22) | `MODERATOR_SPACE_FIELDS` |
| Member | Those shown | No | Renames, re-icons and hides tabs for themselves; picks their own Call position |
| Guest | None (no tabs, as now) | No | Follows the owner's default (decision 21); has no stored last layout; what a guest sees for a default they cannot use is an open point |

Permission to see the call is unchanged: no Conference tab without "See and join the conference". A member without that permission never gets the tab and a default of `conference` falls back to the Workspace for them.

## Asides

**Decided (Thomas, decision 24):** an Aside **stays its own thing.** It is already the Conference layout without the work (call only, no modules, column is the whole screen), and it has no space id, no layouts and no tabs. The new Conference layout is the same screen reached from inside a space, with the work one tap away. The two share the column code, so the builder uses `inAside()`'s layout path as the model for Conference. Making an Aside "a space whose default is Conference" would give Asides a space record, members and layouts, which the product deliberately does not have (they are deleted when the last person leaves, `pruneAsides()`). 

## Phones

- No layout tabs on a phone, as now (the narrow layout shows module tabs; the composites are among them). Whiteboards and Documents are module tabs there already when on.
- **Conference on a phone is the call tab,** full screen. Suggested: an owner's default of Conference opens the call tab first on a phone (`restore()` already opens "the first module opened" as the first tab and a guest's first tab is the call).
- **One-tap way back:** the narrow layout's tab bar stays under the call, so the work is one tap away. If plan-phone-experience decision 16 is built first (call in the top bar), the way back is the bottom bar's module buttons. Either way the plan adds no new chrome. **Not read:** the phone tab bar code, so how the call tab looks full screen is unchecked; a builder checks it at 390px.
- **Cap on the main nav:** none. Phones have no layout tabs, and on a desktop `tabOverflow()` already folds extra tabs into **...** without cutting names. At most six fixed layouts plus favorites. **Decided (Thomas, decision 25):** no cap.

## First visit and restore

Today: request, then remembered arrangement, then `opensWith`, then environment, then product default (`restore()`, `whatOpens()`, `firstVisitLayout()`). Suggested order after this plan:

1. A fresh request to open one object (wins, as now).
2. The person's own last layout for this space (`last`, stored on the server, decision 20), if they have one, are not a guest, and it is still available and not hidden by the owner. This **reverses** line 5837 ("entering a space opens on the Workspace tab", plan-layout-views) and Thomas's decision 15 note that the current tab is not remembered across visits, for the person's choice only.
3. The owner's `defaultLayout`, on a first visit, and for a guest every time (decision 21). A default the person cannot use falls to step 4 (for a guest, the fallback is an open point).
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

Each step is one try build, leaves the app working and can be checked alone. Size by job: S about a short sitting, M about half a day, L a day or more. Steps 8 to 10 come from Thomas's answer to question 1; steps 8 and 10 are small and can be built before step 1. Step 11 comes from decision 20 (the last layout on the server); it is a core change, so it is held for an independent read, and step 6 waits for it.

| Step | Job | Agent | Files | Size | Risk |
|---|---|---|---|---|---|
| 1 | **The ids.** Add `conference`, `whiteboard`, `documents` to `systemLayoutsFor()` (available rules above), the four code lists, the icons; `defaultLayout` accepts them. Whiteboards and Documents tabs work as Calendar and Map do. Conference is listed but pressing it only loads an empty layout | server-development, then experience-design for the tab | `server/layouts.js`, `server/index.js`, `server/store.js`, `public/primary-nav.js`, `public/opens-with.js`, `public/space.js` | M | Low |
| 2 | **Owner's tabs.** `tabs` on the space record, `PATCH` rules, `GET` returns the owner's order and `shown`; precedence with the person's `tab` | server-development | `server/store.js`, `server/index.js`, `tools/check-layouts.mjs` | M | Low |
| 3 | **Owner controls in Set up.** The Layouts section: Show in the bar, Move up and down, Opens first | experience-design | `public/space-setup.js`, `public/switch-list.js`, `tools/check-setup-tabs.mjs` | M | Low |
| 4 | **The Conference layout.** `body.view-conference`, the chat column keeps its current width and the call fills the remaining width (no percentage setting), the lifted 55% cap for this layout, the empty "not in a call" page with the large Start button, hold-memory behaviour | experience-design | `public/space.js`, `public/canvas.js`, `public/style.css` | L | **High:** layout and canvas work |
| 5 | **The placement option.** The Conference variant of Call position on the call's menu, per-space storage | experience-design | `public/space.js` (`callPlaceItems()`, `DEFAULT_PREFS`), `tools/check-canvas.mjs` | M | Medium |
| 6 | **First visit and restore.** Read the person's `last` from `GET .../layouts`, write it with `PUT .../last-layout` when the layout changes, the order in "First visit and restore", a guest follows the owner's default (the fallback waits on Thomas). Needs step 11 | experience-design | `public/opens-with.js`, `public/canvas.js`, `public/space.js`, `tools/check-canvas.mjs` | M | Medium (changes what opens) |
| 7 | **Phones and an Aside check.** Conference as the call tab, a default of Conference at 390px, no change to Asides | experience-design | `public/space.js`, `public/style.css` (the `max-width: 640px` blocks) | S | Medium |
| 8 | **The call title bar, always shown, with its menu.** Draw the call title bar with no call active (title "Call", **Start call**, the call's menu), and the conference icon stays in the collapsed rail (decision 18); move **Pop out the call** and **Call position** from the chat's menu to the call's menu; the chat's menu keeps **Save the chat** and **Delete the chat** | experience-design | `public/space.js`, `public/style.css`, `tools/check-canvas.mjs` | S | Low |
| 9 | **Two new positions.** **Right of the chat** and **In the workspace** in Call position, the two new remembered values, the Conference variants, phones behaviour once decided | experience-design | `public/space.js`, `public/canvas.js`, `public/style.css`, `tools/check-canvas.mjs` | M | Medium (layout and canvas work); needs the open points below answered first |
| 11 | **The last layout on the server.** `last` in `layouts.json` (cleaned layout id and `at`, one entry per person per space), `PUT /api/spaces/:id/last-layout`, `last` in `GET .../layouts`, the clean-up in `forgetPerson`, `forgetSpace` and `remove()`, `403` for a guest, `404` for an Aside. Build it before step 6 | server-development | `server/layouts.js`, `server/index.js`, `tools/check-layouts.mjs` | M | Medium: **core change** (`server/`, stored data format); independent read, full `npm run check` |
| 10 | **The conference icon in the collapsed rail.** The call's icon stays visible when the column is collapsed, with a live badge while a call is active; one click reopens the area (decision 18) | experience-design | `public/space.js` (the rail beside `#side-column-rail-chat`), `public/style.css`, `tools/check-canvas.mjs` | S | Low |

Documentation after each step is content-manager's: [architecture-navigation](../architecture/architecture-navigation.md) (the layout tabs), [architecture-canvas](../architecture/architecture-canvas.md) (the column, remembered layouts), the API document for `tabs` and `defaultLayout`, [userguide-call](../userguides/userguide-call.md), [userguide-spaces](../userguides/userguide-spaces.md), and the CHANGELOG. The Names section of `CLAUDE.md` is Thomas's.

## Verify

- **Step 1.** `tools/check-layouts.mjs`: the three new ids come and go with their module, the permission and the switch; a guest gets `system: []`; `defaultLayout: 'conference'` is accepted while available and refused after. `tools/check-nav.mjs`: the tabs and their order. A check that the four code lists name the same ids (new, small).
- **Step 2.** `tools/check-layouts.mjs`: `tabs` round trip; unknown id, `workspace` in `hide` and a member's write refused; a missing id is added at the end; the person's `tab` is overridden by the owner's `hide`; an Aside answers `404`.
- **Step 3.** `tools/check-setup-tabs.mjs` for the section's words and switches. Live in Chromium (the planner's expectation for the builder): an owner hides Documents and moves Conference first; a member's bar follows after a reload; keyboard-only reorder works.
- **Step 4.** `tools/check-canvas.mjs` for the pure clamps (the chat keeps its width, the call takes the rest, the least chat). Live in Chromium at 1280, 900 and 641px, light and dark: the page is the call and the chat; not in a call it shows the Start button; the Workspace comes back as it was (modules, positions); Chat keeps its least width; the fold handle is gone. **Cannot be checked without a real LiveKit call:** the tiles at large size, a screen share in Conference, audio and video, a second person joining.
- **Step 5.** Check the choices persist across a reload and differ between Conference and the other layouts; Left is disabled below `CALL_LEFT_MIN` with a hint.
- **Step 11.** `tools/check-layouts.mjs`: round trip of `last` for one person; a second person's `GET` never shows it and their `PUT` cannot reach it; an unknown id, a missing id and a long id refused (`400`); a guest refused (`403`); an Aside `404`; the entry removed with the person, the space and the layout it names; the file stays small after many writes (one entry). Full `npm run check`, then an independent read. A real browser round trip across two browsers is checked live in Chromium if the build allows.
- **Step 6.** `tools/check-canvas.mjs` for the new order (pure `firstVisitLayout()` and `whatOpens()` cases: the person's `last` wins, no `last` gives today's answer, the owner's default on a first visit and for a guest, a layout that is gone, off, or hidden by the owner falls through). The guest fallback cases are written once Thomas answers.
- **Step 8.** Live in Chromium: the title bar shows with no call, **Start call** is there, the call's menu holds the call items, the chat's menu holds only the two chat items; light and dark; the touch-target checks. Starting a call needs LiveKit: cannot be checked here.
- **Step 10.** Live in Chromium: collapse the column, the conference icon shows in the rail with no call and with the badge in a call, one click reopens, Tab reaches it and it has an accessible name. The live badge in a real call cannot be checked here (no LiveKit).
- **Step 9.** `tools/check-canvas.mjs` for the pure placement rules (the two new values, the fallback when the column is too narrow). Live in Chromium at 1280, 900 and 641px: Right of the chat and In the workspace place the call, persist across a reload, and return cleanly to the other positions. **Cannot be checked without a real LiveKit call:** the call tile in the workspace at real size, a screen share, audio and video.
- **Step 7.** Live at 390px (headless Chromium): the call tab is full screen, the tab bar is one tap to the work; `tools/check-narrow.mjs`, `tools/check-phone-targets.mjs`.
- **Always:** `npm run check` and `npm run check:docs`. Not checked by any step: a real phone, a real screen reader, Firefox, Safari, a real call.

## Tests and checks to add

The new id-agreement check (step 1); new cases in `check-layouts`, `check-nav`, `check-canvas`, `check-setup-tabs`, `check-narrow` as above. No new tool is needed beyond the one small agreement check.

## Risks, ranked

1. **The Conference layout fights the column's rules** (the 55% cap, the fold handle, the Left minimum, the share lift). A wrong change squeezes the chat or leaves a dead page. Mitigation: step 4 alone, behind a flag-free but small change set, checked at three widths; the cap lifts only in Conference.
2. **What opens changes** (step 6): remembering the last view could open someone on a layout they did not expect, or on Conference with no call. Mitigation: the order above, a fall-through for an unavailable or hidden layout, and the Workspace as the safe floor.
2a. **A new stored record and route** (step 11, decision 20): a bug could let one person read or set another's record, or let the file grow. Mitigation: the key is taken from the session only, one entry per person per space, a size and id check, the clean-up on removal, an independent read and the full `npm run check`.
2b. **Guests and the owner's default** (decision 21): an owner's default of Calendar, Map, Whiteboards, Documents or a saved layout is one a guest cannot use. Until Thomas picks the fallback, the page keeps today's answer, the Workspace.
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

These are the facts the documents will carry, so content-manager does not guess: the six fixed layouts and their ids; that Workspace is always shown; that Conference needs the call service, the environment switch and the permission; the owner's three controls and who may use them; the precedence rule (owner's hide wins); that the last layout is kept on the server, per person and space, and a guest has none; the Conference placement choices; that an Aside is unchanged; that pop-out stays. Words people read: "Conference", "Whiteboards", "Documents", "Layouts", "Show in the bar", "Opens first", "Call position", "Beside the chat", "Above the chat", "Below the chat", "Call only". The Names entries for **Layout** and **Workspace** are Thomas's.

## What is not decided

Every numbered question is answered (decisions 12 to 26); "Open questions for Thomas" below is empty. What is left are the open points below.

**The guest fallback (new, from decision 21).** A guest follows the owner's default. A guest has no layout tabs and `GET /api/spaces/:id/layouts` answers `system: []` and no saved layouts for a guest, so a guest can open only the Workspace as they have it today (the call and the chat; `whatOpens()` gives a guest the conference and the chat) and, with the permission, Conference. What a guest sees when the owner's default is something else:
- **Cannot be opened as a layout at all:** Calendar, Map, Whiteboards, Documents, and any saved or shared layout. Today the server and `firstVisitLayout()` answer the Workspace for these.
- **Modules a guest cannot read by default** (per the manifests' `guest` defaults; an owner can change them per space): Budget, Vault, Stream. A guest sees them as not available (the guest landing notice lists what is not available to guests; [architecture-access](../architecture/architecture-access.md), "The guest door", and plan-access-bundle requirement 4).
- **Modules a guest can read but not change by default:** Calendar, Documents, Whiteboard, Maps, Places, Polls, Research, To-do, Planner and the Assistant. Documents and Whiteboards are read-only for a guest, so a Documents or Whiteboards default would show a guest something they cannot work in.
- **Proposed fallback, not decided:** a default a guest cannot use opens the **Conference** for the guest (the call and the chat, which a guest always has with the permission). The alternative is today's behaviour, the Workspace (which for a guest is already the call and the chat in the column). Thomas decides. This blocks step 6 only (the guest default); step 1 is not affected.

Open points from decisions 17 and 18 (the position points block step 9, the rail points step 10; steps 8 and 5 do not wait):

- **What "In the workspace" means with the canvas modules.** One more docked, module-like window in the layout (it would be saved and restored with the arrangement, and would need the call to behave like a module window, which [plan-call-as-module](plan-call-as-module.md) may cover; not re-read for this update), or a pane of the canvas that is not a module. The planner leans toward the first only if it costs no new chrome; Thomas decides.
- **In the workspace in the Conference layout.** Conference hides the canvas. Suggested: the call fills the area the canvas would have had, so In the workspace and the Conference page are the same thing there.
- **Where **Start call** sits when no call is active.** On the always-shown call title bar (decision 15) is the starting point; whether it also shows as a large button in the call's area (as in "The Conference layout") is open.
- **Phones.** There is no column and no title bar area on a phone (the call is a tab). Whether Right of the chat and In the workspace are offered there at all, and what the always-shown title bar becomes on a phone, is open.
- **The collapsed rail (decision 18).** Today the collapsed column is a rail with the chat button (`#side-column-rail-chat`), an unread badge (`#side-column-rail-unread`) and the faces of people (`#side-column-rail-faces`), in `public/space.js` around lines 1711 to 2000; the planner read only a search of it, not the whole collapse code. Open: whether the conference icon sits beside the chat's icon in the rail or on its own; what the live state is (a dot, or the elapsed time as a badge) and how it fits with the faces; whether **Start call** can be pressed from the rail with no call active, or the icon only reopens the area; the keyboard and aria rules (a button in the tab order, an accessible name such as "Show the call", the state said to a screen reader, as the unread badge does); phones, which have no column or rail, so the call tab is the only place, and whether the always-shown title bar needs anything there.
- **Right of the chat** when the column is narrow: suggested to follow the Left rule (`CALL_LEFT_MIN`, falls back to Top). Question 1 is decided (decisions 15 to 17) and no longer blocks step 5; the position points block step 9 only.

## Open questions for Thomas

None. All twelve questions are answered and recorded as decisions 12 to 26. What is still undecided is under "What is not decided".
