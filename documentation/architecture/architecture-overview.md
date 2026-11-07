# Architecture Overview

**Audience:** a developer changing Coffee Pub Chameleon, who needs the shape of the whole system and
where each part lives.

Chameleon is a small Node web app, plus a LiveKit media server if you want voice and video. LiveKit carries audio and video
and nothing else; entering a space, who is here, chat and asides run through the app itself and work without it. There is no build step and no front-end
framework: the pages are plain HTML, CSS and JavaScript served as they are.

## The pieces

```
+--------------+   WebRTC (one upload each)   +--------------+   WebRTC   +--------------+
| Player       | ---------------------------> | LiveKit      | ---------> | OBS browser  |
| browser      | <--------------------------- | media server | <--------- | sources      |
+--------------+   other players' streams     +--------------+            +--------------+
        ^                                             ^
        | pages and API                               | access tokens
+--------------------------------------------------------------+
| Chameleon (Node/Express): pages, accounts, images, API       |
+--------------------------------------------------------------+
```

- **LiveKit server** is open source and runs as its own container. It is a selective forwarding unit:
  each player uploads once and the server fans the stream out. It has a built-in TURN relay for players
  behind strict routers. Chameleon calls its server API for the calls cap, the microphone and camera marks, kick and mute.
  It is optional: with no LiveKit keys the server starts, logs "No LiveKit: voice and video are off." and the call, the
  Conference and asides are off ([Hosting](#hosting)).
- **Chameleon web app** serves the pages, mints LiveKit access tokens for the call, and keeps accounts, spaces,
  images and settings. It never touches media. It also keeps who is where in memory and sends it, with chat and the
  asides' nudges, on a server-sent stream per page (`GET /api/live`).
- **Coffee Pub Studio** signs in as an owner and creates one OBS Browser Source per player, pointing at
  that player's view page.

## Technology

- **LiveKit** on both sides, with `livekit-client` served by Chameleon itself from `/lib/`. It was chosen
  over a hand-rolled mesh, whose upload cost grows with every person in the call, and over Jitsi, where per-participant
  OBS views would need low-level work.
- **Node 22 and Express 5.** One app serves every page and the JSON API.
- **No database.** Users, spaces, settings and roles live in one JSON file in the data volume, images next
  to it, and installed modules in their own folder. Everything is loaded once and written back whole.
- **Accounts.** Passwords are scrypt hashes. A session is a signed cookie, so there is no session table.
- **Everything self-hosted.** Font Awesome, the LiveKit client and the background-blur model are served
  by the app, so a page never fetches anything from a third party.
- **Styling** is one stylesheet driven by color tokens; see [design-theme](../designsystem/design-theme.md).

## Where things live

| Path | What |
| --- | --- |
| `server/index.js` | Routes, the call's tokens, LiveKit server API, permission checks |
| `server/live.js` | The live register: who is in which space, on the call, away; pure, in memory |
| `server/store.js` | Users, spaces, settings, roles and images on disk |
| `server/auth.js` | Passwords, signed session cookies, login rate limit |
| `server/chat-history.js` | Every chat message per space (500 public, 200 private per person, 30 days): public ones in `chat.json`, private ones in `chat-private.json`; moves the old `ai-threads.json` in once |
| `server/modules.js` | Module install and registry; see [architecture-modules](architecture-modules.md) |
| `public/login.html` | Sign-in page |
| `public/register.html` | Self sign-up and invite acceptance |
| `public/space.html` | The space list (Home) and the call. Until step 5b of the Names plan these were `room.html`, `room.js`, `roomconfig.*` and `room-modules.js`; `/room.html` answers 301 to the new page, keeping the query |
| `public/profile.html` | A player's profile: photo, call settings, default images, a section per space |
| `public/admin.html` | The Manage page |
| `public/space-setup.js` | Set up: every setting of a space in one side panel on the space's own screen (it replaced the separate settings page at `/spaces/<id>`; the old addresses redirect to it) |
| `public/phases.js` | The phase timeline rule, run by the server and the pages |
| `public/phase-sheet.js` | The timeline sheet behind the phase chip |
| `public/action-bar.js` | The Save and Cancel bar every settings or edit surface has |
| `server/attention.js` | What needs a person's action in a space, as modules reported it (`DATA_DIR/attention.json`) |
| `public/chat-input.js` | Chat's one input: `/ai`, the command picker and routing, and bringing research in |
| `public/canvas.js` | The space's canvas: docking, floating, snapping and popping out the conference, the chat and the modules |
| `public/view.html` | The OBS view |
| `public/brand.js` | Shared header, branding and icon lookup |
| `public/words.js` | The environment's words in the pages: `word()`, `fill()`, `applyWords()` |
| `public/slot-paste.js` | Paste into picture slots; see "Picture slots" under Design rules |
| `server/words.js` | The words, their defaults, and the checks on an owner's own |
| `public/style.css` | The one stylesheet |
| `public/sw.js` | The service worker that lets the app install |

## Data and permissions

- Every account has a stable eight-character **key**. Images, view links and OBS source names use it, so
  renaming never touches OBS.
- An account's `role` is `owner` or `member`; `admin` is only the server's admin (the account `ADMIN_LOGIN` and
  `ADMIN_PASSWORD` make on a single install, or the host admin's own account inside an environment,
  `hostAdmin: true`), which can't be changed or given (`ROLES` and `ASSIGNABLE_ROLES` in
  `server/store.js`). `owner` and `admin` have every right (`OWNER_RIGHTS`, `hasOwnerRights()`); the
  owner-only routes use `requireOwner` and answer 403 `owners only` (the pages: "Owners only."). An environment may
  have no owner. A guest is not an account. The permissions each
  editable role (`moderator`, `member`, `guest`) has live in `settings.roles` as overrides of built-in
  defaults, so a permission added later starts at its default; `GET /api/roles` answers them keyed `owner`,
  `moderator`, `member` and `guest`, and `PATCH /api/roles/:role` changes one (`/api/roles/owner` answers 400
  "the owner has every permission, so that role can't be changed"). A member can also be flagged Moderator in
  one space, which grants the Moderator role's permissions there only.
- A member's entry for a space holds their pictures for that space, whether those replace their defaults, and that
  Moderator flag. Picture lookups fall from the space's picture, to the member's default, to the environment's
  Default Images.
- **Presence and invitations.** A page tells the server it is open with `POST /api/presence` every half minute while it is visible (`startPresence` in `public/brand.js`); the server remembers when in memory, counts a person as present for 75 seconds, and `GET /api/presence` returns `present` beside `online` (in a call), filtered by what the viewer belongs to (the route's contract is under "Spaces and calls" below). `POST /api/asides/invite` makes a private aside (an `asides` record, `private`, no origin) for the inviter and one present person, and sends an `invite` event down the same server-sent stream as notifications (`/api/notifications/stream`); `brand.js` shows the invitation toast, and the space page joins on accept (`app:invite-accept`, or `/#join=<aside id>` from another page). It needs the private-conversation permission and the environment's setting; an invitation lasts two minutes.
- **Currencies.** `GET /api/currencies` (anyone signed in; otherwise 401 `sign in first`) answers
  `{ currencies: [codes] }`, sorted: exactly the codes `PATCH /api/settings` accepts, the ISO 4217 codes the
  server's Node knows (`CURRENCIES` in `server/store.js`), plus the one already stored if it is not among them
  (`currencyCodes()` in `server/currencies.js`). A module gets the same list as `host.locale().currencies`, and
  `host.ui.currencySelect` draws it; a page that is not a module (Manage) gets the same drawing from
  `window.hostCurrency`, which `/sdk/host.js` defines. Names come from the viewer's browser
  (`Intl.DisplayNames`), not the server.
- **Words.** An environment's levels and roles are shown in its own words (plan-environment-templates, step 1).
  The code names never change; only what people read does. `server/words.js` holds the thirteen keys (`host`,
  `environment`, `space`, `home`, `aside`, `canvas`, `module`, `object`, `admin`, `owner`, `moderator`, `member`,
  `guest`) and their defaults; `host` and `admin` are the host's and can't be changed. `home` is what the home page,
  the list of spaces, is called (plan-primary-nav, decision 13). With no word of its own (the owner's, else the
  template's) it follows the resolved `space` word: both its forms are that word's plural with a capital ("Spaces",
  "Trips"; `homeDefault()`), and its `a` takes the usual article ("a Trips"), which nothing shows. `fill()` has no
  placeholder for it. `branding()` (so `/api/branding`,
  `/api/config`, `/api/me` and `/api/settings`) carries `words`: every key as `{ one, many, a }`, resolved.
  `GET /api/settings` also gives the owner `ownWords`, only what they set. `PATCH /api/settings`
  `{ words: { <key>: { one, many, a? } | null } }` (owner only; `null` puts one back) checks every word and refuses
  the whole save with a sentence naming the word ("The word for `<key>` needs both its singular and its plural.",
  "... can be at most 30 characters.", "... can use only letters, spaces, hyphens and apostrophes.", "... with its
  article must be its singular with the article in front, such as "a `<word>`"."); for `home`
  they read "The word for the home page …"). The server's own sentences go
  through the same words.
  In the pages, `public/words.js` gives `word(key, { many, cap, a })`, `fill(text)` for placeholders such as
  `{space}`, `{Spaces}` and `{a space}`, and `applyWords(root)`, which fills `data-word` elements (with
  `data-word-form="many cap a"`) and `data-fill` text and attributes (`title`, `placeholder`, `aria-label`, `alt`,
  `data-title`); call `applyWords(el)` after cloning a `<template>`. The browser caches an environment's own words
  under `app.words`. Modules get the words from `host.locale().words`, `host.util.word` and `host.util.fillWords`
  (see [api-module-sdk](../api/api-module-sdk.md)). `tools/check-names.mjs --words` fails, in `server/`, `public/` and
  `modules/`, on a changeable word typed into text people read; the host console and the product page use the
  host's own words and are allow-listed.
  Beside the words, `branding()` carries `verbs`, the actions a person reads on a button: `enter` (default
  "Enter"), the word on a space's main button and the guest form, and `layout` (default "Layout"), the space bar's
  Layout button. Pages read them with `verb('enter')`, `data-verb="enter"` or `{enter}` in `fill()` (and the same for
  `layout`); the owner sets it with `PATCH /api/settings` `{ verbs }`. See
  [architecture-environments](architecture-environments.md), "Templates", for the contract.
- **Who sees a link that signs someone in.** A person's personal sign-in link (`linkToken`) is sent only to owners
  and to that person, and never in `GET /api/status`, whatever key the request carries. A space's guest link
  (`guestToken`) is sent only to owners and to members of that space who may manage its guest link; everyone else
  (other members, guests, the stream access key) gets `null`, in `GET /api/spaces`, `GET /api/presence` and the
  aside answers alike. Before this, the access key in every OBS link could read every personal link from
  `/api/status`, an owner's included.
- **Secrets at rest.** Two-step sign-in secrets, the environment's AI key and the host's managed AI keys are
  encrypted with the server's key (`secrets.key` beside the data on a single install, `host.json`'s key with
  environments); a key saved in plain text by an older version is encrypted on first load. `app.json`,
  `host.json`, `ai.json` and `secrets.key` are made readable only by the server's own user (mode 600), on every
  start and again after a restore or a migration. An AI key that can't be read with this server's key (data
  restored onto another host) doesn't stop the other AI settings from saving; the AI settings say "the saved AI
  key can't be read on this server; enter the key again".
- **Writes only from this origin.** A POST, PUT, PATCH or DELETE that carries a cookie is refused with 403
  `{ error: "This request came from another site, so it was refused." }` when the browser says it came from
  anywhere but this origin (`Sec-Fetch-Site`), or its `Origin` isn't this one (`baseUrl()`, which minds
  `X-Forwarded-*`). A `SameSite=Lax` cookie still rides along from another origin on the same site (every
  environment is `*.BASE_DOMAIN`), which is why this is needed. Passed through: a `Bearer` token (Studio), a request
  with no cookie (webhooks, server-to-server), one with neither header (old browsers, curl), and `POST /login`, which
  the landing page at the bare base domain posts across origins by design and which trusts only the login and
  password it is sent. `sameOriginOnly` in `server/index.js`; `tools/check-origin.mjs` covers it. Follow-ups are
  GitHub #70.
- **Themes.** A theme is `{ id, name, author?, light, dark }` in the environment's settings, each set holding the
  seven base colours and thirteen optional ones by their stored names (`bg`, `bgSection`, `border`, `text`, `textDim`,
  `accent`, `onAccent`, `card`, `headerBg`, `headerText`, `navBrandBg`, `navBrandText`, `navRightBg`, `navRightText`, `icon`, `iconHover`, `primaryHover`, `secondary`,
  `secondaryText`, `secondaryHover`), `null` for Auto (a stored theme, a theme file or a template's theme without a key reads it as Auto, so it looks as before); `server/theme-css.js` is the one place that maps them to CSS (`navBrandBg` to `--nav-brand-bg`, `navBrandText` to `--nav-brand-text`, `navRightBg` to `--nav-right-bg`, `navRightText` to `--nav-right-text`; the top bar's colour areas, see [design-theme](../designsystem/design-theme.md)). A file exported here carries the four nav keys (`null` on Auto); an older server reading it drops them and names them in `dropped`, so `formatVersion` stays 1.
  `GET /api/themes/:id/export` (owner; `default` is Strong Coffee) answers the file
  `{ format: "theme", formatVersion: 1, name, author?, light, dark }` with every key in each set, as
  `<name>.theme.json`, or 404 "no such theme". The marker pair is named by kind, never by the product, and read by
  one rule for all three file formats (`server/file-format.js`, [plan-kind-names](../plans/plan-kind-names.md)).
  `POST /api/themes/import` (owner; the file's text or JSON as the body, at most 16 KB) checks each set as a theme made in Manage would be (`sanitizeTheme`), adds it as a new theme
  ("Name (2)" when the name is taken, never overwriting) without applying it, and answers `{ theme, dropped }`:
  `dropped` lists what was left out, unknown keys and any optional colour that isn't `#rrggbb` (which goes back to
  Auto). It refuses with 400 "That isn't a <product> theme file.", "This theme was made by a newer version of
  <product>.", "That theme file is in an older format. Export the theme again and import the new file." (a file
  from before the formats were named by kind) or "This theme has no complete light or dark set: each needs all seven
  base colors.", where <product> is `PRODUCT_NAME`. A body the parser can't read at all (an unknown charset or
  encoding) gets the same "That isn't a <product> theme file."; Manage
  decodes a UTF-16 file by its byte-order mark before sending it. An environment holds at most 100 themes
  (`MAX_THEMES`): an import past that answers 400 "This environment has 100 themes, the most it can hold. Delete
  one to import another." A theme's name and author lose line breaks and tabs (made spaces) and control, direction
  and zero-width characters (a joiner inside a combined emoji is kept); the name is cut to 40 whole characters,
  the author to 60 (`cleanThemeText()` in `server/store.js`). `tools/check-themes.mjs` holds the round trip and the
  refusals.
