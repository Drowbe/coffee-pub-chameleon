# Settings Reference

**Audience:** the person running the server, who wants to change a setting that is not in `docker-compose.yml`.

The compose file holds only the settings most servers must set. Everything here is optional: add a line under the
app's `environment:` (the `chameleon` service), recreate the container, and it takes effect. A setting left out uses
its default. The default is what the code uses today, checked against the server's source. To set up the server
first, see [Getting Started](userguide-getting-started.md). Put no real password or key in any file you share.

A number that is missing, not a number, or zero or less uses the default. Settings marked "in the file" are already in
the compose file.

## Environments and domains

| Setting | Default | What it does |
|---|---|---|
| `BASE_DOMAIN` | unset (one environment) | Several environments on one server, at `<slug>.<base domain>`. A commented example in the file. See [Getting Started](userguide-getting-started.md), "Environments: one server, several groups". |
| `PRODUCT_DOMAIN` | unset | Puts the start page and sign-up on a host of their own, so their name can change without touching any environment's address. A host name only: no `https://`, no port. It needs its own DNS record, an ordinary certificate and a proxy host to port 3000; the base domain keeps the wildcard. The console stays at `admin.<base domain>`. Ignored without `BASE_DOMAIN`. A commented example in the file. |
| `PRODUCT_SITE_URL` | unset; for example `https://www.example.com/collaborator` | The address of the product's page on your website. When it is set, the start page shows the studio's parts (the header's **Support** and **Find Out More**, **Request an Invite**, the **Ways to use** cards and the footer); every link is built from this address's origin. A full `http://` or `https://` address. Unset means no link. A value that is not a web address stops the start with one line naming it. Only for a server with `BASE_DOMAIN`. A commented example in the file. |
| `MIGRATE_ENVIRONMENT_SLUG` | unset | For one start only: the environment that the data already here becomes, when you turn a single-environment install into several. Remove it afterwards. |
| `PREVIOUS_BASE_DOMAINS` | empty | Old base domains whose links redirect to the new one while you move a server's addresses ("Moving a server's addresses" in the guide). |
| `RESERVED_SLUGS` | empty; for example `studio,shop` | Names no new environment may take, on top of the built-in list (`www`, `api`, `admin`, `mail`, `livekit` and others). Comma separated. An environment that already has one keeps working. |
| `TEMPLATE` | unset; for example `travel` | One environment set up for one use, from a template in `templates/`: its words, icons, modules and Lobby. Only on a fresh data folder, and only without `BASE_DOMAIN` (with it, the host console and sign-up pick a template for each new environment). Ignored, with a line in the log, on data that already exists. |
| `SIGNUP` | off | `on` turns on the server's sign-up route for a free environment. The start page has no sign-up form now, so nothing a person sees uses it yet. Needs `BASE_DOMAIN`. |
| `CONTACT_EMAIL` | unset | Where the sign-up answer sends someone to write when sign-up is off. A commented example in the file. |

## AI

Keys, providers and models are not set here. A host's keys are set on the host console's **AI** tab, and a single server's AI on the AI configuration page, so there is nothing to put in the file. The old variables (`AI_OPENAI_KEY`, `AI_ANTHROPIC_KEY`, `AI_ANTHROPIC_WORKSPACE`, `AI_KEY`, `TAVERN_AI_KEY`, `AI_PROVIDER`, `AI_ADDRESS` and `AI_MODEL`) are removed; if still set, they are ignored.

| Setting | Default | What it does |
|---|---|---|
| `AI_ALLOW_HTTP` | unset | With `BASE_DOMAIN`, the AI address an environment's owner types must be https and never a private, loopback or link-local address. `1` allows plain http. For a developer running the host on one machine only. |
| `AI_ALLOW_PRIVATE_ADDRESSES` | unset | The same guard: `1` allows private addresses. For a developer running the host on one machine only. |

## Sign-in and limits

| Setting | Default | What it does |
|---|---|---|
| `ENABLE_MFA` | `true` (in the file) | Whether the server offers two-step sign-in (a code from an authenticator app). Each environment's owner then chooses whether to require it, and each person chooses whether to use it. |
| `ADMIN_MFA_LOCKOUT_BYPASS` | `false` (in the file) | If an owner or admin is locked out: set `true`, recreate, sign in, reset the factor on the profile, then set it back to `false`. |
| `HOST_MFA_REQUIRED` | `false` | With environments: `true` makes two-step sign-in mandatory for every host admin. |
| `TRUST_PROXY_HOPS` | `1` | How many reverse proxies stand in front of the container (`1` is the Nginx Proxy Manager). Sign-in and guest limits count by the address the nearest proxy saw, so nobody can pick their own. Two in a row (say Cloudflare, then Nginx Proxy Manager): `2`. Reached directly with no proxy: `0`. A value that is not a whole number logs a line and uses `1`. |
| `REQUEST_BODY_SECONDS` | `300` | How long the body of any other request may take to arrive. Vault uploads are exempt. |
| `CLEAR_UNDO_SECONDS` | `30` | How long a Clear can be undone. A whole number from 1 to 600. |
| `PORT` | `3000` (in the file) | The port the app listens on. |

## Chat and streams

The defaults are usually right. A live stream is one per open browser tab: it carries who is here and the chat.

| Setting | Default | What it does |
|---|---|---|
| `LIVE_STREAMS_PER_PERSON` | `50` | Streams one signed-in person may hold open. |
| `LIVE_STREAMS_PER_GUEST_LINK` | `25` | Streams one guest link may hold open. One address gets 40% of it. |
| `GUEST_CHAT_POSTS_PER_MINUTE` | `20` | Messages one guest link may post a minute. One address gets half. |
| `CHAT_PICTURE_MAX_MB` | `3` | The most a picture in the chat may weigh. It is held in memory and never stored. |
| `CHAT_PICTURE_KEEP_MINUTES` | `15` | How long a chat picture is held for its readers to fetch. |
| `CHAT_PICTURE_SPACE_MB` | `30` | MB of chat pictures held per space. Past it, the oldest go. |
| `CHAT_PICTURE_ENVIRONMENT_MB` | `100` | The same, per environment. |
| `CHAT_PICTURE_SERVER_MB` | `200` | The same, for the whole server. |
| `CHAT_PICTURE_MB_PER_MINUTE` | `20` | MB of pictures one person, or one guest link, may send a minute. |
| `LIVE_STREAM_BUFFER_MB` | `8` | How far a reader may fall behind before its stream is dropped. It reconnects. |
| `PRESENCE_CHANGES_PER_MINUTE` | `60` | Times a minute one person may switch away, or onto the call, in a space. |
| `MAP_IMAGE_MAX_MB` | `100` | The most a picture-map file (an invented world, as PMTiles picture tiles) may weigh. |

Each held total is never below one picture of the largest size.

## Vault

The Vault's files live in their own folder, not in the data folder, so the in-app backups stay small. Back that
folder up with the data folder: a restore of the data without it shows those files as "File missing". These limits are
the server's defaults; an owner may set lower ones. See [Vault](userguide-vault.md).

| Setting | Default | What it does |
|---|---|---|
| `VAULT_DIR` | `/app/vault` (in the file, with its own volume line) | The folder that holds the Vault's files. Without it the files go in a `vault` folder inside the data folder. |
| `VAULT_MAX_GB` | `20` | The most the whole folder may hold. |
| `VAULT_SPACE_MAX_GB` | `5` | The most one space may hold. |
| `VAULT_PERSON_MAX_GB` | `2` | The most one person may have added across an environment. |
| `VAULT_MB_PER_MINUTE` | `500` | MB one person may send a minute. |
| `VAULT_MIN_KB_PER_SECOND` | `16` | The slowest an upload may arrive, after its first minute. |
| `VAULT_SLOW_CUTOFFS` | `3` | How many slow cut-offs, within `VAULT_SLOW_MINUTES`, make a person's new uploads wait. |
| `VAULT_SLOW_MINUTES` | `10` | The window for the count above. |
| `VAULT_SCAN_SECONDS` | `5` | The most the check of one file may take. |
| `VAULT_SWEEP_SECONDS` | `10` | The most the tidy-up on start may take (bytes with no record, leftovers). |

## Other

`SHARE_UNLOCKS_PER_MINUTE` (default `60`) caps how many share-link password checks an environment does a minute. It is
described in [Getting Started](userguide-getting-started.md), "Environments: one server, several groups".
