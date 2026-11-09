# Module Live Plan: short live messages between the people using a module

**Audience:** Thomas, who decided it; server-development (the route, the delivery, the limits and the checks),
experience-design (the SDK, the module host and the Whiteboard's pointers), quality-assurance (an independent security
read) and content-manager (the documents).

**Status:** Approved by Thomas, 2026-11-09, relayed by the project manager. Nothing built. The request, in Thomas's
words: "it sounds like we might need a socketmanager api for use by modules to facilitate clients communicating. we did
something like that for my blacksmith module" (the Blacksmith wiki's `api-sockets.md` and
`architecture-socketmanager.md`). His condition on the approval: "I want to ensure this is not part of livekit". The
first use is the Whiteboard's live pointers (#496): a cursor for each person, in their colour, with their name. It must
serve any module: who is editing, a typing mark, a nudge. Facts marked **(code)** were read in the code for this plan;
**(inferred)** were not checked; nothing here was run.

## What it is today

### The Blacksmith model, and what to design away

From `architecture-socketmanager.md` and `api-sockets.md` in the Blacksmith wiki:

- `waitForReady()`, `register(eventName, handler(data, userId))`, `emit(eventName, data, { userId | recipients })`,
  `isReady()`. With no options an emit reaches every other connected client, never the sender. Data is any serializable
  object; the examples add `timestamp: Date.now()` so a receiver can drop stale positions.
