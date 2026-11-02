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
    const ladder = dark ? [20, 30, 42] : [14, 24, 34];
    return {
      land,
      water: mixA(tok.blue, dark ? tok.bg : tok.section, dark ? 34 : 30),
      park: mixA(tok.green, land, 14),
      wood: mixA(tok.green, land, 8),
      roadMinor: mixA(tok.text, land, ladder[0]),
      roadMedium: mixA(tok.text, land, ladder[1]),
      roadMajor: mixA(tok.text, land, ladder[2]),
      building: mixA(tok.text, land, dark ? 10 : 9),
      label: dark ? mixA(tok.text, tok.dim, 40) : tok.dim,
      boundary: tok.dim,
    };
  }

  // The style. `t` holds the tokens as [r, g, b]; `o` is { tiles, glyphs }. `tiles` is the source address the map library
  // reads (pmtiles://<address of the file>).
  function buildStyle(t, o) {
    const tok = { ...DARK_TOKENS, ...t };
    const m = { ...mapColours(tok), ...(t && t.map) };
    const ground = m.land;
    const font = ['Noto Sans Regular'];
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
      { id: 'boundaries', type: 'line', source: 'map', 'source-layer': 'boundaries', filter: ['in', ['get', 'kind'], ['literal', ['country', 'macroregion', 'region', 'disputed']]], paint: { 'line-color': rgbText(m.boundary), 'line-width': 0.8, 'line-dasharray': [3, 2], 'line-opacity': 0.7 } },
      {
        id: 'places-local',
        type: 'symbol',
        source: 'map',
        'source-layer': 'places',
        filter: ['in', ['get', 'kind_detail'], ['literal', ['neighbourhood', 'macrohood', 'suburb', 'quarter']]],
        minzoom: 12,
        layout: { 'text-field': NAME, 'text-font': font, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.06, 'text-max-width': 8 },
        paint: { 'text-color': rgbText(m.label), 'text-halo-color': rgbText(ground), 'text-halo-width': 1.5 },
      },
      {
        id: 'places-city',
        type: 'symbol',
        source: 'map',
        'source-layer': 'places',
        filter: ['==', ['get', 'kind'], 'locality'],
        layout: { 'text-field': NAME, 'text-font': fontBold, 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 12, 16], 'text-max-width': 8, 'symbol-sort-key': ['get', 'min_zoom'] },
        paint: { 'text-color': rgbText(tok.text), 'text-halo-color': rgbText(ground), 'text-halo-width': 1.6 },
      },
      {
        id: 'places-region',
        type: 'symbol',
        source: 'map',
        'source-layer': 'places',
        filter: ['in', ['get', 'kind'], ['literal', ['country', 'region']]],
        maxzoom: 8,
        layout: { 'text-field': NAME, 'text-font': fontBold, 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 8 },
        paint: { 'text-color': rgbText(tok.dim), 'text-halo-color': rgbText(ground), 'text-halo-width': 1.5 },
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
