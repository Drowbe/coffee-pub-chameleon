# First Password Plan

**Audience:** Thomas, who decides how a new owner sets their first password; server-development, who builds the routes,
the stored field and the checks; experience-design, who builds the "choose your password" page; quality-assurance, who
runs a security read with live probing; and content-manager, who documents it.

**Status:** approved for building, 2026-11-08. Drafted the same day by the planner for slice 3a of
[plan-product-site](plan-product-site.md) (its decision 17 and open question 2). Thomas, 2026-11-08, looking at the
start page on the Prototype: "I like all the A options". Then, in chat, he approved Design A as written and decided the
recovery, the password rule and the register rule (Decisions 3 to 6). Nothing is built.

## What it is today

On `origin/main` at `1ab9ea9`. Slice 0 of the product site plan is in: `GET /api/product/environments`, `POST /login`
and `CROSS_ORIGIN_EXEMPT` are gone, and `GET /api/product/environment` already shares the 120 a minute limit
(`addressLimiter`), so slice 3a's "limit fix-up" is done.

**Sign-up** (`POST /api/product/signup`, `server/index.js`, about line 2930). At the product host only, off unless
`SIGNUP=on`, five tries an hour per address (`signupLimiter`, every try counted). It takes
`{ slug, name, template, owner: { login, displayName, password } }`, refuses a missing login or password, then:
1. `hostRegistry.addEnvironment()` makes the registry entry (the slug checked for shape, reserved words and taken, then
   saved at once);
2. `environmentFor(slug).store.addUser()` makes the owner with `passwordHash: auth.hashPassword(owner.password)`;
3. answers 201 `{ url }`, the new environment's `https://<slug>.<base>[:port]/login?login=<owner>`.

The start page's script (today `public/landing.js`) sends the person to `url` with `location.href`. The sign-in page
(`public/login.js`) fills the login from `?login=`, and the owner types the password they chose a moment ago.

The handler is synchronous from start to end (no `await`), so two sign-ups for the same address cannot both pass the
taken check in one server process.

**Hashing.** `auth.hashPassword()` is scrypt with a 16-byte salt (`scrypt$<salt>$<hash>`); `verifyPassword()` compares
with `timingSafeEqual`.

**Password rules.** The server checks only that a password is not empty, for sign-up, the console's first owner,
Manage's new person, `/api/register` and invites. The old sign-up form asked for 8 to 200 characters in the browser
(`minlength="8" maxlength="200"`). Only a new host admin (`POST /api/host/admins`) is held to 8 characters on the server.

**Sessions and the pending step** (`server/auth.js`). A session is a signed `app_session` cookie for 30 days whose
stamp folds in the password hash, the personal link and `mfa.version`. The pending token (`issuePending`,
`readPending`) is the same signed shape for 10 minutes, naming the person, the environment's slug and a purpose
(`verify` or `enrol`), carried in the `mfa_pending` cookie. Both are signed with the environment's own session secret.

**The sign-in limiter.** `limiter`, per environment: 10 failed tries per address in 15 minutes, then 429.
`POST /api/login` and `POST /api/login/verify` use it.

**Ways into an account, and what each needs:**
- `POST /api/login`: `resolveLoginUser()` needs a stored `passwordHash` that matches; an account with none never
  signs in by password. If no ordinary account has the login, the host admins' logins are tried (the host admin's
  cross sign-in, role `admin`).
- `/j/<token>`: the personal link, `linkToken` on the account; made only by an owner in Manage.
- `/api/register`: a new member, only while `settings.allowRegistration` is on. Off by default; a template may turn it
  on (`server/templates.js`, `SETTINGS`). Neither bundled template (`templates/travel.json`, `templates/games.json`)
  does.
- `/invite/<token>`: a new member, from an invite an owner made.
- `/guest/<token>`: no account; a space's guest link, made by a member who may invite.
- Two-step routes (`/api/me/mfa/*`, `/api/login/verify`): a session, or a pending token from a first factor.

**Recovery today.** There is no email. The console can reset an owner's second factor
(`DELETE /api/host/environments/:slug/owners/:login/mfa`) but has no password reset. A host admin can sign in to the
environment with their own login (the cross sign-in) and set the owner's password or make a personal link in Manage,
then pass it on by hand.

