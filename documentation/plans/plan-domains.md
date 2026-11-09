# Domains Plan

**Audience:** Thomas, who decides where the product page, the host console and the environments live; server-development,
who builds the door, the settings and the checks; experience-design, who changes the product page, Manage and the
console; content-manager, who updates the deployment guide and the architecture.

**Status:** built (steps 1 to 6, 2026-10-21); QA pending. Step 7, the move of Thomas's install, was done by Thomas on 2026-11-07, to different addresses than this plan first named (see "What changed on 2026-11-07"; the earlier example addresses below are superseded). The product is now Coffee Pub Chameleon. An environment on a customer's own domain is not built (GitHub #50). Thomas has used the new layout on his production server, but a sign-in from the product host into an environment in Chromium, Firefox and Safari, and a real LiveKit call, are not recorded as checked here. The documentation is in [userguide-getting-started](../userguides/userguide-getting-started.md) ("Environments: one server, several groups") and [architecture-environments](../architecture/architecture-environments.md). Where the build differs from the contract below: the API contract lives in architecture-environments (there is no separate API document for these routes), and the stored `consoleHost` field was never added (decision 6). Before the build: approved with three open lines, 2026-10-21. Thomas answered the twelve questions the same day (see
Decisions). Still to be given by Thomas: his own `RESERVED_SLUGS` names, the current value of `LIVEKIT_HOST`, and whether
the install has environments other than `thepub`. None of the three blocks steps 1 to 6. Thomas (2026-10-21, superseded by the 2026-11-07 section): today's install is
`thepub.collaborator.coffeepub.ai`, which is long, and "collaborator" is a temporary product name. He owns
`coffeepub.ai`, the brand home for all his apps (Studio, Collaborator, 13 FoundryVTT modules, product pages at
`<product>.coffeepub.ai`), and `coffeepub.live`: environments at `<environment>.coffeepub.live`, the product page at
`collaborator.coffeepub.ai`. The server will also be sold stand-alone, so every address must bend to a buyer's own
domains. The design-system build-out (`plan-design-system.md`) and this plan touch different files, so they may run at
the same time.

## What changed on 2026-11-07

Thomas moved his production server and decided the following. This section wins over the example addresses
elsewhere in this plan (`coffeepub.live`, `collaborator.coffeepub.ai`, `livekit.coffeepub.ai`), which were written on
2026-10-21 before the product's name and domains were settled and are superseded. The mechanism they describe
(three settings, the door's order, reserved names) is unchanged and is what runs.

**The product is Coffee Pub Chameleon.** Its name comes from `PRODUCT_NAME` only, as `CLAUDE.md` says.

**The layout that is live:**

| Setting | Value | What lives there |
|---|---|---|
| `BASE_DOMAIN` | `coffeepubstudio.live` | environments at `<slug>.coffeepubstudio.live`; the host console at `admin.coffeepubstudio.live` |
| `PRODUCT_DOMAIN` | `chameleon.coffeepubstudio.com` | the app's front door: sign-up now, and later perhaps an environment chooser |
| `LIVEKIT_HOST` | `livekit.coffeepubstudio.live` | its own proxy host to port 7880, Websockets on |

`coffeepubstudio.com` is the studio's product website. The app does not serve it; its reverse proxy goes to port 8183.
The protective domains (`coffeepub.ai`, `coffeepub.studio`) are redirected at Namecheap to
`https://coffeepubstudio.com` (URL redirect records for `@` and `*`, with their A records removed).

**Decisions (Thomas, 2026-11-07):**

17. **Environments live on a separate registrable domain,** `coffeepubstudio.live` (bought 2026-11-07), not under the
    studio's website domain. Reasons:
    - customer environments are not the same site as the studio's website and its other products (cookies and sign-in
      are kept apart; the `env_hint` cookie is scoped to `BASE_DOMAIN`)
    - no collision with the names of other products
    - short customer addresses, such as `thepub.coffeepubstudio.live`

    It is reversible through `PREVIOUS_BASE_DOMAINS`.
18. **`PRODUCT_DOMAIN` is on another registrable domain than `BASE_DOMAIN`** (`coffeepubstudio.com` against
    `coffeepubstudio.live`). This is the two-domain case decisions 5 and 7 already allow, so the recent shortcut is
    skipped on the product page (decision 11).
