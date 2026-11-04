# Vault Plan

**Audience:** Thomas decides what the Vault holds, who may see and share it, and what is still open below.
server-development builds the file store, the routes, the quotas, the share links and the checks; experience-design
builds the Vault module, its viewers, the share page, the SDK calls and the first module that links to a file;
quality-assurance reviews the store and the share links as security changes; content-manager documents.

**Status:** approved 2026-10-30 (decisions 1 to 7 of 2026-10-29, GitHub #380, and decisions 8 to 15 of 2026-10-30).
Step 1 is built (commits `bde9358` to `154819d`, on `claude/magical-feynman-xupgiq`); security QA round 1 failed and
was fixed, and round 2's fixes for the server half are in. Step 2 (the Vault module, now 0.2.2) and step 3 (the file
windows, `host.files.open`, the sandboxed PDF viewer and download-only PDFs) are built, checked by tools as reported by the builders (the file windows with live checks); see
[userguide-vault](../userguides/userguide-vault.md). The page's **Remove where it was taken** ships off
(a picture keeps where it was taken unless the person ticks it); Thomas has not yet answered the default (open question 1).
Steps 4 and 5 are in progress; steps 6 to 8 are not built (the templates' words, step 7, are already in both templates). Thomas decided the PDF rule (decision 16) and the hosted
total (decision 17) on 2026-10-31, and changed the PDF safety rule and the PDF viewer on 2026-11-01 (decision 18). On 2026-11-03 Thomas decided that the
viewers open in one of the app's windows, not inside the Vault's content area (decision 19), and the same day, several at once with a cap of 4, on the existing window mode first (decision 20).
Thomas calls it critical for post-trip sharing. One question is still his, the default for metadata removal; the
details of the PDF viewer are listed under What is not decided. This plan replaces the attachments plan of
2026-10-15, which proposed a host attachments service with no module of its own; what stays of its four decisions is
under Decisions.

Where it came from, in Thomas's words where they exist:

- #380, Thomas, 2026-10-29: the Vault "needs to be its own module", for files in general, not only a traveller's
  documents: a linking system other modules use, sharing outside the app, a cloud service as a later option, many file
  types, "a server setting for where files are stored, since it will not be the application folder", and in-app
  viewers and players.
- #252, Thomas, 2026-10-13: "We need to support attachments for our research, planner, notes, etc."
- #253, Thomas, 2026-10-13, from user feedback: "'research' implies 'planning' and the user struggles to see its value
  once things are booked. They suggest a wallet (for tickets, passports, etc.)."
- #40, the Journal module: what happened on a trip, with images, read afterwards. Post-trip sharing is where the Vault
  matters most.

Related: #337 (deleting a space must delete its files), #211 (a published view of a trip, which must never show a file),
#64 (integration tokens), #232 (the Chrome extension), [plan-object-handoff](plan-object-handoff.md) (pointers, Send
to..., the upload sweep), [plan-realtime-optional-livekit](plan-realtime-optional-livekit.md) (chat pictures held in
memory; its step 8, stored chat pictures, is unbuilt), [plan-object-status](plan-object-status.md) and
[plan-design-system](plan-design-system.md).

## What it is today

Read as code only, 2026-10-29.

### Module uploads (`server/module-uploads.js`, `server/index.js` "files a module's people upload")

- A module opts in with `uploads` in `module.json` (`types`, `maxBytes`, `maxFiles`). Only Research does: JPEG, PNG and
  WebP, 10 MB a file, 500 files a place.
- Files live per module and scope under `DATA_DIR`: `modules/<id>/uploads/<environment | space-<id> | person-<key>>/`,
  as `<fid>.bin`, an optional `<fid>.thumb` made by the page, and `<fid>.json` (name, type, size, `by`, `at`, a photo's
  taken time, camera and position). The id is 24 random hex characters.
- **The whole file is held in memory.** `POST /api/modules/:id/uploads` uses `express.raw` with a 10 MB limit, then
  `cleanImage` (`server/image-clean.js`) decides the type from the bytes and strips what rides along (position unless
  asked to keep it). Serving reads the whole file and sends it (`sendUpload`): no range requests.
- **Reading follows the module's `read` permission**, and Research's `view` is on for guests by default, so a guest in a
  space can open Research's photos today.
