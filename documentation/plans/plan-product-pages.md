# Product Pages Plan

**Audience:** Thomas, who decides what the product page says and how it splits; experience-design, who builds the
pages and draws the art; server-development, who serves the new addresses and checks them.

**Status:** superseded by [plan-product-site](plan-product-site.md) (built 2026-11-08, PR #447). The use pages (`/travel`, `/games`), the front page (`landing.*`), their screenshots, `PRODUCT_PAGES`, `livePages()` and `pages` in `GET /api/product` are removed; the product host now serves only the start page. Its steps 5 and 7 to 11 are not built; `/projects` was never started. What follows is the record of the earlier decision. Decided by Thomas, 2026-10-21; steps 1 to 4 were built the same day (see "Built so far"). Thomas: the product page is trying to be about
everything; "perhaps we make this product page about travel... another about gaming, etc." It follows on from the
product page redesign (GitHub #212) and waits, for its third use, on the project and mentoring template (GitHub #351).
The front page headline (decision 21), lede and meta description (decision 22) are decided.

**Where the pages live:** at `PRODUCT_DOMAIN`, the bare `BASE_DOMAIN` when it is unset; see [plan-domains](plan-domains.md).

## What it is today

- **One page.** `public/landing.html` (361 lines), `public/landing.css` and `public/landing.js`. The server sends it
  for `/` at the bare base domain only (`server/index.js`, the door, about line 2676), with a short allowlist of
  other paths (`BARE_BASE_PATHS`, the fonts, `/assets/images/brand/`). Without `BASE_DOMAIN` there is no product
  page: `/` is the one environment. See [architecture-environments](../architecture/architecture-environments.md).
- **What it holds, top down:** the hero ("For trips and game nights", "Plan the trip. Talk it through. Keep it all
  in one place.", the animated travel art: a map, a dotted route, a plane, a call and a day plan), Sign in, a
  four-screen tour of a Lisbon trip, What you get (five features and a list of ten modules), three use cards
  (trips, tabletop groups, and since `2f64c5b` teams and mentors), phones, How it works, Yours and private, Plans,
  Get started (the sign-up form), the footer.
- **Its own look.** A travel palette (`--l-*` on `.landing`, light sand and teal, dark night navy), left out of the
  colour checks by `OWN_PALETTE` in `tools/lib/drift.mjs`. Figtree for the text, Fraunces 600 on the `h1`.
- **What it fills in.** `landing.js` asks `GET /api/product` for the product's name (`PRODUCT_NAME`), the contact,
  the base domain, the plans and the host's **templates**. It fills every `data-product` element and sets
  `document.title` to the name. The sign-up form shows "Template" (None, then each template) and sends `template`
  to `POST /api/product/signup`.
- **Templates that exist.** One bundled template, `templates/travel.json` (version 6). It turns on Planner (`travel`,
  shown as "Itinerary"), Places, Maps, Research, Calendar, the chat and the call; Stream installs itself in every
  environment. It does **not** turn on Budget, Polls, To-do or the Assistant: an owner can, if the plan allows.
  **There is no gaming template**, bundled or otherwise, and no project template (#351).
- **The screenshots** (`public/assets/images/brand/landing/`, webp) were taken by hand from the seeded travel
  environment of `tools/shots-seed.mjs` (`e44b98c`); no script makes them. `tools/landing-preview.mjs` builds a
  folder copy of `landing.html` to look at without a server.

## Decisions

Thomas's. Those numbered 1 to 6 were stated earlier; 7 to 21 were made on 2026-10-21.

1. **The chat is the core; voice and video are the optional part.** The pages say it that way round.
2. **The Planner's copy is travel-only.** It belongs on the travel page, not on a general one.
3. **The hero animation stays,** and the plane flies nose first along the route, toward where the route ends.
4. **The page keeps its own palette and fonts:** `landing.css`, `OWN_PALETTE`, Figtree, Fraunces 600 on the `h1`.
5. **The template choice stays on sign-up,** filled from the host's templates.
6. **Not released:** no redirects, aliases or kept old paths. Configuration only in environment variables. A
   single-environment install (no `BASE_DOMAIN`) behaves as before: it has no product pages.
7. **Addresses:** `/travel`, `/games` and `/projects`. Short, easy to say aloud and to print; the bare base domain
   serves nothing else, so nothing collides.
8. **How the pages are made:** one plain HTML file per use (built as `public/travel.html`, `games.html` and
   `projects.html`, not `landing-<use>.html`), all sharing `landing.css` and `landing.js`. No build step, real text in the file, a real
   `<title>` and description per page, art inline as it is now. The use pages share little beyond the header and
   footer. The repeated header, footer and sign-in markup is compared across the files by a check.
9. **Sign-up from a use page** links to the front page's form with the template chosen (`/?template=travel#start`).
   One form, one copy of the code.
10. **A use page exists only while the host offers its template.** If a host hides or removes the template, the
    address answers 404 and the front page's card does not link to it. A host that edits the travel template still
    gets the travel page's words as written; the page describes the bundled template.
11. **The front page has no big hero picture.** The three use cards, each with its spot art, are the picture. The
    travel art and today's travel headline ("Plan the trip. Talk it through. Keep it all in one place.") move to
    `/travel`. Thomas will word a new chat-first front page headline; three options to pick from are under Open
    questions.
12. **The travel template turns on Budget, Polls and To-do too** (a new template version; server-development). The
    tour already sells Budget and a trip needs it. This amends [plan-environment-templates](plan-environment-templates.md)
    decision 10.
13. **Games: a gaming template is made first** (its own short plan, like #351: the space word, its modules, its
    phases), and then the games page, so the page and the sign-up agree.
14. **Games hero art:** experience-design drafts it, in the same flat style and palette as the travel art, and Thomas
    approves it before it is used.
15. **Words for games:** the page is called "Games" and the space word is "Campaign".
16. **The Planner is shown as "Itinerary" on `/travel`,** as the template shows it.
17. **Titles and descriptions only:** a `<title>` and `<meta name="description">` per page, written in the HTML.
    Sharing cards (Open Graph) stay out for now: they need an absolute image address and the product's name, which
    only the server knows (`BASE_DOMAIN`, `PRODUCT_NAME`), and a page cannot write the name (`check-names`). A server
    fill could add them later as a small piece of its own.
18. **The plane fix ships now, on its own,** before the restructure, as a separate commit (already assigned). It
    survives the move to `/travel`.
19. **Order:** the travel page, then the front page, then games, then projects after #351.
20. **Product page type:** the section headings (`h2`) use Fraunces 600, and the `b` element drops to weight 600, as
    the design system says. This is folded into the restructure (step 3 for `/travel`, then each page after). It
    amends decision 4, which named Fraunces 600 for the `h1` only. Today `landing.css` sets Fraunces on `.hero h1`
    alone (line 94); the `h2` is Figtree at 600 (line 39) and the `b` has no weight of its own, so it takes the
    browser's bold.
21. **The front page headline is C: "One place for the whole group."** The front page's hero text and its
    `<meta name="description">` are reworded around it, chat first and the call optional. Thomas, 2026-10-21. The
    supporting lede is decision 22.
22. **The front page lede and meta description are decided.** Thomas, 2026-10-21. Lede: "Chat all week, call when it
    counts, and keep the plans, the maps and the notes right beside it. Yours, on your own address." Meta description:
    "A private chat for your group, with a call when you want one and the tools beside it. Self-hosted, on your own
    address."

## Built so far

Recorded 2026-10-21.

- **Step 1, the plane:** `a0fe3e5`, the plane flies nose first along the route.
- **Step 3, `/travel`:** `34fc113` and `f638eee`, the travel content as `public/travel.html`.
- **Step 2, the server:** the routes for `/travel`, `/games` and `/projects`, `pages` in `/api/product` and
  `check-product-pages` (`39c709f`), with `019f908` making the use pages `public/travel.html`, `games.html` and
  `projects.html` and letting the check allow a page's own words.
- **Step 4, the travel template:** version 7, which adds Budget, Polls and To-do (`019f908`).

The files are `public/travel.html`, `games.html` and `projects.html`, not `landing-<use>.html`. Where the contract
below says `landing-travel.html` and so on, it means these.

## How the decisions apply

### What the front page keeps, and what moves

- **Front page keeps:** the header, a general hero (a chat-first headline and lede, no big picture), Sign in, the
  three use cards (each linking to its page once it exists), How it works, Yours and private, Plans, Get started,
  the footer.
- **Moves to `/travel`:** today's headline, the hero art, the tour, What you get, the phones band, the travel modules.
- **Games and projects** get the same sections in their own words, when their templates exist.
- **The module list** on each use page lists only that template's modules, with the others named once as "and more
  you can turn on". The front page drops the list.

### What each use page claims

- **Travel**, from `templates/travel.json` once decision 12 lands: the Itinerary (the Planner), Places, Maps,
  Research, Calendar, Budget, Polls, To-do, chat, the call, and Stream.
- **Games:** claims what the gaming template turns on, so its words wait for that template.
- **Projects and mentoring:** after #351, the same way.

### The pending fixes

- **Already done:** the chat-first wording of the hero's lede, the description, "A chat, and a call when you want
  one" (it was "Voice and video for the whole group, with a chat beside it", about line 177) and How it works
  (`0f9a79e`). It moves to `/travel` as written.
- **Ships now:** the plane flying nose first along the route (`landing.html` line 82; it sits at a fixed
  `rotate(-28)` while the route marches). Decision 18.
- **Folded into the restructure:** the eyebrow "For trips and game nights" and the hero's headline and lede (the
  front page gets new ones); labelling the Planner copy as travel-only (it moves to `/travel`, so no label is
  needed); the third use card from `2f64c5b` (kept, linking to `/projects` once that exists); "Voice and video that
  stays open between sessions" on the games card (rewritten chat-first with the games page).

### Documentation afterwards (for content-manager)

These lead with voice and video, against decision 1:

- `README.md` line 3 and `documentation/home.md` line 6 ("Voice and video for your tabletop game...").
- `public/admin.html` line 380, the host console's About ("Voice and video for a group..."); its next paragraph also
  says the travel template gives a Budget, which it does not until decision 12 lands.
- [architecture-environments](../architecture/architecture-environments.md), the bare base domain's paths;
  `userguide-getting-started.md` and `userguide-templates.md`, where they describe the product page; the comment
  in `tools/lib/drift.mjs` if more files join `OWN_PALETTE`; the design system's note on the product pages' type.

## The contract

### Server (server-development)

- At the bare base domain, `GET /travel`, `/games` and `/projects` send `public/landing-travel.html`,
  `landing-games.html` and `landing-projects.html`, each only while its paired template is among the host's
  offered templates (`templateChoices(null)`); otherwise 404, like any unknown path. One small table in
  `server/index.js` pairs each address with its file and template id.
- `GET /api/product` gains `pages: [{ path, template }]`, the use pages live on this host, so the front page links
  only those.
- Nothing changes without `BASE_DOMAIN`.
- `tools/landing-preview.mjs` copies every product page, not only `landing.html`.
- `templates/travel.json` turns on Budget, Polls and To-do, with a version bump.
- A check compares the shared header, footer and sign-in blocks across the product pages (decision 8).

### Pages (experience-design)

- `landing.html` becomes the front page. Each use card links to its page when `pages` lists it.
- `landing-travel.html`: today's travel content, chat first, the Planner named "Itinerary" as the person will see it,
  the module list from the template. Its Get started links to `/?template=travel#start`.
- `landing.js`: reads `?template=` and preselects that option when the host offers it (None otherwise); sets the
  title per page from an attribute on `<title>` (for example "Trips: <name>").
- All pages share `landing.css` and the palette. Each has its own title and description.
- `landing.css`: `h2` in Fraunces 600, `b` at weight 600 (decision 20).

## Left to build, in order

Sizes: small is a few hours of one builder, medium about a day, large more than a day. Thomas's order is travel,
front page, games, projects (decision 19).

| Step | What | Who | Size | Ready? |
| --- | --- | --- | --- | --- |
| 1 | The plane's direction, on its own, a separate commit | experience-design | small | Done: `a0fe3e5` |
| 2 | The addresses, `pages` in `/api/product`, the preview tool, the header and footer check | server-development | small | Done: `39c709f`, `019f908` |
| 3 | `/travel`: the travel content moved to its own page, with the `h2` and `b` type change | experience-design | medium | Done: `34fc113`, `f638eee` |
| 4 | The travel template adds Budget, Polls and To-do | server-development | small | Done: `019f908` |
| 5 | The front page cut down, its cards linking, the template preselected | experience-design | medium | Ready: 2 and 3 are done; the headline, lede and description are decided (decisions 21 and 22) |
| 6 | A gaming template plan, then its file | product-planner, then server-development | small, then small | Plan decided; template build ready. Nothing blocks the file. It uses three values Thomas has not yet confirmed (the remaining words, `opensWith`, `showMap` off; see [plan-template-games](plan-template-games.md)), and the Planner's travel wording is accepted for now. Steps 7 to 9 wait on this step, and on Thomas's approval of the art |
| 7 | The games hero art, drafted, then approved by Thomas | experience-design, Thomas | medium | Ready to draft, but its look should follow the template's words from 6 |
| 8 | A gaming seed for screenshots, and the shots | server-development, then experience-design | medium | After 6 |
| 9 | `/games` | experience-design | medium | After 6 to 8 and Thomas's approval of the art |
| 10 | `/projects`, the same way as 6 to 9 | as above | large in all | After #351 |
| 11 | The documentation | content-manager | small | After 5, and again after 9 |

Done: steps 1, 2, 3 and 4. Can start now: step 5 (the front page cut down) and step 6's template file (the plan is decided; three
values are still to confirm).

## Verify

- **Steps 1, 3, 5, 9:** in headless Chromium against a local server with `BASE_DOMAIN=localhost`: each page at
  light and dark, 1280 and 390 px; the plane's nose follows the route; the `h2` and `b` type; the template
  preselected from the address; the cards link only to live pages. The plane and the art are judged by eye, by
  Thomas.
- **Step 2:** checked by a tool: `tools/check-host-registry.mjs` or `tools/check-origin.mjs` gains cases for each
  address answering 200 with its template offered and 404 with it hidden, `pages` in `/api/product`, and no product
  page without `BASE_DOMAIN`; the shared-blocks check passes and fails on a changed footer.
- **Step 4:** `tools/check-templates.mjs` and a new environment from sign-up showing Budget, Polls and To-do.
- **Steps 6 and 8:** the template check; the seed run by `npm run shots`.
- Nothing here needs a real LiveKit call. The screenshots of the call column come from the shots tool's stub.

## What is not decided

### Open questions

1. **The gaming template (does not block the file; steps 7 to 9 follow it):** the plan is decided in
   [plan-template-games](plan-template-games.md). Three items remain **proposed, to confirm** there: the remaining
   words (owner = game master, aside = whisper, member = player, guest = guest), what a new campaign opens with (chat
   and Sessions), and `showMap` off.
2. **Whether the `h2` size and spacing change** with the new Fraunces weight. Decision 20 fixes the face and the
   weights only; experience-design reports what it needed to change.
