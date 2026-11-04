# Project Manager Handoff

**Audience:** A new project-manager session that picks up Collaborator's work cold. Written 2026-11-04 from the outgoing PM's work log, the repository and GitHub.

This is a handoff note, not a plan. It sits in `documentation/plans/` because the documentation standard
(`npm run check:docs`) allows only `home.md`, `TODO.md` and `known-issues.md` in the root of `documentation/`,
and the plans folder is not published to the wiki. Delete it when it is stale.

Where a fact is marked "per the PM log", it comes from the outgoing PM's append-only log
(`scratchpad/QUEUE.md`, which dies with that session) and could not be checked against the repository or GitHub.

## 1. What this is and who decides

- Collaborator: self-hosted voice and video for a tabletop game, with modules beside the call. Node 22,
  Express 5, LiveKit, plain HTML/CSS/JS. Read `CLAUDE.md` first; it is the contract (stack, rules, Names, roles).
- **Thomas owns** the design, the architecture and what gets built. The PM does not decide those.
- The PM never edits product files. It reads, plans, delegates to the agents in `.claude/agents/`
  (product-planner, experience-design, server-development, bug-fixes, quality-assurance, content-manager),
  checks the results, commits by explicit paths and reports. `.claude/agents/project-manager.md` is the PM's own brief.
- Three kinds of build, named by Thomas: try (default), feedback, production. Never escalate on your own.

## 2. Thomas's process rules (as given in conversation)

- **Questions go in chat** as multiple choice, with a recommendation. If he doesn't answer (he has missed
  questions by pressing return), ask again.
- **Ideas are ideas.** Do not act on one until he says. File an issue; build nothing.
- **Be concise.** Every report ends with a usage line (5-hour and weekly percentages from the usage file, section 5).
- **Independent QA** before telling him something is ready. The Prototype must be right before he looks at it.
- **Design on the Prototype first**, he looks, the design is locked, then build.
- **Quick-fix lane:** UI tweaks default to a try build, batched. Issues are for ideas and bigger work, titled
  `Area: title` with the areas listed in `CLAUDE.md`. A change to a shared piece is a feedback build.
- **Keep issues updated** (comment the sha when fixed, close only when merged and verified) and keep the GitHub
  project current.
- **Local-server instructions.** Give the pull and the restart for Windows PowerShell in a code box:

  ```powershell
  cd C:\Users\drowb\Developer\coffee-pub-collaborator
  git checkout main
  git pull origin main
  $env:ADMIN_LOGIN = "admin"
  $env:ADMIN_PASSWORD = "<choose-a-password>"
  npm run dev
  ```

  Port 3000. To stop: Ctrl+C, then Y. His local copy does not use images or compose, so don't mention them there.
- **Production** is a QNAP Container Station compose, in `KEY: "value"` format, with a vault volume
  (`VAULT_DIR`). Never ask him to commit secrets.

## 3. Working agreements with the agents

- **Models:** opus for risky layout and canvas, security, migrations and planning; sonnet by default; haiku for tiny jobs.
- **Worktrees:** agents run under `.claude/worktrees/`. Checks that boot a server fail there (`sendFile` refuses
  dot-folders). Run checks from a clean `git archive` copy outside `.claude`, with `node_modules` symlinked and
  `CHROME_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`.
- Regenerate `public/design-system/sources.js` only from a copy with `node_modules` linked (otherwise `icons` is empty and the parity check fails).
- **One Chromium at a time** per job. Kill only your own processes. Every brief says: stop every server you start, close every browser in a `finally`, use `timeout`, verify with `pgrep` before finishing.
- **Git:** never `git stash` (use WIP commits); never force-push; push only to the session branch
  `claude/magical-feynman-xupgiq` (`git push origin HEAD:claude/magical-feynman-xupgiq`); commit by explicit paths.
