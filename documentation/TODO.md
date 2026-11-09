# To do

GitHub issues are the work list: <https://github.com/Drowbe/coffee-pub-chameleon/issues>, on the board at
<https://github.com/users/Drowbe/projects/8>. This page is an index of the open issues, grouped, with a few words
each; the issue holds the detail. See the Studio repository for that app's side of things.

## How issues are tracked

Each issue carries one priority label: `priority: now`, `priority: next` or `priority: later`. The board's columns
are the priorities, **Now**, **Next** and **Later**, then **Done**, which the board sets when an issue closes or its
pull request merges. The board is the source of truth for priority: Thomas drags the cards, running the sync below
brings the labels in line, and adding a label moves the card.

A workflow (`.github/workflows/project-priority.yml`) keeps the board in step with the labels: adding a
`priority: ` label moves the issue's card to the matching column and removes the issue's other priority label.
Without the setup below, it only tidies the labels and logs a notice. When two priority labels arrive at once only
one is kept, and the run for the other logs `Label "<label>" is no longer on issue #N, so neither the labels nor the
board were changed.` Any other label logs `Label "<label>" is not a priority label; nothing to do.`
`tools/check-project-status.mjs` (in `npm run check`, 11 cases) checks the workflow without a network.

The reverse, **Project priority from the board** (`.github/workflows/project-priority-sync.yml`), runs only when
started: from the **Actions** tab (**Run workflow**), or with `POST repos/{owner}/{repo}/actions/workflows/project-priority-sync.yml/dispatches`
and `ref=main`. It sets each open issue's `priority:` label to match its column: Now, Next or Later sets that
label, Inbox or no column clears it, and Done is left alone. It fails without changing any labels when the board's field is missing, isn't single-select, or has no Now, Next or Later option. It reports each change as a notice and in the run
summary. After the labels it reports the board's order: Now, Next and Later top to bottom as dragged, and Inbox, unranked, if it holds anything, in the run summary ("Order on the board") and as one notice per column, such as `Now: #157, #165, #160, #161`. The managing session reads that order before planning work. If a board view has its own sort, the report follows the manual order, not that sort. `tools/check-project-sync.mjs` (in `npm run check`, 21 cases) checks it without a network. It uses the
same setup.

### Board setup (once)

1. Create a classic personal access token with the `project` scope, and `repo` too if the repository is private.
   Fine-grained tokens can't reach a project owned by a user yet. Give it an expiry, and renew it.
2. In the repository's **Settings** > **Secrets and variables** > **Actions**, on **Secrets**, add `PROJECT_TOKEN`
   with the token.
3. On **Variables**, add `PROJECT_OWNER` = `Drowbe` and `PROJECT_NUMBER` = `8`, and, if the field isn't called
   Status, `PROJECT_FIELD`.

## Built, 2026-10-13 and 2026-10-14

The one-bar work, in main. Each plan has its own status line.

