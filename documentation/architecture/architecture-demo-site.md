# The demo seeder and the checks

**Audience:** developers and operators who fill a server with demo data, run a demo site that resets itself, or need to know what the checks added since 0.4 look at.

## The demo seeder

`npm run seed:demo` (`tools/seed-demo.mjs`) fills a **running** server, through its own API, with one space named "Demo: Portugal": a trip of ten days starting about 45 days after the day it is run (Lisbon, Sintra, Porto), with every module holding data. It is for looking at a real-feeling space, for screenshots and for a public demo. Run it in a second window against the server you already have running.

It signs in as an admin, installs and turns on every bundled module (a module that is on is on in every space), chooses the place search, fills each earlier phase with dated objects, and creates three demo people: `mia` (a moderator), `lee` and `sam` (members). It prints a one-time password for each and a guest link. The passwords are new on every run, and the admin is a member of the space too. Every date is worked out from today, so a nightly run keeps the demo ahead of the day.

**Re-running resets only the demo.** The seeder finds its space by its name and a marker in its description, and its people by their logins, removes them and builds them again. Every other space, its data and every other account are left alone (`tools/check-seed-demo.mjs` checks this).

### Settings

All are environment variables of the seeder's own window. None is a server setting.

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
