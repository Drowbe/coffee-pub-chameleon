# Teams and budgets

**Audience:** Thomas, who decides how work is divided and what each team may spend; and the project manager and the agents who follow it.

**Status:** Approved by Thomas, 2026-11-01. The weekly ceiling was raised to 85% by Thomas on 2026-11-03; the rest of the weekly section is still a starting proposal he can change.

## Purpose

This document says how work is divided into teams and how resources are given to each team: the model tier, how many agents work at once, and how many tokens a job is expected to use.

It is flexible. Thomas changes a card at any time by telling the project manager. The documentation agent then updates this document.

It does not replace `CLAUDE.md`, which is Thomas's file, or the agent definitions in `.claude/agents/`. If they disagree, they win and this document is corrected.

## The five teams

| Team | Who works in it | What it owns |
|---|---|---|
| Product | experience-design (product pages), server-development, bug-fixes | The web pages, the server, the API, the modules and the checks. |
| Design system and Prototype | experience-design, product-planner (design plans) | The design system and the Prototype. |
| Native apps | product-planner only, for now | The iOS app now, the Android app later. |
| Quality and oversight | quality-assurance, the project manager | Testing and review; checking reports against the code. |
| Docs and release | content-manager, the project manager | Documentation, README, changelog; merges. |

Notes on each team:

- **Product.** Builders work from a plan Thomas approved. When a build is done, it goes to Quality.
- **Design system and Prototype.** Plans for the design system come from product-planner and wait for Thomas. Every Prototype change gets an independent quality pass before Thomas is asked to look at it.
- **Native apps.** There is no builder yet. That waits for two things: the Swift question is settled, and a macOS build runner exists. Until then the team only plans and runs spikes.
- **Quality and oversight.** quality-assurance is independent of every build team and never reviews what it built. The project manager checks each report against the code and the checks, and merges only what passed.
- **Docs and release.** content-manager writes the documents once work has landed. The project manager does the merges.

Handoffs run one way: plan, Thomas approves, build, quality, documentation, merge.

## The budget cards

Three words are used for the model tier. The project manager picks the model for each job through the agent tool. **Smaller** is the smallest available model, **medium** is the middle one, and **larger** is the largest. `CLAUDE.md` says small jobs get the smaller model, and the larger one is for risky work only.

| Team | Model tier | At once | Tokens expected per job |
|---|---|---|---|
| Product | Medium. Larger only for risky work: security, migrations, real-time, layout and canvas. | Up to 3 builders | Fix: 60-120k. Feature: 150-250k. |
| Design system and Prototype | Medium | 2 | 100-250k. Every Prototype change gets an independent quality pass first. |
| Native apps | Larger, for planning | 1 | 100-180k per plan or spike. No builders until the Swift question is settled and a macOS runner exists. |
| Quality and oversight | Larger on risky or cross-module work. Medium on focused checks. | 2 | 150-250k per audit. |
| Docs and release | Smaller | 1 | 30-100k. |

## Rules across teams

- Each builder working at the same time as another has its own isolated worktree.
- Quality is never the builder of what it reviews.
- Risky work always gets a review on the larger tier.
- At most five agents are in flight at once.
- If a job runs well past its expectation, the project manager stops and asks Thomas.
- A question to Thomas that goes unanswered is asked again. An unanswered or interrupted question is never read as a no, a stop or a decision. The project manager checks that its agents are still running before reporting them as running.
- No hard cap can be enforced. Agents report the tokens they used. The limits are expectations written into each brief.

## How Thomas changes a card

Thomas tells the project manager in plain words. Examples:

- "Raise Native to 2 at once."
- "Cap Design at 1."
- "Product on the larger tier for the next 3 jobs."

The project manager applies the change from the next job. The documentation agent records it under Changes, below, with the date and the sentence Thomas said.

## The weekly plan budget

Thomas is on the Max plan. The plan covers three things, in this order of rank:

1. This project.
2. D&D campaign processing and world building.
3. His Foundry modules.

This project yields to nothing. The other two use what is left. Thomas says they use roughly 25-30% of the plan in a week (2026-11-01). The starting ceiling was 65% of the weekly plan, which left a buffer. On 2026-11-03 Thomas raised it to **85%**.

**Warnings.** The project manager tells Thomas at about 50% of the weekly plan, and again at about 60%. These are estimates; see below.

**At the ceiling.** The project manager finishes what is running and starts nothing new. It lists what is waiting, with an estimate for each, and asks Thomas what to spend the rest on. Quality passes on work already built come first, because unreviewed work cannot be merged.

**The week.** It resets on Wednesday at 1:00 AM, on Thomas's clock as shown on his usage page.

**Reading the meter.** The project manager reads the live usage file (next section) before it launches agents. Where the file is missing or stale, it falls back to the old way: Thomas shares a screenshot of the usage page about every Monday and Friday, and when asked, and between readings the project manager keeps its own count.

