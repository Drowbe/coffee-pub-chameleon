# Getting Started

**Audience:** someone setting up a Coffee Pub Chameleon server for the first time and signing in as its
admin.

Chameleon is a web app, plus a LiveKit media server if you want voice and video. The app is all you
need for spaces, chat, who is here and the modules; LiveKit is the part you add for the call. Without it the server
starts and says "No LiveKit: voice and video are off." in its log, and the call, the Conference and asides are left out
of every space. This guide sets both up on a QNAP NAS with Container Station and Nginx Proxy Manager, then
signs in. Any machine that runs Docker works the same way; only the router and proxy steps differ.

## Set it up

Everything the NAS needs is in `docker-compose.yml`, which you paste into Container Station. The app
image is built by GitHub and pulled from `ghcr.io/drowbe/coffee-pub-collaborator`.

1. **Make the secrets** in Terminal on your Mac and keep them in a note. The first two are for video only:
   ```bash
   openssl rand -hex 8    # LiveKit API key
   openssl rand -hex 32   # LiveKit API secret
   openssl rand -hex 8    # the server admin's password
   ```
2. **DNS.** Add a record at your DNS provider pointing at your public IP, the same address your
   Foundry hostname uses: `collaborator.<domain>`, and for video `livekit.<domain>` too. If the provider offers proxying
   (Cloudflare's orange cloud), turn it off for these: media has to reach the NAS directly.
3. **Router.** For video, forward to the NAS's LAN address: `7881` TCP, `7882` UDP, `3478` UDP. Ports 80 and 443
   already reach Nginx Proxy Manager.
4. **Container Station.** Applications, Create, give it the name `collaborator`, paste the contents of
   `docker-compose.yml`, replace the `CHANGE_ME` values (domain, API key, API secret, the
   admin's login and password), and click Create. Both containers should show green within a minute. To run without
   video, delete the `livekit` service and the three `LIVEKIT_` lines of `collaborator` first (and the API key and
   secret are not needed); add them later and recreate the app to turn video on.
5. **Nginx Proxy Manager.** A proxy host for each address, each with a Let's Encrypt certificate and Force SSL:
   - For video, `livekit.<domain>` to scheme http, forward host = NAS LAN address, port `7880`, **Websockets
     Support on**.
   - `collaborator.<domain>` to scheme http, NAS LAN address, port `3000`.

**Two folders to keep.** The compose file mounts two volumes for the app: the data folder (`/app/data`: users, settings, pictures and module data) and a second one for the Vault's files (`/app/vault`, named by `VAULT_DIR`; the example is `/share/appdata/coffee-pub-collaborator-vault`). The files are big, so they are kept apart and the in-app backups do not carry them. Back up both folders together, and keep the Vault's volume when you move or recreate the container. If you leave the second volume line out, Docker makes an anonymous volume for it from the image's `VOLUME` line, which is easy to lose track of when you recreate the container. The Vault's limits are commented examples in the compose file ([Vault](userguide-vault.md), "Notes for the person running the server").

**Space on the NAS.** The image needs several GB free. If creating the container fails with "no space left on device", clear unused images and stopped containers in Container Station, then create it again. If the NAS keeps an old copy of `:latest`, it may start the old version. Pin an exact tag, such as `:sha-` followed by the first 7 characters of the commit, or remove the old image before you create the container.

Camera access requires HTTPS, which the proxy provides. Players need nothing but a browser. LiveKit
1.12 or newer is required; the compose file pulls the latest release. With no LiveKit, **Manage** > **Modules** shows
"Voice and video are not set up on this server" on the Conference card, with its switch off.

## Sign in as the admin

The compose file holds one account, the server's **admin**: `ADMIN_LOGIN` and `ADMIN_PASSWORD`. Open
`https://collaborator.<domain>/`, sign in with them, and choose **Manage** in the menu under your picture, at the right of the top bar. Add your
players under **Users** and send each of them a login and password, or a personal link; see
[Accounts, roles and permissions](userguide-accounts.md). If someone else will run the server day to day, make
them an **Owner** there; owners are made in Manage, never in the compose file, and a server doesn't need one.

The admin is checked on every start: it is made if it is missing, and its password is reset to the compose value
when it differs. If you forget the password, change `ADMIN_PASSWORD` in Container Station and restart the
container. Its profile shows "Admin: runs this server". Nobody can change its role, login, password, personal
link or two-step sign-in from Manage, or delete it; the compose file (and, for two-step sign-in, the lockout
bypass below) is how it gets back in.

Without `ADMIN_PASSWORD`, a brand-new server makes an admin called `admin` (or `ADMIN_LOGIN`) with a random
password and prints it in the log once. A server that already has accounts makes nothing and changes nobody;
the log says "This install has no server admin. Set ADMIN_LOGIN and ADMIN_PASSWORD, then restart, to have one."

**Older names.** `ADMIN_USER` and `TAVERN_ADMIN_USER` are no longer read, from version 0.4.0: if your compose
file still sets one, the admin's login is `admin` until you set `ADMIN_LOGIN`, and the log says "ADMIN_USER is no
longer read: use ADMIN_LOGIN instead." on every start. `TAVERN_ADMIN_PASSWORD`, `TAVERN_ADMIN_KEY` and
`ADMIN_KEY` are no longer read either, and the log says "TAVERN_ADMIN_PASSWORD is no longer read: use
ADMIN_PASSWORD instead." (with the name you set). **Move the value to `ADMIN_PASSWORD` before you update:** if
one of these was your only password setting, a new server makes a random admin password instead, and a server
that already has accounts makes no admin at all. `TAVERN_REVISION` is no longer read either: the image sets
`APP_REVISION` to the commit it was built from, which the version line shows, so you only need to change something
if you set `TAVERN_REVISION` yourself; set `APP_REVISION` instead.
`OWNER_PASSWORD`, from the previous version, is ignored: "OWNER_PASSWORD is ignored: owners are made in Manage.
Use ADMIN_PASSWORD for the server's admin." If you set it in that version, put the same login and password in
`ADMIN_LOGIN` and `ADMIN_PASSWORD`, and that account becomes the admin again on the next start; without them,
the owners run the server and there is no admin.

**A template (optional).** To set the server up for one use from the start, such as planning trips, add
`TEMPLATE: "travel"` to the compose file before the first start. It is read only when the data folder is new; see
[Templates](userguide-templates.md).

## Your first look

After you sign in you are on Home. Wider than 1200 pixels it has three columns: the environment's **Chat** on the left,
the **Spaces** in the middle (with **Who's around** above them), and the **Modules** on the right. Owners and the admin
also have **Add space** there, the dashed card at the end of the spaces, which makes a space and opens it with **Set up** so it can be named at once. See
[Spaces](userguide-spaces.md), "Home".

Press **Enter** on a space. You are in the space, not yet on the call:

- The **top bar** names the space, with an arrow to switch to another. Next to it are the layout tabs (**Workspace**,
  **Calendar**, **Map**, and any layouts you favorite), who is here, then **Layout**, the bell, your picture, **Set up**,
  **Full screen** and **Pop out**.
- Under the bar, a thin **status strip** shows the phase the space is in, if the environment has phases.
- Down the left, the **column** holds the chat and, once you join, the call. Press **Start call**, at the right end
  of the **Discussion | Assistant** row, when you are ready (it reads **Join call** when a call is already running);
  your browser asks for the microphone then.
- Everything else is the **Workspace**, where modules open.

To set the space up, press **Set up** in the top bar. See [Spaces](userguide-spaces.md), "The top bar", "The status
strip" and "Set up", and [The call](userguide-call.md), "The column: the call and the chat, always on".

## Try it with demo data

The image includes a demo seeder. It fills a space with invented data so you can see every module at work.
Use it on a throwaway, test or demo environment. Do not run it on an environment that holds real data (see
the warnings below).

1. Single environment: run this on the NAS, or wherever Docker runs. It uses the container's own admin
   login and talks to the app at `http://localhost:3000` inside the container.

   ```
   docker exec -it collaborator-app npm run seed:demo
   ```

2. A hosted environment (a server with a base domain): the seeder refuses unless you say which environment
   it may change. Pass an owner of that environment, not the host admin, and use a throwaway owner: a
   password on a command line shows in shell history and in process lists.

   ```
   docker exec -it -e SEED_URL=https://<slug>.<base domain> -e DEMO_ALLOW_HOSTED=1 \
     -e DEMO_ENVIRONMENT=<slug> -e ADMIN_LOGIN=<an owner of that environment> \
     -e ADMIN_PASSWORD=<that owner's password> collaborator-app node tools/seed-demo.mjs
   ```

   The public address must be reachable from inside the container. A hosted run makes no map file.
3. Optional settings, added with `-e` before the container name: `SEED_NO_AI=1` skips the two `/ai`
   exchanges otherwise made when an AI service is set up; `SEED_MAP=0` skips the map file;
   `SEED_SEARCH_URL` swaps the place search service.

What it creates:

- One space, **Demo: Portugal**, a trip that starts about 45 days from the day you run it. Every date is
  worked out from today.
- Data in every module: Planner 76 objects, Places 37, Calendar 77 events, To-do 16, Polls 3, Budget 18,
  Research 4 and Chat 25 messages. It is invented; links go to `example.com`.
- Three invented demo people, `mia` (a moderator), `lee` and `sam`, and a guest link.

What it changes in the environment itself: it installs and turns on every bundled module, turns on the
calendar and map options, sets the place search to the public Photon service, and switches an environment
that has no template to travel.

To reset, run the same command again. It resets only the demo space (found by its name and a marker in its
description) and the three demo people. It refuses to touch a space or an account that only has the same
name.

Warnings:

- It is not for an environment with real data, because of the settings it changes. An "Add a demo space"
  feature that leaves environment settings alone is planned (GitHub #416).
- It prints the three demo people's one-time passwords at the end, new on each run. Anyone who can see the
  terminal or the container logs can read them. It never prints the admin password.
- It needs the network. The map is a file of about 5 MB made with range requests to `build.protomaps.com`,
  saved as `demo-portugal.pmtiles` in the data folder's `modules/maps/map-tiles/`. It is skipped when
  hosted or offline. Place search uses Photon.

## Update it later

An install made before the product's rename keeps its old names: the containers `tavern-app` /
`magpie-app` and `tavern-livekit` / `magpie-livekit`, and the data paths `/share/appdata/tavern` or
`/share/appdata/magpie`, all still work if the compose volume still points at that folder. The
`TAVERN_ADMIN_*` variables do not: see **Older names** above.
Do not change the volume path until you have moved the folder: the data lives there.

In Container Station, pull the new image for the `collaborator` application
(`ghcr.io/drowbe/coffee-pub-collaborator`) and recreate it. Users, images and settings live in the
folder the volume names (`/share/appdata/coffee-pub-collaborator` on a new install).

Take a copy of that data folder, and of the Vault's folder (`/app/vault`), before you update. An update can bring the data up to date for the
new version, and an older version then refuses to open it rather than misread it: going back to an older
image means putting back that copy as well.

## Environments: one server, several groups

One server can serve several groups, each with its own address, people, spaces, settings and modules: an
**environment**. A group's environment is `<slug>.<base domain>`, and the whole server is run from a
host console at `admin.<base domain>`. With no base domain set, the server is one environment at whatever
address it has, which is everything above; nothing here is needed for that.

To switch environments on, with the server already running as above:

1. **DNS.** Add a wildcard record at your DNS provider, so every subdomain of the base resolves to the same
   place: host `*.<base>` (relative to your domain, the way the provider shows your other records), a CNAME
   to the base hostname. Check with `dig +short admin.<base>`: it should end in the same address as the base.
2. **The proxy host.** Edit the proxy host for the base hostname: add `*.<base>` as a second domain name
   and request a new Let's Encrypt certificate covering both. A wildcard certificate needs the **DNS
   challenge**: turn it on, pick your DNS provider from the list, and give it the API credentials it asks for
   (your provider may need API access enabled and the server's public IP whitelisted first). If your provider
   is not in the list, name each environment explicitly on the certificate instead (`admin.<base>`,
   `<slug>.<base>`, one per environment) with the ordinary challenge, and add a name whenever you create one.
   Force SSL and HTTP/2 as before.
3. **The container, for one start.** Take a copy of the data folder first. Keep `ADMIN_LOGIN` and
   `ADMIN_PASSWORD`: with a base domain they are the **host admin**, who signs in to the host console. Add:
   ```yaml
   BASE_DOMAIN: "collaborator.example.com"
   MIGRATE_ENVIRONMENT_SLUG: "main" # what your existing server becomes; used once
   ```
   Recreate the container. On that start the existing data moves into `environments/<slug>/` on the same
   volume and the environment is recorded; everyone's accounts, spaces and layouts come with it, at
   `https://<slug>.<base>`, and the install's admin becomes that environment's owner. The host admin's
   password is reset to `ADMIN_PASSWORD` on every start; other host admins are left alone. The old names
   `HOST_ADMIN_LOGIN`, `HOST_ADMIN_PASSWORD` and `MIGRATE_TENANT_SLUG` are no longer read, from version 0.4.0,
   and the log names the one to use instead. A server that still sets only `HOST_ADMIN_*` keeps its existing
   host admins, but no host admin is created or has its password reset until you set `ADMIN_LOGIN` and
   `ADMIN_PASSWORD`. `MIGRATE_TENANT_SLUG` moves nothing: use `MIGRATE_ENVIRONMENT_SLUG`.

**Behind a proxy, and the limits.** `TRUST_PROXY_HOPS` says how many reverse proxies stand in front of the container.
It defaults to `1`, the Nginx Proxy Manager in the compose file. Sign-in and guest limits count by the address the
nearest proxy saw, so nobody can choose their own with a made-up header. Two in a row (say Cloudflare, then Nginx Proxy
Manager) is `2`; reached directly with no proxy, `0`. A value that is not a whole number logs a line and uses `1`. If
the count is wrong, every visitor can look like the proxy's own address and share one limit. The Vault's public share links depend on it most: their limit on wrong passwords counts by this address, so set it to the real number of proxies, and to `0` when the container is exposed directly. `SHARE_UNLOCKS_PER_MINUTE` (60) caps how many password checks the environment does a minute. Four more switches are in
the compose file, commented, and the defaults are usually right: `LIVE_STREAMS_PER_PERSON` (50, the live streams
one signed-in person may hold open, about one a browser tab), `LIVE_STREAMS_PER_GUEST_LINK` (25, for one guest link in
all; one address gets 40% of it) and `GUEST_CHAT_POSTS_PER_MINUTE` (20, the messages one guest link may post a minute;
one address gets half). The first two were `CHAT_STREAMS_PER_PERSON` and `CHAT_STREAMS_PER_GUEST_LINK`; the old names
are no longer read. `CHAT_PICTURE_MAX_MB` (3) is the most one picture in the chat may weigh, and
`CHAT_PICTURE_MB_PER_MINUTE` (20) the most one person, or one guest link, may send a minute; pictures are not stored on disk: the server holds each in memory for `CHAT_PICTURE_KEEP_MINUTES` (15) and every
reader fetches it, and `CHAT_PICTURE_SPACE_MB` (30), `CHAT_PICTURE_ENVIRONMENT_MB` (100) and `CHAT_PICTURE_SERVER_MB` (200)
limit what is held, the oldest going first. `LIVE_STREAM_BUFFER_MB` (8) is how far a page may fall behind on a live stream before the server drops
it (the page reconnects), and `PRESENCE_CHANGES_PER_MINUTE` (60) how often one person may switch away or on the call
in one space a minute.

**Two-step sign-in, and getting back in.** Three switches, one inside the other. `ENABLE_MFA` (in the
compose file, `"true"` by default) says whether the server offers a second step at all; with it off nobody is
asked and nobody can set one up. When it is offered, each environment's owners choose on Manage > Environment
whether to **require** it of everyone, and otherwise each person chooses on their own profile. Host admins
set theirs up on the console's Host tab, and `HOST_MFA_REQUIRED: "true"` makes it mandatory for them. The
secrets are encrypted with a key the server makes on first start (`secrets.key` beside the data on a single
server, inside `host.json` with environments), so an environment's export carries nothing readable. If an
owner or the admin is locked out, set `ADMIN_MFA_LOCKOUT_BYPASS: "true"` and recreate the container: owners,
the server's admin and host admins are then signed in on the password alone (members are still asked), their profile offers **Reset my
second factor** with the password, and Manage and the console show a banner until you set it back to
`"false"`. Nothing is deleted by either switch.

**Plans, sign-up and billing.** The host console's **Plans** panel is the catalog: `free` (what sign-up
makes, and what a lapsed environment goes back to) and any named plans, each with its caps (members,
storage, assistant calls a month, calls at once, modules). An environment is put on a plan from its card,
which fills its caps from the catalog to adjust on its own. The product page at the base domain lists the
plans and, only when the server has `SIGNUP: "on"`, makes a free environment for anyone who asks (an
address, a name, an owner account); without it the page offers no sign-up form, just the plans and a way to
write to you. Selling a plan is the payment provider's own hosted page: set `BILLING_CHECKOUT_<PLAN>`
(the plan id in capitals, `BILLING_CHECKOUT_STANDARD`, say) to that page's address, and the product page's
plan buttons and an owner's Upgrade go there with `?environment=<slug>`. The provider tells the server
what happened through the webhook at `https://admin.<base>/api/host/billing`: a JSON body
`{ "slug", "plan", "event" }` with `event` one of `paid`, `lapsed` and `cancelled`, signed with
`BILLING_SECRET` as an `x-billing-signature` header (HMAC-SHA256 of the raw body, in hex). A provider's
own webhook shape is adapted to that outside the app, by a small relay, which is what keeps every
provider's card handling out of it. A lapsed environment is past due for fourteen days, with a banner
for its owners, then goes to the free plan's caps; nothing is ever deleted by billing. An owner can
download a copy of their environment and ask for its deletion from Manage; a host admin carries the
deletion out from the console.
4. **Then** remove `MIGRATE_ENVIRONMENT_SLUG`, keep the rest, and recreate again. It was read once.

A server that already had environments before this version renames its folders on its first start:
`tenants/` becomes `environments/` and `tenants-deleted/` becomes `environments-deleted/`. Nothing else
changes, the change is noted in `host.json`, and a copy of `host.json` as it was is kept in
`pre-names-host/`. From version 0.4.0 these copies (the host's `pre-names-host/` and each environment's
`pre-names/`) are deleted on the start after the one that made them; take your own copy of the data first if
you want to keep one. If the start stops with a line saying `host.json` lists environments
under both "tenants" and "environments", open `host.json`, remove whichever list is out of date, and start again.

**The product page on another domain (optional).** By default the product page, the use pages and sign-up
are on the bare `https://<base>`, with the console at `admin.<base>` and each environment at `<slug>.<base>`.
That is the layout above, and it needs nothing more. If you would rather have the product page on a separate
host, so that its name can change without touching any environment's address, give it its own domain with
`PRODUCT_DOMAIN`. Say `<base>` is `example.live` and the product page is to be at `product.example.com`:

1. **DNS.** Add a record for the product host, `product.example.com`, to the same public address as your
   proxy. Leave the base domain's records as they are: the apex (an `A` record) and the wildcard `*`.
2. **The certificate and proxy host.** The product host needs an ordinary certificate (no wildcard, no DNS
   challenge) and a proxy host of its own, scheme http, to the same address and port `3000` as the base. The
   base domain's wildcard certificate and proxy host keep serving every environment, `admin.<base>` and the
   bare `<base>`.
3. **The container.** Add, then recreate it:
   ```yaml
   BASE_DOMAIN: "example.live"
   PRODUCT_DOMAIN: "product.example.com"
   ```
   `PRODUCT_DOMAIN` is a host name only: no `https://`, no port, no path. Unset, or equal to `BASE_DOMAIN`, the
   product page stays on the bare base. It is ignored, with a line in the log, when `BASE_DOMAIN` is not set.

What changes:

- The bare `https://<base>` sends visitors on to the same path at the product host (a redirect that keeps the
  path and the query), so a base address typed by hand still works. The console stays at `admin.<base>`;
  there is no setting to move it.
- Sign-up and **Sign in** on the product page work across the two sites. After sign-up the person arrives at the
  new environment's sign-in with their login already filled in; they enter the password.
- The product page cannot offer the "Sign in to ..." shortcut for the environment this browser was last in,
  because that is remembered for the base domain only. The environment list and the sign-in form are there.
- An owner's **Upgrade** link on Manage and the console's own facts name the product host.
- LiveKit is unchanged. `LIVEKIT_HOST` is its own setting, and its DNS record, certificate, proxy host and the
  TURN domain stay where they are.
- If the product host sits directly under the base (`www.<base>`), its first label is reserved for it, and the
  server will not start if an environment already has that name.

**Names an environment cannot take.** A built-in list is always reserved: `www`, `api`, `host`, `admin`, `mail`,
`smtp`, `imap`, `pop`, `pop3`, `ftp`, `ns1`, `ns2`, `static`, `cdn`, `assets`, `app`, `status`, `support`, `help`,
`blog`, `docs`, `livekit`, `turn`, `stun`, `console`, `signup` and `login`. `PRODUCT_DOMAIN`'s first label and
`LIVEKIT_HOST`'s first label are added when each sits directly under the base. To protect names of your own (other
sites on the same domain, say), list them in `RESERVED_SLUGS`, comma separated; it adds to the built-in list and
never replaces it:

```yaml
RESERVED_SLUGS: "studio,shop"
```

A reserved name is refused where an environment is made (the console's create form, sign-up and
`MIGRATE_ENVIRONMENT_SLUG`) with "<name> is reserved. Pick another." and the sign-up form says so as the name is
typed. An environment that already has a name you reserve later keeps working; the log says once on each start
that the name is now reserved. Without `BASE_DOMAIN`, both settings are ignored.

**Moving a server's addresses.** To move a running server to new domains: take a copy of the data folder; add the
DNS records, certificates and proxy hosts for the new domains while the old ones still work; set the new
`BASE_DOMAIN` (and `PRODUCT_DOMAIN` if you want one), put the old base in `PREVIOUS_BASE_DOMAINS` and recreate
the container; then check that an environment signs in, `admin.<base>` shows the console, the product page opens
and an old link redirects. Nothing stored holds a domain, so no data changes. Keep the old wildcard certificate
and proxy host while `PREVIOUS_BASE_DOMAINS` is set, and remove all three together when nobody uses the old
addresses (OBS browser sources and calendar feeds follow the redirect, so re-adding them once is the way to be
rid of it sooner). A host listed in `PREVIOUS_BASE_DOMAINS` that is also the product host is not redirected.

From there: `https://admin.<base>` is the host console (create an environment with its first owner, set its
plan, back it up and restore it, suspend it and **Resume** it, or delete it aside, which keeps its data under
`environments-deleted/`), `https://<slug>.<base>` each environment, and the bare
`https://<base>` the product page (at `PRODUCT_DOMAIN` when you set one). Two optional variables feed that page: `PRODUCT_NAME` (the full name it shows;
the default is "Coffee Pub Chameleon", and Chameleon is used where the short form fits; a name such as "Travel Pub" shows
that name everywhere. Environments that already have a name keep it. If your compose file still says
`PRODUCT_NAME: "Collaborator"`, change it to the new name, because it overrides the default) and `CONTACT_EMAIL` (where "ask for an environment" writes to). If the base
domain ever changes, set the new one as `BASE_DOMAIN` and list the old one in `PREVIOUS_BASE_DOMAINS`;
every old address redirects to the new.

Once a server has environments, keep `BASE_DOMAIN` set on every start, and set it on any server you move the
data folder to. A start without it stops with "This data folder belongs to a server with environments: set
BASE_DOMAIN." and changes nothing: set it and start again.

## Back up and restore an environment

A host admin does this from the host console's **Environments** tab. Each environment's card has
**Backup** and **Restore backup**.

To back one up, click **Backup** on its card. The browser saves the whole environment as a zip named
`<slug>-<date>.zip`: every setting, account, space, picture and module's data. It does not carry the Vault's files (their records are in the zip, their content is not): back up the Vault's folder with the data folder, and a restore without it shows those files as **File missing** until someone removes them. The flight schedule the
Planner's lookup learns is the host's, shared by every environment, so it is not in the zip; it lives in
`flight-schedule.json` beside `host.json`, and the console's **Host** tab can forget a flight or clear it
(see "The flight schedule" in [Modules](userguide-modules.md)).

To restore one from a backup:

1. Click **Restore backup** on the environment's card, and choose the zip.
2. The button now reads **Replace its data?**. Click it again within eight seconds to go ahead; after that
   it goes back to **Restore backup** and nothing happens.
3. Everything in that environment is replaced by what is in the zip. The message beside the **Environments** heading says
   "<slug> was restored from <file>." when it worked, or "<slug> was not restored:" and the reason when it
   did not, in which case nothing was changed.

A backup made by a newer version of Chameleon than the one running is refused ("This backup is from a newer
version of Coffee Pub Chameleon."), and the environment is left as it was.

## An environment that won't open

An environment's card can carry the tag **won't open**, with a red edge and a dash for every count. Its
people see a page saying the environment's data is from a newer version of Chameleon, or could not be updated;
every other environment keeps working. The card says which, and names the file and when it happened:

- **Won't open: its data is from a newer version of Chameleon.** A newer version of Chameleon has run on this
  environment's data, and this one cannot read it. Run the newer version again, or restore a backup made
  before it.
- **Won't open: its data could not be updated.** The data could not be brought up to date on this start.
  Restore a good backup. The server's log has the details.

After a restore the environment opens straight away, with no restart. If the restored data won't open
either, the message says "<slug> was restored, but still won't open", and an older backup is the next thing
to try.

A server with no base domain is one environment, and has no console: if its data is from a newer version,
the server does not start, and its log says so and names the file. Run the newer version again, or put back
the copy of the data folder you took before the update.

## Run it on another machine

The app itself has nothing that is specific to a NAS. To run both services on a Windows or Mac
computer, use the same `docker-compose.yml` under Docker Desktop, forward the same ports on your
router, and point the two hostnames at your public address.

Moving a server with environments: copy the whole data folder and the Vault's folder, set the same `BASE_DOMAIN` (and the DNS and
certificate from "Environments: one server, several groups"), then start it. Without `BASE_DOMAIN` it will not
start; see above.
