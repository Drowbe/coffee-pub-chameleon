# Host Console Plan

**Audience:** Thomas, who decides how the host console is organised and what it shows; and the sessions that build it: experience-design (`public/host.html`, `public/host.js`, `public/host-templates.js`, the styles, the Prototype section) and server-development (the host routes, only where a slice needs new data, and the checks).

**Status:** draft, 2026-11-06, by product-planner (GitHub #213). Thomas decided the direction and the build process on 2026-11-06 (decisions 1 to 7); the open questions at the end are not decided. Building does not start until Thomas approves the summary of this plan, and the first step is the Prototype, not the console. From Thomas: "The organization, design, and layout of this critical part of our experience is very bad. It's poorly organized, it is unclear how you manage things like templates or modules, and every environment is just another box on a long list... We need to take a step back and really invest in making this a much more obvious and easier part of the experience for site owners." The original note: "Admin needs a lot of cleanup where each environment gets its own configuration space." ("Admin" is the host console, for example `admin.collaborator.coffeepub.ai`.)

## What it is today

Read from `public/host.html` (486 lines), `public/host.js` (833), `public/host-templates.js` (521) and the `/api/host/*` routes in `server/index.js`. Every route except sign-in, sign-out, `/me`, the `/me/mfa/*` routes and the billing webhook needs a host admin. There is one kind of host admin.

- **Six tabs** in one strip (the Manage tab bar, `.subtabs`): Host, Plans, Environments (the default), Templates, AI, Maps. The Host tab holds five unrelated things: the host's facts, your two-step sign-in, host admins, and the flight schedule.
- **Environments are cards.** `GET /api/host/environments` returns every environment and `public/host.js` draws one card each, about 300 px tall, all at once. Six environments measure 2226 px tall at 1280 wide, so about five fit on a 1000 px screen. There is no search, filter, sort or count. Every card always shows five buttons, a template picker and an owner two-step reset form. Edit (name, plan, modules, four caps), Backup, Restore, Suspend, Delete (two clicks, with its own timer) and Switch template with its offer and Review are all on the card.
- **There is no Modules view.** Bundled modules appear only as a list of ids in the template editor and as a free-text box in an environment's Edit. Installing, updating and uploading modules is per environment, in that environment's Manage, Modules (`POST /api/modules`, `/api/modules/bundled/:id/install`, owner only). `GET /api/host/shared` returns every bundled module's shared folder, but the Maps tab draws only the first.
- **Templates** are a list (name, id, bundled or own, version, used by N, Hidden, update notices) and one long editor form of twelve parts (id, name and description, Words, Home icon, Modules with display names and icons, New environments, Phases, Reactions, Theme, Icons, and the Review panel). "Used by N" is a count; it does not name the environments.
- **Per environment, the console offers nothing beyond** name, plan, caps and template: no people, spaces, usage history, domain or backup list. Backup is a manual download.
- **Design-system use.** It uses `.subtabs`, `.sdk-card`, `.sdk-status`, `.sdk-table`, `.sdk-banner`, `.sdk-progress` and `confirmDialog`. It has its own cards with a 4 px coloured left edge (`body.host-console .environment` rules in `public/style.css`), its own two-click Delete and Restore, no `host.menu.show` and no `host.ui.viewSwitch`.
- **What the list already returns** (read as code, `server/index.js` `GET /api/host/environments`): per environment its record (slug, name, plan and caps, status, `pastDueSince`, `degradedAt`, `deleteRequestedAt`, `createdAt`), `usage` (members, spaces, AI calls this month, and calls now where the plan caps calls), `refused` (why it will not open), and `template`. Not returned today: storage. The route sets `usage.storageBytes` to `null`, so the console cannot show storage at a glance from this list (question 6).
- **Phone.** Decision 10 of [plan-phone-experience](plan-phone-experience.md) says the host console is "usable, not redesigned": nothing cut, nothing scrolling sideways, taps at 44 px. Its audit found the Host tab scrolling sideways (the billing sentence does not wrap).

The research notes behind this section are the console walk-through done for #213 on 2026-11-06. Everything above was checked against the code named; the card height and the 300 px figure are from a live measurement that was not repeated here.

## Decisions

Thomas, 2026-11-06. Each was put as a question with a recommendation, and he chose the recommendation.

1. **Direction: the hybrid, built in slices.**
   - A **left navigation** with five sections: Environments, Templates, Modules, Plans, Server.
   - **Server** holds the host's facts, host admins and your two-step sign-in, AI, Maps and the flight schedule.
   - **Environments** is a searchable, sortable, filterable **table** (name, plan, status, use at a glance, template). Each row opens that environment's own **page** with tabs: Overview (use against caps, and status), Plan and modules, Template, Owners and two-step, Backups, Danger zone, and a spare slot for Domain (#50).
   - A short **needs attention** strip above the table (past due, suspended, won't open, deletion asked, near a cap), built only from data the environments list already returns. No new server work.
   - Row actions go in a **More** menu with `host.menu.show`. Delete and Restore use `confirmDialog`.
   Reason: every environment today is a box on a long list; one table scales to many, and one page per environment gives each its own space.
2. **Modules: a read-only section first.** It shows which modules exist and which environments run which, with versions. Host-run install and update come later as their own slice and need server work (a `GET /api/host/modules` listing is the likely first route). Reason: the console has no view of modules at all, and a read-only view answers "what runs where" without new risk.
3. **Templates: their own section.** It lists each template with the environments that use it **by name**. The twelve-part editor is split into sections you can jump between. The per-environment Switch template, and the offer and Review, move onto that environment's page. Every existing template decision stays (see [plan-environment-templates](plan-environment-templates.md)): defaults never lock, Import and Export, the offer and Review, display names per template.
4. **Plans: their own section** for the catalog. One environment's own caps are edited on its environment page.
5. **The redesign ships first** and leaves room for #214 (templates set default views, modules and more) and #50 (an environment's own domain). Neither blocks it.
6. **Process: prototype first.** The design is built as a **Host console** section on the Prototype page (`public/design-system/prototype.html`, `prototype.js`), shown with 6 and with 30 environments at 1280 and 390 wide. Thomas looks, the design is locked, then it is built. Thomas's standing rule.
7. **This work may run beside other work.** The shared-file risks are in the files list below.

## The design

This is the shape the Prototype draws. Thomas locks it (or changes it) when he looks at the Prototype; nothing below is final before then.

### Navigation

A left navigation lists Environments, Templates, Modules, Plans, Server. The address hash keeps naming the place (`#environments`, `#templates`, `#modules`, `#plans`, `#server`, and `#environments/<slug>` for an environment's page), so a reload and the Back button work. At 640 px and under the left navigation becomes the tab strip the console has now (same `.subtabs`, scrolling inside itself), so nothing is cut and nothing scrolls the page sideways. The top bar and sign-in stay as they are.

### Environments: the table

- A search box (name and slug), filters (plan, status, template), a count ("12 of 30"), and sortable columns.
- Columns (a first proposal, question 3): Name (with `slug.domain` beneath), Plan, Status, Use, Template. Use at a glance shows members and AI calls this month against their caps, as two short bars (`.sdk-progress`), and calls now where the plan caps them.
- Status uses the existing `.sdk-status` chips: active, suspended, past due, won't open, deletion asked.
- The row opens the environment's page (the name is the link, and the whole row is the target). The row's **More** menu (`host.menu.show`) holds Open, Back up, Suspend or Resume, and Delete. **New environment** is a button above the table that opens the existing create form in a dialog or its own view.
- The table sits in its own scroll wrapper, so on a phone it scrolls inside itself, never the page. Rows are at least 44 px tall.
- **Needs attention** strip above the table: one line per kind with a count, each a filter on the table when tapped. The conditions are in question 2. It uses only fields the list already returns.

### An environment's page

Header: the name, `slug.domain`, the status chip, and a **Back to Environments** link. Tabs, in this order:

1. **Overview.** Status and its dates (since, past due, degraded, deletion asked and why, refused and why); use against each cap with bars; created date; a link that opens the environment.
2. **Plan and modules.** The plan and the environment's own caps (members, storage, AI calls a month, calls at once), and which modules it runs (all, or a list), with the same edit as today's Edit form, one **Save**.
3. **Template.** The template it was made from, what was skipped, **Switch template**, and the offer with **Review** and apply, moved here from the card.
4. **Owners and two-step.** The owners and the reset of an owner's second factor (by login), with a `confirmDialog`.
5. **Backups.** Download a backup; Restore a backup (zip) with `confirmDialog`. A list or a schedule is not in this plan.
6. **Danger zone.** Suspend or Resume, and Delete (moved aside), each through `confirmDialog`.
7. **Domain** (spare slot, #50). Not drawn until #50 is decided; the tab strip has room, and the Prototype shows it as a dimmed example only if Thomas wants to see where it would go.

Each tab saves on its own and says so in one status line, as the console does now. Anything that was on the card keeps working with the same route; nothing is cut.

### Templates

A list of templates with name, id, bundled or own, version, an Edited badge, the Hidden switch, and **Used by**: the environments that use it, by name (a count when more than four, then "and N more"). Whether those names link to the environment's page is question 4. Update notices stay above the list with **Review**. Row actions (Export, Duplicate, Reset to shipped, Delete when own and unused) go in a **More** menu. Import file and New stay above the list.

The editor keeps its fields and rules and splits into sections with a jump list at its side (a strip on a phone): Basics (id, name, description), Words and verbs, Home icon, Modules (and their display names and icons), New environments, Phases, Reactions, Theme, Icons. One **Save** for the whole template, as today. The Review panel (Shipped beside Yours, take the new version, keep mine) stays; its entry point moves with the offer where it applies to one environment (see An environment's page, Template).

### Modules (read-only)

A table of the modules on the host: name, id, version, bundled or uploaded, and the environments that run it, by name. A second view by environment (each environment's list of modules) may be added if the Prototype shows it is needed. No install, update or upload here; that is a later slice (slice 8) and needs server work.

### Plans

The catalog as it is today: one row per plan with id, name and five caps (members, storage GB, AI calls a month, calls at once, modules), Add, Remove (never the free plan), **Save plans**. It moves to its own section unchanged in behaviour. The table shows, per plan, how many environments are on it (from the environments list; no new route).

### Server

One section with sub-headings, in this order: The host (facts), Your two-step sign-in, Host admins, AI (managed AI), Maps (shared map files), Flight schedule. Whether AI and Maps stay here is question 5. The Maps tab's width problem on a phone and the Host tab's sideways scroll (the billing sentence) are fixed here, because the section is rebuilt.

## The contract

### Pages

- `public/host.html` keeps one page. It gains the left navigation and the section containers; the six tab sections are regrouped into the five. The environment page is a view inside it (hash `#environments/<slug>`).
- `public/host.js` gains the table (search, filter, sort, count), the attention strip, the environment page and its tabs, and the Modules view. It keeps every existing call. Uses `host.menu.show` for More menus and `confirmDialog` for Delete, Restore and the two-step reset. The "armed" two-click buttons and their timers go.
- `public/host-templates.js` gains the section jump list and "Used by" names.
- `public/template-offer.js` changes only if the offer is not reused as it is on the environment page.
- Styles: the `body.host-console` block in `public/style.css`, or a new host stylesheet. Colours come from the theme tokens. The 4 px coloured left edge on cards goes with the cards; status is shown by the chip.
- Words a person reads: plain and short. Use the names in `CLAUDE.md`: environment, space, owner, module, object. Never room, table (for the thing), stage, pane, tenant or item. "Table" for the UI element is fine.

### Server

- **Slices 1 to 6 need no server change.** The table, the attention strip, the environment page, the Templates section and the Plans section are built on the routes in "What it is today". Templates' "Used by" names come from `GET /api/host/templates`, which already lists which environments use each template (read as code, it answers the environments that use it; the build checks the field and, if only a count is returned, slice 5 adds the names to that route).
- **Slice 7, Modules read-only.** Needs, as the likely smallest change, `GET /api/host/modules`: for every bundled module, its id, name, version, and per environment whether it runs it. `requireHostAdmin`, no secrets, no new write. Whether the existing registry data is enough or each environment's module state must be read is for server-development to check and say in its report.
- **Slice 8, host-run install and update.** Not designed here. It needs its own plan addendum before it is built (which routes, who may run it, what happens to an environment on an old version).

## Left to build, in order

Size is S (under a day), M (a day or two) or L (several). Slices 1 and 2 are the gate: nothing after them starts before Thomas locks the design.

| # | Slice | Size | Agent | Depends on |
|---|---|---|---|---|
| 1 | The Prototype: a **Host console** section with the left navigation, the Environments table with the attention strip and a row menu, an environment's page with its tabs, Templates (list, "Used by", sectioned editor), Modules and Plans, each drawn with 6 and with 30 environments (fake data only) at 1280 and 390. | L | experience-design | none |
| 2 | **Thomas looks at the Prototype and locks the design.** Not a build step. | S | Thomas | 1 |
| 3 | The shell and Server: the left navigation, the five sections, the hash routes, Server regrouped (host facts, two-step, host admins, AI, Maps, flight schedule), the phone strip at 640 px, the two phone widths fixed. | M | experience-design | 2 |
| 4 | Environments: the table (search, filter, sort, count), the attention strip, the More menu, New environment. | M | experience-design | 3 |
| 5 | An environment's page: Overview, Plan and modules, Template (Switch and the offer), Owners and two-step, Backups, Danger zone, with `confirmDialog` for Delete, Restore and the reset; the old cards removed. | L | experience-design | 4 |
| 6 | Templates and Plans as sections: "Used by" by name, the More menu, the sectioned editor with its jump list; the Plans section. Server part only if "Used by" names are missing from the route. | M | experience-design (server-development if the route needs names) | 3 |
| 7 | Modules, read-only: `GET /api/host/modules` and the view. | M | server-development (route and check), then experience-design (view) | 3 |
| 8 | Host-run module install and update. Not in this plan; needs its own addendum. | L | server-development, experience-design | 7 and Thomas |

Slices 4 and 6 and 7 can run in parallel after 3, if the shared files allow it (see the files list).

## Files touched, per slice

- **1:** `public/design-system/prototype.html`, `public/design-system/prototype.js` (or a new `prototype-host-console.js` and css, loaded like the other `prototype-*.js` files). Add a section; do not edit existing sections.
- **3, 4, 5:** `public/host.html`, `public/host.js`, the `body.host-console` block in `public/style.css` (or a new host css file), `tools/check-brand-hosts.mjs` if the hosted boot or the page's markup it reads changes.
- **5:** also `public/template-offer.js` (only if the offer moves rather than being reused).
- **6:** `public/host-templates.js`, `public/host.html`, `public/host.js`; `server/index.js` only for "Used by" names.
- **7:** `server/index.js` (the route), `server/host-registry.js` (only if new data is needed), `tools/check-host-registry.mjs`.
- **Shared-file risks.** `public/style.css` and `server/index.js` are large and shared with other work: keep the style change in one block (or a new file) and the route change small and in one place, and rebase before each slice. The Prototype is shared with the map-options work: add a section, do not reorder or edit the others. The research found no other open branch touching these files on 2026-11-06.

## Verify

What each slice's check is, and what is not covered.

- **Slice 1:** Thomas looks at the Prototype, with 6 and with 30 environments, at 1280 and 390. `npm run check` includes the Prototype checks (`check-prototype-page`, `check-prototype-words`, `check-prototype-parity`, `check-design-system`), which run on the new section.
- **Slices 3 to 6:** `tools/check-host-registry.mjs` (the routes the console calls still answer as before) and `tools/check-brand-hosts.mjs` (the hosted boot and the console's host); a Playwright pass at 1280 and 390 over every section and every tab of an environment's page (nothing scrolls the page sideways, taps are 44 px, the table scrolls inside its wrapper), with a throwaway server (`PORT=` and `DATA_DIR=/tmp/<name>`) holding several environments; the design checks (`check-radius`, `check-no-raw-colours`, `check-spacing`, `check-type-scale`, `check-touch`, `check-narrow`, `check-conformance`); then quality-assurance.
- **Slice 7:** a case in `tools/check-host-registry.mjs` for the new route (host admin only, the fields, nothing for a non-host-admin), then the Playwright pass and quality-assurance.
- **Not verifiable here:** anything that needs a real LiveKit call, so "calls now" on a real host and the call-service parts of an environment's use are read as code only. The hosted behaviour on the real domains, and Firefox and Safari, are not checked by this plan. A Playwright pass is a real browser (Chromium) on a throwaway server; that is "verified live" for the pages, not for LiveKit.
- **Phone:** the console stays "usable, not redesigned" (decision 10 of plan-phone-experience): no phone-specific layout beyond the tab strip and the tables scrolling inside their wrappers.

## What would be overturned

Only wording, and content-manager updates it when the console is built:

- The Phase 1 console text in [plan-environments](plan-environments.md) (one tab list with cards).
- The "Templates tab" wording in [plan-environment-templates](plan-environment-templates.md) (it becomes the Templates section).

No decision in either plan changes. The documents that describe the console ([architecture-environments](../architecture/architecture-environments.md) and the host userguide) are content-manager's to update when each slice lands.

## What is not decided

Questions for Thomas. The answers shape the Prototype; none blocks slice 1, because the Prototype can show the recommendation and Thomas can change it when he looks. Every recommendation here is a suggestion, not a decision.

1. **What "near a cap" means.** Suggestion: 80 percent of a cap, for members, AI calls a month and calls at once, shown on the row and counted in the strip; 100 percent shown as "at cap". Storage is left out until the list returns it (question 6).
2. **The attention strip's conditions.** Suggestion: past due, suspended, won't open (`refused`), deletion asked, near a cap, and degraded to free. Each is a filter on the table.
3. **The table's columns and default sort.** Suggestion: Name, Plan, Status, Use, Template, with Created available as a sort but not a column; default sort is needs-attention first, then name.
4. **Do the names under "Used by" in Templates link to the environment's page?** Suggestion: yes, one tap to the environment, and the environment's Template tab links back to the template.
5. **Do Maps and AI stay under Server?** Suggestion: yes for now. Both are host-wide, not per environment, and Server is where host-wide things sit. If Modules grows host-run install (slice 8), Maps could move under Modules because its shared folders belong to a module.
6. **Storage at a glance.** The list route returns no storage today (`usage.storageBytes` is `null`), so the table cannot show it or flag it near a cap without a small server change (the registry already measures it, at most once a minute). Suggestion: leave storage on the environment's Overview, and add it to the table only if Thomas wants it there; that is a small server-development step added to slice 4.
7. **What the Prototype shows for 30 environments.** Fake data only: a mix of plans, statuses (a few past due, suspended, won't open, deletion asked), uneven use, and long and short names. Suggestion: product-planner and experience-design agree the list before slice 1; none of it comes from a real environment.
8. **Is a second Prototype view of the Modules section by environment needed?** Suggestion: draw the by-module table only, and add the other if it looks thin.

## Open questions that block building

None block slice 1, the Prototype. Slices 3 onward wait for Thomas's lock of the design (slice 2), which settles questions 1 to 6 and 8. Slice 8 waits for its own addendum.
