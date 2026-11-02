#!/usr/bin/env node
/*
 * check-maps.mjs -- run the Maps module's own code (places, coordinates, the style) without a browser.
 * The libraries are written to be inlined into a module page, so they are loaded here as a function body.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const read = (name) => fs.readFileSync(new URL(`../modules/maps/src/${name}`, import.meta.url), 'utf8');
// The SDK's geo helpers, which the page hands to the library.
const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
const win = { addEventListener() {}, location: { search: '' } };
win.parent = win;
new Function('window', 'document', sdk)(win, { createElement: (tag) => ({ tag }) }); // ready() adds the SDK's shared styles: a <style> stand-in
const geo = win.createHost({ call: async () => ({}), root: { appendChild() {} }, rootElement: {} }).host.util.geo;
const names = ['TINTS', 'cleanColors', 'pinColor', 'cssColor', 'pinLook', 'markedFor', 'showHow', 'clusterPoints', 'boundsOf', 'rgbOf', 'mixRgb', 'buildStyle', 'buildPictureStyle', 'mapColours', 'guardMap', 'MAP_MIN', 'ratioOf', 'hueGap', 'pictureLimits', 'capZoom', 'WORLD_MAX_ZOOM'];
const lib = new Function('geo', `${read('maps-lib-c-geo.js')}\n${read('maps-lib-d-style.js')}\n${read('maps-lib-e-pins.js')}\nreturn { ${names.join(', ')} };`)(geo);

let n = 0;
const test = (name, fn) => { fn(); n += 1; };

test('points that would overlap are grouped', () => {
  const project = (lat, lng) => ({ x: lng * 10, y: lat * 10 });
  const g = lib.clusterPoints([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 20 }], project, 36);
  assert.equal(g.length, 2);
  assert.equal(g[0].points.length, 2);
  assert.equal(g[0].lng, 0.5);
  assert.deepEqual(lib.boundsOf([{ lat: 1, lng: 2 }, { lat: 3, lng: -4 }]), [[-4, 1], [2, 3]]);
  assert.equal(lib.boundsOf([]), null);
});

test('colours from the theme, and the style built from them', () => {
  assert.deepEqual(lib.rgbOf('rgb(10, 20, 30)'), [10, 20, 30]);
  assert.deepEqual(lib.rgbOf('rgba(10, 20, 30, 0.5)'), [10, 20, 30]);
  assert.deepEqual(lib.rgbOf('#ff8000'), [255, 128, 0]);
  assert.deepEqual(lib.rgbOf('#fff'), [255, 255, 255]);
  assert.deepEqual(lib.rgbOf('color(srgb 1 0.5 0)'), [255, 127.5, 0]);
  assert.equal(lib.rgbOf('nonsense'), null);
  assert.equal(lib.mixRgb([100, 100, 100], [0, 0, 0], 10), 'rgb(10,10,10)');
  const dark = lib.buildStyle({}, { tiles: 'pmtiles://https://x/y.pmtiles', glyphs: 'https://x/{fontstack}/{range}.pbf' });
  const light = lib.buildStyle({ section: [250, 248, 244], text: [30, 30, 30] }, { tiles: 't', glyphs: 'g' });
  assert.equal(dark.version, 8);
  assert.equal(dark.sources.map.url, 'pmtiles://https://x/y.pmtiles');
  const bg = (s) => s.layers.find((l) => l.id === 'background').paint['background-color'];
  assert.notEqual(bg(dark), bg(light));
  assert.equal(bg(light), 'rgb(250,248,244)');
  assert.ok(!dark.layers.some((l) => l['source-layer'] === 'pois'), 'no points of interest');
  assert.ok(dark.layers.every((l) => l.type === 'background' || l.source === 'map'));
  assert.ok(!JSON.stringify(dark).includes('NaN'));
  // Every place label prefers a feature's English name (name:en, an OpenStreetMap tag) over its local one, never
  // showing blank for a place that simply has none recorded.
  const labels = dark.layers.filter((l) => l['source-layer'] === 'places');
  assert.ok(labels.length >= 3, 'there are place labels to check');
  assert.ok(labels.every((l) => JSON.stringify(l.layout['text-field']) === JSON.stringify(['coalesce', ['get', 'name:en'], ['get', 'name']])));
});

test('the map is readable in both themes: water apart from land, one road ladder, roads above the land', () => {
  // Contrast as WCAG counts it, from the colours the style gives the map library.
  const lum = (c) => { const f = (x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hue = ([r, g, b]) => { const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); if (mx === mn) return 0; const d = mx - mn; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  const themes = {
    dark: { bg: [26, 20, 16], section: [36, 28, 22], text: [241, 230, 216], dim: [168, 153, 138], blue: [106, 166, 232], green: [111, 191, 115] },
    light: { bg: [238, 237, 232], section: [247, 246, 242], text: [24, 23, 20], dim: [85, 83, 75], blue: [42, 98, 176], green: [46, 125, 50] },
  };
  for (const [mode, t] of Object.entries(themes)) {
    const style = lib.buildStyle(t, { tiles: 't', glyphs: 'g' });
    const col = (id, prop) => lib.rgbOf(style.layers.find((l) => l.id === id).paint[prop]);
    const land = col('earth', 'fill-color');
    const water = col('water', 'fill-color');
    assert.ok(ratio(water, land) >= 1.5, `${mode}: water is at least 1.5:1 from the land (${ratio(water, land).toFixed(2)})`);
    const apart = Math.abs(hue(water) - hue(land));
    assert.ok(Math.min(apart, 360 - apart) >= 30, `${mode}: water has its own hue, not only its own lightness`);
    assert.deepEqual(col('waterway', 'line-color'), water, `${mode}: waterways are the water`);
    const [minor, medium, major] = ['roads-minor', 'roads-medium', 'roads-major'].map((id) => col(id, 'line-color'));
    assert.ok(ratio(minor, land) < ratio(medium, land) && ratio(medium, land) < ratio(major, land), `${mode}: roads step up from minor to medium to major`);
    assert.deepEqual(col('roads-path', 'line-color'), minor, `${mode}: a path is a minor road`);
    if (mode === 'dark') for (const [name, c] of [['minor', minor], ['medium', medium], ['major', major]]) assert.ok(ratio(c, land) >= 1.7, `dark: a ${name} road is at least 1.7:1 from the land (${ratio(c, land).toFixed(2)})`);
    assert.ok(ratio(col('landuse', 'fill-color'), land) > 1.04, `${mode}: parks show against the land`);
    assert.ok(hue(col('landuse', 'fill-color')) !== hue(land), `${mode}: parks are green, not the accent`);
    // Only a country's and a region's border; a neighbourhood's would cut a city into dashed pieces.
    const border = style.layers.find((l) => l.id === 'boundaries');
    assert.ok(JSON.stringify(border.filter).includes('"country"') && !JSON.stringify(border.filter).includes('"neighbourhood"') && !JSON.stringify(border.filter).includes('"locality"'), `${mode}: boundaries are country and region level`);
    // A small label reads on the land (4.5:1).
    assert.ok(ratio(col('places-local', 'text-color'), land) >= 4.5, `${mode}: small labels reach 4.5:1`);
  }
  // The theme writes the same ladder as the `--map-*` tokens, which the page hands the style; a token the style needs exists in both modes.
  const css = fs.readFileSync(new URL('../public/sdk/system.css', import.meta.url), 'utf8');
  for (const name of ['land', 'water', 'park', 'wood', 'road-minor', 'road-medium', 'road-major', 'building', 'label', 'boundary']) assert.ok(new RegExp(`--map-${name}:`).test(css), `system.css defines --map-${name}`);
  const light = css.slice(css.indexOf(':root[data-theme-mode="light"],'));
  for (const name of ['land', 'water', 'road-minor', 'road-medium', 'road-major', 'building']) assert.ok(new RegExp(`--map-${name}:`).test(light.slice(0, 2500)), `the light block redefines --map-${name}`);
  assert.ok(!/--map-[a-z-]+:[^;]*(#[0-9a-f]{3}|\brgba?\()/i.test(css), 'the map tokens hold no raw colour');
  const page = read('maps.js');
  assert.match(page, /--map-\$\{name\}/, 'the page reads the --map-* tokens and hands them to the style');
});

test('the map reads on every shipped theme, dark and light, and on a theme that sets the map badly', () => {
  // The shipped themes (the default, Strong Coffee, whose light set is Cream, and the built-in ones), each mode, as the page draws
  // them: the `--map-*` tokens of public/sdk/system.css worked out from the theme's own colours (a small evaluator for the
  // `var()` and `color-mix(in srgb ...)` forms those lines use), handed to the style as the page hands them. Then every pair the
  // reader needs is measured on the colours the style gives the map library, and none may fall below its minimum (lib.MAP_MIN).
  const { DEFAULT_THEME } = createRequire(import.meta.url)('../server/store.js');
  const storeSrc = fs.readFileSync(new URL('../server/store.js', import.meta.url), 'utf8');
  const themes = [DEFAULT_THEME, ...vm.runInNewContext(/const BUILTIN_THEMES = (\[[\s\S]*?\n\]);/.exec(storeSrc)[1])];
  assert.ok(themes.length >= 3, 'the shipped themes were found');
  const css = fs.readFileSync(new URL('../public/sdk/system.css', import.meta.url), 'utf8');
  const lightAt = css.indexOf(':root[data-theme-mode="light"],');
  const decls = (text) => Object.fromEntries([...text.matchAll(/--map-([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].replace(/\/\*.*?\*\//g, '').trim()]));
  const dark = decls(css.slice(0, lightAt));
  const light = { ...dark, ...decls(css.slice(lightAt, css.indexOf('@media', lightAt))) };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const TINTS = { dark: { blue: '#6aa6e8', green: '#6fbf73' }, light: { blue: '#2a62b0', green: '#2e7d32' } }; // public/style.css and host.css
  const mix = (a, b, p) => [0, 1, 2].map((i) => a[i] * p / 100 + b[i] * (100 - p) / 100);
  const evalCss = (e, env) => {
    let m = /^var\(--([a-z-]+)\)$/.exec(e.trim());
    if (m) { assert.ok(env[m[1]], `--${m[1]} is known`); return env[m[1]]; }
    m = /^color-mix\(in srgb,\s*(.*)\)$/.exec(e.trim());
    assert.ok(m, `a form this check reads: ${e}`);
    const parts = []; let cur = ''; let depth = 0;
    for (const ch of m[1]) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    const pa = /^(.*)\s+([\d.]+)%$/.exec(parts[0].trim());
    return mix(evalCss(pa[1], env), evalCss(parts[1], env), Number(pa[2]));
  };
  const KEYS = { land: 'land', water: 'water', park: 'park', wood: 'wood', 'road-minor': 'roadMinor', 'road-medium': 'roadMedium', 'road-major': 'roadMajor', building: 'building', label: 'label', boundary: 'boundary' };
  const drawn = (tok, map) => {
    const style = lib.buildStyle(tok && map ? { ...tok, map } : tok, { tiles: 't', glyphs: 'g' });
    const L = (id) => style.layers.find((l) => l.id === id);
    const c = (id, prop) => lib.rgbOf(L(id).paint[prop]);
    return { style, L, c, land: c('earth', 'fill-color'), water: c('water', 'fill-color') };
  };
  const MIN = lib.MAP_MIN;
  const hold = (name, tok, map, water3 = true) => {
    const { style, L, c, land, water } = drawn(tok, map);
    const need = (what, got, min) => assert.ok(got >= min, `${name}: ${what} is ${got.toFixed(2)}:1, needs ${min}`);
    need('water from the land', lib.ratioOf(water, land), MIN.water);
    // (A land that is itself the water's blue, or one the tint is no lighter or darker than, cannot always be told apart by both; then lightness wins.)
    if (lib.hueGap(tok.blue, land) >= 20 && lib.ratioOf(tok.blue, land) >= MIN.water) assert.ok(lib.hueGap(water, land) >= 14, `${name}: the water has a blue of its own (${lib.hueGap(water, land).toFixed(1)})`);
    need('a park from the land', lib.ratioOf(c('landuse', 'fill-color'), land), MIN.park);
    need('a wood from the land', lib.ratioOf(c('landcover', 'fill-color'), land), MIN.wood);
    need('a building from the land', lib.ratioOf(c('buildings', 'fill-color'), land), MIN.building);
    const roads = [['roads-minor', MIN.roadMinor], ['roads-medium', MIN.roadMedium], ['roads-major', MIN.roadMajor]].map(([id, min]) => { const r = lib.ratioOf(c(id, 'line-color'), land); need(`${id} from the land`, r, min); return r; });
    assert.ok(roads[0] < roads[1] && roads[1] < roads[2], `${name}: the roads step up`);
    const opacity = L('boundaries').paint['line-opacity'];
    need('a border as drawn from the land', lib.ratioOf(mix(c('boundaries', 'line-color'), land, opacity * 100), land), MIN.boundary);
    for (const id of ['places-local', 'places-city', 'places-region']) {
      need(`${id} on the land`, lib.ratioOf(c(id, 'text-color'), land), MIN.label);
      if (water3) need(`${id} on the water`, lib.ratioOf(c(id, 'text-color'), water), MIN.labelWater); // (a theme whose land is a mid grey can put both out of reach: the land, the halo's colour, wins)
      assert.deepEqual(c(id, 'text-halo-color'), land, `${name}: ${id} has a halo in the land colour`);
      const w = L(id).paint['text-halo-width'];
      assert.ok(w >= 1.5 && w <= 2, `${name}: the halo is 1.5 to 2 px`);
    }
  };
  let cases = 0;
  for (const t of themes) {
    for (const mode of ['dark', 'light']) {
      const set = t[mode];
      if (!set) continue;
      const env = { 'surface-page': hex(set['surface-page']), 'surface-panel': hex(set['surface-panel']), 'text-primary': hex(set['text-primary']), 'text-muted': hex(set['text-muted']), 'tint-blue': hex(TINTS[mode].blue), 'tint-green': hex(TINTS[mode].green) };
      const tokens = mode === 'light' ? light : dark;
      const map = {};
      for (const name of Object.keys(KEYS)) { env[`map-${name}`] = evalCss(tokens[name], env); map[KEYS[name]] = env[`map-${name}`]; }
      const tok = { bg: env['surface-page'], section: env['surface-panel'], text: env['text-primary'], dim: env['text-muted'], blue: env['tint-blue'], green: env['tint-green'] };
      hold(`${t.name} ${mode}`, tok, map); // as the page hands the theme's own tokens
      hold(`${t.name} ${mode} (no tokens)`, tok); // as a style built without them
      // The ladder is meant to hold on its own: the clamp only nudges a shipped theme a little (a text colour that is not as dark as another asks for a step more).
      for (const [from, raw] of [['the style', lib.mapColours(tok)], ['system.css', map]]) {
        const kept = lib.guardMap({ ...lib.mapColours(tok), ...raw }, tok);
        for (const [k, v] of Object.entries(raw).filter(([k]) => !['label', 'city', 'region'].includes(k))) assert.ok(v.every((x, i) => Math.abs(x - kept[k][i]) <= 14), `${t.name} ${mode}: the ladder in ${from} is within a small nudge of what the clamp keeps (${k})`);
      }
      // A theme that sets the map tokens badly: every colour the land's own, or the text's own.
      hold(`${t.name} ${mode} (every map token the land)`, tok, Object.fromEntries(Object.values(KEYS).map((k) => [k, map.land])));
      hold(`${t.name} ${mode} (every map token the page)`, tok, Object.fromEntries(Object.values(KEYS).map((k) => [k, tok.bg])));
      cases += 4;
    }
  }
  // Themes a person could make in the editor, drawn at random (a fixed seed): any mix of page, panel, text and muted colours,
  // light or dark, a low-contrast one included, and the tokens set to anything.
  let seed = 20261102;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const colour = () => [0, 1, 2].map(() => Math.floor(rnd() * 256));
  for (let i = 0; i < 400; i++) {
    const mode = i % 2 ? 'light' : 'dark';
    const tok = { bg: colour(), section: colour(), text: colour(), dim: colour(), blue: hex(TINTS[mode].blue), green: hex(TINTS[mode].green) };
    hold(`random theme ${i}`, tok, i % 4 < 2 ? Object.fromEntries(Object.values(KEYS).map((k) => [k, colour()])) : undefined, false);
  }
  assert.ok(cases >= 18, 'every shipped theme and mode was measured');
});

test('several map files are drawn together, layer by layer', () => {
  const one = lib.buildStyle({}, { tiles: 'pmtiles://a', glyphs: 'g' });
  const two = lib.buildStyle({}, { tiles: ['pmtiles://a', 'pmtiles://b'], glyphs: 'g' });
  assert.deepEqual(Object.keys(two.sources), ['map', 'map1']);
  assert.equal(two.sources.map1.url, 'pmtiles://b');
  assert.equal(two.layers.length, 1 + (one.layers.length - 1) * 2);
  const ids = two.layers.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'layer ids stay unique');
  const at = (id) => ids.indexOf(id);
  assert.ok(at('roads-major-1') > at('earth-1') && at('earth-1') === at('earth') + 1, 'a file\'s ground never covers the next one\'s roads');
  assert.equal(two.layers.find((l) => l.id === 'earth-1').source, 'map1');
  assert.equal(one.layers.filter((l) => l.source === 'map').length, one.layers.length - 1);
});

test('a picture map: the theme\'s ground and one layer of picture tiles, nothing else', () => {
  const bounds = [[-180, -42.5], [180, 42.5]];
  const dark = lib.buildPictureStyle({}, { tiles: 'pmtiles://https://x/api/modules/maps/files/w.pmtiles?folder=image-map', minZoom: 0, maxZoom: 5, bounds });
  const light = lib.buildPictureStyle({ section: [250, 248, 244] }, { tiles: 't', minZoom: 0, maxZoom: 5 });
  assert.equal(dark.version, 8);
  assert.deepEqual(dark.layers.map((l) => [l.id, l.type]), [['background', 'background'], ['picture', 'raster']]);
  assert.equal(dark.layers[1].source, 'picture');
  assert.deepEqual(Object.keys(dark.sources), ['picture']);
  assert.deepEqual(dark.sources.picture, { type: 'raster', url: 'pmtiles://https://x/api/modules/maps/files/w.pmtiles?folder=image-map', tileSize: 256, minzoom: 0, maxzoom: 5, bounds: [-180, -42.5, 180, 42.5] });
  assert.ok(!('bounds' in light.sources.picture), 'no bounds given, none set');
  // The ground is --bg-section, as the world map's is.
  assert.equal(light.layers[0].paint['background-color'], 'rgb(250,248,244)');
  assert.equal(dark.layers[0].paint['background-color'], 'rgb(38,30,22)', 'a picture\'s ground is the section colour itself (the world map\'s land is a hair off it)');
  assert.ok(!JSON.stringify(dark).includes('NaN'));
  assert.ok(!dark.layers.some((l) => l.type === 'symbol' || l['source-layer']), 'no labels or map data layers on a picture');
});

test('a picture map never zooms past its file, lands one level above the deepest, and pans only over the picture', () => {
  // Just inside the web map's square: MapLibre's pan limit fails on a longitude of exactly 180 (tried in a browser).
  const L = 85.051128;
  const G = 179.99999;
  const header = { minZoom: 0, maxZoom: 5, minLon: -180, minLat: -42.5, maxLon: 180, maxLat: 42.5 };
  assert.deepEqual(lib.pictureLimits(header, null), { fileMinZoom: 0, fileMaxZoom: 5, minZoom: 0, maxZoom: 5, landZoom: 4, bounds: [[-G, -42.5], [G, 42.5]] });
  assert.deepEqual(lib.pictureLimits({ minZoom: 0, maxZoom: 5, minLon: -40, minLat: -30, maxLon: 60, maxLat: 20 }).bounds, [[-40, -30], [60, 20]], 'a picture narrower than the square keeps its own box');
  // The header wins over the environment's fact; the fact fills in what the header lacks.
  assert.equal(lib.pictureLimits(header, { minZoom: 1, maxZoom: 9 }).maxZoom, 5);
  assert.deepEqual(lib.pictureLimits({}, { file: 'w.pmtiles', minZoom: 1, maxZoom: 4 }), { fileMinZoom: 1, fileMaxZoom: 4, minZoom: 1, maxZoom: 4, landZoom: 3, bounds: [[-G, -L], [G, L]] });
  // Bounds past the web map's square are held to it; bounds that are not a box give the whole square.
  assert.deepEqual(lib.pictureLimits({ minZoom: 0, maxZoom: 3, minLon: -200, minLat: -90, maxLon: 200, maxLat: 90 }).bounds, [[-G, -L], [G, L]]);
  assert.deepEqual(lib.pictureLimits({ minZoom: 0, maxZoom: 3, minLon: 10, minLat: 0, maxLon: 10, maxLat: 5 }).bounds, [[-G, -L], [G, L]]);
  assert.deepEqual(lib.pictureLimits({ minZoom: 0, maxZoom: 3, minLon: 'x', minLat: 0, maxLon: 10, maxLat: 5 }).bounds, [[-G, -L], [G, L]]);
  // A maximum below the minimum is raised to it; nothing past zoom 22.
  assert.deepEqual([lib.pictureLimits({ minZoom: 4, maxZoom: 2 }).fileMaxZoom, lib.pictureLimits({ minZoom: 0, maxZoom: 40 }).maxZoom], [4, 22]);
  // The landing zoom is never above the file's deepest and never below its shallowest.
  assert.deepEqual([lib.pictureLimits({ minZoom: 3, maxZoom: 3 }).landZoom, lib.pictureLimits({ minZoom: 0, maxZoom: 0 }).landZoom, lib.pictureLimits({ minZoom: 2, maxZoom: 6 }).landZoom], [3, 0, 5]);
  assert.equal(lib.pictureLimits(null, null).maxZoom, 0);
  for (const h of [header, {}, { minLon: -500, minLat: -95, maxLon: 500, maxLat: 95 }]) {
    const b = lib.pictureLimits(h).bounds.flat();
    assert.ok(Math.abs(b[0]) < 180 && Math.abs(b[2]) < 180 && Math.abs(b[1]) < 85.0511288 && Math.abs(b[3]) < 85.0511288, `inside the square: ${b}`);
  }
});

test('every fixed zoom is capped at the map\'s maximum', () => {
  assert.equal(lib.WORLD_MAX_ZOOM, 19);
  assert.equal(lib.capZoom(13, 7), 7);
  assert.equal(lib.capZoom(17, 7), 7);
  assert.equal(lib.capZoom(5, 7), 5);
  assert.equal(lib.capZoom(13, 19), 13, 'the world map is as before');
  assert.equal(lib.capZoom(17, undefined), 17);
  assert.equal(lib.capZoom(25, null), 19);
  assert.equal(lib.capZoom('x', 7), 7);
  // On a picture map a selected place, a draft pin and a fit are capped at the landing zoom, a remembered view at the map's maximum.
  assert.equal(lib.capZoom(14, lib.pictureLimits({ minZoom: 0, maxZoom: 5 }).landZoom), 4);
  const src = read('maps.js');
  assert.match(src, /const cap = \(z\) => capZoom\(z, state\.landZoom\);/);
  assert.match(src, /const limit = \(z\) => capZoom\(z, state\.maxZoom\);/);
  assert.match(src, /state\.landZoom = limits\.landZoom;/);
  assert.match(src, /zoom: limit\(Math\.max\(0, Number\(v\.zoom\)\)\)/);
  const page = read('maps.js');
  // select(), draftAt(), "Show where I am": the current zoom or a fixed one, capped.
  assert.equal((page.match(/Math\.max\(state\.map\.getZoom\(\), \d+\)/g) || []).length, (page.match(/cap\(Math\.max\(state\.map\.getZoom\(\), \d+\)\)/g) || []).length);
  assert.ok((page.match(/cap\(Math\.max\(state\.map\.getZoom\(\), \d+\)\)/g) || []).length >= 3);
  // A cluster, a pasted position, a search result, the first view: never a bare number.
  assert.doesNotMatch(page, /maxZoom: \d/, 'a fitBounds maxZoom is capped');
  assert.equal((page.match(/zoom: cap\(15\)/g) || []).length, 3, 'a pasted position (field and page) and a search result are capped');
  assert.deepEqual(page.match(/\bzoom: \d+/g), ['zoom: 2'], 'only the world map\'s opening zoom is a bare number');
  assert.match(page, /zoom: limit\(Math\.max\(0, Number\(v\.zoom\)\)\)/, 'a remembered view is capped at the maximum too');
});

test('a picture map leaves out what means nothing on an invented world, and the world map keeps its credit', () => {
  const page = read('maps.js');
  const html = read('maps.html');
  // The OpenStreetMap credit is its own part of the credit, hidden only on a picture map.
  assert.match(html, /<div class="attribution" data-slot="attribution"><span data-slot="osm">&copy; <a href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>OpenStreetMap<\/a> contributors<\/span><\/div>/);
  assert.match(page, /hide\(slot\(box, 'osm'\), picture\);/);
  assert.match(page, /credit\(metadata, Boolean\(picture\)\);/);
  assert.match(page, /if \(picture\) inMaps\.remove\(\); else \{ inMaps\.href = mapsLink\(/, 'no "Open in my maps app" on a picture');
  assert.match(page, /coords: picture \? '' : coordsText\(/, 'no coordinates in the callout on a picture');
  assert.match(page, /hide\(locateButton, Boolean\(state\.picture\)\)/, 'no "Show where I am" on a picture');
  // The picture's file is read from its own folder, and the picture style is used only with a picture.
  assert.match(page, /picture: pictureOf\(host\.environment && host\.environment\.pictureMap\)/);
  assert.match(page, /const PICTURE_FOLDER = 'image-map';/);
  assert.match(JSON.stringify(JSON.parse(fs.readFileSync(new URL('../modules/maps/module.json', import.meta.url), 'utf8')).settings.find((d) => d.key === 'imageMap')), /"folder":"image-map"/);
  assert.match(page, /if \(picture\) \{\n\s+\/\/[^\n]*\n\s+limits = pictureLimits\(headers\[0\], picture\);/);
  assert.match(page, /state\.style = \(\) => buildStyle\(tokens\(\), \{ tiles: state\.tileUrls, glyphs \}\);/, 'the world map\'s style as before');
  // Search on a picture: saved places only, never the outside search.
  assert.match(page, /if \(state\.picture\) \{ searchSaved\(text\); return; \}\n\s+if \(state\.searcher\) \{ search\(text\); return; \}/);
});

test('nothing is drawn once the module\'s markup is gone (a space left while the map still moves)', () => {
  const page = read('maps.js');
  for (const fn of ['render', 'drawPins', 'drawDraft']) {
    const at = page.indexOf(`  function ${fn}() {\n`);
    assert.ok(at >= 0, `${fn} is there`);
    assert.match(page.slice(at, at + 120), new RegExp(`function ${fn}\\(\\) \\{\\n    if \\(torn\\(\\)\\) return;`), `${fn} stops after teardown`);
  }
  assert.match(page, /function torn\(\) \{\n    if \(host\.rootElement\.isConnected && \$\('tpl-pin'\)\) return false;/);
});

test('a pin is the map library\'s marker: no rule sets the position of .pin itself, so it stays absolute where the library puts it', () => {
  const css = read('maps.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const html = read('maps.html');
  // The pin templates are the markers' own elements (makePin hands them to new maplibregl.Marker).
  assert.match(html, /<template id="tpl-pin"><button class="pin"/);
  assert.match(read('maps.js'), /addMarker\(makePin\(x, /);
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((x) => x.trim());
    // A selector whose last compound is the pin itself (.pin, .pin.selected, .pin[data-cat] ...), not something inside it.
    const onPin = selectors.filter((sel) => /(^|\s|>)\.pin(?![\w-])[^\s>+~]*$/.test(sel) && !sel.includes('::'));
    if (onPin.length) assert.ok(!/(^|;)\s*(position|top|left|right|bottom|inset)\s*:/.test(m[2]), `${onPin.join(', ')} sets the position of a marker: ${m[2].trim().slice(0, 80)}`);
  }
});

test('adding follows Places: its permission decides, the phone is shown the list, one set of words', () => {
  const page = read('maps.js');
  const html = read('maps.html');
  // Maps\' own edit permission no longer gates the adder; Places refuses and the tools go quietly.
  assert.ok(!/if \(canEdit\) state\.adder/.test(page), 'the adder does not depend on Maps\' own edit permission');
  assert.match(page, /a\.name === 'newPlace'[^\n]*a\.may !== false && !state\.refused/);
  assert.match(page, /\/may not add\/\.test\(/);
  assert.match(page, /state\.refused = true; state\.adder = null;/);
  // The Places dialog is revealed on a phone, as show-in-list does.
  assert.match(page, /if \(part && state\.phone && host\.destination\) host\.destination\.set\(\{ reveal: '[a-z]+' \}\)/);
  // One entry, one word: "Add a place" everywhere; the hint while adding is "Click the map to place it". The menu has no second entry.
  assert.match(page, /const ADD_PLACE = 'Add a place';/);
  assert.match(page, /const CLICK_TO_ADD = 'Click the map to place it';/);
  assert.match(page, /return \[\{ id: 'place', label: ADD_PLACE, icon: 'location-dot' \}\];/);
  assert.doesNotMatch(page, /id: 'new'|Add a place on the map/, 'no second add entry, no second phrase');
  // The + menu's one entry opens Places' dialog at once; the click-first mode is the dialog's target button's. The "+" is the
  // host's wherever the map is drawn (plan-unified-layout.md): no + of the map's own, and the search is the host's toolbar field.
  assert.match(page, /if \(e\.id === 'place' && state\.adder\) askNewPlace\(\{\}\);/);
  assert.doesNotMatch(page, /ctrl-add|addHosted|map-search|map-find/, 'no add button or search field of the map\'s own');
  assert.match(page, /type: 'search', id: 'find', value: searchValue/, 'the search is the toolbar\'s field');
  assert.match(page, /if \(e\.submit\) runFind\(searchValue\);/, 'Enter finds what was typed');
  // pickPoint: the map's click-the-map mode for the editor's target button; the spot (or none) is told back through positionPicked.
  assert.match(page, /pickPoint: async \(input\) => \{[\s\S]*?state\.pick = true;[\s\S]*?setAdding\(true\);\s*return \{\};/);
  assert.match(page, /if \(state\.adding && state\.pick\) \{[\s\S]*?tellPicked\(at\);/);
  assert.match(page, /if \(state\.adding && state\.pick\) \{[\s\S]*?tellPicked\(at\);/);
  assert.match(page, /a\.name === 'positionPicked'/);
  assert.match(page, /e\.key === 'Escape' && state\.pick/);
  const manifest = JSON.parse(read('../module.json'));
  assert.ok(manifest.actions.provides.some((a) => a.name === 'pickPoint' && a.local === true), 'the manifest declares pickPoint');
  // Only the asking page's map takes a pick, and not after the asking page gave up (the host's `page` and `pageUntil`).
  const pick = manifest.actions.provides.find((a) => a.name === 'pickPoint');
  assert.ok(pick.input.page === 'string?' && pick.input.pageUntil === 'number?', 'pickPoint takes the host\'s page fields');
  assert.match(page, /pickPoint: async \(input\) => \{\n\s+await startedPromise;\n\s+if \(input && Number\(input\.pageUntil\) < Date\.now\(\)\) throw new Error/, 'a late pick never starts the mode');
  assert.match(page, /host\.actions\.request\(state\.picked\.action, at \? \{ lat: at\.lat, lng: at\.lng \} : \{\}, \{ here: true \}\)/, 'the spot goes back to this page\'s Places');
  // The page's document listeners go with the markup.
  assert.match(page, /const alive = new AbortController\(\);/);
  assert.match(page, /function letGo\(\) \{ if \(!alive\.signal\.aborted\) alive\.abort\(\); \}/);
  for (const m of page.matchAll(/document\.addEventListener\('([a-z]+)'[^\n]*/g)) assert.match(m[0], /\{ signal: alive\.signal \}\);$/, `the document's ${m[1]} listener is taken off with the map`);
  assert.match(page, /function torn\(\) \{\n    if \(host\.rootElement\.isConnected && \$\('tpl-pin'\)\) return false;\n    letGo\(\);/);
  assert.doesNotMatch(html, /data-action="add"|id="map-search"|id="ctrl-add"/, 'the map draws no add button or search band of its own');
  assert.match(html, />Click the map to place it</);
  // A short note is a toast, never text drawn in the module.
  assert.match(page, /host\.ui\.toast\(String\(text\)\)/);
  const contract = read('CONTRACT.md');
  assert.ok(!contract.includes('`addPlace`'), 'the contract names newPlace');
});

