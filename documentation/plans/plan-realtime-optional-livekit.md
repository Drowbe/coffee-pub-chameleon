# Real-time Without LiveKit Plan

**Audience:** Thomas, deciding how entering a space, chat and presence stop depending on LiveKit; then server-development (the live stream, presence, the routes), experience-design (the space page) and content-manager (the documents and the compose file).

**Status:** Approved by Thomas 2026-10-26, from GitHub #376, which Thomas calls mission critical: "using LiveKit has to be optional." Steps 1 to 7 are built, and the QA fixes are done, including pictures held briefly in memory and fetched by each reader (2026-10-27). Step 8, stored chat pictures, is not built. Since then (2026-11-02, health audit MP-01) a space's window frames share the page's event stream instead of opening their own (a relay, `?space=&page=1`, event ids); that is a change to the stream, not a step of this plan, and is described in [architecture-modules](../architecture/architecture-modules.md), "Live changes". Next plan: `plan-call-as-module`. The findings under "What it is today" were read in the code before the build, not run against a LiveKit server; the build was checked by tools with no LiveKit server, and the call itself has not been tried on a real one (see "Verify"). His decisions are at the end.

This plan takes over steps 2 to 4 of [plan-optional-conference](plan-optional-conference.md) (chat and presence without LiveKit, LiveKit optional, conference on later). That plan's step 1, the Conference switch (`conferenceEnabled`, Manage > Modules), is built and stays as it is.

## What it is today

LiveKit carries much more than audio and video. Entering a space connects the page to the space's call at LiveKit, and the space then leans on that connection for who is here, live chat, asides and away.

### Entering a space