- **The one bar and the always-on column** ([plan-one-bar](plans/plan-one-bar.md)): steps 1 to 8 built, with Discussion | Assistant, the call in its own titlebar and **Call position**. Left from its Verify: a real call (screen share into the Workspace, Pop out with the column), a real phone, a screen reader, Firefox and Safari (#29, #30).
- **The Set up panel** ([plan-setup-panel](plans/plan-setup-panel.md)): all eight steps built.
- **The status strip** ([plan-space-status-strip](plans/plan-space-status-strip.md)): steps 1 to 4 built (the journey bar, the attention store, the count and its list, Polls reporting), and since 2026-10-14 one countdown chip ("35 days to Trip"). Step 5, space items, is not built.
- **The story strip** ([plan-space-story-strip](plans/plan-space-story-strip.md)): steps 1 to 7 built (no caret, the sentence, the 44 px bar, the facts, the Planner's money, the budget target). Choosing what shows, weather and usual temperatures (steps 8 to 10) are not built.
- **Budget** ([plan-budget-module](plans/plan-budget-module.md)): steps 1 to 4 and 6 built 2026-10-14 (the target's rules, Budget with its burndown, Budget pulling the Planner's priced bookings in read-only with the Planner's Money view and Spent chip giving way, Set up's field for moderators). Step 5 (the travel template turns Budget on) is not built; step 7 (documentation) is written for what is built and is finished with step 5.
- **The call column, 2026-10-14:** **Start call** in the chat's view row, Pop out in the call's titlebar, a round call toolbar, the call's time (#37), narrow-layout docking (#268) and guests in Home's chat (#289) are built. See the CHANGELOG.
- **Layout views** ([plan-layout-views](plans/plan-layout-views.md)): steps 1 to 6 built. Its Phase 2 (owner-set tabs, reordering) is for later issues.
- **Calendar and To-do, Map and Places as one** ([plan-calendar-todo](plans/plan-calendar-todo.md), [plan-map-places](plans/plan-map-places.md)): steps 1 to 3 built; the entries arrive as the Calendar and Map layout tabs and Global Calendar and Global Map.
- **Home as three columns** ([plan-home-lobby](plans/plan-home-lobby.md)): steps 1 to 4 built, and guests in Home's chat (#289). Left: the Lobby's wording and Manage's Home row (step 5) and the narrow layout (step 6) (#290).
- **The titlebar + and status line** ([plan-module-titlebar-add](plans/plan-module-titlebar-add.md)): steps 1 to 6 built.
- **The picture map** ([plan-map-image](plans/plan-map-image.md)): steps 1 to 4 built. Left: its documentation (step 5) and trying it with WebGL and a large file.

## Next

The open issues labelled `priority: now` or `priority: next`:

- #283 A phase-change event for modules (`host.on('phases')`), so the Calendar stops polling every 30 seconds and a non-member admin sees phase edits.
- #290 Home: finish the Lobby wording and the narrow-layout tabs.
- #286 `/api/bus/actions` should tell each action's `may`.
- #216 Trip Budget in the titlebar with a burndown overlay: the facts, the target and the burndown (in Budget's Overview) are built; Thomas to close it, or say what is still missing.
- #288 The call pop-out when the browser blocks the pop-up: a message and a retry, never an empty call area.
- #29 and #30 Walk the canvas, layouts and modules in a real call, with two people (see "Verify in a real call").

## In progress

- **The Vault's privacy, what is left** ([plan-vault-privacy](plans/plan-vault-privacy.md)): the screens (Vault 0.4.4) and the share link rule (a link holds only what its maker can see, #514) are built. Left: "File removed" only for those who could see a deleted restricted file, and the export, erase and leaver rules (rest of slice 4); the server sending `visibility` to people who need it so the "Shared with you and others." line, **Not shared with you** for a moderator with **See every file** and the share sheet's sentence show for them; a server preview of a change so the narrowing question's numbers are exact; role words in the people picker; the list of share links not counting a file its maker lost sight of; and keeping the choice when **Add files** is closed and opened during an upload. See [known-issues](known-issues.md).
- **The host console redesign** ([plan-host-console](plans/plan-host-console.md)): built through slice 6 and on main (#509, 2026-11-09). Left, each on its own:
  - The Modules route (slice 7): `GET /api/host/modules`, with each module's version and which environment runs it. The Modules section today is a read-only list of the modules the host ships.
  - Light mode: the console's host serves no `/theme.css`, so the console is dark only. Light mode needs a server change.
  - The server still lets a host admin remove themselves or the last host admin; only the page hides the button.
  - The Owners tab has no list of an environment's owners: you reset a second factor by typing a login.
  - Host-run module install and update (slice 8), and an environment's Domain tab (#50, drawn as "later").

- **The leftovers `check-names` still allows.** The old words kept on purpose are listed in `tools/check-names-allow.json`; the clean-up of the ones that are not deliberate is under way, and each entry that goes is removed from the list. Do not add to it for new code.

- **Environment templates** ([plan-environment-templates](plans/plan-environment-templates.md)): done, except the live verification of addendum 2's steps 3a and 3b (#68). Addendum 3, editing a bundled template on the host console and Duplicate (#91), is built and its console was walked live (2026-09-30). Addendum 4, the word for entering a space, is built and verified live (2026-09-30).
  (September 25, 2026).
- **Calendar and Map in the top bar** ([plan-calendar-destination](plans/plan-calendar-destination.md), [plan-map-destination](plans/plan-map-destination.md)): built 2026-10-02; since 2026-10-13 they are **Global Calendar** and **Global Map** in the profile menu, and the Calendar and Map are layouts in a space, every build step of both plans. Open for Thomas:
  - In the narrow layout the **Agenda** tab has the Calendar's icon, the same as the **Calendar** tab beside it (a tab's icon is its module's).
  - Map stays hidden while Maps' map is a file at a web address: only a map file on the server (or the host's folder) counts, though the plan said a web address does too.
  - The destination page reads the Calendar's **Open on** setting by its key (`defaultView` in `KINDS` in `public/destination.js`), so the host page knows one module's setting by name.
  - Manage's reason for Map with no map file reads "Choose a file for "Map files" in Maps' settings first."; the plan had "Choose a map file in Maps' settings first.".
- **Calendar markers** (#167, [plan-calendar-markers](plans/plan-calendar-markers.md)): built 2026-10-03, steps 1 to 4. Open:
  - The Calendar's marker switches on the environment's calendar are not remembered after a reload, as that page's space switches are not; Calendar in the top bar remembers them, and a space's Calendar remembers them per space.
- **The top bar** ([plan-primary-nav](plans/plan-primary-nav.md), approved 2026-10-02): nine steps. Steps 1 (the `home` word and the full list of module pages) and 2 (the bar's layout and moves) are built (2026-10-02), and so is step 2b, the Modules slot leaving the bar (decision 30), and step 3, presence filtered by membership (2026-10-02). Next is the online people widget; then the aside rules, views over the space with the return pill, the visit view and the bell's notifications.
- **Two-zone nav** (#152, #153, [plan-two-zone-nav](plans/plan-two-zone-nav.md)): built 2026-10-02, steps 1 to 5. Open:
  - For Thomas, choices the plan made that he may overrule: in the narrow layout the top bar shows the page's name as a plain label; a module's tools always go in the space bar's right zone (`zone` ignored); the **Manage** link at the start of the page bar on pages that belong to Manage.
  - The Profile page's bar reads "Profile" beside a tab also named **Profile**.
- **The Layout menu** ([plan-layout-menu](plans/plan-layout-menu.md)): steps 1 and 2 built 2026-10-02 (the Arrange section and **Clean up**).
- **Docked limit** (#156, [plan-docked-limit](plans/plan-docked-limit.md)): approved 2026-10-03, three steps, none built. Limits docked modules by the window's width; extras float and dock again when the window widens. Comes before saved layouts' step 2.
- **Space calendars** (#179, [plan-space-calendars](plans/plan-space-calendars.md)): approved 2026-10-03, nine steps (0 to 8). Steps 0 to 2 built 2026-10-04: the two known problems, the `otherCalendars` and `publishedCalendar` switches, and Calendar sharing and Show in the top bar on the modules' configuration pages. Steps 3 to 5 built 2026-10-05: a space's address for each member, the published calendar's one address with **In the published calendar** on a space's page, and Profile's **Calendars** tab with every reason in place. Left: busy times (6 and 7: the `busy` hook, `host.busy`, the lanes, the **Busy** menu, **Free for everyone**, and the Calendar's menu entries **Add to my calendar app** and **Share my busy times** in a space), the documentation of those (8), and, from the plan's Verify, a real Google or Apple subscription to a space address and to the published calendar. Open for Thomas: the differences listed in the plan's "Progress", among them Show in the top bar as its own **Top bar** section, Manage's one line not mentioning that **Show Map** moved to Maps' configuration, the Calendars tab showing to an owner with both switches off, and the published address answering an empty calendar (not a 404) while the Calendar is off.

- **The Vault** ([plan-attachments-vault](plans/plan-attachments-vault.md)): steps 1 to 6 are built: the store and routes, the Vault module (0.3.2) and the file windows with the PDF viewer, linking files from other modules (`host.files`, `host.ui.fileChips`, the Planner's attachments), share links with the public page, and the orphan sweep, "File missing", uninstall counts and the `VAULT_DIR` volume in `docker-compose.yml`. The words Documents and Handouts are in the Travel and Games templates. Left: the Modules page does not yet show the uninstall counts (`filesRemoved`, `filesKept`; the uninstall question does not mention files, read as code); a backup that carries the files' bytes (its own plan); the Vault's files for Research and Chat pictures, more modules linking (Research notes, To-do, Calendar, Budget), the environment-wide library and Google Drive (each its own plan); and everything marked "Not verified" in the changelog (a real phone, a real proxy and public address, two people at once).

## Planned

- **Attaching words and pictures for the Assistant** ([plan-ai-pictures](plans/plan-ai-pictures.md)): approved 2026-11-09; nothing built. `host.chat.attach` stages words, an object or a picture as a chip in Chat's input, and nothing goes to the AI until the person presses Send; the Whiteboard's **Send to Assistant** (words) is built on it first, then the picture steps (provider support, the in-memory hold, the What AI may see switch, off by default, `ask@4`). Attached words go as their own part, up to 8,000 characters; `host.chat.ask` stays as it is (Research and the Assistant unchanged); the manifest declares pictures only. Steps touching the server or the bridge are held for an independent security read. Later: revisit retiring `host.chat.ask`.
- **AI integration, slice 2 onward** ([plan-ai-integration](plans/plan-ai-integration.md)): slice 1 (the prompt registry, the context builder, the policy layer, the provider adapters, the fake model and the golden checks, with `AI_LOG_PROMPTS`, `AI_PROMPT_VERSIONS` and What AI may see) is built (2026-11-03). Slice 2's steps 8 to 10 and 12 are built (2026-11-04): the look-up tools `search_objects@1`, `read_object@1` and `answer@1` and their loop in Chat's `/ai`, the **Let AI look things up** switch, **looked up N** under an answer, and the catalog of write tools from the modules' manifests (`GET /api/ai/catalog`); described in [architecture-ai](architecture/architecture-ai.md). Left: **step 11**, the plan's 13-step test against a real provider (everything so far ran only against the fake model; it waits on Thomas supplying one provider key with a spending limit set on the provider's console, about US$10, and an environment with 500,000 monthly tokens that no real people use); **step 13**, proposals on the answer with **Keep** and **Drop** and the request on Keep (needs step 11 first); tokens and an MCP endpoint for outside AI apps. Also still to do: walk the pages with two roles.
- **Map themes and Map options** ([plan-map-options](plans/plan-map-options.md)): approved for step 0 only (Thomas, 2026-11-04). The Prototype's Maps section is drawn; steps 1 to 4 (the map themes' tokens, `/theme.css`'s default field, the Maps module's **Map options** entry and panel) wait until Thomas has seen it, and one question on it is still open.
- **Module emoji and Whiteboard stickers** ([plan-module-emoji](plans/plan-module-emoji.md)): approved 2026-11-09; nothing built. Six steps in order: `host.emoji.list()`, the SDK-drawn `host.ui.emojiPicker()`, the chat's picker moved onto it, then the Whiteboard's `sticker` block and its Sticker tool (pick, then click to place; key S), then the documentation. Steps 1 to 3 change `public/sdk/host.js` and start only after the toolbar change on `pm/toolbar-right-zone` has merged.
- **Live messages for modules** (#496, [plan-module-live](plans/plan-module-live.md)): approved 2026-11-09; nothing built. `host.live.publish` and `subscribe` over the app's own server (the module stream), never LiveKit; first use the Whiteboard's live pointers. Steps 1 to 4 (the route, join and leave, guests, and the missing access rechecks when a member is removed or a role changes) are held for an independent security read before anything reaches Thomas.
- **The phone's bottom bar** ([plan-phone-experience](plans/plan-phone-experience.md), decision 16): four module buttons and a switcher, the call in the top bar. Decided 2026-11-03; drawn on the Prototype, not built in the product.
- **The Planner's low-severity audit items** (PLN-13, PLN-14 and PLN-17 to PLN-25 in the health audit of the Planner): not touched. The audit fixes made so far are in Planner 0.16.0 and 0.16.1 (see the CHANGELOG).
- **Known gaps, recorded so they are not lost.** Chat's input attaching an object in a person's own scope (named by the project manager; not checked in code by this entry's author). A length (duration) is not kept on the server's record of an object, so a summary has none to send (named by the project manager; not checked). The guest case of `tools/check-ai-page.mjs` (a guest is not invited to ask and sends nothing) is a gap at the 390 pixel width (named by the project manager; not run or read for this entry). The list of what became of recent Clear tokens (`ends` in `server/module-holds.js`) is in memory only, so after a restart a refused Undo says the time is over whatever happened to that token.
- **Ownership of Research's notes, links and answers on the server** (RS-01): the server holds a photo to its owner and to **Remove photos other people added** (Research's `guards`), but a note, a link or an answer has no owner rule, so anyone who may edit can change or delete another person's. Chat's own routes and the action bus were not re-read for this entry. See [known-issues](known-issues.md).

- **Itinerary phases and markers** ([plan-itinerary-phases-markers](plans/plan-itinerary-phases-markers.md)): decided 2026-10-15, ready to build when Thomas says go; nothing built. Phases drawn as a rail with caps, markers by job, no "Built in", the Buffer phase dropped and gaps allowed between phases (steps 1, 1b, 2 and 3, then documentation).
- **Object handoff** (#182, #181, [plan-object-handoff](plans/plan-object-handoff.md)): approved 2026-10-03; all nine build steps done (1 to 5 on 2026-10-03, 6 to 9 on 2026-10-04, including **Send to...** on chat messages). Left: trying the copied instructions with at least two outside AIs and a picture sent over a real call (the plan's Verify). The default-place rule (the module naming the fewest kinds wins, and an event that reads as travel goes to the Planner) was confirmed by Thomas on 2026-10-04.
- **Editor window and the Planner's kind picker** (#192, #193, [plan-editor-window](plans/plan-editor-window.md)): approved 2026-10-04; steps 1 to 8 built 2026-10-04 (the editor window: every module's Add and Edit form opens in a window over everything through `host.ui.editor`, a full-screen sheet in the narrow layout, asking before discarding changes); steps 9 and 10 built 2026-10-05 (the Planner's kind tiles as one filterable field, `host.ui.kindPicker`, with one Markers group, Planner 0.15.1; QA passed on the retest). Step 11 built 2026-10-05: an uploaded module's frame lifted over the canvas for its form, exactly the form's size. Left from the plan's Verify: a real call with a form open, the kind picker on a space's canvas (checked on the Planner's own page only), Firefox, Safari and a screen reader. Open for Thomas:
  - The kind picker's day-or-between-days field is labelled **When** on screen, as before; the plan calls it Where. Whether the label should change.
  - Research's window title lost its object count (#191, Research 0.4.3). Places, To-do and Polls still show a count inside their own header, under the titlebar ("12", "3 open", "2 open"); whether those go too.
  - On a light theme the chosen marker's icon in the kind picker can be low-contrast (`--on-accent`, white, on a yellow an owner chose), since marker colours are the owner's, not the accent.
  - A kind chosen in the picker and then cancelled with the form still counts as recent.
  - Research's note **Type** and Places' **Category** could take the kind picker (plan decision 14 names them); not planned.
- #2 The first time: guidance, welcome cards, an owner's setup checklist ([plan-entering](plans/plan-entering.md)).
- #12 Object status: action required, tentative, confirmed ([plan-object-status](plans/plan-object-status.md)).
- #13 Planner changes shown in the Calendar. A dated plan object is now on the Calendar and kept in step (#96, [plan-plan-calendar-sync](plans/plan-plan-calendar-sync.md)); what #13 still asks beyond that is to be decided.
- #73 Research from any AI ([plan-research-import](plans/plan-research-import.md)): phase 1 (copy instructions, paste or file import into Research or the Planner) is done. Still to come: To-do and Calendar as destinations through a generic conduit, which needs its own plan; and phase 3, a direct connection for AI apps, which waits on #64.
- A rollup on each space's tile on home, starting with the Planner, chosen per space, in place of the removed Trips tile ([plan-dashboard](plans/plan-dashboard.md), phase 5): a direction from Thomas (2026-10-02) with open questions, not yet a contract.
- Rename the dashboard's widgets to **tiles** (Thomas, 2026-09-30): "widget" now means a live piece in the header's bars, such as who is here. A renaming plan with a data migration comes next; not written or built.
- The call-name fallback goes: `server/call-names.js` still reads the call names from before Names step 3 ([plan-names](plans/plan-names.md), step 10).
- #132 A document editor (ProseMirror) for the long prose fields: research notes and answers, plan notes, to-dos, places, and calendar details. Markdown stays what is stored. Chat stays a textarea. About two weeks. Building waits on a go-ahead.

## Verify in a real call

- Real-time without LiveKit ([plan-realtime-optional-livekit](plans/plan-realtime-optional-livekit.md), built 2026-10-26, checked by tools with no LiveKit server): on a real LiveKit, join and hang up (the call's token from **Join the call**, tiles, audio, video, screen share), the calls cap, a kick of someone on the call (they leave the space and the call), mute, a pull into and out of an aside while on the call, reactions on tiles and OBS boxes, the OBS view's video and a call's reconnect after a network drop. Also two phones on a real network for the live stream (a dropped signal and the 15-second grace).
- Calendar feeds and other calendars (#42, built 2026-10-03): subscribe from real Google Calendar, Apple Calendar on a Mac and an iPhone, and Outlook; check repeats, all-day events and times in the server's `TZ`, and that turning the address off empties it; add a real Google secret address and an Apple one, with repeats and time zones, and see them only for that person. Checked so far by `tools/check-feed.mjs` (22 groups since #179 steps 0 to 2) and `tools/check-external-calendars.mjs` (29 checks), with no real calendar app.
- The narrow space bar (#160) and chat links (#158), built 2026-10-03: the tab bar on a real phone and in a narrow pop-out (More's badge and the call's dot, Leave inside the window), and a link's preview and **Keep** with two people, one of them a guest (no Keep), and Research closed then opened. Checked so far by `check-nav`, `check-chat-links`, `check-chat-page` and `check-research`.
- Saved layouts and Clear… ([plan-saved-layouts](plans/plan-saved-layouts.md), [plan-chat-clear](plans/plan-chat-clear.md), built 2026-10-03): loading a layout while on the call (the Conference kept), a default layout on a first visit and for a guest, and clearing everyone's messages with two people in the space (the line others see). Checked so far by `check-layouts`, `check-chat-model`, `check-chat-page` and `check-nav`.
- Favorite layouts (#190, [plan-favorite-layouts](plans/plan-favorite-layouts.md), built 2026-10-04): loading a favorite from the space bar while on the call (the Conference kept), and the favorites with a real screen reader, in Firefox and in Safari. Checked so far by `check-layouts`, `check-nav` and the builder in Chromium.
- Flight lookup (#188, [plan-flight-lookup](plans/plan-flight-lookup.md), built 2026-10-04, QA passed with notes and the notes fixed in Planner 0.13.2): the **Look up a flight** row and the **Flight schedule** section in Firefox and Safari and with a real screen reader; and how often real lookups find anything, which only use will show. Checked so far by `check-flight-lookup` (37) and `check-travel` (92), and by the builders in Chromium on a single and a hosted install. No call is involved.
- The top bar (steps 1 and 2, [plan-primary-nav](plans/plan-primary-nav.md)): the breadcrumb in a real aside ("› Disneyland › Aside: Michelle", and clicking Disneyland, or picking it in the switcher, bringing everyone back to the space's call), the switcher and Manage over a running call, **Host console** on a hosted install (only its address was checked, as a pure function), **Install as an app** in the profile menu, a module card's heading on home opening over a running call (Away, then **Back to**), and the bar with a screen reader. Verified so far by `tools/check-nav.mjs` and in headless Chromium with a stand-in LiveKit at 1280, 1024 and 390 pixels.
- Calendar and Map in the top bar ([plan-calendar-destination](plans/plan-calendar-destination.md), [plan-map-destination](plans/plan-map-destination.md)): opening either over a running call (muted while Away, the microphone and camera held off, everything back on closing), a task dragged onto a day and an event onto the To-do, the map drawn with WebGL from real map tiles, and a place search with Photon. Verified so far by `tools/check-destinations.mjs`, `check-module-host`, `check-nav` and `check-drop`, and in headless Chromium with a stand-in LiveKit and a stand-in place search, without WebGL.
- Presence by membership (step 3, [plan-primary-nav](plans/plan-primary-nav.md)): with three people in two spaces, an aside and a private conversation pulled from one of them, check the space cards' "N here", the switcher, Who's around, the members' tooltips and "off stream", and the placeholder tiles (named for an ordinary aside, never for a private one, also after a reload). Verified so far by `tools/check-presence.mjs` (15 checks), `tools/check-nav.mjs`, and live against the API and in headless Chromium with a stand-in LiveKit.
- #29 Walk the call's layout, the canvas and the calls cap in a real call, and the 2026-10-14 call changes: **Call position** (Top, Bottom, Left, Floating, Its own window), the pop-out with the column, a screen share lifting into the Workspace, and the 45% chat minimum.
- #30 Modules with two people on a real server, including Home's live chat and its unread badge, going Home from a space, and the status strip's needs-action count with a second person.
- Joining and pulls (Thomas's changes of 2026-09-30, [plan-entering](plans/plan-entering.md)): **Join the call** and the green phone with two people, **Currently on the call** and who is here following them live, the calls cap's refusal in **Not in a call**, and entering never asking for the microphone. An owner's pull into a real aside and back, and **Rejoin call**, keeping the call for those on it and not for those off it, including within the server's 15-second hold on a new call's place. Verified so far in headless Chromium with a faked LiveKit and by tools only.
- Pulled into an aside, then **Rejoin call** (fixed 2026-10-01): the pulled person's space bar shows **Rejoin call** and the top bar's breadcrumb reads "<space> › Aside: <names>" (since 2026-10-02; it was "<space> · Aside" in the space bar), and **Rejoin call** takes them back to the space's call, still on it if they were. Verified so far in headless Chromium with a stand-in LiveKit and by `tools/check-canvas.mjs`.
- #95 Planner phases: entering a Travel space opens the Planner and chat and joins no call.
- The chat's **Bring in N objects** button: offered for a pasted answer with an `objects` block, a `card` block or no fences, and not for an answer with an old-named block ([plan-kind-names](plans/plan-kind-names.md), step 5; the route behind it was checked).
- The fixes from Thomas's real call of 2026-10-01, verified so far with a faked LiveKit and by tools only. Join first, then have two people join without push to talk: no "muted" on their tiles, and muting and unmuting follows on every screen. Away: you hear nobody, the microphone button, **M** and push to talk don't open the microphone, and **Back** restores what was on. In the installed app, pop out, then minimise or cover the main window for more than 10 seconds: the videos in the pop-out keep moving. Also see whether audio in the pop-out is ever held back by the browser's autoplay rule (suspected, not seen). Away for late joiners: go away with a message, then have someone join, and someone reload; both see your tile as away with the message, and the camera button and **V** don't turn your camera on until **Back**. Drop someone's connection until it reconnects: the others keep their tile, and they still count as on the call.
- #3 Entering a space ([plan-entering](plans/plan-entering.md), Part 1, built 2026-09-30): **Enter** and **Back to** on the space list (and **Back to** an aside); what opens on a first and a second visit, and for a guest; the first tab in the narrow layout; the status line.

## Small fixes and checks

- Top bar follow-ups from steps 1 and 2 ([plan-primary-nav](plans/plan-primary-nav.md)):
  - `server/index.js` still sends `module.nav` in a module's context (about line 5533), from `surfaces.page.nav`, which nothing reads now; drop it.
  - The space list shown while still connected has an empty breadcrumb until the return pill (step 7).
  - A page opened from home over a space says "← Back to <space>", but it returns you to home, not the space. The wording should say where it goes.
  - Stream's environment page: list anything that belongs in its settings on Manage's Modules tab instead (decision 33).

- Walk linked objects and plan and calendar sync live, Planner and Calendar side by side in one space (the drag that keeps a link on its day, the live refresh, "Used by N.", a twin made, moved, retitled and deleted on each side), and the one-time backfill on a hosted install. Built in #98 to #104 and checked by tools only.
- #110 The old name, Magpie, is gone from the code, the templates and the guides, architecture, API and design documents, and the file formats are named by kind ([plan-kind-names](plans/plan-kind-names.md), built 2026-09-30). Still to do: the logo images (`public/assets/images/brand/logo-light.png` and `logo-dark.png` read "COFFEE PUB MAGPIE"; see [known-issues](known-issues.md)), and the plans that still say Magpie or name the old formats (17 plans, product-planner's).
- An accented product name loses its accents in the server's user-agent: `PRODUCT_NAME` "Café Pub" is sent as `Caf-Pub` (only printable ASCII is kept, `headerProductName()` in `server/product-name.js`).
- The product name guard in `tools/check-names.mjs` checks that `PAST_BLOCK_LABELS` is a frozen list of two; it should pin the two past labels exactly.
- A fixed-time check case for the old-fence pattern in `server/object-format.js` (`PAST_FENCE`) on a very long "> " prefix.
- #25 A check that compiles every `pattern` attribute the way browsers do.
- #26 Remove the unneeded fallback in the console's Save plans.
- #27 The console's top bar requests that answer 404.
- #23 Too many connections to the server from one page.
- The pop-out's video fix (`keepPoppedVideoLive()` in `public/space.js`) uses LiveKit's internal `observeElementInfo()`, not its public API. Check it still works whenever `livekit-client` is upgraded (now `^2.22.3`).
- `hereLabel()` and the who-is-here wording steps in `public/space-people.js` have no check in `tools/check-nav.mjs`.
- `tools/check-canvas.mjs` times `resettle` against budgets of 16 to 33 ms. They have four to five times headroom on the development machine, but could fail on a slow CI machine.
- A **Grid size** drag that ends without a `change` event leaves the previewed layout on screen but unsaved until the next save (`holdStore` in `public/canvas.js`).
- The SDK menu's link entries (`<a role=menuitem>` in `public/sdk/host.js`, `host.menu.show`) don't open on Space; Enter opens them. Buttons and other entries do.
- The **Layout** panel (with its Arrange section and the Grid size slider), Online and the space bar's **…**: check them with a real screen reader, in Firefox and Safari, and on a real phone. Verified in headless Chromium only.
- Pasting a picture into a picture box: check it in Firefox, Safari, on a real phone, with a real screen reader, and with a file (not a picture) copied from the computer's own file manager. Verified in headless Chromium only.
- Remove the old `away` data message next release: `sendAway()` still sends it and `DataReceived` still reads it in `public/space.js`, for pages on the script before the `away` and `awayMessage` attributes. Its check in `tools/check-canvas.mjs` goes with it.
- Outside away, changing the camera or quality while the camera is off but still published reopens the camera hardware (`restartCamera()` in `public/space.js`), and `setCameraEnabled(true)` does not pass `prefs.camId`, so the camera turned back on may not be the one chosen.
- Going away again while **Back** is still waiting can leave the away button's title and the old `away` data message out of order (`setAway()` in `public/space.js`). The microphone part is fixed (`keepMicOffWhileAway()`).
- Changing the microphone in Settings while away reopens the microphone pipeline. The publication stays muted, so nobody hears you, but the device is opened.
- The comment above `openOverlay()` in `public/space.js` says you don't see your own tile marked Away while your profile or Manage is open over the call; you do (`showAway()` draws your own mark from your own state).

## Sign-in and accounts

- #28 Passkeys, the second phase of two-step sign-in.

## Hosting and environments

- Stored chat pictures (step 8 of [plan-realtime-optional-livekit](plans/plan-realtime-optional-livekit.md), if Thomas chooses it): today a picture in the chat is relayed live and never stored, so a page that comes later does not see it.
- #48 A one-container install that runs LiveKit itself.
- #56 Run it on Windows and Mac.
- #49 A billing relay for a payment provider's webhook.
- #50 An environment's own domain, and one identity across environments.
- The calls cap is enforced by the page only: the page asks `POST /api/call/join` before joining, but a token can publish as soon as it is minted, so a modified page could skip the check, as it could before. Making the cap binding means granting publish only after the check.
- The host console's environment list waits on LiveKit when any environment's plan caps calls (it counts each one's running calls, up to two seconds a request).
- The product site ([plan-product-site](plans/plan-product-site.md)): the start page is built (the studio's look, 2026-11-08). Still to do: the demo hook (slice 6: **Try the demo** and `demo` in `GET /api/product`) and a Plans list on the start page. Manage's **Upgrade** link is hidden (`plansPage = false` in `public/admin.js`) until the Plans list exists; turning that on is part of the same work.
- #57 An About page.

## Streaming and OBS

- #52 A shared screen in the OBS view.
- #53 OBS sources for guests.
- #54 Choosing whose space the stream follows.
- #55 Several asides at once, and a director's switch.

## The call and the pages

- #38 A shorter header.
- #39 The nav colours in the theme editor: the top bar's branding area and right side are in Manage > Theme ([plan-two-zone-nav](plans/plan-two-zone-nav.md), built 2026-10-02); the space bar's colour is not, by decision.
- #31 Customising the dashboard's layout, and snapping on the spaces page.
- #58 One input in Chat ([plan-one-input](plans/plan-one-input.md)): every step is built. Still to come: the plan's live checks in a browser and a real call.
- Navigating away without hanging up: decided (2026-10-02), views over the space that set Away while on the call ([plan-primary-nav](plans/plan-primary-nav.md), steps 7 and 8).
- A private conversation started by invitation has no origin: decided (2026-10-02), its parent is the inviter's space ([plan-primary-nav](plans/plan-primary-nav.md), step 5).
- An aside's **Join** entry in the space list: decided (2026-10-02), asides leave the space list ([plan-primary-nav](plans/plan-primary-nav.md), step 6).
- Whether members of an aside's parent space see that it is private: decided (2026-10-02), they see that it is private (`asidePrivate`), never who is in it ([plan-primary-nav](plans/plan-primary-nav.md), decision 34).
- Who sees every space's name and member list: decided (2026-10-02), anyone signed in, for now ([plan-primary-nav](plans/plan-primary-nav.md), decision 35).
- Owners and the admin missing from Calendar's and Map's filters for spaces they don't belong to: decided (2026-10-02), correct as built, since managing a space is not being a member of it ([plan-calendar-destination](plans/plan-calendar-destination.md), decision 23; [plan-map-destination](plans/plan-map-destination.md), decision 25).
- Saving and loading layouts, with a space's default layout, is built ([plan-saved-layouts](plans/plan-saved-layouts.md)), and so is **Clean up** ([plan-layout-menu](plans/plan-layout-menu.md)).
- With an empty dashboard, the space list sits in one column about 300 pixels wide at desktop widths, leaving the rest of the page empty. Seen while checking the word for entering a space (2026-09-30); it was like this before.

## Modules

- **Budget step 5: the travel template turns Budget on** ([plan-budget-module](plans/plan-budget-module.md)). `modules` in the template gains `budget` (template version 7), so a new travel environment has Budget on. Not built; an owner turns Budget on in Manage until then.
- **A cross-module change event** for the SDK, so Budget can learn at once that a booking changed instead of asking every 30 seconds ([known-issues](known-issues.md)). Not planned yet.
- **Planner modes** (#307): travel, design and project modes for the Planner. Not planned yet; Budget is built to stay independent of them.
- **Whiteboard follow-ups.** #498 Frames with a presentation mode. #499 Comments on blocks (needs a plan). #501 Put other modules' objects on the board (needs a plan). #503 An ideas backlog from FigJam and Miro. #492 A contextual strip under the toolbar (an idea). The live pointers (#496) wait on [plan-module-live](plans/plan-module-live.md), above.
- #477 In-app help for a module: help a module can show in the app itself. Not planned yet; the issue holds the detail.
- #469 Host additions for saving and printing, for modules: additions to what the host offers modules (`host.*`) for saving and printing. Not planned yet; the issue holds the detail.
- #471 Stream replay. Not planned yet; the issue holds the detail.
- #480 Toolbar additions for modules. Not planned yet; the issue holds the detail.
- #34 Updating a module from an address, not only a zip.
- #35 A module's own activity on its card.
- #36 Storing and sending sensitive data such as passwords.
- #46 A hello-world example module.
- #47 Reminders for people who are away.
- #40 A Journal module.
- #41 Currency conversion beside a trip's currency.
- #42 Google Calendar: built (calendar feeds out, other calendars in), [plan-google-calendar](plans/plan-google-calendar.md).
- #43 Installing the Font Awesome Pro package.
- #44 A map in the Planner.
- #45 Reading booking confirmation emails into the Planner.
- #32 A module for Foundry.
- #33 A module for WhatsApp or SMS.
- Research's **Add a photo** could take a pasted picture too, as the picture boxes do. A small module change; Thomas hasn't decided.