- **Trailers** on every commit, as given by the session:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UA5HE6cpQcjTdQ1ZmTSsce`.
- **"Don't commit":** the builder agents' own files say the PM commits. Briefs that say otherwise (for example "push to the claude branch") override that for that job. State it in the brief.
- Max 5 agents in flight. Brief each one completely: they start with no memory.

## 4. The merge-to-main routine that worked

1. Full `npm run check`, one step at a time, on the exact tip, from a clean copy. Known failures when run as root:
   two `check-names --migration` cases (read-only folder, `tavern.json` rename), and (per the PM log) two
   `surface-card` / `bg-card` token hits in `themes/strong-coffee.css`, which await Thomas (section 7).
2. Independent QA with no must-fix open. Security QA (opus) for anything touching the server, stored data or the Vault.
3. Open a PR with base `main` at the exact tip sha, then merge it with `expectedHeadSha`.
4. Watch GitHub Actions **Publish container image** (`.github/workflows/image.yml`). On a push to `main` it
   publishes `ghcr.io/drowbe/coffee-pub-collaborator` as `:latest` and `:sha-<first 7>`.
5. Tell Thomas: what is in the image, and the pull and restart commands (section 2).

**Verify the registry anonymously:** get a token from
`https://ghcr.io/token?scope=repository:drowbe/coffee-pub-collaborator:pull`, then `HEAD` the manifest
`https://ghcr.io/v2/drowbe/coffee-pub-collaborator/manifests/<tag>` with `Authorization: Bearer <token>` and
`Accept: application/vnd.oci.image.index.v1+json`; read `docker-content-digest`.
Checked 2026-11-04: `latest` and `sha-6e8c357` both give `sha256:9800d49caf93b512d83dc74541a85d81076a19fe7bfed69c45637c8a8aedd467`
(`image.yml` run 679 succeeded on `6e8c357`). So the image is in the registry; if production "doesn't have it", the
pull or the container recreate on Thomas's side is the first thing to check.

`gh` GraphQL is blocked in these sessions; use `gh api repos/Drowbe/coffee-pub-collaborator/...` (REST).

## 5. The usage file

- Thomas's status-line script writes `usage.json` into Google Drive: folder `claude/_usage`
  (id `1VfySjEk0MlLTXmiBxzZWoHaSZFE2AkGu`), file id `1daytlCT-iH1M4E_fUJAYP1VgHnzdaftb`. Read it with the Drive
  tools (search title contains `usage`, then read the content).
- Fields: `at`, `five_hour.used_percentage`, `five_hour.resets_at`, `seven_day.used_percentage`, `seven_day.resets_at`.
- **Stale if `at` is older than about 15 minutes.** It updates only while he runs `claude` in
  `G:\My Drive\claude\_usage` with `/loop 10m`. If stale, ask him or pace by the last reading.
- **Weekly ceiling 85%** unless he says otherwise. Check before launching agents; put the real numbers in every report.
  Per the PM log, hold launches above about 70% of the 5-hour window when several agents are running (burn was 16 to 29 points an hour with five).
- Thomas has allowed larger models this week as needed. The weekly allotment resets Wednesday 09:00Z; his normal
  usage rules return at 2 am his time.
- The warnings at 70% and 80% of the week in `architecture-teams-and-budgets.md` were set by the PM, not confirmed by Thomas.

## 6. Environment lessons

- **The cloud container restarts whenever the session sits idle and kills background jobs.** Run long checks in
  foreground chunks inside an active turn (per the PM log: `scratchpad/fullcheck/chunk.sh` runs steps from
  `steps.txt` until about 7 minutes, keeping its place in `next.txt` and writing `results.txt`). While agents run,
  keep the turn alive with foreground waits (`timeout 500 tail -f /dev/null`).
- Stale Chromium and throwaway `node server/index.js` processes pile up from agents' checks (per the PM log, 434
  browsers and 17 servers overloaded the machine on 2026-11-03 and the load broke checks). Thomas has allowed
  killing stale ones; kill by age or from your own process tree, not everything. An auto-mode classifier may deny a broad `pkill`.
- The main checkout's index can be stale; work in a fresh worktree off `origin/main`.
- Many leftover worktrees exist (`git worktree list`: under `.claude/worktrees/`, `/home/user/wt-*`, `/tmp/wt*`). Prune the ones you are sure are done.
- A real call cannot be verified here (no LiveKit server). Say so.

## 7. Current state (2026-11-04)

