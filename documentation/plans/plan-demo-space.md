# Demo Space Plan

**Audience:** Thomas, who decides what a demo space is and where it is offered; and the sessions that build it: server-development (the data format, the loader, the Vault generator, the routes, the demo flag, the cron script and the checks), experience-design (the Prototype section, the owner's Manage **Demo** section, the creation checkbox and the demo banner), product-planner (the content of the games demo), quality-assurance (a security read) and content-manager (the documentation).

**Status:** approved by Thomas 2026-11-06, decisions 1 to 8; he answered four open questions the same day, now decisions 9 to 12 (loopback loader, no place search set, the demo flag, the shared login may do everything); step 0 (the existing seeder shipped in the Docker image, run with `docker exec ... npm run seed:demo`) is done as its own build; building the loader (slice 1) starts when Thomas says. Three open questions at the end have a recommendation each and are not decided. GitHub #416, Thomas, 2026-11-06: "On our local server we have a space with demo data. This is REALLY handy. I'd like an option to add a demo space to any environment. Right now we have one for travel. In the future we will need one for every type of environment. Plus, we will need this for our demo site."

## What it is today

Read as code from `tools/seed-demo.mjs` (520 lines), `tools/seed-demo-map.mjs`, `tools/check-seed-demo.mjs`, `server/templates.js`, `templates/travel.json` and `templates/games.json`, and [architecture-demo-site](../architecture/architecture-demo-site.md). A run of the seeder on a throwaway server was done for the research behind this plan (2 seconds, 4.9 MB).

- **One seeder, travel only.** `npm run seed:demo` signs in as an admin and fills a running server through its own API with one space, "Demo: Portugal": a trip that starts 45 days after the day it is run. A run gave Planner 76 objects, Places 37, Calendar 77 events (16 of its own, the rest are the Planner's copies), To-do 16, Polls 3 (votes cast by each voter's own session), Budget 18 costs, Research 4 and Chat 25 messages.
- **Dates are never stale.** Every date comes from `today` (`dayPlus`); `SEED_TODAY` fakes the day for the check.
- **People.** `mia` (a moderator in the space), `lee` and `sam` (members), made with a random one-time password each that is printed at the end. The admin is added to the space too.
- **The space and its mark.** Created with `POST /api/spaces`, named "Demo: Portugal", with a description that starts with the marker line `MARKER` ("Demo data from npm run seed:demo."). A re-run finds the space by name and marker, removes it with `DELETE /api/spaces/:id` (which erases its data, uploads and Vault bytes) and builds it again. A space with that name and no marker is refused and left alone. A person with a demo login but another display name is refused too.
- **It writes through the real routes.** Objects go in with `PUT /api/modules/<id>/data/<key>?scope=space&space=<id>`, so each module's guards run. Poll votes and Chat messages are sent as each person.
- **The Vault is not seeded.** The files seen in Thomas's screenshot were added by hand. The repository holds no demo pictures or PDFs.
- **Maps.** Places are plain data with a latitude and longitude. `tools/seed-demo-map.mjs` reads the public Protomaps build over the network and writes a few-megabyte `demo-portugal.pmtiles`; it is skipped offline and hosted.
- **AI.** Not faked. Two real `/ai` questions are asked when a service is set up; `SEED_NO_AI=1` skips them.
- **It changes the whole environment.** It installs and turns on every bundled module, sets `showCalendar` and `showMap` with `PATCH /api/settings`, sets the Places search to Photon (the public service) if none is set, and if the environment has no template it switches it to travel. It refuses a template that does not have six phases, so a games environment is refused. It hard-codes the travel phase ids by position. Templates carry no demo data.
- **Hosted.** Refused unless `DEMO_ALLOW_HOSTED=1`, `DEMO_ENVIRONMENT=<id>`, `SEED_URL=<id>.<base domain>` and an owner login.
- **Names.** Lusa Air, Sunroad Rentals, the `DEMO-` confirmation codes and the `example.com` links are invented. The places are real public places with invented notes. No emails, no real people.
- **How templates are stored.** `templates/<id>.json`, flat. `loadTemplates` in `server/templates.js` reads every `.json` file directly in `templates/` and refuses to start if one is not a valid template (the id must match the file's name). A demo file placed there would stop the server.
- **The games template** has the modules Campaign planner (the `travel` module, with no trip), Sessions (`calendar`), `polls`, Quests (`todo`), Lore (`research`), Handouts (`vault`), `chat` and `conference`. It has no phases, no Budget, no Places and no Maps, and `showMap` is false.

The seeder is therefore handy but narrow: it is for a throwaway, test or demo environment only, because it changes settings that belong to the owner.

## Decisions

Thomas, 2026-11-06, in chat. Decisions 1 to 8: each was put with a recommendation and he chose the recommendation. Decisions 9 to 12 are below the list.

1. **An existing environment is never reconfigured.** The demo fills only its own marked space and its own marked demo people. It never changes environment-wide settings: it does not install or turn on a module, change `showCalendar` or `showMap`, set the place search or switch the template. A module the template does not already have on is skipped, and the report says so plainly. Reason: an owner who adds a demo space must not find their environment changed.
2. **Where it is offered.** An **owner's Manage page** gets a **Demo** section with Add, Reset and Remove. There is also a checkbox **Include a demo space** when an environment is made: the host console's create form and the sign-up. The host console's environment page (plan-host-console) may offer it later. Reason: the owner is who has the environment, and a new environment is when an empty one is least helpful.
3. **One data file per template, one generic loader.** The demo data of a template is one data file, with dates as offsets from today. One loader reads any such file and writes through the product's real module routes, so every module's rules run. The travel demo is converted to this file with identical results: the same counts the seeder prints today (Planner 76, Places 37, Calendar 77 events, To-do 16, Polls 3, Budget 18, Research 4, Chat 25). The Vault demo files come from a small generator in code: original drawn pictures, a generated PDF and a README, with no real or third-party images ("create your own fake ones").
4. **The first pass builds both travel (converted) and a games demo** (campaign, sessions, quests, lore, polls, handouts), to prove the format works for a second kind of environment.
5. **The demo site** uses one shared demo member login with a known password set by the loader (not the one-time printed ones). The environment resets nightly. What the shared login may do is decision 12.
6. **AI on the demo site is off.** No provider key; the Assistant says it is off in the demo. The seeder already skips AI with `SEED_NO_AI=1`.
7. **Calls on the demo site are left out.** No call service; the call button is hidden or says calls are off in the demo.
8. **The nightly reset** is a Reset action plus a documented cron recipe that calls it, as a script. There is no scheduler inside the app.

Thomas, 2026-11-06, in chat, answering open questions. He chose the recommendation on 9, 10 and 11, and a different option on 12.

9. **The loader reaches the routes by loopback.** It makes requests to the server's own address, each as a signed-in demo person, exactly like a browser, so every module's real rules run. There is no direct function call per route. Reason: no guard can be skipped by mistake.
10. **The demo does not set the place search on an existing environment.** The demo's places carry their coordinates, so the map and the lists work without a search provider. The report does not need to say more than that search is the owner's choice. Reason: decision 1 (no settings change).
11. **The demo flag: yes.** A field on the environment, `demo`. It shows the banner "This is a demo, it resets every night" and refuses sign-up, billing and password changes. Reason: one switch for the demo site instead of several settings that can be forgotten.
12. **The shared demo login may do everything its role allows.** Thomas chose this over the recommended "no chat posting and no uploads", and relies on the nightly reset. No posting or upload limit is built for the shared login. The planner's note stands as an **accepted risk**: a public login that can post chat and upload files can be used to put unwanted words or files on a public site until the next reset. The mitigations that remain are the nightly reset, the demo flag refusing sign-up and password change, low upload size and quota caps on the demo environment through the existing plan caps, no AI, no calls and no outbound mail. If abuse shows up, a limit on posting and uploads is the first thing to add.

## The design

### Where the data file lives

`templates/demo/<template id>.json`, so `templates/demo/travel.json` and `templates/demo/games.json`. A folder of its own keeps `templates/` flat and the template files as they are: `loadTemplates` reads only `.json` files directly in `templates/`, so the folder is not seen as a template and the server's start check is not touched. The name matches the template's id, which is how the loader finds the file for an environment: by the id the environment's `template` record names. A template with no file has no demo, and the Manage **Demo** section says so. A check asserts that every demo file's name is a bundled template's id.

A template an owner or host made (not bundled) has no demo file; this plan does not add a way to import one.

### The data file

One JSON object. Its parts:

- `template`: the template's id (the same as the file name).
- `name` and `description`: the space's name and the text after the marker line, for example "Demo: Portugal".
- `anchor`: whole days after today that the story's first day falls on. Travel uses 45 (the seeder's `S`). Games uses a small number, so the next session is soon.
- `people`: a list of `{ login, displayName, role, moderator }`. `role` is `member`. `moderator: true` makes the person a moderator in the demo space only (the existing `PATCH /api/users/:key/spaces/:id` with `permissions.moderator`). The names are invented. No emails.
- `modules`: one block per module id, in that module's own object format, so a module can change its format without the loader knowing. A block is `{ "data": { "<key>": <the value the module's data route takes> }, "as": "<login>" }`, where `as` names the person whose session writes it (the default is the first moderator). Polls has `votes` by login. Chat has `messages`, each `{ "as", "text", "replyTo" }`, posted to `POST /api/spaces/:id/chat` as that person, with quote replies and links as the seeder does now. The loader knows the order and the routes, never what an object means.
- `files`: the Vault files, by name (see the generator below), with which person adds each.

**Dates as offsets.** Anywhere a module's format takes a date, the file writes a string that names a base and a number of days: `"today+3"` (three days after today), `"start+0"` (the anchor's day) and `"start+9"`, `"start-2"`. A time of day follows as `"start+3T09:30"`. The loader replaces each one with a plain `YYYY-MM-DD` (or `YYYY-MM-DDTHH:MM`) before it sends the object, so the module never sees an offset. Phases get their dates the same way. A file with a base the loader does not know is refused with the line named. Reason: the same file is right on any day, as the seeder's `dayPlus` is today.

**Phases.** A phase is named by its id in the template (`planning`, `booking`, `buffer`, `pre-trip`, `trip`, `post-trip` for travel) and never by its position, so a template that renames or reorders its phases does not break the file. A phase id the environment's template does not have is reported and the objects that need it are left out.

**Words.** The file keeps module ids and the plain key names. It does not hold the template's display words; the real modules draw those.

### The loader

One generic loader (`server/demo.js`, not under `tools/`, because the Manage page's routes call it). `tools/seed-demo.mjs` stays as the command-line way in, becomes a thin caller of the same loader and no longer holds any trip data.

Order, for **Add** or **Reset**:

1. Find the environment's template and its demo file. None: stop with one plain sentence.
2. Read which modules are on for this environment (they are the template's, as the owner has left them). A module in the file that is not on is **skipped**, and so are any modules that depend on it (Maps needs Places). Nothing is installed or turned on (decision 1). The report names each: "Budget is off in this environment, so it has no demo costs."
3. Make the demo people (see below), then sign in as each.
4. Remove the old demo space if there is one (see "Marking"), then make the new space with `POST /api/spaces`, the people as members and the moderators set.
5. For each module block that is on, write it with `PUT /api/modules/<id>/data/<key>?scope=space&space=<id>` as the named person, so the module's guards run; a guard that refuses is reported with its sentence and the loader carries on. Poll votes and Chat messages are sent as each person's own session.
6. Make the Vault files (see below), if the Vault is on.
7. Print or return the report: created counts per module, skipped modules with why, and any refusal.

**The routes it uses are the real ones and no new data route is added.** The loader, running inside the server, calls them by requests to the server's own address on the loopback (decision 9), each write made as a signed-in demo person exactly like a browser, so no guard is bypassed.

**What it never does:** install or enable a module, change a setting, switch the template, set the place search (decision 10), make a map file, ask the AI (the demo site has none), and touch any space or account that is not marked. Map files stay the job of `seed:demo-map`, run by the host on a single install (it is the host's file, not the environment's).

**Marking.** The space is marked by the existing marker line at the start of its description (`MARKER`, kept as it is today). A demo person is marked by the pair the seeder already uses: the login from the file and the display name from the file together. An account with a demo login but another display name is refused and left alone, as now. The marker is never printed as a secret and is the only way the loader decides what it may delete.

**Idempotence.** Run twice, the second run gives the same counts and a new space; the first is gone. Every other space, its data and every other account are untouched (the existing check keeps asserting this).

**Reset** = the same run. It finds the marked space, erases it (`DELETE /api/spaces/:id`, which removes the data, uploads and Vault bytes), and builds it again from today. Demo people are kept and get a new password only where this plan says so (the demo site's shared login keeps its known one).

**Remove.** Deletes the marked space (an erase, which takes its uploads) and the marked demo people. It first lists what it will delete, and the owner confirms (see the Manage section). A space an owner has renamed still has its marker, so it is found; a space whose marker the owner has deleted from the description is no longer a demo and is left alone, and Remove says that it found none.

**Passwords.** On an ordinary environment each demo person gets a random one-time password, shown once in the result of Add, as the seeder prints them now. A demo person cannot sign in again after Remove. On the demo site the shared login's password is the known one (below).

**What it reports.** `{ created: { <module>: <count> }, skipped: [{ module, why }], refused: [{ module, key, why }], people: [{ login, password? }], space: { id, name } }`, in the response of the route and printed plainly by the command. The same sentences are shown on the Manage page.

### The Vault generator

A small generator in code (`server/demo-files.js`), run by the loader when the Vault is on. It makes the Vault's demo files from nothing, so the repository holds no pictures, PDFs or other binaries:

- **Pictures:** original drawings made as SVG and turned into a PNG by the code only if a PNG is needed; otherwise stored as SVG if the Vault takes it (to be checked in slice 2). Travel gets a simple drawn map of the route and a drawn ticket; games gets a drawn dungeon map and a drawn crest. Plain shapes and text only.
- **A PDF:** a short generated one-page or two-page PDF written with the code's own few lines (no library), for example a "Trip notes" sheet or a "Player handout".
- **A README:** a short text file saying the files are made up and are removed with the demo.

The files go in through the Vault's real upload route as the named person, so the Vault's limits, types and the plan's rules apply. They are listed in the file's `files` part by name, kind and who adds them. No real or third-party image is used or fetched.

### The owner's Manage **Demo** section

For the Prototype (slice 5). Nothing here is locked until Thomas looks at it.

- It is a section on the owner's Manage page, shown only to an owner. It uses the existing section, `.sdk-status`, `.sdk-banner` and `confirmDialog` pieces; it adds no new ones.
- **When there is no demo space:** the title **Demo**, one sentence ("Add a space filled with example things so you can see how it works. It does not change your settings."), and one button, **Add a demo space**. If the template has no demo, the sentence is "There is no demo for this kind of environment yet." and no button.
- **After Add:** a report in the section: what was made ("Made 76 plan objects, 37 places, ... "), what was skipped ("Budget is off, so it has no demo costs."), and the demo people's logins with their one-time passwords, shown once with a **Copy** button and a plain sentence that they will not be shown again.
- **When a demo space exists:** the space's name as a link, the date it was made, and two buttons, **Reset** and **Remove**.
  - **Reset** asks: "Reset the demo space? It is emptied and filled again with new dates. Anything people added to it is lost." with **Reset** and **Cancel**.
  - **Remove** asks: "Remove the demo space? Its objects, files and chat are deleted, and so are the demo people. Nothing else is touched." with **Remove** and **Cancel**. Both use `confirmDialog`.
- **While it runs,** the buttons are off and one status line says "Adding the demo space...". On a failure it shows the sentence the loader gave, and nothing half-finished is left: a run that stops after the space is made removes it again.
- **At creation:** a checkbox **Include a demo space**, unticked, under the template picker on the host console's create form and on the sign-up form, with one line under it: "Adds a space filled with example things. You can remove it later." It is shown only if the chosen template has a demo, and the choice is passed to the same Add after the environment is made. The environment is made even if the demo cannot be, and the owner is told so.
- **Phone:** the buttons are at least 44 px and the section does not scroll sideways, as the other Manage sections.

### The routes (slice 4)

Owner only (the environment's owner, or the admin of a single install). All answer in the product's usual JSON, and a refusal is one plain sentence in `error`.

- `GET /api/demo` returns whether the template has a demo, whether a marked space exists (its id and name), and the people's logins.
- `POST /api/demo` adds it (409 with a sentence if one already exists; use Reset).
- `POST /api/demo/reset` resets it (404 if none).
- `DELETE /api/demo` removes it (200 with what was removed; 404 if none).
- Each returns the report above. One run at a time per environment; a second request while one runs is a 409.
- The safety rules: the routes act only on the marked space and marked people; a member, moderator or guest gets 403; the routes never read or write another environment, and on a host with environments act on the environment the request's address names; the creation checkbox calls the same code on the new environment after it exists.

These names are the plan's proposal; the checks name them once they are built.

### The demo site

The demo site is a hosted install with one environment made for the purpose, with the template's demo added. What changes for it, on top of the above:

- **The demo flag.** A field on the environment, `demo`, set by the host (the host console's environment page and the create form; a single install, which has no environment record, uses the environment variable `DEMO_MODE=on`). Thomas decided it (decision 11). A flagged environment shows a banner on every page, **This is a demo. It resets every night.**, and refuses what a demo must not do: sign-up of new people to it, billing, a password change, an email change, the second-factor setup, deleting the environment's own account, and making new environments from it. Each refusal is a 403 with one sentence, and the matching button is hidden or says it is off in the demo.
- **AI off.** The flag switches the AI off for the environment (decision 6). The Assistant says "The AI is off in the demo." No provider key is set for the environment, and the loader never asks the AI.
- **No calls.** The flag hides the call button and the call page says "Calls are off in the demo." (decision 7). There is no call service for the environment to reach.
- **The shared login.** One demo member, login `demo`, role `member`, in the demo space only. The loader sets its password to the value of the environment variable `DEMO_MEMBER_PASSWORD`, so it is known and can be put on the demo site's page. The password lives in that variable on the server and in the cron job's private environment file, never in the repository, the data file, the documentation or a log. The loader refuses to run on a flagged environment if the variable is unset or shorter than the product's minimum password length. Only the usual password hash is stored, as for any account. Other demo people (`mia`, `lee`, `sam`) are kept so the demo shows a group, but are not signed into by visitors; their passwords are random and discarded.
- **No limits for the shared login** (decision 12). It may do all its role allows, including chat posts and uploads. This is an accepted risk; the mitigations are the nightly reset, the flag's refusals, low upload size and quota caps on the demo environment through the existing plan caps, no AI, no calls and no outbound mail. The first thing to add if abuse shows up is a limit on posting and uploads.
- **The nightly reset.** A script, `tools/demo-reset.mjs`, signs in as the demo environment's owner and calls `POST /api/demo/reset`, then exits non-zero with one sentence on a failure. A cron line runs it at 03:00. The owner login and password, the address and `DEMO_MEMBER_PASSWORD` sit in a file only the job's user can read (`/etc/collaborator-demo.env`), as in the existing recipe in [architecture-demo-site](../architecture/architecture-demo-site.md). The recipe is written in slice 7 with cron first and the Windows and GitHub Actions variants as now; the script prints nothing readable by others on success, so a job log in a public place leaks nothing. The recipe is not run as written until it has been (see Verify). The app has no scheduler (decision 8).

## Left to build, in order

Each slice is built and checked on its own. Building starts when Thomas says.

| # | Slice | Size | Agent | Depends on | Checks |
|---|---|---|---|---|---|
| 0 | The seeder in the Docker image | done | server-development | none | its own build |
| 1 | The data format, the loader (loopback requests as signed-in demo people, no place search set) and the travel conversion with identical counts | L | server-development | 0 | `check-seed-demo` (counts Planner 76, Places 37, Calendar 77, To-do 16, Polls 3, Budget 18, Research 4, Chat 25), `check-templates`, a new case that the loader never changes environment-wide settings (the place search included) and skips a module that is off, and a live run on a throwaway server |
| 2 | The Vault generator | S to M | server-development | 1 | `check-vault` (the files arrive through the real upload route, types and sizes are allowed) |
| 3 | The games demo file | M | server-development, with the content from product-planner | 1 (2 for the handouts) | the loader on a games environment in `check-seed-demo`, and `check-templates` for the file's name |
| 4 | The routes Add, Reset, Remove with the safety rules | M | server-development | 1 | a new check (owner only, only the marked space and people, one run at a time, a failed run leaves nothing) and `check-space-erase` (uploads are taken) |
| 5 | The Prototype of the Manage **Demo** section and the creation checkbox; Thomas looks and locks; then the build | S to M | experience-design | 4 | the Prototype checks (`check-prototype-page`, `check-prototype-words`, `check-prototype-parity`); the built section checked in a browser at 1280 and 390 wide |
| 6 | The demo flag, the banner, the refusals and the shared login (no posting or upload limit) | M | server-development, then experience-design | 4 | a new check: the refusals are 403 with a sentence, the shared login's password comes from the variable and is refused when unset, the AI and call button are off |
| 7 | The nightly script and the cron recipe | S | server-development | 4, 6 | the script against a throwaway server; the recipe read as documentation |

After slice 7: quality-assurance with a security read (the loader runs with owner rights and writes through the real routes; the demo login is public; the refusals must really hold), then content-manager for the documentation. Slices 2, 3 and 5 can run beside each other once slice 1 is in. Slice 5's Prototype can start any time after Thomas says go, since it only draws.

## Verify

- **Checked by a tool, locally, with no LiveKit and no browser:** the loader's counts against the seeder's, idempotence, the other spaces and accounts untouched, no settings changed, a module that is off skipped and reported, the Vault files arriving, the routes' status codes and owner-only rule, the flag's refusals, the shared login and its variable.
- **Verified live on a throwaway server** (`PORT=` and `DATA_DIR=/tmp/<name>`): a travel environment and a games environment each given a demo, Reset, Remove, and a template whose module is off. The builder reports it as that, not as checked by a tool.
- **Browser checks** (Manage **Demo** section, the banner, the checkbox) run only where a Chromium exists; a skip is not a pass.
- **Cannot be checked locally:** a real call (there is no LiveKit here, and the demo site has none by design); a real hosted domain with its own environment and address; a real nightly run by cron or the other schedulers; the demo site's public traffic. These are marked "Not verified" in the changelog until Thomas has run them.

## What it overturns

Nothing. It extends [architecture-demo-site](../architecture/architecture-demo-site.md), whose "The demo seeder" and "A demo site that resets itself" sections describe the seeder as the whole mechanism. When this is built, content-manager must update that document: the seeder becomes a thin command over the loader and loses its trip data, the loader works on an existing environment without changing its settings, the reset is a call to `POST /api/demo/reset` rather than a nightly seeder run, the list of settings gains `DEMO_MEMBER_PASSWORD` and `DEMO_MODE`, and the cron recipe changes to the new script. The user guides gain the owner's **Demo** section. Until then that document stays as it is, and it still describes the seeder as it is today.

## What is not decided

- Whether a hosted install's map file for the travel demo can be made for an environment (it is the host's file); until decided the loader makes none and Places and Maps show the places without a downloaded region.
- A demo for a template an owner or host made.
- A demo in the Aside (conferencing only; nothing to fill).
- Notifications and AI answers in the demo: none are seeded.
- Demo data for the other templates when they are added: each new template brings its own file, as a part of its own plan.

## Open questions

Each has a recommendation and is Thomas's to decide. Four questions Thomas answered are now decisions 9 to 12.

1. **Vault demo files with privacy marks.** Once [plan-vault-privacy](plan-vault-privacy.md) slice 1 lands, mark one demo file **Only me** and one **Chosen people**. Recommended: yes, as a later step after that slice. Blocks nothing now.
2. **The marker for demo people.** Today a person is a demo person by login plus display name. Recommended: keep that rule; the alternative is a `demo-` prefix on the login, which is clearer in the people list but changes every demo login, including the known `demo` one. Blocks slice 1 only for the names in the file.
3. **The games demo content** (the anchor, how many sessions, which quests and lore), to be drafted by product-planner with Thomas. Blocks slice 3.

Also still open, under "What is not decided": the map file for a hosted demo, and demos for custom templates.