- Headers on a served upload: the stored type, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private, max-age=3600`.
- Removing: the uploader or someone with owner rights. The `upload` rate limit is 30 a minute per module and person
  (`server/module-limits.js`). On a hosted install the plan's storage cap applies (`checkStorageCap`).

### Chat pictures (`server/index.js`, "chat pictures")

- Never stored. `POST /api/spaces/:id/chat/pictures` takes PNG, JPEG, GIF or WebP up to `CHAT_PICTURE_MAX_MB` (3), sniffed
  from the first bytes (`chatPictureType`), held in memory for `CHAT_PICTURE_KEEP_MINUTES` (15), bounded per space,
  environment and server (30, 100, 200 MB) and by `CHAT_PICTURE_MB_PER_MINUTE` (20) per person. Each reader fetches the
  bytes with their own access. These bounds came from QA bringing a server to 2.6 GB with a handful of 3 MB pictures
  (#380, the lessons).

### What already streams

- `PUT /api/modules/:id/files/:folder` (a picture map, owner only) streams the body to a part file with a running count,
  refuses on `Content-Length` before reading, checks the file from its header, then renames it into place. It is the
  pattern the Vault's upload should follow.
- `GET /api/modules/:id/files/:name` serves a module's file with `res.sendFile` and `acceptRanges`, answering 416 for a
  range it cannot meet. It is the pattern the Vault's serving should follow.

### Deleting a space (#337)

`server/space-erase.js` now erases each module's data and uploads for a space (`moduleUploads.forgetSpace`), with
`tools/check-space-erase.mjs` failing on a per-space file it does not know. Read as code only; #337 is still open on
GitHub. The Vault adds its own step to that list.

### Backups

The host console's backup and an owner's export (`GET /api/environment/export`, hosted only) zip the environment's
folder in memory, and a restore is read into memory with a 500 MB limit (`rawHostZip`). Anything large kept under
`DATA_DIR` makes both fail.

### The module frame and its sandbox

A module runs in an iframe with `sandbox="allow-scripts allow-forms"`, an opaque origin and no `allow` attribute
(`public/module-host.js`). Two things follow for viewers: an element inside the frame cannot go full screen, and
browsers refuse their built-in PDF viewer inside a sandboxed frame (which is one reason decision 18 does not use it). The SDK already has a safe Markdown renderer,
`host.util.markdown` (`public/sdk/host.js`): everything is escaped first, links are `http` and `https` only, no
pictures, no HTML.

### Templates

A template names modules with `moduleNames` (`templates/travel.json` shows the Planner as Itinerary;
`templates/games.json` shows Research as Lore). The travel template already has a `post-trip` phase.

## Decisions

Thomas decided these on 2026-10-29 (#380, the decisions comment).

1. **Scope: per space first.** Each space has its own Vault. An environment-wide shared library can come later.
2. **Links survive a delete.** A link to a deleted file stays on the object and reads "File removed". Deleting a file
   first shows where it is used. A permission check runs every time a link is opened.
3. **External sharing.** An expiring link with an optional password, made by an owner or a moderator, for one file or
   a chosen set. View-only by default, download optional, switchable off at any time, no account needed, and nothing
   else in the space reachable from it.
4. **Storage.** Environment settings `VAULT_DIR` (the folder) and `VAULT_MAX_GB`, plus per-person and per-space quotas.
   A cloud service (Google Drive) can plug in later behind the same setting.
5. **Viewers.** The browser's own players for images, audio and video, a PDF viewer shipped with the app (decision 18;
   the browser's built-in PDF viewer is not used), and a small sanitised Markdown renderer. Thomas's condition: every
   player has real controls (play, pause, seek, volume, full screen).
6. **Existing pictures.** Research's uploads and Chat's pictures move into the Vault later, as their own decision.
7. **Name: Vault.** Templates can show their own word (Documents for trips, Handouts for game groups).

From the 2026-10-15 attachments plan:

- Its decision 1 (one shared attachments service for every object) is **replaced** by decisions 1 and 2 above: files
  live in one place, the Vault, and other modules link to them rather than holding their own.
- Its decision 2 (the Planner and Research notes take files first, then To-do, Calendar and Budget) is kept as the
  order in which modules learn to link.
- Its decisions 3 and 4 (a file can be "Only me", and an owner may not open someone's "Only me" file) were made for
  attachments on objects. Whether a space's Vault keeps "Only me" files is decision 13.

## The target

A Vault module on a space's canvas, like any other: a list or grid of the space's files, search and filters, a viewer
for each type inside the module's window, and Share. Any module can link one of its objects to a Vault file (a Planner
stay to its booking PDF, a Research note to a map scan), show the link, and open it in the Vault's viewer. An owner or
moderator can send a link to people outside the environment that opens only the files chosen, for as long as chosen.
The bytes live in `VAULT_DIR`, stream in and out, and never sit whole in the server's memory.

## The contract

Written to the decisions below. The one open question (metadata, decision 10) is marked where it applies.

### 1. Types and limits

The type is decided from the bytes, never from the name or the header. A name or header that doesn't match the bytes
is refused, not renamed. The limits are decision 9.

| Group | Type | Extensions | Sniffed by | Per file |
|---|---|---|---|---|
| Images | `image/jpeg` | jpg, jpeg | `FF D8 FF` | 25 MB |
| | `image/png` | png | `89 50 4E 47 0D 0A 1A 0A` | 25 MB |
| | `image/webp` | webp | `RIFF` then `WEBP` at 8 | 25 MB |
| | `image/gif` | gif | `GIF87a` or `GIF89a` | 25 MB |
| Audio | `audio/mpeg` | mp3 | `ID3`, or an MPEG frame sync (`FF Ex`/`FF Fx`) | 200 MB |
| | `audio/ogg` | ogg, oga | `OggS` | 200 MB |
| | `audio/wav` | wav | `RIFF` then `WAVE` at 8 | 200 MB |
| | `audio/mp4` | m4a | `ftyp` at 4 with brand `M4A ` or `M4B ` | 200 MB |
| Video | `video/mp4` | mp4 | `ftyp` at 4 with an ISO brand (`isom`, `iso2`, `mp41`, `mp42`, `avc1`, `dash`) | 2 GB |
| | `video/webm` | webm | EBML `1A 45 DF A3` with DocType `webm` in the first 4 KB | 2 GB |
| | `video/quicktime` | mov | `ftyp` at 4 with brand `qt  ` | 2 GB |
| Documents | `application/pdf` | pdf | `%PDF-` at the start | 100 MB |
| | `text/markdown` | md | valid UTF-8 with no NUL byte, and a `.md` name | 1 MB |

- **Refused, always:** SVG, HTML, XML, scripts, executables, archives of any kind (zip, so no zip bombs), Office files,
  `.mkv` and HEIC. HEIC is refused with "Save it as a JPEG." Any other refusal names what is taken: "That kind of file can't go in the Vault. It takes pictures (JPEG,
  PNG, WebP, GIF), audio (MP3, OGG, WAV, M4A), video (MP4, WebM, MOV), PDF and Markdown."
- **Pictures too large to draw:** a picture whose header says more than 100 million pixels is refused ("That picture is
  too large to show."), so a viewer is never handed a decompression bomb. The server reads the header only.
- **PDF active content (decisions 9 and 16):** web links (`http`, `https`), email links (`mailto:`) and fillable forms
  are allowed. Refused, in `server/vault-types.js`: scripts (`/JavaScript`, `/JS`, `/AA`, `/XFA`), launches and links
  out (`/Launch`, `/GoToR`, `/GoToE`), form submission (`/SubmitForm`), embedded files (`/EmbeddedFile`,
  `/EmbeddedFiles`, `/RichMedia`), and any `/URI` that is not a web or email address (`file:`, `javascript:` and the
  like). An action that runs on open (`/OpenAction`) is refused when it holds a script or a launch, because those names
  are refused wherever they stand. Names are read as PDF names (`#xx` escapes decoded). The file is read in 1 MB windows
  with an overlap, and each Flate-compressed object stream (`/ObjStm`) is inflated and read the same way: at most 16 MB
  out of one stream, 64 MB out of all, and 200 streams. The scan runs in a worker with a time budget
  (`VAULT_SCAN_SECONDS`, 5), so it can never freeze the server. **A PDF the scanner cannot judge** (encrypted, a filter
  chain it cannot decode, over its budget or its time) is no longer refused for that reason alone (decision 18): it is
  stored as **download only**. The record carries `viewable: false`; the file is served only as an attachment, never
  inline, never in the viewer, and its row and viewer frame say "This PDF can't be opened here. Download it." A PDF in
  which the scanner positively finds a refused name or link is still refused. A PDF the scanner reads as damaged (no
  end marker, no objects) stays refused as today; whether that should also become download only is open. The headers
  below and the sandboxed viewer (section 10) are the second guard for the PDFs that are taken and viewable.
- **Names:** kept in the record, one line, at most 120 characters, path separators and control characters removed. On
  disk a file is only its random id.

### 2. Storage and quotas

