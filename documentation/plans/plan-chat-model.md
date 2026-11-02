# Chat Model Plan

**Audience:** Thomas decides; server-development and experience-design build; content-manager documents.

**Status:** Approved 2026-10-02 (GitHub issue #157); built 2026-10-02, with #165. Every open question was answered as recommended (decisions 7
to 20). It ships in one batch with #165, a **Join the call** button in the space bar before **Online**, which is
planned and built on its own and not designed here. Not built yet.
Thomas: "Commands are private: every command (`/ai`, module commands, and so on) posts privately. Only an ordinary
chat message is public. So there's no need for a post-mode setting." The switch at the top of Chat becomes a filter,
**All | Private | Public**, that "changes only what you see, never what is posted". Flipping a message's visibility
"changes only the visibility. The message stays the same message, with the same type, icon and content." Each
command type gets an icon and a colour, the same colour in its module and on its messages; AI is golden. AI stays
always enabled but no longer has a dedicated experience. This plan replaces steps 7 and 8's **Private** / **Shared**
switch from [plan-one-input](plan-one-input.md). Issue #158 (a posted link becomes a Research link preview with
Keep) comes next and builds on this model; it is not designed here.

## What it is today

- **Two stores, two kinds of message.** Ordinary chat messages are public. They travel over LiveKit's data channel
  and are kept by `server/chat-history.js` in `DATA_DIR/chat.json` (`{ spaces: { <spaceId>: [{ id, at, by, who,
  text }] }, cleared }`, the last 500 per space, none older than 30 days, text up to 1000 characters). They carry no
  visibility field. `/ai` questions and answers are private and live in a separate store, `server/ai-threads.js`,
  `DATA_DIR/ai-threads.json` (`{ threads: { "<spaceId>:<userId>": [{ id, at, role, text, summaries?, shared? }] } }`,
  200 per person per space, text up to 8000).
- **Command messages are not stored at all.** `reflectCommand` in `public/chat-input.js` draws the echo of `/r text`
  on the page as a private message; it is gone on refresh.
- **The switch is a post mode.** `#chat-ai-share` in `public/space.html` (**Private** `#chat-ai-private`, **Shared**
  `#chat-ai-shared`) sets `shareMode` in `public/chat-input.js`, remembered in `sessionStorage` as
  `chat-ai-share:<spaceId>`, shown only to someone who may use `/ai`. With **Shared**, `runAi` sends `share: true` to
  `POST /api/spaces/:id/ai`, the server marks both thread entries `shared: true`, and the page also posts the answer
  as a new ordinary message, "AI answer shared by <name>" plus the text.
