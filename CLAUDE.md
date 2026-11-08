# Collaborator

Self-hosted voice and video for a tabletop game, with tools beside the call (modules) and every
player as an OBS source. The repository is `coffee-pub-chameleon`; the product is **Chameleon**.
Thomas owns the design, the architecture and what gets built. Claude helps build it; it doesn't
decide those.

## Stack and layout

- Node 22 and Express 5, LiveKit for media. No database, no front-end framework, no build step for
  the pages: plain HTML, CSS and JavaScript served as they are.
- `server/`: the app, the API, module hosting, storage, environments and auth. Data is JSON in `DATA_DIR`.
- `public/`: the pages and their scripts; `public/sdk/` is the SDK modules use (`host.*`).
- `modules/<id>/`: bundled modules (`module.json` + `src/`), versions tracked in
  `tools/module-versions.json`. `node tools/build-module.mjs modules/<id>` builds a zip.
- `tools/check-*.mjs`: the checks. `documentation/`: architecture, api, designsystem, userguides,
  plans, TODO.md, known-issues.md, published to the GitHub wiki.

## Commands

- `npm run check`: every check. Run it before calling anything done.
- In a cloud container running as root, `check-names` fails two `--migration` cases (a read-only parent
  folder, the `tavern.json` rename) because root ignores read-only permissions. That isn't a defect; don't
  change the check. Run the checks after `check-names` in the `check` script one by one to see them.
- `npm run check:docs`: the documentation standard.
- `npm run docs:build`: builds the wiki pages into `tools/.wiki-build/` for review.
- Local server: `LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=devsecretdevsecret ADMIN_PASSWORD=testpass1234 npm run dev`
  (port 3000; sign in as `admin`). Use `PORT=` and `DATA_DIR=/tmp/<name>` for a throwaway second
  server. There is no LiveKit server locally, so a real call can't be verified here; say so.

## Rules

- Read the plan in `documentation/plans/` and the matching architecture or API document before
  changing something they cover. The plan is the contract; if the code must differ, say so.
- The product is not released. No compatibility layers, aliases, deprecation periods, redirects,
  legacy code paths or data migrations: change things cleanly and replace what is there. Ids,
  routes, hashes, API fields and stored keys may be renamed when that is cleaner; test data may be
  reset. (The 0.4.0 names migration and its allow-listed old words remain only because that code
  exists; do not extend them.) Once the product is released this rule is removed. Thomas, 2026-10-21.
- Do not change element ids, routes, API field names and stored keys unasked; no renaming for its
  own sake. This no longer promises that nothing stored or linked breaks, and a rename needs no
  data migration (see the rule above).
- Configuration goes in environment variables, never in code. A single-environment install (no
  `BASE_DOMAIN`) must keep behaving exactly as before.
- Colors come from the theme tokens (`documentation/designsystem/design-theme.md`). Reuse the SDK's
  pieces (`host.menu.show`, `host.toolbar.set`, `host.ui.viewSwitch`, the nav registry) rather than
  building new ones.
- Words a person reads: plain and short. Names follow the Names section below, in code and in words.
- A changed module gets a version bump.
- Be exact about verification: "verified live", "checked by a tool" and "read as code only" are
  different claims.
- Work comes in three kinds, and Thomas names the kind: a **try build** (the default; one builder, one
  pass, its own checks, pushed at once, no QA, docs or CHANGELOG; if it changes a module it still bumps that module's patch version, nothing else), a **feedback build**
  (one short QA pass for regressions, must-fixes only, a CHANGELOG line) and a **production build**
  (the full flow: plan, QA, docs, version bumps). Never treat a try build as production.
- Start every GitHub issue title with its area and a colon, then the title (`Settings: Profile photo won't save`).
  The areas: Settings, Chat, Call, Home, Phases, Planner, Calendar, Places, Maps, Budget, Research, To-do,
  Polls, Forms, Design, Layout, Server, Docs, Verify, Ideas. Settings covers anything about configuring
  things: Set up, Manage, Profile, module and template settings, overridable words, permissions settings
  and the Modules page. Every agent files issues this way (Thomas, 2026-10-15).
- The project manager picks the smaller model for small jobs and a larger one only for risky work (layout and
  canvas, migrations, security, planning); see `.claude/agents/project-manager.md`.
- For a production build, commit each finished piece of work once it has passed QA and has its documentation, by explicit
  paths and with its CHANGELOG entry, so Thomas can pull the image and test it. Don't push or publish
  the wiki unless Thomas asks.

## Names

Thomas's names. The level or role name and the code name are the same word and never change: code,
routes, API fields and stored keys use them. Only the word a person reads can change, per
environment template. The renaming is done (shipped in 0.4.0, `documentation/plans/plan-names.md`).
The only old words left are deliberate, and `node tools/check-names.mjs` and its allow-list
(`tools/check-names-allow.json`) fence them: LiveKit's own API term, old links and routes kept so
nothing a person saved breaks, the migration that reads old stored keys, and comments that explain
those. New code and new words use the new names, and nobody argues for the old ones; `check-names`
fails on any new use. Never use room, table, stage, pane, tenant or item for these things, in code
or in words.

Identifiers (file formats and their markers, fenced blocks, stored keys, cookies, environment variables) are
named by kind, never by the product. The product's name comes only from `PRODUCT_NAME`; the brand, Coffee Pub,
may appear.

Levels, top down:
- Host, `host`: the main admin host.
- Environment, `environment`: what people sign in to; shows as whatever they name it.
- Space, `space`: shows as whatever they name it (for travel, likely a trip's name).
- Home, `home`: the environment's page that lists its spaces, named in the top bar; shows as the template's word
  (Trips, Campaigns), else the space word's plural.
- Aside, `aside`: a temporary, ad hoc space that supports only conferencing.
- Canvas, `canvas`: the work area where people use modules. Not "stage".
- Module, `module`: a tool used on the canvas or popped out; shows as its name or the template's
  themed name. Never "pane".
- Object, `object`: a task, a note, any thing a module holds. Not "item" or "card".

Roles:
- Admin, `admin`: edits the host and sets up environments.
- Owner, `owner`: manages their environment.
- Moderator, `moderator`: manages specific things within a specified space, as the owner or admin allows.
- Member, `member`: the users of the environment.
- Guest, `guest`: very limited rights.

## Agents

`.claude/agents/` holds a team. **project-manager** runs the work (`/manage <task>` in any session, or
`claude --agent project-manager` in a terminal): **product-planner** drafts plans for Thomas to
decide (`/plan-feature <idea>` for a planning conversation), **experience-design** builds the front end and how it feels,
**server-development** builds `server/`, the API and the checks, **bug-fixes** fixes defects in any
layer, **quality-assurance** tests and reviews the result without changing code, and
**content-manager** writes the documentation, README and changelog. The flow: plan, Thomas approves,
build, QA, documentation, commit. Only product-planner writes plans, and only
content-manager edits the rest of `documentation/`, `CHANGELOG.md` and the README; the builders
describe their changes in their reports.
