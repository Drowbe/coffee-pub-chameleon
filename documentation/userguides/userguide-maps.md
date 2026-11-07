# Maps

**Audience:** a player or game master using the Maps module on a Coffee Pub Chameleon server, and an owner setting it up.

The Maps module shows a map of every place your space has: the places saved in [Places](userguide-places.md), and the objects other modules give a position (a trip stop, an event with a location). Maps keeps nothing of its own and needs [Places](userguide-places.md), which is also the list of places. Install and enable Places first, then Maps; see [Modules](userguide-modules.md).

## Set it up (owner)

**What you need:** the current Chameleon (Maps and its map library ship inside it, so update the server the way you always do), and one map file. Nothing else is installed: no tile server, no database, no extra container, no account and no key.

**On a host with environments,** the map is the host's: one folder of map files that every environment shows, all the files together. Only a host admin puts files there (`DATA_DIR/shared/maps/map-tiles/`) or cuts a region, on the host console's **Maps** panel, which has the same **Add a region** as below and the world map address. A cut is named after what you typed (`thailand.pmtiles` for "thailand"), and **Replace a file already there with that name** lets a fresh cut of the same region go over the old file. An environment's Maps configuration shows those files under **Provided by the host** and sets nothing of its own. On a single server the owner is the operator and the steps below apply as written.

