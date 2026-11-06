# Security Assessment Plan

**Audience:** Thomas decides the scope, the order, the budget and how findings are handled. The project manager runs
it once he has. quality-assurance reviews (read-only, and probes a throwaway server); server-development and
bug-fixes fix; content-manager writes what the assessment leaves behind (the security notes, a SECURITY.md if wanted).

**Status:** draft, for Thomas to decide. Nothing in this plan is to be run until Thomas and the PM align on how findings are handled (his instruction, 2026-11-06).

Drafted 2026-11-06. Thomas, in his words as passed on by the project manager: the product is not released and has
no customers yet, so there is time; a full security assessment is coming; all reviews so far were done on a smaller
model and he wants a proper one; he decides separately when to run it. The trigger was GitHub #295 (a module's
live-update events crossing environments on a hosted server; fixed in #403) and its follow-up #406 (stream event ids
shared across environments, the notification and presence streams not audited, other shared state). This plan is
the proposal. Every "suggested" below is a suggestion; nothing under Decisions is decided yet.

## What exists today

Read as code only, 2026-11-06, on `origin/main`. Nothing here was run.

- **One process, many environments.** With `BASE_DOMAIN` set, each environment is built from
  `DATA_DIR/environments/<slug>/` and the request's host name picks it. Request handlers read `store`, `modules` and
  the rest through Proxies that forward to whichever environment `envContext` (an `AsyncLocalStorage`, `server/index.js`)
  resolved for the current request (`server/environment.js`, `buildEnvironment`). Anything that runs outside a request
  (a timer, an event handler, a callback after an `await` that lost its context) has to carry the environment itself.
- **Per-environment emitters, and one shared one.** `server/environment.js` makes `liveEvents`, `inviteEvents`,
  `themeEvents` and `moduleEvents` per environment. `server/object-sync.js` has one process-wide `bus`; since #403
  each event carries its environment and `listen(env, fn)` compares environments by object identity.
- **Process-wide state in `server/index.js`**, each to be checked for its environment key: the stream event counter
  (`eventIdOf`, `lastStreamEventId`), `refusals`, `callStartHolds` (keyed by slug), `guestChatPosts`,
  `liveStreamsOpen`, `presenceChanges`, `heldChatPictures`, `chatPictureSent`, `feedReads`, `externalAdds`,
  `vaultArriving`, `vaultSent`, `libraryInFlight`, `offeredImages`, `permsTurns`; and `imageCache` in
  `server/link-preview.js`. Timers in `server/arrival.js`, `server/module-hooks.js` and `server/vault-share.js`.
- **About 320 routes** registered in `server/index.js` (`app.*` and `hostRouter.*`), plus `server/vault-share.js`
  (`mountVaultShares`: the share routes and the public `/shared/:token` pages) and `server/old-links.js`. Access is
  checked by `requireUser`, `requireOwner`, `requireStream` (the access key), `requireHostAdmin`,
  `requireSpaceMember`, `requireCanInvite`, `moduleAccess(req, res, need)`, and inside handlers.
- **Six server-sent streams:** `GET /api/live`, `/api/notifications/stream`, `/api/modules/stream`,
  `/api/modules/:id/events`, `/api/modules/:id/region-cut/:jobId/stream` and the console's
  `/api/host/shared/:module/:folder/region-cut/:jobId/stream`; also `GET /api/bus/events`. All write through
  `sseWrite` (`server/stream-write.js`), which drops a reader that falls `LIVE_STREAM_BUFFER_MB` behind.
- **Sign-in** (`server/auth.js`, [plan-mfa](plan-mfa.md)): the `app_session` cookie, the console's `host_session`,
  personal links (`/j/:token`), guest links (`POST`/`DELETE /api/spaces/:id/guest-link`), the access key
  (`store.streamKey`, read by OBS pages through `requireStream`), two-step sign-in with `ENABLE_MFA`,
  `ADMIN_MFA_LOCKOUT_BYPASS` and `HOST_MFA_REQUIRED`, and `LoginLimiter` for failed attempts. `ADMIN_PASSWORD` is
  reset to its value on every start (`docker-compose.yml`).
- **Writes only from this origin** (`sameOriginOnly`, `server/index.js`): a cookie-carrying POST, PUT, PATCH or DELETE
  from another origin is refused, except `POST /login` (`CROSS_ORIGIN_EXEMPT`). Checked by `tools/check-origin.mjs`.
  GET requests that change state, and sign-in forced by another site, are #70.
- **Modules.** An uploaded module runs in a frame with `sandbox="allow-scripts allow-forms"` and
  `referrerpolicy="no-referrer"`, loaded from `/m/:id/:version/*path?tk=<secret>` (`public/module-host.js`); a bundled
  module runs in the page. An admin may switch an uploaded module to run in the page (`runModeOf`,
  `server/modules.js`). The SDK is `public/sdk/host.js`; server rules for module data are `server/module-guards.js`.