| Variable | Meaning | When unset or not a number above 0 |
|---|---|---|
| `VAULT_DIR` | the folder that holds the Vault's bytes, for every environment on the host | `DATA_DIR/vault`, outside the in-app backup zips (decision 14) |
| `VAULT_MAX_GB` | the most the whole folder may hold | 20 |
| `VAULT_SPACE_MAX_GB` | the most one space's Vault may hold | 5 |
| `VAULT_PERSON_MAX_GB` | the most one person may have added, across the environment's spaces | 2 |
| `VAULT_MB_PER_MINUTE` | how much one person may send in a minute | 500 |
| `VAULT_MIN_KB_PER_SECOND` | the slowest an upload may arrive; after its first minute a slower one is cut off | 16 |

- **Layout:** `VAULT_DIR/<environment slug>/space-<id>/<fid>.bin` and `<fid>.thumb`. On a single-environment install
  the slug is the environment's own. The **records** (name, type, size, `sha256`, `by`, `at`, taken time, thumbnail
  flag) live in `DATA_DIR/modules/<id>/library/space-<space id>.json`, not in the module's data, so a backup carries
  them. The store is `server/vault-store.js`, the types are `server/vault-types.js`, and the check is
  `tools/check-vault.mjs`.
- **An owner may set lower quotas** for the environment on the Vault's settings (two `number` settings in GB, a space and
  a person), never higher than the variables. A hosted plan's storage cap counts the Vault's bytes too.
- **Counting:** bytes on disk, thumbnails included, per space and per person (the person who added the file). Each upload
  reserves its `Content-Length` against all four totals before a byte is read, so two uploads at once cannot both pass.
  On a hosted server, uploads still arriving in other environments don't count against an environment's room, so the
  server-wide total may be passed briefly; it is checked again as each file finishes, and a file that no longer fits is
  refused with 413 (decision 17).
- **A file that does not fit** is refused with its own sentence and 413: "That file is over the 2 GB limit for video.",
  "This trip's Vault is full (5 GB). Remove some files to add more.", "You have used your 2 GB in the Vault. Remove some
  of your files to add more.", "The server's file storage is full. Ask the admin." The space and limit words come from
  the environment's words.
- **Status line** in the Vault: "42 files · 1.2 GB of 5 GB".
- **Google Drive later:** the store is one small interface (`put` from a stream, `get` a range, `remove`, `size`), so a
  Drive store can replace the folder behind the same setting. Its own plan.

### 3. Server routes

The Vault declares `library: true` in its manifest (contract section 6); the routes belong to that module, so the core names
no module. `:id` is the module's id. Every route checks, **before the body is read**: the session or pass, the
environment, membership of the space (or owner rights), that the module is on there, and the permission named.

| Route | Does | Permission | Answers |
|---|---|---|---|
| `GET /api/modules/:id/library?space=` | the space's files | `view` | `{ files: [view] }` |
| `POST /api/modules/:id/library?space=&name=` | add one file, the raw body | `add` | 201 `{ file: view }`; 400 a type it can't take; 411 no `Content-Length`; 413 a limit; 429 rate |
| `GET /api/modules/:id/library/:fid/content?space=` | the bytes, inline, with ranges | `view` | 200 or 206; 404 when not allowed or gone; 416 a bad range |
| `GET /api/modules/:id/library/:fid/content?space=&download=1` | the bytes as a download | `download` | as above, `attachment` |
| `GET /api/modules/:id/library/:fid/thumb?space=` | the small picture | `view` | image bytes or 404 |
| `PUT /api/modules/:id/library/:fid/thumb?space=` | the page's small picture, up to 300 KB | the adder | as Research's |
| `PATCH /api/modules/:id/library/:fid?space=` | `{ name }` | the adder, or `remove_any` | `{ file: view }` |
| `GET /api/modules/:id/library/:fid/uses?space=` | where it is linked, as summaries the person may see, and a count of the rest | `view` | `{ uses: [summary], hidden: n }` |
| `DELETE /api/modules/:id/library/:fid?space=` | remove it | the adder, or `remove_any` | `{ ok: true }` |

`view` is `{ id, name, type, group, size, by, at, taken?, hasThumb, uses }`; `group` is `image`, `audio`, `video` or
`document`; `uses` is how many objects link to it.

- **Upload streams.** No `express.raw`. The body goes to a part file in the space's folder with a running count, as the
  picture map's upload does: refused on `Content-Length` before reading, cut off when the count passes it, sniffed from
  the part file's first 4 KB, checked, then renamed into place. A part left by a restart goes after an hour. At most two
  uploads at once per person and eight per environment; a third waits with 429 "Another upload is still running."
  An upload that trickles in below `VAULT_MIN_KB_PER_SECOND` is cut off and holds no one's place. The server's request
  timeout is raised to 2 hours so a 2 GB video on a slow link can finish.
- **Pictures are cleaned without holding them twice:** `cleanImage` runs on the part file (at most 25 MB, one at a time
  per environment). Audio, video, PDF and Markdown are kept as sent. Pictures lose where they were taken only when the person chose that
  (decision 10).
- **Serving streams.** `res.sendFile` with `acceptRanges`, never a read into memory, so a player can seek. A range it
  cannot meet answers 416 with the size, as the module files route does.
- **Headers on every file sent:** the stored type only (Markdown as `text/plain; charset=utf-8`, never HTML),
  `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` (or `attachment` with a cleaned ASCII `filename` and
  `filename*=UTF-8''`), `Cache-Control: private, no-store`, `Cross-Origin-Resource-Policy: same-origin`,
  `Referrer-Policy: no-referrer`, and `Content-Security-Policy: sandbox; default-src 'none'` on every type, PDF
  included: the browser's own PDF viewer is not used (decision 18), so the earlier PDF exception is gone. A PDF is sent
  inline only to the app's viewer, which fetches it as bytes; a download-only PDF is always sent as `attachment`, and
  the content route answers it inline with 404.
- **A refused read is 404**, never 403, so a file's existence is not given away.
- **Activity lines**, without the file's name: "added 3 files to the Vault", "removed a file from the Vault", "made a
  share link", "turned off a share link".

### 4. Links: how a module points at a file

Files are the Vault's objects (decision 8):

- **A file is an object** of the Vault, kind `file`, declared in `refs.produces` with `open: true` and `backlinks: true`.
  Its summary is `title` (the name) and `category` (the group). So a link is an ordinary pointer
  `{ module, kind: 'file', id, scope: 'space', space }`, kept by the linking module with its own data, never a copy of
  the file.
- **Resolving** goes through `host.objects.resolve`, which checks on every call that the person can read the Vault in
  that space. A file that is gone resolves with `state: 'gone'`; the SDK's file chip reads it as **"File removed"**, muted,
  with **Remove link** for someone who may edit the object (decision 2). A file the person may not see reads "Not
  available to you" and nothing else.
