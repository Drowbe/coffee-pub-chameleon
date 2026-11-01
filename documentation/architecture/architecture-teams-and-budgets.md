# Teams and budgets

**Audience:** Thomas, who decides how work is divided and what each team may spend; and the project manager and the agents who follow it.

**Status:** Draft, awaiting Thomas's approval. Decisions of 2026-11-01. Nothing here applies until Thomas approves it.

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
- No hard cap can be enforced. Agents report the tokens they used. The limits are expectations written into each brief.

## How Thomas changes a card

Thomas tells the project manager in plain words. Examples:

- "Raise Native to 2 at once."
- "Cap Design at 1."
- "Product on the larger tier for the next 3 jobs."

The project manager applies the change from the next job. The documentation agent records it under Changes, below, with the date and the sentence Thomas said.

## The token ledger

Every report from the project manager ends with one line, for example:

`Tokens: Product 410k (3 jobs), Design 260k (2), Quality 340k (2); total 1.0M; over expectation: none`

A job's tokens are the number in the agent's own report. The project manager's own turns are not counted.

## What this does not do

- It enforces nothing. The cards are expectations, not limits.
- It does not change who may edit what. Only product-planner writes plans. Only content-manager edits `documentation/`, the README and the changelog. Builders describe their changes in their reports.

## Changes

No changes yet. The starting values above are those of 2026-11-01.