- **Content security policy** is a meta tag in 15 of the 18 pages in `public/` (`public/diag.html`,
  `public/popout.html` and `public/shared.html` have none in the file; `shared.html` gets its headers from
  `server/vault-share.js`). Vault files are sent with `nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`
  and PDFs always as `attachment`; the PDF viewer frame is `sandbox="allow-scripts"` only.
- **Files** (`server/vault-store.js`, `server/vault-types.js`, `server/vault-scan.js`, `server/vault-scan-worker.js`,
  `server/pdf-scan.js`, `server/pdf-viewer.js`, `server/image-clean.js`, `server/vault-share.js`). Two earlier rounds of
  security QA on the Vault are cited in the code ("security QA round 2").
- **Outbound requests.** `server/link-preview.js` resolves the host first and refuses private, loopback and link-local
  addresses, also after a redirect; `server/external-calendars.js` uses that guard. `server/ai-http.js` guards an
  owner's AI address (https only, no private address) on a hosted server, with `AI_ALLOW_HTTP` and
  `AI_ALLOW_PRIVATE_ADDRESSES` to loosen it (a warning on every start); in `server/ai.js` the guard is applied when
  `source === 'custom' && provider === 'compatible'`. `server/geocode.js`, `server/flight-lookup.js` and
  `server/region-cut.js` (which runs the `pmtiles` program on an https source address) also go out.
- **Private data at rest.** `secrets.key` (single server) or `host.json`'s `secretsKey` (hosted) encrypts two-step
  secrets, an environment's AI key in `ai.json` and other calendars' addresses; most else is plain JSON (area 8 sets
  out the whole scheme). #36 asks how sensitive data is stored and moved; the standing rule there is that modules
  never handle secrets.
- **Hosted mode** (`server/host-registry.js`, `server/domains.js`): the host console at `admin.<BASE_DOMAIN>`,
  self sign-up (`SIGNUP=on`, `POST /api/product/signup`, `signupLimiter`), the billing webhook
  (`POST /api/host/billing`, an HMAC of the raw body with `BILLING_SECRET`), backups and restores
  (`/api/host/environments/:slug/backup` and `/restore`), and an owner's `GET /api/environment/export`.
- **Supply chain.** Seven runtime dependencies (`package.json`), `Dockerfile` (`node:22-alpine`, the `pmtiles`
  binary pinned by version and sha256), the image `ghcr.io/drowbe/coffee-pub-collaborator` built by
  `.github/workflows/image.yml`, and three project workflows that use the `PROJECT_TOKEN` secret. The compose file
  pulls `livekit/livekit-server:latest`.
