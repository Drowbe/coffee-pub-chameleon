# Access Bundle Plan

**Audience:** Thomas, who decides who may enter what and what a person agrees to first; and the sessions that build it: server-development (sessions, the entry rule, the routes, the stored records, the checks), experience-design (the sign-in page, the agreement step, the guest's landing, Set up, the profile), quality-assurance (a read of this plan before any code, and an independent security read after each server step) and content-manager.

**Status:** a draft for Thomas to decide, 2026-11-11. Nothing is built. It is his top priority, as the project manager relayed it: he must show the product to investors who cannot all create accounts. **This plan is security-sensitive** (sign-in, who may enter what, stored records, isolation between environments): it needs a plan read before step 1, and every server step needs an independent security read before it merges. A statement about today's code is marked **(code)** when it was read in the code on `main` at `51e25b85`, and **(to confirm)** when it was not read or a builder must confirm the fit. Nothing here was run.

## What it is today

- **Accounts and sessions.** An account's role is `admin`, `owner` or `member`. A guest has no account, and moderator is a tick on one space (`server/store.js`) (code). A session is the signed `app_session` cookie, 30 days, signed with the environment's own `sessionSecret` and set with no `Domain`, so it belongs to one environment (`server/auth.js`) (code). Every write is refused from another origin (`sameOriginOnly`) (code).
- **Who is in a space.** `space.members` is a list of account keys an owner picks; the Lobby holds everyone (code). There is no single entry rule: `server/index.js` asks `members.includes` in 30 places (code).
- **What a person is told.** `GET /api/spaces` and `GET /api/presence` answer every space's record (name, description, members' keys) to any signed-in person, with `mine` on the ones they are in. Only the pages hide the rest (`server/presence-view.js`, `public/space.js`) (code). So "a person is not told it exists" is true of the pages, not of the API.
- **Guests come by a guest link.** `/guest/<token>` opens `space.html` in guest mode, and `POST /api/guest-join { token, name }` answers a guest pass (an id and the name, signed with the environment's slug and the link's token). Later requests carry `?guest=<token>`, and `&pass=` where the guest speaks (code). The pass never expires, `guest-join` has no rate limit, and a read needs the token only (code). 23 lines in `server/` read the guest token or find its space (`store.spaceByGuestToken`), and the pages carry the token too: 64 lines of `public/space.js`, and `module-host.js`, `canvas.js` and `brand.js` (code). `/img/<key>/<slot>` answers any valid guest token, for any person in the environment (code).
- **What a guest can do** is the guest role (`ROLE_DEFAULTS.guest`), which an owner edits in Manage, Roles (code). By default: join the call, share a screen, read and send chat and pictures, react, and use the space's modules as each module's guest defaults say (To-do: see, not change). **Not for a guest:** asides and private conversations; mute, kick, the guest link, tags; AI; library files (`GUEST_LOCKED`); a module's personal or environment-wide data; private messages and clearing chat; saving, changing or favoriting a layout (shared ones load); the bell, the status line, what needs action, Home's dashboard, the Calendar and Maps pages; a profile; costs and booking codes unless the owner sets `guestsSeeHidden` (code). Guest chat and live streams are limited per guest link and per address (code).
- **The pages.** `public/login.html` is the sign-in page, `login-step.html` the shared page for the code and enrolment steps, and `#guest-join` in `space.html` the guest's name form (code).
- **Notices.** `moduleHooks.announce(userKeys, { title, body, href })` keeps the host's own notice for each person. The bell lists it, under the word for modules, and a toast shows it; a toast takes action buttons (`public/brand.js`). All of it needs an account (code).
- **The profile's Trips tab** is the `{Spaces}` tab: "Trips" under the travel template, whose `space` word is trip and trips (`templates/travel.json`) (code). It lists the spaces a person is in. **Remove from {space}** shows only to an owner editing someone, and `DELETE /api/spaces/:id/members/:key` is for owners only, so nobody can leave a space on their own (code).
- **Levels.** With `BASE_DOMAIN`, each environment has its own data folder (`DATA_DIR/environments/<slug>/`), `app.json`, store and secrets; the host console and `host.json` are the host's (code). A single-environment install has no host console (to confirm).

## Decisions

Thomas's, as relayed 2026-11-11. The leans in the rest of this plan are not decisions.