- **The badge flips by copying, or not at all.** `frameMessage` in `public/space.js` draws the `message-vis` badge.
  `canChangeVisibility` lets the author click it. Making a private AI answer public calls `onPublic`, which posts a
  second message (the duplicate in #157); a command echo's `onPublic` does the same with the echo's text. Making a
  public ordinary message private only repaints the badge on the author's page: everyone else still sees it, and a
  refresh brings back **public**.
- **The raw placeholder.** The copied answer is plain text, so its `{{summary:N}}` markers (which `answerParts` turns
  into object previews inside a private answer) show as written.
- **No colours per kind.** `messagePortrait` shows a command's module icon, or `robot` for AI, in the neutral colours.
  Module manifests have an `icon` but no colour, and the theme has no token a module could pick (see
  [design-theme](../designsystem/design-theme.md), "The tokens"; there is no gold).

## Decisions

From Thomas, 2026-10-02 (issue #157 and the conversation after it):

1. **Commands post privately; only an ordinary chat message is public.** There is no post-mode setting. Reason:
   a command is the person's own business until they choose to show it.
2. **The switch at the top of Chat is a filter: All | Private | Public.** It changes what you see, never what is
   posted. **Private** shows only your own private messages, since nobody sees anyone else's.
3. **The badge flips visibility only.** The author clicks it to make a message public, and back. It never makes a
   new message; the message keeps its type, icon and content.
4. **Each command type has an icon and a colour, the module's colour, used both in the module and on its messages.**
   AI is golden. Colours come from the theme tokens; a module declares its colour or picks a token, never a fixed
   colour.
5. **AI is always enabled, but has no dedicated experience.** `/ai` is one command among the others.
6. **Nothing stored breaks.** Thread entries saved with `shared: true`, and the duplicate copies already in chat,
   keep working.

7. **One store.** Private and public messages are both kept in `chat.json`, with `visibility` on each message, and
   `ai-threads.json` is moved in. Reason: it is the one model #157 asks for, flipping is a one-field change, and #158
   builds on one shape.
8. **Every signed-in person's private messages are stored,** command echoes and AI messages alike; a guest's stay on
   their page only. Reason: a message you can make public should still exist after a refresh, and guests have no
   identity of their own to keep it under.
9. **The author can flip any stored message, both ways.** An ordinary message made private disappears for everyone
   else. Pictures, never stored, show a plain badge. Reason: what #157 describes, and it makes today's badge on an
   ordinary message honest.
10. **A message made public appears for others at its original time,** and raises the unread number. Reason: only the
    visibility changes. A pointer line at the bottom can follow if old messages made public go unseen.
11. **An AI answer goes public alone;** its head reads "AI, for <name>" and quotes the question in one line, from
    `replyTo`. Reason: others can read what was asked without the asker publishing the question as a message.
12. **Who may use `/ai`:** signed in, not a guest, and not in a space with **Turn AI off in this space** ticked. The
    retired Assistant's **Use** permission no longer counts. Reason: the Assistant is retired and should not gate
    Chat, while an owner may still want AI off in one space.
    Changed 2026-11-02 (Thomas): one rule for AI everywhere, Chat included: the role's **Use AI** permission (`useAi`)
    and the space's AI switch on, never a guest ([plan-ai-integration](plan-ai-integration.md), decision 1).
13. **"Clear your AI thread" becomes "Delete your private messages"** and deletes all of yours in this space. Reason:
    AI is no longer a thing apart.
14. **The filter defaults to All** and is remembered per space for the browser session, as the switch is today.
15. **Limits by kind, counted apart:** ordinary messages 1000 characters and 500 per space; AI answers 8000; 200
    private messages per person per space; 30 days for all. Reason: one person's AI use must not push the public chat
    out of the window.
16. **The duplicate copies already in chat are left as they are;** the page removes `{{summary:N}}` markers when it
    draws an ordinary message. Reason: nothing stored is touched, and others have already read them.
17. **A theme does not set the tints;** they have fixed light and dark values and the theme format does not change.
    Settable tints can follow without changing any module.
18. **Where the colour shows:** on a message, the portrait's icon and a thin left edge; in the module, its icon in the
    titlebar and the Layout menu. Reason: text stays readable on every theme, and primary buttons stay `--accent`.
19. **A manifest `color` that is not a known tint refuses the install,** saying which values are allowed, as
    `commands` does.
20. **The bundled modules' colours:** AI gold, Research blue, To-do green, Calendar red, Planner teal, Polls purple,
    Places orange, Maps pink, Stream none. An owner cannot change a module's colour per environment for now.

## The contract

Each part that rests on one of decisions 7 to 20 names it.

### One message, one store (decision 7)

Every chat message, private or public, is one entry in `DATA_DIR/chat.json`, kept by `server/chat-history.js`. The
existing fields stay; new optional fields are added, and an entry without them reads exactly as today:

```json
{
  "id": "a1b2c3d4e5f6", "at": 1790000000000, "by": "<user key>", "who": "Thomas", "text": "...",
  "visibility": "private",
  "kind": "command",
  "command": "r",
  "module": "research",
  "summaries": [],
  "replyTo": "<id>"
}
```

- `visibility`: stored only as `"private"`. Absent means public, so every message stored today stays public.
- `kind`: absent for an ordinary message; `"command"` for the echo of a command the person typed (including `/ai`
  questions, with `command: "ai"`); `"ai"` for an AI answer. #158 may add a kind, or an optional field on an ordinary
  message, for link previews; the renderer treats an unknown `kind` as an ordinary message.
- `command`: the command's name. `module`: the id of the module that took it (absent for `ai`). The colour and icon
  are looked up from `module` (or `ai`) when the message is drawn, never stored, so a module's new colour reaches
  its old messages.
- `summaries`: an AI answer's objects, as `ai-threads.json` keeps them today (up to 20).
- `replyTo`: on an AI answer, the id of the question it answers (decision 11).
- Limits by kind (decision 15): an ordinary message keeps the 1000-character limit; an AI answer keeps 8000. Flipping
  never trims a message. The window is counted apart (decision 15): the last 500 public messages per space, and the
  last 200 private messages per person per space, none older than 30 days.
- Who reads what: a private message is returned only to its author (`by`). An admin, owner or moderator does not see
  anyone else's private messages in any view, as with AI threads today.
- Not stored, as today: anything in an aside, pictures (live only), and a guest's private messages (guests share
  one stored sender, `guest`, so a guest's command echo stays on their page only; decision 8).

### Migration, once, on the first start after the upgrade

- `server/chat-history.js` reads `ai-threads.json` when it exists and `chat.json` has no `threadsMoved` mark. Each
  thread entry becomes a private message in its space, keeping `id`, `at`, `text` and `summaries`: a `role: "user"`
  entry becomes `kind: "command"`, `command: "ai"`, `who` the person's display name (or "someone" if the account is
  gone); a `role: "ai"` entry becomes `kind: "ai"`, `who: "AI"`, `replyTo` the user entry just before it. `by` is the
  user id from the thread key.
- An entry marked `shared: true` becomes **private**. Its public copy already exists in chat as an ordinary message
  ("AI answer shared by <name>"); making the original public too would show it twice.
- An id that already exists in that space's chat gets a new id (12 hex characters).
- `chat.json` gains `threadsMoved: <ms>`; `ai-threads.json` is renamed to `ai-threads.moved.json` and kept, not
  deleted, so nothing is lost if the move has to be undone. A second start does nothing.
- The duplicate copies stay as they are: ordinary public messages from the person who shared them. The page removes
  `{{summary:N}}` markers when it draws an ordinary message (decision 16); nothing stored is rewritten.
- `tools/check-chat-model.mjs` runs the move on a copy of a sample `DATA_DIR` and checks every case above.

### Server routes

All in `server/index.js`, under "Chat routes" in [api-modules](../api/api-modules.md). Existing routes keep their
paths, fields and status codes.

- `GET /api/spaces/:id/chat` (unchanged path, needs `chatRead`): `messages` is the space's public messages plus the
  caller's own private ones, oldest first, each with the new fields when it has them. A guest gets public messages
  only.
- `POST /api/spaces/:id/chat` (unchanged): posts an ordinary public message. It does not take `visibility`, `kind`
  or `summaries`; private messages are made only by the command and AI routes.
- `PATCH /api/spaces/:id/chat/:messageId` (new, needs `chat`): body `{ visibility: "public" | "private" }`.
  - Only the author (`by` is the caller's key) may change it; a guest never may.
  - 200 `{ message }` with the message as stored. The same value as now is a 200 that changes nothing.
  - 400 "visibility is public or private"; 403 "only the person who posted it can change who sees it"; 404 "no such
    message" (also for someone else's private message, so its existence is not revealed); 429 over the chat post
    limit.
  - Changes `visibility` and nothing else: same `id`, `at`, `kind`, `text`.
  - Tells the call with `tellChat`: `{ type: "chat-visibility", id, visibility: "public", message }` when it becomes
    public (the others never had it), `{ type: "chat-visibility", id, visibility: "private" }` when it becomes
    private.
- `POST /api/spaces/:id/command` (unchanged path): when the request is accepted, the server also stores the echo as
  a private message (`kind: "command"`, `command`, `module`, `text` the typed text after the command) for a
  signed-in caller, and returns it as `message` beside today's fields. A refused command stores nothing (the text
  stays in the box, as today).
- `POST /api/spaces/:id/ai` (unchanged path; `chatAiRefusal` no longer checks the Assistant's **Use**, decision 12): stores the question and the answer as private messages and
  returns them as `question` and `message` beside today's fields (`text`, `summaries`, `id`, `questionId`, `at`).
  `share` is accepted and ignored; `shared` in the answer is always `false`. Nothing is posted to the chat.
- `GET /api/spaces/:id/ai/thread`, `DELETE /api/spaces/:id/ai/thread` and `DELETE /api/spaces/:id/ai/thread/:entryId`
  keep working, read from and written to the one store: `entries` are the caller's private `command: "ai"` and
  `kind: "ai"` messages in the old shape (`role`, `text`, `summaries`). Nothing in the page needs them once step 2 is
  built; they stay for anything that still calls them. The page's **Delete your private messages** (decision 13) uses a new route, `DELETE /api/spaces/:id/chat/private`
  (needs `chat`, signed in, not a guest): it deletes every private message of the caller's in the space and returns
  `{ ok: true, deleted: <count> }`; 403 for a guest.
- `DELETE /api/spaces/:id/chat` (moderator's **Delete the chat**) clears private messages too, as it clears AI threads
  today.
- `DELETE /api/spaces/:id/chat/:messageId`: the author may delete their private message; a moderator may not delete
  someone else's private message (they cannot see it).

### What a person sees

- **Posting.** Text with no command goes out public, as today. Any command, `/ai` included, shows as a private
  message from the person, with the command's icon and colour. An AI answer shows as a private message named "AI"
  with the AI icon and the gold colour, its objects drawn as previews with **Keep** (as today).
- **The badge.** Every stored message the person wrote shows **private** or **public** in its header as a button;
  anyone else's shows it as plain text. Clicking opens the host menu with one choice, **Make public** (`users`) or
  **Make private** (`lock`). Choosing it sends the `PATCH`; on success the badge repaints, and nothing else
  changes on the author's page. On failure the badge stays and the chat's status line says why.
- **For everyone else in the call,** a message made public appears where its time places it, and counts towards
  the unread number while Chat is closed (decision 10). A message made private disappears from their chat.
- **A public AI answer** shows to others as the same message: "AI", gold, its objects with **Keep** for anyone who
  can keep (the same `actions` lookup the author uses). Its head says whose question it answers (decision 11).
- **Pictures** are live only and never stored, so their badge shows **public** as plain text, not a button
  (decision 9).
- **No duplicates.** `onPublic` and every `sendChat(\`AI answer shared by ...\`)` in `public/chat-input.js` go.

### The filter (decision 14)

- `#chat-ai-share` and its two buttons are replaced by `#chat-filter`, one row of three segments: **All**
  (`#chat-filter-all`, icon `comments`), **Private** (`#chat-filter-private`, `lock`), **Public**
  (`#chat-filter-public`, `users`). Chat is part of the host page, not a module, so it cannot call
  `host.ui.viewSwitch`; it uses the same markup (`.tb-tabs`, `.tb-tab`, `.tb-tab-glyph`, `.tb-tab-word`) and the same
  fit, `window.hostSwitch.watch`, as the switch does today. Each segment has its icon, its word and its word as
  `aria-label` (`tools/check-switches.mjs` checks the new ids instead of the old ones).
- Shown to everyone who can read the chat, guests included, in a space (not in an aside, which keeps nothing).
- **All** is the default. The choice is remembered per space for the browser session, `sessionStorage`
  `chat-filter:<spaceId>`; the old `chat-ai-share:<spaceId>` is no longer read.
- It filters on the page only: `#messages` carries `data-filter`, each message carries `data-vis`, and CSS hides the
  others. Changing it fetches nothing. A message that arrives or changes visibility follows the filter at once.
- With nothing to show, the chat says "No private messages here yet." or "No public messages here yet.".
- The unread number counts new public messages from others whatever the filter shows.

### Colours (decisions 17 to 20)

- **Tokens.** A fixed set of named tint tokens joins the theme, each with a light and a dark value tested on both:
  `--tint-gold`, `--tint-blue`, `--tint-green`, `--tint-teal`, `--tint-purple`, `--tint-red`, `--tint-orange`,
  `--tint-pink`. They are in `public/style.css` and `/sdk/host.css` and documented in
  [design-theme](../designsystem/design-theme.md). A theme does not set them (decision 17).
- **Manifest.** A new optional top-level field, `"color": "<tint name>"`, for example `"color": "blue"`. A module
  without it is neutral. `cleanManifest` in `server/modules.js` refuses any other value at install with `module.json:
  "color" must be one of gold, blue, ...` (decision 19). `ai` is the host's and is gold; no module may claim it, but a
  module may use `gold`.
- **Delivery.** `GET /api/modules/for-space` adds `color` to each module (null when none). Chat looks a message's
  colour up from its `module`, or gold for `kind: "ai"` and `command: "ai"`.
- **On a message.** The message gets `data-tint="<name>"`; CSS sets `--message-tint` from it, and the portrait's icon
  and a 3-pixel left edge use `--message-tint`. Text and backgrounds keep their usual tokens (decision 18). An
  ordinary message has no tint.
- **In the module.** The host colours the module's icon where the host draws it: its titlebar and its line in the
  Layout menu's Show section (decision 18). No SDK change is needed; a module that wants its colour inside its own
  page can be given it later.
- **The colours of the bundled modules** (decision 20): AI gold; Research blue; To-do green; Calendar red;
  Planner (`travel`) teal; Polls purple; Places orange; Maps pink; Stream and the retired Assistant none. Each
  module that gains a colour gets a version bump.

### Left open for #158

- A message can carry structured content beside its text (`summaries` today), so a link preview can be another
  optional field on an ordinary message without changing what is stored now.
- **Keep** on a message is found through the space's `actions`, for anyone who can see the message, not only its
  author.
- A message's tint comes from a module id, so a preview kept into Research can take Research's colour.

## Left to build, in order

1. **server-development:** the one store. New fields and per-kind limits in `server/chat-history.js`; the migration
   from `ai-threads.json`; `GET .../chat` filtered by viewer; `POST .../ai` and `POST .../command` storing private
   messages; the thread routes reading the one store; `PATCH .../chat/:messageId` with `tellChat`; `DELETE .../chat/private`; `share` ignored; `chatAiRefusal` without the Assistant's **Use** (decision 12).
   `tools/check-chat-model.mjs` (new, in `npm run check`); `tools/check-one-input.mjs` updated where it reads
   `ai-threads.json` directly.
2. **experience-design:** Chat drawn from the one store. History load draws private and public messages from
   `GET .../chat` (no separate thread load); the badge sends the `PATCH`; `onPublic` and the "AI answer shared by"
   posts removed; the `chat-visibility` notice handled in `public/space.js` beside `chat-delete`; `{{summary:N}}`
   removed when drawing an ordinary message; **Clear your AI thread** becomes **Delete your private messages** (decision 13).
3. **experience-design:** the filter. `#chat-filter` in `public/space.html`, `public/chat-input.js` and
   `public/style.css`; `tools/check-switches.mjs` checks the new ids.
4. **server-development:** the manifest `color` field (`cleanManifest`, refusals), `color` in
   `GET /api/modules/for-space`, and checks in `tools/check-modules.mjs`.
5. **experience-design:** the tint tokens in `public/style.css` and `/sdk/host.css`, light and dark; message tints;
   the module's icon in its titlebar and the Layout menu. `tools/check-theme.mjs` and `tools/check-themes.mjs` still pass (no fixed colours).
6. **experience-design:** `color` in each bundled module's `module.json`, one version bump each, recorded in
   `tools/module-versions.json`.
7. **content-manager:** [api-modules](../api/api-modules.md) (Chat routes, the manifest field),
   [architecture-overview](../architecture/architecture-overview.md) ("One input in Chat"),
   [design-theme](../designsystem/design-theme.md) (the tint tokens), [userguide-chat](../userguides/userguide-chat.md)
   (the filter, the badge, no more **Shared**), the CHANGELOG, and the Progress note in
   [plan-one-input](plan-one-input.md).

## Verify

- **Checked by a tool** (`npm run check`):
  - step 1: the migration on a sample `DATA_DIR` (entries moved, `shared: true` entries private, ids kept or renewed
    on a clash, the old file renamed, a second start changes nothing); a private message returned only to its author
    and never to a guest, a moderator or an owner; `PATCH` by the author changes only `visibility`, 403 for anyone
    else and for a guest, 404 for someone else's private message, 400 for a bad value; `share: true` posts nothing
    public; the thread routes still answer in their old shape; separate windows for public and private; a
    single-environment install behaves as before;
  - step 3: the filter's ids, icons and words;
  - step 4: install refuses an unknown `color` and accepts each tint; `for-space` carries `color`;
  - steps 5 and 6: no fixed colours in the new rules; every bundled module's colour is a known tint and its version
    is bumped.
- **Verified live in a browser, no LiveKit needed:** `/ai` and `/r text` show as private after a refresh; flipping
  an answer public and back survives a refresh and never adds a message; the filter's three views, including the
  empty lines; an old "AI answer shared by" copy shows without `{{summary:0}}`; tints on a light and a dark theme.
- **Needs a real LiveKit call:** a message made public appearing for a second person at once, and disappearing when
  made private again; a second person never seeing a private message; **Keep** on a public AI answer by someone who
  did not ask.

## What is not decided

Nothing blocks the build. Left for later, by Thomas's choice: themes setting the tints, an owner's own colour per
module, and a pointer line for an old message made public (decisions 10, 17 and 20). #158 and #165 have their own
plans.