- **Checks that already touch security:** `check-auth`, `check-access-key`, `check-origin`, `check-secrets`,
  `check-links` (the two-environment case from #295), `check-streams`, `check-presence`, `check-module-guards`,
  `check-vault`, `check-vault-share`, `check-link-preview`, `check-host-registry`, `check-startup`.

## Goal, non-goals and done

**Goal.** Before the first customers, know where Collaborator can be broken into or made to leak, fix what matters,
and leave a check behind for each fix so it stays fixed.

**Not in it.** LiveKit's own server and its media security (only how Collaborator mints its tokens). The reverse proxy,
TLS set-up and the NAS (only what the guides tell people to do). Browser bugs. A formal certification. New features;
a finding that needs a feature (integration tokens, #64) gets its own plan.

**Done** (suggested; Thomas decides the launch rule, H4 below): every area below has a written report; every finding
has a severity, an owner and a state; nothing the launch rule names is open; each fix has a check that failed before
it and passes after; the human penetration test has run on a hosted server and its findings are handled the same way.

## The threat picture

**What the product protects.**

- People's data in spaces: chat, objects in modules, plans, places, budgets, who is in which space and when.
- Files in the Vault, and who can reach them through a share link.
- Accounts: passwords, personal links, two-step secrets and recovery codes, sessions.
- The host console, the host admin's account, environments' plans and billing state.
- Secrets the server holds: `secrets.key`, AI keys, `BILLING_SECRET`, `LIVEKIT_API_SECRET`, the access key.
- The LiveKit tokens: who may join which call, publish, and see whom.
- The server itself: its disk, memory, network position and uptime.

**Who might attack, and what they would want.**

| Who | What they start with | What they would want |
|---|---|---|
| A guest with a link | a guest link to one space | other spaces, members' names and data, files, a call they were not asked to; flooding the space |
| A member | an account in one environment | spaces they are not in, an owner's rights, other members' private data, another person's session |
| An owner of one environment | full rights in their own environment | another environment's data or streams, the host console, a free plan upgrade |
| A stranger on the internet | nothing | an account, the console, data through public pages (`/shared/:token`, sign-up, the landing page), the server's network (SSRF), downtime |
| A malicious module author | a module zip an admin installs | the session cookie, data from other modules or spaces, the server's file system on install, the host page if it runs in the page |
| Someone with a stolen access key or link | the OBS access key, a personal link, a share link | what that key reaches, and anything more than it should |
| The AI side | the AI provider, or text an AI reads (a web page, a pasted answer) | data sent to the provider beyond what is needed; an AI tool call that acts with more rights than the person asking (prompt injection) |
| A site the person visits | the person's browser, signed in | a change made as them (CSRF), signing them in as the attacker (login CSRF, #70) |

## The areas to assess

Each area: what to read, the questions to answer, what is already known, the method and a size. Sizes are S, M, L
for the review alone; fixes are sized when found. "Larger model" means the bulk of the reading benefits from it.

### 1. Environment isolation

- **Read:** `server/index.js` (`envContext`, the Proxies, `environmentFor`, every process-wide `Map` and timer named
  above, `eventIdOf`, the six streams and `GET /api/bus/events`); `server/environment.js`; `server/object-sync.js`;
  `server/presence-view.js`; `server/live.js`; `server/attention.js`; `server/module-bus.js`; `server/module-holds.js`;
  `server/module-hooks.js`; `server/arrival.js`; `server/vault-share.js`'s timer; `server/link-preview.js`'s cache;
  `server/host-registry.js`; how `VAULT_DIR/<slug>/` is chosen.
- **Questions:** Is every shared map, timer, cache, emitter and stream keyed by environment? Where can an `await`, a
  `setTimeout`, an emitter callback or a worker thread run with no `envContext`, or the wrong one? Does a stream in
  one environment ever hear another's events, ids or timing? Can a slug, a host name or a `Host` header choose the
  wrong environment? Does identity comparison in `listen(env, fn)` hold for every caller? Can one environment's load
  starve another (shared limits, shared memory caps)?
- **Known:** #406 (all three of its points). The #295 CHANGELOG entry says the notification and presence streams were
  not checked.
- **Method:** larger-model read; a live probe with two environments on a throwaway server (as `tools/check-links.mjs`
  already does for #295), one stream per kind open in each, events fired in the other.
- **Size:** L.

### 2. Sign-in, sessions, two-step sign-in, links and keys

- **Read:** `server/auth.js` (sessions, `userStamp`, TOTP, `LoginLimiter`); in `server/index.js` `POST /login`,
  `POST /api/login`, `/api/login/verify`, `/login/verify`, `/login/enrol`, `/j/:token`, `/api/me/mfa/*`, the host's
  `/api/host/login` and `/api/host/login/verify`, `POST /api/token`, the guest-link routes, `requireStream`, sign-up;
  `public/login.html`, `public/login-step.html`, `public/landing.html`; `docker-compose.yml`'s comments on
  `ADMIN_PASSWORD`.
- **Questions:** Cookie flags (`HttpOnly`, `Secure`, `SameSite`, domain) on every cookie, hosted and single. Can a
  session or pending token from one environment be used in another, or the console's in an environment? Does every
  door ask for the second factor, and does `ADMIN_MFA_LOCKOUT_BYPASS` reach only who it should? What does a guest
  link grant, how long, and how is it revoked? What does the access key reach beyond OBS pages? Are personal links
  stored in the clear (they are, per [plan-google-calendar](plan-google-calendar.md)), and is that acceptable? Is the
  limiter per address only, and what does that mean behind the proxy (`TRUST_PROXY_HOPS`)? Is a password compared in
  constant time? Are links and tokens long and random enough?
- **Known:** #70 (login CSRF on the exempt `POST /login`; GET requests that change state, beyond `/j/:token`); #64
  (integration tokens, not built); the lockout bypass; guest links.
- **Method:** larger-model read; probes on a throwaway server for each door and each cookie.
- **Size:** L.

### 3. Authorization on every route

- **Read:** every route in `server/index.js`, `server/vault-share.js` and `server/old-links.js`, with
  `ROLE_PERMISSIONS` and `hasOwnerRights` (`server/store.js`), `moduleAccess`, `server/module-guards.js`.
- **Questions:** For each route: who may call it (stranger, guest, member, moderator, owner, admin, host admin, access
  key), which space it acts on and whether the caller belongs to it, and whether an id in the path or body can name
  someone else's space, object, file or person. Which GET routes change anything (#70)?
- **Known:** known issue "Research's notes, links and answers have no owner on the server" (RS-01); decided exposures
  that are not findings: anyone signed in sees every space's name and member list ([plan-primary-nav](plan-primary-nav.md),
  decision 35).
- **Deliverable:** a route-by-route list, one row per route: method, path, middlewares, who may call it, the space
  check, and a mark where the review disagrees with the code. A small tool that prints the routes and their
  middlewares would make this mechanical and could become a check that fails on a new route with no access rule.
- **Method:** the tool (smaller model, server-development), then a larger-model read of the handlers it cannot judge;
  probes as a guest and as a member of another space.
- **Size:** L.

### 4. The module sandbox and the host API

- **Read:** `public/module-host.js` (the frame, `?tk=` secrets, the message handler), `public/sdk/host.js`,
  `public/module-frame.js`, `public/module-stream.js`, `public/module.html`, `public/popout.html`; `server/modules.js`
  (install from a zip with `yauzl`, `runModeOf`, permissions), `server/module-build.js`, `server/module-data.js`,
  `server/module-guards.js`, `server/module-uploads.js`, `server/module-settings.js`, the `/m/:id/:version/*path` route.
- **Questions:** What can a sandboxed module reach: cookies, the host page, other modules' data, other spaces, the
  network (`connect-src 'self' https:`)? Does every `host.*` call that the frame can make check the module's
  permissions on the server, not only in the page? Can a module zip write outside its folder (path traversal, links,
  huge or many entries)? What does a module running in the page reach, and should an admin be able to choose that
  for an uploaded module? Is the frame's `tk` secret scoped and short-lived?
- **Known:** #36's standing rule (modules never handle secrets); known issue "A change to a module's permissions needs
  a reload".
- **Method:** larger-model read; a deliberately hostile test module built by the check from code it writes itself,
  installed on a throwaway server.
- **Size:** L.

### 5. Files

- **Read:** the Vault files named above; `sendLibraryFile` in `server/index.js`; chat pictures
  (`POST /api/spaces/:id/chat/pictures`); `server/backgrounds.js`; picture maps; `public/file-viewer.js`,
  `public/file-viewer-views.js`, `public/sdk/pdf-viewer.mjs`, `public/shared.html`.
- **Questions:** Type sniffing against the name and claimed type; SVG and HTML anywhere they can be sent inline; PDF
  scan escapes; download headers on every route that sends bytes; share links (guessable, password, unlock limit
  `SHARE_UNLOCKS_PER_MINUTE`, ending, turning off); quotas and slow uploads; path handling in `VAULT_DIR`.
- **Known:** #401 (the first part, a PDF print in a pop-out or destination page, is being fixed); the Office files
  draft (#396, [plan-vault-office-files](plan-vault-office-files.md)) brings its own review.
- **Method:** larger-model read of what changed since the two earlier rounds; a corpus of crafted files written by
  the check itself, so no real malware sits in the repository.
- **Size:** M.

### 6. Outbound requests (SSRF)

- **Read:** `server/link-preview.js`, `server/ai-http.js`, `server/ai.js`, `server/ai-providers.js`,
  `server/external-calendars.js`, `server/ics-read.js`, `server/geocode.js`, `server/flight-lookup.js`,
  `server/region-cut.js`, the picture fetch behind `offeredImages`.
- **Questions:** Is the address checked at connection time, not only before (DNS rebinding)? Every redirect? IPv6,
  mapped and odd forms? Which outbound calls are not guarded (the managed AI, OpenAI or Anthropic addresses an owner
  can change, geocoding, flight lookup, the `pmtiles` source)? What do responses limit (size, time)? On a single
  server the owner is trusted with their own network: is that still right when an owner is not the server's admin?
- **Known:** `AI_ALLOW_HTTP` and `AI_ALLOW_PRIVATE_ADDRESSES`.
- **Method:** read; probes on a throwaway server with a local address, a redirect to one and a name that resolves to
  one.
- **Size:** M.

### 7. The AI and the Assistant

- **Read:** `server/ai.js`, `server/ai-tools.js`, `server/ai-context.js`, `server/ai-policy.js`, `server/action-catalog.js`,
  `server/prompts/`, [plan-ai-integration](plan-ai-integration.md).
- **Questions:** What leaves the server for the provider, and is it only what the person asked about? Whose rights
  does a tool call run with, and can text the AI reads (a web page, a pasted answer, an object another member wrote)
  make it act or reveal beyond the person asking? What does `AI_LOG_PROMPTS` keep, where, and for how long?
- **Method:** read; probes against the fake model the checks already use (`tools/check-ai-tools.mjs`).
- **Size:** M.

### 8. Protection of private data: how it is stored, retrieved and transported (#36)

Added at Thomas's word, 2026-11-06: "#36 I think this is really about how we store, retrieve, and transport private
data. Our encryption scheme, our storage scheme, etc. Probably related to the security scan that we will do as part
of that document." GitHub #36 is "Server: Decide how sensitive data (passwords, keys) is stored and moved" (open,
priority later). Its body: before any module handles sensitive data, decide how it is stored and transported; the
standing rule so far is that modules never handle secrets, and anything needing a key is a server-side hook the owner
configures. **#36 stays open, and is closed by the data protection scheme document this area ends in.**

This area is two things: a description of the scheme as it is (no guessing), and the decisions #36 asks for, which
are Thomas's.

**The scheme as it is.** Read as code only, 2026-11-06; each line is to be confirmed by the review.

- **Encrypted at rest**, with AES-256-GCM, a random 12-byte nonce per value and the tag kept with it
  (`encryptSecret` and `decryptSecret` in `server/auth.js`, stored as `aesgcm$...`): every two-step secret, live and
  pending, in an environment's `app.json` and for host admins in `host.json`; an environment's own AI key in
  `ai.json`; each person's other calendars' addresses. The key is `secretsKeyBuf()` in `server/index.js`:
  `DATA_DIR/secrets.key` (32 bytes, hex, set to mode 0600 on start) on a single server, `host.json`'s `secretsKey`
  on a hosted server. When a single install becomes hosted, `secretsToHostKey` re-encrypts them with the host's key
  and leaves the old `secrets.key` in the environment's folder.
- **In environment variables, in the clear:** `LIVEKIT_API_SECRET`, `AI_KEY`, `AI_OPENAI_KEY`, `AI_ANTHROPIC_KEY`,
  `BILLING_SECRET`, `ADMIN_PASSWORD` (written into the compose file or the container's settings).
- **In `app.json`, written whole with mode 0600 (`server/store.js`), not encrypted:**
  - `secrets.session`: the key every session cookie is signed with (HMAC-SHA256), `randomToken(32)`.
  - `secrets.stream`: the access key, `randomToken(18)`, compared in constant time (`hasStreamKey`), regenerated by
    `regenerateStreamKey`.
  - Password hashes: scrypt, a 16-byte random salt, 32 bytes out, Node's default cost (`hashPassword`; no cost is
    passed), compared in constant time.
  - Personal links (`linkToken`) in the clear, found by plain equality (`userByLinkToken`); guest links
    (`guestToken`, `randomToken(20)`) in the clear on the space.
  - Recovery codes are kept as hashes (`server/store.js`, `server/host-registry.js`); which hash is for the review.
  - Chat (`chat.json`, mode 0600 in `server/chat-history.js`), objects, people and settings: plain JSON.
- **Pictures and other files** that `server/store.js` writes are written with no mode given (the process's default).
- **Vault files** are kept as they arrived, under `VAULT_DIR/<slug>/`; nothing in `server/vault-store.js` encrypts them.
- **Sessions** are not stored: a signed token `{ u, s, t }` whose stamp (`userStamp`) folds in the password hash, the
  personal link and the two-step version, so changing any signs every browser out.
- **Backups and exports.** The console's backup (`POST /api/host/environments/:slug/backup`, host admin) and an
  owner's export (`GET /api/environment/export`, owner, hosted only) both zip the environment's whole data folder:
  so an owner's export carries the session signing key, every member's password hash, every personal and guest link
  and the encrypted secrets. `host.json` and its key are never in either. A restore elsewhere cannot read the encrypted
  values: two-step sign-in must be enrolled again and the AI key set again.
- **Logs.** With `AI_LOG_PROMPTS` set, prompts are written to the AI log (mode 0600, `server/ai.js`). What else reaches
  the console log is not yet known.
- **Transport.** TLS ends at the reverse proxy; the app sees http. Cookies are `HttpOnly` and `SameSite=Lax` and
  `Secure` only when the request is https or `X-Forwarded-Proto` says so (`isSecure`, `server/auth.js`); the
  `env_hint` cookie on the base domain is readable by scripts; the share unlock cookie is `SameSite=Strict` and
  scoped to its share's path. No `Strict-Transport-Security` header was found in `server/`. Tokens travel in addresses:
  `/j/<token>`, `?guest=<token>`, `?s=<access key>`, `/shared/<token>` and the module frame's `?tk=`. LiveKit media is
  encrypted by WebRTC between the browser and the LiveKit server; nothing here adds end-to-end encryption.
- **Retrieval.** `publicUser` shows only whether a person has two-step sign-in, never the secret; a personal link is
  shown to its person and to an owner. Pages must mask any password, secret, token or key field: the
  `unmaskedSecretInputs` rule in `tools/check-syntax.mjs` fails on one that is not.
- **Key management.** Nothing was found that rotates `secrets.key`, `host.json`'s `secretsKey` or `secrets.session`.
  Whether a single server's `secrets.key` is in any backup was not determined. Losing the key loses the encrypted
  values above, not the data.

**Read:** `server/auth.js`, `server/index.js` (`secretsKeyBuf`, `secretsToHostKey`, `hasStreamKey`, the backup,
restore and export routes, start-up), `server/store.js`, `server/host-registry.js`, `server/ai.js`,
`server/chat-history.js`, `server/environment.js`, `server/external-calendars.js`, `server/vault-store.js`,
`server/vault-share.js`, `tools/check-syntax.mjs`, `tools/check-secrets.mjs`, `Dockerfile`, `docker-compose.yml`,
[plan-mfa](plan-mfa.md).

**Questions the review answers:** Is each line above true? What else counts as a secret and is stored in the clear?
Which routes can read each stored secret, and does any API answer carry one it should not? What reaches the log?
Which tokens in addresses can leak through history, the proxy's log or a `Referer`, and which pages set a referrer
policy? Is the cookie `Secure` behind every proxy the guides describe? What happens to every secret on a restore, a
move to hosted, a deleted person and a deleted environment?

**Questions only Thomas can answer for this area:**

1. Must data at rest be encrypted beyond secrets (chat, objects, Vault files), or is the disk's own encryption the
   answer, said in the guides?
2. May the host operator be able to read environments' data? Today a host admin can, through the backup and the disk.
3. Should an owner's export carry the session signing key, password hashes and links, or a copy without them?
4. Personal links and the access key: stored in the clear as now, or hashed and shown once (as #64 and
   [plan-google-calendar](plan-google-calendar.md) do for their tokens)?
5. Key management: is rotation needed before launch; where does an operator keep a copy of `secrets.key`; what does a
   restore without it promise?
6. What does the product promise customers about their data, in words (the guides, the product pages)?
7. Does the standing rule stay: modules never handle secrets, and anything needing a key is a server-side hook the
   owner configures?

**Deliverable:** once Thomas has decided, a short data protection scheme document in `documentation/architecture/`,
written by content-manager: what is a secret, where each may live, how it is stored, retrieved and moved, how keys
are kept and replaced, what a backup and an export carry, and what modules may never do. That document closes #36.

**Method:** larger-model read; probes on a throwaway server (file modes after a fresh start, the cookies behind a
proxy that sends `X-Forwarded-Proto`, an owner's export opened and listed).

**Size:** L (M for the review, plus the decisions and the document).

### 9. CSRF and origin handling

- **Read:** `sameOriginOnly`, `CROSS_ORIGIN_EXEMPT`, the routes that name `sameOriginOnly` again, `baseUrl()` and
  `X-Forwarded-*`, every GET route that writes, the billing webhook (no cookie).
- **Questions:** Is "neither header" (old browsers, curl) safe to pass? Can `X-Forwarded-Host` be chosen by a client
  past `TRUST_PROXY_HOPS`? Is the console's `host_session` treated the same? Login CSRF.
- **Known:** #70.
- **Size:** S.

### 10. Rate limits and abuse

- **Read:** `LoginLimiter` and every use of it; `chatPostLimited`; `moduleLimits`; `overLimit`; the stream caps
  (`LIVE_STREAMS_PER_PERSON`, `LIVE_STREAMS_PER_GUEST_LINK`); presence (`PRESENCE_CHANGES_PER_MINUTE`); Vault quotas;
  `REQUEST_BODY_SECONDS`; sign-up.
- **Questions:** Which routes have no limit and cost the server much (zip install, PDF scan, AI, link previews,
  exports)? Can one person or guest flood every stream with events? Can one environment exhaust a shared cap?
- **Method:** read, then load probes on a throwaway server only.
- **Size:** M.

### 11. LiveKit tokens and the paths without LiveKit

- **Read:** `POST /api/token`, `server/call-names.js`, `callStartHolds`, [plan-realtime-optional-livekit](plan-realtime-optional-livekit.md).
- **Questions:** Who may get a token for which call, with which grants, for how long; can a guest or a member of
  another space get one; is the identity in it chosen by the server; what answers when there is no call service.
- **Not checkable here:** anything that needs a real LiveKit server (there is none locally).
- **Size:** S.

### 12. Hosted mode

- **Read:** `server/host-registry.js`, `server/domains.js`, `server/migrate-names.js` (only what it trusts), the
  `hostRouter` routes, sign-up, the billing webhook, `PRODUCT_DOMAIN`, `RESERVED_SLUGS`, `PREVIOUS_BASE_DOMAINS`,
  `public/host.html`.
- **Questions:** Can a slug or host name collide with the console or the product pages? Can an owner change their
  own plan or caps? Is the webhook's HMAC compared in constant time, and can a message be replayed? What can a host
  admin's stolen session do, and is the console's two-step requirement on by default (it is off, `HOST_MFA_REQUIRED`)?
- **Size:** M.

### 13. Supply chain

- **Read:** `package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore`, `.github/workflows/*.yml`,
  `public/sdk/pdfjs`, the Font Awesome and LiveKit client files the pages load.
- **Questions:** Known vulnerable versions (`npm audit`); actions pinned by tag, not by commit; what `PROJECT_TOKEN`
  can do and which workflows can read it (they run on `issues` events and by hand); who can push to `latest`; whether
  the image runs as root; `livekit/livekit-server:latest` in the compose file.
- **Method:** read and tools; a smaller model is enough.
- **Size:** S.

### 14. Backups, restore and deletion

- **Read:** the host backup and restore routes, `GET /api/environment/export`, `POST /api/modules/:id/data/restore`,
  `server/space-erase.js`, deleting a person, an environment and a file.
- **Questions:** Can a restored zip write outside its folder or bring in a different environment's keys? Does
  deleting a space, a person or an environment remove their Vault files, chat history and sessions? What does an
  export carry that its reader should not see?
- **Size:** M.

## Method, for every area

- **Read-only review first**, by quality-assurance on a larger model, with the area's scope, questions and this plan.
- **Targeted live probes** only on a throwaway server (`DATA_DIR=/tmp/<name>`, a second `PORT`, and for hosted
  cases `BASE_DOMAIN` with two environments), never on Thomas's host, and only if Thomas allows it (H7).
- **A check proposed for each finding**: the case a tool in `tools/` would test, written so it fails before the fix.
- **Each claim labelled** "verified live", "checked by a tool" or "read as code only", as `CLAUDE.md` asks.

## Order and cost

- **First: environment isolation** (area 1), per #406. It is the one with a known leak behind it.
- **Then, one at a time:** sign-in (2), authorization (3), the module sandbox (4). These are the large ones.
- **Can run beside another** because they read different files: supply chain (13) and CSRF (9) with anything; files
  (5) with outbound requests (6).
- **Private data (8)** can start early and beside another area: its first half is a description, and its decisions
  are Thomas's and take time. It reads many of the files area 2 reads, so not in the same session as area 2.
- **Last:** rate limits (10), the AI (7), LiveKit (11), hosted mode (12), backups (14), then a re-read
  of everything fixed.
- **Model and budget.** The bulk of the reading (areas 1 to 8, 12 and 14) benefits from a larger model; the route
  tool, the supply-chain pass and writing checks do not. Usage is limited, so suggested: one area per session, a stop
  after each with its report, and Thomas says go before the next. An area that runs over its size stops and reports
  what it covered rather than finishing on a smaller model without saying so.
- **A human penetration test** belongs after the internal areas are fixed and before the first paying customers, on
  a hosted test server with two environments, the console, sign-up and share links on. It finds what a reviewer who
  reads the code does not think to try.

## How findings are handled: the decision before anything runs

Each of these is Thomas's. Suggestions are marked.

**H1. The severity scale, and who sets it.**
A) Four levels in plain words: **critical** (a stranger or another environment gets data or control), **high** (a
signed-in person gets past their role or space, or a secret leaks), **medium** (needs unlikely conditions, or leaks
little), **low** (hardening). The reviewer proposes, Thomas confirms. *(suggested: simple, and he sees every one)*
B) CVSS scores. More precise, slower, and unfamiliar to whoever reads the issue later.
C) The reviewer sets it and it stands. Fastest; no second look.

**H2. Where a finding goes first.** The repository is public (the GitHub API answers `visibility: public`), so a
public issue for an unfixed hole tells anyone how to use it.
A) Every finding becomes a public issue at once (`Server: ...`, `Settings: ...`), with a `security` label and a
priority. Simple; publishes open holes. The `security` label does not exist yet; the labels today are `bug`,
`critical`, `priority: now`, `priority: next`, `priority: later` and GitHub's defaults.
B) Critical and high go first to a private place: a draft security advisory on the repository (private to its
maintainers) or a private list outside the repository. They become public issues once fixed. Medium and low go
straight to public issues with the `security` label. *(suggested)*
C) Everything private until launch, then public.
Already public, and staying so: #406, #70, #64, #36, #401.

