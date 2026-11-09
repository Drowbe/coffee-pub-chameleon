# Module Live Plan: short live messages between the people using a module

**Audience:** Thomas, deciding the transport, the contract and the limits; then server-development (the route, the
fan-out, the limits and the checks), experience-design (the SDK, the module host and the Whiteboard's pointers),
quality-assurance (an independent security read) and content-manager (the documents).

**Status:** Draft for Thomas, 2026-11-09. Nothing decided, nothing built. The request, in Thomas's words: "it sounds like
we might need a socketmanager api for use by modules to facilitate clients communicating. we did something like that
for my blacksmith module" (the Blacksmith wiki's `api-sockets.md` and `architecture-socketmanager.md`). The first use is
the Whiteboard's live pointers (#496): a cursor for each person, in their colour, with their name. It must serve any
module: who is editing in the Calendar or To-do, a typing mark, a nudge. Facts marked **(code)** were read in the code
for this draft; **(inferred)** were not checked; nothing here was run.

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

This plan keeps the shape (publish, subscribe, everyone-else by default, targeted sends) and moves every decision about
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
  It does not go through `eventStream()`: no count of open streams and no periodic recheck. **(code)**
- **The module bus**, `POST /api/bus/publish` (`server/index.js:7657-7672`, `server/module-bus.js`): events between
  modules, declared in `module.json` and approved by an owner, up to 2,000 bytes, **stored** in `DATA_DIR/modules/bus.json`
  for 14 days and replayed to modules that were closed, 60 a minute per module and person (`server/module-limits.js:14`).
  It is the wrong tool for pointers (stored, replayed, written to disk on every publish, 1 a second) but it is the model
  for routing: the host page fills the module id, and the module stream delivers to `subscribers` only (`:10365-10372`;
  `public/module-host.js:2297-2299`). **(code)**
- **The SDK's `host.on`** already returns an unsubscribe (`public/sdk/host.js:3538-3542`). **(code)**
- **Identity a module already gets:** `host.ready()` gives `t.user` `{ key, name, role }`; `host.people()` gives the
  space's members as `{ key, name }` (`public/module-host.js:1948-1954`); the live stream's `presence` gives everyone in
  the space, guests included, as `{ key, name, guest, ... }` to the space page. **(code)**
- **A guest in a module** carries only the guest link's token (`busGuest()`, `public/module-host.js:1252`), not their pass,
  so the module routes cannot tell two guests on one link apart. **(code)**
- **No person colour exists.** Nothing in `server/` or `public/` gives a person a colour (searched). The eight tints
  (`--tint-*`) exist for modules and phases. **(code)**
- **LiveKit's data channel** carries reactions only (`public/space.js:4799`, topic `reaction`). Since
  plan-realtime-optional-livekit, LiveKit is optional and a page connects to it only while on the call
  (`plan-realtime-optional-livekit.md:61`); that plan already decided module messages do not ride LiveKit (`:45`). **(code)**
- **The Whiteboard** (`modules/whiteboard`, 0.1.16) is space-only; `view` is on for guests, `edit` off for them. It saves
  each block as one key, last write wins, with a 600 ms save delay (`architecture-whiteboard.md`, "Storage and sync"). **(code)**
- A small mismatch for content-manager: `architecture-overview.md` says `LIVE_STREAMS_PER_PERSON` and its siblings are
  commented examples in `docker-compose.yml`; they are not in that file today. **(code)**

## Options

### 1. The transport

- **A. The server's module stream down, a POST up** (`POST /api/modules/:id/live`, delivered as a `live` event on
  `/api/modules/stream`). Every module mount already hears that stream, window frames and popped-out windows included,
  and its `place()` rule is exactly "may see that module in that space". Delivery is decided per reader on the server, so
  nothing reaches anyone it should not. Costs: one HTTP request per message (about 10 to 15 a second per person while a
  pointer moves, after the SDK coalesces), each with a session check; works without LiveKit and for people not on the call.