- **Where it is used** is the existing backlinks (`host.objects.linksTo`), which is what `GET .../uses` answers. The
  linking module tells the server its links with `host.objects.setLinks`, as links work today.
- **Opening** a link (`host.objects.open`) opens that file's viewer window over the canvas, after the same check
  (decision 19). The Vault is not brought forward and does not have to be on the canvas. It is the same window the
  Vault's own list opens.
- **Guests and keyed pages** resolve a file pointer as hidden, always.

### 5. The SDK

For any module (its manifest consumes `"<vault id>:file"` or `"*"`, approved by an owner as today):

```js
const files = await host.files.pick({ multiple: true, groups: ['document', 'image'] });
// opens the space's Vault as a chooser in a host sheet, with "Add a file" in it; resolves pointers, or [] when closed
await host.files.link(host.objects.make('plan', stayId), files);   // adds to the object's links (setLinks underneath)
const chips = await host.files.resolve(pointers);                 // [{ ref, name, group, size, state? }]
host.ui.fileChips(el, { object, canEdit });                       // draws an object's files: chip, Open, Remove link
await host.files.open(pointer);                                   // the viewer window over the canvas, after the check
```

`host.files` names no module: it reaches whichever enabled module in the space declares `library`, and answers "There
is no Vault in this {space}." with the module's shown word when none is on. The task that asked for this plan called it
`host.vault`; the rule that the core names no module is why it is `host.files` here.

For the Vault module itself: `host.library.list()`, `.add(file, { onProgress })`, `.rename(id, name)`, `.remove(id)`,
`.uses(id)`, `.url(id, { download, thumb })` and `.thumb(id, blob)`, through the bridge like `host.uploads`. The address
`url` gives works as a `src` in the frame (experience-design confirms that a media element's range requests carry the
same access from the sandboxed frame, as `host.uploads.url` does for pictures).

### 6. The Vault module

- **Manifest:** id `vault`, name "Vault", icon `vault`, `scope: ["space"]`, a `canvas` surface (dock and float) and a
  `page`, `library: true`, `refs.produces` the `file` kind, `access: { read: "view", write: "add" }`. Step 1 reads the
  permissions `view`, `add`, `download` and `remove_any`; `share` comes with step 5.
- **Permissions** (owners always have all):

| Key | Label | Member | Moderator | Guest |
|---|---|---|---|---|
| `view` | See the {space}'s files | on | on | off, and cannot be turned on |
| `add` | Add files | on | on | off, and cannot be turned on |
| `download` | Download files | on | on | off, and cannot be turned on |
| `remove_any` | Remove files other people added | off | on | off |
| `share` | Make share links | off | on | off, and cannot be turned on |

  The server refuses every library route to a guest pass, the OBS access key and any keyed page, whatever Roles says.
  The `share` row's member default is off (decision 3); an owner can turn it on for the member role in Roles (decision 12).
- **The frame:** a view switch in the toolbar (`host.ui.viewSwitch`: **List** `list`, **Grid** `grip`); the search on
  the right ("Search files"); **Filters** with a **Type** group (Pictures, Audio, Video, Documents, each with its count),
  an **Added by** group (Everyone, Mine) and a **Linked** group (Linked, Not linked). The **+** is **Add files**. The
  title bar's standard **Share** opens the share sheet for the chosen files, or the list of share links when none is
  chosen. A title bar action **Select** (`square-check`) turns on choosing several, for Share, Download and Remove.
- **The status line:** the count and the space used ("42 files · 1.2 GB of 5 GB"), and the filter in words.
- **Words:** the shown name comes from the template's `moduleNames` (Documents in travel, Handouts in games, decision 7);
  every sentence uses the module's shown name and the environment's words.

### 7. Share links

- **Made by** someone with `share` (owners and moderators by default) from the Vault's Share, for one file or a chosen
  set. The set is fixed when made; its maker or an owner can add or take out files later.
- **Choices on the sheet:** a name ("Rome photos"), an end (1 day, 7 days or 30 days; 7 by default; never without an end, decision 15), an
  optional password, and **Allow download** (off by default, decision 3). **Make link** shows the address once with
  **Copy**.
- **Stored** in the Vault's space data as `{ id, name, files, by, at, ends, download, passwordHash?, tokenHash, opened }`.
  The token is 32 random bytes; only its SHA-256 is kept, so a stolen data file opens no link. The password is hashed with
  scrypt as account passwords are (`server/auth.js`).
- **Turned off** at any time from the list of share links (**Turn off**), and by itself at its end. A space deleted or
  every file in it removed ends it too.
- **Ending for good (Thomas, 2026-11-04).** A link ends for good when the Vault is turned off or uninstalled, even when the
  files are kept: every space's share links are deleted (`dropSharesOf` in `server/vault-store.js`), and turned on again,
  the files return but no old link does.
- **A link is its maker's (Thomas, 2026-11-04).** A link also ends when its maker no longer exists, is out of the space
  (unless an owner or the admin), or no longer has `share` in the Vault there, and for a download link no longer has
  `download` either. The public routes ask this on every open (`shareMakerCan` in `server/index.js`, passed to
  `server/vault-share.js` as `makerCan`). If the maker gets the permission back, the link opens again while it has not
  ended.
- **Who may Turn off (Thomas, 2026-11-04):** its maker, an owner, and a moderator of the space (the admin counts as an
  owner). Changing a link (name, files) stays with its maker and an owner only.
- **The address:** `/shared/<token>`. Public routes, no session: `GET /api/shared/:token` (the share's name, its files'
  names, types and sizes, whether download is on, when it ends), `POST /api/shared/:token/unlock` `{ password }`, and
  `GET /api/shared/:token/files/:fid/content` (ranges; `?download=1` only when allowed) and `.../thumb`. Each checks the
  token, the end, the password cookie and that the file is in the set, before anything else. A file outside the set,
  another space's file, and every other route answer 404.