19. **The old base `collaborator.coffeepub.ai` was retired the same day,** with no `PREVIOUS_BASE_DOMAINS` redirect
    period, because the product is unreleased and has six users (the no-compatibility rule in `CLAUDE.md`). This replaces
    the plan's earlier advice to set `PREVIOUS_BASE_DOMAINS` for a few weeks (decision 13 and option 6): it stays in the
    code as a general feature, but Thomas's install does not use it. A leftover `PREVIOUS_BASE_DOMAINS` line in his
    compose file is harmless and is to be removed.
20. **Certificates and DNS are at Namecheap.** The wildcard certificate `*.coffeepubstudio.live` is issued through
    Nginx Proxy Manager with the DNS challenge over Namecheap's API. Single-name certificates (HTTP challenge) cover
    `chameleon.coffeepubstudio.com`, `livekit.coffeepubstudio.live` and the website. Renewal risk: Namecheap's API
    needs the server's public IP on its allow-list, and Thomas's home IP is dynamic.

**Possible later hardening, not decided:** registering `coffeepubstudio.live` on the Public Suffix List. That makes every
environment its own site in browsers. It needs proof of ownership.

**Checked against the code (`server/domains.js`, `server/host-registry.js`):**

- `PRODUCT_DOMAIN` may be any host name, including one under another registrable domain. It is refused only when it is
  not a host name or equals `admin.<BASE_DOMAIN>`.
- `livekit`, `turn`, `stun`, `console`, `signup` and `login` are built-in reserved names. In addition, the first label
  of `LIVEKIT_HOST` is reserved automatically when it sits directly under `BASE_DOMAIN`. Here it does
  (`livekit.coffeepubstudio.live`), so `livekit` is reserved twice over. `PRODUCT_DOMAIN`'s label is reserved
  automatically only when it sits under the base, which `chameleon.coffeepubstudio.com` does not.

### An environment on its own domain (not built, GitHub #50)

On 2026-11-07 Thomas asked whether an environment can be pointed at a specific domain, such as a customer's `xyz.com`.
Today it cannot: an environment is always `<slug>.<BASE_DOMAIN>`. The same is true of `thepub.coffeepub.live`, which
Thomas floated for his Foundry group: `coffeepub.live` is not the base, so it is not possible today.

Thomas's wish, recorded as a wish and not yet a decision: a paying customer could use their own domain.

[plan-environments](plan-environments.md) already names the shape of it (the tenant-era words there are the old names
for environments): a hostname-to-slug mapping in the registry, a CNAME at the base, and a certificate the host obtains
itself. It is marked "later" and for the top plan. The open question for that plan is how the certificates are
obtained:

- **A front proxy that obtains certificates on demand** (Caddy or Traefik): a customer's name gets a certificate the
  first time it is asked for, with nothing to do by hand. Costs a change of proxy and a check that the server only
  asks for names it has in the mapping.
- **Nginx Proxy Manager as it is today:** a manual certificate per customer domain, plus the DNS-challenge wildcard for
  the base. Costs nothing new now, and does not scale past a few customers.

