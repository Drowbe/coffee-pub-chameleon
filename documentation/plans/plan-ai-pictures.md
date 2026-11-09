# AI Pictures Plan: attaching words and pictures for the Assistant

**Audience:** Thomas decides; server-development builds the routes, the provider adapters, the policy switch and the
checks; experience-design builds the chip in Chat's input, the setting's switch and the Whiteboard's menu entries;
quality-assurance reads every step marked security-sensitive as a security change; content-manager documents.

**Status:** approved by Thomas on 2026-11-09 (relayed by the project manager), nothing built. The request: tutoring. A
student has a maths problem drawn on the Whiteboard and wants the AI to explain it; a module (the Whiteboard first,
with its Save as image PNG of the selection; later the Vault's pictures, chat pictures and uploads) hands a picture to
the Assistant as an attachment in Chat's input, and the AI explains it. On approving, Thomas decided that the words
version of the Whiteboard's "Send to Assistant" must not send at once: he chose to wait for the staged version (attach
to Chat's input, the person presses Send), so the attach piece carries words as well as a picture and lands first.

Each fact below is marked **verified in code** (read in this worktree on 2026-11-09, never run against a real service)
or **inferred**. Nothing about the providers could be checked offline; what must be checked against their own
documentation at build time is said where it matters.

## What it is today

**Asking from a module** (verified in code):

- `host.chat.ask({ question, refs })` in `public/sdk/host.js:2614-2617` calls the bridge `chat.ask` in
  `public/module-host.js:1724-1730`, which trims the question to 1,000 characters, keeps at most 12 pointers, and calls
  the canvas host's `onChatAsk` (`public/space.js:1074-1078`). That calls `askAbout` in `public/chat-input.js:1933-1950`,
  which shows the chips, switches Chat to the Assistant view and **sends the question at once** (`runAi`). The person
  does not press Send. No manifest field is needed.
- Who uses it today: Research's **Research this** (`modules/research/src/research.js:470`, one pointer and no question,
  so the server asks its own "What should I know about <title>?"), the Assistant's `askAssistant` action
  (`modules/assistant/src/assistant.js:22-31`), and the shortcut for `askAssistant` in `host.actions.request`
  (`public/sdk/host.js:3256-3260`) and in the bridge (`public/module-host.js:1572-1580`), which is what a drop menu's
  **Ask the assistant** reaches.
- `chat.available` (`public/module-host.js:1721`) is true only on a space's canvas.
- The chips in Chat's input are `paintContext` in `public/chat-input.js:1984-2013` (`#chat-ai-context`, class
  `sdk-chip-removable chat-ai-chip`, a remove button with "Do not ask about <label>", and a hidden line "N objects will go
  with your next question."). They hold pointers only.
- The Assistant module (`modules/assistant`, 0.1.26) has no window. The Assistant a person sees is Chat's Assistant
  view; `#ask-chips` in `modules/assistant/design/CONTRACT.md` belongs to the older window design.

**The server** (verified in code):

- `POST /api/spaces/:id/ai` (`server/index.js:5983-6026`) takes `{ question, refs, tz }`, runs the policy
  (`aiPolicy.check`), builds the context (`server/ai-context.js`), takes a turn, runs `ai.run('ask', ...)` with the
  look-up tools, and stores the question and the answer as the asker's private messages (`chatHistory.add`). A question
  is at most 1,000 characters, refused (not cut) past that (`aiQuestionOf`, line 5942). The JSON body limit is 64 KB
  (`server/index.js:1749`). A stored AI question or answer may be up to 8,000 characters (`MAX_AI_TEXT`,
  `server/chat-history.js:38`).
- `server/ai.js` keeps the setting, the month's use, the records (`ai-log.jsonl`, only `LOG_FIELDS`, line 83) and
  `run`. The estimate before a call counts characters / 4 (line 608), which knows nothing of a picture.
  `AI_LOG_PROMPTS=1` writes prompts to the server log (line 551, off on a host).