- **Password (Thomas, 2026-11-04):** at least 8 characters, at most 200 ("A password needs at least 8 characters.").
  A right password sets a signed cookie for that path only (`Path=/api/shared/<token>`, which replaces
  `/shared/<token>`: the page sends nothing itself, its `fetch()` calls to `/api/shared/<token>/...` carry the cookie;
  `HttpOnly`, `SameSite=Strict`, `Secure` on https, one hour or to the link's end if sooner).
- **Limits, as built (`server/vault-share.js`, Thomas 2026-11-04):**
  - Wrong passwords: five per link and address in fifteen minutes, thirty per link from anywhere, twenty per address
    across links; each answers 429 "Too many tries. Wait a few minutes." with `Retry-After`. The wait before an answer
    grows with that address's own tries (0, 0, 0.5, 1, 2, 4 seconds, at most 8). A right password clears the link and
    address count and takes its try back from the others.
  - Per-address misses (a hundred in fifteen minutes) apply only to links that don't open (unknown, ended, turned off,
    its maker no longer allowed). A link that opens is never held up by them.
  - A valid unlock cookie skips every limit: a link already unlocked, or one with no password, answers `{ ok: true }` to
    an unlock without counting a try.
  - Password checks run in an async scrypt queue, never on the main thread: 2 at a time across the server, 50 waiting;
    past that, 429 with `Retry-After: 5`.
  - Per-environment unlocks per minute: 60 by default, set by `SHARE_UNLOCKS_PER_MINUTE`; past it, 429 with `Retry-After`.
  - The per-link tries (thirty) are not evictable: their keys are the links that exist, so a stranger cannot push their
    counts out; the other counts are bounded (10000 keys) and drop the oldest.
  - Open streams: twelve per address ("Too many files are open at once. Close some and try again.", 429).
- **What a person outside sees:** a plain page in the environment's theme with the share's name, "Shared by <first
  name> · Ends 12 November", and its files in a grid with the same viewers as the Vault. No space name, no people, no
  chat, no modules, no sign-in prompt, no other link. **Download** shows only when allowed. A gone or ended link: "This
  link has ended." A wrong token reads the same. A removed file in the set: "File removed".
- **Headers on the page:** `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`,
  a strict CSP with no outside sources.
- **What view-only means, said plainly on the sheet:** "Without download, people can still save what they see on
  screen." A browser can always keep a picture it shows or a video it plays; view-only only takes the button away.
  **A PDF on a view-only link can still be downloaded (Thomas, 2026-11-04).** The viewer is pdf.js, which was given the
  bytes, so a person can save them; the sheet says so, next to the line above. The server still refuses `?download=1`
  on a view-only link; the PDF reaches the viewer as bytes the page fetched.
- **Deployment note: a reverse proxy and `TRUST_PROXY_HOPS`.** Every per-address limit above reads `req.ip`. Sharing
  needs the server behind a reverse proxy with `TRUST_PROXY_HOPS` set to the number of proxies in front of it, or `0` if
  it is exposed directly, because the limits trust `X-Forwarded-For`: with the wrong number, a stranger can write the
  address the limits count, or every visitor shares the proxy's. Unset, the server assumes one proxy.
- **The maker sees** each link's name, files, end, whether it has a password, and how many times it was opened.

### 8. Deleting