**Merged and published.** `main` is `6e8c357` (PR #397); `image.yml` run 679 succeeded.
- #389 (`74dabf9`): Vault (sharing, linking, windowed viewers), Clear with Undo, AI prompt layer, map readability, Planner attachments.
- #390 (`e2cd082`): AI look-up tools and catalog, Vault QA fixes, upload limits, Map options Prototype.
- #397 (`6e8c357`): Vault thumbnail click opens the file (Vault 0.3.3), docs, plans for AI status and Word/Excel.
- The session branch equals `main` after #397; nothing is waiting on it. Check `git log origin/main..origin/claude/magical-feynman-xupgiq`.

**Versions** (`tools/module-versions.json`): Vault 0.3.3; see the file for the rest. The changelog's Unreleased section holds the entries.

**Plan statuses worth knowing** (each plan's own status line is the truth):
- `plan-attachments-vault.md`: approved; steps 1 to 6 built and merged. Check its status line for what is left.
- `plan-ai-integration.md`: slice 1 and slice 2 steps 8 to 10 and 12 built; real-provider test not done.
- `plan-map-options.md`: approved for Prototype step 0 only; steps 1 to 4 wait for Thomas to see the Prototype.
- `plan-vault-office-files.md`: draft, six questions for Thomas, nothing built.
- `plan-panel-stacking.md`: approved, awaiting the Prototype; build after phone foundations and the object window.
- `plan-object-window.md`, `plan-phone-experience.md`, `plan-call-as-module.md`, `plan-ios-app.md`: drafts, parked.

**Open issues from this stretch** (REST list, 2026-11-04; there are about 80 open in all, mostly older ideas and `priority:` items):
- #388 Maps: Map themes and map options (plan above).
- #387 Layout: Stack docked panels by dragging.
- #391 Layout: thumbnail click. Not in the open list, so it is closed; confirm it carries the `0.3.3` sha.
- #392 Calendar: Week view slowly grows (Budget's title also runs one letter per line at a narrow dock).
- #393 Chat: AI real-provider test of look-ups and proposals.
- #394 Layout: shared bar buttons drawn at 28px on a phone; focused search box shows an inner rectangle.
- #395 Chat: AI citations read "An object that is gone" without the Assistant module.
- #396 Ideas: Word and Excel files in the Vault.
- Older, still open and priority-labelled: #376 LiveKit optional (critical, now), #377 call as a module (critical, next), #382 AI for external clients.

**In flight (per the PM log, not verifiable):** a bug agent (opus) on the Calendar Week-grows bug and the Budget
narrow-title bug (#392), pushing to the session branch. At the time of writing nothing from it is on origin, so
assume nothing landed: ask Thomas, check `git log origin/claude/magical-feynman-xupgiq` and the issue's comments.

**Parked, and who decides:**
- **Map options build:** waits for Thomas to view the Prototype at `/design-system/prototype.html#pp-maps`. His decisions so far are in `plan-map-options.md` (per person, Light and Dark first, dark app themes default to a Light map). Per the PM log the Prototype questions were all answered as recommended, and a QA pass ran; confirm before he looks.
- **AI step 11** (real-provider test) needs a provider key and a spending limit from Thomas; step 13 (proposals) after.
- **Word/Excel (#396):** six open questions at the end of `plan-vault-office-files.md`.
- **Theme tokens:** `--surface-card` / `--bg-card` in `themes/strong-coffee.css` (lines 29 to 30) fail `check-names`; Thomas decides rename or allow.
- **Phone bar** switcher A or B, **icon colour** pick (Prototype top, `?ci=v0..v4`; the PM log's recommendation was V3 in dark, V1 or V0 in light), then phone foundations, object window, call as a module and the iOS app, all parked behind AI and module fixes.
- **Shared-piece 28px buttons and the focus-ring rectangle (#394):** need a feedback build.
- **Smaller:** Planner low-severity items (PLN-13, 14, 17 to 25 in `health-audit/planner/REPORT.md`); the server-side drop of links when a produced object is deleted; word-level `check-names` hits (`environment.js`, `module-holds.js`, `module-host.js`), a try build after the merge.
- **Other decisions Thomas owes** (per the PM log): whether a space's `aiSees` may widen the environment's; whether Chat's Assistant follows `module.assistant.use`; whether Clear should be offered to every module without guards; the 70% and 80% usage warnings.

Longer lists live in `documentation/TODO.md` and `documentation/known-issues.md`.

## 8. First 10 minutes

1. Read `CLAUDE.md` and this note. Read `.claude/agents/project-manager.md`.
2. If `QUEUE.md` still exists in the old scratchpad, skim its last 40 lines (later entries win).
3. `git fetch`, then `git log --oneline origin/main | head` and compare `origin/main` with the session branch.
4. List open issues with `gh api` (REST) and read #388, #392 to #396.
5. Read the usage file (section 5). Note the age of the reading.
6. Make a fresh worktree off `origin/main`; don't work in the main checkout.
7. Ask Thomas what he wants first, as a short multiple-choice question with a recommendation.
