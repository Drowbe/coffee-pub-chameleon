# Release Plan

**Audience:** Thomas decided what "done" means, what is in the first release and the rules of the freeze (see
"Decisions"). The project manager runs the work. product-planner writes the plans each track needs, server-development and
experience-design build, bug-fixes fixes, quality-assurance reads and tests (read-only), content-manager writes the
documentation, the changelog and the first drafts of the legal texts. A lawyer, whom Thomas chooses, confirms the
legal track.

**Status:** decided, 2026-11-14, with two things still owed by Thomas (the two people for the real call and the
co-editing test, and the browser on each device). Thomas answered the eighteen questions of the first draft and the four
that came out of them (19 to 22) on 2026-11-14; his answers are under "Decisions". Nothing is built. The issue table
under "What it is today" is a draft that the project manager and Thomas confirm; no issue is gating by this document
alone. The per-module "done" lists, the checklists and the order below are still proposals that Thomas cuts or adds to,
except where a decision says otherwise.

Thomas's request, 2026-11-14: "We need to define 'done' for a 'release'. We have a series of modules, all in flight,
core in flight, and bugs. (1) work through each module and declare a 'done' body of work; (2) nail down the core and
declare the done body of work; (3) identify the gating issues and deal with them in the context of the core and
module work; (4) once defined, freeze work; (5) nail down security; (6) nail down data protection; (7) nail down data
integrity; (8) nail down all the legal bits; (9) a module could be coded but happen outside our process as a 3rd
party."

**Claude gives no legal advice.** Everything under "Track 4: the legal bits" is a list of things to ask a lawyer, and
what the repository shows today. It is not an opinion on what the law needs. Thomas must have a lawyer confirm it
before release.

## Why

Nothing is released today. `CLAUDE.md` says so, and says what that allows: no compatibility layers, no data
migrations, ids, routes, API fields and stored keys may be renamed, test data may be reset. Work has gone wide: twelve
bundled modules, 103 plan files, and about 150 open issues. No written line says "this is the first release", so no
work can be called finished and nothing can be told to wait.

This plan sets that line, and the five tracks (security, data protection, data integrity, legal, third-party
modules) that must be finished before a release is safe to hand to people who are not Thomas.

### What "released" changes

Read from `CLAUDE.md` (Rules). Its rule "The product is not released" ends with the release; its own text says "Once
the product is released this rule is removed." In practice, each a proposal until Thomas answers the questions below:

- **Compatibility starts.** (Decided: decision 9 and the replacement rule, decision 17.) Routes, API fields, stored keys, element ids that other things link to, module SDK calls
  and the module manifest become promises. A change to one needs an alias, a migration or a new version.
- **Data stays.** Today "test data may be reset". After release a person's data is theirs, and an update must read what
  an older version wrote. The 0.4.0 names migration (`server/migrate-names.js`) is the only data migration in the code,
  and `CLAUDE.md` says not to extend it. After release a migration policy must exist (Track 3).
- **Stored formats freeze at the release.** Three file formats carry `{ "format": kind, "formatVersion": 1 }`
  (`server/file-format.js`: theme, template and objects). An environment's `app.json` carries a `version` number and a
  `migrations` record (`server/store.js`, both from the names migration). I found no version marker on the chat files,
  module data, the Vault's records or the agreements file, and no `schemaVersion` anywhere in `server/` (read as
  code). The freeze has to close that gap first, because after the release a missing marker can only be added by guessing.
- **Old words and old routes.** `check-names` and its allow-list fence the old words. After release those old links are
  real people's saved links; the allow-list then holds promises, not leftovers.
- **Test data and the demo.** The demo loader (`plan-demo-space`) writes test data. After release it must never touch a
  real environment unasked. The release check is that it stays a deliberate action.
- **The rule's replacement.** `CLAUDE.md` needs a new rule in its place: what may change freely, what needs a version
  bump, who decides. Thomas and content-manager write it; this plan does not edit `CLAUDE.md`.

## Decisions

Thomas, 2026-11-14, answering the eighteen questions of the first draft and the four that followed (19 to 22). Each
keeps its question and the option he chose. Numbers are the question numbers; the plan elsewhere cites them as "decision N". Question 5 is answered in his
own words, not an option.

1. **What is the first release, in one sentence?** Answered, a: a private, invited release to named customers on a hosted
   server that Thomas runs. Reason: the fewest promises, a small blast radius and a lighter legal track.
2. **Which modules are in the first release?** Answered, a: all twelve, each with its own done list. The lists under
   "Per-module done list" are the starting point.
3. **What makes an issue gating?** Answered, a: the seven rules under "Gating rules".
4. **Which version number is the release?** Answered, a: `1.0.0`. The compatibility promise starts there.
5. **How long may the freeze last, and who may allow an exception?** Answered, in his own words: no limit on the freeze.
   Who may allow an exception is decision 20; the review date that keeps the freeze visible is decision 19. The first
   draft had suggested four weeks.
6. **Is co-editing on by default at release?** Answered, b: yes, after a real two-person test. The `coediting` switch
   stays off until that test passes.
