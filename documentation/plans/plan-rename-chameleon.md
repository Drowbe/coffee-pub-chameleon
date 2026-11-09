# Rename to Chameleon Plan

**Audience:** Thomas, who decides the name, the look and what is renamed; server-development, experience-design and
content-manager, who build it; quality-assurance, who checks it.

**Status:** drafted 2026-11-07. Thomas, 2026-11-07: the product is "Coffee Pub Chameleon" ("all of the software start
with Coffee Pub... because all other names are trademarked, have domains, etc."), "but we will likely refer to it as
Chameleon in product". He hoped the name "was a variable in our code, it was supposed to be". Later the same day he
approved the name step (step 1) and decided (a), (c), (d), (e), (f) and (g), recorded below. Still open: the licence,
the logo and icons (b), and whether the app's product pages and README lead like the website. Step 1 is already in
progress as a try build on branch `pm/rename-chameleon-name`; the screenshots for the website are on
`pm/website-screenshots`.

## What it is today

**The name is a variable.** `DEFAULT_PRODUCT_NAME = 'Collaborator'` in `server/product-name.js` is its only definition;
the `PRODUCT_NAME` environment variable overrides it, and every sentence a person reads takes `productName()` (server)
or `/api/branding` and `/api/product` (pages). `check-names` fails on any new hard-coded use of it under `server/`,
`public/`, `modules/`, `tools/`, `templates/` and the Dockerfile (plan-kind-names, decision 7).

Where the name shows, all from that one variable:

- **The environment's name, when it was never renamed** (`server/index.js`, `environmentFor`): the top bar's branding
  area, the sign-in, sign-up and bad-link pages, the browser tab's title (`public/brand.js`), and the installed app's
  name in `/manifest.webmanifest`, whose `short_name` is cut at 12 characters. An environment that already has a name
  keeps it: changing the default renames nothing stored.
- **Sentences:** refusals for theme, template and module files ("That isn't a Collaborator theme file."), migration
  refusals, the module checks, the AI's paste instructions, the startup log.
- **Formal places:** Manage > About's heading (followed by the fixed line "A Coffee Pub product"), the product pages'
  header and footer and their `<title>`, the authenticator app's issuer for two-step sign-in, the outgoing user-agent
  (`Collaborator/0.x`).

**What is a fixed word, not the variable.** Counted on `origin/main` at `855e2b2`:

| Where | What | Count |
|---|---|---|
| Served code | `server/product-name.js` (the default) and one word in an old design record, `public/design-system/legacy/inventory/index.html` | 2 files |
| Names in served code | `REPOSITORY_URL` (`server/product-name.js`), the "Self-host it" links in `landing.html`, `travel.html`, `games.html`; the past fence label `collaborator` in `server/file-format.js` | 5 files |
| Checks | three test sentences in `tools/check-names.mjs`, the repository address in `tools/check-geocode.mjs`, an allow-list entry, 18 fixtures in `tools/fixtures/format-old/` (old formats, kept on purpose) | 21 files |
| Install and build | `docker-compose.yml`, `package.json` and its lock, `module.json`, `.github/workflows/image.yml` | 5 files |
| Words | `README.md` (2), `CHANGELOG.md` (9 lines, all past entries), `CLAUDE.md` (2 lines), `.claude/` agents and skills (9 files), `documentation/` (46 files, 164 mentions: 21 user guides, 12 plans, 7 architecture, 3 API, 1 design system, `home.md`, `known-issues.md`) | 59 files |

The **names**, as opposed to sentences, and what renaming each would break:

| Name | Where | If renamed |
|---|---|---|
| Repository `Drowbe/coffee-pub-collaborator` | GitHub, `REPOSITORY_URL`, the "Self-host it" links, `module.json` `url` and `id`, `tools/check-geocode.mjs` | GitHub redirects the old web, clone and wiki addresses; local clones keep working. The wiki publisher reads `module.json`. |
| Image `ghcr.io/drowbe/coffee-pub-collaborator` | `.github/workflows/image.yml`, `docker-compose.yml` line 46 | GitHub does not redirect a package. A NAS whose compose still names the old image keeps pulling the last old build and never updates, without an error. |
| Compose service `collaborator`, containers `collaborator-app` and `collaborator-livekit` | `docker-compose.yml` | Only a new paste is affected; on a NAS it makes new containers beside the old ones. |
| Data folders `/share/appdata/coffee-pub-collaborator` and `-vault` | `docker-compose.yml` | A new path starts an empty install unless the folders are moved first. Everything stored would look gone. |
| Package name `coffee-pub-collaborator` | `package.json` | Nothing a person sees. |
| `module.json` `title` "Coffee Pub Collaborator" | the wiki's title | A sentence; safe to change on its own. |
| Example host `collaborator.<domain>` | compose comments, the install guides | Only an example; Thomas's real DNS is his own. |

Cookies (`app_session`), browser keys (`app.`), file formats and environment variables are already named by kind and
carry no product name.

**The brand kit** (Coffee Pub Studio, draft "Tile Quartet") has eight SVG masters per product (mark and lockup; full
colour, `-dark`, `-navy`, `-white`), PDFs, and PNG marks from 16 to 4096 px. The lockup SVGs have their text outlined, so
they need no fonts, but they spell the name, so they can't follow `PRODUCT_NAME`. The kit's `icons/` folder (favicon,
touch icon, 192 and 512) is the **Studio** mark, not Chameleon's; Chameleon's icons have to be made from its mark.

**The fonts are already here.** Figtree and Fraunces are self-hosted in `public/fonts/` with their `OFL.txt` (SIL Open
Font License 1.1). The app's UI font is Figtree (`--font-ui`) and Fraunces is its display face (`--font-display`,
`public/sdk/system.css`); the product pages use both too. No CDN, nothing to license.