**H3. Who may fix what.**
A) Every security fix is held on its branch for Thomas, as the overnight rule in `.claude/agents/project-manager.md`
already holds "security or the server's stored data". Critical fixes start at once; the rest are batched per area.
*(suggested)*
B) As A, but low findings outside sign-in, sessions, stored data and hosted isolation may merge like small fixes after
QA.
Either way, fixes to sign-in, sessions, stored data and environment isolation are always held for Thomas.

**H4. What blocks a launch.**
A) No critical or high open; each open medium has Thomas's written choice (fix, accept, later). *(suggested)*
B) Nothing above low open.
C) Only critical blocks.

**H5. How a finding is shown fixed.** A check in `tools/` that fails with the fix removed and passes with it, run by
quality-assurance, not the fixer, as #295's two-environment case in `tools/check-links.mjs` was. A finding that no
tool can test (a real LiveKit call, a phone) says so, and Thomas decides whether it closes. *(suggested; no real
alternative is offered here, only how strict to be)*

**H6. How reports are written.** One per area: what was read (files and functions), what was run (commands, on which
server), what was not covered and why; each finding with its proposed severity, its evidence label, the attacker from
the threat picture, a suggested fix and the check that would prove it. Where it is kept follows H2. *(suggested)*

**H7. Live probes.**
A) None: read-only only. Safe; misses what only shows when run.
B) On a throwaway local server only, made by the reviewer for the probe and deleted after. *(suggested)*
C) B, plus Thomas's own host, only in a window he names.