1. **Get a map file.** Maps reads one PMTiles file: a region or the whole world. A city is a few megabytes, a country hundreds, the world well over 100 GB. Regions can be cut from a world file with the `pmtiles extract` tool (a bounding box and a maximum zoom), and no tile server or database is needed.

   **Where to get one.** The world is published as a daily file (about 138 GB when I last checked, zoom 0 to 15) at [maps.protomaps.com/builds](https://maps.protomaps.com/builds); each build's address is `https://build.protomaps.com/YYYYMMDD.pmtiles` with the build's date, `20260924` for example, and that address is what the **World map address** field (the console's Maps panel, or a module's "World file" setting on a single server) takes. You do not download all of it. Install the `pmtiles` tool ([releases](https://github.com/protomaps/go-pmtiles/releases); there is also a `protomaps/go-pmtiles` Docker image) and cut out your area, straight from the web address of the newest file on that page:

   ```
   pmtiles extract <address of the newest planet file> lisbon.pmtiles --bbox=-9.30,38.68,-9.05,38.82 --maxzoom=15
   ```

   `--bbox` is the area as west, south, east, north (longitude and latitude, in degrees); the example is Lisbon. Each extra zoom level roughly doubles the size, so a lower `--maxzoom` (13 or 14) makes a much smaller file. As a guide, all of Italy (`--bbox=6.6,35.4,18.8,47.1`) at `--maxzoom=13` was 1.2 GB and took about two minutes to cut. The map data is © OpenStreetMap contributors (the Open Database Licence), which Chameleon credits on every map.
2. **Put it on the server.** Copy the file into the `map-tiles` folder inside Maps' own folder in the server's data folder, `modules/maps/map-tiles/`. Create the folder if it is not there. The file's name may use letters, digits, dot, dash and underscore, so rename "italy (1).pmtiles" to "italy.pmtiles". A link to a file works. If the picker in the settings is empty, it says which folder Chameleon looked in and lists anything it ignored with the reason; the server's log says the same when it starts. On a Docker or QNAP install the data folder is the volume mounted at `/app/data` in the container; in the sample `docker-compose.yml` that is `/share/appdata/coffee-pub-collaborator` on the NAS, so the file goes in `/share/appdata/coffee-pub-collaborator/modules/maps/map-tiles/`. Updating or uninstalling Maps never deletes what you put there, even if you also choose to delete its saved data.
3. Maps needs Places, so install and enable Places first (its row in the list says so). Then on the Modules tab, choose **Install** beside Maps under **Available with this server**, then **Approve and enable**. It asks to link to other modules' objects and to ask other modules to do things.
4. Once enabled it is on in every space; there is no switch per space.
5. Under Maps' settings (**Module Configuration** on its card), **Map source** says where the map comes from: **A map file on this server** (the default, described here) or **A map file at a web address** (see below). For a file on this server, the **Map files** table lists every file in that folder with its size, its zoom range, whether it holds **Map data** or a **Picture**, and a tick. Tick the ones to use: Maps draws all the ticked files together, so two regions that sit side by side (Italy and Portugal, say) become one map. Untick a file to stop using it. Until one is ticked, Maps says so. A file that holds a picture is refused here ("That file is a picture map. Choose it under Picture map instead."); see "Picture map" below.
6. **Search (optional).** The search belongs to Places: choose its **Place search** in Places' settings (see [Places](userguide-places.md)). With a search chosen, the field at the bottom of the map searches: type a place and press Enter, and what Places finds is listed over the map and shown as pins. Without one (the default) the field says search is not set up and names the module whose setting it is, Maps' configuration page says the same under **Search on the map**, and the field still takes pasted coordinates or a map link.
7. On the Roles tab, under **Module: Maps**, choose who can **See the map** and who can **Save places from the map**. By default everyone can see it, members and moderators can edit, and guests can see but not edit.

**A map file at a web address.** Choose it and give the **Map file address**: an https link to a `.pmtiles` file hosted elsewhere (your own cloud storage or a content delivery network, for example). The map is then read from that host in pieces, so it need not be stored on this server. The cost is privacy: every person's browser contacts that host directly, and the host can see their internet address and roughly which area they are looking at, so choose a host you trust and tell the people who use this server. The host must allow requests from this server's pages (CORS) and support range requests, as static hosting and most content delivery networks do; its terms, cost and reliability are yours to check. Only https addresses work, and an address with a user name or password is refused. If the address does not answer, Maps shows "The map could not load" with Try again. The credit "© OpenStreetMap contributors" stays on the map either way.

Nothing is sent to any service you did not choose: the map comes from your file, and the only outside request is Places' search, if you choose one. The credit "© OpenStreetMap contributors" is always on the map.

## Picture map

A picture map draws your own picture, an invented world, in place of the real-world map. Use it for a fantasy or game map, not a real place.

**What it does.** With a picture map set, Maps draws only that picture, on the theme's background, in every space of the environment and in Global Map. It replaces the world map for the whole environment; there is no switch between the two, and clearing it brings the world map back. Pins, groups of pins, the callout, dropping an object on the map and selecting a place all work as before. Some things make no sense on an invented world and are left out: **Show where I am**, **Open in my maps app**, the coordinates line in the callout (**Copy coordinates** still copies them), and the "© OpenStreetMap contributors" credit (the picture's own credit shows instead, if the file names one). The map zooms in to the file's own deepest level and no further, and pans only over the picture. The search field reads "Search saved places" and looks only at the places already saved: the outside place search (Photon or your own address) knows only the real world, so it is not asked while a picture map is set. Places saved before the picture map keep their positions, which will not mean anything on the picture.

**Who and where.** Owners and the admin. Open Manage, then the **Modules** tab, then **Module Configuration** on Maps' card, and find **Picture map**, under **Map files**. It is the environment's own, even on a server with several environments, so each can have one.

1. Choose **Upload a .pmtiles file** and pick the file. It uploads at once, with a line showing "Uploading... 42%" and then "Checking the file...", and does not wait for Save. The line then reads "<name> uploaded."
2. To replace it, upload another; the old file is removed. To take it away, choose **Clear**, which asks "Clear <name>? The file is deleted now. This can't be undone."

The file must be a PMTiles file of picture tiles (PNG, JPEG or WebP), not map data. The most it may weigh is `MAP_IMAGE_MAX_MB` megabytes, 100 unless the server's owner sets another in the compose file. A backup or a copy of the environment carries the picture; a restore refuses more than 500 MB in all, so keep the picture well under that. Refusals say why: "That is not a PMTiles file.", "That PMTiles file holds map data, not a picture.", "That file is over the limit of 100 MB.", "That PMTiles file looks cut short."