7. **Is the call as a module (#377) in the first release?** Answered, a: no. It ships as it is, and the SDK promise says
   the call is not yet a module.
8. **How is security assessed?** Answered, a: finish `plan-security-assessment`, run an independent larger-model read of
   every core area, then a human penetration test on a hosted server before the first customer.
9. **What is the stored-data promise after release?** Answered, a, and a wider intent. Thomas's intent is that data is
   secure and backed up, so data protection and backups are a release requirement ("Track 2" says what that means in
   concrete terms). For updates: every update reads every older shape since the release, each shape has a version,
   and a copy is taken before any migration.
10. **Third-party modules at release?** Answered, a: the module contract and the SDK promise are published, the owner
    approves as today, there is no listing and no review by us.
11. **Is a human penetration test and a lawyer's review in the budget?** Answered, a: both, before the first customer.
12. **Who signs off the legal track, and which texts do we need?** Answered, a: Thomas signs after a named lawyer confirms
    in writing, and content-manager drafts the texts for the lawyer.
13. **What is the product's own licence at release?** Answered, a: proprietary, all rights reserved, with a `LICENSE`
    file.
14. **The product name (#426).** Answered, a: finish "Coffee Pub Chameleon" before the freeze, then clear the trademark.
15. **Does the host admin's password stay able to open every environment (#422)?** Answered, b: yes, documented as the
    hosted operator's right. This is a deliberate exception to the per-environment promise. The docs and the terms
    must tell customers, before they put data in, that the host admin's password opens every environment, that the
    hosted operator is the one who holds it, and what the operator will and will not do with that access.
16. **What does "verified" need for the first release?** Answered, a: one real call with two people on each phone and
    computer kind Thomas names, including a hosted server. The kinds are named in decision 22.
17. **What happens to `CLAUDE.md`'s "not released" rule?** Answered, a: it is replaced with a post-release rule before
    the tag, written by Thomas and content-manager. product-planner does not edit `CLAUDE.md`.
18. **Is the issue list refreshed before anything is marked?** Answered, a: the project manager re-reads every open
    issue, including #742 and up, #780, #786 and #795, before anything is marked gating.
19. **What keeps the freeze from dragging, given no limit (decision 5)?** Answered, a: a review date, set when the
    freeze starts (for example every four weeks). On that date the project manager reports what is left and Thomas
    chooses to continue, cut a list or move a module to after the release. It is not a limit. Reason: it makes a drag
    visible without forcing a choice.
20. **Who may allow an exception to the freeze?** Answered, a: Thomas allows every exception. The project manager allows
    only a fix that touches no stored data, route or SDK call, and tells Thomas in the next report. Reason: a change
    that could break a promise stays with him.
21. **What are the backup details?** Answered, a: daily automatic backups, the last seven kept, one copy on a machine
    other than the one the data lives on, the secrets key kept apart from the backups, and disk encryption on the hosted
    server left to the host. Reason: a plain starting point that Thomas can tighten later.
22. **Which devices and which two people, and does the release wait for the co-editing test?** Answered, a, in part.
    Thomas named the device kinds for the real calls and the co-editing test (2026-11-14): iPhone 13 Pro Max, iPad
    12.9, Mac mini M4 and Windows 11. **Still owed:** the two people, and the browser on each device (for example Safari
    or Chrome; Thomas has not named them). The release does not wait for the co-editing test: if it has not passed by the
    tag, the release ships with `coediting` off, and a customer is told co-editing is not yet on. Reason: the switch
    makes this safe.

### Tensions between the decisions

Ranked, worst first. None is a reason to change a decision; each says what keeps it safe.

1. **All twelve modules and no limit on the freeze (decisions 2 and 5).** Twelve done lists, about 150 open issues,
   gating bugs that each need an independent read, and nothing that ends the freeze except Thomas's own call. It can
   drag with no one deciding that it is dragging. Decision 19 bounds it with a review date, not a limit. On that date Thomas
   looks at what is left and chooses to continue, cut a module's list, or move a module to after the release. He is
   not forced to do any of them.
2. **The host admin's password against the per-environment promise and the private hosted legal track (decisions 15, 1
   and 12).** A customer in a hosted environment is told that environments are separate, and the operator can open any
   of them. That is honest only if the terms and the privacy notice say so, and the lawyer confirms the wording. The
   same exception means a successful attack on the host admin's password reaches everything, so the sign-in and
   two-step work of Track 1 matters most for that one account. It is a documentation and legal task more than a code
   task, but it cannot be dropped, because the promise is otherwise false.
3. **Co-editing on by default needs a test the cloud container cannot do (decision 6).** A real two-person test needs
   two people in two browsers. Tool checks and the container can show the restore tests but not that. Until the test
   passes the `coediting` switch stays off, so the release does not break if the test slips; it only ships without
   co-editing on. Decision 22: the release does not wait for the test. What is still owed is the two people and the
   browsers; until they are named the test cannot be scheduled.

Two smaller notes. Decisions 8, 11 and 12 say "before the first customer", not "before the tag", so the tag can come
before the pen test and the lawyer's confirmation, and a customer waits for both. And decision 9 makes the baseline of
stored shapes the release itself, so every missing version marker must go in before the tag.

## What it is today (the inventory)

Read 2026-11-14 on `origin/main` at `06d737ce`. Read as code and documents unless I say otherwise. Nothing was run, and
`npm run check` was not run for this plan.

**The issue list.** The 2026-11-12 list was out of date. The project manager read the open list again on 2026-11-14
(146 open issues, numbers and titles with labels where known), and the table under "Open issues" below is built from
that list. I could not read any issue body (no GitHub access for this session), so the classification comes from titles,
labels, this plan, the architecture documents and the code. The per-module tables below still show the 2026-11-12
issue numbers; some of those are no longer open.

### Modules

Versions are from `tools/module-versions.json`. "Plan" is the status line of the plan that covers the module.

| Module | Version | Plan and its status | Open issues (2026-11-12) | Plainly unfinished |
|---|---|---|---|---|
| Assistant | 0.1.26 | [plan-ai-assistant](plan-ai-assistant.md) draft, nothing built; [plan-assistant-module](plan-assistant-module.md) decided; [plan-ai-pictures](plan-ai-pictures.md) approved, picture steps not built | #393, #731, #209, #382 | the real-provider test of look-ups and proposals (#393); the picture steps; merging with the AI service (#731) |
| Budget | 0.1.25 | [plan-budget-module](plan-budget-module.md): steps 1 to 4 and 6 built; 5 and 7 pending | #41 | the travel template turning Budget on (step 5); documentation (step 7); known issue: up to 30 seconds behind the Planner |
| Calendar | 1.24.40 | [plan-calendar-destination](plan-calendar-destination.md) and [plan-calendar-markers](plan-calendar-markers.md) built; [plan-calendar-todo](plan-calendar-todo.md) partly built; [plan-space-calendars](plan-space-calendars.md) approved, steps built | #336, #338, #179 | the phone Day view scrolls by itself (#336); space calendars' last settings (#179) |
| Documents | 0.11.30 | [plan-documents](plan-documents.md) and [plan-documents-rich-editor](plan-documents-rich-editor.md) draft; [plan-documents-paper-layout](plan-documents-paper-layout.md) decided; [plan-documents-coediting](plan-documents-coediting.md) decisions recorded (its status line says nothing is built, but commits `db7865eb` to `26928f24` build steps 4a to 4c behind a `coediting` switch, off by default) | #611, #632, #634, #665, #666, #687, #688, #690 | whether co-editing and rich text are the default (#665, #687); "paths checked as code only" in known issues; round-trip bugs (#611, #632) |
| Maps | 0.10.3 | [plan-maps](plan-maps.md), [plan-map-destination](plan-map-destination.md) and [plan-map-image](plan-map-image.md) built; [plan-places-and-maps](plan-places-and-maps.md) draft, and commit `b8714558` folds Places into Maps (#794); [plan-map-options](plan-map-options.md) approved for step 0 only | #293, #294, #388, #374, #729 | map themes and options (#388); picture map without Python (#294); #729 likely done, confirm |
| Polls | 1.15.29 | no plan of its own | none | reporting to the status strip is built ([plan-space-status-strip](plan-space-status-strip.md)); nothing else seen |
| Research | 0.4.33 | [plan-research](plan-research.md) direction agreed (its status line says nothing built, which is out of date); [plan-research-import](plan-research-import.md) phase 1 built | #73 | known issue RS-01: notes, links and answers have no owner on the server |
| Stream | 0.1.15 | [plan-stream-module](plan-stream-module.md) (its status line says nothing built, also out of date) | #52, #53, #54, #55, #471 | no OBS source for screen share or guests; no replay after a reconnect (#471) |
| To-do | 1.15.30 | [plan-todo-list](plan-todo-list.md) draft; [plan-calendar-todo](plan-calendar-todo.md) partly built | #730 | the dedicated list (#730) |
| Planner (`travel`) | 0.16.7 | [plan-travel](plan-travel.md) phase 1 built; [plan-planner-phases](plan-planner-phases.md) built; [plan-itinerary-phases-markers](plan-itinerary-phases-markers.md) decided, not built | #12, #44, #45, #65, #215, #243, #307, #325, #331, #339 | object status ([plan-object-status](plan-object-status.md), approved, nothing built); the phases rail; print |
| Vault | 0.4.7 | [plan-attachments-vault](plan-attachments-vault.md) steps 1 to 6 built; [plan-vault-privacy](plan-vault-privacy.md) slices 1 to 3 built, slice 4 left | #414, #380, #396, #458 | the export, erase and leaver rules (slice 4); a backup that carries the files' bytes; office files ([plan-vault-office-files](plan-vault-office-files.md), draft) |
| Whiteboard | 0.1.64 | [plan-whiteboard-boards](plan-whiteboard-boards.md) and [plan-whiteboard-eraser](plan-whiteboard-eraser.md) decisions recorded | #445, #499, #501, #503, #541 to #544, #554, #561, #569, #662 | a long "limits" list in known issues; the board rules are the page's, not the server's; the follow-ups from the independent QA (#445) |

Module checks: `modules/documents/test` has 21 test files, `modules/whiteboard/test` 31 and `modules/vault/test` 5. The
other nine modules have no `test/` folder, so their checks live in `tools/check-*.mjs` only.

### Core

| Area | Plan and its status | Open issues (2026-11-12) | Plainly unfinished |
|---|---|---|---|
| Sign-in, sessions, two-step sign-in | [plan-mfa](plan-mfa.md) built; [plan-first-password](plan-first-password.md) approved, built since | #28, #422 | passkeys (#28); a host admin's password alone opens every environment (#422, known issue) |
| Access, guests, who can enter | [plan-access-bundle](plan-access-bundle.md) decided, built since | #684, #685, #709 | #709 likely fixed by `f61be301`, confirm; 403 versus 404 (#685); a raw `fetch` does not send the agreement 403 to `/agree` (#684) |
| Environments, hosting, host console | [plan-environments](plan-environments.md) and [plan-domains](plan-domains.md) built, QA pending; [plan-host-console](plan-host-console.md) built through slice 6 | #406, #422, #441, #442, #353, #427, #50, #213 | the isolation audit (#406); no framing headers on the console (#441); a leftover folder is adopted (#442); one whole-server backup (#427); a host admin can remove the last host admin (known issue) |
| Storage and backups | no plan; [architecture-environments](../architecture/architecture-environments.md) | #36, #427 | no single decision on private data (#36); an export blocks the whole hosted server (known issue) |
| Canvas, layout, workspaces | [plan-canvas](plan-canvas.md) built, "awaiting a real call"; [plan-unified-layout](plan-unified-layout.md) approved; [plan-workspaces](plan-workspaces.md) draft, with steps 1 to 4 and 11 to 12 on main | #29, #30, #464, #681, #682, #732, #741, #744 | a real call and two people (#29, #30); phone width (#464, #681, #682); [plan-phone-experience](plan-phone-experience.md) is still a draft |
| The call | [plan-realtime-optional-livekit](plan-realtime-optional-livekit.md) steps 1 to 7 built; [plan-call-as-module](plan-call-as-module.md) draft | #376, #377, #23, #52 to #55 | the call as a module (#377); three long-lived connections per page (#23); nothing here can be checked without a real LiveKit call |
| Module platform and SDK | [plan-modules](plan-modules.md) "In progress"; [plan-module-live](plan-module-live.md) built; [plan-module-emoji](plan-module-emoji.md) approved, not built | #286, #412, #471, #46 | no SDK or manifest version field that I could find; a warning before an uploaded module runs in the page (#412); no hello-world module (#46) |
| Home, Chat, notifications | [plan-home-lobby](plan-home-lobby.md) partly built; [plan-entering](plan-entering.md) part 2 not started | #2, #205, #290, #297 | the first-time experience (#2); the Lobby wording (#290) |
| AI service | [plan-ai-integration](plan-ai-integration.md) decisions made; [plan-ai-assistant](plan-ai-assistant.md) draft | #36, #382, #393 | the picture steps are held for a security read |
| Settings, Manage, templates | [plan-setup-panel](plan-setup-panel.md) and [plan-environment-templates](plan-environment-templates.md) built; [plan-space-templates](plan-space-templates.md) draft | #202, #214, #266, #267, #291, #333 | owner-set layouts (#266, #267); every overridable word listed (#333) |
| Design system | [plan-design-system](plan-design-system.md), [plan-design-system-approval](plan-design-system-approval.md) | #249, #371, #492, #683 | the restyle with the product site's system (#683, "plan first") |
| Product site, name, licensing | [plan-product-site](plan-product-site.md) built; [plan-rename-chameleon](plan-rename-chameleon.md) drafted | #426, #72, #49 | the name is half done (known issue: "The logo still reads the old name"); the licence lock (#72) |
| Checks and documents | `package.json`'s `check` script runs 161 distinct tool scripts, plus the module tests | #686, #402, #764 | a failing check on main (#686); a flaky one (#402); the known failures in `CLAUDE.md` |

### Open issues (the 2026-11-14 list, 146 open): a draft gating table

**This is a draft for Thomas to confirm.** Nothing is gating because this table says so. Thomas marks an issue gating
(decision 3, rule 7, and decision 18); the project manager applies the label (`release: gating` or `release: after`)
only after he confirms. I read titles and labels only, so each row says how sure I am. "High" means the title alone
settles the rule; "needs a body read" means the title suggests a rule but the body decides. Rule numbers are those under
"Gating rules". The earlier 2026-11-12 list is replaced by this one.

Some issues that list named are not on the 2026-11-14 list: #729, #740, #741, #732, #681, #412, #353, #213 and #43. They
were closed, or marked done, since 2026-11-12, as far as the list shows. The project manager confirms that, since I
cannot see closed issues.

**Gating (draft), 36: 22 high, 14 needing a body read.**

High confidence, 22:

| Issue | Rule | Why | What the 2026-11-14 decisions change |
|---|---|---|---|
| #70 | 1 | A GET that changes state, and a sign-in forced by another site. | Track 1 fix, HELD. |
| #406 | 2 | One environment reaching another's streams or shared state. | Isolation first (decision 8). |
| #422 | 1, 2 | The host admin's password opens every environment. | Stays open as a documented exception (decision 15). What is left is the docs, the terms, and a check that nothing else crosses. |
| #441 | 1 | The host console sends no framing headers (a framing attack). | Track 1 fix. |
| #795 | 1, 2 | The owner-set search address accepts loopback and follows redirects (SSRF). | Track 1, one shared outbound guard. |
| #709 | 1 | A member can take a display name ending in "(guest)". | Likely fixed by `f61be301`; confirm. |
| #36 | 1, 6 | No written decision on how private data is stored and sent. | Release work for data protection (decision 9, Track 2), not an open question. |
| #427 | 1 | One full backup of the whole server on a schedule. | Release work for backups (decisions 9 and 21). |
| #72 | 6 | The licence lock and the About page; a licence must exist first. | Release work for the licence (decision 13). |
| #780 | 6 | Re-check every licence and attribution before a public release. | Part of the licence inventory (Track 4). |
| #426 | 4, 7 | The product's name; a rename changes ids and words. | Finished before the freeze (decision 14). |
| #686 | 5 | A live check fails on main. | Release step 4. |
| #402 | 5 | A check cannot clean up after itself (`ENOTEMPTY`). | Release step 4. |
| #764 | 5 | `check-setup-tabs` fails when the machine is busy. | Release step 4. |
| #29 | 3, 5 | The canvas and layout were never tried in a real call. | The real call (decisions 16 and 22), step 10. |
| #30 | 3, 5 | Modules were never tried with two people on a real server. | The real call (decisions 16 and 22), step 10. |
| #665 | 4, 7 | Co-editing; its stored state and the default switch. | Release work: the real two-person test; ships with `coediting` off if it has not passed by the tag (decisions 6 and 22). |
| #471 | 3, 4 | The module event stream has no reconnect signal, so a page goes stale; the signal is an SDK promise. | The Stream done list assumes it. |
| #464 | 3 | At 760 px the first docked column is 0 px wide and its modules vanish. | None. |
| #682 | 3 | The second phone pass. | None. |
| #770 | 3 | On a phone a person cannot see what they type in Chat. | None. |
| #27 | 3 | The host console's shared top bar requests answer 404. | None. |

Needs a body read, 14:

| Issue | Rule | Why | What the body decides |
|---|---|---|---|
| #786 | 1 | Hardening notes from the secret-setting read: the seal key beside the file, `keepData`, a default on a secret, a module id constructor. | Which of the four notes can leak a secret. |
| #685 | 2 | A few routes answer 403 instead of 404 for a space the person may not enter. | Whether it tells an outsider the space exists. |
| #684 | 3 | A raw `fetch()` and the guest page do not send the agreement 403 to `/agree`. | Whether a guest is stuck or only misrouted. |
| #442 | 2 | The console create route adopts a leftover environment folder. | Whether a leftover folder can hand one owner another's data. |
| #445 | 1, 4 | Whiteboard follow-ups from the independent QA (labelled next). | Which follow-ups lose data or change a stored format. |
| #393 | 1 | The assistant's real-provider test of look-ups and proposals; the AI is a flow of personal data. | Whether the test is a data-protection gate or a quality one. |
| #376 | 3 | LiveKit optional; the plan is built. | Whether it is only to confirm and close. |
| #46 | 4 | A hello-world module for authors (Track 5 authoring help). | Whether decision 10's published contract needs it. |
| #23 | 3 | A second tab can stall on HTTP/1.1 (labelled later). | Whether production serves HTTP/2, which would remove it. |
| #335 | 3 | Space cards hold nested controls inside `role="button"` (accessibility). | Whether it breaks keyboard use on a core page. |
| #603 | 6 | Maps vendored libraries need licence files, a table and pinned hashes. | Likely done by `d61ed72a` and `40900a93`; confirm. |
| #611 | 1 | A run of four or more `$` does not round-trip, so Documents changes what a person wrote. | Whether text is lost or only reformatted. |
| #752 | 1 | A paste over the size limit is lost silently. | Whether the person is told. |
| #336 | 3 | The Calendar Day view scrolls by itself at 390 px. | Whether the view is unusable. |

**Not gating (draft), 98, grouped.** None of these can lose or leak data, stop a person entering a space or a call, or
change a promise after release, going by the title.

- **Decided not gating: #377.** The call ships as it is and the SDK promise says the call is not yet a module (decision 7).
- **Ideas and business, after the first release:** #12, #25, #28 (passkeys), #33, #34, #35, #40, #41, #43, #44, #45, #47,
  #48, #49, #50, #52, #53, #54, #55, #56, #64, #65, #73, #132, #204, #209, #211, #218, #232, #250, #252, #351, #380, #382,
  #396, #451, #458, #469, #480, #566, #789, #800, #803 and #688. Reason: new features, business offers (billing, own
  domains, a licence relay, other platforms) and ideas with no plan. #64 and #382 become gating only if Thomas puts
  outside AI clients or integrations in the first release.
- **The Whiteboard backlog:** #499, #501, #503, #542, #543, #544, #554, #561 and #569. Reason: Present, comments, export
  and import, colours and other modules' objects are listed as out of the first release; the data-loss follow-ups are in
  #445, which needs a body read.
- **Documents polish:** #634, #666, #690 and #778. Reason: a stray button, per-document fonts, maths and a focus outline.
- **Later-priority design and layout polish:** #371, #477, #492, #612, #618, #631, #641, #683 (a restyle, "plan first"),
  #774 and #718.
- **Home, Settings and Planner polish and later features:** #179, #202, #205, #214, #215, #223, #236, #238, #243, #249,
  #266, #267, #291, #297, #298, #307, #325, #328, #331, #332, #333, #338, #339, #357, #358, #388, #294, #505, #2 and #730.
  Reason: a wording change, a missing convenience or a feature that is not in the done lists as built. #298 (saving a
  bundled template reorders the module list) is a bug whose result is order only.