- **A file:** the Remove confirmation lists where it is used first ("Used in 2: Hotel Roma (Itinerary), Packing note
  (Research). The links will show File removed."), then removes the bytes, the thumbnail and the record. Links stay.
- **With the space:** erasing a space deletes its Vault files (built in step 1, `server/space-erase.js`); step 6 adds
  the share links and the check. It removes `VAULT_DIR/<slug>/space-<id>/` and the space's
  share links; `tools/check-space-erase.mjs` covers it (#337).
- **The Vault turned off in a space** keeps its files (turned on again, they return); share links stop answering while it
  is off. Uninstalling the module from the environment asks first and removes every space's files.
- **A person who leaves:** their files stay with the space, shown as added by "someone who left", and stop counting
  against a person quota.

### 9. Backups

The in-app backups cannot carry gigabytes: they zip in memory and a restore takes at most 500 MB. So (decision 14):

- The records are in `DATA_DIR` and travel with every backup; the bytes in `VAULT_DIR` do not.
- A backup that carries the bytes is a later piece of work, its own plan.
- The getting-started guide and `docker-compose.yml` give `VAULT_DIR` its own volume, and the admin backs it up with the
  data folder.
- A restore whose bytes are missing shows those files as "File missing" with **Remove**, never an error page.
- On start the server lists bytes with no record (a crash between steps) and removes them after seven days.

### 10. The design

- **List:** one row a file: a type icon or the thumbnail, the name, the group and size in quiet words, who added it and
  when, a link count (`link` icon with the number) and the more button (Open, Download, Rename, Share, Where it is used,
  Remove).
- **Grid:** square thumbnails for pictures and video (a video shows a play mark and its length), a type tile for audio
  and documents, the name under each. Three across on a phone, as many as fit elsewhere.
- **Viewer (decision 19, 2026-11-03)**, in one of the app's windows (the app's window mode), not in the Vault's content
  area, not a new browser window, one file at a time. The Vault panel only lists, searches, filters, selects, adds and
  shares; **Open** on a row, a click on a thumbnail, or a link from another module opens the window. The window's title
  is the file's name; several windows can be open at once (decision 20); its toolbar holds previous and next, **Download** where allowed, **Share** where allowed, and the
  more button (what exactly goes in the title bar and what in the toolbar is open, question 6 below). The earlier
  design, a viewer in the content area with **Back**, is replaced. In the window:
  - pictures: the `img`, fitted, with **Full screen**; a video or picture thumbnail is made in the page (decision 11), a
    PDF has none, only its type tile;
  - audio: the `audio` element with `controls` (play, pause, seek, volume, speed);
  - video: the `video` element with `controls` and `playsinline` (play, pause, seek, volume, full screen,
    picture-in-picture where the browser has it);
  - PDF: the app's own viewer (pdf.js), described below, with page, zoom, search if it is cheap, and full screen from
    the host; a download-only PDF shows "This PDF can't be opened here. Download it." with **Download** and no viewer;
  - Markdown: the text through `host.util.markdown`, read only, in the reading width.
- **Full screen needs the host** ("The module frame and its sandbox" above): the module's frame gains
  `allow="fullscreen"` (it adds no reach outside the frame), and the host provides the Full screen control for the
  PDF viewer.
- **The PDF viewer and its sandbox (decision 18).** The viewer is pdf.js, vendored under `public/sdk/` with its licence
  file, with its scripting turned off, so a PDF's own scripts never run. It is drawn by the host in the viewer window's
  content (decision 19; before it was a layer over the module's content area), and it lives in an `iframe` with
  `sandbox="allow-scripts"` and no `allow-same-origin`: the frame has a null origin, so it has no access to the app's
  cookies, storage or session, and it cannot reach the parent's page. The frame's document comes from its own route,
  which answers with `Content-Security-Policy: default-src 'none'; script-src 'self'` (plus only what the viewer's own
  styles and worker need) and the other headers above. The frame cannot fetch anything with the person's session, so the
  host page fetches the PDF with the session, after the permission check, and hands the bytes to the frame as an
  `ArrayBuffer` by `postMessage`; the frame has no network access (`connect-src 'none'`). The frame returns only
  page, zoom and search state. Controls: previous and next page, a page number, zoom in and out and fit, search if it
  is cheap, and Full screen from the host. Links inside a PDF are not followed from the viewer except web and email
  links, which the host opens in a new tab with `rel="noopener noreferrer"`. Whether this is a null-origin sandboxed
  frame (as written) or a separate origin is one of the open details.
- **Adding:** **Add files** opens the device's chooser (several at once; on a phone, the photo library and camera), and
  dropping files on the module adds them. Each shows a progress row; a refusal shows its sentence on that row. Under
  it, one line: "Everyone in this {space} can see what you add." (decision 13). Beside it, an option for the person
  adding (decision 10): **Remove where it was taken**, for pictures, with its state remembered per person. For video
  there is no option, only a notice: "Videos keep their details, which can include where they were taken." The default
  of the option is the one open question.
- **Empty states:** no files ("No files yet. Add tickets, photos and documents for this {space}." with **Add files**);
  nothing matches ("No files match." with **Clear filters**); no permission ("You can't see the files in this
  {space}."); a link chip whose file is gone ("File removed").
- **Phone (640 pixels or narrower):** one column, the grid three across, the viewer window is a full screen sheet,
  one at a time (this stays under decisions 19 and 20; opening another file replaces the sheet's file), **Download** as a large button.
- **New design-system pieces**, each added to the registry after Thomas agrees, before a module uses it: the file chip
  (icon, name, size, state), the file chooser sheet, the upload progress row, the media viewer frame, the share sheet.
  Icons: `vault`, `file-pdf`, `file-image`, `file-audio`, `file-video`, `file-lines`, `link`, `download`,
  `share-nodes`. Colours from the theme tokens.

### 11. Post-trip sharing

How a trip's photos and tickets are shared afterwards, as the plan expects it to go:

1. During and after the trip, members add photos and videos from their phones to the trip's Vault (Add files, several at
   once). Tickets and confirmations are already there, linked from the Planner's stays and journeys.
2. In the `post-trip` phase the Vault is where people look: Filters > Type > Pictures, then Select.
3. A moderator or the owner chooses the photos (and a ticket or two for the story), presses **Share**, names it "Rome,
   October", picks 30 days, leaves download on for family, and copies the link.
4. Family open the link on a phone with no account and see the photos in a grid, with the viewer and Download.
5. **The Journal (#40), later:** a Journal entry links to Vault files with `host.files.link`, never copies them, so
   the Vault stays the one place the bytes live. A Journal's "share the story" would make a Vault share link for the
   files its entries link, through the same share routes and the same `share` permission; the Journal's own words would
   be its own public page, planned with #40 and #211. Nothing in this plan stands in its way.

### 12. Security, in one place

- **Who sees what:** members and moderators of the space with `view`, and owners and the admin. Guests, the OBS access
  key, keyed pages, published views (#211), calendar feeds and the published calendar never see a file, a name or a
  count; the only way in from outside is a share link. A file's name reaches summaries, search, links and the AI only for
  people who can read the Vault (decision 8).
- **Checks before the body:** every write route decides access, quota and rate before reading a byte; a refusal ends the
  request and throws away what is still arriving, as the picture map's upload does.
- **Never in memory whole:** uploads stream to disk; files stream out with ranges; the only whole read is a picture
  of at most 25 MB in `cleanImage`, one at a time per environment.
- **Content safety:** types from bytes; no SVG or HTML; Markdown sent as plain text and drawn escaped; `nosniff` and the
  sandbox CSP on every type; no archives, so no zip bombs; pictures over 100 million pixels refused.
- **PDF safety (decision 18): the scanner as a first filter, plus a sandboxed viewer.** The bounded scanner
  (`server/pdf-scan.js`, run by `server/vault-scan.js` in `server/vault-scan-worker.js`) refuses a PDF in which it
  finds a script, a launch, an embedded file, a `file:` or `javascript:` link, `SubmitForm` or an `AA`/`OpenAction`
  script, also in decodable object streams. It is not trusted to be complete: a PDF it cannot judge is stored as
  download only and is never opened in the app. A PDF it passes is opened only by the vendored pdf.js with scripting
  off, in a sandboxed frame with a null origin, a CSP of `default-src 'none'` and no cookies, with the bytes passed in.
  The browser's built-in PDF viewer is never used. The vendored pdf.js is a file the app trusts, so its hash is pinned
  by a check (step 3). A person who downloads a PDF opens it in their own reader, as with any file.
- **Malware:** apart from the PDF scan above, the server never opens, decodes or runs a file. The risk is to a person
  who downloads one. No scanner is
  bundled; a ClamAV socket variable is a later idea, not planned.
- **Filenames:** never used on disk; cleaned for display; sent in `Content-Disposition` in both ASCII and UTF-8 forms.
- **Metadata:** the person adding files chooses (decision 10, section 10 "Adding"). Taken time and camera are read into
  the record for pictures either way. Audio and video are kept as sent, which can include where a video was taken, and
  the notice under Add files says so.
- **Rate limits:** the module `upload` limit, `VAULT_MB_PER_MINUTE`, two uploads at once per person, the share
  limits of section 7 (password tries, misses, unlocks per minute, the scrypt queue, open streams), and the existing
  request limits on share routes.
- **SSRF: none.** The server never fetches an address for the Vault: there is no "add from a link". The Drive store is its
  own plan.
- **Share tokens** hashed at rest, compared in constant time, 32 bytes, never in logs.

## Left to build, in order

Each step can be built and checked on its own. A new or changed module gets a version bump in `module.json` and
`tools/module-versions.json`. Sizes are S, M, L.

| # | Step | Size | Agent | Kind |
|---|---|---|---|---|
| 1 | **Store, routes, quotas. Built** (commits `bde9358` to `154819d`; security QA round 1 failed and fixed, round 2 pending). `server/vault-store.js`, `server/vault-types.js`, the routes on `/api/modules/:id/library?space=`, the variables, the PDF rule (its "cannot judge" case changes in step 3, decision 18), the minimum upload speed, the 2 hour request timeout, space erase deleting files, `tools/check-vault.mjs` in `npm run check`. The Remove-where-it-was-taken option and its default wait for Thomas's answer | L | server-development | feedback build with a QA security review |
| 2 | **The Vault module and its list.** `modules/vault` at 0.1.0: manifest and permissions, List and Grid, search, Filters, Add files with progress, Rename, Remove with "where it is used", Select, the status line, empty states, phone | M | experience-design | try build |
| 3 | **Viewers, in a window (decision 19).** The viewer window that Open, a thumbnail and `host.files.open` all open (on the existing window mode first; it moves to the general object window later, decision 20); several windows at once with a cap of 4 and **Close all**, and the previous and next rule of decision 20; pictures, audio, video with real controls, Markdown; the frame's `allow="fullscreen"`; previous and next; thumbnails made in the page. **The pdf.js viewer and the download-only state:** pdf.js vendored in `public/sdk/` with its licence file and a check (in `npm run check`) that the vendored file's hash is pinned; the sandboxed viewer frame and its route with its own CSP; page, zoom, search if cheap, Full screen from the host; server-side, the `unchecked` and `unsafe` scan answers for a PDF store it with `viewable: false` instead of refusing it, serve it only as an attachment, and show "This PDF can't be opened here. Download it." | L | experience-design (the viewer, the layer, the notes); server-development (the download-only state, the viewer route and its headers, the hash check) | try build for the viewers, a feedback build with a QA security review for the PDF viewer, then a browser pass by Thomas |
| 4 | **Linking SDK and one module.** `host.files.pick`, `.link`, `.resolve`, `.open`, `host.ui.fileChips` (resolving a file link must read the library records in `DATA_DIR/modules/<id>/library/`); "File removed"; the Planner links its stays and journeys to files (decision 2 of 2026-10-15's order) | M | experience-design | try build |
| 5 | **External sharing.** Share records, the public routes, the password and its cookie, ends and Turn off, the `/shared/<token>` page and its viewers, the share sheet and list in the Vault | L | server-development (routes), experience-design (the page and sheet) | feedback build with a QA security review |
| 6 | **Delete with the space, and backup.** The `space-erase.js` step and its check; uninstall removes files; "File missing"; the orphan sweep; `docker-compose.yml` and the guide's `VAULT_DIR` volume | S | server-development (content-manager for the guide) | try build |
| 7 | **Templates' words.** `moduleNames` Documents (travel) and Handouts (games), and the Vault in both templates' module lists | S | experience-design | try build |
| 8 | **Documentation:** api-modules (`library`, the routes, share routes), api-module-sdk (`host.files`, `host.library`), architecture-modules (storage), a Vault user guide, the environment variables, the CHANGELOG | M | content-manager | after each step |

Then, each its own decision and plan: Research's uploads and Chat's pictures into the Vault (decision 6; chat pictures
would make the realtime plan's step 8 unnecessary), more modules linking (Research notes, then To-do, Calendar, Budget),
the environment-wide library, Google Drive, the Journal (#40).

## Verify

- **Checked by a tool** (`tools/check-vault.mjs`, a throwaway server with `DATA_DIR` and `VAULT_DIR` under `/tmp`):
  - step 1: each accepted type kept from its bytes, and refused under a false name or header; SVG, HTML, a zip, a `.mov`
    refused; a huge-pixel PNG header refused; a PDF with each refused name refused, also inside a compressed object
    stream, and a PDF with web links, email links and a fillable form taken; a stream over 16 MB refused; a trickled
    upload cut off; the server-wide total checked again as a file finishes (413); each limit from its variable
    and its default; a `Content-Length` over a limit refused before any byte is written (the folder holds no part
    file); a body longer than its `Content-Length` cut off; two uploads at once reserving against one quota; the
    server's memory stays flat while a 1 GB body streams in (measured with `process.memoryUsage`); a range request
    answers 206 with the right bytes, a bad one 416; every header present on every type; the permission matrix (guest
    pass, access key, non-member, member without `view`, member, adder, moderator, owner, admin) on every route, a
    refusal always 404 with no name in the answer.
  - step 3 (server half): a PDF the scanner cannot judge (encrypted, an undecodable filter chain, over its budget or its
    time) is stored with `viewable: false`, its inline content route answers 404 and its download route sends an
    attachment; a PDF with a script is still refused; the vendored pdf.js file's hash matches the pinned one and the
    check fails when it does not; the viewer route's CSP is exactly the written one.
  - step 4: a pointer to a removed file resolves `gone`; a guest's resolve is hidden; `uses` lists the linking object.
  - step 5: a share answers only its own files; an ended, turned-off or wrong token reads "ended"; the password tries
    limit; the cookie works only on its own path; download refused when off; the token is not in the data file.
  - step 6: `check-space-erase` finds no Vault file or share of a deleted space.
  - steps 2, 3, 4 and 7: `check-modules`, `check-module-versions`, `check-module-layout`, `check-switches`,
    `check-templates`.
- **Verified live in a browser on a local server** (no LiveKit needed; the module's own page): adding several files,
  the list and grid, filters, search, each viewer's controls, seeking a video, full screen, the PDF viewer (page, zoom, search, full screen, a PDF with a script in it showing nothing run, the frame unable to
  read the app's cookies), a download-only PDF with its note, Markdown with
  planted HTML showing as text, removing a linked file and the Planner showing "File removed", a share link opened in a
  private window with and without a password, the phone layout at 390 pixels.
- **Read as code only:** the Vault on a space's canvas, which needs the call page; say so in the reports.
- **Only Thomas can verify:** photos and videos from his phone (iOS and Android), what iOS does with the PDF viewer (pdf.js in a sandboxed frame, full screen),
  playback of each type in Safari, Chrome and Firefox, a share opened on a relative's phone, the backup of `VAULT_DIR` on
  his host, and the bumped modules installing in his environment.

## Risks

- **Phones record what the Vault refuses.** iPhones record `.mov` (HEVC) and take HEIC photos. Safari's chooser often
  converts photos to JPEG, but not always videos. A `.mov` is accepted and may not play outside Safari (decision 9); HEIC is refused with "Save it as a JPEG."
- **Codecs are not types.** An MP4 can hold a codec a browser cannot play (HEVC outside Safari). The viewer says "This
  browser can't play this file." with **Download**; the server does not transcode.
- **pdf.js is third-party code the app ships.** It needs updating when it has a security fix; its version is pinned and
  checked by hash (step 3), and scripting is off.
- **A download-only PDF is a PDF the app could not judge.** It reaches only people who choose to download it, and it is
  never opened by the app; the person's own reader then opens it.
- **View-only is not copy protection**, and the share sheet says so.
- **Backups:** the bytes are outside the in-app backup by design; an admin who does not back up `VAULT_DIR` loses files.
- **Metadata in video** can carry a position the Vault does not strip.
- **Summaries carry names** (decision 8); a passport scan's name is seen by every member who can
  read the Vault.

## Decided

Thomas decided these on 2026-10-30, answering the open questions. Numbers continue the list above.

8. **Files are the Vault's objects.** A `file` kind: links, backlinks, open, search and drag reuse what exists. File
   names reach summaries only for people who can read the Vault. One kind of link everywhere.
9. **Types and limits as in section 1.** 25 MB pictures, 200 MB audio, 2 GB video, 100 MB PDF, 1 MB Markdown. The PDF
   active-content refusal is on, as decision 16 sets it and decision 18 refines it. `.mov` is accepted as `video/quicktime`, with a note that some browsers can't play it.
   HEIC is refused with "Save it as a JPEG."
10. **Metadata is the choice of the person adding files**, not a fixed rule. Under Add files, an option **Remove where it
    was taken** for pictures and a plain notice for video (section 10, "Adding").
11. **Thumbnails** for pictures and video, made in the page; none for PDF.
12. **Share links** are made by owners and moderators. An owner can switch `share` on for the member role in Roles; it is
    off by default.
13. **No "Only me" files** in a space's Vault. Everything belongs to the space; the text under Add files reads "Everyone
    in this {space} can see what you add." Personal documents wait for the environment-wide library.
14. **Storage default.** `VAULT_DIR` unset means `DATA_DIR/vault`, outside the in-app backup zips. A backup that carries
    the bytes is a later piece.
15. **Share link ends:** 1, 7 or 30 days, 7 by default, never without an end.
16. **The PDF rule (2026-10-31).** Allow web links, email links and fillable forms. Refuse scripts (JavaScript),
    launches, embedded files, `file:` and `javascript:` links, form submission to outside sites (`SubmitForm`) and
    actions that run on open (`AA`, `OpenAction` with a script or launch), also inside compressed object streams. The
    builder reads `/ObjStm` with a limit of 16 MB per stream and a cap on the number of streams; a file whose stream
    can't be read within the limit is refused in plain words. This replaces the earlier list of refused names.
    Decision 18 changes the last part: a file the scanner cannot judge is kept as download only, not refused.
17. **Hosted servers (2026-10-31).** A brief overshoot of the server-wide total is accepted. Uploads still arriving in
    other environments don't count against it, and the total is checked again as each file finishes (413).

18. **PDF safety and viewing (2026-11-01).** PDF safety is "the scanner as a first filter, plus a sandboxed viewer".
    The bounded scanner stays as decision 16 and the code have it: it refuses obvious scripts, launches, embedded files,
    `file:` and `javascript:` links, `SubmitForm` and `AA`/`OpenAction` scripts, also in decodable object streams, with a
    time budget (`VAULT_SCAN_SECONDS`, 5) in a worker, so it can never freeze the server. What changes is a PDF the
    scanner cannot judge (encrypted, unusual filter chains, over the budget): it is no longer refused for that reason
    alone. It is stored as download only: served as an attachment, never opened inline, never shown in the viewer, with
    the note "This PDF can't be opened here. Download it." A PDF the scanner positively finds a script in is still
    refused. In the app, a PDF is shown by a viewer shipped with the app (pdf.js in `public/sdk/`, scripting disabled)
    in a sandboxed frame with no access to the app's cookies (section 10), with real controls (page, zoom, search if
    cheap, full screen provided by the host). The browser's built-in PDF viewer is not used. This replaces the
    browser-viewer part of decision 5 and the host-drawn layer with an Open fallback.

19. **Viewers open in a window (2026-11-03).** The viewers (pictures, audio, video, Markdown, PDF) open in one of the
    app's windows (the app's window mode), not inside the Vault's content area and not in a new browser window. The
    Vault panel lists, searches, filters, selects, adds and shares files. When another module links to a file (a
    Planner stay to its booking PDF, a Research note, Chat), the same viewer window opens over the canvas; it does not
    bring the Vault forward. This is object-window question 13a, answered yes. It replaces the viewer "inside the
    module's content area" with **Back** in section 10, and the "brings the Vault forward" wording in section 4. The
    phone keeps its full screen sheet.

20. **Viewer windows, several at once (Thomas, 2026-11-03).** Answers to the questions that followed decision 19:
    - **Several windows.** Opening a file opens a new viewer window; earlier ones stay, so a person can compare two
      pictures or keep a PDF beside a map. Opening a file that already has a window brings that window forward instead
      of opening a second. The cap is 4 windows (confirmed by Thomas, 2026-11-03): at the cap, opening a
      fifth shows "Close a window to open another." and opens nothing. The window's menu has **Close all**. On a
      phone, one window shows at a time as the full screen sheet (decision 19), and the cap does not apply to what is
      seen, only one sheet; opening another file replaces the sheet's file.
    - **Previous and next** walk the files linked where the window was opened from (a Planner stay's files, a Research
      note's), when the opener gives them, else they are hidden. From the Vault's list they walk the Vault's list as
      filtered.
    - **Mechanism and order.** Step 3 builds the viewer on the existing window mode first; the general object window
      of [plan-object-window](plan-object-window.md) is the later target (its step 9), and the viewer's content does
      not change in that move.
    - **The public share page** keeps its own viewer inside the page (section 7), sharing the viewer's code with the
      window, not a copy.

Kept from the earlier decisions: viewers have real controls (play, pause, seek, volume, full screen). The host provides
full screen because it doesn't work in the sandboxed module frame (section 10).

## What is not decided

1. **The default for Remove where it was taken** (decision 10). Thomas said it is the user's choice; the default is
   still open. Suggestion: on for pictures, so a position is dropped unless the person keeps it, as Research does; for
   video, an obvious notice, because the Vault does not strip video. Blocks only the metadata part of step 1.
2. **The pdf.js version and how it is loaded** (decision 18). Which release, its build (the legacy build runs in more
   browsers), whether it runs its parsing in a worker or on the viewer frame's thread (a worker from a null-origin
   frame needs the CSP to allow it), and whether its files are served from the viewer route or inlined. Blocks step 3.
3. **The shape of the sandbox** (decision 18). The plan writes a sandboxed frame with a null origin and its own route
   and CSP, fed the bytes by `postMessage`. Whether the viewer instead gets a separate origin (a second host name, which
   a single-environment install does not have), and the exact CSP the viewer needs, are to settle with
   security QA. Blocks step 3.
4. **A damaged PDF** (no end marker, no objects). It stays refused; whether it too becomes download only is for Thomas.
5. **Whether search ships in the first viewer** (decision 18: "if cheap"). To be answered when the viewer is sized.
6. **What the viewer window's title bar and toolbar hold** (decision 19). Stays open until Thomas sees the prototype
   drawing. Suggested split: the title bar has the file's name, Close and the more button (Rename, Where it is used,
   Remove, each only where allowed); the toolbar has previous and next, **Download**, **Share** and Full screen.
   Whether Rename and Remove belong in a viewer at all, or only in the list, is Thomas's. *Suggestion: Download, Share
   and previous/next in the toolbar; Rename, Where it is used and Remove in the more button.* Blocks step 3.
