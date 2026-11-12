# Access Architecture

**Audience:** developers changing who may enter a space, the agreements gate, the guest door or request access (`server/space-access.js`, `server/agreements.js`, `server/guest-door.js`, `server/access-requests.js`, and their routes in `server/index.js`).

This is the shape of the access bundle ([plan-access-bundle](../plans/plan-access-bundle.md), steps 1 to 7). The plan is the contract; where the code differs, this says so. For the people's side see [Spaces](../userguides/userguide-spaces.md) ("Who can enter") and [Accounts](../userguides/userguide-accounts.md). The routes are listed in "The routes" below.

## One rule for entering

`mayEnter(viewer, space)` in `server/space-access.js` is the only place that decides whether a person may enter a space. It is pure: no store and no request. Every route and every list that needs the answer asks it. A viewer is one of:

- `{ all: true }`: the access key (OBS, Studio). Every space.
- `{ key, owner }`: a signed-in person. `owner` is true for owners and the admin.
- `{ guestSpace }`: a guest by guest link, for that one space only.
- `{ doorGuest: true, doorOn, granted }`: a guest from the guest door. `doorOn` is true only while both switches are on. A door guest never enters the Lobby.

A space's `entry` is `invited` (the default when absent), `accounts` or `guests`:

- `invited`: members, owners and the admin.
- `accounts`: also anyone with an account in the environment. They become members by **Join** (`POST /api/spaces/:id/join`, `store.joinSpace`), which marks the space as one they may leave.
- `guests`: the same for an account, and also a door guest while the door is on.

`mayRequest(viewer, space)` is the second question: the space has `requestAccess` on, is not the Lobby, the viewer is a signed-in person or a door guest while the door is on, and may not enter already. A link guest and the access key cannot ask.

**A closed space answers like an unknown id.** A person who may neither enter nor ask gets 404 `no such space` from every route that names a space, so the answer does not tell them it exists. Only a space they may ask to enter is described, and only by its id, name, whether it has a picture and its description (`spaceAccess.requestView`).

## Agreements

`server/agreements.js`. Two texts, the terms of service (`TERMS_FILE`) and the beta NDA (`NDA_FILE`), are the host's: one pair for every environment on the server, read once at start. Each is UTF-8 text, plain or Markdown, up to 256 KB. A text's version is the first 16 hex characters of its SHA-256, so changing a text asks everyone again. With neither set there is no agreement step. A file that is set and cannot be used (missing, not a file, over 256 KB, empty) stops the start with one sentence, and a variable that is set but blank stops it too: a server meant to ask never starts without asking.

- **An account** keeps `agreed: [{ doc, version, at }]` in the environment's `app.json` (`Store#recordAgreement`). A person with an out-of-date record is sent to `/agree` by the gate, and every other route answers 403 `{ error, agreementRequired: true }`; a page request (GET, `Accept: text/html`) is redirected instead. `/agree` reads the texts from `GET /api/agreements`, draws them as text (never as HTML) and records the agreement with `POST /api/agreements/accept`.
- **A guest** has no account. `GuestAgreements` appends `{ guest, name, doc, version, at }` to the environment's own `agreements.json`; nothing is dropped.
- **The owner's copy and a restore.** `restoreEntries(files, { backup })` strips who agreed from a restored zip, so a copy moved to another server asks again. `?backup=1` on the restore route keeps it: that is the host's own backup of the environment. The host console's restore has a checkbox for it.

## The guest door

`server/guest-door.js`. A person with no account presses **Continue as guest** on the sign-in page and lands on `/agree` (the same page as the agreements, with a name field). `POST /api/guest-door` records the agreement and sets the `guest_session` cookie.