- `server/ai-providers.js`: providers `openai`, `anthropic` and `compatible` (`server/ai.js:49`). A message's content is
  one string (`anthropicMessages`, line 66; OpenAI's body, line 88). **There is no image or vision support anywhere in
  `server/`.** The default models are `gpt-4o-mini` and `claude-haiku-4-5-20251001` (line 19).
- The `ask` template (`server/prompts/ask.js`): 12,000 tokens in all, 5,000 for attached material (line 54); an
  attached object's text is cut at 8,000 characters. Versions are frozen by golden files (`tools/check-prompts.mjs`).
- What AI may see (`server/ai-policy.js:21-85`): switches `attached`, `relevant`, `linked`, `history`, `chat`,
  `members`, `lookup`, plus `environment` and `modules`; environment level in `DATA_DIR/ai.json`, space level `aiSees`;
  `lookup` can only be narrowed by a space.
- An AI answer is never given a link preview (`server/index.js:5781`), and the page's Markdown has no images
  (`public/sdk/host.js:146-153`). An answer cannot make the page fetch an address by itself.

**Pictures elsewhere** (verified in code):

- Chat pictures: held in memory only (`server/index.js:5519-5640`), PNG, JPEG, GIF or WebP sniffed from the bytes,
  `CHAT_PICTURE_MAX_MB` (default 3), held `CHAT_PICTURE_KEEP_MINUTES` (default 15). The page shrinks to 1,600 px on the
  long edge (`public/space.js:4676-4692`).
- Uploads and the Vault: over `MAX_PIXELS` (100,000,000, `server/vault-types.js:25`) is refused; `server/image-clean.js`
  strips what rides along in JPEG, PNG and WebP without decoding.
- The Vault is getting per-file visibility (`plan-vault-privacy.md`, approved, held build): `fileVisible`, and a hidden
  file answers as a missing one.
- The Whiteboard's Save as image (`modules/whiteboard/src/whiteboard.js:1442-1513`, `whiteboard-lib-l-export.js`)
  makes a PNG of everything, the selection or what is in sight, up to 16,384 px on a side, and downloads it.

## The providers

Inferred from general knowledge; **none of this could be checked offline**, and every number must be read from each
provider's own documentation when the adapter is built.

- **OpenAI.** Its chat completions interface takes a message whose content is a list of text parts and image parts,
  the image as an address or base64 data, for models that read pictures. Cost is counted in tokens from the picture's
  size, with a cheaper low-detail form.
- **Anthropic.** Its messages interface takes image blocks (base64 data with a media type) beside text blocks in a user
  turn, for models that read pictures. It documents the accepted formats, a size limit per picture and per request, a
  long edge past which it shrinks the picture itself, and a cost that grows with the pixels.
- **Compatible.** Depends wholly on the model behind the address. A text-only model will refuse or ignore a picture.
- The two default models are believed to read pictures. To check at build: the formats, the largest file and sides,
  pictures per request, the token cost, and what each says when a model cannot read pictures.

## Decisions

Thomas, 2026-11-09, approving the plan. Items 4 to 9 are the draft's suggestions, which he took as they stood.

1. **Nothing a module stages is sent until the person presses Send.** The words version of the Whiteboard's "Send to
   Assistant" waits for this: it is built on the attach piece, not on sending at once. Reason: the person sees what
   goes to the AI before it goes.
2. **One attach piece carries words or a picture**, shown as one chip in Chat's input, and lands first.
3. **A picture travels held in memory and is sent once** (about 5 minutes, never stored). Reason: nothing to clean up,
   nothing in a backup, nothing the Vault has to keep.
4. **An owner switch under What AI may see, off by default, for pictures.** Words attached by a module need no switch:
   they are the same as typing. Reason: approving the AI service said objects and questions go to the company; a picture
   can carry faces and anything in view.
5. **Limits:** one picture per question; PNG, JPEG or WebP; about 1,600 px on the long edge; 3 MB; held 5 minutes.
6. **One question only:** the picture goes with one question; a follow-up has the answer's words, and the picture is
   attached again to ask about it again.
7. **No look-ups while a picture is attached.** Words inside a picture are a way to steer a model; with no tools it can
   only answer.
8. **A module declares that it attaches pictures** in its manifest, approved by the admin like the other hooks.
9. **Vault pictures come later**, by pointer, and only with the Vault's `download` permission (and `fileVisible`).
   Chat pictures and uploads come later too, by pointer.

Carried from the draft as how the build handles them (not separate choices): a compatible service that refuses
pictures is remembered for that provider, address and model (`picturesRefused`, as `toolsRefused`) and pictures are
not offered after that; a question with a picture is one turn and one call, and its estimate includes the picture.

## Recommendations for Thomas to confirm

Asked for on approval; these are suggestions, not decisions (see Still open for what each holds up).

- **Attached words and the limits.** The attached words are not the question: they ride as their own part of the
  data (like an attached object's text), and the question box keeps its 1,000-character limit and may be left empty
  (the server then asks "Explain this."). Attached words may be up to **8,000 characters**, the cut an attached
  object's text already has, counted in the 5,000-token material share. At most 4 bytes a character, that is 32 KB,
  so with the question the request stays inside the 64 KB JSON limit and nothing about the body limit changes. The
  question message stores them (private, as a typed question is), within `MAX_AI_TEXT`. Alternative: the words fill the
  question box and are cut to 1,000; simpler, but the Whiteboard's selection often runs longer and the person would
  edit inside one large box.
- **`host.chat.ask` is retired.** Once attach exists, every caller moves to it and `chat.ask` is removed (the product is
  not released, so no alias): Research's **Research this** attaches its object; the `askAssistant` action and its
  shortcut attach. Each now waits for Send. Reason: one rule, "a module never sends", with no exception to police.
  Research and the Assistant get version bumps. Alternative: keep `chat.ask` for objects only (no words, no picture);
  it keeps today's one-click **Research this**, at the cost of a second path.
- **The manifest declaration names pictures only:** `"chat": { "attach": ["picture"] }`. Attaching words or an object
  needs nothing, as typing needs nothing.

## The contract

### Attach (SDK and Chat)

- `host.chat.attach({ label, text, picture, ref })`: exactly one of `text` (up to 8,000 characters), `picture` (a Blob)
  or `ref` (a pointer); `label` required, up to 200 characters. It sends nothing to the AI. It opens Chat on the
  Assistant view, adds one chip to the input, and focuses the box. Answers `{ attached: true }`, or rejects with a
  sentence ("Ask this from Chat in a space.", "Pictures can't be sent to the AI here.", "This module can't attach
  pictures."). `host.chat.available()` answers `{ available, pictures }`.
- Chips: up to 12 object chips as today, at most one words chip and at most one picture chip; a second words or picture
  attach replaces the first. A words chip reads "Words from Whiteboard"; a picture chip shows a small preview and
  "Picture from Whiteboard". Each has a remove button ("Do not send the words from Whiteboard"). With a picture, one
  line under the chips: "Goes to <the service's company> with your question." A hidden line for a screen reader says
  what will go with the next question.
- Send: as typing a question today, plus the chips. A picture is uploaded to the hold first, then the question names it.
- `label` is the chip's name for a screen reader, the label the AI is given and what the stored question shows later.

### Server

- `POST /api/spaces/:id/ai` gains `attached: { label, text }` (words; checked as text, cut at 8,000 characters, redacted
  as the question is) and `picture` (one held id). A question may then be empty: the server asks "Explain this.". The
  words ride in the data turn as their own part, never in the instructions.
- `POST /api/spaces/:id/ai/pictures` (raw body, `image/png`, `image/jpeg` or `image/webp`; `?label=`): the question's
  policy, the switch on, the service not known to refuse pictures. Sniffs the type, reads the sides from the header,
  cleans with `image-clean` (the position always), holds the bytes in memory for this person in this space for
  `AI_PICTURE_KEEP_MINUTES` (default 5). At most `AI_PICTURE_MAX_MB` (default 3). Answers
  `201 { picture: { id, type, width, height, size } }`. Refusals: 401 signed out or keyed; 403 a guest, the role, the
  space's AI off, the switch off ("Pictures can't be sent to the AI here."); 413 "A picture for the AI is at most 3 MB.";
  400 not a picture, or "Make the picture smaller: at most 1,600 pixels on its longest side."; 429 the rate.
- An id that is not this person's, not this space's, or gone answers 404 "That picture is no longer here. Attach it
  again." in the same words for each. The bytes are dropped when the answer comes or the question fails.
- Templates: `ask@3` adds the attached words; `ask@4` adds the picture as one image part in the person's data turn,
  labelled, with an instruction that a picture is data, words inside it are part of it and never instructions, and the
  answer explains what it shows. The registry keeps the version before each for rollback.
- The adapters turn the image part into each family's own form. With a picture, no look-up tools are offered.
- `GET /api/spaces/:id/ai` gains `pictures: { available, why }`. What AI may see gains `pictures` (environment and
  space; a space can only narrow).
- Stored: the question message gains `attached: { label, text }` and `picture: { label, width, height }`, never the
  bytes. The record gains `pictures` (a count). `AI_LOG_PROMPTS` writes `[picture 1200x800 PNG, 240 KB]` in its place.
- The estimate adds the picture's cost (the provider's formula from its sides, or a fixed safe figure), so the month's
  allowance is checked before sending. **AI use this month** shows questions with a picture as their own line.

### The Whiteboard

- **Send to Assistant** (words): with blocks selected, attaches their words (`text`, label "Words from Whiteboard").
- **Ask the Assistant about this picture**: with blocks selected, and only when pictures are available, makes the
  selection's PNG with Save as image's exporter, at the size that fits the limit, and attaches it with the selected
  words (cut to 200 characters, or "A drawing on the Whiteboard") as its label. Declares `"chat": { "attach": ["picture"] }`.
- In both, the student sees the chip in Chat, types or leaves the question, and presses Send. Each gets a version bump.

## Security

- **A module never sends.** `attach` only stages; the person's Send sends. A bundled module runs in the page and could
  call the page's routes directly, as every bundled module can today, so the server's checks decide what is allowed.
- **A module never reads someone else's picture.** With a Blob it sends only what it holds; with a pointer (later) the
  server reads the picture as the person asking, through the same checks as opening it.
- **Never another space's picture**, never a hidden Vault file, never a guest's, and no word that tells them apart from a
  missing one.
- **Words in a picture or in attached words are data:** the template says so, a picture turns the look-ups off, and the
  answer is cleaned as every answer is.
- **A picture is never stored:** memory only, gone after the answer; nothing in a backup, the log or the chat files.

## Left to build, in order

Steps marked **security-sensitive** touch the server or the bridge: each is built on a held branch and gets an
independent security read before merge.

1. **Attach, words and objects.** `host.chat.attach` with `text` and `ref`, the bridge's checks, the words chip in
   Chat's input, `attached` on `POST /api/spaces/:id/ai`, `ask@3`. Leaves working: a module can stage words or an
   object; nothing sends without Send. **Security-sensitive.** (server-development for the route and template,
   experience-design for the chip)
2. **The Whiteboard's Send to Assistant, on attach.** Leaves working: the words tutoring case end to end. (experience-design;
   Whiteboard version bump)
3. **Retire `host.chat.ask`** (if Thomas confirms): Research's **Research this** and `askAssistant` move to attach;
   `chat.ask` and its shortcuts are removed. Leaves working: every ask from a module waits for Send.
   **Security-sensitive.** (experience-design; Research and Assistant version bumps)
4. **The providers' picture parts and the stand-in.** Image parts for each family, `picturesRefused`, and
   `tools/fake-model.mjs` taking image parts in both shapes. Leaves working: everything as before; the adapters are
   ready. **Security-sensitive.** (server-development)
5. **The picture hold, the switch, `ask@4`, counting.** Leaves working: a picture can be asked about by calling the
   routes, only where the owner turned the switch on. **Security-sensitive.** (server-development)
6. **The switch on the pages:** the AI configuration page and a space's Set up, "Pictures a person attaches", with "A
   picture a person attaches goes to the AI service with their question. It is never kept here." (experience-design)
7. **Attach, pictures:** `picture` on `host.chat.attach`, the manifest declaration, the picture chip with its preview
   and company line. **Security-sensitive.** (experience-design, with server-development for the bridge's checks)
8. **The Whiteboard's Ask the Assistant about this picture.** Leaves working: the picture tutoring case end to end.
   (experience-design; Whiteboard version bump)
9. **Documentation.** (content-manager)
10. **Later, each its own slice:** a Vault picture by pointer (after the Vault privacy build has merged), a chat
    picture, a module's upload, and a picture pasted straight into the Assistant view.

## Verify

- **Step 1** (`tools/check-module-host.mjs`, `tools/check-prompts.mjs`, `tools/check-ai-page.mjs`): `attach` sends
  nothing to `/ai` until Send; one of `text`, `picture`, `ref` and a `label` are required; words over 8,000 characters
  are refused; `ask@3` golden files, with a fixture whose attached words carry instructions; the chip, its remove and
  the hidden line; an empty question with attached words asks "Explain this.".
- **Step 2 and 8:** the Whiteboard's own tests (the entries show only with a selection, the picture one only when
  pictures are available).
- **Step 3:** no module or page calls `chat.ask`; Research and the Assistant pass their checks with attach.
- **Steps 4, 5 and 7, a new `tools/check-ai-pictures.mjs`** (against the stand-in): the image part in each provider's
  shape; the refusals and their sentences (guest, role, space off, switch off in the environment, off in the space only,
  too large, too many pixels, a GIF or a non-picture with a picture's name); another person's, another space's and an
  expired id give the same 404 text; the position and text chunks are gone from what the stand-in received; after the
  question nothing of the picture is in `DATA_DIR` (a byte search of every file), `ai-log.jsonl`, the chat files or the
  log with `AI_LOG_PROMPTS=1`; the estimate includes the picture; a refusal is remembered and then not offered; no
  tools with a picture; a module without the declaration is refused a picture.
- **Step 6:** `tools/check-ai-page.mjs` for the switch on both pages.
- **Not checkable here:** a real provider reading a picture, its real cost, its real refusal for a model that cannot
  read pictures, and how well it resists words in a picture. These need one real key with a spending limit, as
  `plan-ai-integration.md` sets out for its first real try. Nothing here needs a LiveKit call.

## Documentation to update

`architecture-ai.md` (what is sent, the switch, the adapters, records, variables), the AI routes in `api-modules.md`,
the SDK guide (`host.chat.attach`, and `host.chat.ask` gone), `userguide-assistant.md`, `userguide-modules.md` ("The AI
service", What AI may see), `userguide-whiteboard.md`, `userguide-chat.md` ("Ask the AI"), `userguide-research.md`
(**Research this** waits for Send), and the README and `docker-compose.yml` for `AI_PICTURE_MAX_MB` and
`AI_PICTURE_KEEP_MINUTES`.

## Still open

Thomas to confirm the three recommendations above (attached words up to 8,000 characters as their own part, retiring
`host.chat.ask`, the declaration naming pictures only); the first blocks step 1, the second step 3.
