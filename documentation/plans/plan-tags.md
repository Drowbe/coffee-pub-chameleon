# Tags Plan: one shared list of tags for every module

**Audience:** Thomas, who decides; server-development (the tag list, its routes, the checks); experience-design (the SDK piece, the pages, Documents and Research); quality-assurance (an independent read, because this changes the core); content-manager (the documents once it is built).

**Status:** Draft, 2026-11-11. Nothing is built and nothing was run for this plan. The request, as Thomas gave it: tags on Documents, and "tags should be a shared service". Facts are marked **(code)** (read in the code), **(docs)** (read in the documentation) or **(memory)** (not checked). Everything under "Options and tradeoffs" is a suggestion; only the two lines under "Decisions" are Thomas's. The contract is a draft built on the leans and changes with his answers.

## What it is today

- **There is no shared tag service.** No `host.tags`, no route and no stored list **(code, `public/sdk/host.js`, `server/index.js`)**.
- **Research has its own tags.** Each object holds a `tags` list of words, at most 8, lower case, letters (any language), digits and dashes, 24 characters each **(code, `modules/research/src/research-lib.js`, `cleanTags`)**. The module sorts and filters by them with the toolbar's Filters menu and a count per tag **(code, `research.js`, `tagCounts`)**.
- **Research's colours are a setting.** **Well-known tags** is a `list` setting in the environment scope, up to 30 rows of `{ id, label, icon, color }`, edited by the owner in Module Configuration. A tag on the list wears its colour for everyone; any other tag is plain **(code, `modules/research/module.json`; `research.js`, `loadTagColors`; docs, `api-module-sdk.md`, "Settings")**.
- **Core knows tags only in the objects format**, the shape an AI or an import writes: at most 5, `a-z`, `0-9` and `-`, 24 characters **(code, `server/object-format.js`; docs, `api-modules.md`, "The objects format")**. This is not the shared object summary. The summary's fields have no `tags` (`SUMMARY_FIELDS`, `server/modules.js`), so no other module, the search or the Assistant sees an object's tags **(code)**. The two rules also disagree with Research's (5 against 8, ASCII against any letter).
- **The AI can suggest tags**: `host.ai.ask` with task `tags` returns up to 6 words **(code, `server/prompts/tags.js`; docs, `api-modules.md`)**. Research uses it for Suggest tags.
- **Documents 0.1.0 exists** (list, reading, trash). Its small record `doc:<id>` is cleaned on reading by `dlCleanDoc` and has no `tags` field, and its manifest has no `refs` yet **(code, `modules/documents/`)**. Its plan is [plan-documents](plan-documents.md).
- **Modules cannot read each other's data.** Only pointers and declared summary fields cross, built by the server from the producing module's stored value **(docs, `architecture-modules.md`, "Objects")**. This is why a rename cannot be done by core if objects hold names (see T4).
- **Storage** is per module and scope, 5 MB a module, 60 KB a value **(docs, `api-module-sdk.md`, "Storage")**. A tag list stored this way would belong to one module; a shared list has to live in the core.

## Decisions

Thomas, 2026-11-11.

1. **Tags go on Documents first**: a document can carry tags, and the list can be filtered by tag. *Reason:* his own request.
2. **Tags are a shared service**, not another module's private field. *Reason:* his own request. Anything beyond that is open below.

Any library added for this follows the Documents plan's decisions 8 and 9 (allowed licences only, nothing from outside). None is expected.

## Options and tradeoffs

Each choice lists what it costs and rules out. The lean is a suggestion.

### T1. What a tag is

- **a. A word only.** Colour comes from the word, by a rule. Simplest; two people cannot choose the same colour for "urgent", and a rename changes the colour.
- **b. A word and a colour** chosen from a fixed set of theme tones, the same for everyone. Matches what Research does now. A tone is a name, not a hex, so themes and contrast stay right.
- **c. A word, a colour and a description or a group.** More to build, nothing asks for it.

