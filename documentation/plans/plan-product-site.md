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
that way and are not his decisions. Thomas, 2026-11-08, looked at the start page on the Prototype (slice 3) and said "I
like all the A options" (decisions 13 to 18). That changes the Go contract (decision 15) and adds a server slice, 3a
(decision 17). Two things are open: the rename of `PRODUCT_DOMAIN` and `/api/product*`, and the design of the first
password (slice 3a), which needs a security read.

**Built, 2026-11-08:** slices 4 and 5, on main in b7fb8cc (PR #447, a try build for Thomas's review), together with the
first-password work of slice 3a. The start page is `public/start.html`, `start.js` and `start.css`; the old front page,
`/travel`, `/games`, `PRODUCT_PAGES`, `livePages()`, the screenshots folder, `check-product-pages` and `landing-preview`
are gone; `GET /api/product` has no `pages` and gains `productSiteUrl`; `PRODUCT_SITE_URL` is read at start; the console's
facts show **Start page** and **Product site**; the product host's `/theme.css` sends the bundled default theme; and the
start page's product name uses the new `--brand-coral` token. The checks are `tools/check-start-page.mjs` and the
changed cases of `check-origin`. **Not built:** slice 6, the demo hook (`/api/product` has no `demo`, the page has no
**Try the demo**). **Not done from slice 4:** Manage's **Upgrade** link still points at `<productDomain>/#plans`
(`public/admin.js`), and the start page has no Plans list for it to reach. Slice 7, the documentation, is written for
slices 4 and 5 and needs another pass after slice 6. Slices 1 and 2 are outside this record.

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

Thomas's, 2026-11-08, after looking at the start page on the Prototype: "I like all the A options." Each is the
Prototype's own option A (its Choices section).

13. **The layout is one column, 480px wide, at every width** (A). Not two columns from 900px. Reason: the page is a
    doorway; almost everyone comes to type an address, and one column reads the same on a phone.
14. **Recent sits above the address field** (A). The builder had recommended B (below the field); Thomas chose A. Reason:
    a returning person's one click comes first. When there is no Recent, it is not drawn at all (no empty box), and the
    address field is the first thing on the page.
15. **The address is checked as you type** (A), after a short pause, and the environment's name shows before Go. This
    **changes the Go contract** (see the contract below): Go is always enabled; Enter or Go before the name is found
    waits for the check, then goes. Reason: a wrong address is caught on this page, not on a sign-in page that is not
    the person's.
16. **The sign-up form is shown open** (A), not folded behind a button (the builder had recommended B). Reason: Thomas
    prefers it visible; the website's `#start` link lands on it either way.
17. **The owner's password is not asked on the start page** (A). The new environment's own page asks for it first.
    **This needs a server change** (slice 3a): sign-up's answer must carry a safe way to set the first password on the
    environment's own page. Its design is decided and built on a branch held for Thomas's merge (Open questions 2). Reason: it keeps decision 3 whole (no password on
    the start page, not even a new one).
18. **The other Prototype notes stand:** the words, the states, the keyboard order, Recent kept in the browser only
    (up to 5, each row removable) and the page not being a list, a password box, marketing or an account.

## What the start page is

A plain page at the product host's `/`, one 480px column at every width (decision 13). It is not a product page and
sells nothing. It does five things, in this order:

1. **Recent.** The environments this browser reached through this page, newest first, each one click. Above the address
   field (decision 14); not drawn when there are none.
2. **Find your environment.** A field for the address, with `.<baseDomain>` shown after it, and Go. The address is
   checked as the person types, and the environment's name shows before Go (decision 15).
3. **Got a link?** One line for guests and invited people: a space's guest link or an invite opens on its own; there is
   nothing to choose here.
4. **Get your own.** Sign-up when it is open, the form shown open and asking for no password (decisions 16 and 17);
   otherwise the contact link, or "Coming soon" without one.
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
  The start page calls it **as the person types** (debounced), and again for Go and for a stale Recent row. It reveals
  only what visiting the address would. It needs the same limit as the address check: the slice 0 fix-up adds 120 a
  minute to this route, and a request over it answers 429 with the one sentence below. The page must stay inside the
  limit (Pages).
- `GET /api/product/address?slug=`, as today. `POST /api/product/signup`, as today except the owner's password: it no
  longer takes one, and its answer carries the first-password step (slice 3a, Open questions 2).
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
  - **Recent** (first, above the field, decision 14): written to the page's own browser storage when Go succeeds and
    after a successful sign-up; up to 5, newest first, `{ slug, name }`; a key named by kind (for example
    `app.recentEnvironments`), never by the product. Each row opens that environment's sign-in. Each row can be
    removed, for a shared computer. Not drawn at all when empty. A row whose environment now answers 404 is dropped
    when chosen, with the same sentence as Go.
  - **Find your environment** (decision 15): one text field, the suffix `.<baseDomain>` shown after it, and Go. The
    text is cleaned (lower case, spaces trimmed; a full address pasted in is cut to its first label). After a short
    pause in typing the page asks `GET /api/product/environment?slug=`. On 200 it shows the environment's name before
    Go. On 404 it says "There is nothing at that address. Check the spelling." and keeps the text. It never says why
    (suspended and unknown look the same). **Go is always enabled** (it is off only while a go is in progress). Go, or
    Enter in the field, with the name found opens `https://<slug>.<baseDomain>/login` in the same tab, with the
    request's port kept as sign-up's answer keeps it. Pressed before the name is found, it waits for the running check
    and then goes (or says the sentence on 404); after an error it tries again.
  - **Staying inside the limit.** Debounce the typing (about 400 ms), ask only for a shape that can be an address
    (the same shape test the sign-up check uses), send at most one request at a time and drop an answer that is not
    for the text now in the field, and keep every answer (found or not) for the page's life so the same text is never
    asked twice. Go uses the kept answer. When the route answers 429 the page says "Too many tries. Wait a minute, then
    try again.", stops asking as the person types, and lets Go ask once when the person presses it.
  - **Got a link?** One sentence, no control.
  - **Get your own:** the sign-up form when `signup` is true, shown open (decision 16): the address (checked as the
    person types, as today), the environment's name, the template choice (product pages decision 5) with
    `?template=<id>` preselecting one, the owner's login and an optional display name. **No password field**
    (decision 17): on success the page saves the environment to Recent and opens what sign-up's answer says (slice 3a).
    Otherwise the contact `mailto:` when `contact` is set, else "Coming soon".
  - **About:** a link to `productSiteUrl`, hidden when it is `null`.
  - **Plans:** a short list of the host's plans (decision 9). Fixed anchor `#plans`.
  - **Try the demo:** not in the page until slice 6. It opens the demo environment's sign-in with `?login=demo` and shows
    the public demo password beside it (decision 5).
  - Fixed anchors the website links to: `#start` (sign-up) and `#demo` (slice 6). They do not change without telling
    the website session.
- No password field anywhere on the page, including sign-up (decisions 3 and 17).
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
| 3 | **The start page on the Prototype.** The five parts above, in the chosen look. Drawn; Thomas chose the A options on 2026-11-08 (decisions 13 to 18). Anything else Thomas wants changed is a new round on the Prototype | experience-design | Slice 0 | Nothing (done, pending the lock's wording) |
| 3a | **The first password at the environment's own page.** Sign-up no longer takes the owner's password; its answer carries a one-time way to set it on the new environment's own sign-in page (decision 17). Also the 120 a minute limit on `GET /api/product/environment` (the slice 0 fix-up, if not already there). Then QA with a security read | server-development, then quality-assurance | Open question 2 decided (it is) | **Built on the branch `pm/first-password-server`, held for Thomas's merge:** sign-up takes no password, the one-time link, the page, the console's "New first-password link", the checks, two independent security reads with their fixes. Waits for the merge; the fragment through the real domains and a proxy is not verified. **Blocks slice 4's sign-up part until merged** |
| 4 | **The start page built and served.** `start.html` and `start.js` from the lock, to the Prototype's A options (decisions 13 to 16); `/` sends it; `PRODUCT_SITE_URL` and `productSiteUrl`; `pages` removed from `/api/product`; the console's facts line; Upgrade re-pointed. Everything but sign-up can be built first; sign-up waits for slice 3a | experience-design, server-development | Slice 3 locked (done 2026-11-08, the A options); slice 0 (the typed address's limit); slice 3a for sign-up | Open question 1, only if Thomas renames `PRODUCT_DOMAIN` now; slice 3a for sign-up. **Built** (see Status), except the Upgrade re-point |
| 5 | **The marketing pages removed.** `landing.*`, `travel.html`, `games.html`, the screenshots folder, `PRODUCT_PAGES`, `livePages()`, and the checks, tools and allow-list entries listed under the contract | server-development, experience-design | Slices 2 and 4 | Nothing. **Built** (see Status) |
| 6 | **The demo hook.** `/api/product` gains `demo` from the environment with the demo flag; the start page's Try the demo at `#demo`; the website links it | server-development, experience-design | #416 slices 4, 6 and 7 | Nothing. **Not built** |
| 7 | **Documentation.** architecture-environments (the door's product-host branch, the start page, the removed routes), userguide-getting-started, userguide-settings-reference (`PRODUCT_SITE_URL`), userguide-templates and userguide-environments (where they describe the product page), the compose file's comment (`PRODUCT_SITE_URL` with an `example.com` value), the CHANGELOG, and the status lines of the superseded plans below | content-manager | Slices 4 and 5 (and again after 6) | Nothing. **Written for slices 4 and 5** |

Slices 0 and 1 can run beside each other. QA after each slice of a production build, with a security read on slice 0
(the removed route, the removed exemption), slice 3a (the first password and its token, sign-in is security-sensitive)
and slice 6 (a public login).

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
- **Slice 3a.** By tool, in `check-origin` or a new check by server-development: sign-up with a password field is
  ignored or refused (as decided); the token (or setup state) works once, fails the second time, fails after its
  lifetime, fails for another environment and another login, is not in any log line, any stored file in clear text or
  any later response; the environment cannot be signed in to by any other way before the first password is set; a
  wrong or missing token never reveals whether the login exists; the set-password step enforces the same password
  rules as today; the limit on the exchange holds. Live on a local server (`BASE_DOMAIN=localhost`): sign up, land on
  the choose-a-password step, set it, sign in. QA reads the code for the security points (nothing here can be
  verified against real domains).
- **Slice 4.** Live, headless Chromium against a local server with `BASE_DOMAIN=localhost`: the start page at 1280
  and 390 px (one 480px column at both), light and dark; Recent above the field and not drawn when empty; the name
  shown as the address is typed; Enter before the name is found waits and then goes; typing fast asks once (debounce)
  and the same text is not asked twice; a 429 shows the sentence; the recent list (written, reused, removed, a stale
  row dropped); sign-up open, with no password field, landing as slice 3a says; the About link shown only when
  `PRODUCT_SITE_URL` is set. By tool: `/api/product` has `productSiteUrl` and no `pages`; a bad `PRODUCT_SITE_URL`
  refuses to start; a single install with `PRODUCT_SITE_URL` set behaves as before; `check-prototype-page`,
  `check-prototype-words` and `check-prototype-parity` still pass with the page matching the Prototype.
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
9. **The first password (slice 3a) is a sign-in path.** A token that leaks, lives too long, can be used twice or can be
   guessed lets someone take a new environment. Between sign-up and the first password the environment must have no
   other way in. Needs a security read before it ships.
10. **Checking as the person types** sends a request per pause. Over 120 a minute the person is told to wait. The
    debounce and the kept answers keep a normal visit far below it; a script is limited as intended.
11. **The typed check tells anyone whether an address exists, and its name.** Only what visiting the address shows, and
    the limit slows guessing; it is the same disclosure as Go had. A list cannot be built from it quickly.

## What is not decided

### Open questions

1. **Renaming `PRODUCT_DOMAIN` and `/api/product*`,** now that no product pages live there. Domains decision 15 kept the
   name; the no-compatibility rule allows a clean rename. Decision 6 leaves them as they are. *Suggestion: Thomas's
   call; if renamed, do it in slice 4, with `PRODUCT_SITE_URL` named to match.* Blocks nothing now; it would block
   slice 4's setting names if Thomas renames.
2. **How the owner sets the first password on the environment's own page** (decision 17, slice 3a). **Decided and built
   on the branch `pm/first-password-server`, held for Thomas's merge** (it is not on main). Thomas approved Design A as
   written, 2026-11-08: a one-time token in the address's fragment, 15 minutes, only its hash stored, exchanged on the
   environment's own page for a "choose your password" step. Design B was rejected. The record of the options and the
   decisions is [plan-first-password](plan-first-password.md); how it works is in
   [architecture-environments](../architecture/architecture-environments.md), "The first password". Slice 4's sign-up part
   no longer waits for the design, only for the merge.

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