- **Two switches.** The host's: `ENABLE_GUEST_DOOR=true` on a single-environment install, or the per-environment checkbox in the host console on a hosted server (`guestDoor` in the host registry). The owner's: `settings.guestDoor`, in Manage, saved with **Save**. The door is open only while both are on (`guestDoorOn()` in `server/index.js`).
- **The session.** `guest_session` is `{ i, n, s, v, e, t }` (guest id, name, environment slug, text versions agreed to, the environment's `guestEpoch`, issued at), signed with a key made from the environment's own session secret and a different label from the account session, so it never reads as one and never works at another environment. It ends when `GUEST_SESSION_HOURS` run out, when `guestEpoch` goes up, when a text changes (the version no longer matches), when either switch goes off, or on `DELETE /api/guest-door`.
- **One resolver.** `guestOf(req)` in `server/index.js` reads both kinds of guest, the link's and the door's, and returns `{ kind: 'link' | 'door', ... }`. Code that has to treat them apart checks `kind`; everything else asks the one resolver.
- **The register.** `GuestRegister` counts who is here now (seen in the last 15 minutes) for `GUESTS_PER_ENVIRONMENT`; `GUESTS_PER_SPACE` is read from the live presence, which marks guests. It is in memory: a restart forgets it, and a session still in date is counted again when it next asks.
- **Names.** `agreements.cleanGuestName` and `guestNameRefusal`: at most 40 characters, no mixing of alphabets (`guestDoorLib.mixesScripts`: Latin letters with letters of a script that has Latin lookalikes), and no lookalike of a member's name (NFKC, lower case, lookalikes folded). A guest's chat messages carry the label `(guest)` after the name.
- **Limits.** An address may open `GUEST_DOOR_PER_ADDRESS` new sessions in 15 minutes (429). Past the environment's cap the door answers 403.
- **Ending all.** `POST /api/guest-door/end-all` (owners and the admin) raises `guestEpoch`, which ends the door's and the guest links' sessions together.

## Request access

`server/access-requests.js`. One file for each environment, `access.json` in its data folder:

```
{ requests: [{ id, space, key | guest + name, at, state, until?, decidedBy?, decidedAt? }],
  grants:   [{ guest, space, until }] }
```

`state` is `pending`, `approved`, `denied`, `withdrawn` or `expired`. Every method is synchronous from its check to its write, so two answers to one request cannot both win. The file is written whole (a temporary file, then a rename), private to the server's user. A file that is there and cannot be read is set aside, said once, and a new one begun, never written over. It is bounded: old answers are dropped after 30 days and new requests are refused at 5000.

- **Who asks.** A signed-in person (`key`), or a door guest (`guest`, `name`, and `until`, the end of that guest's session, so an approval can never outlive it).
- **Approval.** An account becomes a member of the space (`store.joinSpace(key, id, 'request')`) in the same step as the answer. A guest gets a grant for that space until the session ends.
- **Deny.** A denied person cannot ask again for 24 hours; during that time the space's row carries `answer: 'denied'` and the page shows **Declined**. A withdrawn request does not count against the limits.
- **Limits** (`readLimits`): `ACCESS_REQUESTS_PER_DAY` for one person in 24 hours, `ACCESS_REQUESTS_PER_ADDRESS` for one address in 24 hours, `ACCESS_REQUESTS_PENDING_PER_SPACE` waiting accounts and `ACCESS_REQUESTS_PENDING_GUESTS_PER_SPACE` waiting door guests (counted apart) for a space, and `ACCESS_REQUEST_DAYS` before a pending request ends.
- **Notices.** A new request tells the owners through the bell (`moduleHooks.announce`), with a link to Set up, **Members** (`/?setup=<space>#members`). An answer tells an account who asked.
- **The owner's copy.** `access.json` is left out of an owner's copy of an environment and kept in the host's backup.

## The routes

| Route | Who | Answers |
|---|---|---|
| `GET /api/agreements` | anyone; 60 reads in 15 minutes for one address | `{ required, docs: [{ id, title, version, text }] }`, and `mode: 'guest'` for a person with no account while the door is open. 429 past the limit |
| `POST /api/agreements/accept` `{ versions }` | a signed-in account; 20 tries in 15 minutes | `{ ok, agreed }`. 401 signed out, 400 no versions, 409 the text changed, 413 over 1 KB, 429. Not there when no text is set |
| `POST /api/guest-door` `{ name, versions }` | no account | 201 `{ ok, guest }` and the cookie. 409 signed in already or the text changed, 403 door closed or full, 429 address limit, 400 name missing, too long, mixed alphabets or a member's |
| `GET /api/guest-door` | a door guest | `{ guest, permissions, spaces, unavailable, none }`. 401 without a session |
| `DELETE /api/guest-door` | anyone | ends this guest's session |
| `POST /api/guest-door/end-all` | owners, admin | `{ ok }` |
| `POST /api/spaces/:id/join` | a signed-in person | `{ space }`. 404 for a space they may not enter, 400 for the Lobby |
| `POST /api/spaces/:id/request` | a signed-in person or a door guest | 201 `{ ok, state: 'pending' }`. 401, 403 (guest link), 404, 409 (can enter already, or one is pending), 429 |
| `DELETE /api/spaces/:id/request` | the asker | `{ ok }`. 404 when there is none pending |
| `GET /api/spaces/:id/access-requests` | owners, admin | `{ requests: [{ id, kind, name, at, expiresAt }] }`, oldest first |
| `POST /api/spaces/:id/access-requests/:requestId` `{ decision: 'approve' \| 'deny' }` | owners, admin | `{ ok, changed, request }`. The same answer twice changes nothing; the other answer, or one to a request that is over, is 409 |
| `POST /api/host/environments/:slug/restore?backup=1` | host | keeps who agreed (see "Agreements") |

A space's `entry` and `requestAccess` are set with `PATCH /api/spaces/:id` (owners and the admin only; a moderator may not).

## Settings

These are environment variables, set in the compose file ([Settings reference](../userguides/userguide-settings-reference.md), "Agreements, guests and entering"): `TERMS_FILE`, `NDA_FILE`, `ENABLE_GUEST_DOOR`, `GUEST_SESSION_HOURS` (24), `GUEST_DOOR_PER_ADDRESS` (5), `GUESTS_PER_SPACE` (10), `GUESTS_PER_ENVIRONMENT` (50), `ACCESS_REQUESTS_PER_DAY` (5), `ACCESS_REQUESTS_PER_ADDRESS` (20), `ACCESS_REQUESTS_PENDING_PER_SPACE` (50), `ACCESS_REQUESTS_PENDING_GUESTS_PER_SPACE` (20) and `ACCESS_REQUEST_DAYS` (7). A value that is not a whole number above zero uses the default.

## Not verified

Read from the code and the plan; the checks that cover this are in `npm run check`. Nothing here was tried in a real browser by the author of this page, on a phone, or on a hosted server with several environments. A guest in a space with a module open was not tested.