No lean is given here. The app side (the mapping, the door resolving a hostname to a slug, the session cookie staying
host-only, `baseUrl(req)` already following the request's host) can be planned once Thomas picks the proxy.

## What we learned moving the production server

- **LiveKit's hostname must match in two places:** `LIVEKIT_HOST` in the app and the `domain` in the LiveKit config
  (TURN). If they differ, the page connects but media does not.
- **The old host's certificate renewals fail once a name stops pointing at the server.** Delete the certificates for
  names you retire.
- **A dynamic home IP has to be followed twice:** the DNS records must follow it (Thomas runs an updater), and so must
  Namecheap's API allow-list, or the wildcard renewal fails.

## Why

Today one setting, `BASE_DOMAIN`, decides every address on a server with environments. The product page sits on the
bare base domain, so the product's name ends up inside every environment's address. Renaming the product would then
change every address people have saved. Splitting "where the environments live" from "where the product page lives"
lets the product page follow the product's name while environment addresses stay put.

## What it is today

- **The door** (`server/index.js`, about line 2672). With `BASE_DOMAIN` set, the request's hostname picks a branch, in
  this order:
  1. a host under `PREVIOUS_BASE_DOMAINS` gets a 301 to the same path at the current base;
  2. `admin.<base>` goes to `hostRouter` (the host console);
  3. the bare `<base>` serves `public/landing.html` for `/`, the use pages (`PRODUCT_PAGES`: `/travel`, `/games`,
     `/projects`) and the short list in `BARE_BASE_PATHS`, which includes `/api/product/signup`;
  4. `<slug>.<base>` resolves that environment;
  5. anything else is a plain 404.

  Without `BASE_DOMAIN` every request is the one environment, and none of this runs.
- **Reserved slugs.** `RESERVED_SLUGS` in `server/host-registry.js` (www, api, host, admin, mail, smtp, imap, pop,
  pop3, ftp, ns1, ns2, static, cdn, assets, app, status, support, help, blog, docs). It is fixed in code, and `livekit`
  is not on it. The check sits inside `cleanSlug()`, which also runs when `host.json` is read
  (`cleanEnvironmentRecord`). So a name added to the list later would quietly drop an existing environment of that
  name from the registry on the next start.
- **Sign-up** (`POST /api/product/signup`, off unless `SIGNUP=on`). It makes the environment and its owner, then
  answers `{ url }` = `<scheme>://<slug>.<BASE_DOMAIN>[:port]/`. `public/landing.js` sends the person there. They are
  not signed in, so the environment's `/` sends them to `/login` and they sign in again.
- **The slug check on the sign-up form** asks `GET /api/product/environment?slug=`. A 404 reads as "is free", so a
  reserved name shows "admin.<base> is free" and then fails when the form is sent.
- **Sign in on the product page.** `GET /api/product/environments` fills the dropdown. The form posts top-level to
  `https://<slug>.<base>/login`; `POST /login` is exempt from `sameOriginOnly`, and the session cookie is `SameSite=Lax`
  and host-only. The **recent** shortcut ("Sign in to The Pub") reads the `env_hint` cookie, which `setEnvHint()` sets
  on `Domain=<BASE_DOMAIN>`.
- **What the pages write from `baseDomain`** (from `GET /api/product` or `GET /api/host/settings`):
  - `landing.js`: the hero's `yourname.<base>`, the sign-up field's `.<base>`, the "is taken" and "is free" notes, and
    `envUrl()`.
  - `admin.js` line 2489: Manage's **Upgrade** link, `<base>/#plans`.
  - `host.js`: environment links, `<slug>.<base>` hints, the billing webhook `admin.<base>/api/host/billing`, and the
    facts line "Sign-up: on, at the base domain".
- **Everything inside an environment comes from the request's own host, not from `BASE_DOMAIN`.** `baseUrl(req)` builds
  all of these:
  - personal links (`/j/<token>`)
  - OBS view links (`/view/<key>`)
  - invites (`/invite/<token>`)
  - guest links (`/guest/<token>`)
  - calendar feeds (`/feed/<token>.ics`)

  The pages use `location.origin` for the same kinds of link. They follow whatever address the environment is reached
  at, and none of them is stored with a domain in it. There is no email sending and no stream URL with a domain in it;
  the stream key is a key, not an address.
- **LiveKit** is its own setting, `LIVEKIT_HOST` (`livekitWsUrl()`, line 1129), not derived from `BASE_DOMAIN`.
  `docker-compose.yml` puts it at `livekit.<domain>` next to `collaborator.<domain>`, and the TURN `domain` in the
  LiveKit config matches it.
- **Previous base domains.** `PREVIOUS_BASE_DOMAINS`, saved in `host.json` as `previousBaseDomains` on every start. Built
  in plan-environments phase 1 for a product rename.
- **The start line** says "host console at admin.<base>".

## Decisions

These come from Thomas's message of 2026-10-21. They are requirements, not choices made here.

1. **No Coffee Pub domain in code.** Every host the server answers to is a setting. The brand name "Coffee Pub" may
   still appear, as `CLAUDE.md` allows.
2. **A single-environment install (no `BASE_DOMAIN`) behaves exactly as before.** The new settings are ignored without it.
3. **A self-hoster with one domain keeps today's layout:**
   - the product pages on the bare `BASE_DOMAIN`
   - the console at `admin.<BASE_DOMAIN>`
   - environments at `<slug>.<BASE_DOMAIN>`

   With none of the new settings, nothing changes.
4. **The product is unreleased.** No redirects or compatibility layers are needed for the move.

Thomas's answers of 2026-10-21:

5. **Layout.** Environments and the console on `coffeepub.live`; the product page at `collaborator.coffeepub.ai`.
6. **`CONSOLE_HOST` is left out.** The console is fixed at `admin.<BASE_DOMAIN>`. A buyer who needs it elsewhere can ask
   later.
7. **The bare `BASE_DOMAIN` redirects** (302, path and query kept) to the product page when `PRODUCT_DOMAIN` is set
   elsewhere.
8. **Reserved names.** Reserve `admin`, `www`, `mail`, `api`, `livekit`, `turn`, `stun`, `console`, `signup`, `login` and
   the automatic labels (the first label of `PRODUCT_DOMAIN` and of `LIVEKIT_HOST` when directly under `BASE_DOMAIN`),
   plus a `RESERVED_SLUGS` setting that adds to the built-in list. Thomas's own names (`studio`, for example) are still
   to be given.
9. **A name reserved later** leaves an existing environment working; only new ones are refused. The check runs where an
   environment is made, not in `cleanSlug()`.
10. **After sign-up,** the person lands on the new environment's sign-in with the login filled in
    (`/login?login=<login>`). No one-time sign-in link.
11. **The recent shortcut is dropped** on a product page that lives on another site.
12. **LiveKit stays at its current host** for the move. `LIVEKIT_HOST`'s current value is still to be given by Thomas.
13. **`PREVIOUS_BASE_DOMAINS` is kept,** fixed so the door checks the product host before the previous-base redirect and
    never catches it. Thomas sets it for a few weeks after the move.
14. **Thomas's data moves as it is.** No reset, no migration. Whether the install has environments other than `thepub`
    is still to be given.
15. **The setting's name stays `PRODUCT_DOMAIN`.**
16. **This is a production build** (plan, QA, docs, version bumps).
## The options that were weighed

Kept for the reasons behind the decisions above. Each section ends with a lean, which was a suggestion; the Decisions
list says what Thomas chose, and it wins wherever the two differ.

### 1. The layout and the model behind it

**The model.** Three addresses, each a setting, each defaulting to today's:

| Setting | What lives there | Default |
|---|---|---|
| `BASE_DOMAIN` | environments at `<slug>.<BASE_DOMAIN>` | none (one environment) |
| `PRODUCT_DOMAIN` | the product page, the use pages and sign-up | the bare `BASE_DOMAIN` |
| `CONSOLE_HOST` | the host console | `admin.<BASE_DOMAIN>` |

**Thomas's install with this model:**

```
BASE_DOMAIN=coffeepub.live
PRODUCT_DOMAIN=collaborator.coffeepub.ai
CONSOLE_HOST unset            (the console at admin.coffeepub.live)
LIVEKIT_HOST unchanged        (see 4)
```

A later product rename changes only `PRODUCT_DOMAIN`. Every `<slug>.coffeepub.live` stays where it is.

**Is `CONSOLE_HOST` needed?**

- **(a) Leave it out.** The console stays at `admin.<BASE_DOMAIN>`. One fewer setting and nothing to check. A buyer who
  wants the console elsewhere can't move it.
- **(b) Add it.** It costs one more comparison in the door, a start check (it must not equal `BASE_DOMAIN` or
  `PRODUCT_DOMAIN`), and the console's own links. It lets a buyer put the console on an internal-only name.

Lean: **(a)**, until a buyer asks. Thomas's layout uses the default, and `admin` is reserved anyway.

**What the bare `BASE_DOMAIN` serves when `PRODUCT_DOMAIN` is set elsewhere:**

- **(a) Nothing:** a 404. Cheapest, but `coffeepub.live` typed by hand shows an error.
- **(b) A redirect (302) to the same path at `PRODUCT_DOMAIN`.** There is one place for the pages, and
  `coffeepub.live/travel` still works. The cost: the product page then lives on another site from the `env_hint`
  cookie, so its **recent** shortcut can't be offered (see 3).
- **(c) The product pages too**, the same files at both hosts. The shortcut keeps working at the bare `BASE_DOMAIN`.
  The cost: two copies of every page for search engines, and two places a person might bookmark.

Lean: **(b)**. One home for the pages. The shortcut is a small loss: the dropdown still lists every environment, and
people mostly keep their environment's own address.

**`PRODUCT_DOMAIN` under `BASE_DOMAIN`.** A buyer might set `BASE_DOMAIN=example.com` and
`PRODUCT_DOMAIN=www.example.com`. The door must check the product host before the `<slug>.<base>` branch. Its first
label is reserved automatically (see 2). If an environment already has that slug, the server refuses to start, with a
line naming the clash. Silently hiding an environment is worse.

### 2. Reserved slugs

**The list.** Today's list, plus these:

- `livekit`, `turn` and `stun`
- `console`, `signup` and `login`
- the first label of `PRODUCT_DOMAIN`, of `CONSOLE_HOST` (if built) and of `LIVEKIT_HOST`, each when it sits directly
  under `BASE_DOMAIN`

`RESERVED_SLUGS` (comma-separated) adds to the built-in list; it never replaces it. A buyer can protect their own names
this way. Thomas would add the names of his other apps (`studio`, say).

**Where the check runs:**

- **(a) As today, in `cleanSlug()`.** A name reserved later makes the environment that has it disappear from the
  registry on the next start.
- **(b) Only where an environment is made:** `addEnvironment()`, the console's create form, sign-up and
  `MIGRATE_ENVIRONMENT_SLUG`. An existing environment whose name becomes reserved keeps working. The start line warns
  once per start ("`<slug>` is now reserved; it keeps working, but no new environment can take that name").

Lean: **(b)**.

**What a person sees on a reserved name:**

- **Sign-up form:** the slug note says "`<slug>` is reserved. Pick another." as they type. It does not say "is free".
- **Sign-up on submit:** 400 with the same sentence.
- **Console create form:** 400 with the sentence.

**How the sign-up form learns a name is reserved:**

- **(a)** A new route, `GET /api/product/address?slug=`, answers `{ slug, free, reason }`, where `reason` is `taken`,
  `reserved` or `shape`. It is public and rate-limited like the lookup.
- **(b)** `GET /api/product/environment?slug=` answers 404 with `{ reserved: true }` for a reserved name.

Lean: **(a)**. One answer per question, and the lookup keeps meaning "this environment exists".

### 3. Sign-up and sign-in across two sites

`collaborator.coffeepub.ai` and `thepub.coffeepub.live` are different sites, not just different hosts. This is what
changes:

- **The words.** They already come from `baseDomain`, which stays `BASE_DOMAIN`. The hero reads
  "yourname.coffeepub.live" and the field reads ".coffeepub.live". No change is needed.
- **Sign-up.** `POST /api/product/signup` is same-origin on the product host. It needs the door to pass it there (it is
  in `BARE_BASE_PATHS` today). The answer's `url` still points at `<slug>.<BASE_DOMAIN>`. The person lands on another
  site with no session, the same as today.
  - **(a) As today.** They land on `/`, are sent to `/login`, and sign in.
  - **(b)** `url` is `/login?login=<login>`, so the login is already filled in, and the status reads "Made. Taking you
    to `<slug>.<base>` to sign in...".
  - **(c)** A one-time sign-in link minted at sign-up, so they arrive signed in. That is a new kind of token, and new
    security surface.

  Lean: **(b)**.
- **Sign in.** The form's top-level post to `https://<slug>.<base>/login` works across sites. The response sets a
  host-only `Lax` cookie in a first-party context, and the 303 that follows is a top-level GET, which carries a `Lax`
  cookie. The two-step code step follows the same path. **This needs a check in a real browser** (Chromium, Firefox
  and Safari); headless Chromium on `*.localhost` is close but not the same site rules.
- **The recent shortcut.** `env_hint` is set on `Domain=<BASE_DOMAIN>`, and the product page on `.ai` can't read it.
  - **(a)** When the product host isn't under `BASE_DOMAIN`, the page skips the shortcut. The dropdown and the form
    remain.
  - **(b)** The page links Sign in to a small page at the bare `BASE_DOMAIN` that reads the cookie. This conflicts with
    1 (b).
  - **(c)** A credentialed cross-site fetch. Third-party cookies are blocked in Safari and Firefox, so this is
    unreliable.

  Lean: **(a)**.
- **Get started on the use pages.** The link is relative, `/?template=travel#start`. It stays on whichever host serves
  the page, so no change is needed.
- **Manage's Upgrade** must go to `PRODUCT_DOMAIN`, not `BASE_DOMAIN`. `GET /api/product` gains `productDomain` (the
  bare `BASE_DOMAIN` when unset), and `admin.js` uses it.