test('a pin takes the place\'s colour, else its category\'s, else the category\'s automatic theme tint', () => {
  const page = read('maps.js');
  const css = read('maps.css');
  const c = (category, color) => ({ ref: { scope: 'environment' }, category, ...(color ? { color } : {}) });
  assert.deepEqual(lib.pinColor(c('food', 'red'), { food: '#112233' }), { tint: 'red' }, 'the place\'s own colour first');
  assert.deepEqual(lib.pinColor(c('food'), { food: '#112233' }), { hex: '#112233' }, 'then the owner\'s colour for the category');
  assert.deepEqual(lib.pinColor(c('food'), { food: 'pink' }), { tint: 'pink' }, 'Places may tell a tint name');
  assert.deepEqual(lib.pinColor(c('food'), {}), { tint: 'blue' }, 'else the automatic tint, by the category\'s place in the list');
  assert.deepEqual(lib.pinColor(c('stay'), {}), { tint: 'green' });
  assert.deepEqual(lib.pinColor(c('nightlife'), {}), { tint: 'pink' });
  assert.deepEqual(lib.pinColor(c('transport'), {}), { tint: 'red' });
  assert.deepEqual(lib.pinColor(c('other'), {}), { tint: 'teal' }, 'round again after the eighth');
  assert.deepEqual(lib.pinColor(c('eat'), {}), lib.pinColor(c('food'), {}), 'the old ids read as the new');
  assert.deepEqual(lib.pinColor(c('do'), {}), lib.pinColor(c('activities'), {}));
  assert.deepEqual(lib.pinColor(c('travel'), {}), lib.pinColor(c('transport'), {}));
  const mine = lib.pinColor(c('my-own-kind'), {});
  assert.ok(lib.TINTS.includes(mine.tint), 'any other id takes one of the eight');
  assert.deepEqual(lib.pinColor(c('my-own-kind'), {}), mine, 'the same one each time');
  assert.equal(lib.pinColor(c(''), {}), null, 'no category and no colour: the stylesheet\'s look');
  assert.deepEqual(lib.pinColor(c('', 'gold'), {}), { tint: 'gold' });
  assert.deepEqual(lib.pinColor(c('food', 'magenta'), {}), { tint: 'blue' }, 'a colour that is not a tint is not used');
  assert.equal(lib.cssColor({ tint: 'teal' }), 'var(--tint-teal)');
  const long30 = 'a'.repeat(30);
  assert.deepEqual(lib.cleanColors({ [long30]: '#aabbcc', ['a'.repeat(31)]: '#aabbcc', food: 'blue', bad: 'blue2', x: '#ABCDEF', y: 7 }), { [long30]: '#aabbcc', food: 'blue' }, 'ids to 30 characters; a plain colour or a tint name');
  assert.deepEqual(lib.cleanColors(null), {});
  assert.match(page, /a\.name === 'categoryColors' && a\.open === true/, 'asked of the Places in this page');
  assert.match(page, /host\.actions\.request\(action\.action, \{\}, \{ wait: true, here: true \}\)/);
  assert.ok(!/% 360/.test(page) && !page.includes('BUILT_IN_CATS'), 'no hash hue');
  assert.match(css, /\.pin\[data-cat\]:not\(\.selected\) \{ --pin: var\(--tone\); --pin-text: var\(--tone-ink, var\(--surface-page\)\); \}/);
  assert.ok(!/--turn|oklch/.test(css), 'no turned hues in the stylesheet');
  const places = fs.readFileSync(new URL('../modules/places/src/places-lib.js', import.meta.url), 'utf8'); // the colour rule moved into Places' library (0.11.0)
  assert.match(places, /const AUTO_COLOR = '#888888';/);
  assert.match(places, /const TINTS = \['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red'\];/, 'the same eight, in the same order, as Places');
  const order = [...places.matchAll(/\{ id: '([a-z]+)', label: '[^']+', icon: '[a-z-]+', color: AUTO_COLOR \}/g)].map((m) => m[1]);
  assert.deepEqual(order, ['food', 'stay', 'sights', 'nature', 'activities', 'nightlife', 'shopping', 'transport', 'services', 'health', 'other'], 'Places\' default categories');
});

test('a pin has the place\'s icon and its visit badge', () => {
  const page = read('maps.js');
  const css = read('maps.css');
  const html = read('maps.html');
  const look = (s) => lib.pinLook({ module: { icon: 'location-dot' }, ...s }, {});
  assert.equal(look({ icon: 'mug-hot' }).icon, 'mug-hot', 'the place\'s drawn icon');
  assert.equal(look({}).icon, 'location-dot', 'else its module\'s');
  assert.equal(lib.pinLook({}, {}).icon, 'location-dot');
  assert.deepEqual([look({ visit: 'want' }).visitLabel, look({ visit: 'want' }).visitIcon], ['Want to go', 'bookmark']);
  assert.deepEqual([look({ visit: 'booked' }).visitLabel, look({ visit: 'booked' }).visitIcon], ['Booked', 'calendar-check']);
  assert.deepEqual([look({ visit: 'visited' }).visitLabel, look({ visit: 'visited' }).visitIcon], ['Visited', 'circle-check']);
  assert.deepEqual([look({ visit: 'favorite' }).visitLabel, look({ visit: 'favorite' }).visitIcon], ['Favorite', 'star']);
  assert.equal(look({ visit: 'maybe' }).visit, '', 'no other state');
  const places = fs.readFileSync(new URL('../modules/places/src/places-lib.js', import.meta.url), 'utf8');
  for (const [id, label, icon] of [['want', 'Want to go', 'bookmark'], ['booked', 'Booked', 'calendar-check'], ['visited', 'Visited', 'circle-check'], ['favorite', 'Favorite', 'star']]) assert.ok(places.includes(`{ id: '${id}', label: '${label}', icon: '${icon}' }`), `${id}: the same words and icon as Places' rows`);
  assert.match(html, /<span class="pin-badge" data-visit="">/);
  assert.match(css, /\.pin-badge \{[^}]*border-radius: var\(--radius-round\)/);
  assert.match(page, /const pinName = \(x\) => \(x\.look\.visit \? `\$\{x\.title\}, \$\{x\.look\.visitLabel\}` : x\.title\);/, 'the badge has words in the pin\'s name');
  assert.match(page, /'bookmark', 'calendar-check', 'circle-check', 'star'/, 'the badge icons are fetched');
});

test('a space\'s map shows its places, the environment\'s places marked for it, and the rest softer; each place once', () => {
  const page = read('maps.js');
  const css = read('maps.css');
  const s = (scope, extra = {}) => ({ ref: { scope, id: extra.id || 'p', ...(scope === 'space' ? { space: 'trip' } : {}) }, ...extra });
  const how = (c, filter, space = 'trip') => lib.showHow(c, filter, space);
  const all = { mine: true, environment: true, spaces: new Set(['trip']) };
  const here = { mine: true, environment: false, spaces: new Set(['trip']) };
  const none = { mine: true, environment: true, spaces: new Set() };
  assert.equal(how(s('space'), here), 'full', 'the space\'s own');
  assert.equal(how(s('environment', { spaces: ['trip'] }), here), 'full', 'Everyone\'s places marked for it come with the trip');
  assert.equal(how(s('environment', { spaces: ['other'] }), here), '', 'the rest are not shown until the chip is on');
  assert.equal(how(s('environment'), here), '');
  assert.equal(how(s('environment', { spaces: ['other'] }), all), 'soft', 'the rest, drawn softer');
  assert.equal(how(s('environment'), all), 'soft');
  assert.equal(how(s('environment', { spaces: ['trip'] }), all), 'full', 'a marked one is never soft');
  assert.equal(how(s('environment', { spaces: ['trip'] }), none), '', 'This trip off hides its own and the marked');
  assert.equal(how(s('environment'), none), 'soft');
  assert.equal(how(s('person'), { ...all, mine: false }), '');
  assert.equal(how(s('person'), all), 'full');
  assert.equal(how(s('environment', { spaces: ['trip'] }), null), 'full', 'no filter shows everything');
  assert.equal(how(s('environment'), null), 'soft');
  // on the environment page: the environment's places are as before, never soft; a space's by the spaces on
  assert.equal(how(s('environment', { spaces: ['trip'] }), { mine: true, environment: true, spaces: new Set() }, ''), 'full');
  assert.equal(how(s('environment'), { mine: true, environment: false, spaces: new Set() }, ''), '');
  assert.equal(how(s('space'), { mine: true, environment: false, spaces: new Set(['other']) }, ''), '');
  assert.equal(how(s('space'), { mine: true, environment: false, spaces: new Set(['trip']) }, ''), 'full');
  assert.equal(lib.markedFor({ spaces: ['a', 'trip'] }, 'trip'), true);
  assert.equal(lib.markedFor({ spaces: ['a'] }, 'trip'), false);
  assert.equal(lib.markedFor({}, 'trip'), false);
  // the page asks the environment for the space's marked places with `in`, and draws each pointer once
  assert.match(page, /host\.objects\.search\('', \{ scope: 'environment', has: 'place', in: spaceId \}\)/);
  assert.match(page, /const seen = new Set\(\);[\s\S]*?const id = summaryId\(c\);\s+if \(seen\.has\(id\)\) return false;/, 'one pin per home pointer');
  assert.match(page, /soft: state\.how\.get\(summaryId\(c\)\) === 'soft'/);
  assert.match(css, /\.pin\.soft:not\(\.selected\) \.pin-body \{ background: color-mix\(in srgb, var\(--pin\) 45%, transparent\); box-shadow: none; \}/, 'a softer fill, no added border');
  assert.ok(!/\.pin\.soft[^{]*\{[^}]*border/.test(css), 'no border on a soft pin');
  const dest = fs.readFileSync(new URL('../public/destination.js', import.meta.url), 'utf8');
  assert.ok(dest.includes("label: `All of ${environmentName}'s places`"), 'the map\'s filter in a space has the chip');
});

test('host.objects.search passes in to the server', () => {
  const sdkText = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
  const hostText = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  assert.ok(sdkText.includes("...(o && o.in ? { in: String(o.in) } : {})"));
  assert.ok(hostText.includes("async 'objects.search'({ q, scope: s, space, has, in: marked })"));
  const src = hostText.slice(hostText.indexOf('function objectSearchParams('), hostText.indexOf('// --- end of the search'));
  const placeSrc = hostText.slice(hostText.indexOf('const SPACE_ID'), hostText.indexOf("\n  return { scope: 'space', space };\n}\n") + "\n  return { scope: 'space', space };\n}\n".length);
  const build = new Function(`${placeSrc}\n${src}\nreturn objectSearchParams;`)();
  const p = build('maps', { q: '', scope: 'environment', has: 'place', in: 'trip1' }, { scope: 'space', spaceId: 'S1', moduleScopes: ['environment', 'space'], keyed: false });
  assert.deepEqual([p.get('scope'), p.get('has'), p.get('in')], ['environment', 'place', 'trip1']);
  const q = build('maps', { q: '', scope: 'environment' }, { scope: 'space', spaceId: 'S1', moduleScopes: ['environment', 'space'], keyed: false });
  assert.equal(q.has('in'), false, 'no in unless asked');
});

test('every pin and cluster has its own name and keeps the keyboard where it was; places in one spot can be spread out', () => {
  const page = read('maps.js');
  // The library names a marker "Map marker" as it is added, so the name is set after: one place does it, and nothing else adds a marker.
  assert.match(page, /function addMarker\(el, lngLat, anchor, name\) \{\s*const m = new maplibregl\.Marker\(\{ element: el, anchor \}\)\.setLngLat\(lngLat\)\.addTo\(state\.map\);\s*el\.setAttribute\('aria-label', name\);/);
  assert.equal((page.match(/new maplibregl\.Marker\(/g) || []).length, 2, 'only addMarker and the new place\'s pin make a marker');
  assert.match(page, /draftMarker = new maplibregl\.Marker[^\n]*\n\s*pin\.setAttribute\('aria-label', 'The new place'\);/);
  assert.ok(page.includes('`${g.points.length} places`') && page.includes('`${g.points.length} places found`'), 'a cluster says how many');
  assert.ok(!/setAttribute\('aria-label', `\$\{x\.title\}, \$\{x\.look\.visitLabel\}`\)/.test(page), 'the visit name is not set where the library overwrites it');
  assert.match(page, /const keep = active && active\.classList && active\.classList\.contains\('pin'\)/, 'the focused pin is noted before the redraw');
  assert.match(page, /again\.focus\(\{ preventScroll: true \}\)/, 'and given the focus after it');
  // A cluster of places in one spot: spread round it on a click (fitBounds on a zero-size box does nothing).
  assert.match(page, /if \(together\(g\.points\)\) \{ state\.spread = new Set\(g\.points\.map\(\(x\) => x\.id\)\); drawPins\(\); return; \}/);
  assert.match(page, /state\.spread && g\.points\.every\(\(x\) => state\.spread\.has\(x\.id\)\)/);
  // Search results: brought into view together, near ones clustered.
  assert.match(page, /function fitCandidates\(\)/);
  assert.match(page, /for \(const g of clusterPoints\(state\.candidates,/);
  // Zoomed out only the selected pin and the one pointed at show a name (the stylesheet), so names do not pile up.
  assert.match(page, /labelZoom: 14/);
  assert.match(read('maps.css'), /\.pin\.lowzoom:not\(\.selected\):not\(:hover\):not\(:focus-visible\) \.pin-label \{ display: none; \}/);
});

test('the map follows the list beside it, hides a "+" that would do nothing, and says things once and truthfully', () => {
  const page = read('maps.js');
  assert.match(page, /const changed = Number\(st\.changed\) \|\| 0;\s*if \(lastChanged !== null && changed !== lastChanged && state\.started\)/, 'a change in the list reads the places again now');
  assert.match(page, /a\.name === 'mayAdd' && a\.open === true/);
  assert.match(page, /out\.result\.data\.may === false\) state\.adder = null/);
  assert.ok(!/say\(CLICK_TO_ADD\)/.test(page), '"Click the map to place it" is the banner\'s, not also a toast and a status line');
  assert.ok(!/state\.adding \? \[\{ text: CLICK_TO_ADD \}\]/.test(page), 'and not the status line\'s');
  assert.ok(page.includes('`${matching} of ${n} ${noun} shown`') && page.includes('`${n} ${noun}, no map drawn`'), 'the count says "1 of 5" while filtered and that no map is drawn');
  assert.match(page, /host\.destination\.set\(\{ mapOn: on \}\)/, 'the list is told whether the map is drawn');
  assert.match(page, /if \(open && state\.q && dimmed\(open\)\) select\(null\)/, 'a place the search text does not match is put away');
  const html = fs.readFileSync(new URL('../modules/maps/src/maps.html', import.meta.url), 'utf8');
  assert.ok(html.includes('class="btn btn-small btn-primary" data-action="open-in-maps"') && html.includes('class="btn btn-small" type="button" data-action="copy-coords"'), 'the callout\'s buttons are the SDK\'s');
  assert.ok(!/\.callout-actions \.primary/.test(read('maps.css')), 'no class of its own for the main button');
  assert.match(page, /Open in my maps app' : 'Open in OpenStreetMap'/, 'a desktop says it opens OpenStreetMap');
  assert.ok(/whoever runs the server/.test(html), 'the no-map notice says who puts the file in the data folder');
  const dest = fs.readFileSync(new URL('../public/destination.js', import.meta.url), 'utf8');
  assert.match(dest, /filterOnly: 'Filter places',/);
  const manifest = JSON.parse(fs.readFileSync(new URL('../modules/maps/module.json', import.meta.url), 'utf8'));
  assert.ok(!JSON.stringify(manifest).includes('20260924'), 'the help\'s example build date is one that exists');
});

console.log(`check-maps: OK (${n} checks)`);