- `join()` in `public/space.js` asks `POST /api/token` for a token, then `connectAndSetup()` runs `call.connect(livekitUrl, token)`. If that fails, the catch forgets the space and shows the error: **nobody can enter a space without a working LiveKit.** A guest goes the same way: `POST /api/guest-join` mints a LiveKit token and `joinAsGuest()` calls `connectAndSetup()`.
- Everyone connects with the `call` attribute `off` (`mintToken()` in `server/index.js`); a click on Join sets it `on`. So switching Conference off does not avoid the connection.
- Leaving the space is LiveKit's `Disconnected` event: the handler at `RoomEvent.Disconnected` in `space.js` clears the canvas, the chat, the tiles and the space. Moving to an aside or back (`reconnectTo()`) is a LiveKit disconnect followed by `join()`.
- The server will not start without `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (`server/index.js`, at start).

### Presence

- **Where a person is** comes from LiveKit. `participants()` asks LiveKit for every call and its people (`listRooms`, `listParticipants`), with `inCall`, `micOn` and `cameraOn`. `GET /api/presence` (polled every 5 seconds by `loadPresence()`), `GET /api/status` (OBS, Studio), `activeSpaceId()` (the space the stream follows), `store.pruneAsides()`, the kick and mute check (`canModerate()`, `callOf()`) and the aside routes all read it.
- **Whether a person is on the site** is already the server's own: every page posts `POST /api/presence` every half minute (`startPresence` in `public/brand.js`), held in memory for 75 seconds (`present`).
- **Who is here** (`public/space-people.js`), the conference's "Not in a call" list (`syncWhoIsInCall()`) and the Start or Join call label (`paintJoinCall()`) read the LiveKit connection's participants directly.

### Chat

- The sender posts to `POST /api/spaces/:id/chat` (stored), then `publishChat()` sends it to the others over LiveKit's data channel (topic `chat`). If the post fails, the text goes out live with `sendChatMessage` and is never stored.
- The server's notices (delete, clear, visibility, link preview, kept) go out through `tellChat()`, which sends both to LiveKit (`callService.sendData`, topic `chat`) and to the server's own channel (`chatEvents`).
- **The server already has the live path.** `GET /api/spaces/:id/chat/stream` is a server-sent stream with the chat's access rules, guest support (`?guest=`), access rechecks, caps per person and per guest link, and a 25-second ping. A post to any space is already emitted on it. Home's chat and a guest in the Lobby use it (`liveChatStream()` in `space.js`). The space page does not.
- **Chat pictures** (before this plan) were never stored: `sendImage()` sent them as a LiveKit byte stream (topic `chat-image`), and only the people connected at that moment see them.

### Reactions and away

- A reaction is a LiveKit data message (topic `reaction`), never stored. It floats up from a call tile (`showReaction()`) and from a person's OBS box (`host.media.watch`'s `reaction` handler in `public/module-host.js`). Tiles exist only on the call.
- Away is two LiveKit participant attributes, `away` and `awayMessage` (`awayAttributes()`, `syncAwayAttributes()`), read by others' tiles.

### Asides

- An aside is a call only (no chat, no modules). `POST /api/asides`, `/api/asides/recall` and `/api/asides/return` tell the people involved through LiveKit (`callService.sendData`) on four topics: `aside-pull`, `aside-started`, `aside-recall`, `aside-return`. `POST /api/asides` needs the caller and the people pulled to be on the call, as LiveKit reports it.
- An invitation to a private conversation (`POST /api/asides/invite`) already goes through the server's notification stream (`/api/notifications/stream`), not LiveKit.

### Modules

- **Module messages do not ride LiveKit.** The issue says they do; the code says otherwise. Module data changes, bus events, actions, settings and markers come over the server's own stream, `GET /api/modules/stream` (`joinStream()` in `public/module-host.js`). The `RoomEvent.DataReceived` in `module-host.js` belongs to `host.media.watch`: the OBS view's viewer connection hearing one person's reactions. That is media and stays with LiveKit.
- `host.presence` reads `GET /api/presence`, so it follows wherever presence comes from.

### The call, OBS and the stream module

- The call itself (tiles, microphone, camera, screen share, speaking, mute, kick) is LiveKit and stays LiveKit.
- `POST /api/call/join` checks the calls cap before a join; `runningCalls()` counts people whose `call` attribute is `on`.
- An OBS view (`/view/<key>`, the Stream module's keyed page, `modules/stream/src/stream-keyed.js`) takes a hidden viewer token (`POST /api/token` with `role: 'viewer'`) and watches one person's media with `host.media.watch`; it follows the person with `host.presence`.

### Checks

- `tools/check-chat-stream.mjs` and `tools/check-guest-chat.mjs` start the server with dummy LiveKit keys and no LiveKit; LiveKit calls fail fast and `participants()` answers nobody. `tools/check-canvas.mjs` runs the page's `DataReceived` handler against a stand-in call. `tools/shots-livekit-stub.mjs` stands in for the LiveKit client so screenshots can show a space.

## The target

- Entering a space, its chat, who is here, away and asides' nudges need no LiveKit.
- LiveKit is used only for audio and video, only while Conference is on and the server has a call service, and only when a person starts or joins the call.
- A single-environment install with LiveKit configured behaves as before for the people using it.
- Guests (by link) and asides keep working. Asides are calls, so they are there only when the call is.
- A server with no LiveKit keys starts, and everything but the call works: local design work, reviews, and environments that want chat and modules only.
- No data migration: nothing stored changes shape. The product is not released, so old routes are replaced, not kept.

## Options

### 1. The channel: server-sent events, WebSockets, or both

**A. Server-sent events for server to page, ordinary requests for page to server** (the chat stream's pattern).

- Costs: little. The pattern, its caps, its ping, its access recheck, the per-environment `envContext` handling and the page's reconnect (`liveChatStream()`) all exist and are checked. Express 5 serves it as a normal route, so the session cookie, the guest token, the environment by host name and the origin check all apply as they do now. Nginx Proxy Manager passes it with the `X-Accel-Buffering: no` header already sent; the 25-second ping keeps a proxy's idle timeout from closing it.
- Rules out: nothing needed now. The page sends little (a chat post, an away change, joining or leaving the call), and requests do that fine.
- Weakness: over plain HTTP/1.1 a browser opens at most six connections to one site, across all its tabs. Each space page already holds three streams (notifications, modules, Home's chat). Behind a proxy with HTTP/2 (Nginx Proxy Manager offers it) the limit is gone. Locally on `http://localhost:3000` it is real.

**B. WebSockets.**