**H8. A finding in someone else's dependency.** Suggested: report it privately to that project as its security policy
asks, pin or patch around it here, and keep it as a finding with the upstream link until upstream fixes it.

**H9. Disclosure and logging.** Suggested: a running log of findings in the H2 private place; a CHANGELOG line per
fix written so it does not give a recipe while older images are still in use; and before launch a `SECURITY.md` that
says how outsiders report a hole (content-manager writes it once Thomas says how he wants reports to reach him).

## Decisions

None yet. Thomas decides H1 to H9 and the questions below before anything runs.

## Left to build, in order

No step starts before Thomas approves this plan and has answered H1 to H9. Sizes are S, M, L.

| # | Step | Size | Owner | Depends on |
|---|---|---|---|---|
| 0 | Record Thomas's answers to H1 to H9 and the questions in this plan | S | product-planner | Thomas |
| 1 | Set up the H2 private place, and the `security` label if wanted | S | project manager | 0 |
| 2 | The route tool: print every route with its middlewares (smaller model) | M | server-development | 0 |
| 3 | Area 1, environment isolation: review and probes | L | quality-assurance | 0 |
| 4 | Fixes for area 1, each with its check; held for Thomas | M to L | server-development | 3 |
| 5 | Verify area 1's fixes (H5) | S | quality-assurance | 4 |
| 6 | Area 2, sign-in and sessions | L | quality-assurance | 0, after 3 for budget |
| 7 | Area 3, authorization, from the route tool's list | L | quality-assurance | 2 |
| 8 | Area 4, the module sandbox | L | quality-assurance | 0 |
| 9 | Areas 9 and 13, CSRF and supply chain (beside any other) | S | quality-assurance | 0 |
| 10 | Areas 5 and 6, files and outbound requests | M | quality-assurance | 0 |
| 11 | Area 8, private data: confirm the scheme as it is, answer the review's questions | M | quality-assurance | 0 |
| 11a | Thomas decides area 8's seven questions | S | Thomas, recorded by product-planner | 11 |
| 11b | The data protection scheme document in `documentation/architecture/`; closes #36 | S | content-manager | 11a |
| 11c | Areas 7, 10, 11, 12, 14 | M each | quality-assurance | 0 |
| 12 | Fixes for steps 6 to 11c, batched per area (H3); held for Thomas | per finding | server-development, bug-fixes | each area's report |
| 13 | Verify each batch (H5) | S each | quality-assurance | 12 |
| 14 | A re-read of everything fixed, on a larger model | M | quality-assurance | 13 |
| 15 | The human penetration test on a hosted test server | L | outside tester, Thomas | 14 |
| 16 | Documentation: the security notes in the architecture documents, `SECURITY.md`, the guides' advice | S | content-manager | 14, H9 |

