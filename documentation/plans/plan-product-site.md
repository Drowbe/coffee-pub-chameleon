# Product Site Plan

**Audience:** Thomas, who decides what the product site says, where people sign in and what is built; server-development,
who changes `server/`, the settings and the checks; experience-design, who draws the start page on the Prototype and
builds it; content-manager, who writes the product sheet and the documentation; quality-assurance, who checks each
slice; and the website session, which owns and builds the Chameleon page on `coffeepubstudio.com`, outside this
repository.

**Status:** drafted 2026-11-07. Thomas, 2026-11-07: "We need a way for this app to manage its own product site on the
main site. We will be doing two things: moving our current product site from here to
https://coffeepubstudio.com/products/chameleon; each product owner will be accountable for managing and updating their
own product area, leveraging the design system. On our site, the product pages will be removed and they will be
replaced with a functional page that will 1) have a link to the product page, and 2) let someone choose and log into
their specific environment, which should NOT be part of the product page. It will be our hook into the demo too."
Thomas answered four questions in chat the same day (decisions 1 to 4) and four more on 2026-11-07 (decisions 5 to 8).
Decisions 9 to 12 are the planner's suggestions, which Thomas said he will follow unless he objects; they are marked
that way and are not his decisions. One question is still open: the rename of `PRODUCT_DOMAIN` and `/api/product*`.
Nothing is built yet. Slice 0 can start when Thomas says.

**Known privacy issue, live today.** `GET /api/product/environments` lists every active environment on the host, by
address and name, to anyone. On 2026-11-07 it answered 200 with 5 environments at
`chameleon.coffeepubstudio.com`, and also at `admin.coffeepubstudio.live` and at an environment's own address
(`demo.coffeepubstudio.live`), because the route is registered on every host. Thomas chose to fix it inside this plan,
as its first build slice (decision 1), not ahead of it.

This plan supersedes [plan-product-pages](plan-product-pages.md) and answers question 5 of
[plan-domains](plan-domains.md) ("the app's front door as an environment chooser"). Where the domains plan says "front
door" or "product page", this plan says "start page" (decision 6).

## What it is today

On `origin/main` at `7bc8b2d`. Everything is in `server/index.js` (about lines 2794 to 2960) and `public/`.

**The live layout** (domains plan, "What changed on 2026-11-07"): `BASE_DOMAIN=coffeepubstudio.live` (environments at
`<slug>.coffeepubstudio.live`, the console at `admin.coffeepubstudio.live`), `PRODUCT_DOMAIN=chameleon.coffeepubstudio.com`
(the product host), and `coffeepubstudio.com` is the studio's website, which this app does not serve.

**What the product host serves.** The door (`server/index.js`, the resolver that picks a branch by host name) sends the
product host only these:

| Route | What it is | Kind |
|---|---|---|
| `/` (`public/landing.html`, `landing.js`, `landing.css`) | Hero, the three uses, Sign in, How it works, Yours and private, Plans, Get started (the sign-up form) | Marketing, except Sign in and sign-up |
| `/travel`, `/games` (`PRODUCT_PAGES`, `livePages()`) | Use pages, each live only while the host offers its template; `projects.html` was never made | Marketing |
| `public/assets/images/brand/landing/` | 14 screenshots, taken by hand | Marketing |
| `GET /api/product` | `{ name, productShortName, contact, baseDomain, productDomain, version, signup, plans, templates, pages }` | Functional, except `pages` |
| `GET /api/product/environments` | Every active or past-due environment, `{ slug, name }`, for the Sign in dropdown | Functional; the privacy issue above |
| `GET /api/product/environment?slug=` | One environment's name, or 404 | Functional |
| `GET /api/product/address?slug=` | Sign-up's address check, 120 a minute per address | Functional |
| `POST /api/product/signup` | A free-plan environment from a template; off unless `SIGNUP=on` (live: off) | Functional |
| `/design-system/*`, `/sdk/*`, `DESIGN_SYSTEM_FILES` | The app's own design-system pages (Design System, Proposed, Prototype, Legacy), public | A team tool that sits on this host |

