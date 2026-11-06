# Vault Privacy Plan: who can see which file

**Audience:** Thomas decides who may see which file. server-development builds the rule, the stored field, the new
permission and the check; experience-design draws the Vault's new controls on the Prototype first, then builds them;
bug-fixes closes the small leaks; quality-assurance reads the result as a security change; content-manager documents.

**Status:** approved by Thomas 2026-11-06; slice 1 (server rule) started 2026-11-06 as a HELD build for Thomas with a
security read before any merge; slice 2 (Prototype of the Vault controls) started 2026-11-06; nothing merged. Thomas's
request: "one member might not be able to view another member's files"; he chose per-file "share with chosen people".
On 2026-11-06 he also chose the suggestions for questions a, f and g (decisions 9 to 11). This plan amends decision 13
of [plan-attachments-vault](plan-attachments-vault.md) and overturns the "an owner may not open someone's Only me file"
part of decisions 3 and 4 of the 2026-10-15 attachments plan (see What it overturns).

## What it is today

Read as code only, 2026-11-06.

- A file record (`server/vault-store.js`, written by the add route in `server/index.js`) is `id`, `name`, `type`,
  `group`, `size`, `sha256`, `by` (the adder's user key), `at`, and sometimes `taken`, `camera`, `viewable` and `thumb`.
  It has **no visibility field**. Records live in `DATA_DIR/modules/<id>/library/space-<space>.json`; the bytes are in
  `VAULT_DIR`.
- One gate, `libraryAccess` in `server/index.js`, runs before every library route. It refuses a signed-out visitor,
  an access key and a guest, and anyone who is not a member of the space (an owner or the admin may still enter). Then
  it checks the Vault's permissions for the person's role in that space: `view`, `add`, `download`, `remove_any`,
  `share`. A refusal on a file route answers 404 with one fixed text (`NO_SUCH_FILE`), so a file's existence is not
  given away.
- **Anyone who may `view` sees every file of that space's Vault**, and may open and download it (with `download`). The
  list also gives the space's whole byte total.
- `remove_any` is only a permission. Rename and remove are allowed to the adder, or to anyone with `remove_any`.
- Other modules reach a file through the object chokepoint (`refScope`, `objectRows`, `objectValue`, `resolveRef`):
  resolve, citations, search, links, the links batch, and the AI's object pool all end there. The role check there is
  the module's `read`, which is `view`. `refAnswer` turns a 403 into the state `hidden` and a 404 into `gone`.
- Two realtime senders tell every viewer who can read the module that the library changed, with the file's id.
- Share links (`server/vault-share.js`) are made by a person with `share`, may include any file of the space, and are
  rechecked on every open with `shareMakerCan`.

So today the Vault is one shared shelf per space. Decision 13 of the Vault plan said so on purpose. This plan changes it.

## Decisions

Thomas decided decisions 1 to 8 on 2026-11-06, and decisions 9 to 11 later the same day, in chat, picking the
suggestions made to him.

1. **The model.** Each file has a visibility: **Everyone in the space** (the default for new files, which is today's
   behaviour), **Only me**, or **Chosen people** (a list of members of that space).
2. **Owners and the admin may open any file**, including ones not shared with them. This overturns the older rule that
   an owner may not open someone's Only me file. The file window shows who can see each file, so nobody is surprised.
3. **Other members see nothing of a file they cannot see.** No row, no count, no placeholder. It answers exactly as a
   missing file does, with the same 404 text, byte for byte.
4. **Moderators do not see every file.** They see what is shared with them, plus a new permission, **See every file**
   (off for moderators by default; an owner can switch it on per role; owners and the admin always have it).
   Moderators keep `remove_any`, but only for files they can see.
5. **The adder, and owners and the admin, can change who sees a file later.** Nobody else can.
6. **When a person leaves a space or is removed, the files they added stay** with the same visibility list. Owners and
   the admin can reassign or remove them. If the person comes back, the files are still theirs.
7. **A link from an object follows the file.** A link on a Planner booking, a Research note, or any other
   `host.files` link follows the file's visibility. Someone who cannot see the file sees the link as **hidden**: never
   "File removed", never the file's name. To show a file to everyone on a booking, share the file with everyone first.
8. **A share link (public link) for a restricted file** may be made only by someone who can see the file. It ends (it
   reads "ended") when its maker can no longer see the file.
9. **Storage total (was question a).** Each person sees their **visible** total: the bytes of only the files they can
   see. The space's real quota is still enforced on the real total. A refusal reads "the space is full" and does not say
   why.
10. **A gone link (was question f).** The link keeps a copy of the file's visibility. After a restricted file is
    deleted, only the people who could see it see "File removed"; everyone else sees nothing.
11. **The activity line (was question g).** No activity line is written for a file that is not shared with everyone. The
    chosen-people list holds **at most 200 people** (accepted).

## The design

### The stored field

A record gains `visibility`: `'everyone'`, `'only-me'` or `'people'`, and `people`: a list of user keys, used only
when the visibility is `people`.

- A record with no `visibility` reads as `'everyone'`. That is the whole migration (question e, still open;
  this is the suggestion).
- **The adder can always see their own file**, whatever the list says (`by` is checked first).
- **People are checked against the current members of the space at read time.** A key in `people` that is not a
  member of that space now is ignored; it is not removed from the list. This is why a person who returns regains sight
  (decision 6), and why a key from another space, or a stale one, never grants anything.
- The list is cleaned on write: only keys of members of that space are accepted, no duplicates, a cap of 200 people
  (decision 11).

### The one function

`fileVisible(who, spaceId, record)` sits next to `libraryAccess` and is the only place the rule is written. It returns
true when:

1. the viewer is the adder; or
2. the viewer has owner rights (owner or admin); or
3. the viewer holds **See every file** in that space; or
4. the visibility is `everyone`; or
5. the visibility is `people` and the viewer's key is in `people` and the viewer is a current member of the space.

`only-me` therefore opens for the adder, owners, the admin and anyone with See every file, and for nobody else.

**One door for the `:fid` routes.** Today each route finds the record on its own. They all go through one helper that
loads the record and runs `fileVisible`; a file that is missing and a file the viewer cannot see give the same answer
(the same status and the same text, `NO_SUCH_FILE`). No route may read a record any other way. The check
(below) fails on a `:fid` route that skips the door.

Change rights (decision 5) are a second small function beside it, `fileManageable(who, spaceId, record)`: the adder, an
owner, or the admin. A moderator with `remove_any` may remove a file only when `fileVisible` is true for them
(decision 4), and may not change who sees it.

### Where the rule must hold, and the leak each closes

Each line is a place a hidden file could show through today if only the list route were fixed.

1. **The list** (`GET .../library`): filter the records by `fileVisible`. Closes: names, sizes, adders and dates of
   hidden files.
2. **Counts**: the file count, the `uses` count on a row, and any per-adder or per-group count are made from visible
   records only. Closes: a number that moves when a hidden file is added.
3. **Usage totals and quota numbers.** Decision 9: each viewer gets the total of the files they can see; the quota is enforced on the real total, and a refusal says only that the space is full.
4. **`uses`** (`.../:fid/uses`): the file must be visible to the viewer first. Its `hidden` count of other holders
   stays as it is (those are objects, not files).
5. **Thumbnails** (`GET` and `PUT .../:fid/thumb`): behind the door. `PUT` stays adder-only.
6. **Content and download**: behind the door. Closes: reading bytes by guessing or remembering an id. A cached or
   remembered link to a file the viewer lost sight of stops working at once, because the check runs on every read.
7. **Rename and remove**: behind the door, then the change rule. Remove still tells the holders (`refchange`) but
   only as the realtime rule in point 12 allows.
8. **The object chokepoint**: `resolveRef` for a library file runs `fileVisible` after the module check. A file the
   viewer cannot see raises the same 403 with `unseen`, which `refAnswer` maps to `hidden`. It must be **403 unseen,
   never 404**, or the link would read "gone" and the name could be guessed from the difference. Because resolve,
   citations, search, links and the links batch all end here, one change covers them; the check proves each one.
   Search never returns a hidden file's name, and the backlinks list (`dir=to`) skips hidden holders as it does today.
9. **`POST /api/objects/links`** (a module links a file): the linker must be able to see the file. A removed file
   already linked keeps its link, as today.
10. **"File removed" for a gone link** (`GET /api/objects/links`, `dir=from`). A link to a file that no longer exists
    shows "File removed". For a file that was restricted, that line would tell people outside the list that a file
    existed. Two ways: keep the visibility on the link when it is made, or show nothing to people outside the list.
    **Decided (decision 10):** show nothing to someone who could not have seen the file. The visibility is kept on
    the link record when the link is made.
11. **The AI's object pool and shared chat answers.** `aiObjectsIn` runs through the same chokepoint as the asker, so a
    hidden file is not in the pool and the AI cannot name it. A shared answer is filtered per reader by `resolveRef`
    (`readerCanOpen`). The prose risk is the same as for any hidden object: if the asker could see a file, the AI may
    mention it in words, and a shared answer carries those words to people who cannot see the file. The plan accepts
    this as it does for other objects, and says it in the user guide.
12. **The two realtime senders** (the `library` event on the space's stream and on the module's own stream). Today they
    tell every reader the file id. They check `fileVisible` per viewer: on the visibility **before** the change and
    **after** it. A viewer who could see it before or can see it after hears the event (so a file that goes private
    disappears from the list of those who lose it); everyone else hears nothing about that file. The `refchange` to
    holders follows the same per-viewer test.
13. **The activity line** ("added a file to the Vault") has an actor and a space but no name. A line about a file
    that only some can see still tells the others that someone added something. Decided: for a file that is not
    `everyone`, write no activity line at all. Decided (decision 11).
14. **Share links and `shareView`** (`server/vault-share.js`): creating a link checks `fileVisible` for the maker for
    each file chosen; a hidden file answers as missing. Listing links to other makers hides the files the viewer
    cannot see (a link's file list must not name them). Opening a link rechecks, on every open, that the maker can
    still see each file (decision 8): `shareMakerCan` gains the file check, and a file the maker can no longer see
    drops out of the link, or the link reads "ended" when it was the only file. `shareView` never describes a file the
    maker cannot see.
15. **Export and backups.** The records carry names, `by` and the visibility list. The environment export (hosted,
    owner) and the host's backup are for owners and the host admin only, who may see everything (decision 2). Stated
    in the user guide.
16. **Space erase** (`space-erase.js`, `vault.forgetSpace`): erases every file of the space whatever its visibility.
    The check `check-space-erase.mjs` already fails on a per-space file it does not know; the new field adds none.
17. **Leaving a space, being removed** (`removeMember`, `removeUser` in `store.js`): files and `by` are untouched
    (decision 6). Owners and the admin can reassign or remove them (open question c, not decided). A removed **user** (not only
    from one space) leaves files whose `by` points at no one; owners and the admin still see them.
18. **Guests and access keys**: already refused by `libraryAccess`. Stays. The check keeps proving it.
19. **`taken`** (a photo's position): it follows the file. Anyone who can see the file sees its position as today;
    nobody else sees the file at all.
20. **The Vault's own client filters** (Mine, Added by chips, search, the usage bar in `modules/vault/src/vault.js`):
    they work on the list the server returned, which is already filtered. The Added by chips must list only people
    who added a file the viewer can see. No filter may be built from a count the server did not give.

Also: the Modules page summary (files and bytes for the whole environment) is for admins and owners, who see
everything, so it stays.

### The new permission

`modules/vault/module.json` gains a permission `see_all` ("See every file"): member off, guest off, moderator off.
Owners and the admin always have every permission, as `store.spacePermissions` already does. An owner can switch it on
for the moderator role per space. It cannot be turned on for guests. The module gets a version bump.

### The Vault screens (a sketch; drawn on the Prototype first)

Thomas's rule is to design on the Prototype, look at it, lock the design, then build. So this is a sketch for the
Prototype, not a contract.

- **Add files** gets a line **Who can see this**: Everyone in this {space} (the default), Only me, Chosen people. Chosen
  people opens a people picker of the space's members. The choice applies to the whole batch being added.
- **The file window** shows who can see the file, and lets the adder, owners and the admin change it. For owners and
  the admin it also says when they are looking at a file that was not shared with them.
- **A row** may carry a small mark for Only me and Chosen people, so the adder knows.
- **Ghosts never appear.** A person who cannot see a file sees no row, no count, no gap, no "hidden file" line, and
  no "some files are private" hint anywhere in the Vault. (Objects elsewhere show a link as hidden, decision 7.)

## The contract

### Server half

- Store: `visibility` and `people` on the record; `vault.setVisibility(...)`; a clean-up of the list on write.
- `fileVisible`, `fileManageable` and the single door (above).
- Routes: `POST .../library?space=&name=` accepts `visibility` and `people` (query or a header; the body is the
  file). A new `PATCH .../:fid` field `visibility` and `people` (adder, owner, admin) next to `name`. `fileView`
  gains `visibility` and `people` only for those who may change them; others get nothing extra. Refusals: 404 with
  `NO_SUCH_FILE` for anything not visible; 400 for an unknown visibility or a person who is not a member; 403 "Your role
  can't do that" for a visible file the viewer may not change.
- Permission `see_all` in `module.json`.
- Realtime and link rules as listed.

### Pages half (after the Prototype is locked)

- The controls above, wording from the environment's words, colours from the theme tokens, existing SDK pieces
  (`host.menu.show` for the picker choices, the file chip, the file window).
- Nothing in the page decides visibility; it shows what the server returns.

## Left to build, in order

| # | Slice | Size | Agent | Depends on | Held |
|---|---|---|---|---|---|
| 1 | The server rule: stored field, `fileVisible`, the one door, every route in points 1 to 9 and 12 of the list above, the permission `see_all`, `tools/check-vault-visibility.mjs` | M to L | server-development | none | **Held for Thomas.** A quality-assurance security read, on a larger model, before any merge |
| 2 | The Prototype of the Vault's new controls (Add files line, people picker, file window, row mark) | S | experience-design | none | Thomas looks and locks the design |
| 3 | The Vault screens from the locked Prototype, and a module version bump | M | experience-design | 1 and 2 | |
| 4 | Links, AI, share, export, erase and leaver handling: points 10, 11 and 13 to 17; the gone-link fix | M (server-development), S (bug-fixes for the gone-link fix) | server-development, bug-fixes | 1 | |
| 5 | Security review of the whole, documentation (userguide-vault, api, the plan status) and the changelog | S | quality-assurance, then content-manager | 1 to 4 | |

Files touched, by slice:

1. `server/index.js` (the gate, the routes, the chokepoint, the two senders), `server/vault-store.js`,
   `modules/vault/module.json` (permission; version bump is slice 3's), `tools/check-vault-visibility.mjs`, `package.json`
   (the check in the `check` script).
2. The Prototype file(s) as the design system's process names them. No product code.
3. `modules/vault/src/vault.js`, its styles, `modules/vault/module.json` (version), `tools/module-versions.json`.
4. `server/index.js`, `server/vault-share.js`, `server/space-erase.js` (only if a check shows a need), `server/store.js`
   (only for a leaver rule that needs it), `tools/check-vault-links.mjs`, `tools/check-vault-share.mjs`.
5. `documentation/userguides/userguide-vault.md`, `documentation/api/` (the library routes), `CHANGELOG.md`, this plan's
   status.

## Verify

### The new check: `tools/check-vault-visibility.mjs`

A matrix. The viewers: signed out, guest, access key, outsider (not in the space), member not listed, listed member,
the adder, moderator without See every file, moderator with it, owner, admin. The visibilities: everyone, only me,
chosen, chosen then the member removed from the list, and the adder left the space. The routes: list, content,
download, thumbnail, rename, remove, uses, share create, share list, share open, resolve, citations, search, links, links
batch, the AI's object pool, both realtime streams, and the usage numbers.

Each cell asserts the status. For every refusal it also asserts that:

- the body does not contain the file's name or id; and
- a refusal for "hidden from you" and a refusal for "no such file" are **byte for byte equal** (status, headers that
  matter, and body). For the object routes the equal pair is the state `hidden`, with no name.

### Other checks

- `tools/check-vault-links.mjs`: a link to a restricted file reads `hidden` for someone outside the list, never
  `gone`, and never carries the name; a removed file still reads "File removed" only to those who could have seen it.
- `tools/check-vault-share.mjs`: a share link for a restricted file can be made only by someone who can see it; it
  reads "ended" when its maker loses sight of the file.
- A two-space case: a listed key that belongs to a member of another space, not this one, is ignored.
- `npm run check:docs` for this plan, and `npm run check` before anything is called done.

### What is verified and what is not

- Verified by a tool: only after slice 1 exists; slice 1 is started but nothing is merged. The statements in What it is today were read as
  code, on 2026-11-06, not run.
- Needs a real LiveKit call: nothing in this plan. The Vault does not use the call. The realtime streams are the
  server's own and can be checked with a local server.
- Needs a person looking: the Vault screens (slices 2 and 3), by Thomas on the Prototype, then live.

## What it overturns

- Decision 13 of [plan-attachments-vault](plan-attachments-vault.md) ("No Only me files... Everyone in this {space} can
  see what you add"), amended there with a dated note.
- In the 2026-10-15 attachments plan, decision 3 (a file can be Only me) is now true for the Vault, and the part of
  decision 4 that said an owner may not open someone's Only me file is reversed by decision 2 above.

## What is not in this plan

- An environment-wide personal library (still waiting, as decision 13 said).
- Folders or groups of people for a file (only a list of members).
- Per-file encryption. The bytes in `VAULT_DIR` stay as they are; the rule is the server's.
- Hiding a file from owners or the admin.

## Open questions

None of these is decided. Each has a suggestion; it is a suggestion only. None blocks slice 1 (it is started). Questions
a, f and g were decided on 2026-11-06 (decisions 9 to 11).

- **(b) Quotas.** Do Only me files count toward the person's own quota? *Suggestion:* yes, they count where they count
  today (the person's total by `by`, and the space's total). Nothing changes in how bytes are counted. Does not block.
- **(c) Reassigning.** When an owner reassigns a file, does `by` change, or only the list? *Suggestion:* `by` changes,
  because `by` also drives the person's quota and "Mine"; the old adder is not left with a quota they cannot free.
  The visibility list stays unless the owner changes it. Blocks slice 4's leaver handling only.
- **(d) People in the picker:** names or avatars? *Suggestion:* names with a small avatar, decided on the Prototype.
  Blocks slice 2 only, which is started; Thomas settles it when he looks at the Prototype.
- **(e) Migration.** *Suggestion:* a record with no field reads as `everyone` when it is read, with no stored change;
  the field is written only when a person sets something other than the default. Slice 1 builds this reading, which
  costs nothing to change. Not a real question unless Thomas wants the field written on every record.