1. **Who can enter, per space:** invited people only (today), anyone with an account in this environment, or anyone including guests.
2. **The guest door.** A **Continue as guest** button on the sign-in page. A person opens the environment's address, presses it, types a name, and sees only the spaces marked "anyone including guests". No link is needed.
3. **A guest stays a guest.** Today's guest limits hold, and a guest's session is a guest session, never an account.
4. **A guest landing notice** lists what is not available to guests. With no space open to guests it says "Nothing is open to guests here."
5. **Agreements.** A short screen with the terms of service and the beta NDA and an **I agree** button, required before entering, once per person and per version of the text, for everyone: members at first sign-in, guests at the door. Each agreement is recorded with its date and version. Changing the text asks again.
6. **Request access, per space.** With it on, a person (an account or a guest) who may not enter sees the space listed with **Request access** in place of not seeing it. The space's owner, admin or moderator gets a notice (the bell and a toast) and can Approve or Decline. The requester is told. Approval grants entry.
7. **The Trips step.** A person who entered a space marked "anyone with an account" has it on their profile's Trips tab and can remove it. Entering adds it (the recommended option, recorded as Thomas's decided lean; to be confirmed with this plan).
8. **Order:** agreements first, then the guest door and the "anyone" setting, then request access, then the Trips step. Slice 1, for the investors, is the guest door, the "anyone" spaces, agreements and the guest notice. Slice 2 is request access and the Trips step.

## Threat model

- **Reaching another space by its id.** Space ids are short and not secret (code). Every space route asks one rule, `mayEnter(who, space)`, on every request and not once at entry, so a space switched back to invited-only shuts at once (`liveAccessChanged()` already ends its open streams (code)). Entering as an account adds the person to `members` (decision 7), so the 30 existing checks hold for accounts unchanged. A door guest is in a space only while its setting is `guests` and the door is on, or while they hold an approval.
- **Lists and people.** A door guest never gets today's `GET /api/spaces` or `GET /api/presence` answer. Their list is a new, narrow one: the id, name and icon of the spaces they may enter or request. In an open space a guest sees its members' names, as a link guest does today (code); the picture route is scoped, for door guests, to people in a space the guest may enter.
- **A guest is not an account.** The guest session has its own cookie, a signing key of its own derived from the environment's secret (as `guestPassKey()` is (code)) and its own reader. `currentUser(req)` and `requireUser` never accept it, and the bearer header never carries it.
- **Between environments, and between host and owner.** The guest session names the environment's slug, is signed with that environment's secret, and sits in a cookie with no `Domain`, as the account session does (code). Requests, approvals and agreement records live in the environment's own folder. The host owns whether the door is offered at all, the limits and the agreement texts. An owner owns the environment's door switch and each space's two settings, and can never raise a host limit or change the texts.
- **Abuse.** Anyone on the internet can press the button. Needed: a limit on new guest sessions per address; a cap on guests at once per space and per environment, counted from the live register, which marks guests (code); an expiry on guest sessions; chat and stream limits keyed by the guest's id, address and space (today's are keyed by the guest link (code)); and one number that ends every guest session at once. By default a guest may join the call and share a screen (code), so an open space puts strangers on the call unless the owner changes the guest role.
- **Skipping the agreement.** The gate is on the server, ahead of every route, never a page step alone.
- **Request access** tells a stranger that a space exists. That is the stated exception, turned on per space, and the answer carries the name and icon only. One pending request per person per space, a daily limit and an expiry bound the notices an owner gets. A guest's typed name reaches an owner's bell, where it is drawn as text (`escapeHtml` in `public/brand.js`) (code).
- **Passing as someone, and growth.** A guest may type a member's name, so every place a guest's name shows marks it as a guest (to confirm). Guest agreement records and requests are written by strangers, so each file is bounded by the limits.

## The contract

### Stored (JSON in the environment's data folder; no database)

- **A space** (`app.json`, `sanitizeSpace`) gains `entry`: `invited`, `accounts` or `guests`, absent for `invited`; and `requestAccess: true`, absent while off. The Lobby and asides take neither.
- **Settings** gain `guestDoor` (false by default) and `guestEpoch`, a number folded into every guest session's signature; raising it ends them all.
- **An account** gains `agreed: [{ doc, version, at }]`, and `spaces[<id>].joined: { by: "self" | "request", at }`.
- **`agreements.json`** (new): guests' agreements, `{ guest, name, doc, version, at }`, added to only.
- **`access.json`** (new): `requests: [{ id, space, key | guest + name, at, state, decidedBy, decidedAt }]` and `grants: [{ guest, space, until }]`.
- Whether an owner's export carries the two new files is to confirm. The lean is the host's backup only.

### Server