- Costs: a new package (`ws`; Node 22 has a WebSocket client, not a server); the upgrade happens outside Express, so the environment lookup, the session, the guest token and the origin check must be done again by hand; the proxy host needs WebSocket support switched on (Nginx Proxy Manager has a switch; the app's host may not have it on today); reconnect and resume are ours to write.
- Gains: one connection both ways, outside the six-connection limit, slightly faster for frequent page-to-server messages. Nothing planned here sends often.

**C. Both:** server-sent events now, the events defined so a WebSocket could carry the same shapes later. The cost of C is only discipline in the contract.

**Lean (a suggestion):** A, written as C allows: one server-sent stream per space page, called the **live stream**, that replaces Home's chat stream and the guest chat stream, so a space page still holds three streams, not four. Requests for everything a page says. WebSockets only if a later feature needs fast two-way traffic.

### 2. Where "on the call" comes from

- **A. The page says it** (`PATCH .../presence { onCall }` when the join succeeds and when it ends; the stream closing ends it). No LiveKit question for presence at all. A crashed page is wrong for at most the grace time.
- **B. LiveKit says it**, asked as now. Presence then still waits on LiveKit (the two-second timeouts of GitHub #71) whenever the call service is configured.
- **C. Both:** the page's word for presence; LiveKit's own list for what is a media act (the calls cap, kick, mute, `micOn` and `cameraOn` in `/api/status`), asked only when presence says someone is on a call.

**Lean:** C. Presence never waits on LiveKit; the cap and moderation stay exact.

### 3. Reactions

- **A. Keep them on the call's data channel.** They show only on call tiles and OBS boxes, both media, so they are part of the call. No change to the Stream module.
- **B. Move them to the server.** `POST /api/spaces/:id/reactions`, sent on the live stream. The OBS view then needs its own server stream (it has only the access key), and the Stream module changes.

**Lean:** A. Reactions need the call to be seen anyway.

### 4. Chat pictures

- **A. Stored with the message**, uploaded to the server like an attachment, and told on the live stream. Everyone sees them, later visitors too. Needs a size cap and counts toward storage.
- **B. Live only, relayed by the server** from memory to open streams. Same as today's reach, no storage.
- **C. Pictures only while the call service is there.** Keeps today's code, but a chat feature would then need LiveKit, against the target.

**Lean:** A, as its own step after this plan's core; until then pictures follow B.

### 5. Where the code lives

- **A.** A new `server/live.js`: the presence register (who is in which space, on the call, away), pure functions a check can run alone, like `server/presence-view.js`. The routes in `server/index.js` beside the chat routes.
- **B.** Everything in `server/index.js`.

**Lean:** A.

## The contract

Everything below follows the lean options. Where Thomas picks otherwise, the matching part changes.

### Server

**The presence register** (`server/live.js`), per environment, in memory like `presence` today:

- An entry per open live stream: `{ who, space, onCall, away, awayMessage, openedAt }`, where `who` is a user key or a guest's id.
- A person is **in** a space while one of their streams for it is open, and for a grace of 15 seconds after the last one closes, so a reload or a short drop does not read as leaving. A person with streams in two spaces reads as in the one opened last.
- `inCall` is the page's word (option 2), cleared when the stream closes.
- `GET /api/presence` and `GET /api/status` answer from the register, with the same shapes and the same rules in `presenceView()` as now. `online` means in a space (as today, where being in a space meant being connected). `micOn` and `cameraOn` are merged from LiveKit's list only when the register has someone on a call and a call service is configured; otherwise false. `activeSpaceId()`, `store.pruneAsides()` and `canModerate()` read the register.

**`GET /api/live`**, the live stream (server-sent events, `text/event-stream`):

- Query: `space` (a space or an aside id; left out on Home, which is in no space), `guest` (the guest link's token) and `pass` (the guest pass, below).
- Access: a signed-in member of the space, or an owner or the admin; a guest only for their link's space, with a valid pass. An aside only for its members, or an owner. 401 "sign in first", 403 "you are not in that space", 404 "no such space", 429 when too many are open (the chat stream's caps, counted the same way).
- Each event is a default `message` with `data: { type, ... }` and an `id:` line. Types:
  - `ready` `{ you, space }`, first, once listening.
  - `presence` `{ space, people: [{ key, name, guest, onCall, away, awayMessage }] }`: the whole list for the space, on connect and on every change. Small, so no deltas.
  - The chat notices exactly as today (`chat`, `chat-delete`, `chat-clear`, `chat-clear-some`, `chat-visibility`, `chat-preview`, `chat-kept`), each with `space`. The stream carries the current space's chat and the Lobby's (Home's chat and its unread count), and only to a viewer with `chatRead` there. A private message is never sent.
  - `aside-pull`, `aside-started`, `aside-recall`, `aside-return`, with today's shapes, sent only to the people they are for.
  - `removed` `{ reason }` (`kicked`, or the access no longer holding), then the stream ends. This replaces the chat stream's `closed`.
- Nothing is replayed on reconnect: `ready` and `presence` restate the state, and the page catches chat up from `GET /api/spaces/:id/chat` as Home's chat does. An aside nudge for a person whose stream is reconnecting is kept for 30 seconds and sent when it opens again.
- A ping every 25 seconds; the access rechecked every 2 seconds and at once on `chatAccessChanged()`, as the chat stream does.

**Requests a page makes:**

- `PATCH /api/spaces/:id/presence` `{ away?, awayMessage?, onCall? }` (the same access as the stream; `awayMessage` trimmed to 200 characters) answers `{ ok: true }` and sends `presence` to the space. A guest adds `?guest=&pass=`. An aside's id is accepted (away and the call apply there).
- `POST /api/spaces/:id/chat` is unchanged; the server tells the live stream of every space, not only the Lobby. `tellChat()` stops sending to LiveKit.
- `POST /api/call/join` `{ space }` or `{ guest, pass }`: the calls cap as now, then answers the LiveKit token, `{ token, livekitUrl, call }`. This is the only way a person gets a call token. 503 "voice and video are not set up on this server" when there is no call service, 403 when Conference is off or the person may not join it.
- `POST /api/token` keeps only the OBS viewer's token (`role: 'viewer'`, the access key); for a person it is gone. 503 as above with no call service.
- `POST /api/guest-join` `{ token, name }` answers `{ spaceId, spaceName, permissions, guest: { id, name, pass } }` and no LiveKit token. The pass is signed by the server (the link's token, the guest's id and name), so a guest cannot speak as another guest; it dies with the link.
- The asides routes check and nudge through the register and the live stream instead of LiveKit. `POST /api/asides` still needs the caller and the people pulled on the call (the register's `onCall`). With no call service, or Conference off, they answer 403 "voice and video are off".
- `POST /api/users/:key/kick` removes the person from the call at LiveKit (when they are on it) and sends them `removed { reason: 'kicked' }`, so they leave the space as they do today. `POST /api/users/:key/mute` is unchanged and needs the call.

**The call's LiveKit side:** a token is minted only at `POST /api/call/join`, so being at LiveKit means being on the call. The `call` attribute goes; `runningCalls()` counts everyone who is not hidden. Away is no longer a LiveKit attribute.

**No call service:** with `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET` unset the server starts, says once in its log "No LiveKit: voice and video are off", builds no LiveKit client and never asks it. `branding()` gains `callService: true | false`. The Conference card on Manage > Modules shows "Needs a LiveKit server" and its switch cannot be turned on. `conferenceAllowed()` reads both. Set with both keys, the install behaves as before.

### Pages

- **Entering** (`join()`, `joinAsGuest()`): no token, no LiveKit. The page opens the live stream for the space, draws the canvas, the chat and who is here, and is in. An error entering is the server's answer to the stream or to `canvas.refresh()`, never LiveKit's.
- **Leaving** is its own function: close the live stream, end the call if on it, clear the space. LiveKit's `Disconnected` now means only that the call ended; the space stays.
- **Moving** to an aside or back (`reconnectTo()`): leave the call, switch the live stream to the new space, join the new call when a pull says so (`keepCall`), as today.
- **Joining the call**: `startCall()` asks `POST /api/call/join`, connects to LiveKit with the token it answers, publishes the microphone, then sends `onCall: true`. Hanging up disconnects from LiveKit and sends `onCall: false`.
- **Who is here, "Not in a call" and Start or Join call** read the live stream's `presence`, not LiveKit.
- **Chat**: `publishChat()`, the `chat` and `chat-image` LiveKit handlers and the `sendChatMessage` fallback go. Every chat notice comes from the live stream. A post that fails says "Not sent. Try again." and is not sent some other way. Home's chat reads the same live stream (the Lobby's notices).
- **Away**: `PATCH .../presence`; the tiles and who is here read it from `presence`. The microphone, camera and hearing parts of away are unchanged.
- **With the live stream down**: the page retries as `liveChatStream()` does (2, 4, 8 seconds, up to 60), shows "Reconnecting..." in the chat's connection line, and on a refusal (401, 403, 429, `removed`) says once "Live updates are paused. Reload the page to try again." The space stays open; posting still works.
- **With no call service, or Conference off**: no Conference module, no Start call, no asides or private conversation offers, no reaction tray. Nothing in the space says LiveKit.
- **OBS views** (the Stream module): with no call service the box shows the person's pictures and presence only, never an error; `host.media.watch` answers a state with `online: false` and the reason. A module change, so the Stream module's version goes up.

### Permissions

Unchanged. The stream adds no permission: being allowed in the space is the test, and `chatRead` decides whether chat notices are sent. Conference permissions still gate the call.

## Data

None to migrate. Nothing stored changes: chat history, asides and settings keep their shape, and presence lives in memory. Routes and fields that go (`GET /api/spaces/:id/chat/stream`, a person's `POST /api/token`, the `call` and away attributes at LiveKit) are removed outright, with no alias.

## Build order

Steps 1 to 7 are built. Each step left the product working with LiveKit as it is today, and is built and checked on its own.

1. **The register and the live stream** (built) (M, server-development). `server/live.js`; `GET /api/live` with presence only; `PATCH /api/spaces/:id/presence`; `GET /api/presence` and `GET /api/status` answered from the register, LiveKit merged for media fields. The page still connects to LiveKit as now.
2. **The page on the live stream** (built) (M, experience-design). Open the live stream on entering; who is here, "Not in a call", Start or Join call and away read it and write to it. LiveKit still connected; nothing removed yet.
3. **Chat on the live stream** (built) (M, server-development S, experience-design M). The server sends every chat notice there and stops sending chat to LiveKit; the chat stream route goes; Home's chat and the guest's chat move to the live stream; the page drops `publishChat()` and the LiveKit chat handlers. Pictures relayed by the server (option 4 B): a small event on the stream, the bytes held in memory for 15 minutes and fetched by each reader.
4. **Asides and kick off LiveKit** (built) (S, server-development; S, experience-design). The four aside nudges and `removed` on the live stream; the asides routes and `canModerate()` read the register.
5. **Enter without LiveKit** (built) (L, experience-design with the larger model; S, server-development). Tokens only from `POST /api/call/join`; guest-join without a token, with the guest pass; `join()`, leaving and `reconnectTo()` rebuilt as above; the `call` attribute gone. The riskiest step: the space page's leave and move paths change.
6. **No LiveKit at all** (built) (M, server-development; S, experience-design). Optional keys, `callService`, 503 answers, the Conference card, the space and OBS views without a call service; the Stream module's version bump.
7. **The documents** (built) (M, content-manager). architecture-overview (presence, chat, asides, hosting), architecture-canvas (the conference and the call), api-modules (chat routes, the live stream), api-module-sdk (`host.media.watch` with no call service), the getting-started guide and `docker-compose.yml` (LiveKit as the part you add for video), the CHANGELOG.
8. **Stored chat pictures** (not built; M, server-development and experience-design), if Thomas picks option 4 A.

## Verify

The checks must pass with no LiveKit server, and from step 6 with no LiveKit keys.

1. A new `tools/check-live.mjs`, in `npm run check`, runs the register's pure functions (grace, two tabs, two spaces, `onCall` cleared on close) and starts a server: two people open the stream for one space, each sees the other in `presence`; away and `onCall` changes arrive; a non-member gets 403, a signed-out page 401; the caps answer 429. `tools/check-presence.mjs` keeps holding `presenceView()` with the register as its source. Checked by a tool.
2. Run the page against a local server: entering a space shows who is here from the stream with LiveKit still connected. Read as code and seen in a browser locally; the Start or Join label with others on a call needs a real call.
3. `check-live` covers chat: a post reaches the other stream, deletes and visibility arrive, a reader without `chatRead` gets none, a guest with a pass gets the Lobby's and their space's. `check-chat-stream` and `check-guest-chat` fold into it. Two browsers locally: chat is live between two people in a space with no call. Checked by a tool, then seen locally.
4. `check-live`: an aside nudge reaches only its people; a kick sends `removed` and ends the stream; a nudge for a reconnecting stream arrives within 30 seconds. Pulling people on a call needs a real call.
5. `check-canvas` moves from the stand-in call's `DataReceived` to the live stream handler. Locally, with LiveKit keys set and no LiveKit running: enter a space, chat, switch spaces, leave; the server log shows no call to LiveKit. Joining the call, hanging up, moving with a pull and the calls cap need a real LiveKit.
6. `check-live` and a startup check run the server with no LiveKit keys: it starts, `branding().callService` is false, `POST /api/call/join` and a viewer `POST /api/token` answer 503, presence and chat work. Locally: the space has no Conference, Start call or asides; an OBS view shows pictures. The screenshots tool no longer needs `shots-livekit-stub.mjs` except for screens of the call.
7. `npm run check:docs`.

**Needs a real LiveKit, and can't be checked here:** the call itself (tiles, audio, video, screen share, speaking), joining and hanging up, the calls cap counting, kick and mute on a live call, pulls into and out of asides while on the call, reactions on tiles and OBS boxes, the OBS view's video, and a reconnect of the call during a network drop. Thomas or a QA pass on a real server.

## Risks

- **The space page's leave and move paths.** `space.js` treats LiveKit's `Disconnected` as leaving the space, and asides move by disconnecting. Step 5 changes that in a 7,700-line file. Steps 1 to 4 keep LiveKit connected so each part moves on its own first.
- **Ghosts.** A stream behind a proxy may look open a while after a phone loses signal; the ping finds it within about 25 seconds, plus the grace. Today LiveKit is faster at this.
- **Connections over HTTP/1.1.** Three streams per tab today; two tabs of a space page reach the browser's six. The plan keeps it at three, but does not lower it.
- **One process.** The register is in memory, as presence and the chat stream are now; two server processes would each see half. No change from today.
- **The page's word for `onCall`** can be wrong after a crash for up to the grace. The cap and moderation still ask LiveKit.

## Decided

Thomas decided these on 2026-10-26.

1. **Server-sent events**, one live stream per space page plus ordinary requests (option 1 A). It is simpler behind proxies and needs no new dependency.
2. **"On the call"** comes from the page's word for presence; LiveKit's list answers the calls cap, kick, mute and the media fields (option 2 C).
3. **Reactions** stay with the call (LiveKit) and are never stored (option 3 A). They only show on tiles and OBS boxes.
4. **Chat pictures** go live through the server in step 3 and are stored later as step 8 (option 4 A).
5. **Kick** removes a person from the call and the space, both, as today. This unblocks step 4.
6. **With no call service**, the Conference is hidden in spaces, and the Manage > Modules card says once: "Voice and video are not set up on this server." This unblocks step 6.
7. **The call does not become a true module in this plan.** It is known that this is coming soon and is a critical part of the product. It is the planned next plan, `plan-call-as-module`, to be written after step 6, with critical priority. This plan makes it possible by taking LiveKit out of entering a space, chat and presence.
8. **Order:** real-time steps 1 to 6 first, before the content builders (lists, cards, tables, forms; slices 10 to 13 of [plan-unified-layout](plan-unified-layout.md)). Entering a space without LiveKit is what lets anyone try the product.
9. **Rename** `CHAT_STREAMS_PER_PERSON` and `CHAT_STREAMS_PER_GUEST_LINK` to `LIVE_STREAMS_PER_PERSON` and `LIVE_STREAMS_PER_GUEST_LINK` in the chat step (step 3), since they will count the live stream.
10. **The notification stream** folds into the live stream later, in its own small plan, to bring a space page from three streams to two. `brand.js` opens it on every page, not only the space page.

## Not decided

Nothing blocks the build.
