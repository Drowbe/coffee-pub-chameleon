# Places

**Audience:** a player or game master keeping a space's places with the Places module on a Coffee Pub Chameleon server, and an owner setting it up.

The Places module keeps the places your space cares about: where you are staying, where to eat, what to see. Each has a name, a category, an address, an optional position, notes and the people it belongs to. It needs no map. Other modules link to a place (a trip stop, an event, a task), and a place with a position shows on the map when the Maps module is installed. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (owner)

1. On the Modules tab, choose **Install** beside Places under **Available with this server**, then **Approve and enable**. It asks to link to other modules' objects.
2. Once enabled it is on in every space; there is no switch per space.
3. **Search (optional).** Under Places' settings (**Module Configuration** on its card), **Place search** chooses where a search for a place by name is asked, and Chameleon sends nothing out unless you choose one:
   - **None** (the default): no search.
   - **Photon, the public service**: searches the server cannot answer from its own saved places are sent to the public Photon service at photon.komoot.io. Its terms are "reasonable limits": extensive use may be throttled or banned, and there is no availability guarantee. Results come from OpenStreetMap data, so "© OpenStreetMap contributors" applies (Chameleon already shows that credit on the map, and the results say "Search by Photon"). The server names itself to the service, as its terms ask: the product name and version, and the project's address (for example `Coffee-Pub-Chameleon/0.4.0 (+https://github.com/Drowbe/coffee-pub-collaborator)`).
   - **My own address**: a Photon-compatible service you run or may use, over https, whose address you enter. A server that already had a search address before this choice existed keeps working, as "My own address".
   - **Save places in this environment** (shown once a search is chosen, off until you turn it on): the server keeps every place a search returns (its OpenStreetMap type and number, name, address, position, category, when it was first and last returned, how often, and whether anyone picked it), and answers later searches from those first, asking the outside service only when fewer than five saved places match. What was searched for, and by whom, is never kept. Each result says whether it came from the server's saved places or from the service. The saved places are OpenStreetMap data: keep them for this server's own use, keep the credit, and check the terms of the service you use before you keep or share what it returns. Turn the setting off and nothing new is kept.
   - **Saved search results** (on the same page): how many places are saved, picked and unpicked, and when the oldest was first seen, with buttons to remove the unpicked ones, the unpicked ones older than a number of days, or everything. Each button asks twice. A place someone picked is kept unless you remove everything.
4. **Categories (optional).** Also under Places' settings, **Categories** is the list places are grouped by, in this order. Each has a name, an icon and a colour. The list starts as **Things to do**, **Food**, **Stay**, **Travel** and **Other**. **Other** is always there and holds any place whose category is not on the list; you can rename it but not remove it. Taking a category off the list changes no place: it shows under **Other**, and its stored category is kept, so putting the category back restores it. A grey colour means the colour is chosen for you; any other colour is the one the map draws that category's pins in.
5. On the Roles tab, under **Module: Places**, choose who can **See places** and who can **Add, change and remove places**. By default everyone can see them, members and moderators can edit, and guests can see but not edit.

## Add a place

- Press the **+** in Places' titlebar (**Add a place**), or **Add a place** on an empty page. The dialog opens empty. Maps' **+** opens the same dialog, so a place is added the same way from either.
- In the dialog, give the place a name and choose its category (from the list the owner keeps; see "Set it up"). Add an address if you have one. **Position** takes coordinates or a map link (a `geo:` link, or one with `?ll=`, `@lat,lng` or `#map=zoom/lat/lng`); it says "Coordinates found." when it could read them, and an empty field means no position. Tick the people it belongs to under **Whose is it**.
- When a map is open beside Places (the **Map** tab, or Global Map), a **target** button sits beside **Position**: it tucks the dialog away, the map waits for a click, and the dialog comes back with that spot filled in.
- **Where** is the first field when the place could go in more than one place: **Mine**, the environment's own places (if you may change places for the whole environment), or a space where you may add places. It starts empty every time, and **Save** says "Pick where it goes first." until you choose. With only one choice it is not asked.
- The dialog opens in a window over the whole page (the whole screen in the narrow layout; beside Map, over the whole page too), with **Save** and **Cancel** always in view at the bottom and a **Close** button in its corner; closing it after typing asks "Discard your changes?". See [Modules](userguide-modules.md), "Add and edit forms".
- A short line about how it went ("Saved in <place>", or why it could not be saved) is a toast: it goes by itself and is never kept on the bell.