- **Agreements.** `TERMS_FILE` and `NDA_FILE` name two text files (question 1). With neither set there is no agreement step and nothing changes. A version is the first 16 hex of the text's SHA-256, read at start. `GET /api/agreements` (public) answers `{ required, docs: [{ id, title, version, text }] }`. `POST /api/agreements/accept { versions }` records it for the signed-in account; 409 when the versions are not the current ones.
- **The gate** is one piece of middleware. An account session that has not agreed to the current versions gets 403 `{ error, agreementRequired: true }` from every API route but those two, sign-out and branding, and a redirect to `/agree?next=` from every page. It holds for sessions already open. The Studio app's bearer token (code) gets the same answer; it is told when this ships.
- **The door.** `POST /api/guest-door { name, versions }` answers 403 with the door off, checks the limits (429, or 403 when full), records the agreement and sets the `guest_session` cookie: the guest's id and name, the slug, the issue time, the versions and the epoch, good for `GUEST_SESSION_HOURS`. `GET /api/guest-door` answers `{ guest, spaces: [{ id, name, hasImage, state }], unavailable }`; `state` is `open`, `request` or `pending`. `DELETE /api/guest-door` ends it. A link guest agrees in `POST /api/guest-join`, and the pass then carries the versions and an issue time (to confirm, with question 4).
- **Who can enter.** `PATCH /api/spaces/:id` takes `entry` and `requestAccess`, from owners and the admin only (question 7). `POST /api/spaces/:id/join` adds a signed-in person to `members` when `entry` is `accounts` or `guests`, and marks `joined`. A space the caller may neither enter nor request answers 404 "no such space", the same as an unknown id.
- **`mayEnter(who, space)`** is the one rule: owner rights; a member; a link guest of that space; a door guest while `entry` is `guests` and both door switches are on, or with a grant still in date. Every guest lookup goes through one resolver (question 4).
- **Request access.** `POST /api/spaces/:id/access-requests`, for an account or a guest session: 409 when one is pending, 429 past the limit, 404 with the option off. `GET` on the same path lists the pending ones for the space's owners, the admin and its moderators (`moderates()` (code)). `POST /api/spaces/:id/access-requests/:requestId { decision }`: approve adds an account to `members`, or writes a grant for a guest; decline closes it. Deciders are told with `moduleHooks.announce`, under a source of its own so the bell does not call it a module's (to confirm). An account is told the outcome the same way; a guest reads it in `GET /api/guest-door`.
- **Leaving.** `DELETE /api/spaces/:id/members/:key` also accepts a person's own key (question 9).
- **Limits**, all environment variables, with these leans: `ENABLE_GUEST_DOOR` (true: offered, and each environment still starts off), `GUEST_SESSION_HOURS` (24), `GUEST_DOOR_PER_ADDRESS` (5 new sessions in 15 minutes), `GUESTS_PER_SPACE` (10 at once), `GUESTS_PER_ENVIRONMENT` (50 at once), `ACCESS_REQUESTS_PER_DAY` (5 per person); a request expires after 7 days. A single-environment install with none of them set behaves as before.

### Pages (no new chrome)