**Make the file.** Maps draws what the file holds, so the picture has to be cut into tiles and placed on the web map's square. One rule for every picture: the longer side of your picture spans the whole square, centred on 0,0. A picture `W` pixels wide and `H` tall, with `S` the larger of the two, covers from `-E*W/S` to `E*W/S` across and `-E*H/S` to `E*H/S` down, where `E` is 20037508.34 metres (half the square). Zoom 0 is the whole square in one 256-pixel tile and each zoom doubles it; the deepest useful zoom is the next whole number above `log2(S / 256)`, which is 6 for a 16384-pixel picture, 5 for 8192 and 4 for 4096. The tiles must be 256 pixels.

The usual way is GDAL (free, a command line tool), then the `pmtiles` tool. For an 8000 by 6000 picture, `-a_ullr` takes the left, top, right and bottom in metres, which come to -20037508.34, 15028131.26, 20037508.34 and -15028131.26:

```
gdal_translate -of GTiff -a_srs EPSG:3857 -a_ullr -20037508.34 15028131.26 20037508.34 -15028131.26 world.png world.tif
gdal_translate -of MBTILES -co TILE_FORMAT=WEBP world.tif world.mbtiles
gdaladdo -r average world.mbtiles 2 4 8 16 32
pmtiles convert world.mbtiles world.pmtiles
```

The first line places the picture, the second cuts it into tiles, the third makes the smaller zooms, and the last turns it into the file Maps wants. For a different size, work out the four numbers with the rule above. This recipe comes from the tools' own documentation and was not run on a real picture while this was written; check the result by uploading it and looking at the map.

If you would rather use Python, this outline does the same with `pip install pillow pmtiles`. It holds the whole picture in memory at the deepest zoom, so it suits pictures up to about 8000 pixels; use GDAL for larger ones. It is an outline, not a tested script: read the `pmtiles` package's own page for the exact calls before you rely on it.

```python
import io, math, sys
from PIL import Image
from pmtiles.tile import zxy_to_tileid, TileType, Compression
from pmtiles.writer import write

Image.MAX_IMAGE_PIXELS = None
src = Image.open(sys.argv[1]).convert("RGBA")      # your picture
out = sys.argv[2]                                  # for example world.pmtiles
W, H = src.size
S = max(W, H)
max_zoom = max(0, math.ceil(math.log2(S / 256)))
R, E = 6378137.0, 20037508.34

def lon_lat(x, y):                                 # metres from the centre to degrees
    return x / R * 180 / math.pi, math.atan(math.sinh(y / R)) * 180 / math.pi

tiles = []
for z in range(max_zoom + 1):
    side = 256 * 2 ** z                            # the whole square, in pixels, at this zoom
    w, h = max(1, round(W * side / S)), max(1, round(H * side / S))
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(src.resize((w, h), Image.LANCZOS), ((side - w) // 2, (side - h) // 2))
    for ty in range(2 ** z):
        for tx in range(2 ** z):
            tile = square.crop((tx * 256, ty * 256, tx * 256 + 256, ty * 256 + 256))
            if tile.getbbox() is None:             # nothing of the picture in this tile
                continue
            data = io.BytesIO()
            tile.save(data, "WEBP", quality=85)
            tiles.append((zxy_to_tileid(z, tx, ty), data.getvalue()))
tiles.sort()                                       # PMTiles wants tiles in tile-id order

west, south = lon_lat(-E * W / S, -E * H / S)
east, north = lon_lat(E * W / S, E * H / S)
with write(out) as writer:
    for tile_id, data in tiles:
        writer.write_tile(tile_id, data)
    writer.finalize({
        "tile_type": TileType.WEBP, "tile_compression": Compression.NONE,
        "min_zoom": 0, "max_zoom": max_zoom,
        "min_lon_e7": int(west * 1e7), "min_lat_e7": int(south * 1e7),
        "max_lon_e7": int(east * 1e7), "max_lat_e7": int(north * 1e7),
        "center_zoom": 0, "center_lon_e7": 0, "center_lat_e7": 0,
    }, {"name": "My world"})
```

## Use the map