Searching for a new place by name is on the map, not here: the search field over the map and the field in the Map tab take a name, and what Places finds is listed with **Save** (see [Maps](userguide-maps.md)). That needs a **Place search** chosen in Places' settings.

Another module can also add a place for you: a trip's stop can offer to save itself as a place.

With a **Picture map** set (an invented world; see [Maps](userguide-maps.md)), the search only looks at places already saved, and **Open in my maps app** is not offered. Places saved before the picture map keep their positions, which mean nothing on it.

## Mine, this space and the environment's

At the top, **Mine**, **This space** and the environment's name (for example **Coffee Pub**) switch between three lists. The environment's list is the places for the whole environment (an office, a regular haunt): everyone in the environment sees them, and anyone who may edit places can add, change and delete there, the same right as in a space. Guests see only the space's. **This space** is what the space shares. **Mine** is your own places: only you can see them, not even an administrator, and they follow you into every space you are in. Guests have only the space's. A place's menu has **Share to this space** (in Mine) or **Save to mine** (in This space), which copies it to the other list and leaves the original where it is. Places you keep in Mine are not linked to trips, events or tasks, so their "used by" pills do not apply. Places also has a page of its own, at `/modules/places`, that shows Mine and the environment's list outside any space; while Global Map is on, that address leads to it.

## Places beside the map

Places is the list on the right of the map in the **Map** tab of a space (the map and the list for that space) and in **Global Map**, which an owner turns on with **Show in the top bar** on Maps' configuration page (see [Maps](userguide-maps.md), "Global Map"). In Global Map it lists, in one list, your own places, the environment's and each space's that **Trips** (your environment's word for spaces) has on. Each place says where it is kept: the person icon and **Mine**, the globe and the environment's name, or the space's icon and name. The search field in the bar above filters the list; with a name typed, **Search for new places** at the foot of the list (or Enter) asks the place search, and **Save** on a result opens the dialog with it filled in. With nothing on in **Trips** the list says "Pick at least one in Trips."; with nothing there, "No places here yet."

To add a place there:

1. Choose **Add a place** at the top of the list, **Save** on a search result, or **+** on the map and click it.
2. In the dialog, choose **Where** it goes: **Mine**, the environment's own places (if you may change places for the whole environment), or a space where you may add places. It starts empty every time, its prompt naming only what you may choose, and **Save** says "Pick where it goes first." until you choose. The category chips count what the filter and the search leave.
3. Fill in the rest as below, and choose **Save**.

A place already saved stays where it is; **Where** shows it and can't be changed. A place you may only read opens read-only, with no **Save** or **Cancel** (close it with the corner **Close** or Escape), with **Where** showing its place, greyed, and says why, such as "Only people who can add places in <space> can change this." The place menu copies a place: **Save to mine** on a shared place, and **Share to <space>** for each space where you may add places on one of yours; the original stays where it was. Click a place with a position to show it on the map; one with no position opens its dialog. In the narrow layout, picking a place with a position switches to the **Maps** tab, and the map's callout has **Show in list** to come back.

## Find and open a place

Places are listed by category, with a chip for each category and a filter box that matches the name, address and notes as you type. Each place shows whether it is **On the map** or has **No position yet**, who it belongs to, and the objects in other modules that point at it. Click a place to open it. When a map module is installed and enabled, clicking a place that has a position shows it on the map instead (the map opens if it is not open); its menu's **Edit** or **View** opens the place itself, and so does a click on a place with no position. Its menu (the three dots) has **Edit**, **Open in my maps app** (which hands the place to the maps app on your device, and searches the address when there is no position), **Copy coordinates** and **Delete**. Someone who may not edit sees **View** and a read-only card.

## When two people edit at once

Changes show up for everyone straight away. If someone changes a place while you have it open, the dialog says so with **Use theirs** and **Keep mine**.

## For module authors

Places provides two actions through the actions conduit (see [the SDK guide](api-module-sdk.md)), and its objects are pointers of kind `place`:

- `addPlace` takes `title` and, optionally, `lat` and `lng` (both or neither), `address`, `category` (`do`, `eat`, `stay`, `travel` or `other`), `notes` and `ref` (a pointer to the object the place is for). It creates the place and returns a pointer to it.
- `setPlacePoint` takes `place` (a pointer to a place) and `lat` and `lng`, and gives that place a position.
- A place's card carries its address as the subtitle and, when it has a position, a `place` (`{ lat, lng }`), which is how a map module finds it.