- **Chat history.** Chat travels live on the live stream (see "The live stream" below), not through LiveKit. The sender posts the text to `POST /api/spaces/:id/chat`; the server (`server/chat-history.js`) keeps the public messages in `DATA_DIR/chat.json` (under `spaces`) and the private ones in `DATA_DIR/chat-private.json`: the last 500 public messages per space and the last 200 private ones per person per space, none older than 30 days. `GET /api/spaces/:id/chat` returns the public ones and the caller's own private ones to whoever joins ([plan-chat-model](../plans/plan-chat-model.md)). A message is private or public (`visibility`), and its author flips it with `PATCH /api/spaces/:id/chat/:messageId`; the server tells the live stream (`chat-visibility`), and the others' pages add or remove it. The fields and routes are in [api-modules](../api/api-modules.md), "Chat routes". Reading needs the `chatRead` permission and posting `chat`, and the caller must be a member of the space (an owner or the admin, or a guest of that space, also counts). The sender's name is the account's display name as the server knows it; a guest supplies their own. An aside has no chat (its id answers 404), pictures are never stored on disk: the server holds the bytes in memory for `CHAT_PICTURE_KEEP_MINUTES` (15), tells the live stream a small `chat-picture` event and each reader fetches them with their own access (bounded per space, environment and server, the oldest pushed out first; see [api-modules](../api/api-modules.md), "Chat routes"), and one person can post 30 messages in 10 seconds. Deleting a space deletes its history. Browsers that kept history locally under the old scheme still show it when the server has none for the space.
- **The live stream.** Each space page, and Home when the person may read the chat, holds one server-sent stream, `GET /api/live` ([plan-realtime-optional-livekit](../plans/plan-realtime-optional-livekit.md)). Being in a space is that stream being open: the page waits for its first `ready` to enter, and closing it is leaving. The server keeps who is where in one in-memory register per environment (`server/live.js`, pure, with the clock handed in): the open streams, a 15-second grace after the last one closes so a reload or a short drop does not read as leaving, who says they are on the call, who is away and with what message, and nudges held for a stream that is reconnecting (30 seconds). A person is in the space of their most recently opened stream; nothing is stored. The stream carries, as `{ type, ... }` notices (`ready` first, with the `stream` id): `presence` (everyone in the space, on connect and on every change); the chat's `chat`, `chat-delete`, `chat-clear`, `chat-clear-some`, `chat-visibility`, `chat-preview`, `chat-kept` and `chat-picture`, sent only while the reader may read the chat and never for a private message; the asides' `aside-pull`, `aside-started`, `aside-recall` and `aside-return`, only to the people they are for; and `removed` (`reason` `access` or `kicked`), after which the stream ends. Nothing is replayed, so a page reads the history after every `ready`. The page says its own state back with `PATCH /api/spaces/:id/presence` (away and its message, on the call), again after every `ready`, since a new stream starts with nothing said. Access is asked again while the stream is open (`STREAM_RECHECK_MS`, 2 seconds, and at once when a guest link is turned off or replaced or a space changes) and a ping goes out every 25 seconds so a proxy keeps it open. A guest opens it with `?guest=` and the `?pass=` that `POST /api/guest-join` gave. Open streams are counted per signed-in person (`LIVE_STREAMS_PER_PERSON`) and per guest link and address (`LIVE_STREAMS_PER_GUEST_LINK`), in memory per environment. The page side is `public/space-live.js` and `openLive()` in `public/space.js`; a page's `liveChatStream()` reconnects with a retry and, when the server will not take it back, says "Live chat is paused. Reload the page to try again." Events, statuses and limits are in [api-modules](../api/api-modules.md), "The live stream"; the page side is in [architecture-canvas](architecture-canvas.md), "Home" and "The conference and the call".
- **Attention.** What needs a person's action in a space is kept per space, person and module in `DATA_DIR/attention.json` (`server/attention.js`; one file per environment, so an export or a backup carries it). A report is cleaned by one pure function (`cleanReport`: count 0 to 99, label 40, up to 20 items of a 120-character title and an optional object reference), a report older than 7 days is dropped when read and when the file is loaded, and `forgetSpace`, `forgetPerson` and `forgetModule` remove reports when their space or person is deleted, or their module is uninstalled with its data deleted. The routes are in [api-modules](../api/api-modules.md), "What needs action"; the strip that shows the sum is in [architecture-canvas](architecture-canvas.md), "The status strip".
- **One input in Chat** ([plan-one-input](../plans/plan-one-input.md)). `public/chat-input.js` reads the box before it is sent: `/ai` goes to `POST /api/spaces/:id/ai` and the question and the reply are stored as the asker's private messages in `chat-private.json` (`ai-threads.json` is gone; its threads were moved in once, `server/chat-history.js`). A command's echo is the person's private message too (`kind: "command"`), stored by `POST /api/spaces/:id/command`. Each message is drawn with its module's colour and icon (`color` from `/api/modules/for-space`; gold for the AI), and a filter, **All | Private | Public** (`#chat-filter`, `data-filter` on `#messages`, `data-vis` on each message), hides the rest on the page only, remembered per space for the browser session (`chat-filter:<spaceId>`). Any other `/<name>` is looked up among the `commands` the space's modules declare (from `/api/modules/for-space`) and sent to `POST /api/spaces/:id/command`, which puts a `local` request on the module bus; Chat names no module in code. A module's question (Research's **Research this**) reaches Chat through `host.chat.ask`, which `public/module-host.js` hands to the page via the canvas's `onChatAsk`. Keeping an object from an answer, and bringing research in, use the space's `actions` and `objects/check` routes. The routes are in [api-modules](../api/api-modules.md), "Chat routes".
- The server checks permissions on every request that matters (kick, mute, guest links, aside, images).
  The pages also hide controls the person cannot use, but that is convenience, not enforcement.

## Spaces and calls

The server's routes and fields say space and environment since step 5a of the
[Names plan](../plans/plan-names.md). A space is `GET/POST /api/spaces`, `POST /api/spaces/order`,
`GET/PATCH/DELETE /api/spaces/:id`, `PUT/DELETE /api/spaces/:id/image`, `POST/DELETE /api/spaces/:id/guest-link`,
`GET/POST /api/spaces/:id/chat` and `DELETE /api/spaces/:id/members/:key`, answering `{ space }` or `{ spaces }`;
a person's settings in a space are `/api/me/spaces/:spaceId...` and `/api/users/:key/spaces/:spaceId...`; an
account's list is `spaces` and an invite's `spaces`. The environment's name is `environmentName` (in the
branding every page reads, `/api/me` and `/api/settings`, including `PATCH`). `POST /api/token` takes `space` and
is now only an OBS viewer's token (see below); a guest's join answers `spaceId`, `spaceName`, `permissions` and the guest's `guest` `{ id, name, pass }`, and no token. The
old `/api/rooms...` paths answer 404. Saved links redirect (`server/old-links.js`). For good (301, the rest of the
query kept): `/img/room/:id` to `/img/space/:id`, `/img/:key/:slot?room=&roomOnly=1` to `?space=&spaceOnly=1`,
`/modules/:id?moduleRoom=` to `?space=`, and `/room.html` to `/space.html`. The pages that Set up replaced answer a
302, and the browser keeps the address's fragment, which names Set up's tab: `/spaces/:id` and `/rooms/:id` go to
`/?setup=<id>`, `/module-settings?space=<id>` (or `?room=<id>`) goes to `/?setup=<id>#modules`, and
`/space-settings.html`, `/roomconfig.html`, `/module-settings.html` and `/module-settings` with no id go to `/`.
`/?setup=<id>#<tab>` is the Set up panel's own address ([architecture-canvas](architecture-canvas.md), "Set up").