- **Sign-in** (`login.html`): **Continue as guest** under the form, shown when branding says the door is on. It leads to the agreement step, then the name form (`#guest-join`'s (code)).
- **The agreement step** uses the step page's panel (`login-step.html` (code)): the two texts, each with its version, and **I agree**. The text is plain text or Markdown drawn through the SDK's safe reader (`hostText.markdown`, which the public share page already uses (code)), never raw HTML.
- **The guest's landing** is `space.html` in guest mode at `/guest`: the open spaces as Home lists them, the notice in a banner (`.sdk-banner`), and "Nothing is open to guests here." The notice's list is the refusals under "What a guest can do".
- **Set up, Members** (`space-setup.js`, beside **Allow guests** (code)): **Who can enter**, three choices, and **Enable request access**; under them the pending requests, each with Approve and Decline. **Manage**, beside the sign-up switch (`admin.html` (code); the section to confirm): **Allow guests at the door**.
- **Requests** reach deciders as a bell notice and a toast with Approve and Decline. A space a person may request shows on Home with **Request access**, then "Requested".
- **Profile, Trips tab:** a space a person entered on their own shows as the others do, with **Remove from {space}** for themselves, confirmed with `confirmDialog`.

## Left to build, in order

Thomas names the kind of build; the lean is a production build for every server step. The project manager uses Fable only when Thomas asks, so the model column is a request to him.

| Step | What | Owner | Model |
|---|---|---|---|
| 0 | Thomas answers the blocking questions; the plan read | Thomas, quality-assurance | Fable, high |
| 1 | Agreements: the texts, the record, the gate, its check | server-development | Fable, high |
| 2 | The agreement step page | experience-design | sonnet |
| 3 | Who can enter: `entry`, `mayEnter`, join, the narrow lists | server-development | Fable, high |
| 4 | The guest door: the session, the resolver, the door routes, the limits | server-development | Fable, high |
| 5 | Sign-in button, name form, landing and notice, a guest mode with no token in the address, Set up, Manage | experience-design | Fable, high |
| 6 | Request access: routes, records, notices | server-development | Fable, high |
| 7 | Request access on Home, in Set up, the bell and toast | experience-design | sonnet |
| 8 | The Trips step: leaving, and the profile tab | server-development, experience-design | sonnet |

After each of steps 1, 3, 4, 6 and 8, quality-assurance makes an independent security read with live probing (Fable, high) before the next step starts. Slice 1 ends after step 5 with one read of the whole slice on a `BASE_DOMAIN` server with two environments, then the documentation. Slice 2 is steps 6 to 8. Step 3 carries join, which slice 1 needs; until step 8 only an owner can take a person out again.

## Verify

- **Checked by a tool** (a new `tools/check-access.mjs`, and more cases in `check-auth.mjs`, `check-presence.mjs` and `check-live.mjs`): every route in the contract, and a sample of the existing space routes, asked as each of no session, a link guest, a door guest, a member of another space, a member, a moderator, an owner and the admin, for each space setting and both door switches. The agreement gate at every way in (password, personal link, code step, sign-up, invite, first password) and on a session opened before the text changed. Each limit at and past its number. Two environments under `BASE_DOMAIN`: a guest session, an approval and an agreement from one tried at the other. A single-environment install with nothing set: the same answers as before.
- **Read as code** by the independent reader: that no route skips `mayEnter`, and that a guest session can never read as an account.
- **Only Thomas's trying covers:** a door guest on a real call (there is no LiveKit server locally), investors' own browsers and phones, the address the limits see behind his proxy (`TRUST_PROXY_HOPS`), and whether the texts and the record satisfy his lawyers.

## Open questions

Each has a lean; none is decided. "Blocks" names the step that cannot start without the answer.

1. **Where the two texts come from** (blocks 1). Lean: `TERMS_FILE` and `NDA_FILE`, the host's, with the version taken from the text itself, so it works on every install and cannot drift from the text. A host-console setting needs no restart, but a single-environment install has nowhere to set it. The lean's cost: a corrected typo asks everyone again.
2. **Who is exempt** (blocks 1). Lean: only the host admin's stand-in and the access key (OBS, the Studio app's stream); owners and the admin agree like everyone. A shared file's public page and a published calendar address are not "entering" and are left out.
3. **What a guest's agreement proves** (blocks 1). A guest has no account, so "person" means one guest session: the browser's cookie, and the server's record under that session's id. The record says someone typed that name and pressed **I agree** to that version on that date. It does not prove who. Lean: keep it so for slice 1 and say so. Asking guests for an email makes the record more useful and collects personal data.
4. **How a door guest is known on each request** (blocks 4). Lean: the `guest_session` cookie and one resolver for every guest lookup. It touches every guest lookup on the server and the pages' guest mode, a missed one refuses, no secret sits in an address while Thomas shares his screen, and the server can hold link guests to the agreement on reads. Cheaper: a signed, expiring door token read by `spaceByGuestToken`, one function changed, with a credential in the address. Cheapest: the door hands out the space's guest link, which makes that link public and shares one chat allowance among all guests.
5. **The defaults and the limits** (blocks 4). Lean: the door off in each environment until its owner turns it on, offered by the host, and the numbers under "Limits", with `GUEST_SESSION_HOURS` raised for the investor weeks. A per-plan cap on guests in the host console is left for later.
6. **Narrow the members' lists too?** (blocks 3). Lean: yes. `GET /api/spaces` and `GET /api/presence` stop answering spaces a member may neither enter nor request, so the API matches the pages. A page that reads the full list may need a change (to confirm).
7. **May a moderator change Who can enter?** (blocks 3). Lean: no. Owners and the admin set it; a moderator approves and declines.
8. **The guest link beside the door.** Lean: `allowGuests` and the guest link stay as they are; "invited" includes people invited by link.
9. **Leaving and closing** (blocks 8). Lean: a person may remove only a space they entered on their own. When a space goes back to invited-only, the people who entered stay until an owner removes them, and Set up marks who came in on their own.
10. **What a closed space shows, and how long a guest's approval lasts** (blocks 6). Lean: its name and icon only. An approved account becomes a member; an approved guest keeps entry until their guest session ends, then asks again.
11. **What a guest is called.** Lean: the name they type, with the environment's word for guest beside it everywhere, and a name equal to an account's display name refused.
