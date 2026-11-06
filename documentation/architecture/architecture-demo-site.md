# The demo seeder and the checks

**Audience:** developers and operators who fill a server with demo data, run a demo site that resets itself, or need to know what the checks added since 0.4 look at.

## The demo loader and the seeder

Two parts make the demo. They are kept apart on purpose.

- **The loader**, `server/demo-loader.js`, fills one marked demo space and its marked demo people from a data file. It is the part a future "Add a demo space" feature will call (slice 1 of [plan-demo-space](../plans/plan-demo-space.md), GitHub #416; the feature itself is in later slices and does not exist yet).
- **The seeder**, `npm run seed:demo` (`tools/seed-demo.mjs`), is a thin command over the loader. It first does the environment-wide setup that a throwaway environment needs, then calls the loader.

### What the loader does

`loadDemo({ base, templateId, today, session, headers, words, say, dir })` reads `templates/demo/<template id>.json` and writes it through the server's own address, with loopback HTTP requests. Each request is made as a signed-in demo person, so every module's real rules, permissions and validation run. It calls no route function directly.

- **Only the demo.** It acts on one space and three people (`mia`, a moderator, and `lee` and `sam`, members), all marked as the demo's. It never changes an environment-wide setting: it does not install or turn on a module, set the calendar or map options, choose a place search or switch the template.
- **A module that is off is skipped.** The report says so in plain words, for example that the costs were not added because the Budget is off. The module is not turned on.
- **It refuses what it did not make.** A space that has the demo's name but not the marker in its description, or an account that has a demo person's login but not the demo's display name, is refused before anything is changed.
- **A rerun resets only the demo.** It removes the marked space and the marked people and builds them again. Every other space, its data and every other account are left alone.
- **Passwords are random on every run.** They are returned to the caller, never stored. The seeder prints them once. It never prints the admin password.
- **Words follow the environment.** Its messages use the environment's own words: the `words` option if given, else the words from the target's `/api/branding`, else the plain defaults. On a travel environment a space reads "trip".
- **A template with no demo file** reports "no demo" and creates nothing.
- **A guest link** that cannot be made is listed in `refused` in the report.

### The data file

The trip is in `templates/demo/travel.json`: "Demo: Portugal", ten days starting 45 days after the day it is run, with data for every module. The folder is `templates/demo/`, not `templates/`, because the template loader reads only the `*.json` files directly in `templates/`. A module block is written in that module's own format, in steps, each step by the person it names. Module ids must match `^[a-z0-9-]+$`.

No date in the file is absolute. Each is an offset, so the same file is right on any day and a nightly run keeps the demo ahead of the day. `start` is today plus the file's `anchor` (45 days).

| Written | Gives |
|---|---|
| `today+N`, `today-N` | The day N days from the day of the run, as `YYYY-MM-DD`. |
| `start+N`, `start-N` | The day N days from the trip's first day, as `YYYY-MM-DD`. |
| `start+1T09:30` | That day with a time: `YYYY-MM-DDT09:30`. |
| `start+1T19:00Z` | A trailing `Z` gives a full timestamp. |
| `ms:today+2T10:00` | `ms:` in front gives milliseconds since 1970, as a number. `ms:now` is the time of the run. |
| `@mia` | A person's key, whole or as one part of a key. |
| `{space}`, `{base}` | The space's id and the server's address. |

A base the loader does not know (such as `tomorrow+1`) refuses the whole file before anything is made.

### What the seeder adds

`tools/seed-demo.mjs` keeps the setup that belongs to a throwaway environment and that the loader refuses to do: it switches the template to travel if there is none, installs and turns on every bundled module, turns on the calendar and map options, sets the place search and makes the map file. Then it calls the loader. Its output and counts are as before (Planner 76, Places 37, Calendar 77, To-do 16, Polls 3, Budget 18, Research 4, Chat 25).

One difference: the server records who wrote each object, so the `by` on the objects is now the demo person who wrote it (`mia`, or the voter) and not the admin. This includes 61 Calendar copies.

`tools/check-demo-loader.mjs` checks the loader, and `tools/check-compose.mjs` requires that the `Dockerfile` copies the loader and the data file.

**Re-running resets only the demo.** `tools/check-seed-demo.mjs` and `tools/check-demo-loader.mjs` check that other spaces, their data and other accounts are left alone.
### Settings

All are environment variables of the seeder's own window. None is a server setting, and the loader reads none of them: the seeder passes it its options.

| Variable | Default | Meaning |
|---|---|---|
| `SEED_URL` | `http://localhost:<PORT>` | The server to fill. Left out, it uses `PORT` if that is set in this window, else `http://localhost:3000`. |
| `PORT` | | Only used to build the address above, so `PORT=3100 npm run seed:demo` fills a throwaway server on 3100. |
| `ADMIN_LOGIN` | `admin` | The account to sign in as. |
| `ADMIN_PASSWORD` | | Required. Never printed. |
| `SEED_TODAY` | today (UTC) | `YYYY-MM-DD`, to fake the day. Used by the check. |
| `SEED_NO_AI` | | `1` skips the `/ai` exchanges that are otherwise made in the space's chat when an AI service is set up. Each one uses the service and counts toward its allowance. |
| `SEED_MAP` | | `0` skips the map file. Otherwise the seeder also runs `npm run seed:demo-map`. |
| `SEED_SEARCH_URL` | Photon | The address of a Photon-compatible place search, for the Places module's search. |
| `DEMO_MAP_ZOOM` | `12` | The deepest zoom of the map file that `seed:demo-map` cuts. |
| `DEMO_ALLOW_HOSTED` | | `1` lets the seeder run against a host with environments. See below. |
| `DEMO_ENVIRONMENT` | | The id of the one environment to fill, required with `DEMO_ALLOW_HOSTED`. |

### The map file

Unless `SEED_MAP=0`, the seeder makes a small map file of Lisbon, Sintra and Porto and ticks it in the Maps module. `npm run seed:demo-map` (`tools/seed-demo-map.mjs`) does this alone: it reads the newest public Protomaps build with HTTP range requests, keeps the tiles of three small boxes and writes one PMTiles file, `demo-portugal.pmtiles`, to `DATA_DIR/modules/maps/map-tiles/` (`DATA_DIR` from its environment, else the repository's `data` folder: the folder the server uses), then ticks it. The file is a few megabytes at most and is never committed; delete it from **Manage** to remove it. It needs the network; offline, the seeder prints one quiet message and carries on. See [userguide-maps](../userguides/userguide-maps.md) for how Maps reads files.

### A hosted install

On a host with environments (`BASE_DOMAIN` set) the seeder refuses to run, because it would fill whichever environment the address points at. To fill one environment on purpose:

1. Set `DEMO_ALLOW_HOSTED=1` and `DEMO_ENVIRONMENT=<the environment's id>`.
2. Set `SEED_URL` to that environment's own address, `https://<id>.<base domain>`. The seeder refuses any other address, and it talks only to that address, so no other environment is touched.
3. Set `ADMIN_LOGIN` and `ADMIN_PASSWORD` to an **owner** of that environment, not the host's admin.

Hosted, the map files are the host's, so none is made; the host ticks one for the environment.

### A demo site that resets itself

A public demo site is a hosted install with an environment of its own, made for the purpose, with an owner account used only to seed it. The seeder is idempotent, so the reset is just a nightly run of it. Three ways to schedule it follow; each runs the same command. They are recipes, written from how the seeder behaves, and have not been run as given.

Two cautions. The run prints the demo people's new passwords and the guest link, so do not send the output anywhere readable by people who should not have them (a public repository's job log, for one); use a private repository, or discard the output. And use `SEED_NO_AI=1` unless you want a nightly `/ai` exchange paid for.

The seeder uses only Node's own modules, so it needs `node` (22) and a copy of the repository, but no `npm install`.

**cron (Linux, Mac).** Keep the secrets in a file only the job's user can read, `/etc/collaborator-demo.env`:

```
SEED_URL=https://demo.example.com
DEMO_ALLOW_HOSTED=1
DEMO_ENVIRONMENT=demo
ADMIN_LOGIN=demo-owner
ADMIN_PASSWORD=<the owner's password>
SEED_NO_AI=1
```

and in `crontab -e`:

```
0 3 * * * cd /srv/collaborator && set -a && . /etc/collaborator-demo.env && set +a && node tools/seed-demo.mjs > /dev/null 2>> /var/log/collaborator-demo.log
```

The output is discarded; a failure prints one sentence to the error stream, which goes to the log, and the exit status is not zero.

**Task Scheduler (Windows).** Make `C:\collaborator-demo\reset.cmd`, readable only by the account that runs it:

```
@echo off
set SEED_URL=https://demo.example.com
set DEMO_ALLOW_HOSTED=1
set DEMO_ENVIRONMENT=demo
set ADMIN_LOGIN=demo-owner
set ADMIN_PASSWORD=<the owner's password>
set SEED_NO_AI=1
cd /d C:\collaborator
node tools\seed-demo.mjs > nul 2>> C:\collaborator-demo\reset.log
```

then, from a command prompt: `schtasks /Create /SC DAILY /ST 03:00 /TN "Collaborator demo reset" /TR "C:\collaborator-demo\reset.cmd"`.

**GitHub Actions.** Store `DEMO_URL`, `DEMO_OWNER_LOGIN` and `DEMO_OWNER_PASSWORD` as repository secrets (**Settings**, **Secrets and variables**, **Actions**), then add `.github/workflows/demo-reset.yml` to a **private** repository that holds the code:

```yaml
name: Reset the demo
on:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch:
jobs:
  reset:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: node tools/seed-demo.mjs > /dev/null
        env:
          SEED_URL: ${{ secrets.DEMO_URL }}
          DEMO_ALLOW_HOSTED: '1'
          DEMO_ENVIRONMENT: demo
          ADMIN_LOGIN: ${{ secrets.DEMO_OWNER_LOGIN }}
          ADMIN_PASSWORD: ${{ secrets.DEMO_OWNER_PASSWORD }}
          SEED_NO_AI: '1'
```

GitHub runs scheduled jobs on UTC and may start them late. A failed run shows in the Actions tab.

## The checks added since 0.4

`npm run check` runs them all. Those that open a browser say SKIPPED and exit 0 when there is no Chromium (a skip is never a pass), and fail when `CI` is set.

| Check | What it looks at |
|---|---|
| `check-demo-loader` | The loader against throwaway servers, 14 groups: the same counts as the seeder; a module that is off skipped and not turned on; no environment-wide setting changed (a snapshot before and after); an unmarked same-named space or person refused; a rerun resetting only the demo; every date an offset, with the demo staying ahead of a faked today; a template with no demo file reporting "no demo"; the `words` option; module id checks; each person's last writer. |
| `check-seed-demo` | The seeder against a throwaway server: the trip, the module contents, a second run giving the same counts and a new space, other data untouched, the plain sentences for a wrong password or a missing server, and the hosted refusals. |
| `check-streams` | Without a browser, the stream hub and relay (`public/module-stream.js`) against a stand-in event source and clock, and the server's `?space=&page=1` stream with its event ids. In a browser, that a space's Workspace holds at most three open event streams, that both windows finish loading, and that a change from a second session reaches a window. See [architecture-modules](architecture-modules.md), "Live changes". |
| `check-module-guards` | The rules in `server/module-guards.js` and the data routes, against throwaway servers, with a module made for the purpose and with Research. See [api-modules](../api/api-modules.md), "Data guards". |
| `check-link-preview` | The link preview's blocked ranges, ports and its 10 second limit. |
| `check-calendar-twins` | The Itinerary's copies in the Calendar, with the bundled modules: the pair flagged and offered once, the span and the trip's zone, All day keeping the time, Hide for good. |
| `check-calendar-todo` | The Calendar destination page and its To-do panel in a browser: the toolbar zones at 1280, 520 and 360 pixels, contrast in both modes, the month by keyboard, a copy's zone, and the Undo notice. |
| `check-ai`, `check-ai-prompts`, `check-ai-page` | The AI service, the prompt, who may ask, refunds and the Assistant's page, against a stand-in service. See [architecture-ai](architecture-ai.md). |
| `check-maps`, `check-maps-live` | The Maps style and every shipped theme against the map minimums; the Maps and Places pair in a browser. See [design-theme](../designsystem/design-theme.md), "The map". |
| `check-startup` | The server starts with or without LiveKit, and a taken port prints one plain sentence (below) and exits. |
| `check-prototype-page`, `check-prototype-words`, `check-prototype-parity` | The Prototype page of the design system pages: that it scrolls, that its words follow the names, and that its copies match the real modules. |

**A port already in use.** If the port is taken, the server prints "Port 3000 is already in use. Another copy of the server may still be running: close its window or stop it, then start this one again.", with the command to find it (`netstat -ano | findstr :3000` then `taskkill /PID <id> /F` on Windows; `lsof -i :3000` then `kill <id>` on Mac or Linux), and exits. A port the account may not use prints "The server may not use port 80. Set PORT to a free port above 1024, then start it again." Any other failure to listen prints one sentence with the system's reason.