- **B. LiveKit's data channel.** Low latency and no load on the app server. But only people on the call are connected,
  LiveKit is optional, a module page outside a space (the Calendar's environment page) has no LiveKit room, and LiveKit
  knows nothing of module permissions or guards: delivering only to the right people would mean filtering on receipt,
  the Blacksmith weakness. Can't be checked here (no LiveKit locally).
- **C. A new WebSocket.** Cheapest per message once open and two-way. Costs: a new dependency (Express 5 has none built
  in), a second auth path, reverse-proxy settings for every install (only LiveKit's host needs WebSockets today), and one
  more long-lived connection per page against the six a browser allows over HTTP/1.1 (`tools/check-streams.mjs`).

**Lean (suggestion): A.** It reuses the one stream every module already hears and the one permission rule; C is the
upgrade path if the POSTs prove too heavy, behind the same SDK.

### 2. Who receives: checked per message, or per reader with a recheck

- **A. Per message**, as `place()` does today. Exact at every send; at 15 messages a second from each of 8 people to 8
  readers that is about 1,000 permission checks a second in one space.
- **B. Per reader, cached**, asked again every `STREAM_RECHECK_MS` (2 seconds) and at once when access changes
  (`liveAccessChanged()`). Cheap; an ex-member may hear up to 2 seconds more. `liveAccessChanged()` is called today for
  guest links and space changes (`server/index.js:4026-4086`), not, as far as read, when a member is removed or a role
  changes **(inferred)**, so B needs those calls added.

**Lean (suggestion): B**, with the missing calls added and checked.

### 3. Join and leave

- **A. The server keeps who has joined** a module's live messages in a space (per module stream connection, in memory, a
  short grace for the stream's own reconnect), and sends `joined` and `left`. A closed tab leaves on its own. Needed for
  "who is editing".
- **B. No server state.** The SDK sends a leave on unsubscribe and when the page goes; receivers expire a person after a
  quiet time. A crashed tab's cursor lingers until it expires.

**Lean (suggestion): A**, and receivers may still expire a quiet cursor as they like.

## The contract (proposed; nothing here is decided)

### The SDK

```js
const off = host.live.subscribe('pointer', (data, from, meta) => { ... }); // returns unsubscribe; many handlers per topic
await host.live.publish('pointer', { x, y });            // everyone else here who may see the module
await host.live.publish('nudge', { text }, { to: [key] }); // only these people (keys, or a guest's id)
host.live.on('people', ({ joined, left, people }) => { ... }); // who has joined this module's live messages here
host.live.state;                                          // 'connecting' | 'open' | 'closed'; host.on('live', fn) on change
```

- `from` is `{ key, name, guest }`: no more than presence already shows. `meta` is `{ at, seq }`, stamped by the server.
- A topic is 1 to 40 of `a-z 0-9 . _ -`, and belongs to the module: the host fills the module id and the place (the
  frame's space, or the environment) and the server keys every message by both, so a module never sees another
  module's topics and cannot replace another's handler. There is no global name to collide with.
- `publish` resolves when the server took the message, never when it was delivered. Messages are **lossy**: none is
  stored, none is replayed after a reconnect, and one may be dropped under load. Anything that must arrive goes in
  storage or through an action.
- **Sender excluded:** every page of the sender (all their tabs) is left out, whether sent to everyone or to a list
  naming them.
- **Coalescing:** for each topic the SDK sends at most the per-module rate, keeping only the newest message waiting.
  A pointer stream is then one message every 70 ms or so, whatever the mouse does.

### The manifest

`"live": true` in `module.json`. No owner approval: the messages never leave the module, and the people are those who
can already see each other in the space. Optional `"live": { "publish": "<permission key>" }` to require one of the
module's permissions to publish; without it, the module's `read` permission is enough.

### The server

- `POST /api/modules/:id/live` `{ topic, data, to?, scope, space? }` (guest: `?guest=` and `?pass=`). Checks, in order:
  the module is enabled and declares `live`; the viewer may read it in that place (`moduleAccess` with `read`, which
  covers the module on there, membership, a guest's own space and `guards.shut`); the publish permission when one is
  named; a guest's pass is valid; the size; the rates. Answers `{ ok: true }`, or 400 (bad topic, data, `to`), 403, 404,
  413 (too big) and 429 with `Retry-After`.
- `POST /api/modules/:id/live/join` and `/leave` `{ scope, space?, stream }`, `stream` naming the module stream
  connection (the module stream gains a `ready` event with its id, as `GET /api/live` has).
- Delivery: a `live` event on `/api/modules/stream`, `{ module, topic, data, from, at, seq, scope, spaceId }`, only to
  connections whose reader may read that module in that place now (option 2), never to the sender's connections, and
  for `to` only to those people. People not there are skipped silently. The fan-out indexes connections by place, so a
  message touches only the readers of that space.
- In memory, per environment (as `live` and `liveEvents` are, `proxyFor`): nothing is written to disk.
- **Limits, in environment variables** (a value that is not a whole number above 0 means the default):
  - `MODULE_LIVE_BYTES` (256): the most a message's `data` may be, as JSON.
  - `MODULE_LIVE_PER_SECOND` (20): messages a second for one person in one module, with a burst of the same.
  - `MODULE_LIVE_PER_PERSON` (40): messages a second for one person across all modules.
  - `MODULE_LIVE_PER_GUEST_LINK` (60): messages a second for everyone on one guest link together.
  - `MODULE_LIVE_TO` (20): the most people one message may name in `to`.
- A guest needs a valid pass to publish or join (their identity is the pass's id, as on the live stream). Without one
  they still receive.

### Pages

- `public/module-host.js` passes `live` events to the mounts of that module in that place, adds the `live.*` calls, and
  sends joins on subscribe and leaves on unmount; it resends joins after the module stream reconnects or moves
  connection (`public/module-stream.js`).
- The space page hands a guest's pass to the module host (today it hands only the token).

## The worked example: the Whiteboard's live pointers

- On open, the board subscribes to `pointer` and reads `host.live.on('people')`.
- While the pointer moves over the board, it publishes `{ x, y }` in board units (not screen pixels, so zoom and scroll
  do not matter); the SDK coalesces to at most 20 a second. When the pointer leaves the board it publishes `{ off: true }`.
- Each receiver draws a small arrow and the sender's name at that point, in the sender's colour, moves it smoothly,
  drops a message whose `seq` is older than the last from that person, hides it after a quiet time (say 10 seconds) and
  removes it on `left`.
- Guests: they see the board (`view`), so they see pointers. Whether they send their own is the publish question below.
- About 30 bytes a message. Nothing about it is stored, so it needs no guard, no undo and no clear.

## Security

- **Between environments:** the register and the emitter are per environment (`proxyFor`), as the live stream's are.
  The check proves it on a two-environment server (`BASE_DOMAIN`).
- **Between spaces:** the place comes from the server's own check of the sender, never from the message, and only
  connections reading that module in that space receive it. Another space's member, a member of the space without the
  module's `read`, and a guest of another space's link receive nothing.
- **Ex-members and revoked guests:** they stop receiving within `STREAM_RECHECK_MS` and at once where
  `liveAccessChanged()` is called; their publishes are refused at once (each POST is checked).
- **Flood and abuse:** the size cap, the rates per person, per module and per guest link, the `to` cap, and the stream's
  existing buffer limit for slow readers. A refused message costs one 429. Messages are never stored, so a flood cannot
  fill the disk.
- **Identity:** `from` is the name and key presence already shows, read from the account at send time. No email, role or
  anything else. A module cannot set `from`.
- **What stays true:** a module running in the page (the admin's warned choice) can do anything the page can, as today.
  A person can post to any module they may read, under their own name; the receiver sees who sent it.

## What the checks must prove

A new `tools/check-module-live.mjs` (a throwaway server, no LiveKit):

1. Two members in a space: a message reaches the other, never the sender's own two tabs; `to` reaches only the named one.
2. Nothing reaches: another space's member, a member without `read`, another space's guest, another environment's
   reader, a person after being removed from the space (within 2 seconds), a guest after the link is turned off.
3. Refusals: a module without `live` (400), no `read` (403), the publish permission missing (403), a guest without a pass
   (403), data over `MODULE_LIVE_BYTES` (413), past each rate (429 with `Retry-After`), a bad topic or `to`.
4. `joined` and `left`: a closed stream sends `left` after its grace; a reconnect within the grace sends neither.
5. Nothing is written to `DATA_DIR`.
6. The SDK: coalescing keeps the newest, unsubscribe stops delivery, two handlers on one topic both hear, another
   module's topic of the same name is not heard (against a stand-in stream).

`check-names` and `check:docs` as always. The Whiteboard's own check gains the pointer drawing against stand-in events.

**What can't be checked here:** the feel of pointers between two real browsers on a real network, and load beyond a
handful of people. Neither needs LiveKit, so both can be tried on Thomas's install; LiveKit is not involved.

## Core, and held

The route, the fan-out, the limits, the guest pass on module routes and the `liveAccessChanged()` additions are core
and security-sensitive: a larger model builds them, quality-assurance reads them independently, and they are held (not
pushed as a try build) until that read passes. The SDK and the Whiteboard's pointers are not core and can follow.

## Documents to update (content-manager)

- `api-module-sdk.md`: a "Live messages" section beside "Live changes".
- `api-modules.md`: the manifest's `live`, the routes, the `live` event on the module stream, the limits.
- `architecture-modules.md`, "Live changes": the fan-out and the join register.
- `architecture-whiteboard.md`: the pointers.
- `userguide-settings-reference.md`: the five variables; `docker-compose.yml` commented examples if Thomas wants them
  there (and the overview's claim about the existing ones corrected).
- `TODO.md` once agreed.

## Left to build, in order

1. **Server: the route and the fan-out** (server-development). `POST /api/modules/:id/live`, the `live` event, the
   manifest's `live`, the limits and their variables, the cached reader access with the added `liveAccessChanged()`
   calls. Check: points 1 to 3 and 5. Held for the security read.
2. **Server: join and leave** (server-development). The module stream's `ready` id, the join register, `joined` and
   `left`. Check: point 4.
3. **Server and pages: guests** (server-development, then experience-design). The pass on module routes, the space page
   handing it to the module host. Check: the guest cases in points 2 and 3.
4. **QA's independent security read** of steps 1 to 3 (quality-assurance).
5. **The SDK** (experience-design). `host.live.*` in `public/sdk/host.js` and `public/module-host.js`. Check: point 6.
6. **The Whiteboard's pointers** (experience-design). A version bump. Check: the Whiteboard's check, then Thomas tries
   it in two browsers.
7. **Documents** (content-manager).

## Open questions for Thomas

1. **Transport:** the module stream with a POST up, LiveKit's data channel, or a new WebSocket? Recommendation: the
   module stream (option 1A).
2. **Who may publish:** anyone who can see the module, or only those who can change it? For the Whiteboard that is
   whether a guest who can only look shows a pointer. Recommendation: anyone who can see it, with the manifest able to
   require a permission (`live.publish`).
3. **The person's colour:** one the host gives everyone (from their key, among the eight tints, the same in every
   module), one each person picks in their profile, or left to each module? Recommendation: the host gives one from
   the key; a profile choice can come later.
4. **Join and leave kept by the server**, or left to the modules to expire? Recommendation: kept by the server (option 3A).
5. **The limits:** 256 bytes and 20 a second per person and module? Recommendation: yes, as environment variables.
6. **Environment pages too** (the Calendar's page: "who is editing"), or spaces only at first? Recommendation: spaces
   first; the environment scope (signed-in people only, never guests) as a later step, since only space modules need it now.
7. **An acknowledgement** a receiver can send back? Recommendation: no; a module that needs one uses an action.
8. **Your own other tabs:** left out (as proposed), or told with `self: true`? Recommendation: left out.

Questions 1, 2 and 4 block step 1; 3 blocks step 6; the rest can be settled before the build of their step.