**Body must be read before deciding, 12.** The project manager reads these. Where I lean, I say so.

| Issue | Why the title is not enough |
|---|---|
| #632 | A `mailto` with square brackets in Documents; with #611, it may change what a person wrote. Leaning to gating if it changes stored text. |
| #687 | Rich text becomes the default after hand tests. Thomas decides the default; the tests are verification work. |
| #286 | `/api/bus/actions` should tell each action's `may`. It may add a field to an SDK reply, which is rule 4. |
| #744 | Workspaces and the Conference tab (build). It may add routes or stored keys, and the freeze would stop it. |
| #750 | Each space can use its own template (step 2 building). It adds a stored key, so it must land before the freeze or wait. |
| #731 | Combine Assistant and AI service into one module. It would rename a module id and stored keys, which a release freezes. |
| #374 | Should Places and Maps be one module? Commit `b8714558` folds Places into Maps; the issue may only need closing. |
| #679 | Access step 8, Trips add and leave. It touches who can enter a space. |
| #680 | A report-a-problem button files a private GitHub issue. It sends text out, so it is a data-protection question. |
| #290 | Finish Lobby wording and phone tabs (labelled next). The phone tabs half may be rule 3. |
| #717 | Follow-ups from batch 6. Unknown contents. |
| #798 | About open-source padding at 390 px in dark mode, labelled `check-conformance`. If a check fails on main it is rule 5. |

