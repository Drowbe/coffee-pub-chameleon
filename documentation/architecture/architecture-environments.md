# Environments Architecture

**Audience:** developers changing `server/index.js`, `server/environment.js`, `server/host-registry.js`, `server/domains.js`,
`server/migrate-names.js`, or adding a new module-level singleton to the server.

What this is for and the decisions behind it are [plan-environments](../plans/plan-environments.md) (phases 1 to 5
are built; the plan was written as "tenants" and renamed with the [Names plan](../plans/plan-names.md)). This document is what you can only learn from the code: how the seam actually
works, and the one thing to get right whenever you touch it.

## The seam, in one sentence

Every request resolves one *environment* (a built set of `store`, `modules`, `moduleData` and the rest, all from
one data directory) before any route handler runs, and every handler keeps reading those names exactly as it
always has -- because the names are no longer the real objects, they are Proxies that forward to whichever
environment the current request resolved.

## `server/environment.js`: what an environment is

`buildEnvironment(dataDir, { slug, admin })` is the whole of what server startup used to do at module scope:
constructs `Store`, `ModuleManager`, `ModuleHooks` and the rest from one directory, wires the event listeners
that turn a change into an activity-log line, starts that environment's own `ModuleHooks` 10-second poll, and
(for the default environment only) makes or resets the server's admin from `ADMIN_LOGIN` and `ADMIN_PASSWORD` (see "Roles" below). It returns a plain object
with one property per service. Nothing here is a Proxy -- these are the real instances.

Three things it does **not** build, because they are the host's, not any one environment's: the LiveKit
`RoomServiceClient` (one call service, shared -- see "Call names" below), the Font Awesome Pro
override (`DATA_DIR/fontawesome-pro/`, a host-level admin asset the migration never moves), and the flight
schedule (`DATA_DIR/flight-schedule.json`, built once in `server/index.js`, learned from every environment's saved
flights and in no environment's export or backup; see "Flight lookup" in
[architecture-modules](architecture-modules.md)).

Calendar addresses are an example of data that is each environment's own ([plan-space-calendars](../plans/plan-space-calendars.md)): a person's everything address (`user.calendarFeed`), their address for one space (`user.spaces[<space id>].calendarFeed`) and the published calendar's (`settings.publishedCalendarFeed`) are hashes in that environment's `app.json`, as is a space's `publishCalendar: false`, and `GET /feed/<token>.ics` looks a hash up only in the environment the request reached (`findFeed()` in `server/index.js`, through the Proxy), so one environment's address is a plain 404 at another, on a single and a hosted install alike; the reads-per-minute count is keyed by the environment's slug and the hash. See "Calendar feeds" in [architecture-modules](architecture-modules.md).

`flushEnvironment(env)` writes the four things under the seam that only debounce rather than writing
synchronously on every change (`chatHistory`, `ai`, `geocodeCache`, the activity log). Called on process exit
(every built environment) and before a backup or a restore (that one environment, so nothing recent is missing
from the zip, or overwritten by a stale in-memory copy right after).