**How Sign in works today.** `landing.js` fills a dropdown from `GET /api/product/environments`. Choosing one shows a
login and password, and the form posts them across sites to `https://<slug>.<base>/login`. That route (`POST /login`,
a form post) exists only for this: the environment's own sign-in page uses `POST /api/login`. Because the post comes
from another site, `POST /login` is the one path exempt from the same-origin rule (`CROSS_ORIGIN_EXEMPT` in
`server/index.js`). A failed post comes back to `/login?error=1&login=<login>`.

**The recent shortcut.** Every sign-in sets the `env_hint` cookie (`setEnvHint()`, up to 5 addresses) on
`Domain=<BASE_DOMAIN>`. The product host is on another site (`.com` against `.live`), so it cannot read it, and
`landing.js` already skips it there (domains decision 11). On Thomas's install nothing reads `env_hint` today.

**Other code that knows about the product pages:**
- `public/admin.js` (about line 2530): Manage's Upgrade link goes to `<productDomain>/#plans`.
- `public/host.js` (`renderFacts`): the console's facts line "Product pages".
- Checks: `tools/check-origin.mjs` and `tools/check-host-registry.mjs` (cases that read `landing.html` and `travel.html`,
  and the `POST /login` exemption), `tools/check-product-pages.mjs` (and its place in `npm run check`),
  `tools/check-system-css.mjs` (the `landing.css` font test), `tools/check-buttons.mjs` (skips `.landing` selectors).
- `OWN_PALETTE` in `tools/lib/drift.mjs`, which `check-drift-scope`, `check-radius`, `check-breakpoints`,
  `check-type-scale` and `check-no-raw-colours` use; `check-radius` has its own `landing.css` entry.
- `tools/landing-preview.mjs`.
- `public/design-system/ds.js`, `tools/design-system-snapshot.mjs` and `public/design-system/sources.js` load
  `landing.css`.
