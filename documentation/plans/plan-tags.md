# Tags Plan: one shared list of tags for every module

**Audience:** Thomas, who decides; server-development (the tag list, its routes, the checks); experience-design (the SDK piece, the pages, Documents and Research); quality-assurance (an independent read, because this changes the core); content-manager (the documents once it is built).

**Status:** Decided, 2026-11-11 (decisions 1 to 12); nothing is built and nothing was run for this plan. The build waits for Thomas's go. The request, as Thomas gave it: tags on Documents, and "tags should be a shared service". Facts are marked **(code)** (read in the code), **(docs)** (read in the documentation) or **(memory)** (not checked). The decisions are Thomas's; the contract is a draft built on them, and nothing is left open.

**Progress (2026-11-11):** Built on main: the server half (#582: `server/tags.js`, the routes under `/api/spaces/:id/tags`, the `manageTags` right) and the SDK half (#585: `host.tags`, the picker, chips, the `tags` event and the Tags section in Set up). Documents 0.6.0 is the first module to use it (#593). Documented in [api-modules](../api/api-modules.md), "Tags", and [api-module-sdk](../api/api-module-sdk.md), "Shared tags". Research still keeps its own tags. Known gaps are in [known-issues](../known-issues.md).

## What it is today

- **There is no shared tag service.** No `host.tags`, no route and no stored list **(code, `public/sdk/host.js`, `server/index.js`)**.
- **Research has its own tags.** Each object holds a `tags` list of words, at most 8, lower case, letters (any language), digits and dashes, 24 characters each **(code, `modules/research/src/research-lib.js`, `cleanTags`)**. The module filters by them with the toolbar's Filters menu and a count per tag **(code, `research.js`, `tagCounts`)**.
- **Research's colours are a setting.** **Well-known tags** is a `list` setting in the environment scope, up to 30 rows of `{ id, label, icon, color }`; a tag on the list wears its colour, any other is plain **(code, `modules/research/module.json`; `research.js`, `loadTagColors`)**.
- **Core knows tags only in the objects format**, the shape an AI or an import writes: at most 5, `a-z`, `0-9` and `-`, 24 characters **(code, `server/object-format.js`; docs, `api-modules.md`, "The objects format")**. That is not the shared object summary: `SUMMARY_FIELDS` in `server/modules.js` has no `tags`, so no other module, the search or the Assistant sees an object's tags **(code)**.
- **The AI can suggest tags**: `host.ai.ask` with task `tags` returns up to 6 words **(code, `server/prompts/tags.js`)**. Research uses it for Suggest tags.
- **Documents 0.1.0 exists** (list, reading, trash). Its record `doc:<id>` is cleaned on reading by `dlCleanDoc`, has no `tags` field, and its manifest has no `refs` yet **(code, `modules/documents/`)**. See [plan-documents](plan-documents.md).
- **Modules cannot read each other's data.** Only pointers and declared summary fields cross, built by the server from the producing module's stored value **(docs, `architecture-modules.md`, "Objects")**. So core cannot rewrite names stored in another module's objects.
- **Module storage** is per module and scope, 5 MB a module **(docs, `api-module-sdk.md`, "Storage")**. A shared list cannot live there; it lives in the core.

## Decisions

Thomas, 2026-11-11.

1. **Tags go on Documents first**: a document can carry tags, and the list can be filtered by tag. *Reason:* his own request.
2. **Tags are a shared service**, not another module's private field. *Reason:* his own request.

### Decisions by Thomas, 2026-11-11

3. **The tag list is per space.** *Reason:* nothing leaks between spaces; a tutor's space for each pupil keeps its tags to itself.
4. **Editors create tags** (whoever may write in the module they are tagging from). **Moderators, the owner and the admin rename, recolour and delete**, and a rename updates every use. *Reason:* a moderator is already scoped to a space, which is where the list lives.
5. **Objects hold tags by id**; names and colours live only in the list. *Reason:* it is the only way a rename can reach every use.
6. **One rule for every module:** 8 tags to an object, any letter (plus digits and dashes), 24 characters, 200 to a list. It replaces Research's own tags and the objects format's 5-tag ASCII rule, with no compatibility layer and no migration. *Reason:* one rule, and the product is unreleased.
7. **A word that matches no tag is dropped, and the person is told** ("skipped: not a tag in this space"). Nothing creates tags behind anyone's back: only a person, in the picker, makes a tag. *Reason:* a list nobody asked to grow stays clean.
8. **Rename, recolour and delete live on the space's Manage page, in a Tags section.** *Reason:* Manage is where a space is configured.
9. **The Assistant may see the names of the space's tags, nothing else** (no ids, no colours, no counts), and only for objects the person already shares with it. *Reason:* it helps it find things without widening what it can read.
10. **When an object moves to another space, its tags are re-created by name in the new space:** an existing tag of the same name there is used, else one is made with the same colour. Only when the person has the create right (edit) in the destination space. The 200-per-list and 8-per-object limits still apply; anything that does not fit is dropped and the person is told. Names are re-validated by the one rule. It runs on the server and is never trusted from the client. *Reason:* a moved object keeps its meaning without leaking ids across spaces.
11. **A module opts in to tags in its manifest** (`"tags": true`); there is no owner approval step. *Reason:* a tag list is small and the create right is already checked per module.
12. **Research's own tags are replaced cleanly.** Nobody has tags to keep, so there is no migration. *Reason:* the product is unreleased.

Any library added for this follows the Documents plan's decisions 8 and 9 (allowed licences only, nothing from outside). None is expected.

## The contract

Draft on the decisions above. Names: the list belongs to a space; the things tagged are objects.

### A tag and its limits

`{ id, name, color, by, at }`. `id` 8 to 12 lower-case letters and digits, made by the server and never reused. `name` 1 to 24 characters of letters (any language), digits and dashes, lower-cased and NFKC-normalised; unique in the list ignoring case. `color` a tone name from the theme's fixed set, or empty (plain); never a free hex, so the light and dark themes stay right. `by` a user key, `at` an ISO time. A list holds at most 200 tags; an object at most 8. `<`, `>`, `&` and quotes are not allowed in a name, so a stored name carries no HTML; pages still use `textContent`. One cleaning function in `server/tags.js` is used by the routes, the summary and the objects format.

### Moving an object to another space

A server helper in `server/tags.js` takes the object's tag ids, the source list and the destination space, and returns the destination ids. For each tag it reads the name from the source list, re-validates it by the one rule, and uses the destination tag of that name or makes one with the same colour. It makes none unless the person may edit in the destination space (the same check as a create), stops at 200 in the list and 8 on the object, and returns what it dropped so the page can say "skipped: too many tags to keep: ...". The client sends only the object and the destination; it never sends names or ids to trust. This plan does not build a move: no move between spaces was found in the code or the documents (a search, not a full read), so the helper is called by whichever feature adds one. A copy follows the same rule.

### Stored (core, one list per space)

Kept with the space's other core data (server-development reads `server/store.js` and `server/space-erase.js` and says where). Carried by the owner's export and the full backup, and removed when the space is erased, or tags would vanish or linger. A module's object holds `tags: [id, ...]`, cleaned on reading like its other fields. Tags exist for objects in a space's scope only; a person's own objects and the environment's data carry none.

### API (draft; `from` is the calling module's id, as the objects routes use it)

- `GET /api/spaces/:id/tags` returns `{ tags: [{ id, name, color }] }` in name order, for a member of the space and for a guest with its link.
- `POST /api/spaces/:id/tags` with `{ name, color? }` finds or makes a tag (201 made, 200 existing). 403 when the calling module's `write` is not held there, or for a guest; 400 for a bad name, in a plain sentence; 409 at 200.
- `PATCH /api/spaces/:id/tags/:tag` with `{ name?, color? }`: 403 without the permission, 404, 409 if the name is taken.
- `DELETE /api/spaces/:id/tags/:tag`: 204, 403, 404.
- A `tags` event on the module stream (`{ op: 'added' | 'changed' | 'removed', tag }`, to that space's viewers) so open pages update. Writes count toward `server/module-limits.js`.

### Permissions

Create follows the calling module's `write` (checked as `moduleAccess` does). Rename and delete need one new permission in the Roles grid, **default moderator and owner**, which the owner may change; the admin always may. It is space-scoped through `store.spacePermissions`, as a module's permissions are.

### SDK (`public/sdk/host.js`, bridged in `public/module-host.js`)

`host.tags.list()`, `host.tags.add(name, { color })`, `host.tags.picker(anchor, { selected, max, onChange })`, `host.tags.chip(id)`, `host.tags.filterOptions(counts)` and `host.on('tags', fn)`. The chip uses `textContent` and a tone; the picker uses the SDK's menu and chips pieces. A module opts in with `"tags": true` in `module.json` (as `"budget": true` does); `cleanManifest` accepts it, and the routes refuse a module without it. A tag filter means "has all of them", as in Research. In an environment page that reads several spaces, ids are looked up per space.

### Summary and the objects format

A producing module maps `tags: "tags"` in `refs.produces[].summary`. `SUMMARY_FIELDS` gains `tags`; the server turns ids into `[{ id, name, color }]`, drops dead ids, caps at 8. The search matches tag names and accepts `tag=<id>`. The Assistant's fields (`SENT_FIELDS`, `server/ai-policy.js`) get names only, under **What AI may see**. The objects format takes the one rule: its `tags` are words, which the receiving module matches to the space's tags by name (a word with no match is dropped and reported, decision 7). `check-object-format` and the AI prompt text change with it.

### What a person sees

A chip row on an object; an edit-tags button that opens the picker (type to filter, "Create 'x'" for an editor); a Filters group named Tags with a count each; a place to rename, recolour and delete for moderators and owners. Delete asks first and says the tag is removed from everything that uses it (with the summary and search it can give a count). A deleted tag leaves a dead id on objects that is simply not shown.

### Documents (first use)

`doc:<id>` gains `tags` (ids, at most 8) in `dlCleanDoc`. The list row shows chips, editors tag from the row or the open document, the Filters menu has a Tags group, and the list's search also matches tag names. A tag change writes the small record with the version read, does **not** change `rev` (readers do not reload the text), needs no edit lock, and on a 409 re-reads and tries once more. The manifest gets `"tags": true` and a `tags` summary when its refs are added. Version bump.

### Research moves onto it

Replace cleanly: `tags` holds ids; the **Well-known tags** setting is removed (colours live in the list); Suggest tags offers the AI's words that match a tag as chips, and the rest are skipped with a note; the `saveNote` and `savePhoto` paths match words to tags by name and drop the rest with "skipped: not a tag in this space". No migration (decision 12). Version bump.

## What touches the core, and what does not

**Core:** `server/tags.js` (new: list, cleaning, limits); `server/index.js` (routes, the permission, the stream event, export, backup, space erase); `server/modules.js` (the manifest flag, `SUMMARY_FIELDS`, search); `server/object-format.js` and the object prompt text (one rule); `server/ai-policy.js`; `public/sdk/host.js`, `host.css` and `public/module-host.js` (`host.tags`); the theme tokens for tones; the design system page for the chip and picker; a new check.

**Module only:** each module's own `tags` field, where its picker and chips sit, its filter and its words. Documents and Research changes are module-lane once the core steps land.

## Left to build, in order

Waits for Thomas's go.

1. **Server storage and validation:** `server/tags.js`, the routes, the permission, the stream event, export, backup and space erase, `tools/check-tags.mjs`. Owner: server-development. Held for an independent read (core).
2. **SDK `host.tags`:** the bridge, picker, chip, tone tokens, design system entry, and the Tags section on the space's Manage page for rename, recolour and delete. Owner: experience-design; server-development adds the manifest flag and its check.
3. **Documents:** the field, chips, picker, filter and search. Owner: experience-design. The first visible result.
4. **Summary field `tags`, search and the Assistant:** `SUMMARY_FIELDS`, search by tag, `SENT_FIELDS`. Owner: server-development. Names only, and only for objects the person shares with it (decision 9). Held for a security read, since it is new text the model sees.
5. **Objects format change:** the one rule in `server/object-format.js`, the prompt text and `check-object-format`; a word with no tag is dropped and reported, never created. Owner: server-development.
5b. **The move helper** (decision 10) and its checks, with step 1 or when a move exists. Owner: server-development; held for the same independent read.
6. **Research moves onto it,** with the same drop-and-report rule. Owner: experience-design.
7. **Documentation:** `api-modules.md`, `api-module-sdk.md`, `architecture-modules.md`, the user guides and the CHANGELOG. Owner: content-manager.

## Verify

- **Checked by a tool, no LiveKit needed:** cleaning (case, Unicode, dashes, `<script>`, a 25-character name, duplicates); each route as admin, owner, moderator, member and guest, with and without the permission, and across two spaces (a tag of one is not found in the other); find-or-create twice; the 200 limit; a rename seen through `list` and the event; a delete leaving a dead id that the summary drops; export, backup and erase; the manifest flag; the SDK piece on the stand-in page the module-host checks use; Documents' cleaning and filter as pure tests; `npm run check`; `npm run check:docs`.
- **Not yet verified live, two people in a browser:** a rename or new tag appearing in the other person's open picker; tagging and filtering in Documents; the picker on a phone; light and dark tones.
- **Cannot be checked here:** anything inside a real call (there is no LiveKit server here); a guest's link in a live call (read from the rules, not run); a browser other than the one used.

## Risks

- **A core change for modules that are still small.** The SDK, the bridge and the summary are shared by every module; a wrong turn costs all of them. Hence the held reads in steps 1 and 4.
- **Re-creating tags on a move** can fill the destination's list of 200 or add colours nobody chose there. Mitigation: the limits, the edit-right check and the report of what was dropped.
- **A restore of an old backup** can bring back a tag that was deleted since.
- **Tags in the AI's context** (step 4) are new text the model sees; What AI may see must show it.
- **200 tags** is a pick list, not a taxonomy.

## Open questions

None. Decisions 7 to 12 closed the earlier ones.

## Not decided

The tone names and how many; the exact words on screen beyond those above; the stored file's name; whether a guest sees chips on a shared object; whether the picker offers Suggest tags outside Research; which feature first moves an object between spaces.
