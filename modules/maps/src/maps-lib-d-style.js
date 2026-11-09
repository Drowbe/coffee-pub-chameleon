  // The map's style, built from the theme's colours (a light theme gets a light map) with the layer names of the
  // basemap schema the map file follows. Fewer layers than a general basemap on purpose: a calm ground for the pins.
  // No points of interest (the pins are those), no sprite. Pure, so it can be checked without a browser.

  // A colour as [r, g, b] (0 to 255), from what a computed style gives (rgb(), rgba(), color(srgb ...)) or a hex code.
  function rgbOf(text) {
    const t = String(text == null ? '' : text).trim();
    let m = t.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    m = t.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
    m = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return null;
  }
  // `a` at `pct` percent over `b`, as a colour string the map accepts.
  const mixRgb = (a, b, pct) => `rgb(${[0, 1, 2].map((i) => Math.round(a[i] * pct / 100 + b[i] * (100 - pct) / 100)).join(',')})`;
  const rgbText = (a) => `rgb(${a.map((x) => Math.round(x)).join(',')})`;

  const DARK_TOKENS = { bg: [26, 18, 6], section: [38, 30, 22], text: [241, 232, 220], dim: [170, 158, 144], accent: [200, 135, 58], border: [70, 60, 50], blue: [106, 166, 232], green: [111, 191, 115] };

  // The map's colours, as [r, g, b]: the same ladder public/sdk/system.css writes as the `--map-*` tokens (the page reads those and
  // hands them in as `t.map`, so a theme that sets one wins); this is what a style built without them uses, so the same
  // look comes out. Land a hair off the ground, water a blue tint, parks a green one, roads one ladder of the text colour (minor,
  // medium, major, each clearly above the land), buildings a quiet step, small labels the text over the dim one.
  const lumOf = (c) => { const f = (x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const mixA = (a, b, pct) => [0, 1, 2].map((i) => a[i] * pct / 100 + b[i] * (100 - pct) / 100);
  function mapColours(tok) {
    const dark = lumOf(tok.text) > lumOf(tok.section);
    const land = dark ? mixA(tok.text, tok.section, 4) : tok.section;
    const ladder = dark ? [20, 30, 42] : [27, 39, 50];
    return {
      land,
      water: mixA(tok.blue, dark ? tok.bg : tok.section, dark ? 72 : 38),
      park: mixA(tok.green, land, 16),
      wood: mixA(tok.green, land, 9),
      roadMinor: mixA(tok.text, land, ladder[0]),
      roadMedium: mixA(tok.text, land, ladder[1]),
      roadMajor: mixA(tok.text, land, ladder[2]),
      building: mixA(tok.text, land, dark ? 10 : 12),
      label: mixA(tok.text, tok.dim, 40),
      boundary: tok.dim,
      city: tok.text,
      region: tok.dim,
    };
  }

  // --- the guarantee: the map reads on any theme -------------------------------------------------------------------------------
  // The tokens above are a good ladder for the shipped themes, but a theme may set a `--map-*` token badly, or have colours that
  // put two of them together. So every colour goes through this clamp last: each is moved (a percent at a time, toward the text
  // colour, else toward black or white) until it holds its minimum against the land. The minimums are WCAG's ratio (lighter + 0.05
  // over darker + 0.05); a colour that already holds is not touched. tools/check-maps.mjs holds them for every shipped theme.
  const MAP_MIN = {
    label: 4.5,       // a place name on the land (it also has a halo in the land colour)
    labelWater: 3,    // ... and on the water, where the halo is thin
    roadMinor: 1.7, roadMedium: 2.3, roadMajor: 3,
    roadStep: 1.1,    // each road class at least this much stronger than the one below
    water: 1.5,       // water from the land, and with a hue of its own (WATER_HUE)
    park: 1.15, wood: 1.06, building: 1.15,
    boundary: 2,      // the dashed line as drawn (at BOUNDARY_OPACITY over the land): visible, still quiet
  };
  const WATER_HUE = 14; // the water's distance from the land on CIELAB's a and b axes: a visible tint of blue, whatever the land's own tint
  const BOUNDARY_OPACITY = 0.7;
  const ratioOf = (a, b) => { const x = lumOf(a); const y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // How far apart two colours are in hue and colourfulness, not lightness: the distance between them on CIELAB's a and b axes
  // (a hue angle says nothing for a land that is almost grey, as a teal theme's is).
  const abOf = (c) => {
    const lin = (x) => { const v = x / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const [r, g, b] = c.map(lin);
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [500 * (x - y), 200 * (y - z)];
  };
  const hueGap = (a, b) => { const p = abOf(a); const q = abOf(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
  // `c` moved toward `to` until `ok(colour)` holds; `to` itself when it never does.
  // Colours are whole numbers throughout, as the style writes them, so what is measured is what is drawn.
  const whole = (c) => c.map(Math.round);
  function nudge(c, to, ok) { for (let p = 0; p <= 100; p += 1) { const x = whole(mixA(to, c, p)); if (ok(x)) return x; } return whole(to); }
  function guardMap(given, tok) {
    const m = Object.fromEntries(Object.entries(given).map(([k, v]) => [k, whole(v)]));
    const land = m.land;
    const ink = ratioOf([255, 255, 255], land) >= ratioOf([0, 0, 0], land) ? [255, 255, 255] : [0, 0, 0]; // the extreme that stands off from the land
    // The colour a stronger mark is mixed toward: the theme's text while it stands off from the land, else black or white.
    const toward = (min) => (ratioOf(tok.text, land) >= min * 1.15 ? tok.text : ink);
    const out = { ...m };
    // A tint of the land: moved from the land toward the tint until `ok` holds; where the tint itself is no lighter or darker than
    // the land, toward the tint made paler or deeper, whichever stands off from it.
    const tinted = (tint, ok) => {
      const pale = mixA([255, 255, 255], tint, 45);
      const deep = mixA([0, 0, 0], tint, 45);
      const [first, second] = ratioOf(pale, land) >= ratioOf(deep, land) ? [pale, deep] : [deep, pale];
      for (const to of [tint, first, second]) { const x = nudge(land, to, ok); if (ok(x)) return x; }
      return nudge(land, first, () => false);
    };
    // Water: its own lightness and its own blue (the blue tint over the land, as far as it takes).
    const blue = tok.blue || DARK_TOKENS.blue;
    const waterOk = (x) => ratioOf(x, land) >= MAP_MIN.water && hueGap(x, land) >= WATER_HUE;
    out.water = waterOk(m.water) ? m.water : tinted(blue, waterOk);
    // Parks and woods: a green step off the land.
    const green = tok.green || DARK_TOKENS.green;
    for (const key of ['park', 'wood']) { const ok = (x) => ratioOf(x, land) >= MAP_MIN[key]; out[key] = ok(m[key]) ? m[key] : tinted(green, ok); }
    // Roads: three steps above the land, each clearly above the one below.
    let below = null;
    for (const [key, min] of [['roadMinor', MAP_MIN.roadMinor], ['roadMedium', MAP_MIN.roadMedium], ['roadMajor', MAP_MIN.roadMajor]]) {
      const need = Math.max(min, below ? ratioOf(below, land) * MAP_MIN.roadStep : 0);
      out[key] = ratioOf(m[key], land) >= need ? m[key] : nudge(m[key], toward(need), (x) => ratioOf(x, land) >= need);
      below = out[key];
    }
    out.building = ratioOf(m.building, land) >= MAP_MIN.building ? m.building : nudge(m.building, toward(MAP_MIN.building), (x) => ratioOf(x, land) >= MAP_MIN.building);
    // The border is drawn at BOUNDARY_OPACITY, so it is the mixed colour that has to show.
    const seen = (x) => mixA(x, land, BOUNDARY_OPACITY * 100);
    out.boundary = ratioOf(seen(m.boundary), land) >= MAP_MIN.boundary ? m.boundary : nudge(m.boundary, toward(MAP_MIN.boundary * 2), (x) => ratioOf(seen(x), land) >= MAP_MIN.boundary);
    // Names: on the land and on the water.
    const legible = (x) => ratioOf(x, land) >= MAP_MIN.label && ratioOf(x, out.water) >= MAP_MIN.labelWater;
    // ... toward the theme's text where that reads on both, else whichever of black and white stands off from both.
    const both = (x) => Math.min(ratioOf(x, land), ratioOf(x, out.water) * MAP_MIN.label / MAP_MIN.labelWater);
    const nameInk = legible(tok.text) ? tok.text : (both([255, 255, 255]) >= both([0, 0, 0]) ? [255, 255, 255] : [0, 0, 0]);
    // (Land and water at once can be out of reach for a theme whose land is a mid grey; the land, which the halo is, wins then.)
    const onLand = (x) => ratioOf(x, land) >= MAP_MIN.label;
    const landInk = ratioOf(tok.text, land) >= MAP_MIN.label ? tok.text : ink;
    for (const key of ['label', 'city', 'region']) {
      if (legible(m[key])) { out[key] = m[key]; continue; }
      const x = nudge(m[key], nameInk, legible);
      out[key] = legible(x) ? x : nudge(m[key], landInk, onLand);
    }
    return out;
  }

  // The style. `t` holds the tokens as [r, g, b]; `o` is { tiles, glyphs }. `tiles` is the source address the map library
  // reads (pmtiles://<address of the file>).
  function buildStyle(t, o) {
    const tok = { ...DARK_TOKENS, ...t };
    const m = guardMap({ ...mapColours(tok), ...(t && t.map) }, tok);
    const ground = m.land;
    const fontBold = ['Noto Sans Medium'];
    // A place's English name where the map data has one (name:en, an OpenStreetMap tag), its own local name otherwise --
    // always readable, never blank for a place that simply has no English name recorded.
    const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name']];
    const width = (a, b, c) => ['interpolate', ['exponential', 1.6], ['zoom'], 5, a, 14, b, 20, c];
    const road = (id, kinds, color, w, extra) => ({
      id,
      type: 'line',
      source: 'map',
      'source-layer': 'roads',
      filter: ['all', ['in', ['get', 'kind'], ['literal', kinds]], ['!=', ['get', 'is_tunnel'], true], ...(extra || [])],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': w },
    });
    const layers = [
      { id: 'background', type: 'background', paint: { 'background-color': rgbText(m.land) } },
      { id: 'earth', type: 'fill', source: 'map', 'source-layer': 'earth', paint: { 'fill-color': rgbText(m.land) } },
      { id: 'landcover', type: 'fill', source: 'map', 'source-layer': 'landcover', paint: { 'fill-color': rgbText(m.wood) } },
      { id: 'landuse', type: 'fill', source: 'map', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['park', 'nature_reserve', 'national_park', 'forest', 'wood', 'grass', 'garden', 'golf_course', 'cemetery', 'pitch', 'playground', 'zoo', 'farmland', 'meadow', 'scrub']]], paint: { 'fill-color': rgbText(m.park) } },
      { id: 'water', type: 'fill', source: 'map', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': rgbText(m.water) } },
      { id: 'waterway', type: 'line', source: 'map', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': rgbText(m.water), 'line-width': width(0.4, 1.6, 6) } },
      { id: 'buildings', type: 'fill', source: 'map', 'source-layer': 'buildings', minzoom: 15, paint: { 'fill-color': rgbText(m.building), 'fill-outline-color': rgbText(m.roadMinor) } },
      road('roads-path', ['path'], rgbText(m.roadMinor), width(0.3, 0.8, 2), []),
      road('roads-minor', ['minor_road', 'other'], rgbText(m.roadMinor), width(0.4, 1.6, 9), []),
      road('roads-medium', ['medium_road'], rgbText(m.roadMedium), width(0.6, 2.4, 12), []),
      road('roads-major', ['major_road', 'highway'], rgbText(m.roadMajor), width(0.8, 3.4, 16), []),
      // Only a country's and a region's border: a neighbourhood's would cut a city into dashed pieces.
      { id: 'boundaries', type: 'line', source: 'map', 'source-layer': 'boundaries', filter: ['in', ['get', 'kind'], ['literal', ['country', 'macroregion', 'region', 'disputed']]], paint: { 'line-color': rgbText(m.boundary), 'line-width': 0.8, 'line-dasharray': [3, 2], 'line-opacity': BOUNDARY_OPACITY } },
      {
        id: 'places-local',
        type: 'symbol',
        source: 'map',
        'source-layer': 'places',
        filter: ['in', ['get', 'kind_detail'], ['literal', ['neighbourhood', 'macrohood', 'suburb', 'quarter']]],
        minzoom: 12,
        layout: { 'text-field': NAME, 'text-font': fontBold, 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.06, 'text-max-width': 8 },
        paint: { 'text-color': rgbText(m.label), 'text-halo-color': rgbText(ground), 'text-halo-width': 2 },
      },
      {
        id: 'places-city',
        type: 'symbol',
        source: 'map',
        'source-layer': 'places',
        filter: ['==', ['get', 'kind'], 'locality'],
        layout: { 'text-field': NAME, 'text-font': fontBold, 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 12, 12, 16], 'text-max-width': 8, 'symbol-sort-key': ['get', 'min_zoom'] },
        paint: { 'text-color': rgbText(m.city), 'text-halo-color': rgbText(ground), 'text-halo-width': 2 },
      },
      {
        id: 'places-region',
        type: 'symbol',
        source: 'map',
        'source-layer': 'places',
        filter: ['in', ['get', 'kind'], ['literal', ['country', 'region']]],
        maxzoom: 8,
        layout: { 'text-field': NAME, 'text-font': fontBold, 'text-size': 13, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 8 },
        paint: { 'text-color': rgbText(m.region), 'text-halo-color': rgbText(ground), 'text-halo-width': 2 },
      },
    ];
    // One map file or several (regions that sit side by side): each is a source, and every layer is drawn for each in turn, so
    // one file's ground never covers another's roads.
    const urls = Array.isArray(o.tiles) ? o.tiles : [o.tiles];
    const sources = {};
    urls.forEach((u, i) => { sources[i ? `map${i}` : 'map'] = { type: 'vector', url: u }; });
    const all = [];
    for (const l of layers) {
      if (l.type === 'background') { all.push(l); continue; }
      urls.forEach((u, i) => all.push(i ? { ...l, id: `${l.id}-${i}`, source: `map${i}` } : l));
    }
    return { version: 8, glyphs: o.glyphs, sources, layers: all };
  }

  // --- a picture map: a picture of an invented world, as one raster PMTiles file (plan-map-image) -----------------------

  // The edges of the web map's square, just inside: the library draws nothing past 85.0511 degrees of latitude, and its
  // pan limit (maxBounds) fails on a box whose longitude is exactly 180 (MapLibre 5.24, tried in a browser).
  const MERCATOR_LAT = 85.051128;
  const EDGE_LNG = 179.99999;
  // The world map's deepest zoom.
  const WORLD_MAX_ZOOM = 19;

  // A zoom the page asks for (on a pin, a new place, a pasted position, a cluster), never past the map's maximum.
  function capZoom(z, max) {
    const m = typeof max === 'number' && Number.isFinite(max) ? max : WORLD_MAX_ZOOM;
    const n = Number(z);
    return Math.min(Number.isFinite(n) ? n : m, m);
  }

  // What a picture map allows, from its file's header ({ minZoom, maxZoom, minLon, minLat, maxLon, maxLat }), else from the
  // environment's own fact ({ minZoom, maxZoom }). The map never zooms past the file's own deepest level (past it the
  // picture only blurs), `landZoom` is where a selected place, a new pin or a fit lands (one level above the deepest, never above the
  // shallowest), and it pans only over the picture: its bounds, else the whole square (the placement rule fills it).
  function pictureLimits(header, pm) {
    const num = (...xs) => xs.find((x) => typeof x === 'number' && Number.isFinite(x));
    const h = header || {};
    const p = pm || {};
    const fileMinZoom = Math.max(0, Math.min(22, Math.round(num(h.minZoom, p.minZoom, 0))));
    const fileMaxZoom = Math.max(fileMinZoom, Math.min(22, Math.round(num(h.maxZoom, p.maxZoom, fileMinZoom))));
    const lng = (x) => Math.max(-EDGE_LNG, Math.min(EDGE_LNG, x));
    const lat = (x) => Math.max(-MERCATOR_LAT, Math.min(MERCATOR_LAT, x));
    const box = [h.minLon, h.minLat, h.maxLon, h.maxLat];
    let bounds = [[-EDGE_LNG, -MERCATOR_LAT], [EDGE_LNG, MERCATOR_LAT]];
    if (box.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      const b = [[lng(box[0]), lat(box[1])], [lng(box[2]), lat(box[3])]];
      if (b[0][0] < b[1][0] && b[0][1] < b[1][1]) bounds = b;
    }
    return { fileMinZoom, fileMaxZoom, minZoom: fileMinZoom, maxZoom: fileMaxZoom, landZoom: Math.max(fileMinZoom, fileMaxZoom - 1), bounds };
  }

  // The style of a picture map: the theme's ground (--bg-section) around the picture, and the picture's tiles over it. `o` is
  // { tiles, minZoom, maxZoom, bounds? }: `tiles` the source address (pmtiles://<address of the file>), the zooms the file's
  // own, `bounds` [[west, south], [east, north]]. Nothing else is drawn: an invented world has no roads or names to add.
  function buildPictureStyle(t, o) {
    const tok = { ...DARK_TOKENS, ...t };
    const source = { type: 'raster', url: o.tiles, tileSize: 256, minzoom: o.minZoom, maxzoom: o.maxZoom };
    if (o.bounds) source.bounds = [o.bounds[0][0], o.bounds[0][1], o.bounds[1][0], o.bounds[1][1]];
    return {
      version: 8,
      sources: { picture: source },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': rgbText(tok.section) } },
        { id: 'picture', type: 'raster', source: 'picture' },
      ],
    };
  }
