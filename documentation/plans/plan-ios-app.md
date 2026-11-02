# iOS App Plan

**Audience:** Thomas, who decides whether there is a native iOS app at all, what it is (a shell around the pages, a
shell with a native call, or a native client), how one App Store app reaches every self-hosted install, who sends its
notifications, and who builds and keeps it; and the sessions that would build it: a builder for the Swift side (not one
of today's agents; question 6), server-development (`server/index.js` for the new routes, the checks in `tools/`, the
macOS workflow in `.github/workflows/`), experience-design (the pages' side of the bridge, "Open in the app", the
report and account pages), quality-assurance (each step, on a simulator in CI and on Thomas's iPhone), content-manager
(the architecture document, the user guides, the privacy policy's text, the changelog).

**Status:** draft, 2026-10-31, by product-planner. Proposes; Thomas decides. Nothing built, nothing decided. From
Thomas, 2026-10-31, as relayed by the project manager: "we need to start planning the native iOS app." Thomas writes
JavaScript, HTML, Handlebars, CSS and JSON, not Swift. This plan builds on [plan-phone-experience](plan-phone-experience.md)
(its audit of 2026-10-31, its definitions, its navigation model, installability, notifications, offline and its
real-device test plan) and does not repeat it: everything that plan makes better in the pages is better in an app that
shows the pages too.

**How to read the claims.** Each statement about the world is tagged:

- **[repo]**: read in this repository's code or documents on 2026-10-31, with the file named.
- **[inference]**: the planner's reasoning from the repo facts; not checked.
- **[verify]**: the planner's knowledge of Apple's platform, rules or prices, which cannot be checked in this container
  (no network lookups of Apple's documentation were made, no Mac, no Xcode, no iPhone). Every [verify] is listed again
  at the end. None of them should be relied on until someone reads Apple's current page or tries it on a device.

## Why

A phone is expected to carry a large share of use ([plan-phone-experience](plan-phone-experience.md), Thomas,
2026-10-30). On an iPhone today the product is a web page in Safari, or the same page added to the home screen. Some
things a person expects of an app on an iPhone are hard or impossible for a web page there: a notification that a call
has started that arrives reliably, a call that keeps going with the screen locked and shows on the lock screen like a
phone call, sharing a photo from the Photos app straight into a space, and being found in the App Store. The question
is how much of that is worth a second codebase in a language Thomas does not write, and which parts the web app can do
first.

## What it is today

Read from the code on 2026-10-31. Nothing here was tried on an iPhone in this session.

### The pages belong to each server

- **[repo]** Every page and script is served by the install itself from `public/`, with no build step
  (`server/index.js`, `express.static`), and a module's pages from `/m/<id>/<version>/<file>`. Two installs on
  different versions serve different pages and different routes. Routes and API fields may be renamed at any time
  before release (`CLAUDE.md`, Rules). There is no versioned API; `GET /api/product` reports `version` (the package
  version and the commit, `v0.4.0 (1a2b3c4)`).
- **[inference]** So an app that ships its own copy of the pages, or its own client of the API, must match every
  server version it will meet. An app that loads each server's own pages never goes out of step with that server.

### Signing in

- **[repo]** A session is a signed token (`issueSession` in `server/auth.js`), 30 days, in the `app_session` cookie:
  `httpOnly`, `SameSite=Lax`, `Secure` when the request came over HTTPS. No server-side session table; a session ends
  when it expires or when the person's stamp changes (password, personal link or second factor), which signs out every
  device at once. There is no way today to sign out one device and not the others.
- **[repo]** `POST /api/login` answers `{ user, token }` and sets the cookie; with a second factor it answers
  `{ mfaRequired, enrol, pending }`, and `POST /api/login/verify` accepts the pending token in the body "for a caller
  that cannot rely on" the cookie. `sessionToken()` accepts `Authorization: Bearer <token>` in place of the cookie.
  This is how Coffee Pub Studio, a native client, signs in today ([plan-mfa](plan-mfa.md), "The Studio app").
- **[repo]** Other doors: the form `POST /login` (the product page's dropdown), a personal link `/j/<token>` (signs in
  and redirects to `/`), an invite `/invite/<token>`, self sign-up when the owner allows it (`POST /api/register`).
  No third-party sign-in (no Google, Apple or other identity provider signs a person in; the Google work in
  [plan-google-sync](plan-google-sync.md) is calendars, not sign-in).
- **[repo]** "Writes only from this origin" (`sameOriginOnly` in `server/index.js`): a POST, PUT, PATCH or DELETE that
  carries a cookie is refused with 403 when `Sec-Fetch-Site` is not `same-origin` or `none`, or `Origin` is not this
  server's own. A bearer request passes.
- **[repo]** The space page and `/` answer `frame-ancestors 'none'` (`NOT_FRAMED`); a page cannot be put in another
  site's frame.

### Hosts and environments

- **[repo]** Without `BASE_DOMAIN` the install is one environment at whatever address it is reached by. With it, the
  hostname picks: `admin.<base>` is the host console, the product host (`PRODUCT_DOMAIN`, else the bare base) serves
  the product pages, `<slug>.<base>` is an environment, anything else is 404 ("the door",
  [architecture-environments](../architecture/architecture-environments.md)).
- **[repo]** `GET /api/product` (public, on every host, single-environment too) answers `{ name, contact, baseDomain,
  productDomain, version, signup, plans, templates, pages }`. `GET /api/product/environments` (the product host) lists
  every active environment `{ slug, name }`; `GET /api/product/environment?slug=` confirms one. The product page's
  Sign in uses them.
- **[repo]** `env_hint`, a cookie on the base domain (`setEnvHint`), remembers which environments this browser signed
  in to, for the product page.
- **[repo]** LiveKit is a separate host: `livekitWsUrl()` answers `wss://<LIVEKIT_HOST>`. The hosting guide requires
  HTTPS "because browsers only allow camera access over HTTPS" ([architecture-overview](../architecture/architecture-overview.md),
  "Hosting").

### Guests

- **[repo]** A guest opens `/guest/<token>`, gives a name, and `POST /api/guest-join` returns a guest pass (signed,
  tied to the environment and the link). The page keeps the pass only in a script variable (`guestPass` in
  `public/space.js`) and sends it as `?pass=` on `GET /api/live` and in the body of `POST /api/call/join`. A reload, or
  iOS ending a backgrounded page, loses it and the guest enters again.

### The call

- **[repo]** The call runs in the page: `livekit-client` `^2.22.3` from `node_modules`, served at
  `/lib/livekit-client.esm.mjs`; `POST /api/call/join` mints the token. `space.js` offers picture-in-picture on a tile
  when `document.pictureInPictureEnabled`, and shows **Share your screen** only when
  `navigator.mediaDevices.getDisplayMedia` exists. [plan-call-as-module](plan-call-as-module.md) (draft) would move the
  call into a module that runs in the page and publishes `host.call.state`.
- **[repo]** The phone audit found the microphone unreachable from another view and Leave dropping the call in one tap
  ([plan-phone-experience](plan-phone-experience.md), audit result 1 and 2); whether a call survives a locked iPhone is
  step 3 of its device script and has not been tried.

### Modules

- **[repo]** A module runs either in the page (a shadow root, the default for bundled modules) or in a sandboxed frame
  (`sandbox="allow-scripts allow-forms"`, an opaque origin, `connect-src 'none'`, no cookies), talking to the host page
  by `postMessage`; every SDK call becomes an authenticated request made by the host page
  ([architecture-modules](../architecture/architecture-modules.md)). An uploaded module may be switched to run in the
  page only by the admin, behind a warning (`acceptRisk`). Maps draws with MapLibre (WebGL) and reads map files by
  range requests.

### The installed web app and notifications

- **[repo]** The manifest and `public/sw.js` are as [plan-phone-experience](plan-phone-experience.md) records them: a
  manifest linked from the space page only, one icon, no `maskable`, no `id`; a service worker that caches nothing.
  `public/space.html` has `apple-mobile-web-app-capable` and an `apple-touch-icon`.
- **[repo]** Notifications exist inside the product: `host.notify` and `host.schedule` ([api-module-sdk](../api/api-module-sdk.md),
  "Reminders and notifications"), kept per person (up to 50 while away), listed by `GET /api/notifications` and sent on
  `/api/notifications/stream`, shown as toasts and unread counts. Nothing leaves the open page: no Web Push, no
  `Notification` API.

### What App Review would look for that is not there

- **[repo]** No way for a person to delete their own account: `DELETE /api/users/:key` is the owner's
  (`requireOwner`); there is no `DELETE /api/me`.
- **[repo]** No way to report a message or block a person in Chat. An owner or moderator can delete messages, kick
  (`POST /api/users/:key/kick`) and mute on the call.
- **[repo]** No privacy policy or support page among the product pages (`PRODUCT_PAGES` is `/travel`, `/games`,
  `/projects`); `CONTACT_EMAIL` exists as configuration.

## Definitions (proposed)

- **The app**: the iOS app in the App Store, one for every install. Not a per-install build.
- **A server**: one install the app connects to, known by its address: a single-environment install, or one
  environment of a host with `BASE_DOMAIN` (`<slug>.<base>`). The app's list of servers is per device.
- **The shell**: the native part that holds a web view (`WKWebView`) showing a server's own pages.
- **The bridge**: the few native abilities the shell offers the pages (push, share, the keychain, the call if native),
  each a named message from the page to the shell. Never offered to a module's frame.
- **The relay**: a push service run by Coffee Pub that sends Apple's notifications on behalf of servers (question 9).
- **Native call**: the call's audio and video handled by LiveKit's Swift SDK in the app, not by `livekit-client` in the
  web view.

## What a native app adds, and what the installed web app already does

The right-hand columns are knowledge, not checked here: every row is **[verify]** unless it says **[repo]**. "Installed
web app" means the page added to the home screen from Safari.

| Ability | Installed web app on iOS | Native app | Matters for |
|---|---|---|---|
| Notifications | Web Push for a home-screen web app since iOS 16.4, after a permission asked from a tap; not in a Safari tab [verify]. The server holds its own keys (VAPID), so no relay is needed [verify]. | APNs, with rich notifications, actions and a Notification Service Extension; needs a key belonging to the app's developer (see "Notifications") [verify]. | Call started, a reminder, a module's `host.notify` |
| A call with the screen locked or the app in the background | Audio in a web page usually stops or degrades when the page is backgrounded or the phone locked [verify, device script step 3]. | The `audio` and `voip` background modes keep a live call going; CallKit shows it on the lock screen and handles interruptions [verify]. | Long calls during a trip |
| Ringing for an incoming call | Not possible [verify]. | PushKit VoIP pushes, which must be reported to CallKit as a call every time [verify]. | Only if the product rings people (it does not today [repo]) |
| Picture-in-picture of the call | Video element PiP in Safari [verify]; `space.js` already offers it on a tile [repo]. | `AVPictureInPictureController` with a video-call source; the own camera in the background needs an extra entitlement [verify]. | Watching a module while seeing faces |
| Share into the product from another app (Photos, Safari) | Web Share Target is not supported on iOS [verify]; the phone plan already expects this ([plan-phone-experience](plan-phone-experience.md), question 12). | A share extension [verify]. | The Vault, Chat, Research |
| Camera and photo library | `<input type="file" accept="image/*">` offers both [verify]; Profile's picture slots already do [repo]. | `PHPickerViewController`, the camera, converting HEIC to JPEG before upload [verify]. | The Vault refuses HEIC [repo, plan-attachments-vault] |
| Keeping a sign-in | Cookies in the home-screen app; iOS may clear a site's stored data after a period without use [verify]. | The keychain [verify]. | Not signing in again |
| Install | Only through Safari's Share menu, Add to Home Screen; no install prompt [verify]. In the EU this was briefly removed in iOS 17.4 and restored [verify]. | The App Store. | Finding and installing |
| Widgets, Live Activities | No [verify]. | WidgetKit, ActivityKit (a Live Activity for "in the call" or "next stop") [verify]. | Later |
| Background location | No [verify]. | Core Location with a stated reason; App Review asks why [verify]. | Not a feature today [repo]; question 15 |
| App badge | Badging API in a home-screen app since iOS 16.4 [verify]. | Yes. | Unread Chat ([plan-phone-experience](plan-phone-experience.md), "Notifications") |
| Offline start | The service worker could cache a shell; it caches nothing today [repo]. | The shell can show its own "You're offline" screen and the server list with no network. | Opening the app on a ferry |
| Being in the App Store | No. | Yes, with its review and its rules. | Trust, discovery |

**[inference]** The rows that a native app does much better are three: a call that survives the lock screen, share
from other apps, and notifications that do not depend on the person having added the page to the home screen. Each
one is worth checking on a real device in the installed web app first (Stage 0), because if the web app's answer is
good enough for one of them, the app's case shrinks.

## The architecture options

Four options. Costs are the planner's estimates (**[inference]**) for a first version reaching the App Store; they
assume agents write the Swift and a macOS runner builds it.

### (a) A thin shell: a web view loading each server's own pages, plus a small bridge

What it is: a native app whose screens are a list of servers, an "Add a server" screen, a settings screen and one
`WKWebView` showing the chosen server's pages. The bridge adds push registration, a share extension, the keychain and
an offline screen. The call stays in the web view (`livekit-client`, as today).

- **Two ways to build the shell.** (a1) **Capacitor** (Ionic's runtime): configured in JSON and JavaScript, with
  ready plugins for push, camera, share and preferences, and Swift only for custom plugins. Its model is web files
  bundled in the app and served from its own local origin; loading a remote server's pages (`server.url`) is described
  in its documentation as meant for development [verify]. The bridge would be injected into whatever remote page is
  loaded [verify], which here is any server's pages, modules that run in the page included. (a2) **Hand-rolled**:
  a small Swift app (the planner's guess: 1,000 to 2,500 lines for Stage 1 to 3) where the bridge is a
  `WKScriptMessageHandler` answering only the main frame of the server the person chose, with the methods named in
  "The contract".
- **Why loading remote pages, not bundled ones:** [repo] the pages and routes change with each server version and there
  is no versioned API; [repo] "writes only from this origin" refuses a cookie-carrying write whose `Origin` is not the
  server's, and a bundled page's origin (`capacitor://localhost` or a file) never is; [repo] the space page refuses to
  be framed. A bundled copy would need a versioned API, bearer tokens everywhere and CORS: the work of option (c)
  without its benefits.
- **Cost:** low to medium. Stage 1 in days of agent work plus CI set-up; Thomas's time for the Apple account and
  testing. **Skills:** Swift and Xcode project files (agents), App Store Connect (Thomas). **Risk:** App Review's
  guideline 4.2 for web wrappers (see "App Store rules"); the call in a web view may not survive the lock screen
  (Stage 1's spike answers it). **Rules out:** nothing; (b) grows from it.

### (b) A hybrid: the shell of (a), with the call native

What it is: (a), plus the call's media handled by LiveKit's Swift SDK with CallKit, the `audio` and `voip` background
modes, native picture-in-picture, and native push and share. When a person joins the call in the web view, the page
asks the bridge to join; the shell asks `POST /api/call/join` itself (bearer token), connects, and shows a native call
screen and a native call strip; the web view keeps everything else.

- **Cost:** high. A second implementation of what a person sees on the call: tiles, mute, camera, away, reactions
  (LiveKit data messages), who is talking, kick and mute for a moderator, asides (moving between spaces), the call's
  time, the microphone's state reported to presence (`PATCH /api/spaces/:id/presence`). Every change to the web call
  must be made twice. [inference] [plan-call-as-module](plan-call-as-module.md) would make this cleaner: if the call is
  a module publishing `host.call.state`, the native call can be a second implementation of the same contract, and the
  web view's call strip and Call tab can read it.
- **Why not mix:** [verify] CallKit owns the app's audio session; WebRTC inside `WKWebView` runs its own, and making the
  two cooperate is not supported. So "CallKit with the web call" is not a cheap middle.
- **Skills:** Swift, AVFoundation, CallKit, LiveKit's Swift SDK. **Risk:** two call implementations drifting; a native
  call screen that does not match the design system. **Rules out:** nothing, but it makes every call change a two-place
  change.

### (c) A fully native client (SwiftUI) against a stable API

What it is: every screen written in SwiftUI, talking to the API.

- **Why it does not fit:** [repo] modules are web code, bundled or uploaded, run in the page or in sandboxed frames
  through the `host.*` SDK. A native client cannot run an uploaded module natively, so it would still need a web view
  for every module; what is left native is Home, Chat, the call and Profile. [repo] There is no stable, versioned API,
  and the product's rule is to rename routes and fields freely before release; a native client in the App Store lags
  every server by a review cycle and meets many server versions at once, so it would need API versioning and a
  compatibility policy the product has chosen not to have yet.
- **Cost:** very high, and ongoing: every page twice. **Skills:** a full-time iOS developer. **Risk:** the native app
  and the web app diverge; modules look different in each. **Rules out:** the "one module system everywhere" the
  product is built on.

### (d) The installed web app only

What it is: no native app. Do [plan-phone-experience](plan-phone-experience.md) (manifest everywhere, maskable icons,
history and Back, the phone navigation, offline banner), then a Web Push plan for the home-screen app, and the app
badge.

- **Cost:** low; all of it in JavaScript, HTML, CSS and JSON, which Thomas writes. **Skills:** today's. **Risk:** the
  call stops when the phone locks [verify]; no share from Photos [verify]; notifications only for people who added the
  page to the home screen and allowed them [verify]; not in the App Store. **Rules out:** nothing; every piece carries
  over to (a) or (b), because the shell shows the same pages.

### Side by side

| | (a) thin shell | (b) hybrid, native call | (c) native client | (d) web app only |
|---|---|---|---|---|
| Swift to write and keep | small | large | very large | none |
| Matches every server version | yes (each server's pages) | the call side must keep up with the call's routes | no, needs a versioned API | yes |
| Uploaded modules | as today | as today | in a web view anyway | as today |
| Call with the screen locked | depends on WebKit [verify; spike] | yes [verify] | yes [verify] | depends on WebKit [verify] |
| Share from Photos | yes | yes | yes | no [verify] |
| Push without the home-screen step | yes, with a relay | yes, with a relay | yes, with a relay | no [verify] |
| App Review 4.2 risk | real, answerable (see below) | lower | lowest | none |
| Who can build it | agents with a macOS runner | agents with a macOS runner, plus a person who knows iOS audio | an iOS developer | today's agents |

**Lean (a suggestion, not a decision):** do (d) now, because it is needed anyway and carries over; then (a), built
hand-rolled (a2), with Stage 1 as a spike that answers whether the web view's call survives a locked iPhone. Move the
call native (b) only if the spike says the web view's call does not hold, and only after the call is a module
([plan-call-as-module](plan-call-as-module.md)) so there is one contract for two implementations. Not (c). The lean
for hand-rolled over Capacitor is about the bridge: the shell loads any server's pages, including modules that run in
the page, so the planner wants the bridge to be a short list the shell checks against the chosen server and the main
frame, which a hand-rolled shell makes plain; Capacitor would be the choice if Thomas wants to read and change the
shell's configuration himself (question 3).

## Who builds it, and how it is checked

Thomas does not write Swift, and today's agents build in a Linux container.

**What this container can and cannot do** [repo: `which swift xcodebuild` finds nothing; Linux x86_64]:

- **Can:** write Swift, the Xcode project's files, `Info.plist`, entitlements, the `apple-app-site-association`
  answer, the workflow files; check JSON and plist files by script; build and test the server's side of every route
  (bearer tokens, devices, push registration, account deletion) as today, against a throwaway server.
- **Cannot:** compile for iOS (UIKit, SwiftUI, WebKit, CallKit and AVFoundation exist only in Apple's SDK on macOS
  [verify]), run a simulator, sign, upload to TestFlight, or test on a device. Swift's Linux toolchain could compile
  pure-logic packages (address parsing, the server list) if it were installed [verify], which is a small share of the
  app.

**Ways to build and check it:**

| Way | What it gives | Cost and limits |
|---|---|---|
| GitHub Actions macOS runner | `xcodebuild` builds, unit tests and UI tests in a simulator, simulator screenshots as artifacts an agent can look at, upload to TestFlight with an App Store Connect API key kept in the repository's secrets | Minutes on macOS runners are billed at a higher rate than Linux, free within limits for a public repository [verify; whether the repository is public is for Thomas] |
| Xcode Cloud | Apple's own CI, signing handled, straight to TestFlight | Some compute hours included with the developer membership [verify]; configured in Xcode on a Mac, less visible to agents |
| A Mac Thomas owns | Xcode, the simulator, running on his iPhone over a cable, debugging Safari's Web Inspector on the app's web view | Thomas's time; agents cannot drive it from here |
| TestFlight | The build on Thomas's and testers' iPhones without App Review's full review (an external tester group needs a lighter review) [verify] | 90-day builds [verify] |

**[inference]** The working loop would be: an agent writes the change, the macOS workflow builds it, runs the
simulator tests and posts screenshots, the agent reads them and fixes; a passing build on `main` goes to TestFlight;
Thomas tries it on his iPhone and files issues. Anything about audio, the lock screen, push delivery, the share
extension's real use, CallKit and the camera can only be "verified live" by Thomas on a device; the simulator has no
camera and no push in the general case [verify].

**Who:** a new agent for the app (question 6), or server-development taking it on. Either way, a person who knows iOS
would be worth paying for a review of the audio session and CallKit work if (b) is chosen.

**Maintenance:** each yearly iOS release needs a check and usually a rebuild with the new Xcode; Apple raises the
minimum SDK required for submissions on its own schedule [verify]; LiveKit's Swift SDK (if (b)) moves with LiveKit's
server. **[inference]** For (a), a few days a year; for (b), the call's every change twice.

## Many servers in one app

One App Store app must reach every install, each at its own address.

### Adding a server

- **Typed:** the person types an address (`thepub.coffeepub.live`, `collab.example.org`, `https://10.0.0.5`). The app
  adds `https://`, asks `GET /api/product`, and accepts the server only if the answer has the shape [repo] that route
  gives (`name`, `version`, `baseDomain`). It shows the server's name and its full address before going on.
- **The address is a product host:** when `baseDomain` is set and the address is the product host, the app asks
  `GET /api/product/environments` [repo] and lets the person pick an environment, then continues at `<slug>.<base>`.
  (Whether every environment should be listed to an app this way is the same choice the product page's Sign in made;
  nothing new is revealed.)
- **Scanned:** "Open in the app" (proposed) in Profile and on the invite and guest link pages shows a QR code carrying
  the server's address, and for an invite or a guest link the link itself; the app's camera reads it.
- **From a link:** see "Links into the app".
- **The host console** (`admin.<base>`) is not offered in the app (question 11): it refuses the `app_session` cookie
  and has its own `host_session`.

### Signing in

Three options (question 7):

- **(i) Cookies in the web view.** The person signs in on the server's own sign-in page inside the web view, as in
  Safari: password, second factor, personal link, all as built. The shell reads nothing. The share extension and push
  registration (which run outside the web view) then need their own credential: either the shell reads the
  `app_session` cookie from the web view's cookie store, which a native app can do for its own web view [verify], or
  the page asks for a device token (iii).
- **(ii) A native sign-in screen** calling `POST /api/login` and `POST /api/login/verify` [repo, as Studio does], the
  token kept in the keychain and given to the web view as a cookie. Every sign-in way the server adds (passkeys,
  [plan-mfa](plan-mfa.md)'s second phase) must then be built natively too.
- **(iii) Web sign-in, then a device token.** As (i), and once signed in the page asks the server for a device token
  for this app (`POST /api/me/devices`, proposed), passed to the shell through the bridge and kept in the keychain
  (shared with the share extension by an app group [verify]). A device record on the server (name, created, last
  seen) lets Profile list "Signed-in devices" and sign out one of them, which today's stateless sessions cannot do.
- `ASWebAuthenticationSession` [verify] is for signing in through a browser and returning to the app by a callback; it
  fits an identity provider, which the product does not have. It would matter for passkeys: a passkey in an app's own
  web view needs the app associated with the server's domain [verify], which a shared app cannot be for arbitrary
  servers (see "Links into the app"), so passkeys in the app would go through `ASWebAuthenticationSession` or Safari
  [verify].

**Lean:** (iii). Sign-in stays one implementation (the server's pages), and the device record is worth having for
itself.

### Guests

- A guest link opened in the app shows the guest page in the web view, as in Safari [inference]. The guest pass stays
  in the page's memory [repo], so iOS ending the app in the background makes the guest enter again. The bridge could
  keep the pass in the keychain for that server and link until the link is turned off (question 13); the planner
  suggests not, at first: a guest is a short visit.

### Links into the app

- **Universal links** need the domain to serve `/.well-known/apple-app-site-association` naming the app, and the app's
  signed entitlements to list each domain (`applinks:<domain>`) when it is built [verify]. A wildcard covers subdomains
  of one domain (`*.coffeepub.live`) [verify]. Apple's own servers fetch the file, so a server on a home network that
  the internet cannot reach never qualifies [verify].
- **[inference]** So universal links can work for Thomas's own domains (`*.coffeepub.live`, the product domain) and
  for no self-hosted install, because a self-hoster's domain cannot be added to an app already in the App Store.
- **For everyone else:** a custom URL scheme (`<scheme>://open?u=<https address>`, the scheme named by kind or by the
  brand, not by the product's name, question 12), opened from "Open in the app" buttons on the server's pages, and the
  QR code. A custom scheme can be claimed by any app [verify], so the app treats what it receives as an address to
  confirm, never as a sign-in.
- The server would serve `/.well-known/apple-app-site-association` only when configured (an environment variable with
  the app's team and bundle id, proposed `IOS_APP_ID`), so an install that sets nothing behaves as before.

### Several servers

- The app keeps a list of servers (address, name from `GET /api/product`, icon from `/img/site/icon` [repo], last used)
  and opens the last one. Switching is the app's own screen, not part of the pages.
- **[inference]** Each server is a different origin, so cookies and stored data are already apart by WebKit's rules;
  still, each server should get its own web view data store, so "Remove this server" deletes everything it left on the
  phone. Separate named data stores exist from iOS 17 [verify], which would set the oldest iOS the app supports
  (question 14).
- Push, the device token and the keychain entries are per server.

### Certificates and App Transport Security

- **[verify]** App Transport Security requires HTTPS with a certificate the phone trusts for the app's own requests;
  exceptions exist (`NSAllowsArbitraryLoadsInWebContent`, `NSAllowsLocalNetworking`) and App Review asks for a reason.
- **[repo]** The product already requires HTTPS for the camera; **[verify]** a web view's `getUserMedia` also requires a
  secure context.
- **[inference]** So the app requires HTTPS with a trusted certificate, as the hosting guide already does, and says
  so plainly when a server fails ("This server's certificate isn't trusted by your phone"). A LAN install with a
  self-signed certificate works only if the person installs and trusts its certificate on the phone (Settings), which
  the user guide can explain; the app does not offer "trust anyway" (question 16).
- The LiveKit host (`LIVEKIT_HOST`) is a second address the call connects to, with its own certificate [repo].

## App Store rules that bite

Every row is **[verify with Apple's current guidelines]**; the numbers are the planner's memory of the App Review
Guidelines and may have moved.

| Rule | What it asks, as the planner understands it | Where the product stands | What it would take |
|---|---|---|---|
| 4.2 Minimum functionality | An app that is only a website in a web view may be rejected | Option (a) is a web view [inference] | Native parts that a website cannot do: the server list, push, the share extension, the keychain, an offline screen; and in (b) the native call. Apps that are clients of self-hosted servers are in the App Store (Nextcloud, Home Assistant, Jellyfin, Mattermost are the planner's examples) [verify] |
| 2.1 App completeness, and review information | App Review must be able to sign in and use it | Any server, so nothing to sign in to by default | A demo environment on Thomas's host with a review account, kept running; its address and account in App Store Connect |
| 1.2 User-generated content | A way to report content and block people, a way to filter, a contact, action on reports | Chat, modules' objects and pictures are user content; no report, no block [repo] | **Report** on a message (to the environment's owner and moderators), **Block** a person (hide their messages for me), the owner's contact in the app; who acts on a report on a self-hosted server is that server's owner [inference] |
| 5.1.1(v) Account deletion | An app that lets people create an account must let them delete it in the app | Self sign-up and invites create accounts [repo]; only the owner deletes [repo] | `DELETE /api/me` with a confirm, or a request to the owner; the owner's own account and the last owner need a rule (question 17) |
| 4.8 Sign in with Apple | Required when the app offers certain third-party sign-ins | None offered [repo] | Not needed while that holds [verify] |
| 5.1 Privacy, nutrition labels | Declare what the app and its third parties collect | The app itself collects nothing unless a relay or crash reporting is added; each server is the person's own choice [inference] | Labels written for the app and the relay; a privacy policy URL; how a server's own data is described is a [verify] |
| Privacy manifest | A file declaring required-reason APIs and tracking [verify] | | In the app's project |
| 2.5.2 and 4.7 Code the app runs | An app may not download code that changes its features; web content run by WebKit is the allowed exception; 4.7 covers HTML5 mini apps and games inside an app | Modules, uploaded by an admin, run as web content [repo] | Modules stay web content in the web view, never native code [inference]; whether 4.7's conditions apply is a [verify] |
| Export compliance | Declare encryption use; standard HTTPS and WebRTC encryption is usually exempt | TLS, DTLS-SRTP in the call | `ITSAppUsesNonExemptEncryption` set after reading Apple's current rule [verify] |
| Push entitlement | The app's identifier must have push turned on; the APNs key is the developer's | | Thomas's account |
| Background modes | `audio` and `voip` are reviewed for real use | Only with a call that uses them | Only in (b), or in (a) if the spike shows the web call can use `audio` [verify] |
| Self-hosted servers | Review of an app whose content comes from servers the developer does not run | Every install is someone else's | The demo server; a plain statement in the review notes; the report and block rows above [inference] |

## The call in the app

- **LiveKit JS in the web view (options (a), (d)).** WebRTC and `getUserMedia` work in `WKWebView` in recent iOS
  [verify: from about iOS 14.3]; the camera and microphone need `NSCameraUsageDescription` and
  `NSMicrophoneUsageDescription` in the app or it stops when asked [verify]. What happens with the screen locked or
  the app in the background, with the `audio` background mode set or not, is the spike's question [verify]. Audio
  routing (speaker, earpiece, Bluetooth) follows WebKit's choices, with little the page can set [verify].
- **LiveKit's Swift SDK (option (b)).** LiveKit publishes an iOS SDK and examples with CallKit [verify]. CallKit gives
  the lock screen's call controls, audio session handling, interruptions by a phone call, and the call in the phone's
  recents [verify]. PushKit VoIP pushes are only for ringing an incoming call and must always show the call UI, or iOS
  stops delivering them [verify]; the product does not ring people today [repo], so (b) would use CallKit for an
  outgoing "join" and normal pushes for "a call has started".
- **Picture-in-picture.** In the web view, a video element's PiP needs the web view configured to allow it [verify].
  Native PiP for a video call has its own API, and keeping the own camera live in PiP needs an entitlement [verify].
- **Screen share.** [repo] The page offers it only where `getDisplayMedia` exists; [verify] iOS Safari and `WKWebView`
  do not have it, so the button stays hidden. A native screen share needs a ReplayKit broadcast extension [verify].
  **Lean:** not offered on a phone at all, as the phone audit also proposes (audit result 8).
- **The phone plan's call strip and Call tab** ([plan-phone-experience](plan-phone-experience.md), questions 3 and 5)
  are drawn by the pages in every option; in (b) they read the native call's state through the bridge.

## Notifications

None leave the page today [repo]. This is the plan's largest architecture question (question 9), because Apple's push
service accepts a notification for an app only from someone holding that app's developer key or certificate [verify].

| Option | How it works | For | Against |
|---|---|---|---|
| **A. Web Push only** | Each server keeps its own keys (environment variables), a subscription store in `DATA_DIR`, and sends to Apple's web push service; `sw.js` shows them [verify] | No relay; works for every self-hosted install; carries over to Android and desktop browsers; no Swift | Only in the home-screen web app on iOS, after permission [verify]; not inside the native app's web view [verify] |
| **B. A Coffee Pub push relay** | The app registers its APNs device token with the server it is signed in to; the server sends "notify this device" to the relay; the relay holds the APNs key and sends. Proposed `PUSH_RELAY_URL` and a per-server relay key in environment variables; unset means no push and nothing changes | Works for every install, in the native app | Thomas runs a service every install depends on: uptime, abuse limits (a server could spam its own devices only, if tokens are bound to the server that registered them), a privacy policy for what passes through, cost. Precedents: Mattermost's and Rocket.Chat's push proxies, Nextcloud's [verify] |
| **B2. Relay with sealed content** | As B, but the server encrypts the text to a key the app gave it, and a Notification Service Extension decrypts on the phone [verify]; the relay sees only an opaque payload and a device token | The relay never reads a message | More Swift; an extension's memory and time limits [verify] |
| **C. Each server's own APNs key** | A self-hoster puts an APNs key in their install | No relay | Impossible for the shared App Store app: the key belongs to Thomas's developer account [verify], and handing it to every install would let any install send to every user of the app. Possible only for a self-hoster who builds and signs their own copy of the app [inference] |
| **D. Thomas's host only** | Thomas's own host (`*.coffeepub.live`) holds the APNs key directly; self-hosted installs get Web Push (A) | No separate relay service; push where Thomas is responsible anyway | Self-hosters' app users get no app push |
| **E. No push** | Background refresh only | Nothing to run | iOS decides when background refresh runs; not a notification [verify] |

**What would notify** (whatever the option): a call started in a space, a `host.notify` or `host.schedule`
notification (already stored per person [repo]), a reply or a private message in Chat if Chat gains those, an
invitation. A person chooses which in Profile. Text says the space and who; never a guest pass or a link token.

**Lean:** A first (it is needed by the installed web app, it is Stage 0, and it needs no Swift); then B2 for the
native app, with D as the first step of it (the relay starts life as part of Thomas's host and serves other installs
once it is proven), since a self-hosted product whose app gives self-hosters no notifications would be an odd promise.
This is Thomas's call, and it adds a service he would run for others.

## Modules in the app

- **[inference]** Modules run unchanged in the web view: the same WebKit as Safari, the same shadow roots, the same
  sandboxed frames with opaque origins and `postMessage`, the same brokered drag. Nothing in the module system names
  the browser [repo].
- **The bridge is never offered to a module.** A sandboxed frame is not the main frame, and the shell answers only the
  main frame of the chosen server [inference; the check that a message came from the main frame is `WKScriptMessage`'s
  `frameInfo` [verify]]. A module that runs in the page is in the main frame, so it could call the bridge; that is why
  every bridge method is either harmless (asking for a device token goes through the server's own permission) or
  needs the person's own tap in a native sheet (share, camera), and why the shell never takes a URL from the page to
  open outside the chosen server without showing it. The SDK gains nothing a module calls directly; `host.screen`
  (proposed in the phone plan) can say `installed: 'app'`.
- **Offline:** as the phone plan says (banner, nothing lost silently); the shell adds a native offline screen when the
  server cannot be reached at all, with the server list. Maps' downloaded regions ([plan-map-region-download](plan-map-region-download.md))
  live on the server, not the phone [inference]; offline maps on the phone are not in this plan.
- **The Vault and pictures** ([plan-attachments-vault](plan-attachments-vault.md), approved, step 1 built): **Add
  files** in the web view offers the photo library and the camera as in Safari [verify]; HEIC is refused by the server
  [repo], and iOS may convert to JPEG when the page does not accept HEIC [verify]. The share extension (Stage 3) takes
  photos and links from other apps and sends them to a space's Vault, Chat or Research through the same routes the
  Vault plan defines, with the device token; it shows the server, the space and the destination before sending.
  Downloading a file and the share links work as in Safari [inference].
- **Pop-outs** (`window.open`) need the shell to handle a new window [verify]; the phone plan already says pop-outs are
  not for a phone, so the shell refuses them with nothing shown.

## Security and privacy

- **No secrets in the app.** No LiveKit key, no relay key, no APNs key; the app holds only what a person's own sign-in
  gives it [inference]. The relay key is in each server's environment variables, never in a page.
- **The keychain** keeps each server's device token, under that server's address, shared with the share extension
  only [verify: an app group and a shared keychain access group].
- **Certificate pinning: no.** Servers are arbitrary and renew certificates (often Let's Encrypt every 90 days); the
  phone's own trust decides [inference]. The relay's own address could be pinned, since Thomas runs it.
- **Per-server trust.** A server cannot speak for another: the app shows the address beside the name on every switch,
  each server has its own data store, and a link or QR code is an address to confirm, never a sign-in on its own.
- **The bridge** is a short list (see "The contract"), main frame only, the chosen server only.
- **On the device:** the web view's cookies and storage per server, the server list, keychain entries. "Remove this
  server" and signing out delete them. No analytics in the app (question 18).
- **Logging:** the shell never logs a URL with a token in it (`/j/<token>`, `/invite/<token>`, `/guest/<token>`,
  `?pass=`) [repo: these are the token-carrying addresses], nor a device token.
- **The guest pass** stays in the page's memory, as today, unless question 13 says otherwise.
- **Crash reports:** Apple's own (opt-in by the person) only, unless Thomas chooses a service (question 18).

## The contract (proposed)

Nothing here is decided. It is specific enough to argue over; the build waits on the questions.

### The server half (server-development)

- `GET /api/product`: unchanged; the app relies on `name`, `version`, `baseDomain`, `productDomain` [repo].
- `POST /api/me/devices` (signed in, from the page): `{ name, platform: 'ios', pushToken? }` answers 201
  `{ device: { id, name, createdAt }, token }`; the token is a bearer credential for this device only, stored hashed in
  the person's record in `DATA_DIR`. `GET /api/me/devices` lists them; `DELETE /api/me/devices/:id` revokes one (204);
  changing the password revokes all, as today's stamp does. 401 when signed out; a guest gets 403.
- `PATCH /api/me/devices/:id` `{ pushToken, notify: { call, notices } }` (bearer, from the shell).
- Push sending: only when `PUSH_RELAY_URL` and `PUSH_RELAY_KEY` are set (and Web Push only when its own keys are
  set); unset, nothing is sent and nothing changes, so a single-environment install behaves as before.
- `DELETE /api/me` with the password (or a second factor) answers 204 and removes the account as the owner's delete
  does, refused with 409 for the last owner of an environment (question 17).
- Chat: `POST /api/spaces/:id/chat/:messageId/report` (to the owner and moderators, as a notification), and a
  per-person block list (`PUT /api/me/blocked/:key`, `DELETE`), applied to what that person's Chat shows.
- `GET /.well-known/apple-app-site-association` only when `IOS_APP_ID` is set; 404 otherwise.

### The pages half (experience-design)

- "Open in the app" in Profile and on the invite and guest pages: a button with the custom scheme on an iPhone, and a
  QR code of the address on a computer. Shown only when the server says the app exists (a branding field, proposed).
- When the bridge is there: ask for a device token once after sign-in and hand it to the shell; Profile's
  "Signed-in devices" list with **Sign out**; Profile's notification choices.
- Chat's **Report** and **Block** on a message's menu; Profile's **Delete my account** with a confirm.
- Everything else is [plan-phone-experience](plan-phone-experience.md) as it is built.

### The app half (the Swift builder)

- **Servers:** the list (name, address, icon), **Add a server** (type, scan), **Remove**.
- **The web view:** the chosen server's `/`, its own data store, Back from the pages' history (the phone plan's step
  4), a native offline screen, refusal of pop-outs, links outside the server opened in Safari after showing the address.
- **The bridge, the whole list:** `device.register(token)`, `push.ask()`, `share.pending()` (what the share extension
  has waiting), `app.version()`; in (b) `call.join({ space })`, `call.leave()`, `call.state` (an event). Main frame and
  the chosen server only.
- **The share extension:** choose the server, the space and where (Vault, Chat, Research), send with the device token.
- **Settings:** notifications per server, sign out, remove, About (the app's version and each server's).

## Stages

Each stage ends with something Thomas can try, and its exit criteria.

### Stage 0: decisions, and the web app work that carries over

- **What:** Thomas answers questions 1 to 5 and 9. [plan-phone-experience](plan-phone-experience.md) steps 3 to 6 and
  10 (foundations, history, the shared sheets, the navigation, installability) as that plan orders them; a Web Push
  plan (that plan's question 13) if question 9 picks A. Run the phone plan's device script on Thomas's iPhone in the
  installed web app, with steps 3 (the locked screen) and 12 (installed) as the evidence for this plan.
- **Exit:** the decisions recorded here; the device script's answers for the locked screen and installation written
  into this plan.
- **Thomas:** the decisions; the device run; join the Apple Developer Program (an organisation account needs a D-U-N-S
  number and takes longer than a person's [verify]) if Stage 1 is to follow.
- **Agents:** the phone plan's steps; product-planner records the results.

### Stage 1: the spike, to TestFlight

- **What:** the hand-rolled shell (or Capacitor, question 3): add a server by address, the server list, the web view
  showing the server's pages, sign in in the web view, Home and a space's Workspace, the call in the web view, Back. A
  macOS workflow that builds, runs simulator tests and uploads to TestFlight.
- **Exit:** on Thomas's iPhone from TestFlight: add `thepub.coffeepub.live` and a single-environment install, sign in
  to both, enter a space, join a call with a second person, lock the phone for one minute and five minutes and write
  down what is heard; switch servers; the app stays signed in after a restart. The answer to "does the web view's call
  hold" decides whether Stage 2 is (a) or (b).
- **Thomas:** the Apple account, the app's record in App Store Connect, the bundle id (question 12), an App Store
  Connect API key added to the repository's secrets, TestFlight testers, his iPhone.
- **Agents:** the Swift, the project, the workflow, the simulator tests; quality-assurance reads the simulator
  screenshots.

### Stage 2: notifications, and the call

- **What:** device tokens (`/api/me/devices`), push by the option question 9 picks, Profile's devices and choices; the
  call as the spike decided: the `audio` background mode for the web call, or the native call (b) after
  [plan-call-as-module](plan-call-as-module.md).
- **Exit:** a call started in a space notifies a second iPhone with the app closed; a `host.notify` reaches it; a long
  call survives the lock screen; revoking a device in Profile stops its pushes.
- **Thomas:** the push key in his account; running the relay (if B or B2); the device tests.
- **Agents:** the server routes and checks (server-development), the Swift (the app builder), Profile (experience-design).

### Stage 3: share, camera and the Vault

- **What:** the share extension into the Vault, Chat and Research; HEIC converted before upload; "Open in the app" and
  the QR code; the custom scheme.
- **Exit:** a photo shared from Photos lands in a chosen space's Vault; a link from Safari lands in Research; an invite
  opened from Messages opens the app on the right server.
- **Waits on:** the Vault's routes ([plan-attachments-vault](plan-attachments-vault.md) steps 2 onward).

### Stage 4: App Store submission

- **What:** account deletion, Report and Block, the privacy policy and support pages, the privacy labels, the privacy
  manifest, export compliance, the review notes, the demo environment, screenshots at the sizes App Store Connect asks
  for [verify], the icon.
- **Exit:** the app approved and in the App Store.
- **Thomas:** the privacy policy and support URLs (on the product pages), the demo environment and its account, the
  listing's words and screenshots, answering App Review.
- **Agents:** the routes and pages for deletion, Report and Block; content-manager the policy's draft and the guide.

## Left to build, in order

| # | Step | Who | Blocked by questions |
|---|---|---|---|
| 0 | The decisions and the installed web app's device run (Stage 0) | Thomas, product-planner | 1 to 5, 9 |
| 1 | [plan-phone-experience](plan-phone-experience.md) steps 3 to 6 and 10, as that plan orders them | experience-design, server-development | that plan's questions |
| 2 | Web Push for the installed web app, in its own plan, if question 9 picks A | product-planner, then server-development and experience-design | 9 |
| 3 | The repository's place for the app and the macOS workflow (build, simulator tests, TestFlight) | server-development, the app builder | 6, 8 |
| 4 | The shell: servers, add by address, the web view per server, offline screen, Back (Stage 1) | the app builder | 3, 7, 11, 14, 16 |
| 5 | Device tokens: `POST`, `GET`, `PATCH`, `DELETE /api/me/devices`, the check; Profile's devices | server-development, experience-design | 7 |
| 6 | Push by the chosen option; Profile's choices; the bridge's `push.ask` | server-development, the app builder, experience-design | 9, 10 |
| 7 | The call: the `audio` mode for the web call, or the native call after the call is a module | the app builder | 4, 5 |
| 8 | The share extension, HEIC conversion, "Open in the app", the custom scheme, the AASA answer | the app builder, experience-design, server-development | 12, Vault steps |
| 9 | Account deletion, Report and Block | server-development, experience-design | 17 |
| 10 | Submission: policy, labels, manifest, review notes, demo environment | Thomas, content-manager | 18, 19 |
| 11 | Documentation: an architecture section for the app, the user guide, the hosting guide's push and certificate lines | content-manager | each step as it lands |

Steps 1 and 2 need no Swift and help everyone on a phone, app or not. Steps 5 and 9 are server and pages work that can
be built and checked here. Step 4 can start once step 3 has a runner.

## Verify

- **Steps 1, 2, 5, 9 (server and pages).** Checked by a tool here: a throwaway server (`DATA_DIR=/tmp/<name>`), the
  routes' status codes, a revoked device's token refused, `DELETE /api/me` refused for the last owner, a blocked
  person's messages hidden for the blocker only, no push sent when the variables are unset. Web Push's delivery only on
  a real installed web app.
- **Steps 3, 4, 6 to 8 (the app).** Checked by a tool on the macOS runner: the build, unit tests (address parsing, the
  server list, the bridge's refusals of a frame and of another server), simulator UI tests with screenshots (add a
  server against a test server the workflow starts, sign in, Home, a space). Not checkable in this container at all.
- **Only on Thomas's iPhone, verified live:** the call with the screen locked, audio routing, CallKit, push delivery,
  the share extension from Photos and Safari, the camera, HEIC, TestFlight installs, universal links and the custom
  scheme, a server with a self-signed certificate.
- **Only with a real LiveKit:** every call step, as for the web app.
- **Only with Apple:** App Review's answer.

## Repository, release and versioning

- **Where the app lives** (question 8). (a) An `ios/` folder in this repository: one place, the server's routes and
  the app change in one pull request, but `npm run check` and the Docker image must ignore it, and `CLAUDE.md`'s layout
  gains a line. (b) A separate repository, as Coffee Pub Studio has its own [repo: `documentation/TODO.md`, "See the
  Studio repository"]: its own CI and release, issues apart. **Lean:** (a), while the app is a shell around this
  repository's pages and its bridge is a contract with them.
- **Versions:** the app has its own version (`CFBundleShortVersionString`) and build number, apart from the server's
  `0.4.0`. The app shows both its own and the server's (`GET /api/product`). The app must work with every server
  version it meets; the bridge's methods are the only contract it has with the pages, so they change with care even
  before release [inference]. This is the one place where the "no compatibility layers" rule meets an app that cannot
  be updated on the same day as every server (question 20).
- **Release:** TestFlight from `main`; App Store releases when Thomas says, with a CHANGELOG line of its own.

## Android

Not in scope. **[inference]** How the choices carry over: the thin shell maps to an Android `WebView` shell (or
Capacitor, which covers both); Web Push already works in Chrome on Android, home-screen or not [verify], so option A
covers Android with no relay; the relay (B) would need a Firebase key the same way it needs an APNs key; Android's
Trusted Web Activity needs Digital Asset Links served from each domain [verify], the same multi-server problem as
universal links; the share target works for an installed web app on Android [verify], so Android needs a native app
less than iOS does.

## Costs and ongoing obligations

- **The Apple Developer Program:** a yearly fee (99 US dollars a year when last known [verify]).
- **A macOS runner or a Mac:** runner minutes, or Xcode Cloud hours, or a Mac [verify prices].
- **The relay** (if B or B2): a small always-on service, its monitoring, its privacy policy.
- **Review cycles:** every App Store release waits for review (often a day or two [verify]); a fix to the shell is not
  out the same day.
- **iOS support policy** (question 14): which iOS versions the app supports, reviewed each autumn.
- **Policies:** a privacy policy and a support page that stay true; a demo environment kept running for review; the
  report and block promises answered on Thomas's own host.
- **The yearly iOS release:** a check and usually a rebuild.

## How it relates to other plans

- **[plan-phone-experience](plan-phone-experience.md)** (draft): this plan's Stage 0. Its navigation, history, sheets,
  keyboard, offline and installability are what the app's web view shows; its device script is this plan's device
  script, with the app added as a row ("the iOS app") once Stage 1 exists. Its question 13 (notifications in their own
  plan) and question 12 (share in) are answered differently on iOS by this plan's questions 9 and 4.
- **[plan-call-as-module](plan-call-as-module.md)** (draft): a native call (b) should wait for it, so the call has one
  contract (`host.call.state`) with two implementations.
- **[plan-realtime-optional-livekit](plan-realtime-optional-livekit.md)** (built, steps 1 to 7): entering a space, Chat
  and presence no longer need LiveKit, so an app without a working call still works.
- **[plan-attachments-vault](plan-attachments-vault.md)** (approved): the share extension and the photo picker send to
  its routes; its HEIC rule stands on the server.
- **[plan-object-window](plan-object-window.md)** (draft): its phone sheet is what the app shows; its `#object=` deep
  links are what "Open in the app" and push notifications would open.
- **[plan-mfa](plan-mfa.md)** (built): the second factor works in the web view as built; passkeys (its second phase)
  meet the associated-domains limit above.
- **[plan-domains](plan-domains.md)** (built): the product host's environment list is how the app picks an environment.

## Decisions

None yet. Thomas decides the questions below.

## Open questions

Each has options and the planner's suggestion, marked as such.

1. **Whether to build a native app now.** (a) Not yet: Stage 0 (the phone plan and Web Push) first, then decide on the
   device run's evidence. (b) Start the spike now beside Stage 0. (c) No native app; the installed web app only.
   *Suggestion: (a),* because the device run answers the call and notification questions cheaply. Blocks steps 3 to 10.
2. **What the app is.** (a) A thin shell. (b) A hybrid with a native call. (c) A native client. *Suggestion: (a), with
   (b) only if the spike shows the web view's call fails with the screen locked;* not (c), because modules are web code.
   Blocks step 4.
3. **How the shell is built.** (a) Hand-rolled Swift with a short bridge. (b) Capacitor, more of it in JSON and
   JavaScript, its bridge injected into every remote page. *Suggestion: (a),* for control over what the bridge offers to
   any server's pages; (b) if Thomas wants to change the shell himself. Blocks step 4.
4. **Share from other apps.** (a) In the app (Stage 3). (b) Not at all on iOS. *Suggestion: (a),* after the Vault's
   routes. Blocks step 8.
5. **Picture-in-picture, widgets, Live Activities.** (a) Later, each its own small plan. (b) In the first App Store
   version. *Suggestion: (a).* Blocks nothing now.
6. **Who builds the Swift.** (a) A new agent for the app, with its own instructions and the macOS workflow. (b)
   server-development takes it on. (c) A paid iOS developer for the call work only, agents for the rest. *Suggestion:
   (a), with (c) if the call goes native.* Blocks step 3.
7. **How the app signs in.** (a) In the web view, then a device token for the shell (iii). (b) In the web view only,
   the shell reading the cookie (i). (c) A native sign-in screen (ii). *Suggestion: (a).* Blocks steps 4 and 5.
8. **Where the app's code lives.** (a) `ios/` in this repository. (b) A repository of its own. *Suggestion: (a).*
   Blocks step 3.
9. **Who sends notifications.** (a) Web Push only (A). (b) A Coffee Pub relay (B), or with sealed content (B2). (c)
   Thomas's host only (D), self-hosters on Web Push. (d) None. *Suggestion: (a) now, then (b) with sealed content,
   starting as (c).* The largest choice; blocks steps 2 and 6.
10. **What notifies.** (a) A call started, a module's notifications and invitations, each a choice in Profile. (b) Fewer.
    *Suggestion: (a).* Blocks step 6.
11. **The host console in the app.** (a) Not offered; it opens in Safari. (b) Offered as a server. *Suggestion: (a).*
    Blocks step 4.
12. **The bundle id, the URL scheme and the app's name.** The bundle id can never change once the app is in the App
    Store [verify], and the product's name is not settled ([plan-domains](plan-domains.md)). (a) A bundle id and scheme
    named by the brand and a kind word, never by the product's name (`ai.coffeepub.` and a word Thomas picks), the
    listing's name from `PRODUCT_NAME`'s current value. (b) Named by the current product name. *Suggestion: (a),* as
    `CLAUDE.md` names identifiers by kind. Blocks steps 4 and 8.
13. **The guest pass in the app.** (a) In the page's memory, as today. (b) Kept in the keychain for that server and
    link. *Suggestion: (a),* first. Blocks nothing until a guest complains.
14. **The oldest iOS supported.** (a) The current and the previous major version. (b) From iOS 17, for separate data
    stores per server [verify]. *Suggestion: (b) or later, whichever is newer when Stage 1 starts.* Blocks step 4.
15. **Background location for trips.** (a) Not in this plan. (b) A plan of its own later. *Suggestion: (a);* nothing in
    the product uses location today, and App Review asks for a reason. Blocks nothing.
16. **Servers without a trusted certificate.** (a) Refused, with a sentence and the user guide's steps to trust a
    certificate on the phone. (b) A "trust this server anyway" switch. *Suggestion: (a).* Blocks step 4.
17. **Deleting one's own account.** (a) `DELETE /api/me` in Profile, refused for the last owner. (b) A request the
    owner approves. *Suggestion: (a),* since App Review asks for deletion in the app [verify]. Blocks step 9.
18. **Analytics and crash reports in the app.** (a) None; Apple's own opt-in crash reports. (b) A crash service.
    *Suggestion: (a);* it keeps the privacy labels short. Blocks step 10.
19. **The demo environment for App Review.** (a) A dedicated environment on Thomas's host with seeded spaces and a
    review account. (b) Thomas's own environment. *Suggestion: (a).* Blocks step 10.
20. **The bridge's stability.** The app in the App Store and each server update apart. (a) The bridge's method list is
    versioned (`app.version()`, a page asks before using a method), and a method is never renamed once an App Store
    version uses it. (b) The "no compatibility" rule applies to the bridge too, and the app is updated in step with the
    pages. *Suggestion: (a),* as the one exception, since an App Store app cannot be updated on the same day as every
    server. Blocks step 4.
21. **Kind of build.** (a) A production build for each stage (plan, QA on a device, documentation). (b) Try builds for
    the spike, production from Stage 2. *Suggestion: (b).* Blocks nothing in the plan.

## To verify on current Apple documentation or a real device

Not checked in this session; none of these should be relied on until someone has:

1. Web Push for home-screen web apps on iOS: the first version (16.4 is the planner's memory), that it works only
   installed, the permission rule, and its reliability; whether it works inside a native app's `WKWebView` (the
   planner believes not).
2. Whether home-screen web apps work in the EU on current iOS.
3. Whether a WebRTC call in Safari, in a home-screen web app, and in an app's `WKWebView` keeps its audio with the
   screen locked or the app in the background, with and without the `audio` background mode (a real iPhone, a real
   LiveKit).
4. `getUserMedia` and WebRTC in `WKWebView`: the first iOS version and its limits; audio routing control.
5. CallKit and a web view's WebRTC sharing the audio session.
6. PushKit's rule that every VoIP push must report a call to CallKit.
7. PiP in `WKWebView`; the video-call PiP API; the multitasking camera entitlement.
8. `getDisplayMedia` absent on iOS; ReplayKit broadcast extensions for screen share.
9. Web Share Target on iOS (believed unsupported); the Badging API.
10. HEIC to JPEG conversion when a file field's `accept` leaves HEIC out; the camera prompt in a web view needing
    `NSCameraUsageDescription`.
11. Reading `httpOnly` cookies from `WKHTTPCookieStore`; sharing a keychain entry with an extension by app group.
12. Separate `WKWebsiteDataStore` per identifier (iOS 17 is the planner's memory).
13. Universal links: the entitlement listing each domain at build time, wildcards, Apple's CDN fetching
    `apple-app-site-association`, and what that means for a server the internet cannot reach.
14. Passkeys in an app's own web view needing associated domains; `ASWebAuthenticationSession` as the route.
15. App Transport Security's rules and exceptions, and what App Review accepts for them.
16. The App Review Guidelines' current numbers and text: 4.2, 2.1, 1.2, 5.1.1(v), 4.8, 2.5.2, 4.7, 5.1 privacy labels,
    the privacy manifest, export compliance and any yearly report.
17. Background modes `audio` and `voip` and what App Review asks of them.
18. Whether APNs credentials are tied to the developer account so that only its holder can send to the app; Apple's
    rules on push relays and on what a push payload may carry; Notification Service Extension limits.
19. Capacitor's current position on loading a remote URL in production, and how its bridge reaches remote pages.
20. That apps for self-hosted servers (Nextcloud, Home Assistant, Jellyfin, Mattermost) are in the App Store, and how
    their push services work.
21. The Apple Developer Program's fee; an organisation account's D-U-N-S requirement; TestFlight's build lifetime and
    external testers' review; the App Store's screenshot sizes.
22. GitHub Actions macOS runner pricing for this repository; Xcode Cloud's included hours; the minimum Xcode and SDK
    App Store Connect accepts.
23. Whether the simulator can receive push notifications and use a camera in the version the runner has.
24. Android: Web Push in Chrome, the share target for installed web apps, Trusted Web Activity's Digital Asset Links.
25. On Thomas's iPhone, the phone plan's device script in the installed web app, steps 3 and 12, as Stage 0's
    evidence.