- **Targeting is on receipt, not on the wire.** Under both transports (SocketLib and Foundry's native socket) the payload
  goes to every client and each decides whether to dispatch it ("Targeting is receipt-side, not wire-level"). Hence its
  rule "never send secrets through `sockets.emit()`".
- **`register` overwrites silently and has no unregister.** Under the native fallback, outside handlers share one map
  with Blacksmith's own, so registering `ping` breaks the latency checker; module-id prefixes are a requirement.
- **A resolved emit proves nothing.** The native fallback never checks who is connected and always resolves `true`.
- **Not covered:** size limits, rate limits, permissions, expiry.

This plan keeps the shape (publish, subscribe, everyone else by default, targeted sends) and moves every decision about
who receives a message to the server.

### What Collaborator already has

- **The live stream**, `GET /api/live`, one per space page: `presence`, chat, the asides' nudges, `removed`
  (`server/index.js:5216-5280`). It is built on `eventStream()` (`server/index.js:5066-5135`), which counts open streams
  (`LIVE_STREAMS_PER_PERSON` 50, `LIVE_STREAMS_PER_GUEST_LINK` 25, `server/index.js:4963-4965`), asks the access again
  every `STREAM_RECHECK_MS` (2 seconds, `:5055`) and drops a reader more than `LIVE_STREAM_BUFFER_MB` behind. Who is where
  is the in-memory register in `server/live.js` (`LiveRegister`, a 15-second grace, `:23`). A guest is identified by the
  id on their signed pass (`readGuestPass`, `:3699`; `:5222`). **(code)**
- **The module stream**, `GET /api/modules/stream`, one per page, shared by every module mount on it and relayed to
  window frames (`server/index.js:10276-10472`; `joinStream()` in `public/module-host.js:44-58`;
  `public/module-stream.js`). Every event is checked against the viewer at send time by `place()` (`:10291-10310`):
  the module on in that space, the viewer a member (or that space's guest), the module's `read` permission there.
  It does not go through `eventStream()`: no count of open streams and no periodic recheck. It uses no LiveKit. **(code)**
- **The module bus**, `POST /api/bus/publish` (`server/index.js:7657-7672`, `server/module-bus.js`): events between
  modules, declared in `module.json` and approved by an owner, up to 2,000 bytes, **stored** in `DATA_DIR/modules/bus.json`
  for 14 days and replayed to modules that were closed, 60 a minute per module and person (`server/module-limits.js:14`).
  It is the wrong tool for pointers (stored, replayed, written to disk on every publish, 1 a second) but it is the model
  for routing: the host page fills the module id, and the module stream delivers to `subscribers` only (`:10365-10372`;
  `public/module-host.js:2297-2299`). **(code)**
- **`liveAccessChanged()`** (`server/index.js:5346`) makes every open live stream ask its access again at once. It is
  called when guests are turned off, a guest link is regenerated or turned off, and a space changes
  (`:4026`, `:4051`, `:4081`, `:4086`). It was not found on removing a member from a space or changing a role, so those
  wait for the 2-second recheck on the live stream and are not rechecked at all on the module stream **(inferred from
  reading the call sites; not run)**.
- **The SDK's `host.on`** already returns an unsubscribe (`public/sdk/host.js:3538-3542`). **(code)**
- **Identity a module already gets:** `host.ready()` gives `t.user` `{ key, name, role }`; `host.people()` gives the
  space's members as `{ key, name }` (`public/module-host.js:1948-1954`); the live stream's `presence` gives everyone in
  the space, guests included, as `{ key, name, guest, ... }` to the space page. **(code)**
- **A guest in a module** carries only the guest link's token (`busGuest()`, `public/module-host.js:1252`), not their pass,
  so the module routes cannot tell two guests on one link apart. **(code)**
- **No person colour exists.** Nothing in `server/` or `public/` gives a person a colour (searched). The eight tints
  (`--tint-*`) exist for modules and phases. **(code)**
- **LiveKit** is required by `server/index.js:11` (`livekit-server-sdk`) and loaded in the page only for the call and
  `host.media.watch` (`public/module-host.js:85`). Its data channel carries reactions only (`public/space.js:4799`).
  Since plan-realtime-optional-livekit, LiveKit is optional and a page connects to it only while on the call
  (`plan-realtime-optional-livekit.md:61`); that plan already decided module messages do not ride LiveKit (`:45`). **(code)**
- **The Whiteboard** (`modules/whiteboard`, 0.1.16) is space-only; `view` is on for guests, `edit` off for them. It saves
  each block as one key, last write wins, with a 600 ms save delay (`architecture-whiteboard.md`, "Storage and sync"). **(code)**
- A small mismatch for content-manager: `architecture-overview.md` says `LIVE_STREAMS_PER_PERSON` and its siblings are
  commented examples in `docker-compose.yml`; they are not in that file today. **(code)**

## Decisions

Thomas, 2026-11-09, relayed by the project manager. Only the first is in his own words; the rest are his choices among
the options this plan laid out.

1. **The transport is the module stream, and it is not part of LiveKit.** A message is sent with a POST and received on
   the existing `GET /api/modules/stream`. "I want to ensure this is not part of livekit": no code path of `host.live`
   uses LiveKit, its data channel or the call connection, and it works with no LiveKit configured and with nobody on a
   call. A check proves it (below). Reason: it reaches every module mount already, window frames included, decides
   delivery per reader on the server, and LiveKit is optional and connected only while on the call.
2. **Anyone who can see the module may send**; a module's manifest may require one of its permissions to send. For the
   Whiteboard, a guest who can only look shows a pointer.
3. **Join and leave are tracked by the server**, so a closed tab leaves on its own and a module can show who is there.
4. **The person's colour is picked by the host** from the person's key, among the eight tints, the same in every module.
5. **Limits:** 256 bytes a message, 20 a second for one person in one module, as environment variables.
6. **Spaces first.** Environment pages (the Calendar's page) come later, if needed.
7. **No acknowledgements.** A module that needs confirmation uses storage or an action.
8. **The sender's other tabs are left out**, as the sending tab is.

## The contract

### The rule: not LiveKit

- `host.live` and everything under it (the SDK, `public/module-host.js`'s live calls, the route, the delivery and the join
  register) use only the app server: a POST to send, `GET /api/modules/stream` to receive. None of it reads
  `HAS_CALL_SERVICE`, calls the call service, mints a token, connects to LiveKit, or loads `livekit-client`.
- The server's part lives in its own file, `server/module-live.js` (pure, the clock handed in, as `server/live.js` is),
  which requires nothing from LiveKit. The route in `server/index.js` calls only it and the existing access checks.
- It works the same with `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` unset, with Conference off, and with nobody on a call.
- For the documents, one line: "Live messages travel over the app's own server, never over the call; they work with no
  voice and video set up and with nobody on a call."

### The SDK

```js
const off = host.live.subscribe('pointer', (data, from, meta) => { ... }); // returns unsubscribe; many handlers per topic
await host.live.publish('pointer', { x, y });             // everyone else here who may see the module
await host.live.publish('nudge', { text }, { to: [key] }); // only these people (keys, or a guest's id)
host.live.on('people', ({ joined, left, people }) => { ... }); // who has joined this module's live messages here
host.live.state;                                           // 'connecting' | 'open' | 'closed'; host.on('live', fn) on change
```

- `from` is `{ key, name, guest, tint }`: the name and key presence already shows, and `tint`, one of the eight tint
  names (`blue`, `green`, `teal`, `purple`, `orange`, `pink`, `gold`, `red`), picked from the key by one fixed rule in one
  shared function, so a person has the same colour in every module and on every page. Draw it with `var(--tint-<name>)`.
  `meta` is `{ at, seq }`, stamped by the server.
- A topic is 1 to 40 of `a-z 0-9 . _ -`, and belongs to the module: the host fills the module id and the space, and the
  server keys every message by both, so a module never hears another module's topics and cannot replace another's handler.
- `publish` resolves when the server took the message, never when it was delivered. Messages are **lossy**: none is
  stored, none is replayed after a reconnect, and one may be dropped under load. There is no acknowledgement.
- **Sender left out:** every page of the sender (all their tabs), whether sent to everyone or to a list naming them.
- **Coalescing:** for each topic the SDK sends at most the per-module rate, keeping only the newest message waiting.
- Only on a space's page (`scope: 'space'`). On an environment page `host.live.state` is `'closed'` and `publish` rejects
  ("live messages are only in a space").

### The manifest

`"live": true` in `module.json`. No owner approval: the messages never leave the module, and the people are those who
can already see each other in the space. `"live": { "publish": "<permission key>" }` requires one of the module's own
permissions to send; without it, seeing the module (its `read`) is enough. Refused at install: `live` without the
`space` scope, or `publish` naming a permission the module does not declare.

### The server

- `POST /api/modules/:id/live?space=<id>` `{ topic, data, to? }` (a guest adds `?guest=` and `?pass=`). Checks, in
  order: the module is enabled and declares `live`; the viewer may read it in that space (`moduleAccess` with `read`,
  which covers the module on there, membership, a guest's own space and `guards.shut`); the `publish` permission when
  named; a guest's pass is valid; the size; the rates. Answers `{ ok: true }`, or 400 (bad topic, data or `to`), 401,
  403, 404, 413 (too big) and 429 with `Retry-After`.
- `POST /api/modules/:id/live/join` and `/leave` `?space=<id>` `{ stream }`, `stream` naming the module stream connection
  (the module stream gains a first `ready` event with its id, as `GET /api/live` has). The register keeps who has joined
  per module and space, in memory, with a short grace for the stream's own reconnect; a stream that closes leaves
  every module it joined after the grace. `joined` and `left` go to the others who may read the module there; a join
  answers the people there now.
- Delivery: a `live` event on `/api/modules/stream`, `{ module, topic, data, from, at, seq, spaceId }`, only to
  connections whose reader may read that module in that space, never to the sender's connections, and for `to` only to
  those people. People not there are skipped silently. Connections are indexed by space, so a message touches only the
  readers of that space.
- Who may read is kept per connection and asked again every `STREAM_RECHECK_MS` and at once on `liveAccessChanged()`.
  **Part of step 1:** `liveAccessChanged()` is also called when a member is removed from a space, a role's permissions
  change, a person's role or moderator flag in a space changes, a module is turned off in a space, and a person is
  deleted or signed out everywhere; this also closes the gap on the existing live stream.
- In memory, per environment (as `live` and `liveEvents` are, `proxyFor`): nothing is written to disk.
- **Limits, in environment variables** (a value that is not a whole number above 0 means the default):
  - `MODULE_LIVE_BYTES` (256): the most a message's `data` may be, as JSON.
  - `MODULE_LIVE_PER_SECOND` (20): messages a second for one person in one module, with a burst of the same.
  - `MODULE_LIVE_PER_PERSON` (40): messages a second for one person across all modules.
  - `MODULE_LIVE_PER_GUEST_LINK` (60): messages a second for everyone on one guest link together.
  - `MODULE_LIVE_TO` (20): the most people one message may name in `to`.
- A guest needs a valid pass to send or join (their identity is the pass's id, as on the live stream). Without one
  they still receive.

### Pages

- `public/module-host.js` passes `live` events to the mounts of that module in that space, adds the `live.*` calls, sends
  joins on subscribe and leaves on unmount, and sends the joins again after the module stream reconnects or moves to
  another connection (`public/module-stream.js`).
- The space page hands a guest's pass to the module host (today it hands only the token).

## The worked example: the Whiteboard's live pointers

- On open, the board subscribes to `pointer` and reads `host.live.on('people')`.
- While the pointer moves over the board, it publishes `{ x, y }` in board units (not screen pixels, so zoom and scroll
  do not matter); the SDK coalesces to at most 20 a second. When the pointer leaves the board it publishes `{ off: true }`.
- Each receiver draws a small arrow and the sender's name at that point in `var(--tint-<from.tint>)`, moves it smoothly,
  drops a message whose `seq` is older than the last from that person, hides it after a quiet time (about 10 seconds)
  and removes it on `left`.
- Guests who can see the board send and see pointers (decision 2).
- About 30 bytes a message. Nothing about it is stored, so it needs no guard, no undo and no clear.

## Security

- **Between environments:** the register and the emitter are per environment (`proxyFor`), as the live stream's are.
- **Between spaces:** the space comes from the server's own check of the sender, never from the message, and only
  connections reading that module in that space receive it.
- **Ex-members and revoked access:** their sends are refused at once (each POST is checked); they stop receiving at once
  where `liveAccessChanged()` is called and within `STREAM_RECHECK_MS` otherwise.
- **Flood and abuse:** the size cap, the rates per person, per module and per guest link, the `to` cap, and the stream's
  existing buffer limit for slow readers. Nothing is stored, so a flood cannot fill the disk.
- **Identity:** `from` is the name and key presence already shows, read from the account at send time, and a tint. A
  module cannot set `from`.
- **What stays true:** a module running in the page (the admin's warned choice) can do anything the page can, as today.
  A person can post to any module they may read, under their own name; the receiver sees who sent it.

## Verify

A new `tools/check-module-live.mjs`, added to `npm run check`, on a throwaway server:

1. **Not LiveKit.** The server is started with `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` unset, and every point below
   passes on it, with nobody on a call. Read as code by the check: `server/module-live.js` requires nothing that names
   LiveKit, and the live route, `host.live` in `public/sdk/host.js` and the live calls in `public/module-host.js` mention
   none of `livekit`, `callService`, `HAS_CALL_SERVICE`, `publishData`, `/api/call/` or `/api/token`. Then a second run
   with dummy keys and a stand-in call service that counts every call to it: sending, joining and receiving live messages
   makes no call.
2. Two members in a space: a message reaches the other, never the sender's own two tabs; `to` reaches only the named one.
3. Nothing reaches: another space's member, a member without `read`, another space's guest, another environment's reader
   (a two-environment server, `BASE_DOMAIN`), a guest after the link is turned off.
4. **The access gap closed:** a member removed from the space, and a member whose role loses the module's `read`, stop
   receiving at once (well under `STREAM_RECHECK_MS`), on the module stream and on `GET /api/live`, and their next send
   is refused.
5. Refusals: a module without `live` (400), no `read` (403), the `publish` permission missing (403), a guest without a
   pass (403), data over `MODULE_LIVE_BYTES` (413), past each rate (429 with `Retry-After`), a bad topic or `to` (400).
6. `joined` and `left`: a closed stream sends `left` after its grace; a reconnect within the grace sends neither.
7. Nothing is written to `DATA_DIR`.
8. The SDK, against a stand-in stream: coalescing keeps the newest, unsubscribe stops delivery, two handlers on one topic
   both hear, another module's topic of the same name is not heard, the tint is the same for a key every time.

`check-names` and `check:docs` as always. The Whiteboard's own check gains the pointer drawing against stand-in events.

**What can't be checked here:** the feel of pointers between two real browsers on a real network, and load beyond a
handful of people. Neither needs LiveKit; Thomas can try both on his install.

## Security-sensitive, and held

Steps 1 to 4 are security-sensitive: who receives a message, the guest pass on module routes, and the
`liveAccessChanged()` calls. A larger model builds them on a held branch, and quality-assurance reads them
independently before anything reaches Thomas. None of them goes out as a try build. Steps 5 to 7 follow once the read
passes.

## Documents to update (content-manager)

- `api-module-sdk.md`: a "Live messages" section beside "Live changes", with the not-LiveKit line.
- `api-modules.md`: the manifest's `live`, the routes, the `live`, `ready`, `joined` and `left` events on the module
  stream, the limits.
- `architecture-modules.md`, "Live changes": the delivery, the join register, the not-LiveKit rule.
- `architecture-overview.md`: the not-LiveKit line beside the live stream; the claim about `docker-compose.yml` corrected.
- `architecture-whiteboard.md`: the pointers.
- `userguide-settings-reference.md`: the five variables.

## Left to build, in order

1. **Server: the route, the delivery, the limits and the access gap** (server-development; held). `server/module-live.js`,
   `POST /api/modules/:id/live`, the `live` event, the manifest's `live`, the five variables, the per-connection access
   with the recheck, and the missing `liveAccessChanged()` calls. Check: points 1 to 5 and 7.
2. **Server: join and leave** (server-development; held). The module stream's `ready` id, the join register, `joined` and
   `left`. Check: point 6.
3. **Server and pages: guests** (server-development, then experience-design; held). The pass on module routes, the space
   page handing it to the module host. Check: the guest cases in points 3 and 5.
4. **The independent security read** of steps 1 to 3 (quality-assurance). Nothing goes to Thomas before it passes.
5. **The SDK** (experience-design). `host.live.*` in `public/sdk/host.js` and `public/module-host.js`, the shared tint
   rule. Check: point 8 and point 1's code read.
6. **The Whiteboard's pointers** (experience-design). A version bump. Check: the Whiteboard's check, then Thomas tries it
   in two browsers.
7. **Documents** (content-manager).

## Still open

Nothing blocks the build. Later, if wanted: live messages on environment pages (the Calendar's page), and a colour a
person picks in their profile.