**Converting tokens to percent.** First estimate (2026-11-01): about 0.4M agent tokens per 1% of the weekly plan. So a 65% ceiling was about 25M agent tokens a week; the 85% ceiling is about 34M. This is rough. The count leaves out the project manager's own turns, the clocks differ, and it assumes the meter moves in proportion to agent tokens. Each reading corrects the estimate.

**First calibration point.** Reading of 2026-11-01: 21% of the week used, 90% of it Claude Code (about 19% for this project). Against that, about 7.2M agent tokens were counted since Thursday 2026-10-29 (Oct 29 0.26M, Oct 30 5.54M, Oct 31 0.89M, Nov 1 0.48M; UTC days).

## The usage file

The meter used to be read from screenshots. Now a file carries it.

**Where it is.** A shared Drive folder, `claude/_usage`, holds `usage.json`. A script on Thomas's machine writes it. Nothing else writes it.

**What is in it.** The fields the project manager reads:

| Field | Meaning |
|---|---|
| `five_hour.used_percentage` | How much of the current five-hour window is used. |
| `five_hour.resets_at` | When that window resets. |
| `seven_day.used_percentage` | How much of the weekly plan is used. |
| `seven_day.resets_at` | When the week resets. |

**The rule.** Before launching agents, the project manager reads the file.

- If the file is older than about 15 minutes, it is stale. The project manager does not trust it, says so, and falls back to Thomas's last screenshot and its own count.
- If `seven_day.used_percentage` is at or above the weekly ceiling (85%), it launches nothing new, as under "At the ceiling" above.
- If `five_hour.used_percentage` is high, it holds launches until the window resets, and tells Thomas when that will be. "High" is the project manager's call: a launch that would be cut off halfway wastes more than waiting does.
- The warnings at about 50% and 60% still come from the weekly figure.

**Setting it up for a person.** This is for whoever wants the file for their own account, on their own machine. The steps are written from the description of how Thomas's is made; the script is not in this repository, and these steps have not been run from this document.

1. Choose a folder that syncs to the shared Drive, and make a `claude/_usage` folder in it.
2. Write a small script that takes the status line's JSON on its standard input, reads the five-hour and seven-day `used_percentage` and `resets_at` from it, and writes them to `usage.json` in that folder with the fields above.
3. Set that script as Claude Code's status line (the `statusLine` command in the user's settings).
4. In the session, run `/loop 10m` so the file is refreshed about every ten minutes while the session is open. A file nobody has refreshed in 15 minutes counts as stale.

## The quick-fix lane

Most small changes to how something looks or reads are not worth a plan, a quality pass and a documentation round. They get their own lane. It follows the kinds of build in `CLAUDE.md`.

- **A user-interface tweak is a try build by default.** One builder, one pass, its own checks, pushed at once, no QA, no documents, no changelog entry. If it changes a module, it still bumps that module's patch version.
- **Tweaks are batched.** The project manager gathers Thomas's small notes and hands them to one builder together, rather than launching an agent per note.
- **Issues are for ideas and bigger work.** A tweak does not get a GitHub issue. An idea, or work too large for a batch, does, with the title started by its area and a colon (`Calendar: Show week numbers`). The areas are in `CLAUDE.md`.
- **A shared piece makes it a feedback build.** If the change touches something many modules use (the module frame, the theme tokens, the toolbar), it gets one short quality pass for regressions, fixes only what must be fixed, and a changelog line.
- **A new design goes to the Prototype first.** Something Thomas has not seen drawn is drawn on the Prototype, and the product is changed only after Thomas has looked at it.

Thomas names the kind. When he doesn't, the project manager treats the work as a try build, and never treats a try build as a production build.

## The token ledger

Every report from the project manager ends with one line, for example:

`Tokens: Product 410k (3 jobs), Design 260k (2), Quality 340k (2); total 1.0M; over expectation: none`

The line also shows the week to date, as agent tokens and the estimated percentage of the weekly plan, for example: `Week: 7.2M (about 19%), ceiling 85%`.

A job's tokens are the number in the agent's own report. The project manager's own turns are not counted.

## What this does not do

- It enforces nothing. The cards are expectations, not limits.
- It does not change who may edit what. Only product-planner writes plans. Only content-manager edits `documentation/`, the README and the changelog. Builders describe their changes in their reports.

## Changes

The starting values above are those of 2026-11-01.

- 2026-11-01 Thomas: approved as written; weekly plan budget added: other work 25-30% of the plan, this project first in rank; warn at 50% and 60%, ceiling 65%.
- 2026-11-02 Thomas: yes to recording the rule that an unanswered question is asked again.
- 2026-11-03 Thomas: the weekly ceiling is 85%, not 65%. A live usage file is read before agents are launched, and launches are held when the five-hour window is high. User-interface tweaks default to a try build, batched; issues are for ideas and bigger work; a shared piece makes it a feedback build; a new design goes to the Prototype first.
