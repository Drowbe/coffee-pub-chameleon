# Rename to Chameleon Plan

**Audience:** Thomas, who decides the name, the look and what is renamed; server-development, experience-design and
content-manager, who build it; quality-assurance, who checks it.

**Status:** drafted 2026-11-07, waiting on Thomas's answers to the questions under "Decisions for Thomas". Thomas,
2026-11-07: the product is "Coffee Pub Chameleon" ("all of the software start with Coffee Pub... because all other
names are trademarked, have domains, etc."), "but we will likely refer to it as Chameleon in product". He approved
writing a rename plan, and hoped the name "was a variable in our code, it was supposed to be".

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

## Decisions for Thomas

Each with a suggested answer, marked as a suggestion.

**(a) Which name is the variable.** One variable either way; the other form is derived.
- A. `PRODUCT_NAME` is **Chameleon**; formal places write the brand before it ("Coffee Pub Chameleon"). Short name in
  the top bar, tab, installed app (fits 12 characters) and sentences; full name on About, the product pages' header,
  the host console, the authenticator issuer, README and the licence. The lockup is natural: "Coffee Pub" in Fraunces,
  then the name in Figtree. The existing allow-list entry for the default fits a one-word name as it is.
- B. `PRODUCT_NAME` is **Coffee Pub Chameleon** and the short form drops a leading "Coffee Pub ". Works, but every short
  use strips text, the default no longer fits its allow-list entry, and the user-agent becomes `Coffee-Pub-Chameleon`.
- *Suggestion: A.* The brand may appear as fixed text (CLAUDE.md, Names), and About already prints "A Coffee Pub
  product". A second variable is not needed. Ask: should an install that sets its own `PRODUCT_NAME` still get
  "Coffee Pub" before it in the formal places? The suggestion is yes.

**(b) Logo, icons and fonts.**
- Default site icon and favicon, sign-in page icon, installed-app icon: the Chameleon mark, full colour. The mark
  works on both modes; the `-dark` variant only on a navy ground. An environment's own uploaded icon still wins.
- Product pages and the host console's bar: the lockup, built as the mark plus live text (so it follows
  `PRODUCT_NAME`), light and dark from the kit's colours (name coral `#E0553C` on light, 24 px and up only; `#FF8264` on dark).
- About: the mark beside the name. OBS views: nothing.
- Fonts: the UI fonts do not change; Fraunces 700 is used only in the lockup.
- Files are named by kind (`mark.svg`, `mark-dark.svg`, `icon-192.png`), not after the product, or `check-names`
  fails on them.
- *Suggestion: all of the above, and remove the old Coffee Pub brandmark and logos.*

**(c) Do the brand colours replace the three theme accents, or sit beside them?** (Thomas's question.) The themes
colour the whole app: page, panels, text, buttons. The brand palette (navy `#14243B`, teal `#0B7A84`, coral `#F26B52`,
cream `#FBF6EC`, dark ground `#0E1A2B`) is the product's identity.
1. **Beside them, in the brand only.** The themes stay as they are; the brand colours appear in the mark, the
   lockup and the product pages' own palette. No theme check changes.
2. **A fourth theme, "Chameleon".** Seeded as a built-in like Calming Teal, chosen by a template or an owner. It must
   pass the surface-steps check (deltaE 2000 of at least 2.0 between the five module surfaces, both modes) and the
   contrast check. Coral can't be the button colour: white on coral is 3.0:1. Teal can be (5.1:1 on white; light teal
   `#5CC8CF` on the dark ground is 8.8:1), with coral as an accent mark. Making it the default for every new
   environment means replacing Strong Coffee as `DEFAULT_THEME` and `style.css`'s palette, a much larger change.
3. **Replace the accents.** The three themes would lose what they are named for (teal, orange, coffee), all three
   would need approving again on the Prototype, and coral fails as a button colour.
- *Suggestion: 1 now.* The product changes colour with whoever runs it, which is what the name says; the mark is the
  fixed part. Option 2 can follow as its own slice once Thomas has seen the mark on the Prototype.

**(d) Renaming the repository, image, containers and data folders.**
- *Suggestion: not now; a later slice of its own, decided name by name.* The repository can be renamed any time
  (GitHub redirects it). The image name is what matters to Thomas's NAS: if it changes, his compose's `image:` line
  must change the same day, or the NAS quietly stays on the old build. The data folders and container names should
  stay on existing installs. No compatibility layer is needed either way (not released). Ask: rename the image, and
  when?