**Fields an account keeps.** `Store#sanitizeUser()` (`server/store.js`) rebuilds every account from a fixed list of
fields when the data is read, so a field it does not know is dropped. The owner's export
(`server/environment-export.js`) is built from allow-lists, and `tools/check-environment-export.mjs` fails on a field
that is on neither `USER_FIELDS` nor `USER_LEFT_OUT`.

**Headers.** `/login` and its steps are framed by the same site only (`FRAMED_HERE_PATHS`). `login.html` carries a
Content-Security-Policy with `script-src 'self'`. Every write must come from the same origin (`sameOriginOnly`), and
the JSON parser reads only `application/json`. The server writes no request line, query or body to its log.

## Why

With no password at sign-up there is a moment when the environment and its owner exist and nobody has a password.
Something must let the person who signed up, and only that person, set it on the environment's own page. The two pages
are on different sites (`chameleon.coffeepubstudio.com` and `<slug>.coffeepubstudio.live`), so a cookie cannot carry
it, and the start page must not post anything to the environment (product site decision 3).

## Decisions

Thomas's, 2026-11-08 (product site decision 17, "I like all the A options"):

1. **The start page's sign-up form has no password field.** Reason: no password on the start page, not even a new one,
   so people never learn to type an environment's password on another site.
2. **The new environment's own page asks for the first password.** Reason: the password is typed only on the
   environment's own address. It needs a server change (this plan).

Thomas, 2026-11-08, in chat:

3. **Design A is approved as written:** a single-use token in the address fragment, 15 minutes, hashed in storage,
   exchanged on the environment's own page for a "choose your password" step, the same 401 for every failure, and the
   normal two-step gate after. Reason: the password is typed only on the environment's own address and the token
   cannot be guessed or reused.
4. **Recovery when the link is lost or expired** is a host-console action, "New first-password link", for that
   environment. The host admin sends the owner the link. It lives 24 hours and is single use. No email. Reason: it does
   not depend on the cross sign-in and the host admin never learns the password.
5. **Password rule:** 8 to 200 characters, enforced on the server for the first password. Reason: the rule the old
   form asked for.
6. **Self sign-up (`/api/register`) is refused** while an environment is waiting for its owner's first password.
   Reason: nobody should arrive before the owner.

Recommendations, followed unless Thomas objects (2026-11-08):

7. **The words a person reads** are as written in this plan; experience-design may tighten them on the page.
8. **The sign-in page says nothing** during the window (no "waiting for its owner").

Also noted: sign-up today makes the environment before it checks the owner's login, so a login of only spaces leaves an
environment with no owner. Step 1 fixes it by checking the login first.

## The recommended design: Design A, a one-time token in the address's fragment

*A suggestion, not a decision.*

### The flow, step by step

1. **The start page sends** `POST /api/product/signup` (same origin, the product host)
   `{ slug, name, template, owner: { login, displayName } }`. No password.
2. **The server checks the owner's login first,** before anything is made (cleaned as `cleanLogin()` cleans it, not
   empty). Then it makes the environment (`addEnvironment()`) and the owner with **no password hash**, no personal link
   and no second factor.