*Lean:* **b.** A colour is optional (plain when none). Rules out a free colour picker; that would break the light and dark themes.

### T2. Where the list lives

- **a. Per space.** Nothing leaks between spaces. The same word in two spaces is two tags, and a cross-space view cannot add them up by id.
- **b. Per environment, used per space.** One vocabulary, one colour for "urgent" everywhere, and Research's colours are already environment-wide. Cost: anyone in the environment can see every tag's name in the picker. For a tutor with a space for each pupil, a tag such as a pupil's name or a difficulty is then seen by members of other spaces.
- **c. Per environment, each tag optionally limited to some spaces.** Fixes the leak; the most to build and to explain.

*Lean:* **b**, with the leak stated to Thomas. If it matters for the tutoring clients, **c** is the next step and **a** is the safe start. Hosts with several environments each keep their own list; nothing crosses an environment.

### T3. Who creates, renames and deletes

- **Create:** whoever may write in the module they are tagging in. The server checks the calling module's `write` permission, so a person who cannot edit a document cannot make a tag from it. A guest cannot create.
- **Rename, recolour, delete:** *(a)* editors too (anyone can break everyone's tags); *(b)* owner and admin only; *(c)* owner, admin and moderators.
- A moderator is scoped to a space in this product, while a tag (T2b) is environment-wide, so (c) lets one space's moderator rename a tag in every space.

*Lean:* **(b)** for rename and delete, as a new permission in the Roles grid that defaults to the owner and that an owner may grant. This differs from "moderators too"; Thomas decides.

### T4. How a module attaches tags to its objects

- **a. Names on the object** (`tags: ["urgent"]`). Simple to store and read. A rename would have to rewrite every object in every module, and the core cannot (modules cannot read each other's data, and a closed module cannot run code). So a rename would leave old names behind.
- **b. Ids on the object** (`tags: ["k3x9a1bz"]`); names and colours live only in the list. A rename or recolour is one write and shows everywhere at once. Cost: an id means nothing alone, so the server must turn ids into names wherever words are needed (the summary, search, the Assistant, an export), and a deleted tag leaves a dead id that is simply not shown (ids are never reused).

*Lean:* **b.** It is the only way "a rename updates every use" can be true. The owner's export and the backup must then carry the list, or a restored environment shows no tags.

### T5. How a module reaches the service

- **a. An SDK piece only (`host.tags`)**: the list, a picker, a chip. Each module stores `tags` ids as a field of its own object and filters its own list. Nothing else can see them.
- **b. A summary field only** (`tags` in `refs.produces[].summary`): other modules, the search and the Assistant see an object's tags, but a module has no picker or chip to build the editing from.
- **c. Both.** The SDK piece for editing; the summary field so tags are seen across modules.

*Lean:* **c**, built in two steps: **a** first (Documents needs only that), then **b**. **b** is a core change and a new thing the AI may see, so it is held for a security read.

### T6. Showing, editing, filtering, searching

- **Showing:** `host.tags.chip(id)` draws a small tag in its tone, with `textContent` only.
- **Editing:** `host.tags.picker` opens over an anchor, lists the tags, filters as the person types, and offers "Create 'x'" when the person may. It uses the SDK's menu and chips pieces, not a new control.
- **Filtering in a module:** the toolbar's Filters menu with a `chips` group, as Research does now. `host.tags.filterOptions` builds the options from the ids in use. A tag filter means "has all of them", as in Research.
- **Searching across modules:** *(a)* leave it to each module; *(b)* `GET /api/objects/search` also matches tag names and accepts `tag=<id>`, which needs the summary field (T5b). *Lean:* **(a)** at first, **(b)** with step 4.

### T7. Limits

*Lean:* a name is 1 to 24 characters of lower-case letters (any language), digits and dashes, after NFKC; that is Research's rule, so Research loses nothing. Up to 8 tags on an object and 200 in an environment. Names are unique ignoring case. Because `<`, `>`, `&` and quotes are not allowed in a name, a stored name cannot carry HTML; pages still use `textContent`. One cleaning function in `server/tags.js` is used by the routes, the summary and the objects format, so the three rules become one (the objects format moves from 5 and ASCII to 8 and any letter). A name that is cut or changed is shown as it was kept.

### T8. Research moves onto it

Replace, no compatibility layer and no migration (CLAUDE.md): Research's `tags` field holds ids, the **Well-known tags** setting is removed (colours live in the list), Suggest tags offers the AI's words as chips and creates a tag only when the person accepts it, and the `saveNote` action's `tags` words are matched to existing tags by name. Tags already on Research objects are lost; test data may be reset. Whether a word the action does not match creates a tag is open.

## The contract

Draft. Names: the thing is a tag; the places are the environment and the space; the things tagged are objects.

### Stored (core, one list per environment)

`{ id, name, color, by, at }` per tag. `id` 8 to 12 lower-case letters and digits, made by the server. `name` per T7. `color` a tone name from the theme's set, or empty. `by` a user key, `at` an ISO time. Kept with the environment's other core data (server-development reads `server/store.js` and `server/environment-export.js` and says where); carried by the owner's export and the backup. A module's object holds `tags: [id, ...]`, at most 8, cleaned on reading like its other fields.

### API (draft; `from` is the calling module's id, as the objects routes use it)

- `GET /api/tags` returns `{ tags: [{ id, name, color }] }`, in name order. Any signed-in member, and a guest with a space's link.
- `POST /api/tags` with `{ name, color? }` finds or makes a tag and returns it (201 when made, 200 when the name exists). 403 when the caller's module `write` is not held, or for a guest; 400 for a bad name, with a plain sentence; 409 at 200 tags.
- `PATCH /api/tags/:id` with `{ name?, color? }`: 403 without the permission, 404, 409 if the name is taken.
- `DELETE /api/tags/:id`: 204; 403; 404.
- A `tags` event on the module stream (`{ op: 'added' | 'changed' | 'removed', tag }`) so every open page updates. Writes count toward the module limits in `server/module-limits.js`.

### SDK (`public/sdk/host.js`, bridged in `public/module-host.js`)

`host.tags.list()`, `host.tags.add(name, { color })`, `host.tags.picker(anchor, { selected, max, onChange })`, `host.tags.chip(id)`, `host.tags.filterOptions(counts)` and `host.on('tags', fn)`. A module opts in with `"tags": true` in `module.json` (as `"budget": true` does); `cleanManifest` accepts it. A module without it is refused by the routes.

### Summary (step 4)

A producing module maps `tags: "tags"` in `refs.produces[].summary`. `SUMMARY_FIELDS` gains `tags`; the server turns ids into `[{ id, name, color }]`, drops dead ids and caps at 8. The Assistant's fields (`SENT_FIELDS`, `server/ai-policy.js`) get tag names only under **What AI may see**.

### What a person sees

A chip row on an object, an Edit-tags button that opens the picker, "No tags yet" when none, a Filters group named Tags with a count each, and an owner screen to rename, recolour and delete (where it lives is open; Settings is the place for configuring). Delete asks first and says the tag is removed from everything that uses it; with step 4 it can say how many.

### Documents (first use)

`doc:<id>` gains `tags` (ids, at most 8) in `dlCleanDoc`. The list row shows the chips; editors tag from the row or from the open document; the Filters menu has a Tags group; the list's search also matches tag names. A tag change writes the small record with the version read and does **not** change `rev` (so readers do not reload the text) and does not need the edit lock; a 409 re-reads and tries once more. Documents' manifest gets `"tags": true`, and `tags` in its `refs` summary when its refs are added. Version bump.

## What touches the core, and what does not

**Core:** `server/tags.js` (new: the list, cleaning, limits); `server/index.js` (routes, the permission, the stream event, export and backup); `server/modules.js` (the `tags` manifest flag; step 4: `SUMMARY_FIELDS`, search); `server/object-format.js` (one rule); `server/ai-policy.js` (step 4); `public/sdk/host.js`, `host.css` and `public/module-host.js` (the SDK piece); the theme tokens for tones; a Roles grid entry; a new check; the design system page for the chip and picker.

**Module only:** each module's own `tags` field, where its picker and chips sit, its filter, its words. Documents and Research are module-lane changes after the core steps, except Research's manifest setting removal.

## Left to build, in order

1. **The list and its routes** in `server/tags.js` and `server/index.js`, the permission, the stream event, export and backup, and `tools/check-tags.mjs`. Owner: server-development. Held for an independent read (core).
2. **The SDK piece**: `host.tags`, the bridge, the picker and chip, the tone tokens, the design system entry, and the owner screen. Owner: experience-design; server-development adds the manifest flag and the check that a module without it is refused.
3. **Documents**: the field, chips, picker, filter and search; version bump. Owner: experience-design. First visible result.
4. **Summary, search and the Assistant**: `tags` in the summary, search by tag, `SENT_FIELDS`. Owner: server-development. Held for a security read.
5. **Research moves onto it**, and the objects format takes the one rule. Owner: experience-design for Research; server-development for `object-format.js` and `check-object-format`.
6. **Documentation**: content-manager writes `api-modules.md`, `api-module-sdk.md`, `architecture-modules.md`, the user guides and the CHANGELOG once each step has landed.

## Verify

- **Checked by a tool, no LiveKit needed:** cleaning (case, Unicode, dashes, `<script>`, a 25-character name, duplicates); each route as admin, owner, moderator, member and guest, with and without the permission; find-or-create twice; the 200 limit; a rename seen through `list` and the event; delete leaving a dead id that a summary drops; the manifest flag through `cleanManifest`; the export carrying the list; the SDK piece on the stand-in page the module-host checks use; Documents' record cleaning and filter as pure tests; `npm run check`; `npm run check:docs`.
- **Verified live in a browser by two people (not yet):** a rename or a new tag appearing in the other person's open picker; tagging and filtering in Documents; the picker on a phone; light and dark tones.
- **Cannot be checked here:** anything inside a real call (there is no LiveKit server here); a guest's link in a live call (read from the rules, not run); a browser other than the one used.

## Risks

- **Tag names seen across spaces** (T2b) in a tutoring setting.
- **A core change for modules that are still small.** The SDK, the bridge and the summary are shared by every module; a wrong turn costs all of them. Hence the held reads in steps 1 and 4.
- **Dead ids.** Ids stay on objects after a delete. They are harmless and hidden, but a restore of an old backup could show a tag that was deleted since.
- **Tags in the AI's context** (step 4) are new text the model sees; the policy page must show it.
- **Research's tags are lost** on replacing, for anyone who has them now.
- **One list for 200 tags** is a pick list, not a taxonomy; a big vocabulary would want groups (T1c).

## Open questions

Blocking step 1:
1. **Per environment or per space (T2)?** Is it acceptable that members of other spaces can see a tag's name, given the tutoring clients?
2. **Who renames and deletes (T3)?** Owner only, or moderators too, knowing a tag is environment-wide?
3. **Ids or names on objects (T4)?** Ids are the only way a rename can reach every use; confirm.
4. **One rule (T7).** Eight tags to an object, any letter, 24 characters, 200 to an environment; this changes the objects format from 5 and ASCII.

Not blocking:
5. When the AI or an import names a tag that does not exist, does it create one, or is it dropped (T8)?
6. Should a module need the owner's approval to use tags, as `refs` need? Draft: no.
7. Where does the owner screen live?
8. May the Assistant see tag names (step 4), and is it on by default under **What AI may see**?
9. Does anyone have Research tags to keep?

## Not decided

The tone names and how many; the exact words on screen beyond those above; the stored file's name; whether a guest sees chips in a shared object; whether the picker offers the AI's Suggest tags outside Research.