**(e) Words in documents.** content-manager replaces "Collaborator" with "Chameleon" in sentences (the full name in the
README's title and licence, and `home.md`), and "Coffee Pub Studio" meaning the OBS app with "Coffee Pub Showrunner".
CHANGELOG past entries stay as written; a new entry says the product was renamed. Plans are records and keep their
words. *Suggestion: as written.* Thomas (or the project manager) edits `CLAUDE.md` and `.claude/`; the lines are:
- `CLAUDE.md` line 1: `# Collaborator` becomes `# Chameleon`.
- `CLAUDE.md` line 4: "The repository is `coffee-pub-collaborator`; the product is **Collaborator**." becomes "The
  repository is `coffee-pub-collaborator`; the product is **Coffee Pub Chameleon**, called Chameleon in the product."
- `.claude/agents/*.md` (7 files) and `.claude/skills/manage`, `plan-feature`: "Collaborator" becomes "Chameleon";
  `content-manager.md` line 36 says the product's name in anything a person reads is Chameleon.

**(f) The check.** Add `collaborator` to `PAST_PRODUCT_NAMES` in `tools/check-names.mjs`, beside magpie and tavern, so
the old name can't creep back. The fixtures, the past fence label and the repository address are already exempt; the
three test sentences in `check-names.mjs` and the legacy inventory word need rewording or an entry with a reason.
*Suggestion: yes.*

**(g) Coffee Pub Showrunner.** Out of scope, except its name: the words a person reads that say "Coffee Pub Studio"
or "the Studio app" become "Coffee Pub Showrunner" and "Showrunner": `public/admin.html` (four lines),
`public/admin.js` (one), the Stream module (`stream.html`, `stream.js`, `CONTRACT.md`, with a version bump). Code
comments that say Studio change when those files are next touched. *Suggestion: as written.*

## The contract

**Server.** `DEFAULT_PRODUCT_NAME` is the decided name. If (a) is A, the server derives the full name as "Coffee Pub "
plus `productName()`, used for the authenticator issuer and answered as `fullName` beside `name` by `/api/product` and
beside `productName` by `/api/branding`. `/manifest.webmanifest` lists the new icons (192, 512, and an SVG).
`docker-compose.yml`: `PRODUCT_NAME` and the header comment take the new name; nothing else in it changes before (d).

**Pages.** The short name everywhere it shows today; the full name in the formal places listed in (a). The lockup is the
mark (SVG) plus "Coffee Pub" in Fraunces 700 and the name in Figtree 600, the same size, on one line, the mark 56 units
tall for 32 px text and 12 units from it, coloured as the kit says for light and dark.

## Left to build, in order

1. **The name (try build, today).** server-development: the default name, the compose file's `PRODUCT_NAME` and
   comment, `module.json`'s `title`, `collaborator` added to the check's past names with its rewording.
   content-manager: README, `home.md`, the architecture, API, design-system and user-guide sentences, a CHANGELOG
   line. No visuals. Needs (a) and (f).
2. **Showrunner's name.** experience-design: the sentences in `admin.html` and `admin.js`, and the Stream module's bump; content-manager:
   the documents. Needs (g).
3. **The mark.** experience-design: the mark and icons under kind names, favicon, site icon, manifest, host console,
   About, and the product pages' lockup with live text, light and dark; shown first on the Prototype for Thomas.
   server-development: `fullName` and the manifest. Needs (b).
4. **A Chameleon theme**, only if (c) is 2: experience-design, its own plan step after Thomas sees step 3.
5. **The repository and image**, only if (d) says so: server-development, with Thomas changing his NAS compose the
   same day.

QA after each step except the first, which is a try build.

## Verify

- Step 1: `npm run check` (by tool; as root, the two known `--migration` cases of `check-names` fail and are not a
  defect); a local server with `PRODUCT_NAME` unset shows Chameleon in the tab, the top bar and the sign-in page, and a
  theme file refusal names it (live, in a browser); `grep -ri collaborator` leaves only the listed exempt names.
- Step 2: the Manage page and the Stream module read "Showrunner" (live).
- Step 3: favicon, installed-app icon and lockup in light and dark (live, in a browser); the manifest's icons (curl).
  The installed app on a phone needs a real device.
- Nothing here needs a LiveKit call.

## What is not decided

- (a) to (g) above. Step 1 is blocked by (a) and (f); step 3 by (b); steps 4 and 5 by (c) and (d).
- Thomas's own NAS: if his compose was pasted from this repository it sets `PRODUCT_NAME: "Collaborator"`, which wins
  over the new default, and his environments already have stored names. Neither changes on its own: he changes the
  variable in Container Station and renames any environment called Collaborator in Manage.
- About says "Released under the MIT license" while the README says proprietary; and neither credits Figtree or
  Fraunces. Both are worth fixing in step 3, as Thomas decides the licence (#72).