3. **The server makes a token:** 32 random bytes from `crypto.randomBytes`, written in base64url (43 characters, 256
   bits). It stores on the owner's account only the token's SHA-256 and when it ends:
   `firstPassword: { hash, expiresAt }`. The token itself is never stored or logged. A fast hash is enough for a random
   256-bit token (the calendar feed's token is kept the same way).
4. **The server answers** 201 `{ url }` with `Cache-Control: no-store`, where `url` is
   `https://<slug>.<base>[:port]/login/first-password#<token>`. The token is in the **fragment** (after `#`), never in
   the query.
5. **The start page** saves `{ slug, name }` to Recent and opens `url` in the same tab (`location.href`). It does not
   show, store or log the token.
6. **The browser** asks the environment for `GET /login/first-password`. The fragment is not part of the request: it
   is not sent to the server or the proxy, not written in any access log, and never in a `Referer` header.
7. **The page** (`login-first-password.html` and `.js`, only its own script) first reads `location.hash`, then removes
   it from the address at once (`history.replaceState(null, '', '/login/first-password')`), and keeps the token in one
   variable only, never in storage.
8. **The page exchanges it:** `POST /api/login/first-password` `{ token }`. The server hashes the token, finds the
   owner in this environment whose `firstPassword.hash` matches, not expired and still without a password, and **spends
   the token at once**: the hash is removed and `firstPassword` becomes `{ claimedAt, expiresAt }`. It sets a pending
   token (the `mfa_pending` cookie, `httpOnly`, host-only, 10 minutes) with the new purpose `first-password`, naming
   this owner and this environment. It answers 200 `{ login, displayName, environmentName }`.
9. **The person chooses a password** on the same page. A reload still works for 10 minutes, because the cookie, not the
   address, now says who it is.
10. **The page sends** `POST /api/login/first-password/set` `{ password }`. The server reads the pending cookie
    (purpose `first-password`, this environment), checks the account is still an owner with no password and a claimed
    `firstPassword`, checks the password rules, hashes it with `auth.hashPassword()`, stores it, removes `firstPassword`
    and clears the pending cookie.
11. **Then the normal sign-in finish:** `mfaGate()`, as `POST /api/login` does. If the environment requires a second
    step for this owner, it sets the `enrol` pending token and answers `{ mfaRequired: true, enrol: true }`; the page
    goes to `/login/enrol`. Otherwise it sets the session and `env_hint` and answers `{ user }`; the page goes to `/`.

### Lifetime, single use, binding

- **15 minutes** from sign-up to the exchange. The start page opens the address the moment sign-up answers, so the
  exchange normally happens within seconds.
- **One use.** The exchange removes the hash before it answers. The exchange and the set are synchronous (no `await`
  between the check and the write), so two exchanges of one token cannot both succeed.
- **Bound to the environment:** the hash is stored in that environment's own data, so the token is found only at that
  environment's address. **Bound to the owner:** it names exactly one account. The pending cookie names the account's
  key and the slug and is signed with that environment's secret, so a cookie from a sibling environment (including one
  set for the whole base domain by another environment's page) is refused.
- After the password is set, the token, the claim and the pending cookie are all dead.

### What the owner's account holds before the password is set

`passwordHash: null`, `linkToken: null`, `mfa: null`, `firstPassword: { hash, expiresAt }` (then `{ claimedAt,
expiresAt }`). With no hash, every other door is shut or no different from any new environment:

| Door | Before the first password |
|---|---|
| `POST /api/login` with the owner's login | Fails as a wrong password does (401, the same sentence); the host admin fallback is not tried because an ordinary account has the login |
| `/j/<token>` | No link exists; only an owner (none is signed in) or the host admin can make one |
| `/invite/<token>` | No invite exists; only an owner can make one |
| `/guest/<token>` | No space has a guest link; only a signed-in member can turn one on |
| `/api/register` | Off unless the template turned it on; refused while the owner has no password (Decision 6) |
| `/api/me/mfa/*`, `/api/login/verify` | Need a session or a `verify` or `enrol` pending token; a `first-password` pending token is refused by its purpose |
| The host admin's cross sign-in | Works, as it does for every environment. It is the recovery path, not a hole |

### What anyone else sees during the window

The sign-in page at the address looks like any other: it says nothing about "not set up yet". The address already
shows the environment exists (the start page's check tells anyone that), so a note would reveal little, but it would
tell a visitor the environment is new and its owner has not arrived, which helps nobody but an attacker. A wrong,
expired, used or missing token on `/login/first-password` always gets the same answer (Decision 7 for the words):
"This link has expired or was already used. Ask whoever runs this host for a new one." It never says whether a login
or an owner exists.

### When the token is lost or has run out

The person closed the tab, the address never loaded, or more than 15 minutes passed. There is no email, so the person
cannot get a new link by themselves, and signing up again with the same address is refused (it is taken). Three ways
back were weighed; Thomas chose the second (Decision 4):
- **The host admin's cross sign-in, as today:** the host admin signs in at the environment, opens the owner in Manage
  and sets a password or makes a personal link, and passes it on by hand. Nothing new to build. Costs: the host admin
  knows the password until the owner changes it; and it fails when the owner chose the same login as a host admin,
  because the cross sign-in is refused where an ordinary account has that login.
- **A new console action, "New first-password link":** `POST /api/host/environments/:slug/owners/:login/first-password`
  makes a fresh token for an owner who still has no password and answers its address once, for the host admin to pass
  on. Same exchange, same page. It does not depend on the cross sign-in, and the host admin never knows the password.
- **An unclaimed environment is removed after a time** (for example 24 hours with no first password), which frees the
  address so the person can sign up again. Costs: a sweep, and a removal path for environments that is new.

### Brute force and limits

- 256 random bits cannot be guessed.
- The exchange still counts every failure on the environment's sign-in limiter (`limiter`, 10 in 15 minutes per
  address, then 429), so a flood is cut off and failures share the count with wrong passwords.
- The server hashes the given token before it looks anything up, so timing tells nothing about a near miss.
- Sign-up keeps its own limit (five an hour per address).

### Password rules and hashing

Hashing is today's: `auth.hashPassword()`, scrypt. The rule: the old form asked for 8 to 200 characters in the browser,
and the server checked only "not empty". The set step checks **8 to 200 characters on the server** (Decision 5),
so the first password meets the rule the form used to ask for.

### Two-step sign-in

The set step ends with `mfaGate()`, exactly as `POST /api/login` does, so the environment's own requirement
(`settings.mfaRequired`, which a template may turn on), the lockout bypass (`ADMIN_MFA_LOCKOUT_BYPASS`, which excuses
owners) and `ENABLE_MFA` apply unchanged. When a second step is required the owner goes to `/login/enrol` and is signed
in only once it is set up. When it is not required, nothing is asked, as at any other sign-in; the owner can turn it
on in their profile. `HOST_MFA_REQUIRED` is about host admins and does not apply to owners.

### Threat model

| Who or what | What they could get | Why Design A holds |
|---|---|---|
| Server, proxy or CDN logs | The token | It is in the fragment, which is never sent; the exchange carries it in a POST body, which nothing logs |
| Someone who knows the address and the login | The environment, before the owner arrives | Without the token nothing they send works; the login is not the key |
| Browser history, a synced history, a screenshot, an extension that reads addresses | A copy of the address with the token | The page removes it from the address bar on load and the exchange spends it within a second, so a copy found later is dead |
| A script on the environment's page | The token while it is in the page | The page loads only its own script (`script-src 'self'`); no module frame, no third-party script; the token is not in storage |
| Guessing | A working token | 256 bits, and the sign-in limiter |
| A token used at another environment | That environment | The hash is only in its own environment's data |
| Replaying the token, or the pending cookie, after the password is set | A second password change | Both are dead once the password is set |
| A sibling environment setting a cookie for the base domain | A forged pending step | The pending token is signed with this environment's secret and names its slug |
| Another site posting to the exchange | A login-CSRF | Writes with a cookie must be same origin; a body that is not `application/json` is not read |
| Someone on the network | The token in transit | HTTPS on the live install; only local development is plain `http` |

What Design A does not protect against: someone who controls the owner's own browser or device during the minute of
sign-up; a host admin, who can already reach every environment.

## The alternatives

- **B. A first-sign-in setup page keyed by the owner's login.** The environment's sign-in page, seeing an owner with no
  password, offers "choose your password" for that login until it is set. No secret travels. *Rejected:* for the whole
  time until the owner's first visit, which has no end, anyone who knows the address (public, and checkable on the start
  page) and guesses the login (often a first name) owns the environment. Tying it to the browser that signed up would
  need a cookie, which cannot cross from `.com` to `.live`.