An environment's own name is its `environmentName` setting (the author's call; `serverName` before step 5a). `environmentFor()` in `index.js` runs one
check every time it builds an environment, not just the first: still on the shipped sentinel default ("Coffee
Pub Tavern", `UNNAMED_ENVIRONMENT` in `server/store.js`, from before an install's name was ever set, or before the setting existed at all) means the
default environment gets the product name (`PRODUCT_NAME`, or the default when it is blank) and a hosted environment gets `hostRegistry.findEnvironment(slug).name`, written with
`store.updateSettings`. The same check covers a brand new environment (still on the sentinel right after
`buildEnvironment`) and an old one catching up on its next start after skipping a few versions -- one code path,
not two.

## `server/index.js`: the Proxy and the door

```js
const envContext = new AsyncLocalStorage();
const environments = new Map(); // slug ('' for the default) -> a built environment

function proxyFor(name) {
  // every trap resolves envContext.getStore()[name] and, for a method, binds it to the real instance
}
const store = proxyFor('store');
const modules = proxyFor('modules');
// ...one per name buildEnvironment returns
```

`proxyFor` is generic: it works the same way for a class instance (`store`), a plain `Map` (`presence`), or an
`EventEmitter` (`inviteEvents`), because the only thing it does is forward every property access to
`envContext.getStore()[name]` and, when the value is a function, `.bind()` it to the real object first --
without the bind, `store.someMethod()` would call the method with `this` set to the Proxy, not the real `store`,
and it would break.

The "door" is one middleware, registered right after `express.json()`, before any route:

- **No `BASE_DOMAIN`:** `app.use((req, res, next) => envContext.run(environmentFor(''), next))`. Every request
  gets the one environment. This is the whole of the several-environments machinery's effect on a self-hosted install:
  one extra `AsyncLocalStorage.run` wrapping every request, resolving to the same environment every time.
- **`BASE_DOMAIN` set:** the hostname picks one branch, in this order (`server/index.js`, "the door"; the
  settings are read by `domainSettings()` in `server/domains.js`, [plan-domains](../plans/plan-domains.md)):
  1. `admin.<base>`, the console host, dispatches to `hostRouter` (a separate `express.Router()`, never mounted
     on `app` directly, so a request there can never fall through to a route that needs an environment). The
     console is always at `admin.<base>`; there is no setting to move it.
  2. The **product host** serves one page, the start page (`public/start.html`, `start.js` and `start.css`, see
     "The start page" below), for `/`, and a short allowlist of other paths (`PRODUCT_HOST_PATHS`: `/start.css`,
     `/start.js`, `/theme-head.js`, `/style.css`, `/theme.css`, `/img/site/icon`, `/favicon.ico`, `/api/product`,
     `/api/product/environment`, `/api/product/address`, `/api/product/signup`, and `/fa/*`, `/fonts/*` and
     `/assets/images/brand/*`), beside the design system pages and the SDK as static files. The product host is
     `PRODUCT_DOMAIN`, or the bare `<base>` when that is unset or equal to the base. No environment is ever
     resolved there, so `siteIcon` falls back to "nothing set" when `envContext.getStore()` is empty, the same as
     any environment that has not set its own (that bundled default, and the one `/manifest.webmanifest` offers
     alongside any environment's own custom icon, is `public/assets/images/brand/brandmark-color.png` -- the one
     file a rebrand replaces, not a copy of it). `/theme.css` there sends the bundled default theme, light and
     dark (`DEFAULT_THEME`), since there is no owner's theme to follow. There are no use pages: `/travel` and
     `/games` answer 404 like anything else on that host.
  3. A hostname under `PREVIOUS_BASE_DOMAINS` gets a 301 to the same path at the current base. It comes after the
     product host, so an old base that is now the product host is never redirected.
  4. The bare `<base>`, when the product host is elsewhere, gets a 302 to the same path and query at the product
     host, the request's port carried through (`redirectToHost()`).
  5. `<slug>.<base>` resolves that slug's environment the same way the no-base-domain case resolves the default
     one.
  6. Anything else is a plain 404.

  The two redirects and the sign-up answer carry the port the same way (`requestPort()`): behind a proxy it
  is implicit, in local development it matters.

  **The settings.** `PRODUCT_DOMAIN` is a host name, lower-cased: no scheme, no port, no path. A value that is
  not a host name logs a line and is ignored (the start page stays at the base). It equal to `admin.<base>`
  stops the start. `RESERVED_SLUGS` is a comma list of names. Both are ignored without `BASE_DOMAIN`, with one
  start line naming those that were set. Nothing about them is written to `host.json`; they are read on every
  start. The start line names the console host and the product host.

  **Reserved names.** `isReserved(slug)` in `server/host-registry.js` is true for the built-in `RESERVED_SLUGS`
  set (`www`, `api`, `host`, `admin`, `mail`, `smtp`, `imap`, `pop`, `pop3`, `ftp`, `ns1`, `ns2`, `static`, `cdn`,
  `assets`, `app`, `status`, `support`, `help`, `blog`, `docs`, `livekit`, `turn`, `stun`, `console`, `signup`,
  `login`), for the `RESERVED_SLUGS` setting's names, and for the automatic labels: the first label of
  `PRODUCT_DOMAIN` and of `LIVEKIT_HOST` when each sits directly under the base (`setReservedNames()`). It is
  checked **only where an environment is made**: `addEnvironment()` (so the console's create form and sign-up) and
  `MIGRATE_ENVIRONMENT_SLUG`, with a 400 `"<slug>" is reserved. Pick another.` It is not checked in `cleanSlug()`,
  which also runs when `host.json` is read, so a name reserved later never drops an existing environment: it keeps
  working, and the start logs once per such environment that it "is now reserved". The one start check is
  that `PRODUCT_DOMAIN`'s own label, when directly under the base, is not an existing environment's slug (the
  start page would hide it); the start stops with a line naming it. All of these checks run before `host.json`
  is written.

  `PRODUCT_NAME` (default "Coffee Pub Chameleon") and `CONTACT_EMAIL` (default none) are
  configuration, never code -- `GET /api/product` (registered on
  both the main app and `hostRouter`, never behind a session) answers `{ name, productShortName, contact, baseDomain, productDomain, version, signup, plans, templates, productSiteUrl }`
  wherever it is reached; `productDomain` is the product host (`PRODUCT_DOMAIN`, else the base), null without a base domain. `PRODUCT_NAME` unset, empty or only spaces means the default, everywhere: `productName()`
  in `server/product-name.js` is the one rule, and `DEFAULT_PRODUCT_NAME` there is the only place the default is
  written. `PRODUCT_NAME` holds the full name; `shortProductName()` in the same file derives the short form by dropping a
  leading "Coffee Pub " (any letter case), so the default's short form is "Chameleon", and a name without that prefix, such as a
  branded "Travel Pub", is its own short form and shows everywhere. The short form is `productShortName` in `GET /api/product`,
  `/api/branding` and `/api/host/settings`. Titles, sign-in, first mentions and the About tab use the full name; running text
  uses the short one. An environment that already stored a name keeps it, and the About tab prints the name once (it no longer
  adds "A Coffee Pub product"). A compose file that still sets `PRODUCT_NAME: "Collaborator"` overrides the default and keeps
  the old name on a new install: change it to the new name. The pages write no name of their own: they start with none and fill it in from branding. `version` is
  the package version and the first seven characters of `APP_REVISION` (`v0.4.0 (1a2b3c4)`), which the Dockerfile
  sets to the commit the image was built from (`dev` when unset). It was `TAVERN_REVISION`, which is no longer read;
  only the Dockerfile ever set it.
  Identifiers (file formats and their markers, fenced blocks, stored keys, cookies, environment variables) are
  named by kind, never by the product ([plan-kind-names](../plans/plan-kind-names.md)), and
  `tools/check-names.mjs` fails on a product name written into the code (see "The product name guard", under
  "The Names migration" below; the formats are in [architecture-modules](architecture-modules.md), "The objects
  format", and [architecture-overview](architecture-overview.md), "Themes").

A start without `BASE_DOMAIN` on a data folder that already belongs to a hosted server (it has `host.json` or an
`environments/` folder) stops before anything is written: `refuseHostedDataWithoutBaseDomain()` in
`server/index.js` logs "This data folder belongs to a server with environments: set BASE_DOMAIN." and exits
with code 1. Without it, such a start built a second, empty single-environment install (`app.json`, `chat.json`,
the AI files, `secrets.key`) beside the environments, and every later start with `BASE_DOMAIN` refused (GitHub
#90). `tools/check-host-registry.mjs` covers it.

**The start page.** `/` on the product host is the start page, the only page it serves. It is the product's front
door: a person types the address of their environment and goes to its sign-in. Its parts, top to bottom
(`public/start.html`, `start.js`, `start.css`):

- **The header.** The studio's: the mark, the lockup (the studio's name, then the product's name in coral), a round
  light and dark button, and, when `PRODUCT_SITE_URL` is set, **Support** and **Find Out More**. It stays at the top
  while the page scrolls.
- **The hero.** The badge **Private Beta**, the product's name, one lead paragraph, the line "Your own environment at
  `yourname.<base domain>`" and, when `PRODUCT_SITE_URL` is set, **Request an Invite** (the studio's contact page),
  beside a drawing.
- **Find your environment.** The address is typed, with the base domain after the field. The page asks
  `GET /api/product/environment?slug=` about 400 ms after the last keystroke, one request at a time, and shows the
  environment's name when it exists. **Go** opens only that environment's own sign-in address, built from the slug the
  lookup returned, in the same tab. Under it, **Got a link?** says that a guest link or an invite takes a person in
  on its own.
- **Recent.** In the same band, under the address. The environments this browser reached through the page, newest
  first, up to five, kept in the browser under the key `app.recentEnvironments`; the server stores nothing for it.
  Each is a chip that opens that environment's sign-in and has a button to remove it. The part is not drawn when
  the list is empty.
- **Ways to use** (the product's short name). Five cards (Travel, Gaming, then Projects, Mentoring and Real estate,
  marked **Coming soon**), each a link to a page on the studio's site.
- **The footer.** The studio's: an About paragraph and the columns Products, Studio and Elsewhere, then the legal line.

Every link out is built from the origin of `PRODUCT_SITE_URL` (`siteLink()` in `start.js`), with a path of the
studio's. With it unset, the header's two links, **Request an Invite**, the Ways to use cards and the footer are not
drawn, and the page is the address and Recent alone. The Elsewhere column is the exception: its three links are
written out in the script, since they are not on the studio's site.

There is no sign-up on the page. `POST /api/product/signup` and the `signup` field of `GET /api/product` remain on
the server (see "The first password"), but nothing on the start page calls them.

If `GET /api/product` cannot be reached the page shows "This page did not load" and **Try again**. The page does not
use the app's theme. It has its own palette, taken from the studio's design system: the `--sp-*` names, written once
in three `:root` blocks at the top of `start.css` (light, the picked dark, and the browser's dark), with the same
values in the two dark blocks. It loads `sdk/system.css` for the two font families only, and light mode is the
default unless the browser picked dark (`theme-head.js`). `tools/check-start-page.mjs` reads the files for these rules
and runs the page in headless Chromium.

`PRODUCT_SITE_URL` is read once at start. Unset or empty means no link. A value that is not an absolute `http` or
`https` address, or that carries a user name or password, stops the start with one line naming it, as a bad
`PRODUCT_DOMAIN` does. It is configuration, never code. `GET /api/host/settings` carries `productSiteUrl` too, and the
console's facts show it as **Product site**, beside **Start page** (the product host).

Two more pieces let the start page's **Go** send someone to the right place, without the host ever learning
who anyone is (accounts live inside each environment, not in `host.json`). The page lists no environments and takes no
password: a person types their environment's address (the base domain is shown after the field) and presses **Go**,
and the page opens `<slug>.<base>/login` in the same tab once the lookup below finds it. A line under the form says
"Got a link from someone? Just open it." The environment's own sign-in page does the rest, so the session cookie is
first-party and nothing is posted across sites.

- On every real sign-in to an environment (`GET /j/:token`, `POST /api/login`, `POST /api/register`,
  `POST /api/invites/:token/accept` -- never the host admin's own `POST /api/host/login`), `setEnvHint(req, res)`
  sets a cookie `env_hint` on the parent `BASE_DOMAIN`: a comma-separated list of slugs, most recent first,
  deduplicated, capped at five, `Path=/`, `SameSite=Lax`, `Secure` when the request is, a year long, **not**
  `HttpOnly`. Never cleared on sign-out. A no-op without `BASE_DOMAIN`. **Nothing reads it now**: the old product page
  used to preselect from it and no longer does (plan-product-site.md, decision 11).
- `GET /api/product/environment?slug=` (registered on both the main app and `hostRouter`, and in
  `BARE_BASE_PATHS`, so it answers at the bare base domain too) answers `{ slug, name }` for an `active` or
  `pastDue` environment and a plain 404 for anything else -- unknown, suspended, refused at startup (see "Refused
  environments"), or a slug that fails `cleanSlug`'s own shape check before it ever reaches the registry. These all
  look identical on purpose: a slug is already a public address (it is the environment's own subdomain), so confirming
  one exists reveals nothing a browser couldn't already see by just visiting it. It shares the address check's limit:
  120 a minute from one address, counted together with `GET /api/product/address`, then 429
  `{ error: "Too many checks from this address; try again in a minute." }`. The limit is checked before the slug is
  read, so unknown and malformed slugs count too.
- There is no list of environments. `GET /api/product/environments` is removed and answers 404 on every host, so no
  visitor is ever shown another customer's environment.
- `GET /api/product/address?slug=` (same registration pattern, and in `PRODUCT_HOST_PATHS`) is the sign-up
  form's check as the name is typed. It answers `{ slug, free, reason }` through `HostRegistry#addressFor()`:
  `reason` is `shape` (not a slug; `slug` is echoed lower-cased, cut to 64 characters), `reserved`, `taken` (an
  environment has it, whatever its status) or null when `free` is true. It is public, 404 without a
  `hostRegistry`, and limited to 120 a minute per address (429, same sentence), shared with the lookup above. It says
  nothing about the environment beyond whether the name is taken.
- The form `POST /login` is removed with its `?error=1&login=` return. Sign-in is `POST /api/login` from the
  environment's own `/login` page (`public/login.js`, and `public/login-step.js` for the second step).
  Both keep the `next` address only through `sameSiteNext` in `public/next-address.js`: it must start with a single
  `/` and stay on this site; `//evil`, `/\evil`, absolute addresses and tab or newline tricks fall back to `/`.
- `POST /api/product/signup` (main app only, in `PRODUCT_HOST_PATHS`, so it is served at the product host; off
  unless `SIGNUP=on`; five tries an hour per address) makes the environment on the free plan and its owner, and
  answers 201 `{ url }` with `Cache-Control: no-store`. It takes `{ slug, name, template, owner: { login, displayName } }`
  and **no password**: any `owner.password` or `password` is a 400 `Sign-up takes no password. You choose it on your
  new environment's own page.` The owner's login is checked first, before anything is made: 400
  `Sign-up needs the owner's login.`, and 400 `The owner's name must be text.` for a display name that is not text.
  A reserved name is a 400 `"<slug>" is reserved. Pick another.`; a taken one a 409 `"<slug>" is already in use`.
  A folder already in `DATA_DIR/environments/<slug>` with no registry entry (left behind) is answered the same 409 and
  is never read, changed or removed. If the owner cannot be made, the environment made a moment before is undone.
  The `url` is `<scheme>://<slug>.<BASE_DOMAIN>[:port]/login/first-password#<token>`: see "The first password" below.

Because `AsyncLocalStorage` context follows the real async causality chain (promises, `await`, timers,
`EventEmitter.emit`), a route handler can `await` anything, register a `setInterval`, or call `moduleBus.on(...)`
and the Proxy still resolves correctly inside all of it, with one exception below.

## The first password

A new owner made at sign-up has no password. They choose it on the new environment's own page, with a link that works
once. The start page is another site from the environment, so no cookie can carry the person across, and the start
page never sees a password. Plan: [plan-first-password](../plans/plan-first-password.md).

**The link.** The token is 32 random bytes in base64url (43 characters), made by `auth.oneTimeToken()`. It is in the
address's **fragment** (after `#`), never the query, so a browser does not send it to a server or a proxy, and it
cannot appear in an access log or a `Referer`. The server keeps only its SHA-256, on the owner's account, as
`firstPassword: { hash, expiresAt }`; after the link is used it is `{ claim, claimedAt, expiresAt }`, where `claim` is a random 32-hex id for that use
(carried as `c` in the pending cookie). A stored record without a valid claim is dropped when it is loaded. The token
is never stored or logged. The link made by sign-up lives 15 minutes. The field is never made for the host admin's stand-in account, is
left out of the owner's export (`USER_LEFT_OUT`), and the host's backup, which is not filtered, keeps the hash only.
Setting a password any other way ends the link.

**The routes**, on a hosted install only (without `BASE_DOMAIN` they do nothing, and the single-environment install is
unchanged):

| Route | What it does |
|---|---|
| `GET /login/first-password` | The page (`public/login-first-password.html` and `.js`). The file is reachable only at this route: `/login-first-password.html` answers 404 everywhere, like an unknown file (`ROUTE_ONLY_FILES`). It never redirects, signed in or not, because a redirect would carry the fragment on. `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. |
| `POST /api/login/first-password` `{ token }` | The exchange. Hashes the token, finds the owner whose link matches and is not ended, and spends it. Sets the `mfa_pending` cookie (10 minutes, purpose `first-password`) bound to the owner, the environment and this claim. 200 `{ login, displayName, environmentName }`. |
| `POST /api/login/first-password/set` `{ login, password }` | Reads the pending cookie only for who the step is (never the body). `login` must be the login of the owner the cookie names (cleaned as a login is), so a page still naming an older link's owner cannot set this one's password; a missing, non-text or different `login` is the 401 below. The password is 8 to 200 characters, enforced here (the field has no `maxlength`; the rule comes from the page's script and the server): 400 `A password needs at least 8 characters.` or `A password can have at most 200 characters.` Hashes with scrypt as every password is, stores it, then runs the normal second-step gate (`mfaGate()`): `{ mfaRequired: true, enrol: true }` when the environment requires a second step, else a session and 200 `{ user }`. |
| `POST /api/host/environments/:slug/owners/:login/first-password` | Host admin only (on `hostRouter`). A new link for an owner with no password, valid 24 hours, single use, no-store, answering `{ url }` once. It replaces older links and any step already begun from them. 404 `no such environment` or `no owner with that login there`; 400 when the owner has a password already. |

**Every failure of the two login routes** (no such token, ended, already used, a bad, missing or foreign pending cookie, a
step from an older claim, a `login` that is not the cookie's owner) is the same 401 `This link has expired or was already used. Ask whoever runs this host for a new
one.` The environment's own sign-in limit applies to them: after the limit, 429 `too many attempts, try again in a few
minutes`. A good use clears the count.

**The window and its closed doors.** From sign-up until the password is set, the environment has an owner with no
password. Nothing else can use that gap: an account with no password never signs in by password; the owner has no
personal link and no second factor; and `POST /api/register` answers 403 `sign-up is turned off` while any owner waits
(`Store#awaitingFirstPassword()`), even if the environment allows self sign-up. The sign-in page says nothing about the
wait.

**Limits.** The two login routes share the environment's sign-in limit (10 failures in 15 minutes per address, then 429), as
wrong passwords do. Sign-up has its own five tries an hour per address. The address check and the environment lookup on
the product host (`GET /api/product/address` and `GET /api/product/environment`) share one limiter of 120 a minute per
address (`addressLimiter`, 429 `Too many checks from this address; try again in a minute.`); the first-password routes do not
use it.

**Framing.** `/login/first-password` is in `FRAMED_HERE_PATHS` on a hosted install, so
every variant of the path (case, trailing slash) answers with the framed-here headers. The page carries its own
Content-Security-Policy and loads only its own script.

**The page.** It reads the token from the fragment, removes it from the address at once (`history.replaceState`), and
keeps it in memory only. A link opened in a tab that already shows the page is used too: the page listens for the
fragment changing, takes the new token and removes it from the address and history the same way. It has one password field with **Show**, and the hint "8 to 200 characters". A reload within
the 10 minutes still works because the cookie, not the address, says who it is. For that, the page keeps the owner's
**login** (never the token) in the tab's session storage after a good exchange, so a reload can send it with the password; it
is cleared when the step ends. The same link opened again in the tab that already used it is recognised and ignored, so the
form stays and nothing is sent (the page keeps the spent token in memory to compare). A different new link opened in that tab is
used in its turn, one at a time, and the page then names the owner of the last one. A fragment that is not a link's form
(not 43 characters of base64url) is removed from the address and never sent.

**The console.** `GET /api/host/environments` lists, for each environment, `awaitingFirstPassword`: the logins of its
owners with no password (logins only, never a link, a hash or a time). The card shows **New first-password link** for
each, and shows the link it gets back once, with **Copy**: "This link works once, for 24 hours. Send it to the owner."

**Other ways to set a password** are unchanged and still checked only for "not empty" on the server; only a new host admin
is held to 8 characters.

**Known limits.**
- A leftover folder is never deleted by sign-up or by the console's list. The undo after a failed owner removes the folder
  that request itself made, then removes it again once the environment's background work (the template, the module installs)
  has finished, unless the address was taken again in the meantime.
- The console's create route adopts a leftover folder, and the console page sends no framing headers (GitHub #442 and #441).
- Nothing removes an environment whose owner never arrives. The address stays taken until a host admin makes a new link or
  deletes the environment.

**Accepted risks.** The browser's navigation timing entry holds the token for the page's lifetime; only this site's
scripts can read it. An attacker can make a lookalike environment and send its link: the person ends up signed in to
that environment only, and the attacker never learns the password. Both are low.

**Not verified.** That the fragment survives the move from the product host to an environment on separate domains, and a
proxy redirect, in Chromium, Firefox and Safari; that the token is absent from the proxy's access log; that password
managers offer to save the login.

## The one gotcha: a callback that outlives the request

`envContext.run(env, callback)` only extends to work causally descended from `callback`. A request handler's own
synchronous body, and anything it directly awaits or schedules, is covered. `req.on('close', ...)` is not: the
underlying socket's `'close'` event is Node's own connection machinery, not something the handler's code
causally triggers, so whether it inherits the request's ALS context is not something to rely on.

The three SSE routes (`/api/notifications/stream`, `/api/modules/stream`, `/api/modules/:id/events`) and the
region-cut job stream all do the same small, explicit thing about it:

```js
app.get('/api/modules/stream', (req, res) => {
  const env = currentEnvironment(); // captured once, synchronously, while it is definitely correct
  // ...register listeners on the Proxy as normal; they resolve `env` correctly here...
  req.on('close', () => envContext.run(env, () => {
    // ...off() the same listeners...
  }));
});
```

Registering a listener (`moduleBus.on('event', onBus)`) is always safe without this -- that call happens
synchronously inside the handler, definitely inside the request's own context. It is only the *cleanup*, in a
callback Node schedules on its own, that needs the environment handed back to it explicitly. If you add a fourth
long-lived connection that registers listeners and cleans them up on `'close'`, copy this pattern.

## `server/host-registry.js`: the one thing that is never per-environment

`DATA_DIR/host.json` -- which environments exist (its `environments` list), their plans, the host admins -- is built once, only when
`BASE_DOMAIN` is set, and is never wrapped in the Proxy machinery above: it is the one piece of state that is
explicitly *not* scoped to an environment, by definition. A host admin's own session is a structurally identical
but entirely separate mechanism from an environment's (`auth.HOST_COOKIE` instead of `auth.COOKIE`, `hostRegistry.
sessionSecret` instead of any environment's `store.sessionSecret`, `hostRegistry.findAdminByKey` instead of any
environment's `store.userByKey`) -- see `currentHostAdmin`/`requireHostAdmin` in `server/index.js`. The two cookies
can never be confused for one another even if somehow set on the same browser, because nothing ever reads one
where it expects the other.

The person running the whole deployment can still sign into any one environment, without a second account to
remember: `resolveLoginUser(login, password)` in `index.js`, used by `POST /api/login`, checks the environment's own users first (as always) and only then, when that fails and
there is a host registry, `hostRegistry.findAdminByLogin`. A match there never touches that environment's own
data for the password: it only ensures a user record exists for that login (`hostAdmin: true`, `passwordHash`
always `null`, so nothing inside the environment can authenticate as it directly -- `PATCH /api/users/:key`
refuses a password change for one), created once and reused after. Gated on `(!user || user.hostAdmin)`, so a
login that already belongs to a *different*, ordinary user in that environment never matches the registry --
a name collision just means the host admin cannot sign in with that particular login there, never that they
take over someone else's account.

## Call names

One `RoomServiceClient`, shared by every environment, built with `requestTimeout: 2` (seconds; the SDK's own is
10). When the call service does not answer, every request to it gives up after two seconds, so `GET /api/presence`
and `GET /api/status` answer with nobody in a call instead of waiting (GitHub #71), and the page carries on with the
space list it has (see [architecture-overview](architecture-overview.md), presence). Each space has its own call at LiveKit, and its name is
worked out, never stored (plan-names decision 14). `server/call-names.js` holds both directions: `callName()`
and `spaceIdOfCall()`, wrapped in `index.js` by `callName(spaceId)` and `spaceIdOfCall(name)` for the current
environment.

| Install | The Lobby | A space | An aside |
|---|---|---|---|
| Single environment | `lobby` | `<id>` | `aside-<id>` |
| Hosted | `<slug>.lobby` | `<slug>.<id>` | `<slug>.aside-<id>` |

No slug and no space or aside id can hold a dot, so the dot marks exactly where the slug ends and one
environment's call can never be read as another's. `spaceIdOfCall()` answers null for a call that is not this
environment's, which is what keeps another environment's calls out of this one's presence, its placement and
its calls cap.

For one release, `spaceIdOfCall()` also reads the names calls had before step 3, when they came from the stored
`settings.room`: `table` and `table-<id>` on a single install, `<slug>-table` and `<slug>-table-<id>` hosted. So
people already in a call when the server upgrades are still found, placed, muted and kicked in the call they are
really in, and the calls cap still counts them. An id this environment really has is read as itself first (a
space whose id is `table` is that space), a dotted name is never an old one, and when a longer slug of another
environment also matches (`acme-table-table` is environment `acme-table`'s old Lobby), the name is that
environment's. The plan had the old shapes go by step 10; they are still read after it (0.4.0) and go in a later
release. New tokens are only ever minted
for the new names.

## The console

`public/host.html`, `public/host.js`, `public/host-templates.js` and `public/host.css`, served for `/` at `admin.<base>` by the host router and nowhere else ([plan-host-console](../plans/plan-host-console.md); GitHub #213, built in #509). It keeps the primary nav's left zone only (`body.host-console` hides the middle and right zones: the console has no spaces to navigate to and no environment's profile or Manage to reach). It talks only to `/api/host/` through the shared `api()` helper, and reads nothing of an environment beyond the usage counts the API returns. The console's own styles are in `public/host.css`.

- **The shell.** A left navigation of five sections: **Environments**, **Templates**, **Modules**, **Plans** and **Server**. One is shown at a time and the address names it, so a reload and Back return to it. At 640 px and under the navigation folds into one strip of tabs that scrolls inside itself. The addresses are `#environments`, `#environments/new`, `#environments/<slug>` and `#environments/<slug>/<tab>` (`overview`, `plan`, `template`, `owners`, `backups`, `danger`), `#templates`, `#templates/new`, `#templates/<id>`, `#modules`, `#plans` and `#server`. An address that is not valid percent-encoding falls back to Environments; `#templates/<id>` asks the server only for an id of the server's pattern, so `.` and `..` go back to the list. The old tab names (Host, AI, Maps as tabs of their own) are gone: AI, Maps and the flight schedule are parts of Server.
- **Environments** is a list: Name with its address, Plan, Status chips (the status, deletion asked, at a cap or near one, degraded), Use (Members, AI calls and Calls against their caps) and Template. Rows that need attention come first. Above it the needs-attention strip counts past due, suspended, won't open, deletion asked, at cap, near a cap (80 percent or more of a cap; 100 percent is at cap) and degraded, and each count is a filter. Beside it are a search (name and address), a status filter, a sort (needs attention first, name, plan, newest, highest use), a count, and a **Comfortable** or **Compact** switch (Compact shows one bar, the use closest to its cap, with the others in a tooltip and read out; on a phone it sits under the name). Each row has a **More** menu (`host.menu.show`) with Open, Back up, Suspend or Resume, and Delete. The list sits in a box that scrolls inside itself, with a cue on a phone. It is built only from what `GET /api/host/environments` returns; storage is `null` there and shows on an environment's Overview only.
- **New environment** is its own view (`#environments/new`), with the first owner's fields. Its form is emptied on leaving it, so a typed owner password never waits in a hidden field.
- **An environment's own page** (`#environments/<slug>/<tab>`) has its name, address, chips and **Open environment**, and tabs on the arrow keys: **Overview** (why it needs a look, status and dates, use against each cap, storage), **Plan and modules** (name, plan, its own caps and the modules it may run as tick boxes, one **Save**), **Template** (made from, left out, **Switch template**, and the offer with **Review**), **Owners and two-step** (the reset of an owner's second factor by login, and the first-password links), **Backups** (download, and restore) and **Danger zone** (Suspend or Resume, and Delete). **Domain** is drawn dimmed with the badge "later" and does nothing yet (GitHub #50). A first-password link is dropped on leaving the page and on signing out. An environment whose `refused` is set (see "Refused environments" below) shows the chip "won't open", the reason, the file and the time, what to do, and a dash for every usage count, and hides the owner's second-factor reset, which could not reach the environment.
- **Templates** is a list: name and id, kind (Bundled, Own, Imported, with Edited), version, **Used by** (the environments by name, each a link to its page; past four, "and N more"), the **Hidden** switch and a **More** menu (Edit, Export, Duplicate, Reset to shipped, and Delete when it is an Own template and unused). The update notice keeps **Review**. The editor is its own view (`#templates/<id>`, `#templates/new`) with its parts and a jump list beside them (a strip on a phone), and one **Save**.
- **Modules** and **Plans** are read only (Thomas, 2026-11-09). Modules lists the modules this host ships, from `GET /api/host/settings`' `modules`. Plans shows each plan's caps and how many environments are on it. Plans can be changed only through the API (`PUT /api/host/plans`); there is no editor. The Modules route (`GET /api/host/modules`, with versions and which environment runs each) is not built (slice 7 of the plan).
- **Server** holds the host's facts, the host admin's own two-step sign-in, the host admins (a table with each one's two-step state), AI, Maps and the flight schedule, with a jump strip. **Remove** on a host admin is not offered for yourself or the last one; the server does not forbid either.
- **Asking first.** `confirmDialog` asks before Suspend and Resume, Restore, removing a host admin and resetting an owner's second factor. Delete asks for the environment's address typed out, and its button stays off until it matches. The cards' two-click buttons and their timers are gone. A backup is fetched as a blob and offered as `<slug>-<date>.zip` (the server's own `Content-Disposition` name is not used); restore posts the chosen zip to `POST /api/host/environments/:slug/restore`.
- **Dark only.** The console's host serves no `/theme.css` light set, so the console is dark today. Light mode needs a server change.
- **Names in the lists** (environment, owner, template and plan names) are set as text and never run as markup.
- The console never learns the host admin's session beyond `GET /api/host/me` succeeding or not: signed out, it shows the sign-in panel and nothing else.
- **Checks.** `tools/check-host-console.mjs` drives Chromium against throwaway hosted servers seeded by `tools/host-console-seed.mjs` (30 environments in every state, then 6, then none); `tools/check-first-password-console.mjs` follows the link to the page's Owners and two-step tab.

## The Names migration

`server/migrate-names.js` is the frame for [plan-names](../plans/plan-names.md)'s data migration: stored keys,
files and folders renamed from the old words to the new, one recorded part per step of that plan. Each step adds its part
to the end of `HOST_PARTS` or `ENVIRONMENT_PARTS`. `HOST_PARTS` holds `names-environment` (step 2, below);
`ENVIRONMENT_PARTS` holds `names-table` (step 3), `names-roles` (step 4), `names-spaces` (step 5a), `names-pointers` (step 5c), `names-objects` (step 7) and `names-asides` (step 8), all below.

- **Where it runs.** `buildEnvironment()` calls `migrateEnvironment(dataDir)` before `Store` reads `app.json`,
  so every service sees the data in its current shape, including an environment restored from an old backup.
  With `BASE_DOMAIN` set, `migrateHost(DATA_DIR)` runs once at startup, before `host.json` is read and before
  any environment is built; a single-environment install has no `host.json` and never runs it.
- **A part.** `{ id, files(dir), run(ctx) }`. `files()` answers the paths (from the directory) of the JSON
  files it will rewrite; `ctx` has `dir`, `copyRoot` (where this part's originals were copied), `read(rel)`,
  `write(rel, value)` and `move(fromRel, toRel)`. `write`
  refuses a path `files()` did not list, since only those were copied first. Writes and moves are staged and
  applied after `run` returns. A part must change nothing when run over data it has already changed. `ctx` also
  has `remove(rel)` (a folder deleted, staged like the rest and applied after the moves, before the writes),
  `ranThisStart` (the ids of the parts that ran before it in this start) and `wait()` (the part is not recorded
  this start and runs again on the next).
- **The record.** Parts run in list order, and a part the record names never runs again. An environment's
  record is `app.json`: `version` goes from 1 to 2 (`NAMES_VERSION`) only when a part runs, and
  `migrations: [{ id, at, moved: [{ from, to }] }]` gains one entry per part. The host's is `host.json`'s
  `migrations`, with no `version`. `Store.load()` and `HostRegistry` keep `version` (when above 1) and
  `migrations` exactly as found, so the record survives every later save. A directory with no record yet is
  new: every due part is recorded as run with `moved: []`, since there is nothing old to rename.
- **The copy.** Before a part writes, every file it listed and the record file are copied to
  `<environment>/pre-names/<part>/`, keeping their paths; the host's go to `DATA_DIR/pre-names-host/<part>/`,
  which the pre-environment move (`migrateIfNeeded()`) leaves where it is. A copy already there, from an
  attempt that stopped part-way, is kept. Folders a part only moves are listed in `moved`, not copied. A part
  declared with `copies: false` keeps no copy; only `names-copies-removed` (below) is.
- **The commit.** Everything is checked first: each value serialises, no write lands on a folder, no move's
  target exists or is shared. Each write goes to a `.names-tmp` file beside its target. Then the folders move,
  then the writes are renamed into place, the record last. A failed move puts back the moves already made and
  removes the staged files; a folder that cannot be put back is named in the error ("This folder was moved and
  could not be put back, so it is still at the new place: `<to>` (was `<from>`)."). A failed write names the
  part's own copy folder (`pre-names/<part>` or `pre-names-host/<part>`) as where the originals are. Either way
  there is no record entry, so the part runs again on the next start.
- **The moved-folders note.** Before each folder moves, the moves so far are written to
  `pre-names/<part>.moved.json` (the host's: `pre-names-host/<part>.moved.json`). When the part is recorded, the
  note is read back, keeping only moves that really happened (the folder gone from where it was and present
  where it went), merged with the attempt's own, and deleted. So a part stopped between two moves, by an error or
  by the process being killed, still records every folder it moved when it runs again.
- **The error.** Every failure is a `MigrationError` with `file` and `reason`: `newer` (the record names a
  part this server does not know), `unreadable` (the environment's data file cannot be read, below) or `failed`
  (a part could not finish). The newer check runs whether or not a part is due.
- **Data that cannot be read** (plan-names decision 23). Before anything else, `migrateEnvironment()` reads the
  environment's `app.json` (or `tavern.json` while `app.json` is missing) and refuses it as `unreadable` when it
  is there but cannot be read, is not valid JSON, or is valid JSON but not an object (a list, `null`, a number).
  Until step 3, `Store` read such a file as empty and its first save wrote a new `app.json` over it. `Store.load()`
  refuses it too now, with a `StoreError` (500), in case the file changed after the build. A missing file is a new
  environment and starts fresh. The log line names the file: `<file> is not valid JSON (...), so this environment
  will not be opened: nothing was changed. Fix or restore this file, then start again.`, or `<file> is not an
  environment's data (it holds a list, not an object), ...` with the same ending.

`tools/check-names.mjs` (in `npm run check`) holds the frame to this: `--migration` copies
`tools/fixtures/names-v1/` to the system's temporary folder and runs the frame twice over it with stand-in
parts and with the real ones, including runs killed part-way. Its other modes report the old names left in the
code, level by level (environment, table, role, space, canvas, module, object, aside); a level only reports
until its step switches it to fail. The environment level (`tenant`, `tenants`) fails, in code and in words,
from step 2. `--words` reports "room", "rooms" and "table" in what people read, and `--list[=level]` lists
every hit. The allow-list is `tools/check-names-allow.json`: `{ file, level, pattern, line?, reason }`, the
pattern tested against the hit's own name; an entry with no reason fails, `level: "*"` or a pattern that
matches anything is allowed only for one exact file or under `tools/fixtures/`, and unused entries are listed. One entry is scoped to a folder: the word `table` (the Whiteboard's table block, an HTML table a person writes in, with its `WB_TABLE` limits and `wbTable*` names) is allowed in `modules/whiteboard/src/**` only. It is not the call, and the fence holds everywhere else; a case in `check-names` shows it.

**The product name guard** (`productNameCheck`, run on every `check-names` mode). No product name is written into
an identifier or into text in what the server ships and checks: the name comes only from `PRODUCT_NAME`, and
identifiers are named by kind ([plan-kind-names](../plans/plan-kind-names.md)). The names are the default,
read from `DEFAULT_PRODUCT_NAME` in `server/product-name.js` and never repeated in the check, and the past names in
`PAST_PRODUCT_NAMES` (magpie and tavern), matched in any letter case anywhere in a line, comments included, and in
file and folder names, under `server/`, `public/`, `modules/`, `tools/` and `templates/`, and in the `Dockerfile`.
The brand, Coffee Pub, and the repository and image addresses (`github.com/Drowbe/coffee-pub-chameleon`,
`ghcr.io/drowbe/coffee-pub-chameleon`) are allowed. Anything else is exempt only by an allow-list entry of level
`product-name` with a reason: the read-once migrations of what installs stored or were configured with (the
`tavern_session` cookie, `tavern.json`, the "Coffee Pub Tavern" environment name, `TAVERN_AI_KEY` and the removed
admin names, the browser's `tavern.*` keys), the checks that prove them, the default's one definition,
`PAST_BLOCK_LABELS` in `server/file-format.js` and `tools/fixtures/format-old/`. The guard also fails when the
entry for the default's line or for `PAST_BLOCK_LABELS` would allow more than that one line as it is, and when
`PAST_BLOCK_LABELS` is not a frozen list of two. The checks whose sentences carry the product's name run with
`PRODUCT_NAME=Testname` and build what they expect from it, so a sentence that hard-codes the default fails too.
If the default product name ever changes, the old one must be added to `PAST_PRODUCT_NAMES` by hand (the list is magpie, tavern and collaborator since the rename to Coffee Pub Chameleon).

### The host's part: `names-environment`

The first real part, in `HOST_PARTS`, run by `migrateHost(DATA_DIR)` on a hosted server only (a
single-environment install runs no host part). It renames:

- `DATA_DIR/tenants/` to `DATA_DIR/environments/`, and `tenants-deleted/` to `environments-deleted/`;
- `host.json`'s `tenants` key to `environments`, in the same place among its keys, every other key untouched.

It is recorded in `host.json`'s `migrations` with
`moved: [{ from: "tenants", to: "environments" }, { from: "tenants-deleted", to: "environments-deleted" }]`
(only the folders that were there), and the original `host.json` is kept at
`DATA_DIR/pre-names-host/names-environment/host.json`. Over a host already in the new shape it changes
nothing. A `host.json` with no record yet (a brand-new host) records the part as run, moving nothing.

One refusal: a `host.json` with both `tenants` and a non-empty `environments` that differs from it stops the
start, since the part cannot tell which list to keep:

> The names migration part "names-environment" stopped at `<DATA_DIR>/host.json`: it lists environments under both "tenants" and "environments", and they differ,
> so it cannot tell which to keep. Nothing was changed: remove the out-of-date key from
> `<DATA_DIR>/host.json` and start again (a copy of the file as it was is in
> `<DATA_DIR>/pre-names-host/names-environment`).

An `environments` key that is empty or the same as `tenants` is replaced by `tenants`' list without a refusal.

### The first environment part: `names-table`

In `ENVIRONMENT_PARTS`, run by `migrateEnvironment()` on each environment's first build after the upgrade. It
removes `settings.tableName` (the call's old display name, "The Table") and `settings.room` (the call's old
base name, `table`) from `app.json`, keeping the other keys in their order, and replaces the Lobby's
description only when it is still exactly the old seed, "Everyone at the table.", with the new one, "Where
everyone meets." (an owner's own wording is left alone). `app.json` goes to `version: 2` and records the part;
the original is kept in `pre-names/names-table/app.json`. A new environment is seeded with "Where everyone
meets." and records the part as run. Over data with neither setting and no old description, it writes only the
record.

### The environment part: `names-roles`

Step 4's part, after `names-table`. In `app.json`:

- `users[].role`: `admin` becomes `owner` and `user` becomes `member`. An account with `hostAdmin: true` (the
  host admin's own account in that environment) becomes `admin`, always, even if an owner had changed its role
  before. So after the upgrade the host admin has every right in every environment.
- `settings.roles`: `user` becomes `member` (and a hand-made `admin` entry becomes `owner`). When both an old
  and a new key are there and differ, it stops with the same kind of sentence as the host part: `its
  settings.roles has both "user" and "member", and they differ, so it cannot tell which to keep. Nothing was
  changed: remove the out-of-date key from <file> and start again (a copy of the file as it was is in
  <copy>).`
- `invites[].role` values are renamed the same way.

The original is kept in `pre-names/names-roles/app.json`.

### The environment part: `names-spaces`

Step 5a's part, after `names-roles`. It renames an environment's stored data:

| Where | Old | New |
|---|---|---|
| `app.json` | `rooms`, `users[].rooms`, `invites[].rooms`, `settings.serverName` | `spaces`, `users[].spaces`, `invites[].spaces`, `settings.environmentName` |
| `chat.json` | `rooms` | `spaces` |
| `images/` | `images/rooms/`, `images/<key>/rooms/` | `images/spaces/`, `images/<key>/spaces/` |
| `modules/registry.json` | `allRooms`, `rooms` | `allSpaces`, `spaces` |
| `modules/settings.json` | `{ server, rooms, people }` | `{ environment, spaces, people }` |
| a module's data | `data/server.json`, `data/room-<id>.json` | `data/environment.json`, `data/space-<id>.json` (moved; pointers inside a module's own values are rewritten by `names-pointers`, below) |
| a module's uploads | `uploads/server/`, `uploads/room-<id>/` | `uploads/environment/`, `uploads/space-<id>/` |
| `modules/links.json`, `bus.json` | scope keys and pointers (`server`, `room:<id>`, `scope: 'room'`, `room`) | `environment`, `space:<id>`, `scope: 'space'`, `space` |
| `modules/schedules.json` | `scopeKey`, `id`, `roomId`, `notify.to` | the same with the new scope names, and `spaceId` |
| `modules/notifications.json`, `activity.json` | scope `server`/`room`, `roomId` | `environment`/`space`, `spaceId` |

Where an old and a new key (or file) are both there and differ, it stops with the file named: "... Nothing was
changed: remove the out-of-date one and start again (...pre-names/names-spaces)". The JSON originals are kept
in `pre-names/names-spaces/`, and every folder and file it moves is listed in the record's `moved`.

### The environment part: `names-pointers`

Step 5c's part, after `names-spaces`. A module's pointers to other modules' objects sit inside its own stored
values, where the host cannot read them by meaning, and since step 5c the SDK refuses a pointer with an old
scope. So this part rewrites, by shape and never by module, every `.json` file under `modules/<id>/data/` and
`modules/bus.json` (its events and its actions). A value with string `module`, `kind` and `id` and
`scope: 'server'` becomes `scope: 'environment'`; one with `scope: 'room'` and a string `room` becomes
`scope: 'space'` with `space`. Its other keys are kept, everything else is left as it is, and a file that is not
valid JSON is skipped. The originals are kept in `pre-names/names-pointers/`.

### The environment part: `names-objects`

Step 7's part moves and rewrites nothing: the host stores no summary (one is made on every request), the pointers
in `links.json`, `bus.json`, `schedules.json` and `notifications.json` keep their field names, an installed
module's `module.json` is never rewritten, and a module's own keys are its own to rename (with
`storage.renamed`, see [architecture-modules](architecture-modules.md)). It is recorded like every part, so data
from after step 7 is refused by a build from before it.

### The environment part: `names-asides`

Step 8's part rewrites `app.json` only. An aside used to be a row in `spaces` with `ephemeral: true`; now it is
its own record, `asides`. The old aside rows are dropped rather than moved: an aside lives only while someone is
in it, and anyone still in one when the server upgrades is back in a space after the page reloads. Every other
space loses `ephemeral`, `origin` and `private` (which every space carried as false, null and false), the rest of
the row and the order kept. An aside never had chat history, pictures, modules or settings, so nothing else
changes. Over data already in the new shape it writes nothing. The original `app.json` is kept in
`pre-names/names-asides/` until `names-copies-removed` deletes it.

### The last part: `names-copies-removed`

Step 10's part is last in both `HOST_PARTS` and `ENVIRONMENT_PARTS` (plan-names decision 18). It deletes the
copies every earlier part kept: an environment's `pre-names/` as a whole, or the host's `DATA_DIR/pre-names-host/`.
It keeps no copy of its own (`copies: false`) and rewrites no file but the record. With no copy folder there, it
only records itself. The log line reads `Names migration: ran "names-copies-removed" in <dir>; removed <folder>.`

When any other part ran in the same start (data upgraded straight from before the rename), it calls `wait()`: it
is not recorded, and it deletes the copies on the next start. So the copies survive the start that changed the
data, and are gone after the start after it. This departs from the plan, which had the copies go with the part's
first run; the project manager chose the extra start. A delete that fails part-way is not recorded, and the next
start deletes what is left.

### Bundled modules built for an older version

Since step 5c a manifest in the old names can't run (see [architecture-modules](architecture-modules.md)). So,
on each start, `updateOutdatedBundled()` in `index.js` installs the new copy of each module that came with this
deployment (`source: "bundled"`) whose installed version is outdated, requirements first (Places before Maps),
keeping its on or off, its spaces and its data. A module that was on is turned back on only when what it newly
asks for widens nothing (`pendingWidensNothing()`: a new permission that is off for every role); anything else
waits for an owner's approval, as any update does. Each update logs one line, such as `Updated "polls" to
1.12.11: the version installed was built for an older version of <product>.` (<product> is `PRODUCT_NAME`); if turning it back on is refused, the line adds
"It is off for now: <reason>" rather than reporting a failed update. A failed install logs
`Could not update "<id>" ...`. Since step 7 the same start also updates every bundled module, outdated or not, to
the version the server ships whenever the update asks for nothing new to approve; one that asks for more waits for
an owner while the installed version keeps running. Uploaded modules are never touched. On a hosted server every startup line an
environment logs starts with `[<slug>] `.

### A pre-environment install

With `BASE_DOMAIN` set and data still at `DATA_DIR`'s own root (`app.json`, or `tavern.json` from before that
rename), `migrateIfNeeded()` refuses to start until told which environment the data becomes:

> BASE_DOMAIN is set and `<DATA_DIR>` is a single-environment install. Set MIGRATE_ENVIRONMENT_SLUG=`<slug>` for
> one start to move it to that environment, then remove it.

With `MIGRATE_ENVIRONMENT_SLUG` set, everything at the root except `host.json`, `fontawesome-pro`,
`environments`, `environments-deleted`, `pre-names-host` and `flight-schedule.json` (the flight schedule is the
host's, so what the single install learned stays shared) moves to `DATA_DIR/environments/<slug>/`, and the
environment is added to the registry. The old name, `MIGRATE_TENANT_SLUG`, is no longer read (0.4.0): set, it
moves nothing, and each start logs "MIGRATE_TENANT_SLUG is no longer read: use MIGRATE_ENVIRONMENT_SLUG instead."

## Roles

Inside an environment an account's `role` is `owner` or `member` (`ASSIGNABLE_ROLES` in `server/store.js`), and
`admin` only for the server's admin: the host admin's own account (`hostAdmin: true`) on a hosted server, or the
account `ADMIN_LOGIN` makes on a single install. `admin` is never given in Manage. `owner` and `admin` have every right, in the
host and in every module (`OWNER_RIGHTS`, `hasOwnerRights()`); routes that need it use `requireOwner`. The pages
show Owner, Member, Admin ("Admin: runs this server") and Host admin.

| Where | Refusal |
|---|---|
| An owner-only route, from a person who is not one | 403 `owners only` (a page: `Owners only.`) |
| `POST /api/users`, `PATCH /api/users/:key` with another role | 400 `role must be owner or member` |
| `PATCH /api/users/:key` changing the host admin's account's role | 400 `this account is the host admin's, so its role can't be changed here` |
| Any change to the single install's admin: role, login, password, personal link, deleting it | 400 `this account is the server's admin, so its role can't be changed here`, `this account is the server's admin: it signs in with ADMIN_LOGIN and ADMIN_PASSWORD, so its sign-in can't be changed here`, `this account is the server's admin, so it can't be removed here` |
| Resetting the single install's admin's two-step sign-in from Manage | 400 `this account is the server's admin: it recovers its two-step sign-in with ADMIN_PASSWORD and the lockout bypass, so it can't be reset here` |
| Changing your own role | 400 `you cannot demote yourself` |
| `PATCH /api/roles/owner` | 400 `the owner has every permission, so that role can't be changed` |
| `PATCH /api/roles/user` | 404 (it is `PATCH /api/roles/member` now) |
| Module settings of the environment, or of a space | 403 `only an owner changes the environment's settings` / `only an owner or the space's moderators change its settings` (in the environment's words) |
| `POST /api/me/mfa/reset` or `/api/host/me/mfa/reset` while the lockout bypass is off | 403 `the lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is not turned on` |

`GET /api/roles` answers the permissions keyed `owner`, `moderator`, `member` and `guest`. A module's context
(`GET /api/modules/:id/context`) gives `user.role` as `admin`, `owner`, `member` or `guest` (`viewer` on a keyed
page), and a module asks `host.can()` rather than reading the role; an owner has every module permission.

`ADMIN_LOGIN` and `ADMIN_PASSWORD` make the server's admin on every install, and reset its password on each
start when it differs (plan-names decision 7, amended):

- **Hosted:** the host admin (`host.json`); other host admins are untouched. With no `ADMIN_PASSWORD`, a
  hosted server creates and resets no host admin; the existing ones keep their passwords.
- **Single install:** `buildEnvironment()` makes the default environment's admin: role `admin`, every right, not
  an owner (`store.setServerAdmin()`, `store.serverAdmins()`). It is locked, per the table above. An account
  already under that login (an owner, after step 4) becomes the admin again. There is no "keep at least one
  owner": an environment may have none.
- **No `ADMIN_PASSWORD`:** a brand-new install with no accounts gets an admin (`ADMIN_LOGIN`, default `admin`)
  with a random password logged once; an install with accounts gets nothing made and nobody promoted, and the
  log says "This install has no server admin. Set ADMIN_LOGIN and ADMIN_PASSWORD, then restart, to have one."
- **Old names no longer read** (0.4.0, plan-names decision 20, and the three password names after it):
  `ADMIN_USER`, `TAVERN_ADMIN_USER` and `HOST_ADMIN_LOGIN` (for `ADMIN_LOGIN`), `HOST_ADMIN_PASSWORD`,
  `TAVERN_ADMIN_PASSWORD`, `TAVERN_ADMIN_KEY` and `ADMIN_KEY`, the pre-account password (for `ADMIN_PASSWORD`),
  and `MIGRATE_TENANT_SLUG` (for `MIGRATE_ENVIRONMENT_SLUG`), on single and hosted installs alike. Set, each logs "`<old>` is no longer read: use `<new>` instead." on every
  start (`REMOVED_CONFIG_NAMES` in `server/index.js`). With no `ADMIN_LOGIN` the admin's login is `admin`. `OWNER_PASSWORD`
  (step 4) is ignored: "OWNER_PASSWORD is ignored: owners are made in Manage. Use ADMIN_PASSWORD for the server's
  admin."
- **The pre-environment move** makes the install's admin the new environment's owner.
  Its encrypted secrets (the AI key and two-step sign-in) are re-encrypted from the install's own key to the
  host's, so they keep working; the start logs "Moved <n> encrypted secret(s) of <where> (the AI key, two-step
  sign-in) to the host's key." A secret that can't be read with the install's key is left as it was and logged,
  and if the install's key file itself can't be read, the start logs that the AI key and two-step secrets need
  setting again. The host's managed AI keys in `host.json` are encrypted too.

The lockout bypass (`ADMIN_MFA_LOCKOUT_BYPASS`) covers owners and the server's admin, and the start logs "The
lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is on: every owner and the server's admin skips two-step sign-in
entirely. Turn it off once you are back in." (on a hosted server: "every owner and host admin"). `PORT=0` picks
a free port, and the start logs the real one.

## The host API: environments

Served only at `admin.<base>` by `hostRouter`; the same paths reached from an environment's own host answer
404. Every route but billing needs a host admin's session and answers 401 `{ error: "sign in first" }` without
one. The old `/api/host/tenants...` paths are gone and answer 404; there is no alias.

| Route | Answer |
|---|---|
| `GET /api/host/environments` | `{ environments: [{ ...the registry record, usage: { members, storageBytes, aiCallsThisMonth, spaces }, refused, template }] }`, `template` being `{ id, name, source, version, appliedVersion, appliedAt, offerOpen, skipped: [{ id, name, why }] }` or null, read from the environment itself (see "Templates"); every field is present even for an environment that isn't open |
| `GET /api/host/settings` | `{ baseDomain, productDomain, version, hostAdmins, productName, contactEmail, productSiteUrl, plans, signup, billingSecretSet, modules }`; `modules` is `[{ id, name, icon }]`, the conference and the chat first, then the bundled modules by id, for the template editor; `productDomain` is the product host (`PRODUCT_DOMAIN`, else the base), and the console is always `admin.<baseDomain>`, so there is no console field |
| `PUT /api/host/plans` `{ free: { name, caps }, ...named plans }` | `{ plans }`, the saved catalog. 400 `Give the plan a name.` when a plan's name is empty or only spaces (nothing is saved). Loading is lenient: a stored plan with no name loads under its id, and the next save asks for a name |
| `GET /api/host/templates` | `{ templates: [{ id, name, description, source, version, hidden, edited, update, usedBy: [slugs] }] }`, every template the host can see (see "Templates"); `edited` is true for a bundled template with the host's edits, and `update` is `{ shippedVersion }` while its "updated in this image" notice is open, else null |
| `GET /api/host/templates/:id` | `{ template }`, the template in full, with `source`, `version`, `hidden`, `createdAt` and `updatedAt`; an edited bundled template adds `shipped`, the shipped template in full, for compare; 404 `There is no template called <id>.` |
| `POST /api/host/templates` `{ ...the template's fields }` | 201 `{ template }`, saved as version 1, not hidden; 400 `{ error, problems }` (the first problem, then every one); 409 `There is already a template called <id>.` |
| `PATCH /api/host/templates/:id` `{ ...fields?, hidden? }` | `{ template }`. Any field raises `version` by one and reaches every environment using it at once (its live part); a field sent as `null` is removed; `id`, `version` and the dates are ignored. `{ hidden }` alone hides or shows it, with no new version. A bundled id takes the same body and checks, kept as the host's edit (see "Editing a bundled template"). 400 `hidden must be true or false.` or `{ error, problems }`; 404 as above |
| `DELETE /api/host/templates/:id/edits` | Reset a bundled template to the shipped file: `{ template }`, the edit dropped and `version` up by one. 400 `Only a bundled template can be reset.`; 409 `<name> has no edits to reset.`; 404 as above |
| `POST /api/host/templates/:id/update` `{ keep: "shipped" \| "mine" }` | Answers the "updated in this image" notice: `shipped` is a reset (above); `mine` keeps the edits and closes the notice, with no new version. `{ template }`; 400 `keep must be shipped or mine.`; 409 `There is no update to review for <name>.`; 404 as above |
| `POST /api/host/templates/:id/duplicate` `{ id, name }` | 201 `{ template }`: a new host template with the fields of the template in use (bundled, edited or not, or a host one), version 1, not hidden. 400 `{ error, problems }`; 409 `There is already a template called <id>.`; 404 as above |
| `DELETE /api/host/templates/:id` | `{ ok: true }`; 403 `Bundled templates can't be deleted. Hide it instead.`; 409 `Environments use this template: <names>. Hide it instead.` (the environment word is the host's); 404 as above |
| `GET /api/host/templates/:id/export` | the template file (`Content-Disposition` `<name>.template.json`), bundled ones included; an edited bundled template's file is the template in use plus `"edited": true`, which every import ignores without listing it in `dropped`; 404 as above |
| `POST /api/host/templates/import[?id=<new id>]`, the file's text as the body (any content type) | 201 `{ template, dropped }`, keeping the file's `version`; `?id=` saves it under another id. 400 `That isn't a <product> template file.`, `This template was made by a newer version of <product>.`, `That template file is in an older format. Export the template again and import the new file.` or `{ error, problems }` (<product> is `PRODUCT_NAME`); 409 `There is already a template called <id>.`; 403 from another origin with a cookie (`sameOriginOnly`) |
| `POST /api/host/themes/check`, a theme file's text (or its JSON) as the body, at most 16 KB | For the template editor's theme picker: reads the file exactly as `POST /api/themes/import` does and stores nothing. 200 `{ theme: { name, author?, light, dark }, dropped }`, `dropped` listing the keys left out; 400 `{ error }` with the theme file's sentence (`That isn't a <product> theme file.`, also for a body over 16 KB or one the parser can't read; `This theme was made by a newer version of <product>.`; `That theme file is in an older format. Export the theme again and import the new file.`; or the no complete set sentence); 403 from another origin with a cookie (`sameOriginOnly`) |
| `POST /api/host/environments/:slug/owners/:login/first-password` | 200 `{ url }`, a new first-password link (24 hours, single use); see "The first password". The list's `awaitingFirstPassword` is the owners it is for |
| `POST /api/host/environments` `{ slug, name, plan?, template?, owner?: { login, displayName, password } }` | 201 `{ environment }`; 409 `"<slug>" is already in use`; a bad slug answers `cleanSlug`'s own error; 400 `There is no template called <id>.` or `A template is named by its id, such as travel.` |
| `PATCH /api/host/environments/:slug` `{ name?, plan?, status?, template? }` | `{ environment }`; 404 `no such environment`; 400 for a status not in the list. With `template` (an id, or `"none"`) it switches the environment's template, building the environment if it isn't built yet, and `environment` also carries `template` and `offer` (see "Templates"); 400 `There is no template called <id>.` or `A template is named by its id, or "none" for no template.` |
| `GET /api/host/environments/:slug/template` | `{ template, offer, choices }`, as the owner's `GET /api/environment/template`; read-only; 404 `no such environment` |
| `POST /api/host/environments/:slug/template/apply` `{ modules?, lobby?, spaceDefaults?, reactions?, theme?, iconSet? }` | `{ environment }` with `template` and `offer`; the same body and refusals as the owner's apply; 404 `no such environment` |
| `DELETE /api/host/environments/:slug` | `{ ok: true }`, the data moved to `DATA_DIR/environments-deleted/<slug>-<ms>/`, never removed; 404 `no such environment` |
| `POST /api/host/environments/:slug/backup` | the environment's folder as a zip (`Content-Disposition` `<slug>-backup.zip`), every regular file byte for byte, private chat and person data included; a symbolic link is not followed and is logged by path; 404 `no such environment` |
| `POST /api/host/environments/:slug/restore` | see "Refused environments", Restore |
| `DELETE /api/host/environments/:slug/owners/:login/mfa` | `{ ok: true }`; 404 `no such environment` or `no owner with that login there` |
| `GET` and `DELETE /api/host/flight-schedule[?number=]` | The flight schedule every environment shares: its counts, forgetting one number, or clearing it all. The answers and refusals are in [api-modules](../api/api-modules.md), "Flight lookup" |
| `POST /api/host/billing` `{ slug, plan, event }` | `{ environment }` (was `{ tenant }`); no session, a signature: 401 `bad signature`, 404 when `BILLING_SECRET` is not set |

## Refused environments

Data that records a migration part this server does not know is from a newer version, and is refused rather
than read in a shape this server does not understand (plan-names decision 22).

- **At startup, when nothing else can run.** An unknown part in `host.json`, or in the one environment of a
  single-environment install, logs one line and exits with code 1; so does an unreadable `app.json` on a single
  install (see "Data that cannot be read" above). For an unknown part, the line names the file and the part:
  `<file> records the migration part "<id>", which this version of <product> does not know: this data is from a
  newer version of <product>, so it will not be opened here.` (<product> is `PRODUCT_NAME`)
- **On a hosted server, one environment.** `buildAtStartup()` in `index.js` skips an environment whose build
  throws a `MigrationError`; the others and the console keep running. `environmentFor()` keeps the refusal in
  `refusals` (by slug: `reason`, `file` relative to `DATA_DIR`, such as `environments/beta/app.json`, the full `message`, the sentence, `at`), logs
  the message once per refusal, and tries to build again on every request, so a fixed or restored environment
  opens without a restart. The log line for a skipped environment adds "This environment is skipped and answers 503
  until its data is restored or fixed; the others run as usual." Until it builds, the error handler answers 503 with
  `{ error: "This environment's data is from a newer version of <product>." }` (`newer`),
  `{ error: "This environment's data could not be read. The host admin has been told." }` (`unreadable`) or
  `{ error: "This environment's data could not be updated. The host admin has been told." }` (`failed`), or a
  plain HTML page with the same sentence for a browser asking for a page. The file and the detail go to the log
  and the console only. A refused environment is answered 404 by `GET /api/product/environment`, and the console's
  map-region search skips it.
- **The console's list.** `GET /api/host/environments` gives each environment
  `refused: null | { reason: 'newer' | 'unreadable' | 'failed', file, message, at }`, and every `usage` count is `null` while
  it is refused.
- **Restore.** `POST /api/host/environments/:slug/restore` checks the zip before touching anything: when the
  `app.json` or `tavern.json` that would land (names normalised, the last of a repeated entry) records an
  unknown part, it answers 400 `{ error: "This backup is from a newer version of <product>." }` and the
  environment is unchanged. Otherwise it replaces the environment's folder, builds it at once, and answers
  `{ ok: true }`, or `{ ok: true, refused: { reason, file, message, at } }` when the restored data is itself
  refused. A backup whose `app.json` (or `tavern.json`, when there is no `app.json`) is not valid JSON or not an
  object is refused the same way, before anything is replaced: 400
  `{ error: "This backup's data can't be read, so nothing was restored." }` (`UNREADABLE_BACKUP`). The other
  answers are as before: 404 `no such environment`, 400 `choose a zip file to restore`, and
  400 with the zip reader's message. A restore always drops `secrets` from the zip's `app.json` (see the next section).

## The owner's copy and a restore

`GET /api/environment/export` (an owner; hosted only, else 404 `not hosted`) answers the environment's zip, `<slug>-export.zip`,
with `Cache-Control: private, no-store`. It is built from allow-lists in `server/environment-export.js`: a field of `app.json`
or a file is in the copy only when the module names it, so anything added later stays out until someone classifies it.
The host's backup is not filtered.

- **Left out of `app.json`:** `secrets` (the session key and the stream key), `invites`; on each person `passwordHash`,
  `linkToken`, `mfa`, `externalCalendars`, `calendarFeed`, `firstPassword`; on each space `guestToken`; `settings.publishedCalendarFeed`.
  `ai.json` is kept with its `key` emptied.
- **Left out of the files:** `secrets.key`, the pre-names copies, `chat-private.json`, `ai-threads.moved.json`, each person's
  module data, hold and uploads (`modules/<id>/data|trash/person-<key>.json`, `modules/<id>/uploads/person-<key>/`), a library
  module's `*.shares.json`, and half-written files (`*.tmp`, `*.part`, names starting with a dot).
- **Still in the copy:** logins and display names, module notifications, AI-log counts (never the text), module setting
  values (a typed address can carry a key), a space's link, and the Vault's file records (names and sizes).
- **Symbolic links.** Neither the export nor the backup follows a link inside an environment (for example `modules` linked to
  another disk): it is left out, and the server logs each skipped link by path with `console.warn`. A symbolic `DATA_DIR`
  or environment folder itself still works.
- **The guard.** `tools/check-environment-export.mjs` (in `npm run check`) fails when a person, space or aside field, or a
  file, is on neither list. Settings fields are classified by hand.

**A restore** (the host's restore, of an owner's copy or of a backup) removes `secrets` from the zip's `app.json`
(`restoreEntries`), so `Store.load` makes a new session key and a new stream key. It also replaces a stored session key shorter
than 43 base64url characters, or a stream key shorter than 24. The result for people:

- everyone is signed out; "remember this device" cookies stop working; guests open their guest link again; visitors to a
  password-protected Vault share enter the password again;
- every OBS browser source and keyed link needs the new stream key from Settings;
- from a host backup, passwords, personal links, guest links, invites and calendar feeds survive; from an owner's copy nobody
  has a password or link until the host admin gives out new ones;
- a person record with `hostAdmin: true` keeps no `passwordHash`, `linkToken` or `mfa` (dropped on load and on restore);
- a record with role `admin` that is not the host admin's stand-in is restored as `owner`.

## Templates

A template sets an environment up for one use when it is made (plan-environment-templates; the owner's view is
[userguide-templates](../userguides/userguide-templates.md)). It is data, not code: `templates/<id>.json` at the
repository's root (the Dockerfile copies `templates/`), the host's own and a single install's imported ones, all
read and checked by `server/templates.js`. Nothing in the code knows which template names which module.

**Where templates come from** (addendum 2, GitHub #68). `templateCatalog()` in `server/index.js` gathers them, each
with a `source`:

- `bundled`: `templates/<id>.json`, released with the image. On a hosted server the host can edit one in place; the
  edit is kept in `host.json`, not in the file (see "Editing a bundled template").
- `host`: `host.json`'s `templates: [{ ...the template, version, hidden, createdAt, updatedAt }]`, made, edited and
  imported on the host console (`HostRegistry#putTemplate`, `#removeTemplate`). Only on a hosted server.
- `imported`: a single install's `app.json` `templates: [...]`, from files its owner imports, so a backup carries
  them (`Store#putImportedTemplate`, `#removeImportedTemplate`). Only without `BASE_DOMAIN`.

Ids are unique across them: a new or imported template with a taken id is refused with 409. A host or imported
template that has a bundled template's id keeps it, and that bundled one isn't offered on that server (logged once),
so an environment's template never changes under it. A stored template that fails its check is left out with a log
line.

**The file.** `{ id, name, description, version?, words, verbs?, icons: { home }, moduleNames, moduleIcons, modules, settings,
lobby: { name, description }, phases?, spaceDefaults: { profile?, opensWith? }, reactions?, theme?, iconSet? }`, the same shape and checks
for every source. `words` covers only the eleven changeable keys, `home` among them (never `host` or
`admin`), in the form Manage takes. `verbs` (addendum 4) is `{ enter?: "<text>", layout?: "<text>" }`: the word on the button for
entering a space, tidied, 1 to 20 characters of letters, spaces, hyphens and apostrophes; a verb that isn't text,
null included, is refused with "verbs: The <verb> verb must be text." (leaving the key out is how a file asks for the
default), and an unknown key with "verbs: there is no verb called "<key>"; the verbs are enter, layout.". Travel sets none. `icons.home` and `moduleIcons` must be plain solid Font Awesome Free icons.
`modules` lists module ids, bundled or built in, and must include `chat`. `settings` takes only `language`,
`clock`, `currency`, `loginText`, `allowRegistration`, `mfaRequired`, `maxQuality`, `allowScreenShare`,
`allowAsides`, `allowPrivate`, `allowReactions`, `showCalendar`, `showMap` (booleans: the top bar's destinations; Travel sets both, from version 4), `calendarFeeds`, `otherCalendars` and `publishedCalendar` (booleans: Calendar sharing's switches, [plan-space-calendars](../plans/plan-space-calendars.md); Travel sets the first two, from version 5), `activeThemeId` and `themeMode`. `spaceDefaults.profile` is
`roleplaying`, `participants` or `characters`. `spaceDefaults.opensWith` is up to 20 module ids, bundled or built in,
none twice, in the order a new space opens them (plan-planner-phases; nothing opens from it until that plan's step 6).
`phases` is up to 12 `{ id, label, main?, icon? }`: `id` as a module id and unique, `label` 1 to 40 characters, `main: true`
on at most one, `icon` a Font Awesome Free solid icon that can be drawn (refused as `phases[<i>]: icon "<name>" is not a Font Awesome Free solid icon.`); any other key is refused (`phases[<i>]: "<key>" is not a phase field; a phase takes id, label, main and icon.`). A phase's icon is optional; it shows beside the phase's name in the status strip's journey bar where it fits, and in `host.phases()`. A phase has no colour in the template: the one it wears everywhere comes from its place in the list ([architecture-canvas](architecture-canvas.md), "Phases"). The fields added by addendum 2:

- `version`: a whole number, 1 or more (a bundled file without one is 1). A host template's counts up on every
  edit; an imported one keeps the file's.
- `reactions`: `[{ id?, glyph, label? }]`, at most 120 (`MAX_REACTIONS`), a glyph of 1 to 8 characters and a label of at most 40, then
  cleaned by `cleanReactions`.
- `theme`: an embedded theme in the theme file's shape, `{ name, author?, light, dark }` without the theme file's `format` and `formatVersion`,
  checked as a theme import is (`server/theme-file.js`).
- `iconSet`: at most 120 (`MAX_ICON_SET`) Font Awesome Free solid names, none twice, for the environment's icon list. It is separate
  from `icons`, which stays `{ home }`.

**The defaults** (GitHub #169). An environment starts with Thomas's curated lists, `server/default-lists.js`: 105
reactions, whose first six are the **1** to **6** keys (Heart, Black Heart, 100%, Hi, Thumbs up, Thumbs down), and 113
icons (111 solid, and the brands `bluesky` and `xbox`). An existing environment still on exactly the old six reactions,
or exactly the old 21 starter icons, moves to the curated list once, on its next start; the two are judged
separately, and lists an owner or a template changed are kept. The settings flags `reactionsCuratedSeeded` and
`iconsCuratedSeeded` record that the run happened, so an owner who later picks the old list by hand keeps it.
`tools/check-defaults.mjs` holds this.

Every bundled file is checked when the server starts, and an invalid one stops the start with a line naming each
problem; a host template and an import are checked before they are saved. `tools/check-templates.mjs` (in `npm run
check`) checks the same.

**A bundled template's version is raised by hand** when its applied-once part (modules, settings, Lobby, space
defaults, reactions, icon set or theme) changes; a change to its words, verbs or icons alone needs none, since
those are live. `tools/template-versions.json` keeps each bundled template's version beside a fingerprint of that part
(`templates.appliedOnceFingerprint()`), and `check-templates` fails when the part changed but the version didn't, or
when either is new and not recorded. After raising `version`, record it with
`node tools/check-templates.mjs --update`.

**Picked at creation.** When an environment is made: `POST /api/host/environments` `{ template }`, the product
page's `POST /api/product/signup` `{ template }` (`GET /api/product` lists `templates`), or `TEMPLATE=<id>` on a
single install's new data folder. `TEMPLATE` on existing data, or on a hosted server, is ignored with a log line;
an unknown id stops the start with a line listing the templates there are. It can be switched later (below).

**Applied once, then the owner's.** Its settings, its modules (turned on, and on in every space), the Lobby's name
and description, `spaceDefaults`, its reactions (they become the environment's list), its icon set (added to the
icon list, never removing one) and its theme are applied when the environment is made. The theme is added as a new
theme ("Name (2)" on a clash, never overwriting) and made active; a theme with the very same colors already there is
made active instead of added again. It is all recorded in `app.json`'s `template`: `{ id, appliedAt,
appliedVersion, applied, switchedAt?, skipped: [{ id, why }] }`. `applied` holds a fingerprint of each applied-once
part (`modules`, `reactions`, `theme`, `iconSet`, `lobby`, `spaceDefaults`; `templates.partFingerprints()`) as it
was when last applied or passed over. A record from before versions reads as `appliedVersion` 1. A module is skipped when the plan doesn't include it, when it needs a skipped one,
or (Research) until the AI service is on; the environment's page on the console and Manage's **Template** tab list them. Its modules go
on in every space they may be in, which leaves the Lobby out for a module not made for it (plan-modules, "the Lobby
is for being together"). A backup carries the record, and a restore brings it back. The view the pages get
(`templateView()` in `server/index.js`) is `{ id, name, source, version, appliedVersion, appliedAt, offerOpen,
skipped: [{ id, name, why }] }`; `source` is `bundled`, `host` or `imported`, or null when this server doesn't have
the template.

**Followed live.** Its words, verbs, phases, home icon and module display names and icons are read from the template on
every build, and a host template's edit reaches every built environment using it at once (`refreshTemplateLive()`), as the layer between the default and the owner's own: an owner's change wins, and a reset goes
back to the template's. `GET` and `PATCH /api/settings` give the owner `template`, `ownHomeIcon`, `templateWords`,
`templateHomeIcon`, `ownVerbs`, `templateVerbs` and `spaceDefaults` (the verbs are described below); `PATCH` takes `homeIcon: null` (back to the template's) and
`spaceDefaults: { profile?, opensWith? } | null` (400 `spaceDefaults takes only profile and opensWith.`, `profile must be roleplaying,
participants or characters`, or a sentence naming a bad `opensWith` entry). A key left out is kept; `opensWith: null`
or `[]` removes it, and with neither left `spaceDefaults` is cleared. The phases reach modules through the module
context (`store.templatePhases`; [api-modules](../api/api-modules.md), `GET /api/modules/:id/context`). `GET /api/modules` adds `templateDisplayName` and `templateDisplayIcon`.
**The verbs** (addendum 4, "the word for entering a space"). Beside the ten words, `server/words.js` keeps a small
set of verbs: the actions a person reads at the start of a button. There are two: `enter`, default "Enter", on a space's main button and the guest form; and `layout`, default "Layout", once on the top bar's Layout button (plan-layout-menu, decision 1); that button is gone, so no control reads it now. A verb is
one string, with no plural or article, never lower-cased; it is not a level or role, so it stays out of `words` and
the Names. It resolves as the owner's (`settings.verbs.enter`), else the template's (`store.templateVerbs`, set by
`useLive()`), else the default (`resolveVerbs()`). `branding()` carries `verbs`, resolved (`{ enter: "Enter", layout: "Layout" }`);
the owner's settings view adds `ownVerbs` (what the owner set, `{}` for none) and `templateVerbs` (the template's own:
null with no template, `{}` for a template that sets none). `PATCH /api/settings` `{ verbs: { enter: "<text>" |
null } }` is owner only; null returns it to the template's or the default, and a refused verb refuses the whole
patch with one sentence: `Verbs must be given by name, each as text.`, `There is no verb called <key>; the verbs are
enter, layout.`, `The <verb> verb must be text, or null to use the default.`, `The <verb> verb must be 1 to 20 characters.` or
`The <verb> verb can use only letters, spaces, hyphens and apostrophes.`. The verbs are not in `host.locale()`: no
module enters a space. In the pages, `public/words.js` (re-exported by `brand.js`) gives `verb(key)`, `verbs()` and
`setVerbs()`, fills `data-verb="enter"` elements and `{enter}` in `fill()` and `data-fill`, and keeps an
environment's own verbs under `app.verbs` in the browser. A space's card, its pop-out button's title ("<verb> in a
pop-out window") and the guest form's heading and button read the verb; an aside's card reads the fixed **Join**
with a phone icon, and **Back to <space>** stays fixed text. `check-names --words` has no rule for it (a one-word
label can't be told from code such as `e.key === 'Enter'`).
`settings.homeIcon` is stored only when an owner picks one (null otherwise, so the template's shows, else the
default). Environments made before this stored the default `couch` as if chosen; the first start clears a stored
`couch` once and sets `homeIconChoiceSeeded`, so an owner who picks it from then on keeps it.

**Switched later** (plan-environment-templates, "Addendum: switching a template", GitHub #59). An owner or the
host can switch an environment to another template, or to none. `switchTemplate()` in `server/index.js` waits for
a creation-time template to finish applying, then replaces the record with `{ id, appliedAt: null, switchedAt,
skipped: [] }` (none removes it), runs `templates.useLive()` against the new template and adds its icons to the
icon list (`templates.addIcons()`), and follows the registry entry on a hosted server. Words, verbs, the home icon and
module display names and icons change at once; the owner's own still win. Nothing is turned off and no data is
touched. A record with `switchedAt` is never applied on its own at the next start, the way a creation-time one
is. Each switch adds `{ from, to, at, by }` (`by`: the owner's key or `host`) to `app.json`'s `templateHistory`,
kept to the last 20 and not shown to owners. Switching to the template already in use changes nothing.

**The offer.** A template's once-only part is an offer (`offerOpen: true`) after a switch, until it is applied, and
when the template's `version` is above the record's `appliedVersion` (`offerIsOpen()`). For an environment that isn't open (the console's list), `offerOpen` is read from the stored record alone: a newer version counts only if a part it applies once changed since it was applied (`templates.appliedPartsChanged()`), so it can over-report a part the environment already has until the environment is opened. An update offers only the
parts whose fingerprint differs from the record's `applied`, so a part the template didn't change is never offered
again, whatever the owner did with it since; a record without `applied` (a switch, or one from before) is compared
with the environment as it is. A newer version with nothing to offer (it changed only live parts) opens no offer.
`templates.offerFor()`: `{ modules: [{ id, name, allowed, why? }], lobby: { name, description } | null,
spaceDefaults: { profile?, opensWith? } | null, reactions: [{ id, glyph, label }] | null, theme: { name, author? } | null,
iconSet: [names] | null }`. `modules` holds each module the template lists (with what it requires) that
isn't already on in every space it may be in, `allowed: false` with `why: "not in the plan"` when the plan leaves
it out, and the conference when listed and off. `lobby` is the template's Lobby name and description when they
differ from the Lobby's, `spaceDefaults` its new-space profile and its `opensWith`, each only when it differs (one
tick applies both), `reactions` the template's list when
it differs from the environment's (it replaces them), `theme` the template's theme unless it is already the active
one, and `iconSet` the names missing from the icon list. `templates.applyOffer()` applies only what is confirmed:
the ticked modules (installed if needed, enabled, `allSpaces`), and the Lobby, the profile, the reactions, the theme
and the icon set only when `true`; it never turns anything off. Applying, even with nothing ticked, writes
`appliedAt`, `appliedVersion`, `applied` (every part, applied or passed over) and `skipped` (every refused module,
and any confirmed one that couldn't be turned on), so the offer closes. The template's settings are never offered.

**Hidden and deleted.** A host template can be hidden (`PATCH { hidden: true }`): it is left out of the create
form, sign-up (`GET /api/product`) and every switch's choices, and an environment using it keeps it and still sees
it among its own choices. Deleting a host template answers 409 while any environment's registry entry names it; a
bundled one can be hidden (no new version) but not deleted (403). A single install's owner can delete an imported template only when
the environment doesn't use it.

**Template files** (`server/template-file.js`). `<name>.template.json`, at most 64 KB:

```json
{
  "format": "template", "formatVersion": 1,
  "id": "harbour", "name": "Harbour", "description": "...", "version": 3,
  "words": {}, "icons": { "home": "anchor" }, "iconSet": ["anchor", "ship"],
  "moduleNames": {}, "moduleIcons": {}, "modules": ["chat", "conference"],
  "settings": {}, "lobby": {}, "spaceDefaults": {},
  "reactions": [{ "id": "wave", "glyph": "...", "label": "Wave" }],
  "theme": { "name": "Harbour", "author": "Thomas", "light": { }, "dark": null }
}
```

`templateToFile()` writes every field the template has (a part it lacks is left out), the theme in the theme file's
shape without its `format` and `formatVersion`. The marker is read by `readMarker()` in `server/file-format.js`, the
one rule for the theme, template and objects files. `readTemplateFile()` refuses, in order: over 64 KB, not JSON,
not an object, or a marker that isn't `"format": "template"` with a whole-number `formatVersion` ("That isn't a
<product> template file."); a file from before the formats were named by kind, with no `format` and a top-level key
named after a past product name followed by `Template` ("That template file is in an older format. Export the
template again and import the new file."); a newer `formatVersion` ("This template was made by a newer version of
<product>."); then the template's own check (the first problem is the
error, `problems` lists every one). Unknown keys, at the top level and inside the theme and its sets, are dropped
and listed in `dropped` (`plan`, `theme.glow`, `theme.light.shine`). An import keeps the file's `version`. Any
template can be exported, a bundled one included. To start a host template from another, the console's
**Duplicate** is the one step.

**Editing a bundled template** (addendum 3, GitHub #91, hosted servers only). `host.json` keeps `bundledEdits: [{ id,
template, version, base: { version, fingerprint, whole }, hidden, updatedAt }]`, one record per bundled id the host
has touched (`HostRegistry#bundledEdit`, `#putBundledEdit`, `#removeBundledEdit`). `template` is the whole edited
template, or null after a reset or for a record that only hides. The merge is whole, not field by field: while
`template` is set it is the template, and the shipped file is not read (`templateCatalog()`), so "keep mine" means
exactly what the host sees. `version` is what environments see: the first edit is the shipped version plus one,
and every later edit, reset or take-new adds one; it never goes down. `base` is the shipped file the edit was made
against: its version, `templates.appliedOnceFingerprint()` and `templates.wholeFingerprint()` (every field but the
version, so a shipped change to words alone still counts; `verbs` counts only when the template sets one, so a
template without verbs keeps the fingerprint it had before the field existed). While `base` differs from the shipped file, an edited
template carries `update: { shippedVersion }`, the console's notice. At start, `reconcileBundledEdits()` moves a
record with no edit onto the new shipped file with `version` + 1 and no notice, and leaves one with an edit as it
is. A record for an id this image no longer ships is ignored, with a log line; one that fails its check is logged
and the shipped template used. Every edit, reset and take-new runs `refreshTemplateLive()`, so environments get
the live part at once and are offered the rest. `tools/check-templates.mjs` covers it, and
`tools/check-template-switch.mjs` edits and resets Travel.

**Who may export and import.** The host admin exports and imports any template on the console (the host routes in
"The host API: environments"). A single install's owner imports, exports any template it can see, and deletes
imported ones. On a hosted server an owner may only export the template their environment uses, read-only, so they
can take it to a single install; import and delete answer 403 `On a hosted server, the host manages templates.`
Both imports sit behind `sameOriginOnly`.

| Route (owner) | Answer |
|---|---|
| `PATCH /api/settings` `{ template: "<id>" \| "none", ...settings? }` | `{ settings, template, offer }`; any other fields save as before. 400 `There is no template called <id>.` or `A template is named by its id, or "none" for no template.` |
| `GET /api/environment/template` | `{ template, offer, choices }`: the view above (or null), the open offer (or null), and each template the environment can see that isn't hidden (plus the one it uses) as `{ id, name, description, source, version, hidden }` |
| `POST /api/environment/template/apply` `{ modules?: [ids], lobby?, spaceDefaults?, reactions?, theme?, iconSet?: boolean }` | `{ template, offer }`; ids not in the offer are ignored. 400 `Name the modules to turn on as a list of their ids.` or `<key> must be true or false.`; 409 `This environment has no template to apply.`, `This template has already been applied.` or `This server doesn't have the "<id>" template any more.` (the module and environment words are the environment's own) |

| `POST /api/templates/import[?id=<new id>]`, the file's text as the body | Single install only. 201 `{ template, dropped }`; 400 and 409 as the host's import; 403 `On a hosted server, the host manages templates.` |
| `GET /api/templates/:id/export` | The template file, for any template the environment can see; on a hosted server only the one it uses, else 403 `On a hosted server, the host manages templates.`; 404 `There is no template called <id>.` |
| `DELETE /api/templates/:id` | Single install only. `{ ok: true }`; 403 `Bundled templates can't be deleted.` or the hosted refusal; 404 as above; 409 `This environment uses this template. Switch to another one first.` (the environment's own word) |

`tools/check-template-switch.mjs` (in `npm run check`) covers switching, the offer and applying it, host templates
(made, used, edited, hidden, refused deletion, exported and imported) and a single install's imports.
`tools/check-templates.mjs` covers the new fields, template files, the update offer and the bundled versions.

### A space's own template

A space can read a template of its own ([plan-space-templates](../plans/plan-space-templates.md), #750; the routes are in [api-modules](../api/api-modules.md), "A space's own template"). Everything above is resolved once for the environment; this adds a second key, the space.

- **Stored.** A space record gains an optional `template: "<id>"` (`sanitizeSpace` keeps only a well-formed id, and never on the Lobby). Absent means the environment's. Nothing is "applied" to a space, so there is no record of it and no migration. `settings.spaceTemplates` is the owner's off switch (absent reads as on): off, `lookOf` answers the environment's for every space and the keys stay on the records. It is in the environment's copy (`SETTINGS_FIELDS` in `server/environment-export.js`).
- **Resolved.** `Store#lookOf(spaceId)` answers `{ words, verbs, phases, template }`. For a space with a usable `template` it takes the owner's own words (`settings.words`) over the space's template's words over the environment's template's, but only for the keys in `words.SPACE_KEYS` (`space`, `aside`, `canvas`, `module`, `object`, `moderator`, `member`, `guest`) and the verbs in `words.SPACE_VERBS` (`layout`); `environment`, `owner`, `home`, `host`, `admin` and the `enter` verb stay the environment's. Its phases are the template's own (`[]` when it has none: no chip), except for an aside, which reads the environment's phases. With no space, no `template`, the switch off or an id this server no longer has (logged once per id), it answers exactly what `resolvedWords()`, `resolvedVerbs()` and `templatePhases` answer. `Store#moduleDisplay(id, spaceId)` and `shownModule(manifest, spaceId)` do the same for a module's name and icon, the owner's own `settings.moduleNames` first. An aside reads the template of the space it was pulled out of (`spaceTemplateFor`).
- **The server's own sentences.** `server/words.js` `useCurrent` now reads `store.wordsNow()`: the words of the space the request is about, else the environment's. The space comes from a second `AsyncLocalStorage`, `spaceContext`, set by a router in front of every `/api/spaces/:id` route, and only when the viewer may enter that space (`spaceAccess.mayEnter`); for anyone else the answer to an id reads exactly as for an id that does not exist. The store reads it through `store.currentSpace()`, which answers only for the environment it was set in, so a callback that outlives its request never speaks for another's space (the same gotcha as above).
- **Reads.** `GET /api/spaces/:id` and the space lists carry `template`; `GET /api/spaces/:id/look` answers `{ look: { words, verbs, phases } }` for anyone who may enter, and 404 as an unknown id for everyone else, with no template id in any body and `Cache-Control: no-store`; `GET /api/guest-link/:token` carries `look`; the module context answers the space's `locale.words`, `phases` and `module` name and icon. The access key reads no template.
- **Choosing and refusing.** `updateSpace` and `addSpace` check a template through `chosenTemplate`: an id this environment's catalog can see, hidden ones only if the space already has it, 409 while the switch is off. Owners and the admin only: `template` is not in `MODERATOR_SPACE_FIELDS`. A host template, or a single install's imported one, that a space names cannot be deleted (409), and `usedBySpaces` counts them on the console.
- **Phase dates.** `updateSpace` checks `phases` against `phasesOfDraft(draft)`, the phases the space will read. Dates the record holds for ids the template lacks are kept and never fail a save; the page sends only the phases it shows.
- **In the pages.** `public/words.js` keeps the environment's words (and `localStorage`) as before and adds a scoped set: `setSpaceLook(look)` when `space.js` has read the space's look on entering, `clearSpaceLook()` on Home, another space or out, and `envWord(key)` for what is above a space (the switcher, the bell, Home). The scoped set is never written to `localStorage`. `public/template-choice.js` draws the choice in Set up's Space tab and the Add dialog; `public/admin.js` has the Manage switch and `public/host-templates.js` the console's "Used by". `tools/check-space-templates.mjs`, `tools/check-space-look.mjs` and `tools/check-space-template-choice.mjs` hold it. Read from the code on main; none of it was run in a browser or on a second environment for this document.

## The Studio alias

Removed in 0.4.0 (plan-names step 10). `server/studio-alias.js` added the old names Coffee Pub Studio read
(`tableName`, `serverName`, `rooms`, `activeRoom`, the old role values) to the answers of bearer-token requests.
Now `GET /api/me` and `GET /api/status` answer a bearer request exactly as they answer the pages, with roles
`admin`, `owner` and `member`. `tools/check-host-registry.mjs` asserts none of the old names comes back.

## The host's managed AI and shared files

Two things are the host's, above every environment, decided in the plan's "Managed AI" and "Shared files" sections.

- **Managed AI.** The host registry keeps one AI service per company (`host.json`'s `ai`: `openai`, `anthropic` and `compatible`, each with a model and a key, the last with an address), set on the console's Managed AI panel (`GET`/`PUT /api/host/ai` one company at a time, `POST /api/host/ai/models`, a key never in a view) only (no environment variable sets a key, a provider, an address or a model); a company with a key and no saved model uses the built-in default model for it (`DEFAULT_MODELS` in `server/ai.js`), so a key alone is enough. A company with a key (an address, for `compatible`) and a model is offered. Each environment's `Ai` is built with a `managed()` function that answers with the offered companies, and its own `ai.json` carries `source: 'managed' | 'custom'` and `managedProvider`: managed calls go out with that company's model and the host's key, custom ones with the environment's own; the enable step, the monthly allowance and the usage stay the environment's. A fresh environment starts managed on the first offered company. A fresh environment with no offered company starts `custom`. An `ai.json` that has a provider and a model but no key, which once worked only through a variable, now stays `custom`: nothing seeds the host's slot from it.
- **Shared files.** A `files` setting a module declares `"shared": "host"` (Maps' `map`) lives in `DATA_DIR/shared/<module>/<folder>/` for every environment, or in the module's own folder as before when there is no `BASE_DOMAIN`. The environment's settings view marks it `shared: true` and lists the host's files, its values answer every file, its file and region-cut routes refuse for that folder, and the host router carries the folder's own API (`/api/host/shared`, files, the region source address, the region cut). On the first start with `BASE_DOMAIN`, a missing shared folder takes the files of the one environment that has any.

The console page for both is `public/host.js` with the form and the region cut shared with the environment's pages (`public/ai-form.js`, `public/region-cut.js`), so a host admin and an environment admin see the same controls where they overlap.

## Phases 2 to 5: the owner, the caps, the calls, self-serve and billing

Built to the contract in plan-environments.md, "Phases 2 to 5 in detail". The owner is the environment's `owner` role (see "Roles" below; before step 4 it was `admin`, shown as Owner only on a hosted server), and the host's own cross sign-in (`environment.hostAdmin`) is the one viewer who still sees the host-only controls on Manage (uploading a module zip, running a module in the page). `GET /api/environment` gives an owner the plan and the usage; the caps are enforced at the seam, one thing at a time, with a 403 and a sentence: members on account creation, registration and invites; storage on uploads and pictures (the environment's directory measured at most once a minute and cached on the registry entry); assistant calls on `host.ai.ask` (counted per month on the entry); the module list on install and enable; calls at once on the join that would start a call (see "The calls cap" below). The plan catalog lives in `host.json` (`plans`, `free` always present) and an environment's plan carries the catalog's `name` beside its own caps. Sign-up is `POST /api/product/signup` on the free plan, rate-limited, and off unless `SIGNUP=on`; billing is the signed webhook `POST /api/host/billing` (`BILLING_SECRET`) with `paid`, `lapsed` and `cancelled`, an hourly sweep that degrades an environment past due for fourteen days to the free caps, and checkout pages that are configuration (`BILLING_CHECKOUT_<PLAN>`). An owner's export is the environment's zip; a deletion request is a mark on the registry entry the console shows and a host admin acts on.

### The calls cap

Counted from real calls (Thomas, 2026-09-30). Entering a space is never refused: it needs no LiveKit, and
`POST /api/guest-join` never asks the cap. A person is on the call when the register of who is where says so (the page
tells the server with `PATCH /api/spaces/:id/presence`), and a person is at LiveKit only after `POST /api/call/join`,
the one route that mints a call token. A space (or aside) counts as a running call while at least one person, not
hidden, is at its LiveKit call (`runningCalls() in `server/index.js`: LiveKit's calls that `spaceIdOfCall()` says are this environment's, with
their participants listed; never cached, so a call ending frees its place at once). The cap is asked just before a
join, by `POST /api/call/join` (`callsCapRefusal()`): joining a call already running is never refused, the person
joining is left out of the count (moving from one call to another never counts their own), and over the limit the
answer is 403 "This <environment>'s plan allows N call(s) at once; one is running in <space>". Two starts at the
same moment would both see a free place, so a start that passes holds its space's place for 15 seconds
(`CALL_START_HOLD_MS`, in memory for each environment, `callStartHolds`) until the person shows on the call; a
restart drops the holds, which only reopens that short window. `POST /api/asides` asks the cap before pulling anyone,
leaving the aside's members out of the calls they are in (if nobody stays behind, the aside takes that call's
place), and holds the new aside's place. When LiveKit cannot be asked, the cap fails open.

`usage.callsNow` counts the same way: `GET /api/environment` (`liveCallCount()`, 0 when LiveKit cannot be asked)
and the host console's `GET /api/host/environments` (`hostCallsNow()`, from one list of LiveKit's calls for the
whole host, and only for an environment whose plan caps calls; left out otherwise). The console's list therefore
waits on LiveKit when any environment has a calls cap: up to two seconds a request (the call service client's
timeout), one to list the calls and one for each call's participants.

The cap is enforced by the page asking first. A token can publish as soon as it is minted, so a modified page could
skip `POST /api/call/join`, as it could before; making the cap binding means granting publish only after the check.

## Adding a new module-level singleton

If you add a thirteenth thing like `store` -- built once from a data directory, read throughout the route
handlers by a bare name -- it needs the same three edits: construct it in `buildEnvironment` (using the real
instances already in scope there, not the Proxies), add its name to the object `buildEnvironment` returns, and
add a matching `const yourName = proxyFor('yourName');` near the others in `index.js`. If it needs flushing on
exit, add that to `flushEnvironment` too. If you wire an event listener on it at the point it is built (the
pattern every existing singleton with cross-singleton wiring uses), do that inside `buildEnvironment`, closing
over the real instances in that same call -- never at module scope in `index.js`, which now only runs once,
before any environment exists.