### 4. LiveKit and what else derives from the domains

- **Everything inside an environment** comes from the request's host (see "What it is today"). Nothing changes, and
  nothing stored needs rewriting.
- **What derives from `BASE_DOMAIN`, the full list:**
  - the door
  - `env_hint`'s cookie domain
  - sign-up's `url`
  - the console host
  - `/api/product`'s `baseDomain`
  - `/api/host/settings`' `baseDomain`
  - the console's links and webhook
  - Manage's Upgrade
  - the start line

  Each becomes `BASE_DOMAIN`, `PRODUCT_DOMAIN` or the console host as appropriate. `GET /api/host/settings` gains
  `productDomain` and `consoleHost`, and the console's facts read "Sign-up: on, at `<product domain>`" and show the
  webhook at the console host.
- **LiveKit.** `LIVEKIT_HOST` stays its own setting; nothing derives it.
  - **(a) Leave it where it is** (`livekit.coffeepub.ai`, per the compose file's pattern; Thomas to confirm). Its DNS,
    certificate, proxy host and the TURN `domain` stay as they are.
  - **(b) Move it to `livekit.coffeepub.live`.** The wildcard certificate covers it, and call traffic sits under the
    calling domain. It needs a specific proxy host for it (an exact name wins over the wildcard), a new TURN `domain`,
    and a LiveKit restart.

  Lean: **(a)** for the move, so there are fewer moving parts. `livekit` is reserved either way.

### 5. TLS and DNS

**Thomas's install:**

- **`coffeepub.live`:**
  - an `A` record at the apex to the public IP (an apex can't be a CNAME)
  - `*` as a CNAME to the apex
  - one certificate for `coffeepub.live` and `*.coffeepub.live`, by DNS challenge
  - one Nginx Proxy Manager host with both names to the app on port 3000

  This host covers every environment, `admin.coffeepub.live`, and the bare redirect. A record Thomas adds later for
  something else on `.live` (`mail`, say) overrides the wildcard; reserve its name too.
- **`coffeepub.ai`:**
  - `collaborator.coffeepub.ai` keeps its record and gets an ordinary certificate (no wildcard), with a proxy host to
    the same app on port 3000
  - `livekit.coffeepub.ai` stays as it is under 4 (a)
  - `*.collaborator.coffeepub.ai` and its wildcard certificate can go once nothing redirects from it (see 6)

**A buyer with one domain:** nothing changes. One wildcard and one proxy host, as the guide says today.

**A buyer with two domains:** the guide gains one short section, "The product page on another domain": one record, one
ordinary certificate, one proxy host, and `PRODUCT_DOMAIN`.

### 6. `PREVIOUS_BASE_DOMAINS`

- **(a) Keep it** as a general feature, not as compatibility. Thomas's group has OBS browser sources and calendar
  subscriptions pointing at `thepub.collaborator.coffeepub.ai`; both follow a 301. A buyer who changes domain after
  release needs the same thing. The cost is that the old wildcard certificate and proxy host must stay up while it is
  set. Required fix: the door checks `PRODUCT_DOMAIN` (and the console host) **before** the previous-base redirect.
  Otherwise `PREVIOUS_BASE_DOMAINS=collaborator.coffeepub.ai` would redirect the product page itself to
  `coffeepub.live`.
- **(b) Drop it.** That is less code, in line with the no-compatibility rule. The group re-adds its OBS sources and
  calendar feeds once, and a buyer who renames later edits links by hand or redirects at their proxy.

Lean: **(a)**, with the order fixed. Thomas sets it for a few weeks after the move, then removes it and the old
certificate.

### 7. Moving Thomas's install

There is no data migration. The slug stays `thepub`, and call names hold only the slug. Nothing stored holds a domain;
`host.json`'s `baseDomain` is rewritten on start. The steps:

1. Take a copy of the data folder.
2. Add the DNS records and certificates in 5, and the proxy hosts.
3. Change the container's settings:
   - `BASE_DOMAIN=coffeepub.live`
   - `PRODUCT_DOMAIN=collaborator.coffeepub.ai`
   - `PREVIOUS_BASE_DOMAINS=collaborator.coffeepub.ai` (if 6 (a))
   - `RESERVED_SLUGS` as wanted
4. Recreate the container.
5. Check:
   - `thepub.coffeepub.live` signs in
   - `admin.coffeepub.live` shows the console
   - `collaborator.coffeepub.ai` shows the product page, and sign-up makes a test environment on `.live`
   - an old OBS link redirects
   - a real call connects
6. Later, remove `PREVIOUS_BASE_DOMAINS` and the old wildcard.

**Reset the test data?** Not needed; the move keeps everything. Reset only if Thomas wants a clean start anyway.

### 8. Documentation and checks

**Documentation** (content-manager, after the build):

- **`documentation/userguides/userguide-getting-started.md`**, "Environments: one server, several groups":
  - `PRODUCT_DOMAIN` and `RESERVED_SLUGS`
  - the two-domain section from 5
  - the `PREVIOUS_BASE_DOMAINS` paragraph, as decided in 6
  - the examples keep `example.com`
- **`documentation/architecture/architecture-environments.md`:**
  - the door's new order
  - the product host
  - reserved names checked only on creation
  - `env_hint` and the product page on another site
  - `/api/product`'s and `/api/host/settings`' new fields
- **`docker-compose.yml` comments:** the DNS and proxy lines name the two-domain case, and `PRODUCT_DOMAIN` and
  `RESERVED_SLUGS` are added, commented out.
- **The console's own words** (`public/host.js`, built by experience-design): the facts line and the webhook.
- **`documentation/plans/plan-product-pages.md` and `plan-environments.md`:** a line each, saying the product pages
  live at `PRODUCT_DOMAIN`.

**Checks** (server-development, with each step):

- **`tools/check-origin.mjs`**, using `BASE_DOMAIN=localhost` and `PRODUCT_DOMAIN=product.test` sent as a `Host`
  header:
  - the product host serves `/`, the use pages, `/api/product*` and sign-up
  - the bare base redirects with the path kept (or as decided)
  - `POST /api/product/signup` from the product host passes `sameOriginOnly`
  - `POST /login` from the product host's origin is still exempt
  - with no `PRODUCT_DOMAIN`, everything is as today
- **`tools/check-host-registry.mjs`:**
  - `RESERVED_SLUGS` adds names
  - the automatic labels (product, LiveKit) are reserved under `BASE_DOMAIN` and not otherwise
  - a now-reserved existing environment still loads and opens
  - creation refuses with the sentence
  - the clash between the product label and an existing slug stops the start
  - the previous-base redirect does not catch the product host
  - `GET /api/product/address` answers `taken`, `reserved`, `shape` and free
- **`tools/check-product-pages.mjs`:** nothing new in the shared blocks. The routing stays in `check-origin`.
- **`tools/check-names.mjs`:** a guard that fails on `coffeepub.ai`, `coffeepub.live` or `collaborator.coffeepub` in
  `server/`, `public/`, `modules/`, `templates/`, `tools/` (except the guard's own planted test) and the `Dockerfile`.
  Documentation and plans may name Thomas's install.
- **Single environment:** every route answers as before with `PRODUCT_DOMAIN` and `RESERVED_SLUGS` set but no
  `BASE_DOMAIN`, and the start line says they are ignored.

## The contract

### Server (server-development)

**The settings:**

- `PRODUCT_DOMAIN`: a host name, lower-cased, no scheme, no port. Unset, or equal to `BASE_DOMAIN`, means the bare base.
- `RESERVED_SLUGS`: comma-separated.
- No `CONSOLE_HOST`: the console is at `admin.<BASE_DOMAIN>` (decision 6).
- All of them are ignored without `BASE_DOMAIN`, with one start line naming them.

**Start checks.** Each stops the start with one line:

- `PRODUCT_DOMAIN` equals the console host (`admin.<BASE_DOMAIN>`)
- `PRODUCT_DOMAIN`'s label is an existing environment's slug

**The door, in order:**

1. the console host goes to `hostRouter`
2. the product host serves `/`, `PRODUCT_PAGES` and today's `BARE_BASE_PATHS`
3. a previous base gets a 301
4. the bare base, when `PRODUCT_DOMAIN` is elsewhere, gets a 302 to `<scheme>://<PRODUCT_DOMAIN><path and query>`, the
   port carried as today
5. `<slug>.<base>` resolves that environment
6. anything else gets a 404

**Reserved names:** `isReserved(slug)` is checked in `addEnvironment()` and for `MIGRATE_ENVIRONMENT_SLUG`, not in
`cleanSlug()`. The 400 says "`<slug>` is reserved. Pick another."

**Routes:**

- `GET /api/product/address?slug=` answers `{ slug, free, reason }`. It is public, served at the product host, and
  rate-limited.
- `GET /api/product` adds `productDomain`.
- `GET /api/host/settings` adds `productDomain` (the console host is always `admin.<BASE_DOMAIN>`, so no `consoleHost` field is added).
- Sign-up's `url` is `<scheme>://<slug>.<BASE_DOMAIN>[:port]/login?login=<login>`.

**Unchanged:** `env_hint` keeps `Domain=<BASE_DOMAIN>`. The start line names the product host and the console host.

### Pages (experience-design)

- **`landing.js`:**
  - the slug note uses `/api/product/address` and says "is reserved. Pick another." for a reserved name
  - the recent shortcut is skipped when `location.hostname` is not `BASE_DOMAIN` or under it
  - the sign-up status reads "Made. Taking you to `<slug>.<base>` to sign in..."
- **`admin.js`:** Upgrade goes to `<productDomain>/#plans`.
- **`host.js`:** the facts line names the product host; the webhook uses the console host.
- **No new words on the use pages.**

## Left to build, in order

| Step | What | Who | Size |
|---|---|---|---|
| 1 | The settings, start checks and the door's new order; the product host; the bare-base redirect; the previous-base fix; `check-origin` cases | server-development | M |
| 2 | Reserved names: `RESERVED_SLUGS`, automatic labels, checked only on creation, `GET /api/product/address`; `check-host-registry` cases | server-development | S |
| 3 | `productDomain` in the two APIs; sign-up's `url` | server-development | S |
| 4 | The product page's slug note, sign-up status and recent shortcut; Manage's Upgrade; the console's facts and webhook | experience-design | S |
| 5 | The `check-names` domain guard | server-development | S |
| 6 | The deployment guide, architecture, compose comments, and the two plans' lines | content-manager | S |
| 7 | The move of Thomas's install (DNS, certificates, proxy hosts, container settings) | Thomas, from the guide | S |

Steps 1, 2, 3 and 5 are ready to build, in parallel. Step 4 is built after 2 and 3. Step 6 is built after 4. Step 7 is
Thomas's, after 1 to 4 are released in an image. Step 5 needs only the reserved hosts named in the plan, so it does not
wait on the others.

## Verify

- **Steps 1 to 3 and 5:** checked by a tool (`check-origin`, `check-host-registry`, `check-names`), with `Host` headers
  against a local server.
- **Step 4:** in headless Chromium against a local server with `BASE_DOMAIN=localhost` and `PRODUCT_DOMAIN` set to
  another `*.localhost` name. Both resolve to the loopback, but they count as one site, so this does not prove the
  cross-site cookie behaviour.
- **Only after the move, on the real domains:**
  - sign-in from `collaborator.coffeepub.ai` into `thepub.coffeepub.live` in Chromium, Firefox and Safari, with and
    without two-step sign-in
  - sign-up landing on `.live`
  - an old OBS source and a calendar feed following the redirect
  - **a real LiveKit call**, which can't be checked locally (there is no LiveKit server here)

## Open questions

Three lines from 2026-10-21 are answered or moot (see below), and the 2026-11-07 questions follow. None blocks anything built.

1. **`RESERVED_SLUGS`:** which of Thomas's own names go in it (`studio`, and the other apps)? He sets it in the
   container's settings; the build needs no list. Blocks only the move.
2. **`LIVEKIT_HOST`:** what is its current value? Decision 12 keeps it as it is; the value is needed for the automatic
   reserved label and for the move's checklist. Blocks only the move.
3. **Other environments:** does the install have environments other than `thepub`? Decision 14 moves the data as it is
   either way; the answer only adds names to the move's check. Blocks only the move.

Answered by the move of 2026-11-07: the value of `LIVEKIT_HOST` (question 2) is `livekit.coffeepubstudio.live`. Thomas's
`RESERVED_SLUGS` names (question 1) and his other environments (question 3) are not recorded here.

New, 2026-11-07 (none is decided):

4. **An environment on its own domain** (GitHub #50): how certificates are obtained, a front proxy that does it on demand
   (Caddy or Traefik) or Nginx Proxy Manager with manual certificates. See "An environment on its own domain".
5. **The app's front door as an environment chooser.** `PRODUCT_DOMAIN` serves sign-up now; Thomas has floated an
   environment chooser there later. This overlaps the website and product pages, so it belongs to the product-site plan
   (`plan-product-site.md`, being written separately) and is not decided here.
6. **`thepub.coffeepub.live` for the Foundry group.** Not possible today, for the same reason as question 4: an environment
   is always under `BASE_DOMAIN`.
7. **Public Suffix List registration** of `coffeepubstudio.live`: wanted or not, and when.

Nothing is left open about the build.