Each space has one call, a LiveKit room (LiveKit's own word for a call) named from the space's id (`lobby` for the Lobby, `aside-<id>` for an
aside, each prefixed `<slug>.` on a hosted server; see "Call names" in
[architecture-environments](architecture-environments.md)). Nothing about the name is stored. The call carries audio,
video and reactions only; chat, who is here, away and the asides' nudges are the live stream's. A person is never at
LiveKit until they join the call.

An aside is not a space. Since step 8 of the Names plan it is its own record, `asides` in `app.json`:
`{ id, members, origin, private, createdAt }`, where `origin` is the space it was pulled out of (null for a
private conversation started by invite) and `private` marks an off-the-record conversation. It holds the call
only: no name, modules, chat, chat pictures, layout or settings of its own. The server removes it once nobody
online is in it (`pruneAsides()` in `server/store.js`, after a short grace period). Spaces no longer carry
`ephemeral`, `origin` or `private`. `POST /api/call/join` accepts an aside's id as `space`; any other route under
`/api/spaces/:id` (chat, settings, modules) answers 404 "no such space" for one. In an aside the page offers the
call alone: no chat, no chat pictures, no modules (`inAside()` in `public/space.js`).

- `GET /api/presence` answers who is online and where (`users`, `spaces`, `asides`, `activeSpace`, `ownerOnline`,
  and the environment's branding), from the live register and each page's own presence ping. LiveKit is asked only for
  the microphone and camera marks (`micOn`, `cameraOn`), and only while the register has someone on a call. A signed-in
  person, the access key (`?s=` or `x-stream-key`) or a guest's token (`?guest=`) may ask; anyone else gets 401
  "sign in first". The answer is filtered by membership ([plan-primary-nav](../plans/plan-primary-nav.md),
  decision 6, step 3): a viewer reads where a person is only for the spaces and asides the viewer belongs to. Every
  space member belongs to the Lobby; owners and the admin belong to every space and every aside. The rules are
  `presenceView()` in `server/presence-view.js` (the viewer is `presenceViewer()` in `server/index.js`), held by
  `tools/check-presence.mjs`.
  - Each user carries `online`, `present`, `space`, `inCall`, `aside`, `asidePrivate` and `elsewhere`:
    - in a space the viewer belongs to: `space` is its id, `aside: false`, `elsewhere: false`;
    - in an aside the viewer belongs to: `space` is the aside's id, `aside: true`;
    - in an aside pulled out of a space the viewer belongs to, but not the viewer's aside: `space` is that parent
      space's id, `aside: true`, `inCall: false`. `asidePrivate` says whether it is a private conversation, and
      nothing in the answer says who else is in it;
    - anywhere else: `space: null`, `elsewhere: true`, `online: true`, `inCall: false`;
    - in no call: `space: null`, `aside: false`, `elsewhere: false`, `inCall: false`.
    The viewer always reads their own place.
  - `spaces` lists every space, each with `mine` (whether the viewer belongs to it). `asides` lists only the asides
    the viewer belongs to, each record with `mine: true`.
  - `activeSpace` is the space the stream follows, or `null` when it is somewhere the viewer cannot see: a space
    they do not belong to, or an aside they are not in.
  - A guest reads only their own space: `spaces` holds it alone, `users` holds the people in it and its members
    (members who are not in it read `online: false`, `present: false`, with no place), and nobody else.
  - The access key (Coffee Pub Studio, OBS) reads everything, as before.

  `GET /api/status` is unchanged and still carries `asides` (the records), and `GET /api/spaces` lists spaces
  only. `online` means in a space. When LiveKit does not answer within two seconds, both routes answer with
  the marks off (GitHub #71; the client's timeout is in [architecture-environments](architecture-environments.md),
  "Call names"). The space page does not wait on presence: joining, a reload back into a space and the join screen
  go ahead with the spaces they already know, `loadPresence()` gives up after three seconds, and the next poll tries
  again (`public/space.js`).
- A space may carry `opensWith`: the modules its first visit opens, in order, the built-ins `conference` and `chat`
  included ([plan-entering](../plans/plan-entering.md)). It is up to 20 distinct ids matching `^[a-z][a-z0-9-]{0,31}$`,
  stored in `app.json`, and absent while not set; the store's space cleaning (`cleanOpensWith()` in `server/store.js`)
  drops repeats and anything else, and keeps an id for a module that is off or not installed, so turning it back on
  restores it. It comes with the space wherever the space is answered (`GET /api/presence`, `GET /api/spaces`,
  `GET /api/status`, `POST /api/spaces`, the `PATCH` answer), and `GET /api/modules/for-space` answers it as
  `opensWith` beside `spaceDefaultsOpensWith` and `defaultLayout` (a space's default saved layout, which sets `opensWith`; see [api-modules](../api/api-modules.md), "Saved layouts"). Asides never carry it. `PATCH /api/spaces/:id` (owners, the admin and, for `opensWith`, `phases` and
  `defaultLayout` only, the space's moderators; see [api-modules](../api/api-modules.md), "Phases on a space") takes
  `opensWith: [ids] | null`: `null`, `[]` or a list with nothing usable left clears it. Anything else that is not an
  array of strings answers 400 "Opens with must be a list of modules." and nothing in the request is saved; 401
  "sign in first", 403 "owners only", 404 "no such space". The same cleaning keeps `aiOff` (the space's **Turn AI
  off in this space**), which until 2026-09-30 was dropped every time `app.json` was loaded.
- `POST /api/token` `{ role: 'viewer', space }` answers an OBS viewer's token, `{ token, livekitUrl, identity, call, spaceId }`, with the access key; 400 for anything else (a person's token is made only by `POST /api/call/join`), 503 with no call service. `POST /api/guest-join` `{ token, name }` answers `{ spaceId, spaceName, permissions, guest: { id, name, pass } }` and no LiveKit token; `pass` proves the guest's id and name to the live stream and to the call. No person's token is minted by entering a space, so nobody is at LiveKit until they join the call, and there is no `call` attribute any more.
- `POST /api/call/join` is asked by the page just before it joins the call, for the plan's calls cap. A signed-in
  person sends `{ space }` (the Lobby when left out) and must belong to it, or be an owner; a guest sends
  `{ guest }`, the guest link's token, in the body or as `?guest=`, and may send `space` only as that link's own
  space. It answers 200 `{ ok: true, token, livekitUrl, call }`, the call's token, the only one a person gets (a guest also sends its `pass`); 503 "voice and video are not set up on this server" with no call service, before anything else; 401 "sign in first"; 403 "voice and video are off" or "you can't join the call in this <space>" where the person may not, "you are not in that space", "that guest link is
  for another space", or the cap's sentence, "This <environment>'s plan allows N call(s) at once; one is running
  in <space>". The sentence names a space only to someone who belongs to it (`overCallsSentence()`); otherwise it
  reads "in an aside" (the `aside` word) or "in another <space>" (the `space` word). `POST /api/asides` uses the
  same sentence. 404 "no such space" or "that guest link is off or wrong". An aside's call is never refused here.
  How the cap counts is in [architecture-environments](architecture-environments.md), "Phases 2 to 5".
- `POST /api/asides` `{ with, private }` pulls people who are in the caller's call into a new aside and answers
  `{ aside }`, the aside's record. It answers 403 "asides are turned off" or "private conversations are turned off" (or the caller
  lacks the permission), 400 "pick someone to pull aside" or "you need to be in a call yourself to pull someone
  aside", 404 "`<name>` is not with you right now", 409 "`<name>` is not in the conference right now", 403 with the calls cap's sentence when the aside would
  start a call over the plan's limit (asked before anyone is pulled). It reads the live register, not LiveKit. With no call
  service every aside route answers 503 "voice and video are not set up on this server"; with the Conference off they answer
  403 "voice and video are off".
- `POST /api/asides/invite` `{ to }` makes a private aside for two and answers `{ aside, invite: { id } }` (the aside's record);
  `POST /api/asides/invite/:id/decline` answers `{ ok: true }`.
- `POST /api/asides/recall` (an owner) tells every private conversation pulled out of the owner's space to come
  back, and answers `{ recalled }`, the number of them; 400 "you need to be in a space yourself to recall anyone"
  or "nobody is off in a private conversation from here right now".
- `POST /api/asides/return` takes the caller, and the aside's other members, back to the space the aside came
  from (the Lobby when that space is gone) and answers `{ space }`; 400 "you are not
  in an aside".

The server tells the other people involved on the live stream (never LiveKit), on four topics: `aside-pull`
`{ type, spaceId, byOwner, private, from }` to the people pulled, `aside-started` to everyone on the call the
aside was pulled out of, the people pulled included, `aside-recall` `{ type, spaceId, spaceName }` and `aside-return` `{ type, spaceId }` (before step 5a they carried `roomId` and `roomName`). The old
`/api/table...` routes answer 404 and the old topics are no longer sent.

`aside-started` is what lets the people left behind turn the tiles of those who stepped out into placeholders at
once, before the next presence poll. An ordinary aside's is `{ type, spaceId, members, private: false }`. A private
conversation's is `{ type, spaceId, private: true }`, with no members: who is in it stays off the record, and the
page learns who stepped out from `GET /api/presence` (`aside: true`, `asidePrivate: true`), which it asks at once.
The space page reads a message without `private` as private, so it never names anyone by mistake, and keeps what
an ordinary aside's message said (`startedAsides` in `public/space.js`) for the placeholders, since presence tells
someone outside the aside only which space they stepped out of.

## Hosting

`docker-compose.yml` has two services, meant to be pasted into Container Station. `collaborator` is the app and is all
that most things need; `livekit` is the part you add for voice and video. The app starts without it: leave out the
`livekit` service and the three `LIVEKIT_` settings (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_HOST`;
`LIVEKIT_API_URL` is optional too) and it logs "No LiveKit: voice and video are off." instead of refusing to start. If
only one of the two keys is set it says which is missing and starts the same way. Then `branding().callService` is
false, the call's routes (`POST /api/call/join`, a viewer's `POST /api/token`, mute, the asides) answer 503 "voice and
video are not set up on this server", the Conference can't be switched on (`PATCH /api/settings` answers 503), and the
pages hide the call, the Conference and asides; Manage > Modules says "Voice and video are not set up on this server"
with the switch off. `livekit` is from the
official image, configured entirely through an environment variable (keys, TURN, ports 7880 for
signaling, 7881 TCP and 7882 UDP for media, 3478 for TURN), and `collaborator`, the Node app from
`ghcr.io/drowbe/coffee-pub-collaborator`, built by GitHub Actions. A reverse proxy terminates TLS for both
hostnames, because browsers only allow camera access over HTTPS.

**The address a request came from.** `TRUST_PROXY_HOPS` (default 1; a whole number of 0 or more, else a line in the log and 1) is how many reverse proxies stand in front of the container, and is given to Express as `trust proxy`. `req.ip` is then the address the nearest trusted proxy saw, never the leftmost `X-Forwarded-For` entry, which the client writes; `X-Forwarded-Proto` and `-Host` (`req.protocol`, `req.hostname`, so `BASE_DOMAIN`'s host matching) are read only from a trusted proxy's connection. Every limit by address (sign-in among them, and guests in chat) counts by it. With `0` the connection's own address is used. The share links of a library ([api-modules](../api/api-modules.md), "Share links") are the one public route that depends on it most: their limits on wrong passwords count by this address, so the number must equal the proxies actually in front of the container (`0` when it is reached directly). Too high lets a visitor write their own address and dodge the limits; too low gives every visitor the proxy's address, so they limit each other. It used to be `true`, which let a client choose its own address. `LIVE_STREAMS_PER_PERSON` (50), `LIVE_STREAMS_PER_GUEST_LINK` (25) and `GUEST_CHAT_POSTS_PER_MINUTE` (20) are the limits on the live stream and on a guest's chat ([api-modules](../api/api-modules.md), "The live stream"); a value that is not a whole number above 0 means the default. All four are commented examples in `docker-compose.yml`. `LIVE_STREAMS_PER_PERSON` and `LIVE_STREAMS_PER_GUEST_LINK` were `CHAT_STREAMS_PER_PERSON` and `CHAT_STREAMS_PER_GUEST_LINK`; the old names are not read. `CHAT_PICTURE_MAX_MB` (default 3) is the most one chat picture may weigh.

**Frames.** The app page (`/space.html` and `/`) answers `frame-ancestors 'none'` and `X-Frame-Options: DENY`. The pages our own frames hold answer `frame-ancestors 'self'` and `SAMEORIGIN`, and a framed request that would have redirected into a refusing page gets a short page and its status instead; the list and the exceptions are in [api-modules](../api/api-modules.md), "Behavior to rely on".

`MAP_IMAGE_MAX_MB` (default 100, in `docker-compose.yml` as a commented example) is the most a picture map file may weigh, in megabytes: the upload route for a module's picture map stops at it ([api-modules](../api/api-modules.md), "Picture maps"). A value that is empty or not a positive number means 100. It is a limit on one file, not on the data folder; a restore refuses more than 500 MB in all ([plan-map-image](../plans/plan-map-image.md), decision 6).

Bandwidth is the real sizing number: eight players at 720p is roughly eight times 1.5 Mbps in and about
eight times seven times 1.5 Mbps out at the server. Player quality is capped by an owner's setting.

## Design rules

- **A list is not an editor.** A list shows what exists and lets you pick one; editing happens on a page about
  that one thing. People (`/profile/<key>`) and spaces (Set up, `/?setup=<id>`) work this way: their Manage tabs are a
  roster of a picture, a name, a status line and a link. Keep new admin surfaces to this shape rather than growing
  an inline editor on a list; the two earlier ones scaled badly enough to need rebuilding.
- **Picture slots.** A picture a person sets is a `.slot` holding `.slot-pick-wrap > label.slot-pick >
  input[type=file]`, and a page with slots imports `/slot-paste.js` from its own module script. That one import
  gives every slot on the page, including ones drawn later (it watches the page), a paste by Ctrl+V or Cmd+V
  while the slot has focus, a **Paste** button where the browser offers `navigator.clipboard.read` in a secure
  context, Enter and Space to open the file chooser, the "Paste or click to choose" hint, and a name for screen
  readers. A pasted picture is put into the slot's own file input and a `change` event is sent from it, so the
  page's existing upload handler, limits and messages apply unchanged. A slot that is `.still`, disabled, hidden
  or in a disabled fieldset takes no paste and no focus; a paste in a text field is left alone. The name is the
  slot's `data-slot-name` (level words in braces are filled from the environment's words, `fill()`), or else its
  caption (a `<span>` in the `.slot`, outside the picture) followed by "picture", after the name of each
  `data-slot-group` it sits in, outermost first; an empty `data-slot-group` takes its group's first heading.
  `tools/check-slot-names.mjs` (in `npm run check`) reads the pages' markup and fails a slot with neither a
  `data-slot-name` nor a caption, a `.slot` holding more than one picture, a picture outside a `.slot`, and a
  page with slots whose script does not import `/slot-paste.js`.

## Development

```bash
npm install
LIVEKIT_HOST=localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=... \
ADMIN_LOGIN=gm ADMIN_PASSWORD=secret npm run dev
```

Data goes to `./data` unless `DATA_DIR` says otherwise. `LIVEKIT_API_URL` overrides the HTTP address used
for the LiveKit server API when it differs from the WebSocket host. `npm run check` syntax-checks every
script; `npm run check:docs` checks the documentation structure.