- **Save a place.** Press the **+** in Maps' titlebar (**Add a place**): Places' dialog opens, empty, and you finish and save the place there; it then appears on the map. Beside **Position** in the dialog is a **target** button that tucks the dialog away, waits for a click on the map, and brings the dialog back with that spot. You can also paste coordinates ("38.7075, -9.1364") or a map link into the search field over the map, or search there: results show as dashed pins, and clicking one starts a place there. Where a page has no titlebar (Global Map's own page), a **+** at the top left of the map ("Add a place: click the map") does the same, and the status line says "Click the map to place it" while it waits. The dialog asks **Where** the place goes when there is more than one choice. See [Places](userguide-places.md), "Add a place".
- **Look at a place.** Click a pin to open its callout over the map: its name, where it is and where it comes from. **Open in my maps app** hands the place to the maps app on your device, which is where directions come from. **Copy coordinates** copies its position. **Open** takes you to the place or object in its own module, where you change it; the map itself changes nothing. Your own places (from **Mine** in Places) are drawn too, with a small person mark, and only you see them. Pins wear the colour the owner chose for their category in Places' settings (grey is chosen for you). To browse the list of places, use Places, which also shows a place on the map when you click it.
- **Put an object on the map.** Drop an object from another module on the map: if it already has a position it is shown, and if its module can give it one (Places can, for a place with only an address) it is placed where you dropped it.
- **Many places close together** show as one pin with a count; click it to zoom in.
- **The status line** at the foot of the map says how many places it shows ("12 places shown"), how many a search found ("5 found"), or what to do while you are adding one.

## Map in a space and Global Map

In a space, the **Map** tab in the top bar shows the map and Places together for that space. It fills the Workspace, loads as saved each time you press its tab, and does not set you Away on the call. The filter at its left chooses whose places show: this space's, **Mine**, and the environment's own. Maps is also a module in the **Layout** menu, as **Maps**, with Places inside it.

When an owner turns on **Show in the top bar** on Maps' configuration page (see [Manage](userguide-environment-settings.md), "Top bar"), **Global Map** is in the profile menu under your picture, with the Maps icon and the name your environment gives it after the word Global. It puts the map and the list of [Places](userguide-places.md) on one page, across the whole environment and every space you are in. In the narrow layout it is in the top bar's menu, after your spaces. It shows only while Maps is on, a map file or a picture map is set (see "Set it up" above), and you may see Maps for the whole environment. Guests never see it.

1. Choose **Global Map** in the profile menu. If you are in a space, it opens over the space: you are marked Away on the call until you go back, and **Back to <space>** returns you.
2. Click **Trips** (your environment's word for spaces) on the left of the bar under the top bar to choose whose places show: **Mine**, then the environment's own places by the environment's name, then each of your spaces. The button says how many are on, such as "Trips (3 of 5)".
3. Type in the field on the right to find a place. As you type, the list keeps the places that match and the map dims the pins that don't. Press Enter to look the name up with the place search, when Places has one set up: the results show at the top of the list with **Save**, and on the map as dashed pins. Press Escape to clear the field. Coordinates or a map link put a pin there and start a new place.
4. Click a pin to select it: the map shows its callout and the list marks the place. Click a place in the list to fly the map to it.
5. To add a place, choose **+** at the top left of the map ("Add a place: click the map") and click the map, or **Add a place** at the top of the list. Places' dialog opens and asks **Where** it goes (see [Places](userguide-places.md)).

This browser remembers what **Trips** shows, where the map was and, in the narrow layout, the tab. In the narrow layout the page has two tabs at the bottom, **Maps** and **Places**. On a device that can't draw the map, the list takes the whole page.

While Global Map is on, the Maps and Places pages (`/modules/maps`, `/modules/places`) lead to it. Without it, `/modules/maps` shows a map of all your places, from every space you are in, your own and the environment's, with no list beside it; its field takes coordinates or a map link to go there, and places are added from Places or in a space.

## When there is no map

Without a map file, everyone, owners included, sees "Maps is not set up yet. An owner adds map files in Manage. Your places are in the Places module." A device that cannot draw the map (no WebGL) says so; your places are still in Places, each opening in your maps app.