- **The password field on the start page, posted only to the product host (today's behaviour).** Technically sound:
  HTTPS, same origin, hashed at once. *Ruled out by Thomas* (decisions 1 and 2, product site decisions 3 and 17): the
  person would type the environment's password on another site, and their browser would save it for the wrong
  address.
- **An email link.** *Not possible:* there is no mail service and no email on accounts (product site decision 2).
- **A one-time password made by the server and shown once on the start page,** changed at the first sign-in. For it:
  no new step on the environment's sign-in, it uses the normal sign-in and its limiter, and it survives a lost tab,
  because the person has it written down, so no recovery path is needed in the first minutes. Against it: it is a
  working password shown on another site, which is close to what decision 1 rules out; the browser offers to save it
  for the start page's address, the wrong one; to be useful after a lost tab it must live for hours, not seconds, and
  it sits in screenshots, notes and clipboard tools all that time; and "change it at first sign-in" is still a new
  forced step on the environment's page, so it does not save the page Design A needs. *Not recommended.* If Thomas
  prefers to have no recovery path, this is the honest second choice, with a short life (one hour) and the forced
  change.
- **The token in the query (`?token=`) instead of the fragment.** *Rejected:* a query is sent to the server and the
  proxy and lands in their access logs.
- **A one-step page** that keeps the token in the page and sends it with the password (`{ token, password }`), with no
  exchange. One route fewer. *Not recommended:* the token in the address stays live until the password is chosen, and
  a reload loses it (the page already removed it from the address), so the person is locked out by pressing reload.

## The contract

### Server (server-development)

**`POST /api/product/signup`, changed** (the product host):
- Takes `{ slug, name, template, owner: { login, displayName } }`.
- `owner.password` present: 400 `{ error: "Sign-up takes no password. You choose it on your new environment's own page." }`.
- The owner's login is cleaned and checked (not empty after cleaning) **before** `addEnvironment()`, so a refused login
  never leaves an environment behind with no owner (today it does: a login of only spaces passes the first check,
  makes the environment, then fails in `addUser()`).
- Makes the owner with `passwordHash: null` and `firstPassword: { hash, expiresAt }` (the token's SHA-256 in hex; an ISO
  time 15 minutes on).
- 201 `{ url }` with `Cache-Control: no-store`; `url` is `<scheme>://<slug>.<base><port>/login/first-password#<token>`,
  the scheme and port as today. The login is no longer in the address.
- Everything else as today: off unless `SIGNUP=on`, five an hour per address, the same-origin rule.

**`GET /login/first-password`, new** (an environment's address): sends `public/login-first-password.html`. Headers:
`FRAMED_HERE` (added to `FRAMED_HERE_PATHS`, with the file's own name), `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`. It **never redirects**, not even a signed-in person: a redirect would carry the fragment
to the next page.

**`POST /api/login/first-password`, new** (the exchange):
- Body `{ token }` (JSON). 429 when `limiter` is blocked for the address.
- Hashes the token, then looks for an account in this environment with that `firstPassword.hash`, `expiresAt` in the
  future, role `owner`, no `passwordHash`.
- Not found, expired, used, empty or malformed: `limiter.fail()`, 401
  `{ error: "This link has expired or was already used. Ask whoever runs this host for a new one." }`. One answer for
  every failure.
- Found: removes the hash (`firstPassword: { claimedAt, expiresAt }`), saves, sets the pending cookie
  (`issuePending({ userKey, env: slug, purpose: 'first-password' })`, `setPendingCookie()`), `limiter.clear()`, 200
  `{ login, displayName, environmentName }`. The pending token is not put in the body.

**`POST /api/login/first-password/set`, new:**
- Body `{ password }`. Reads the pending token from the cookie only, with `readPending(..., { env, purpose:
  'first-password' })`.
- No valid pending token, or the account is not an owner with no password and a claimed `firstPassword`: 401
  `{ error: "Start again from your link." }`.
- Password shorter than 8 or longer than 200 characters (Decision 5): 400 with one sentence
  ("A password needs at least 8 characters.").
- Otherwise `updateUser(key, { passwordHash: auth.hashPassword(password) })`, `firstPassword` removed, the pending
  cookie cleared, then `mfaGate()`: `{ mfaRequired: true, enrol: true }` with the `enrol` pending cookie, or the session
  cookie, `setEnvHint()` and `{ user: publicUser(...) }`.

**The stored field** `firstPassword` on an account: `{ hash, expiresAt }` or `{ claimedAt, expiresAt }`, absent
otherwise. `sanitizeUser()` keeps it (a 64-character hex hash or nothing, two ISO times), or a restart between sign-up
and the exchange drops it and locks the owner out. Never on a host admin's stand-in account. `publicUser()` never shows
it. `USER_LEFT_OUT` in `server/environment-export.js` lists it, so the owner's export leaves it out. The host admin's
backup keeps it, as it keeps everything; it holds only a hash.

**`/api/register`** while an owner of the environment has a `firstPassword` (Decision 6): refused, with the same
sentence as sign-up being off, so nobody arrives before the owner.

**The recovery** (Decision 4):
`POST /api/host/environments/:slug/owners/:login/first-password` (host admin only) refuses an owner who already has a
password (400), and otherwise stores a new `firstPassword` (replacing any old one) and answers `{ url }` once,
`Cache-Control: no-store`. Its lifetime is 24 hours, single use (Decision 4).

### Pages (experience-design)

**`public/login-first-password.html` and `login-first-password.js`**, in the look of the sign-in page:
- The same Content-Security-Policy as `login.html` (`script-src 'self'`), only its own module script and `brand.js`.
- First thing in the script: read `location.hash`, then `history.replaceState(null, '', '/login/first-password')`.
  Keep the token in a variable; never in `localStorage`, `sessionStorage` or the page's text.
- With a token: send the exchange. On 200 show the environment's name and "Choose the password you will sign in with
  as <login>." with one password field (`autocomplete="new-password"`, 8 to 200 characters, a Show button as Manage
  has) and a hidden login field (`autocomplete="username"`, the login), so a password manager saves it for this
  address. One button: "Set password".
- No token, but the pending cookie may still be there (a reload): the page asks the set route only when the person
  submits; on 401 it shows the dead-link sentence.
- On 401 from the exchange: the sentence above, and a link to `/login`.
- After set: `mfaRequired` goes to `/login/enrol?next=/`, else to `/`.

**The start page's sign-up** (`public/landing.js` and `landing.html` now, `start.js` in slice 4): the password field is
removed, the form sends no password, the hint "Next you choose your password, on your new environment's own page." (the
Prototype's words) sits under it, and on 201 the page opens `url` as it is.

### Checks (server-development)

A new `tools/check-first-password.mjs` in `npm run check` (or new cases in `check-origin`, which already runs a
base-domain server), against a throwaway server with `BASE_DOMAIN` and `SIGNUP=on`. Each of these fails on today's code
where marked:
- Sign-up with `owner.password` is 400 (fails today: it is accepted).
- Sign-up with a login of only spaces is 400 and makes no environment (fails today: an environment with no owner is
  left). This fixes a defect the research found: sign-up makes the environment before it checks the owner's login.
- While the owner has a `firstPassword`, `POST /api/register` is refused (Decision 6).
- The console's "New first-password link" is refused for an owner with a password, and its link works once and lasts 24 hours.
- Sign-up answers a `url` with `/login/first-password#` and a 43-character token, no `login=` and no query; the
  response has `Cache-Control: no-store`.
- The owner cannot sign in by `POST /api/login` with any password, including an empty one, before the first password;
  the answer is the same as for an unknown login.
- The exchange works once; the second time is 401 with the same body as a random token, an empty one and a malformed
  one.
- The exchange after `expiresAt` is 401.
- A token from environment A at environment B is 401, and still works at A.
- A restart between sign-up and the exchange keeps the token working.
- Two exchanges of one token sent together: exactly one 200.
- 11 bad tokens from one address: the eleventh is 429.
- The set step: no pending cookie is 401; a pending cookie made for `enrol` or `verify`, or at another environment, is
  401; a password of 7 or 201 characters is 400; a good one signs in, and `POST /api/login` then works with
  it.
- After the password is set: the original token, and the pending cookie captured before the set, are both 401.
- A `first-password` pending cookie is refused by `/api/me/mfa/start` and `/api/login/verify`.
- With `settings.mfaRequired` on, the set step answers `mfaRequired` and no session cookie.
- A cross-site POST to the exchange with a cookie is 403; a `text/plain` body is not read.
- The token appears nowhere after the signup answer: not in the server's output, not in clear in any file under
  `DATA_DIR`, not in any later response (`/api/me`, `/api/users`, the console's environment list, the owner's export).
- `check-environment-export` passes with `firstPassword` in `USER_LEFT_OUT`.
- `/login/first-password` answers 200 with the headers above and never a redirect, signed in or not.

Existing checks that change: `check-origin`'s sign-up case (it posts a password and expects `/login?login=maker`),
`check-auth`'s sign-up limit case (its bodies are still refused, now for the missing login), and `check-product-pages`'
`signinProblems` (it allows one password field, inside sign-up; there should be none).

### Documentation (content-manager)

`architecture-environments.md` (sign-up, the new routes, the stored field, the window and its doors), the getting-started
guide's sign-up part and `userguide-environments.md` (what a new owner sees), the CHANGELOG, and the product site plan's
status line for slice 3a. The host console's part of the getting-started guide.

## Left to build, in order

| # | Step | Agent | Needs |
|---|---|---|---|
| 1 | The server: sign-up without a password and with the login checked first, the token and `firstPassword`, `sanitizeUser`, `USER_LEFT_OUT`, the page route and its headers, the exchange and the set routes, the register rule (Decision 6), the checks above | server-development | Nothing; Decisions 3, 5 and 6 are made |
| 2 | The page: `login-first-password.html` and `.js`; the password field removed from the start page's sign-up (`landing.*` now) | experience-design | Step 1 |
| 3 | The recovery (Decision 4): the console action "New first-password link" (24 hours, single use) and its button on the console's environment | server-development, then experience-design | Step 1 |
| 4 | Security read with live probing: every attack under Checks tried by hand against a local base-domain server, and the code read for the window's doors | quality-assurance | Steps 1 to 3 |
| 5 | Documentation | content-manager | Step 4 |

Step 1 and step 2 can be checked on their own (step 1 by tool, step 2 live). The start page's sign-up in product site
slice 4 waits for steps 1 and 2.

## Verify

- **Step 1.** By tool: the checks above, on a throwaway server (`PORT=`, `DATA_DIR=/tmp/<name>`, `BASE_DOMAIN=localhost`,
  `SIGNUP=on`), with `npm run check` passing (as root, the two known `--migration` cases of `check-names` fail and are
  not a defect).
- **Step 2.** Live, headless Chromium against the same server: sign up on the product host, land on
  `/login/first-password`, see `location.hash` empty and the address bar without the token, set a password, land on
  Home signed in; reload before setting and still set it; with `mfaRequired` on, land on the enrolment step. At 1280
  and 390 px, light and dark.
- **Step 3.** By tool: the console action refuses an owner with a password and makes a working link for one without.
  Live: the host admin makes the link in the console and it opens the page.
- **Step 4.** Quality-assurance's report says, for each attack, "verified live", "checked by a tool" or "read as code
  only".
- **What cannot be checked here.** There are no real separate domains locally. On the live install, by hand, in
  **Chromium, Firefox and Safari**: the move from `chameleon.coffeepubstudio.com` to `<slug>.coffeepubstudio.live` with
  the fragment kept, including through any redirect the proxy adds (`http` to `https`; a browser keeps the fragment
  across a redirect that names none, but this has not been checked here); the fragment gone from the address bar; what
  each browser's history keeps (the first address with the token may stay in history even after `replaceState`; it is
  spent by then); and the proxy's access log after a real sign-up, searched for the token. No LiveKit call is involved.

## Risks

1. **A lost tab locks the owner out** until the console's "New first-password link" is used, and the address stays taken.
2. **The window exists.** Between sign-up and the exchange the environment has an owner with no password. Design A
   closes it to anyone without the token; any door added later that reaches an account with no password hash must be
   checked against this.
3. **The fragment through a redirect** is relied on and has not been checked in every browser on the real domains.
4. **History keeps a dead token.** Harmless once spent, but a browser that fails to run the page's script (scripts off)
   leaves a live token in history for up to 15 minutes.
5. **The start page's own safety matters.** The token is in its sign-up answer for a moment; the start page must keep
   loading only its own scripts.
6. **Login collisions break the cross sign-in recovery.** An owner who chose a host admin's login cannot be reached by
   that host admin's cross sign-in; the console action (Decision 4) does not have this problem.
7. **The register door.** A template that turns `allowRegistration` on would let strangers in as members before the
   owner arrives, unless Decision 6 closes it, and it does. They cannot take the owner's account.

## What is not decided

### Open questions

None block the build. Two follow the plan's recommendation and stand unless Thomas objects (Decisions 7 and 8):
the words a person reads (experience-design may tighten them on the page), and what the sign-in page says during the
window (nothing).

Still to check, not to decide: the fragment through a proxy redirect in each browser on the real domains (Risks, 3).