- Five entries in `tools/check-names-allow.json` (`landing.html`, `travel.html`, `games.html`, `landing.js`, and the
  games page's word for its Lobby).

**The website already has a stale copy.** `https://coffeepubstudio.com/products/chameleon` says "Coming soon", names
the retired address `collaborator.coffeepub.ai` twice, and uses copies of our screenshots under `/assets/collaborator/`
(read 2026-11-07). The drift this plan is meant to stop has already started.

**The demo.** The demo loader ([plan-demo-space](plan-demo-space.md), GitHub #416, slice 1) is merged, and a `demo`
environment exists on production. The routes (slice 4), the demo flag and the shared `demo` login (slice 6) and the
nightly reset (slice 7) are not built.

**The screenshot tool.** `npm run shots` (`tools/shots.mjs`) seeds its own data from `tools/shots-seed.mjs`, not from
the demo data file, and writes outside git. It has two tiers, `core` and `state`. The website's screenshots so far came
from an ad hoc branch, `pm/website-screenshots`, "branch only, never main".

**Checks with a gap.** `tools/check-brand-hosts.mjs` looks for the brand followed by a top-level domain
(`coffeepub\.[a-z]{2,}`). That does not match `coffeepubstudio.com` or `coffeepubstudio.live`, so the guard misses both
new domains. Nothing in the searched folders names them today.

## Why

- The marketing on the product host is about nine tenths of what it serves, and it is already drifting from the
  website's copy. One page in one place, owned by the product owner, ends that.
- A person who wants to sign in should not have to pass through a product page, and should not be shown everyone
  else's environments to do it.
- The demo needs one public way in.
- A self-hoster with `BASE_DOMAIN` set stops serving Coffee Pub's marketing on their own host. They get a plain start
  page named by `PRODUCT_NAME`. A single install (no `BASE_DOMAIN`) never had product pages and does not change.

## Decisions

Thomas's, in chat, 2026-11-07.

1. **The public list of every environment is fixed inside this plan, as its first build slice,** not ahead of it. It
   is recorded here as a known privacy issue until then. Reason: one plan for everything the front door does.
2. **The start page stays on `chameleon.coffeepubstudio.com`.** A person finds their environment by **typing its
   address**, in a field that shows `.coffeepubstudio.live` after it (the base domain, from `GET /api/product`). The
   page also **remembers its own recent environments in its own browser storage**, so it only knows the ones a person
   reached through it. No email link and no shared sign-in across environments now. Reason: there is no email sending
   and no email on accounts, and the host deliberately does not know who anyone is (accounts live inside each
   environment). Both stay out of scope until Thomas asks. Not decided: the Public Suffix List registration of
   `coffeepubstudio.live`, and moving the start page to the bare `coffeepubstudio.live`.
3. **The start page takes no password.** It only sends people on to their environment's own sign-in page. The
   cross-site post of the login and password is removed. Reason: people should not learn to type an environment's
   password on another domain.
4. **Product facts reach the website two ways:**
   - a **product sheet** in this repository's documentation, owned by content-manager and published to the wiki. Every
     claim links to a user guide, and it lists what is not built.
   - the live **`GET /api/product`**, read when the website is built, never in the browser.

   The website session owns and builds the page with the studio's design system (`https://coffeepubstudio.com/design-system`).
   The product owner, Thomas, approves the words. Screenshots come from the demo data, through a new `npm run shots`
   tier, handed over and never committed to main.

Thomas's, in chat, 2026-11-07 (second round).

5. **"Try the demo" opens the demo environment's own sign-in with the login filled in (`?login=demo`),** and the start
   page shows the public demo password beside the button. Two steps, no cross-site post and no exemption. There will be
   one demo per template later (travel now; a games demo environment when its demo file exists, since one environment
   holds one template). The button is shown only once #416 slices 4, 6 and 7 exist. Reason: decision 3 keeps passwords
   off the start page's own form.
6. **The page is called the "start page"** (`start.html`, `start.js`). Names in code stay as they are until Thomas
   decides otherwise: `PRODUCT_DOMAIN`, `/api/product*` and the rest are not renamed by this decision.
7. **The start page uses the app's own design system,** in the Chameleon theme once it is built (rename plan step 5),
   the default theme until then. The `OWN_PALETTE` exception goes. Reason: one look for the app's own pages.
8. **The order: the website's product page is brought up to date first (slice 2), then the app's marketing pages are
   removed (slice 5).** Reason: visitors never see "Coming soon" and a retired address.

Not answered by Thomas. The project manager told him he will follow the planner's suggestions unless he objects. Each is
a **suggestion, followed unless Thomas objects**, not a decision.

9. **Upgrade points at a short plans list on the start page** (`#plans`). A self-hosting buyer's plans are their own, so
   the website cannot hold them. *Suggestion, followed unless Thomas objects.*
10. **The app's own design-system pages stay public on the host** (`/design-system/`, with the Prototype). Out of scope.
    *Suggestion, followed unless Thomas objects.*
11. **`env_hint` is kept** until the Public Suffix List and bare-domain questions are decided. Registering the domain
    would end it anyway, and moving the start page would want it. Slice 4 leaves it as it is. *Suggestion, followed
    unless Thomas objects.*
12. **The `check-brand-hosts` pattern is widened** to the brand followed by any letters and a top-level domain, rather
    than naming the two domains (naming them in the check would put them in code). *Suggestion, followed unless Thomas
    objects.*

## What the start page is

A plain page at the product host's `/`. It is not a product page and sells nothing. It does five things:

1. **Find your environment.** A field for the address, with `.<baseDomain>` shown after it, and Go.
2. **Recent.** The environments this browser reached through this page, newest first, each one click.
3. **Got a link?** One line for guests and invited people: a space's guest link or an invite opens on its own; there is
   nothing to choose here.
4. **Get your own.** Sign-up when it is open; otherwise the contact link, or "Coming soon" without one.
5. **About the product.** A link to the product page on the website, when `PRODUCT_SITE_URL` is set.

Later, once the demo exists: **Try the demo** (slice 6). Plans is a sixth part: a short list of the host's plans
(decision 9).

It never lists environments it was not given, never takes a password, and has no marketing copy, screenshots or use
pages. It uses the app's own design system (decision 7). How it looks is drawn on the Prototype first and locked by Thomas (slice 3).

## The contract

### Settings

- **`PRODUCT_SITE_URL`** (new): the address of the product's page on the website, for the start page's link. An
  absolute `https://` or `http://` address. Unset means no link. A value that is not such an address is refused at
  start with one sentence, as a bad `PRODUCT_DOMAIN` is. Never written in code; examples use `example.com`. Thomas's
  value is `https://coffeepubstudio.com/products/chameleon`, set in his compose file.
- `PRODUCT_DOMAIN`, `BASE_DOMAIN`, `SIGNUP`, `CONTACT_EMAIL` and `PRODUCT_NAME` are unchanged (their names are Open
  question 1).
- Without `BASE_DOMAIN` nothing in this plan applies: `/` is the one environment, as today.

### Server (server-development)

**Routes kept, at the product host:**
- `/` sends the start page (`public/start.html`) instead of `landing.html`.
- `GET /api/product`, trimmed: `pages` is removed. It gains `productSiteUrl` (the setting, or `null`). Later it gains
  `demo` (slice 6). Public, no session, no CORS needed (the website reads it from its build, not a browser).
- `GET /api/product/environment?slug=`: `{ slug, name }` for an active or past-due environment, 404 for anything else.
  The start page's Go and its recent list use it. It reveals only what visiting the address would.
- `GET /api/product/address?slug=` and `POST /api/product/signup`, as today.
- The design-system pages, `/sdk/*` and the fonts, as today (decision 10).
- The product host's allowed paths (`PRODUCT_HOST_PATHS`) become exactly what the start page loads.

**Routes removed, cleanly, with no redirects:**
- `GET /api/product/environments`, from all three places it is registered (`hostRouter`, the product host's allowed
  paths, and `app`), with `productEnvironments()`. Every host answers 404 afterwards.
- `/travel`, `/games`, `PRODUCT_PAGES` and `livePages()`.
- `/landing.css` and `/landing.js` from the allowed paths; `/assets/images/brand/` kept only for what the start page
  loads.
- `POST /login` (the form route) and `CROSS_ORIGIN_EXEMPT`: with no cross-site post, nothing calls it, and every write
  falls under the same-origin rule. The `?error=1` return goes with it. The `?login=` fill on the sign-in page stays,
  because sign-up's answer uses it (`/login?login=<owner>`). The demo needs no cross-site post (decision 5).

**Other server changes:**
- `GET /api/host/settings` (the console) carries `productSiteUrl`, for the facts line.
- `tools/check-brand-hosts.mjs`: the pattern also catches the brand followed by more letters and a top-level domain
  (so `coffeepubstudio.com` and `coffeepubstudio.live` fail), and its self-test plants both. Today no file needs an
  allow-list entry for them.
- The start page's recent list is the page's own: the server stores nothing for it. `env_hint` is not read by the
  start page and is kept (decision 11).

**Removed with the pages (slice 5):** `tools/check-product-pages.mjs` and its place in `npm run check`;
`tools/landing-preview.mjs`; the `landing.html` and `travel.html` cases in `check-origin` and `check-host-registry`,
and the `POST /login` exemption cases in `check-origin` (replaced by a case that `/api/product/environments` is 404 and
that a cross-site `POST /login` is refused); the `landing.css` entries in `OWN_PALETTE`, `check-radius`,
`check-system-css`, `check-buttons`, `ds.js` and `design-system-snapshot.mjs`, then `sources.js` regenerated; the five
`check-names-allow.json` entries. The start page uses the app's own system (decision 7), so the `OWN_PALETTE`
exception goes entirely.

### Pages (experience-design)

- **`public/start.html` and `start.js`** (names in code stay as they are, decision 6), from the locked Prototype. What a person sees:
  - The product's name from `GET /api/product` (`name`), never written in the file.
  - **Find your environment:** one text field, the suffix `.<baseDomain>` shown after it, and Go. Go cleans the text
    (lower case, spaces trimmed; a full address pasted in is cut to its first label), asks
    `GET /api/product/environment?slug=`, and on 200 opens `https://<slug>.<baseDomain>/login` in the same tab, with
    the request's port kept as sign-up's answer keeps it. On 404 it says "There is nothing at that address. Check the
    spelling." and keeps the text. It never says why (suspended and unknown look the same).
  - **Recent:** written to the page's own browser storage when Go succeeds and after a successful sign-up; up to 5,
    newest first, `{ slug, name }`; a key named by kind (for example `app.recentEnvironments`), never by the product.
    Each row opens that environment's sign-in. Each row can be removed, for a shared computer. Hidden when empty. A
    row whose environment now answers 404 is dropped when chosen, with the same sentence as Go.
  - **Got a link?** One sentence, no control.
  - **Get your own:** the sign-up form when `signup` is true, with the template choice (product pages decision 5) and
    `?template=<id>` preselecting one; otherwise the contact `mailto:` when `contact` is set, else "Coming soon".
  - **About:** a link to `productSiteUrl`, hidden when it is `null`.
  - **Plans:** a short list of the host's plans (decision 9). Fixed anchor `#plans`.
  - **Try the demo:** not in the page until slice 6. It opens the demo environment's sign-in with `?login=demo` and shows
    the public demo password beside it (decision 5).
  - Fixed anchors the website links to: `#start` (sign-up) and `#demo` (slice 6). They do not change without telling
    the website session.
- No password field anywhere on the page.
- Manage's Upgrade link (`public/admin.js`) and the console's facts line (`public/host.js`: "Start page" and "Product
  site") follow decision 9: Upgrade goes to `#plans` on the start page.

### The product sheet (content-manager)

- A published page in `documentation/` (the user guides folder is the only published folder it fits; for example
  `documentation/userguides/userguide-product-sheet.md`, content-manager chooses the name).
- What Chameleon does today, one line per claim, each linking to the user guide that describes it.
- A "Not built" section: what the product does not do yet.
- A date, changed whenever a release changes a claim, so the website session knows to look.
- A check (server-development, `tools/check-product-sheet.mjs`, in `npm run check`): every claim line has a link to a
  user guide that exists, and every module the sheet names is a bundled module.

### Screenshots for the website (server-development)

- A new tier in `tools/shots.mjs` (for example `product`) that seeds its throwaway server with the demo data file
  through the demo loader, instead of `tools/shots-seed.mjs`, and photographs the screens the website uses.
- The shots clock (2026-10-15) makes the demo's dates, which are offsets from today, the same in every run.
- Files named by kind (`planner-1280-light.webp`), showing `PRODUCT_NAME`'s value, written outside git (`--out`), and
  handed to the website session. Never committed to main.

### The website (the website session, outside this repository)

- Owns `coffeepubstudio.com/products/chameleon`: its components, the brand kit, the voice and the build.
- Reads the product sheet and `GET https://<product host>/api/product` when the site is built: `name`, `version`,
  `signup` (decides "Coming soon"), `plans`, `templates`, `baseDomain` (the address shape it shows), and later `demo`.
- Links to the start page (`/`, `#start`, `#demo`). It does not sign anyone in.
- Thomas approves its words.

## Left to build, in order

Each slice is built and checked on its own. Thomas names the kind of build for each.

| # | Slice | Agent | Needs | Blocked by |
|---|---|---|---|---|
| 0 | **The privacy fix and the no-password sign-in.** Remove `GET /api/product/environments` everywhere; the landing page's Sign in becomes the typed address and Go (no dropdown, no password); remove `POST /login` and `CROSS_ORIGIN_EXEMPT`; close the `check-brand-hosts` gap | server-development, then experience-design | Thomas's go. Small. The landing page it changes is deleted in slice 5; this ships first because the issue is live | Nothing |
| 1 | **Facts for the website.** The product sheet; its check; the `product` shots tier from the demo data | content-manager (the sheet), server-development (the check and the tier) | The demo loader (done) | Nothing |
| 2 | **The website page brought up to date** from the product sheet, the shots and `/api/product` | the website session; Thomas approves the words | Slice 1 | Outside this repository |
| 3 | **The start page on the Prototype.** The five parts above, in the chosen look; Thomas locks it | experience-design | Slice 0 | Nothing |
| 4 | **The start page built and served.** `start.html` and `start.js` from the lock; `/` sends it; `PRODUCT_SITE_URL` and `productSiteUrl`; `pages` removed from `/api/product`; the console's facts line; Upgrade re-pointed | experience-design, server-development | Slice 3 locked | Open question 1, only if Thomas renames `PRODUCT_DOMAIN` now |
| 5 | **The marketing pages removed.** `landing.*`, `travel.html`, `games.html`, the screenshots folder, `PRODUCT_PAGES`, `livePages()`, and the checks, tools and allow-list entries listed under the contract | server-development, experience-design | Slices 2 and 4 | Nothing |
| 6 | **The demo hook.** `/api/product` gains `demo` from the environment with the demo flag; the start page's Try the demo at `#demo`; the website links it | server-development, experience-design | #416 slices 4, 6 and 7 | Nothing |
| 7 | **Documentation.** architecture-environments (the door's product-host branch, the start page, the removed routes), userguide-getting-started, userguide-settings-reference (`PRODUCT_SITE_URL`), userguide-templates and userguide-environments (where they describe the product page), the compose file's comment (`PRODUCT_SITE_URL` with an `example.com` value), the CHANGELOG, and the status lines of the superseded plans below | content-manager | Slices 4 and 5 (and again after 6) | Nothing |

Slices 0 and 1 can run beside each other. QA after each slice of a production build, with a security read on slice 0
(the removed route, the removed exemption) and slice 6 (a public login).

**Plans that become records** (content-manager updates their status lines in slice 7): [plan-product-pages](plan-product-pages.md),
superseded, including its step 5 (the front page cut down); steps 7 to 9 of [plan-template-games](plan-template-games.md)
(the games art, seed and page); the rename plan's question "do the app's product pages lead like the website" (moot:
there are none); the domains plan's question 5 (answered here) and its decision 11 (still true: the start page does not
read `env_hint`).

**The index lines** (content-manager's): in `documentation/TODO.md`, under "Hosting and environments", add
`- The product site: the start page, the product sheet and the demo hook ([plan-product-site](plans/plan-product-site.md)). Slice 0 removes the public list of every environment, which is live today.`
If a known-issues entry is wanted for the public list until slice 0 lands, that is content-manager's too.

## Verify

- **Slice 0.** By tool: `check-origin` gains cases that `GET /api/product/environments` is 404 at the product host, the
  console and an environment's address; that a cross-site `POST /login` is refused (or 404) and that `POST /api/login`
  still signs in; `check-brand-hosts`' self-test plants `coffeepubstudio.com` and `coffeepubstudio.live` and both fail.
  Live, on a local server with `BASE_DOMAIN=localhost` and `PRODUCT_DOMAIN` set, in headless Chromium: typing a known
  address opens its sign-in; an unknown one shows the sentence. After deploy, a `curl` to the live route returns 404
  (Thomas or the project manager).
- **Slice 1.** By tool: the product sheet check passes and fails on a planted line with no link and on a module that
  is not bundled. The shots tier runs twice and gives the same images (`npm run shots:compare` on the tier).
- **Slice 2.** Outside this repository; Thomas reads the page.
- **Slice 3.** By tool: `check-prototype-page`, `check-prototype-words`, `check-prototype-parity`. By eye: Thomas.
- **Slice 4.** Live, headless Chromium against a local server with `BASE_DOMAIN=localhost`: the start page at 1280
  and 390 px, light and dark; Go, the recent list (written, reused, removed, a stale row dropped), sign-up landing on
  the new environment's sign-in with the login filled, the About link shown only when `PRODUCT_SITE_URL` is set. By
  tool: `/api/product` has `productSiteUrl` and no `pages`; a bad `PRODUCT_SITE_URL` refuses to start; a single
  install with `PRODUCT_SITE_URL` set behaves as before.
- **Slice 5.** By tool: `npm run check` passes with the files gone (as root, the two known `--migration` cases of
  `check-names` fail and are not a defect); `/travel` and `/games` are 404; `check-names` finds nothing new.
- **Slice 6.** By tool: `demo` is absent while no environment has the demo flag, and present with one. Live: the
  button reaches the demo's signed-in Home.
- **What cannot be checked here.** There are no real domains locally. Going from `chameleon.coffeepubstudio.com` to
  `<slug>.coffeepubstudio.live` and signing in, in **Chromium, Firefox and Safari**, has never been checked and must be
  checked by hand on the live install after slices 0 and 4, and after slice 6 for the demo. The browser's storage
  for the recent list is per site, so it is checked on the real host too. No real LiveKit call is involved in any slice.

## Risks

1. **The public list is live until slice 0 ships.** Five environments are listed today, at every host.
2. **Slice 0 removes `POST /login`.** Anyone who saved the old product page's form, or a script that posts it, stops
   working. The product is unreleased, so this is allowed.
3. **The demo button before the demo flag and the nightly reset** would be a public login whose password could be
   changed. Slice 6 waits for #416 slices 6 and 7.
4. **The website's claims drifting** again. The product sheet's date and the build-time read of `/api/product` are the
   guard; neither forces the website to rebuild.
5. **Removing the pages before the website's page is current** leaves visitors with "Coming soon" and a stale address.
   Slice 5 waits for slice 2 (decision 8).
6. **The recent list on a shared computer** shows the next person which addresses were used. It names no person, and
   each row can be removed.
7. **The demo adds traffic to a public login that can post and upload** (demo plan decision 12, an accepted risk). The
   existing per-environment login limiter and the demo environment's plan caps are the limits.
8. **Cross-browser sign-in across `.com` and `.live`** is unchecked (Verify).

## What is not decided

### Open questions

1. **Renaming `PRODUCT_DOMAIN` and `/api/product*`,** now that no product pages live there. Domains decision 15 kept the
   name; the no-compatibility rule allows a clean rename. Decision 6 leaves them as they are. *Suggestion: Thomas's
   call; if renamed, do it in slice 4, with `PRODUCT_SITE_URL` named to match.* Blocks nothing now; it would block
   slice 4's setting names if Thomas renames.

### Undecided and out of scope

- Registering `coffeepubstudio.live` on the Public Suffix List (domains plan, question 7), and moving the start page
  to the bare `coffeepubstudio.live` (a configuration change: unset `PRODUCT_DOMAIN`). They are linked: the move only
  helps through `env_hint`, which registration would end.
- An email link, and one sign-in that finds all of a person's environments (decision 2). They need a mail service, an
  email on every account and a host-wide index of people, against the current architecture. Out of scope until Thomas
  asks.
- A throwaway environment per demo visitor. Not planned by #416.
- Which design system "leveraging the design system" means: the website page uses the studio's (decision 4); the
  start page uses the app's own (decision 7).