## Verify

- Each finding: H5's check, run by quality-assurance.
- Each area: its report states what was read, what was run and what was not.
- Not checkable without a real LiveKit server: whether a minted token works as granted in a call (area 11). Not
  checkable here at all: the reverse proxy and TLS of a real install.

## Questions for Thomas

Most important first.

1. **Where do findings go first, given the repository is public?** (H2)
2. **What blocks the launch?** (H4)
3. **Is the first launch hosted** (environments, sign-up, billing) **or self-hosted single environments?** It moves
   hosted mode (area 12) and isolation's weight up or down.
4. **How much larger-model use may the assessment take**, and is "one area per session, stop after each" right?
5. **May reviewers probe a throwaway server** (H7)?
6. **Private data (#36):** must data at rest be encrypted beyond secrets, and may the host operator read
   environments' data? The other five questions of area 8 follow from these two.
7. **Who confirms severity** (H1)?
8. **May an admin run an uploaded module in the page** at all before launch? It decides how much of area 4 is a
   finding and how much is a choice he made.
9. **A human penetration test:** whether, when, and at what cost.

## What could not be determined, and what was assumed

- **Not determined:** whether draft security advisories can be written by the agents through `gh api`; whether
  geocoding and flight lookup use fixed provider addresses or ones an owner can set; whether the `pmtiles` source
  address is checked for private addresses; the exact count of routes (about 320 by a pattern search, which misses
  any registered another way); what the console log may contain; whether a single server's `secrets.key` is in any
  backup; the file mode of pictures written without one (it depends on the container's umask); whether the image runs as root (the `Dockerfile` sets no
  `USER`, read only).
- **Assumed:** quality-assurance does the reviews, since it reviews without changing code; the existing checks named
  above pass on `main`; the two earlier rounds of Vault security QA stand unless a change since says otherwise.