Counts: 22 gating with high confidence, 14 gating needing a body read, 12 whose body must be read, 98 not gating; 146
in all.

## The contract of "done"

A template that each module and the core must meet. The template is a proposal. Each module's list is a proposal for
Thomas to cut or add to.

### What "done" means for a module

A module is done when all of this is true, and written in its "done list" (one page, in the module's plan):

1. **Features in scope** are listed by name, each tied to a plan step or an issue, each built and checked.
2. **Out of scope** is listed by name, each tied to an issue marked after-release. A person is never offered a control
   that does nothing.
3. **Checks.** The module's own tests (`modules/<id>/test/*.mjs`) and its `tools/check-<id>*.mjs` pass in
   `npm run check:module -- <id>`. Every bug fixed since the plan has a check that failed before the fix.
4. **Verified live.** What the module does in a real browser has been tried by a person, on a computer and on a phone,
   in light and dark. Anything that needs a real call or two people is named and tried once (#29, #30). Each "read as
   code only" line in `known-issues.md` is either tried or accepted by Thomas in writing.
5. **Documents.** A user guide, the architecture page, changes to the `api-` pages, `known-issues.md` free of anything
   that loses or leaks data, and a CHANGELOG entry.
6. **Accessibility.** Every control reached by keyboard, a visible focus ring, text contrast of 4.5 to 1, no control
   inside a `role="button"`, reduced motion respected, a screen reader pass on its main flow.
7. **Phones.** Tap targets of at least 44 px (`check-phone-targets`), the narrow layout works, nothing vanishes at 760 px.
8. **Security read.** An independent read of the module's server rules (its `guards`, permissions and uploads) and its
   sandbox behaviour, with the hostile cases tried. The reader is not the builder.
9. **Data format frozen.** The shape of every object the module stores is written down, carries a version, and has a
   stated rule for how a later version reads an older one.
10. **Manifest frozen.** Permissions, `refs`, `events`, `actions`, `settings` keys and the module's id do not change
    without a version bump and a migration.
11. **Words and names.** Plain short words, the names in `CLAUDE.md`, themeable by template.
12. **Licences.** Every library and asset it ships is in `public/credits.json` and passes `check-credits`.

### What "done" means for the core

The same twelve, applied to each core area in the list above, plus:

- **Every route** in `server/index.js` has an owner check that is written down and tried with a hostile request. (The
  earlier security draft counts about 320 routes; I did not recount.)
- **Every environment variable** is in the install guide and the compose file, with a safe default.
- **Install, update and rollback** are tried on a clean machine, single-environment (no `BASE_DOMAIN`) and hosted.
- **A single-environment install behaves as before.** A standing rule in `CLAUDE.md`, and it stays one.

### Per-module "done list" (proposal)

Decision 2: all twelve modules are in the first release, each with its own done list. The lines below are the starting
point for each list; Thomas cuts or adds to them. "Out" means after the first release.

| Module | In (proposal) | Out (proposal) |
|---|---|---|
| Assistant | ask and answer in Chat with a real provider tried (#393); a person's own key sealed; the What AI may see switch | pictures; merging with the AI service unless #731 is decided in |
| Budget | what is built; step 5 and the documentation | currency conversion (#41) |
| Calendar | what is built; the phone Day view fix (#336) | space calendar extras not built (#179) unless decided in |
| Documents | Markdown and rich text, Paper layout, print and Markdown files, tags; co-editing on by default (decision 6) once a real two-person test has passed, and not before | maths (#690), custom margins (#688), Google Drive (#566) |
| Maps | the map and the places in one module; the picture map; the credit line | themes and options (#388); a picture map without Python (#294) |
| Polls | what is built | any new feature |
| Research | what is built; an owner rule on notes, links and answers (RS-01) | research from any AI (#73) |
| Stream | the OBS views as built, with the replay signal (#471) | screen share and guest OBS sources, choosing whose space (#52 to #54) |
| To-do | what is built; the dedicated list only if Thomas decides it in (#730) | WhatsApp, SMS and reminders |
| Planner | phases, the itinerary, print only if decided in (#339) | modes (#307), reading email (#45), the audit (#65) |
| Vault | files, links, share links, private files, the leaver and erase rules (slice 4), a backup that carries the bytes | office files (#396), Drive, an environment library |
| Whiteboard | boards, the eraser, the server limits (#445) | comments, other modules' objects, import and export, the Present extras |

## Gating rules

Decided (decision 3): all seven rules. An issue is **gating** when any one of these is true:

1. It can leak or lose a person's data, or let one person act as another.
2. It lets one environment, space or module reach what belongs to another.
3. It stops a person entering a space or a call, or makes a core page unusable on a phone.
4. It breaks the freeze's own promises: a stored format, a route or an SDK call that would need to change after release.
5. A check, an install or a rollback cannot be trusted without it (a failing or flaky check on main).
6. It is a legal or licence gap the lawyer names.
7. Thomas names it.

An issue is **not gating** when it is polish, a missing convenience, a new feature, a wording change, or a bug whose
workaround is written in `known-issues.md` and which cannot do any of 1 to 5. A gating issue is handled inside the
module or core "done" list it belongs to, not as a separate project, and one that blocks two lists is built once.
The project manager marks each issue (`release: gating` or `release: after`) after re-reading every open issue
(decision 18).

## The freeze

Decided in part (decision 5: no limit on its length). It starts once the "done" lists are agreed and the name is
finished (decision 14).

- **What it freezes:** new features, new routes, new stored keys, new manifest fields, new SDK calls, renamed ids, and
  any change to a stored format. Dependencies stay at their locked versions except for security fixes.
- **What may still change:** a fix to a gating issue, a bug fix that restores what a "done" list says, wording and
  documents, tests and checks, and licence fixes.
- **Exceptions:** an exception names the issue, the reason and the "done" point it serves, in the issue. A change to the
  core, the SDK, the manifest or a stored format is held for an independent read, as today.
- **Who may allow it:** decision 20. Thomas allows every exception. The project manager allows only a fix that touches
  no stored data, route or SDK call, and tells Thomas in the next report.
- **How long:** until the release is tagged. Thomas set no limit (decision 5). With all twelve modules in (decision 2)
  this is the largest risk to the plan, so decision 19 sets a review date, not a limit. The date is set when the
  freeze starts (for example every four weeks); the project manager reports what is left, and Thomas chooses to
  continue, cut a list or move a module out.
- **What the project manager does:** every pull request in the freeze names its "done" point, and a feature pull
  request waits until the tag.

## The five tracks

Each track is a workstream with a checklist. Every list is a proposal and a starting point; each track begins by
turning its list into a plan or a report.

### Track 1: Security

An earlier draft, `plan-security-assessment`, exists on the branch
`pm/plan-security-assessment` (not on main). It has fourteen areas, a threat picture
and a method. Decision 8: finish it, then run an independent larger-model read of every core area, then a human
penetration test on a hosted server before the first customer. This track reuses the draft and replaces it, not repeats it.

Checklist (proposal):

- **Authentication.** Sessions and their cookie flags (`HttpOnly` and `SameSite=Lax` are set in `server/auth.js`, and
  `secure` comes from `isSecure(req)`), the second step, recovery codes, the login limiter (`LoginLimiter`, also used
  for the console and the address check), the first-password flow, #422. Decision 15: the host admin's password may open every environment, as the hosted
  operator's right. That is a deliberate exception, so the read checks that this is the only way across, that no
  environment's own owner or member password reaches another, and that the exception is written in the docs and terms
  (Track 4).
- **Sessions.** Sign-out everywhere (`userStamp`), expiry, the console's `host_session`, personal links, how a link is
  revoked.
- **The guest door.** Guest links, **Continue as guest**, the agreement, the 24-hour life, the "(guest)" mark (#709),
  request access, a closed space telling outsiders nothing (`8d18ed85`).
- **Uploads.** Module zips (10 MB, 500 files, 40 MB unpacked), the Vault (scan, clean, PDFs as attachments), pictures in
  modules, picture maps, `POST /api/modules` and its path handling.
- **Outbound requests (SSRF).** `server/link-preview.js` refuses private addresses, also after a redirect;
  `external-calendars`, `ai-http`, `geocode`, `flight-lookup` and `region-cut` also go out. #795 is named in the request
  as the SSRF issue; I have not read it. Every outbound path gets one shared guard and one check.
- **Secrets.** `secrets.key` or `host.json`'s `secretsKey`, the sealed module secret setting (#784), what #786 covers
  (not read), `ADMIN_PASSWORD` reset on every start, `BILLING_SECRET`, `LIVEKIT_API_SECRET`, the access key, and what an
  owner's export and a host backup carry.
- **Headers and CSP.** The code sets `frame-ancestors` and `X-Frame-Options`, `Referrer-Policy`, `nosniff` on Vault
  files and a sandbox policy on module pages. I found no `Strict-Transport-Security` in `server/*.js` (read as code;
  the reverse proxy may set it). The earlier draft counts a content security policy in 15 of 18 pages. #441.
- **Rate limits.** Sign-up, sign-in, tokens, uploads, link previews, AI calls, guest posts and the live streams.
- **Environment isolation.** #406, the six streams and the process-wide maps.
- **CSRF and origin.** `sameOriginOnly` is in place; #70 (a GET that changes state, login forced by another site) is open.
- **An independent read of every core area.** One hostile-case list per core area in the list above, run by a reader
  who did not build it (quality-assurance, on a larger model).
- **Dependency audit.** Seven runtime dependencies (`package.json`), the vendored libraries, `node:22-alpine`,
  `alpine:3.20`, the `pmtiles` program (pinned by version and sha256 in the `Dockerfile`), and
  `livekit/livekit-server:latest` in the compose file. I found no dependency-update or audit workflow in
  `.github/workflows`. A pinned LiveKit version and an `npm audit` step belong on the list.
- **A human penetration test** on a hosted server, budgeted (decisions 8 and 11), after the fixes from the reads and
  before the first customer.

### Track 2: Data protection

Checklist (proposal). It starts with an inventory (what personal data, where, why, how long); the repository has no such
page today.

**What decision 9 means here.** Thomas's intent is that data is secure and backed up, so both are release
requirements, not extras. In concrete terms, each point set by decision 21 where it names a number or a place:

- **Secure in transit.** Every hosted environment is reached over HTTPS, and the install guide says so without a
  plain-HTTP option for a hosted server.
- **Secure at rest.** Secrets stay sealed; data files stay `0600`; no secret or password hash appears in an owner's export,
  a log or a backup meant to be shared. #36 gets one written answer: what is stored as plain JSON and why. Whether the
  hosted server's disk is encrypted is the host's choice, outside the app (decision 21).
- **Backed up.** Decision 21: a daily automatic copy of the whole data folder (every environment, the host's files, and
  the Vault's file bytes) that does not block the running server, the last seven kept, and one copy on a machine other
  than the one the data lives on. Today only an owner's export and an unfiltered host backup exist (#427).
- **Backups are secret.** A backup holds password hashes and, with the secrets key, the sealed secrets. It is readable
  only by the operator, and the secrets key is kept apart from the backups (decision 21).
- **Restore proven.** A restore onto a clean machine, from a backup made by the oldest version, and the restored
  environment starts (Track 3).
- **A copy before every migration** (Track 3).
- **One owner's data on its own.** An owner's export and erase cover that environment only.
- **A way to report a flaw and a short written plan for a leak.** `SECURITY.md`, and what Thomas does and tells
  customers; the lawyer says what the law asks (Track 4).

- **What is stored, and where.** Accounts (logins, display names, password hashes, two-step secrets) in each
  environment's `app.json`; chat in `chat.json` (public) and `chat-private.json`; module data as JSON; Vault files
  under `VAULT_DIR`; agreements (`agreed` on an account, `agreements.json` for guests); AI log counts; share links;
  notifications. The inventory names each file.
- **Retention.** Chat keeps text only, for a real space only, at most 30 days, 500 public messages a space and 200
  private ones a person (`server/chat-history.js`). Other data has no stated retention that I found. Guest agreement
  records keep up to 100000 entries and never drop (`server/agreements.js`). Each store needs a stated life.
- **Deletion.** `eraseSpace` (`server/space-erase.js`) removes a space and its files; `removeUser` in `server/store.js`
  removes an account. What stays behind (a person's name in old chat, objects they made, Vault files, share links) is
  the slice 4 question of plan-vault-privacy and needs one rule across modules. Research notes have no owner on the
  server (known issue).
- **Export.** An owner's `GET /api/environment/export` leaves out sign-in secrets and private chat, and still carries
  logins and display names, notifications, module setting values and the Vault's file records (known issue "An owner's
  copy still carries some personal details"). A person's own export of their data does not exist; a lawyer says whether
  one is needed.
- **Backups.** The host's backup is not filtered and keeps hashes, so it is secret. A whole-server backup (#427) and a
  backup that carries the Vault's bytes are not built.
- **Encryption.** At rest, only secrets are sealed (`secrets.key`, `secretsKey`); the rest is plain JSON and plain
  files. In transit, HTTPS comes from the reverse proxy the install guide describes, not the app; LiveKit encrypts its
  media. #36 asks for the decision and no document holds it.
- **Guests.** What a guest leaves: a name, an agreement record, chat in the space, a session of 24 hours.
- **Logs.** `AI_LOG_PROMPTS` is ignored on a hosted install. Other logs are not read yet.
- **The AI assistant's data.** What goes to the provider, with what consent, behind what switch (**What AI may see**),
  where the key lives, and what the AI log keeps (counts only). The provider terms need reading (Track 4).
- **Per-environment separation.** A hosted server holds many owners' data in one process. This is the isolation work
  of Track 1, seen as a privacy promise.

### Track 3: Data integrity

Checklist (proposal).

- **Storage format.** JSON in `DATA_DIR`, one folder per environment. Write down every file, its owner, its shape and its
  version, and add the marker the files lack (see "What released changes").
- **Atomic writes.** `server/store.js` writes `<file>.tmp` then renames it, mode `0600`. I found no `fsync` call in
  `server/*.js`, and I did not check that every other store (module data, chat, Vault records, agreements, the host
  registry) writes the same way. The list needs one verified answer per file.
- **Concurrency.** Known issues say "last write wins" for the Whiteboard's blocks and grids. Decide which objects need
  a version check and which accept last-write-wins on purpose.
- **Co-editing snapshots.** Documents keeps a stored copy of the state, compaction by re-seed and an editors list
  (`6441ab5e`, `960d545e`, `1fa81af1`). Decision 6 turns it on by default at release, so it needs a restore
  test (damaged state, a lost writer, an outage) as well as the real two-person test. The `coediting` switch stays off
  until both pass.
- **Backup and restore.** One tested path, with a restore test on a clean machine and a check that a restored
  environment starts. (The architecture says services see data "in its current shape, including an environment
  restored from an old backup".)
- **Repair.** A file that cannot be read stops the start with one sentence (`architecture-environments`). Decide what
  an owner does next, and whether a repair tool is needed.
- **Versioning of stored data and the post-release migration policy.** Decision 9: every update reads every older
  shape since the release; each shape has a version; a copy is taken before any migration. The shapes as they stand at
  the tag are the baseline, so every missing marker must be added before the tag. Still proposed on top of that: a
  migration runs once and can be rolled back, and a rollback of the image must not read data it cannot understand. (`server/chat-history.js` already keeps
  private chat in its own file so an earlier release cannot show it, a good precedent.)
- **A restore from a backup made by an older version** is a test, not an assumption.

### Track 4: The legal bits

**Claude gives no legal advice. Thomas must have a lawyer confirm every point below.** The list says what the repository
shows and what to ask.

- **Licences of every dependency and asset.** `public/credits.json` has 48 entries, kept in step by `check-credits`,
  `check-third-party-licences` and `check-vendored-hashes`. Things I did not find in it by name: the `pmtiles` program
  the Docker image fetches (go-pmtiles 1.31.2), the airport data in `server/airports.json` (its notice is
  `server/airports-LICENSE`), the base images `node:22-alpine` and `alpine:3.20`, and the LiveKit server image. Whether
  each needs a line in the About list is a question for the lawyer. #780 is the pre-release licence re-check named in
  the request; I have not read it.
- **The product's own licence.** Decision 13: proprietary, all rights reserved, with a `LICENSE` file. `package.json`
  says `UNLICENSED`, and the About tab says "Proprietary software. All rights reserved." There is no `LICENSE` file
  in the repository yet. #72 (the licence lock and purchased keys) depends on it. The lawyer confirms the wording.
- **The credits page.** Built (`d61ed72a`, `40900a93`). Keep it in step at the release.
- **Terms and privacy text.** The server can show a terms file and a beta NDA before entry (`TERMS_FILE`, `NDA_FILE`,
  `server/agreements.js`); no such texts are in the repository, and I found no privacy notice.
- **Cookies and consent.** The app sets `app_session`, `host_session` and `env_hint`. Whether a notice is needed is a
  question for the lawyer.
- **Children.** Nothing in the code asks an age. Ask whether that matters.
- **Export controls.** The product uses TLS and a media stack (LiveKit). Ask whether any filing is needed.
- **Trademarks.** Decision 14: the name is finished as Coffee Pub Chameleon (#426) before the freeze, then cleared. Ask
  for a clearance search before the first customer, and the same for "Coffee Pub" and the module names.
- **LiveKit.** The server is a separate program the compose file pulls as `:latest`, and its client and server SDKs
  are in the credits (Apache-2.0). Ask about the terms if Thomas ever offers a hosted LiveKit.
- **Map data and tiles.** The map shows what the admin's PMTiles file holds. Protomaps builds are made from
  OpenStreetMap (ODbL 1.0; the credit line cannot be hidden). Ask who is responsible for a file an admin supplies. The
  geocoder and the flight look-up use outside services; their terms are not recorded in the repository.
- **Fonts, icons, images and glyphs.** Figtree and Fraunces (OFL), Font Awesome Free (CC-BY, OFL, MIT), the Noto map
  glyphs (OFL), and eight background images "Made by Coffee Pub". Font Awesome Pro is not bundled (#43).
- **AI provider terms.** What each provider's terms allow (use of customer data, storage, minors). The product sends
  text to the provider the owner or admin picks.
- **Third-party modules.** Terms for module authors, and a warning to the admin who installs one.
- **The host admin's password (#422).** Decision 15 keeps it able to open every environment. Ask the lawyer how the
  terms and the privacy notice must say so: that the hosted operator can reach every environment's data, why, and what
  Thomas will and will not do with that access. The same text must reach an owner before they put people's data in.
- **Who signs off.** Thomas signs after a named lawyer confirms in writing (decision 12). Nothing is "legal done"
  without it. The lawyer is named before the freeze starts, because a lawyer's time is the slowest part of this track.

### Track 5: Third-party modules

Thomas's point 9: a module could be coded outside our process by someone else. What exists today (read as code and
documents): a module is a zip with a `module.json`; an upload is limited (10 MB zip, 500 files, 40 MB unpacked); it is
disabled until an owner or admin approves the permissions, hooks, refs, events and actions it asks for; it runs in a
frame with `sandbox="allow-scripts allow-forms"` and reaches Chameleon only through the SDK bridge
(`public/module-host.js`); an admin may run it in the page instead (the warning before that is #412); and the server
holds its data to its `guards` and permissions (`server/module-guards.js`). Nothing makes an outside author go
through us: anyone can install a zip on their own server. That is the part "outside our process".

What the contract and the SDK must promise (decision 10 publishes it; the list is the starting point). Decision 7: the
call is not yet a module at release, and the SDK promise says so, so an outside author knows the call is outside the
promise and may become a module later.

- **A version of the SDK and of the manifest.** I found no such field in `module.json` or the SDK code. A manifest
  needs to say which SDK it was built for, and the server needs to refuse or warn on a mismatch.
- **A stability promise.** Which `host.*` calls, manifest fields and routes are stable (never removed within a major
  version) and which are internal (the bundled modules use some that outside modules should not).
- **Permissions.** Each permission an outside module may ask for, in words a person reads, and a rule that nothing
  unapproved is ever granted. Modules never see secrets, except the write-only secret setting (#784).
- **Review and approval.** Decision 10: the owner approves as today, there is no listing and no review by us. The
  contract tells an author this plainly, so no one expects a review.
- **Sandbox.** What is promised and what is not: no network except what the SDK gives (to confirm; read as code), no
  cookies, `referrerpolicy="no-referrer"`, and what an in-page run gives up. The Whiteboard's "Picture not found" in a
  sandboxed run (known issues) shows the sandbox still limits real features.
- **Versioning and updates.** An upload must be newer than every installed version; rollback exists; an update that
  asks for more is held for approval (`api-modules.md`).
- **Authoring help.** A hello-world module (#46), the SDK reference ([api-module-sdk](../api/api-module-sdk.md)), a test
  kit (the bundled modules' `test/` folders are the only examples), and a way to run a module against a throwaway server.
- **What is outside our process:** the author's code, hosting, support and updates, and anything an admin installs.
  What we owe them: a stable contract and clear refusal messages. What we do not owe them: a review of their code, unless
  a listing is later decided.
- **Terms.** Module author terms and the admin's warning (Track 4).

## Release steps

A proposal. Every step is a gate. The number and the rule change are decided; the rest follows the decisions.

1. **Freeze** starts when the "done" lists are agreed.
2. **Version.** `package.json` says `0.4.0` today, and the CHANGELOG's `[Unreleased]` section holds everything since
   (the entry for #629 to #715 says it was written afterwards from the code). The release number is `1.0.0` (decision 4). Every module keeps its own version in `tools/module-versions.json`.
3. **Changelog.** content-manager writes the release entry from the commits and checks it against the code.
4. **Checks.** `npm run check` green on a clean machine, with the known failures resolved (#686, #402, #764). The two
   root-only `check-names` cases are a known note, not a defect.
5. **Image.** `.github/workflows/image.yml` builds `ghcr.io/drowbe/coffee-pub-collaborator` (the repository is named
   Chameleon now; whether the image is renamed is the rename plan's question). Tag the image with the release number;
   the compose file already warns never to use `:latest`.
6. **Clean install test.** A new machine, single-environment and hosted, from the published image and compose file.
7. **Tag.** One git tag on the commit the image was built from.
8. **Wiki.** `npm run docs:build`, review, and publish when Thomas says (the rule is: do not publish unasked).
9. **Rollback.** The previous image stays available. Data written by the new version must be readable by the old one, or
   a backup is taken first and the step says so. Tried once (Track 3).
10. **The rule changes.** `CLAUDE.md`'s "not released" rule is replaced by the post-release rule (decision 17), written
    by Thomas and content-manager before the tag. This plan does not edit `CLAUDE.md`.
11. **Before the first customer** (not before the tag): the human penetration test on a hosted server and the lawyer's
    written confirmation (decisions 8, 11 and 12), and the real two-person call on each of the four devices Thomas named (decision 22)
    (decision 16). The first release is private, invited and hosted by Thomas (decision 1), so the tag may come first and
    a customer waits for these.

## Risks, ranked

1. **Environment isolation on a hosted server** (#406 and the process-wide state). One environment seeing another's data
   ends trust at once. Not yet audited.
2. **No version on most stored data, and no migration policy.** After release this is data loss on an update.
3. **A real call has never been verified here** (#29, #30 and every "awaiting a real call" line). The central feature is
   checked only by tools, with no LiveKit server.
4. **Co-editing on by default** (decision 6) with tool checks and "read as code only" paths. The real two-person test
   cannot be done in the cloud container, so it waits on Thomas and a second person. If it slips, the switch stays off
   and the release is not held by it (see "Tensions").
5. **Backup and restore** are not proven end to end (no whole-server backup, an export that blocks a hosted server).
   Decision 9 makes this a release requirement.
6. **Legal gaps:** no licence file, no terms or privacy text, no trademark search, and the host admin exception
   (decision 15) that those texts must state.
7. **Third-party modules** with no SDK version and no stability promise: the first outside module freezes whatever the
   SDK is that day.
8. **Scope and an open-ended freeze:** about 150 open issues, 103 plans, all twelve modules in (decision 2) and no
   limit on the freeze (decision 5). Without the review date of decision 19 the freeze can drag.
9. **Phones:** several gating layout issues (#464, #681, #682) and no real phone test.
10. **Dependency drift:** `livekit-server:latest` and no audit step.

## What is not in the first release

Decided in part: all twelve modules are in (decision 2), the call as a module is out (decision 7), and there is no
listing or review of third-party modules (decision 10). The rest is a proposal.

Everything listed under "Ideas and business" above, except what Thomas pulls in; the iOS app
([plan-ios-app](plan-ios-app.md), draft); passkeys unless decided in (#28); billing and own domains (#49, #50); running
Chameleon on Windows and Mac (#56); a one-container install (#48); integration tokens (#64); the Chrome extension
(#232); the module listing and review (Track 5), decided out; and every plan whose status says "draft" or
"nothing built" and is not named in a "done" list.

## Doc facts

For content-manager once Thomas decides (this plan does not edit these):

- `CLAUDE.md`: replace the "not released" rule before the tag (decision 17; Thomas and content-manager write it).
- A `LICENSE` file (decision 13) and the legal texts drafted for the lawyer (decision 12): terms of service, a privacy
  notice, a cookie notice and module author terms.
- The terms, the privacy notice and the owner's guide must say that the host admin's password opens every environment
  (decision 15).
- A release guide: install, update, rollback, backup, restore.
- A security page and a `SECURITY.md` (how to report a flaw), a data protection page (the inventory), a data format
  page (every stored shape and its version) and a module author page (the stability promise).
- Stale status lines I found: [plan-research](plan-research.md) and [plan-stream-module](plan-stream-module.md) say
  "nothing built" while the modules exist; [plan-documents-coediting](plan-documents-coediting.md) says "Nothing is
  built" while commits `db7865eb` to `26928f24` build most of it; [plan-canvas](plan-canvas.md) waits on a real call.
- `known-issues.md` has a Whiteboard section written for 0.1.49 while the module is 0.1.64.

## Left to build, in order

Sizes are S (under a day), M (a few days) and L (a week or more). A step marked HELD touches `server/`, sign-in, who sees
what, the SDK or a stored format, so it waits for an independent read before main.

1. **Re-read the issue list and mark it** (`release: gating`, `release: after`), every open issue including #742 and up,
   #780, #786 and #795 (decisions 3 and 18). project manager. S.
2. **Thomas names what only he can name:** the lawyer (decision 12), the two people for the real call and the
   co-editing test and the browser on each device (decision 22; the devices are named), and the date the freeze starts,
   which fixes the first review date (decision 19). Thomas. S, but waiting on him holds steps 4 to 9.
3. **Finish the name "Coffee Pub Chameleon"** (#426, [plan-rename-chameleon](plan-rename-chameleon.md)), before the
   freeze (decision 14). experience-design and content-manager; server-development for any stored key. M. Then the
   trademark clearance goes to the lawyer (step 11).
4. **Write each of the twelve modules' and each core area's "done list"** into its plan (decision 2). product-planner,
   with Thomas. M for each module, L in all.
5. **The freeze starts**, with the first review date set (decision 19) and the exception rule of decision 20. The project manager enforces it. S.
6. **Finish `plan-security-assessment`, then the security reads and fixes**, isolation first (decision 8).
   product-planner finishes the plan; quality-assurance reads; server-development and bug-fixes fix; each fix has a
   check. L. HELD for every fix. Includes #70, #406, #441, #442, #684, #685, #795, the secrets issues, and for #422 only
   the check that nothing else crosses environments (decision 15).
7. **Data format inventory, version markers, the migration policy and a copy before any migration** (decision 9).
   Every marker goes in before the tag. server-development and content-manager. M. HELD (a stored format).
8. **Data protection and backups** (decision 9): the inventory, retention and deletion rules (#36, plan-vault-privacy
   slice 4), then the scheduled whole-server backup with the Vault's bytes, kept off the machine, and a restore proven on
   a clean machine (#427, the export that blocks the server). product-planner writes the plan from decision 21;
   server-development builds. M, then L. HELD.
9. **Gating bugs** (the draft table under "Open issues": #27, #441, #464, #682, #770, #335, #23, the verification
   issues, and any the re-read adds). bug-fixes and experience-design. M to L.
10. **The real calls and the co-editing test** (decisions 6, 16 and 22, #29, #30): a real call with two people on each
    device kind Thomas named (iPhone 13 Pro Max, iPad 12.9, Mac mini M4 and Windows 11, each with a browser still to be
    named), including a hosted server, and a real two-person co-editing test, run by Thomas or the people he
    names. Only after both pass does the `coediting` switch default flip (S, HELD, server-development). M. Cannot be
    checked in the cloud container or without a real LiveKit call.
11. **The legal track** (decisions 11 to 14 and 15): the licence inventory, the `LICENSE` file, terms, privacy, cookies,
    module author terms, the host admin statement, trademark, AI terms; content-manager drafts for the lawyer, the lawyer
    confirms in writing, Thomas signs. L. No tool checks this.
12. **The third-party contract** (decisions 7 and 10): the SDK and manifest version, the stability promise stating the
    call is not yet a module, the hello-world module (#46), the warning (#412). product-planner writes it;
    server-development and experience-design build. L. HELD (the SDK and the manifest).
13. **The accessibility and phone pass** on every "done" list. experience-design and quality-assurance. M each.
14. **Documents:** the release guide (install, update, rollback, backup, restore), the security and data pages, the
    module author page, `SECURITY.md`, the stale status lines, and the post-release rule for `CLAUDE.md` (decision 17,
    written by Thomas and content-manager). content-manager. M.
15. **Release rehearsal:** a clean install, an update from the earlier image with data (reading every older shape), and a
    restore from an older backup. quality-assurance. M.
16. **The release steps** above, version `1.0.0` (decision 4). The project manager and Thomas. S.
17. **Before the first customer:** the human penetration test on a hosted server and a fix round (decisions 8 and 11),
    the lawyer's written confirmation (decision 12), and a recorded two-person call on the hosted server. Thomas, an
    outside tester, the lawyer. M to L. Not checked by any tool here.

## Verify

- Steps 1 to 5 are checked by reading: every open issue has a mark, every module has a done list, the name has no mixed
  forms left (`check-names` stays as it is).
- Step 6: each finding has a check that failed before the fix and passes after, run by `npm run check`. The hostile
  cases are tried on a throwaway server with two environments, as `tools/check-links.mjs` does today. A real hosted
  domain and a real reverse proxy are not available here. That the host admin's password opens every environment is
  tried and then written in the docs; nothing else may do it.
- Steps 7 and 8: a script writes data in the oldest format, updates, and reads it; a copy exists before a migration; a
  restore from a backup onto a clean data folder; a kill during a write is simulated. A backup kept on another machine,
  and a hosted disk, cannot be checked from here.
- Steps 10 and 17 and everything that touches a call: only a real LiveKit call with real people can show it, on the
  four devices of decision 22 (iPhone 13 Pro Max, iPad 12.9, Mac mini M4, Windows 11), each in a browser Thomas still
  names, with the two people he still names. The
  co-editing two-person test also needs two real people. No check here can stand in for either.
- Step 11 is not verified by any tool. A lawyer's written confirmation is the check.
- `npm run check:docs` and `node tools/check-names.mjs` (as root it must end `check-names: 2 problems`) for every plan and
  document change.

## What is not decided

- The two people for the real call and the co-editing test, and the browser on each of the four devices (decision 22).
  The real-call and co-editing steps cannot be scheduled without them.
- The date the freeze starts, which sets the first review date (decision 19).
- The draft issue table: Thomas confirms or changes it, and the project manager reads the twelve issues whose body
  must be read.
- The per-module done lists, which are proposals until Thomas cuts or adds to them.
- Everything the lawyer decides, and who the lawyer is (decision 12).

## Open questions for Thomas

Questions 1 to 22 are answered (see "Decisions"). Two things are owed, and they block step 10 and the real call:

- Who are the two people for the real call and the co-editing test?
- Which browser on each of the iPhone 13 Pro Max, the iPad 12.9, the Mac mini M4 and Windows 11?

Neither blocks the freeze or the tag, since the release does not wait for the co-editing test (decision 22); both
block the real-call check before the first customer.