**The look today.** Three themes set every colour: Strong Coffee (the default, never stored, `DEFAULT_THEME` in
`server/store.js`; its dark set is `style.css`'s own palette), Calming Teal and Burnt Orange (seeded built-ins). A
template can pick a built-in theme or carry its own. The product pages have their own palette (`--l-*`, outside the
colour checks by `OWN_PALETTE`). The default site icon, favicon and installed-app icon is
`public/assets/images/brand/brandmark-color.png`; the host console's bar uses `logo-light.png`; the product pages use
`landing/mark.webp`. OBS views draw no branding.

## Decisions

Thomas's, 2026-11-07:

1. **The product is Coffee Pub Chameleon**, called Chameleon in the product. Always written in full as "Coffee Pub
   Chameleon", never "CoffeePub" or "Coffee-Pub".
2. **Rename by plan.** The name should be one variable, as it was meant to be.
3. **The brand is Coffee Pub Studio's kit** (https://coffeepubstudio.com/design-system): four marks, Coffee Pub Studio,
   Coffee Pub Chameleon (this product), Coffee Pub Showrunner (the OBS companion app, until now called Coffee Pub
   Studio) and Coffee Pub Gaming (the Foundry VTT modules).
4. **(a) `PRODUCT_NAME` holds the full name.** Its default is `Coffee Pub Chameleon`. The app derives the short form
   "Chameleon" by stripping a leading "Coffee Pub ", and uses it only where the product name alone fits and in running
   text after the first mention. Titles, the sign-in, first mentions, the README, the wiki and About use the full name.
   A branded version (travel, gaming) sets its own full name. Reason: the full name is the product's real name, and one
   setting says it. (This replaces the planner's suggestion that the short name be the setting; see "Option not taken".)
5. **(c) A new "Chameleon" theme, in the brand colours,** is added and is the default for new groups. Strong Coffee,
   Calming Teal and Burnt Orange stay as choices. Existing environments keep the theme they have. Brand colours, light:
   cream `#FBF6EC`, navy `#14243B`, teal `#0B7A84`, coral `#F26B52`; dark: background `#0E1A2B`, dark teal `#5CC8CF`,
   dark coral `#FF8264`, text `#F4ECDD`. Step 5 is now in scope; it needs a Prototype first, which Thomas locks.
6. **(d) The repository and the image are renamed in the same push as the name change.** The consequences and the safe
   order are under "Renaming the repository and the image". The container names, the compose service and the data
   folders are not part of this decision and stay as they are.
7. **(e) Words in documents.** content-manager replaces "Collaborator" with "Chameleon" in sentences (the full name in
   the README's title and licence, and `home.md`), and "Coffee Pub Studio" meaning the OBS app with "Coffee Pub
   Showrunner". CHANGELOG past entries stay as written; a new entry says the product was renamed. Plans are records and
   keep their words. Thomas (or the project manager) edits `CLAUDE.md` and `.claude/`; the lines are:
   - `CLAUDE.md` line 1: `# Collaborator` becomes `# Chameleon`.
   - `CLAUDE.md` line 4: "The repository is `coffee-pub-collaborator`; the product is **Collaborator**." becomes "The
     repository is `<new repository name>`; the product is **Coffee Pub Chameleon**, called Chameleon in the product."
   - `.claude/agents/*.md` (7 files) and `.claude/skills/manage`, `plan-feature`: "Collaborator" becomes "Chameleon";
     `content-manager.md` line 36 says the product's name in anything a person reads is Chameleon.
8. **(f) The check.** Add `collaborator` to `PAST_PRODUCT_NAMES` in `tools/check-names.mjs`, beside magpie and tavern.
   The fixtures, the past fence label and the repository address are already exempt; the three test sentences in
   `check-names.mjs` and the legacy inventory word need rewording or an entry with a reason.
9. **(g) Coffee Pub Showrunner.** Out of scope except its name: the words a person reads that say "Coffee Pub Studio"
   or "the Studio app" become "Coffee Pub Showrunner" and "Showrunner": `public/admin.html` (four lines),
   `public/admin.js` (one), the Stream module (`stream.html`, `stream.js`, `CONTRACT.md`, with a version bump). Code
   comments that say Studio change when those files are next touched.

### Option not taken (a)

`PRODUCT_NAME` as the short name "Chameleon", with the brand written before it in formal places. It would have fitted
the top bar, tab and installed app (12 characters) with nothing derived, and the existing allow-list entry for the
default would fit as it is. Thomas chose the full name as the setting instead.

## Renaming the repository and the image

Decision 6. Today: repository `Drowbe/coffee-pub-collaborator`, image `ghcr.io/drowbe/coffee-pub-collaborator`.
The new names are not yet given; the plan does not choose them.

**What breaks, and what does not.**
- GitHub redirects the old web, git and wiki addresses of a renamed repository. It does not redirect a container image.
- A NAS whose compose file still names the old image keeps pulling the last old build and never updates, without an
  error. Thomas changes the `image:` line in his compose file the same day the first new image exists.
- Renaming the repository changes this agent session's repository binding and the image workflow's image name
  (`images:` in `.github/workflows/image.yml`; its tags are `latest` on the default branch, the git tag, and `sha-`
  plus 7 characters of the commit). The wiki address changes too; `tools/wiki-sync.mjs` reads the repository from
  `module.json`'s `url`, so that file must change.

**It cannot be one atomic push.** Renaming the repository is a GitHub setting only Thomas can change. The name step
and the file edits can go in one push; the setting and the first image cannot.

**Files the rename touches** (found by searching `coffee-pub-collaborator` and `Drowbe`; the owner `Drowbe` does not
change, only the repository and image name):
- Build and install: `.github/workflows/image.yml` (line 32, the image name), `docker-compose.yml` (line 46, the
  image; lines 132 and 133 are data folders and stay), `module.json` (`url`, and `id` if it follows the repository),
  `package.json` and `package-lock.json` (`name`, optional).
- Code: `server/product-name.js` (`REPOSITORY_URL`, line 32, which is also the geocoder's user-agent address),
  `tools/check-geocode.mjs` (line 94, the same address), `tools/check-names-allow.json` (line 182, the entry that
  allows the repository and image addresses).
- Served pages: `public/landing.html`, `public/travel.html`, `public/games.html` (the "Self-host it" and footer links).
- Words: `README.md` (wiki link), `CLAUDE.md` (line 4), `documentation/home.md`, `documentation/TODO.md` (issues
  link), `documentation/userguides/userguide-getting-started.md` (lines 15, 166, 167),
  `documentation/architecture/architecture-environments.md` (341, 342),
  `documentation/architecture/architecture-overview.md` (313). `CHANGELOG.md` past entries and the other plans are
  records and stay.
- Not touched: `tools/check-compose.mjs` (it does not name the image), `.github/workflows/project-priority*.yml` and
  `tools/check-project-*.mjs` (they name only the owner), `tools/wiki-sync.mjs` (its hub link is another repository).

**Safe order (a proposal for Thomas).**
1. Merge the name step (step 1), with the repository and image text still old, so nothing points at an address that
   does not exist yet.
2. Thomas renames the repository in GitHub settings. The project manager updates `image.yml` and the references above
   on a branch right after, and merges it.
3. The workflow builds the first image under the new name from that merge. Check that the new package exists and has
   `latest` before step 4. The old image's last build is left untouched.
4. Thomas changes the `image:` line in his compose file, pulls and recreates.

Between steps 2 and 3 nothing pulls the new name, and the old image stays as it was.

## Open for Thomas

Each with a suggested answer, marked as a suggestion.

**(b) Logo, icons and fonts.** Not ruled.
- Default site icon and favicon, sign-in page icon, installed-app icon: the Chameleon mark, full colour. The mark
  works on both modes; the `-dark` variant only on a navy ground. An environment's own uploaded icon still wins.
- Product pages and the host console's bar: the lockup, built as the mark plus live text (so it follows
  `PRODUCT_NAME`), light and dark from the kit's colours (name coral `#E0553C` on light, 24 px and up only; `#FF8264` on dark).
- About: the mark beside the name. OBS views: nothing.
- Fonts: the UI fonts do not change; Fraunces 700 is used only in the lockup.
- Files are named by kind (`mark.svg`, `mark-dark.svg`, `icon-192.png`), not after the product, or `check-names`
  fails on them.
- *Suggestion: all of the above, and remove the old Coffee Pub brandmark and logos.*

**The licence.** Manage > About says "Released under the MIT license"; the README says proprietary. Thomas will say
which.

**Positioning (relayed by the website session, not Thomas's words).** The public website leads with the shared
platform for groups, with tabletop and OBS player sources listed but not the headline. That concerns the website and
the app's product page copy. Question: do the app's own product pages and the README lead the same way?

**About must not repeat the brand.** About prints the fixed line "A Coffee Pub product" under its heading. With the
full name as the heading, "Coffee Pub" shows twice. Open: drop the fixed line, or show the short name in the heading.
*Suggestion: drop the fixed line.*

## The contract

**Server.** `DEFAULT_PRODUCT_NAME` is `Coffee Pub Chameleon`, and `productName()` stays the full name. A new function
derives the short name by stripping a leading "Coffee Pub "; a name without that prefix is its own short name. The full
name is used for the authenticator issuer, the first mention in a sentence, the startup log and the formal places; the
short name for the installed app's `short_name` and the outgoing user-agent (`Chameleon/0.x`). `/api/product` answers
`name` (full) and `shortName`; `/api/branding` answers `productName` (full) and `shortName`. `/manifest.webmanifest`
lists the new icons (192, 512, and an SVG) once (b) is decided. `docker-compose.yml`: `PRODUCT_NAME` and the header
comment take the new name. The allow-list entry for the default is updated to the full name.

**Pages.** The full name in titles, the sign-in, sign-up and bad-link pages, first mentions, About and the product
pages' header and footer; the short name in the top bar where only the name fits and in running text after the first
mention. The lockup (step 4) is the mark (SVG) plus "Coffee Pub" in Fraunces 700 and the name in Figtree 600, the same
size, on one line, the mark 56 units tall for 32 px text and 12 units from it, coloured as the kit says for light and
dark.

**The Chameleon theme (step 5).** Seeded as a built-in like Calming Teal and the default for new groups, so
`DEFAULT_THEME` in `server/store.js` becomes it. Existing environments keep their theme: one that never stored a theme
(it follows the default today) must be given Strong Coffee, or the build says how else it is kept. Constraints:
- Coral `#F26B52` is not a button colour on light: white on it is 3.0:1, below the 4.5:1 minimum for text. It is an
  accent only.
- Teal `#0B7A84` can be the button colour on light (5.1:1 with white). On dark, `#5CC8CF` on `#0E1A2B` is 8.8:1.
- The five module surfaces must pass `check-surface-steps` (deltaE 2000 of at least 2.0 between steps, both modes),
  and the contrast check and the theme tools.
- Cream `#FBF6EC` and navy `#14243B` are the light ground and text; `#0E1A2B` and `#F4ECDD` the dark.
- A Prototype shows it first, and Thomas locks it before the build.

## Left to build, in order

1. **The name (try build, in progress on `pm/rename-chameleon-name`).** server-development: the default name, the short
   form, the compose file's `PRODUCT_NAME` and comment, `module.json`'s `title`, `collaborator` added to the check's past
   names with its rewording. content-manager: README, `home.md`, the architecture, API, design-system and user-guide
   sentences, a CHANGELOG line. No visuals, and no repository or image names yet. Decided.
2. **The repository and image (decision 6).** project-manager and server-development, with Thomas, in the order above:
   Thomas renames the repository and later changes his compose file; the builders update `image.yml` and the references.
3. **Showrunner's name.** experience-design: the sentences in `admin.html` and `admin.js`, and the Stream module's
   bump; content-manager: the documents. Decided.
4. **The mark.** experience-design: the mark and icons under kind names, favicon, site icon, manifest, host console,
   About, and the product pages' lockup with live text, light and dark; shown first on the Prototype for Thomas.
   server-development: the manifest. Needs (b).
5. **The Chameleon theme.** experience-design: Prototype first, locked by Thomas; then the theme and the checks.
   server-development: the new `DEFAULT_THEME` and keeping existing environments on their theme.

QA after each step except the first, which is a try build.

## Verify

- Step 1: `npm run check` (by tool; as root, the two known `--migration` cases of `check-names` fail and are not a
  defect); a local server with `PRODUCT_NAME` unset shows the full name in the tab and the sign-in page and the short
  name where only the name fits (live, in a browser); `/api/product` and `/api/branding` answer both forms (curl); a
  `PRODUCT_NAME` without "Coffee Pub " gives the same name for both; a theme file refusal names it; `grep -ri
  collaborator` leaves only the listed exempt names.
- Step 2: `npm run check` after the references change; the workflow's first run publishes the new package with `latest`
  and a `sha-` tag (read on GitHub); the old repository links redirect (curl); Thomas's NAS pulls the new image (his
  check). None of this can be checked from a container without GitHub.
- Step 3: the Manage page and the Stream module read "Showrunner" (live).
- Step 4: favicon, installed-app icon and lockup in light and dark (live, in a browser); the manifest's icons (curl).
  The installed app on a phone needs a real device.
- Step 5: `check-surface-steps`, the contrast check and the theme tools pass (by tool); a new group starts on the
  Chameleon theme and an existing environment keeps its own (live).
- Nothing here needs a LiveKit call.

## What is not decided

- (b), the licence, the positioning question and the About repetition above. Step 4 is blocked by (b); nothing else is.
- The new repository and image names.
- Thomas's own NAS: if his compose was pasted from this repository it sets `PRODUCT_NAME: "Collaborator"`, which wins
  over the new default, and his environments already have stored names. Neither changes on its own: he changes the
  variable in Container Station and renames any environment called Collaborator in Manage.
- Neither About nor the README credits Figtree or Fraunces. Worth fixing in step 4, as Thomas decides the licence (#72).
