// `npm run seed:demo-map`: makes a small map file of Lisbon, Sintra and Porto for the demo space, and ticks it in the Maps module.
// It needs the network. It reads the newest public Protomaps build (https://build.protomaps.com/YYYYMMDD.pmtiles) with HTTP range
// requests, using the Maps module's own bundled PMTiles reader, keeps only the tiles of three small boxes, and writes one PMTiles file
// to DATA_DIR/modules/maps/map-tiles/demo-portugal.pmtiles (DATA_DIR from the environment, else the repository's data folder: the
// same folder the server uses). Then it signs in (SEED_URL / PORT / ADMIN_LOGIN / ADMIN_PASSWORD, as seed:demo does) and ticks the file.
// The file is a few MB at most and is never committed; delete it from Manage to remove it.
// `npm run seed:demo` runs this too (seedMap below) unless SEED_MAP=0; there, being offline is one quiet message, not a failure.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolveTarget } from './seed-demo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_NAME = 'demo-portugal.pmtiles';
const MAX_ZOOM = Number(process.env.DEMO_MAP_ZOOM) || 12;
// [minLon, minLat, maxLon, maxLat]: central Lisbon with Belem, Sintra, and central Porto.
const BOXES = [[-9.50, 38.68, -9.10, 38.82], [-8.66, 41.12, -8.57, 41.18]];

const say = (m) => console.log(m);
const pm = new Function(`${fs.readFileSync(path.join(root, 'modules', 'maps', 'src', 'maps-lib-b-pmtiles.js'), 'utf8')};return pmtiles;`)();

class Offline extends Error {}
async function newestBuild() {
  for (let back = 0; back < 20; back += 1) {
    const d = new Date(Date.now() - back * 86400000);
    const url = `https://build.protomaps.com/${d.toISOString().slice(0, 10).replace(/-/g, '')}.pmtiles`;
    try {
      const r = await fetch(url, { headers: { range: 'bytes=0-1' } });
      if (r.status === 206 || r.status === 200) return url;
    } catch (e) { throw new Offline(`Cannot reach build.protomaps.com (${e.cause?.code || e.message}). This needs the network.`); }
  }
  throw new Error('Found no Protomaps build in the last 20 days.');
}

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };

export async function seedMap({ base, login = 'admin', adminPassword = '', say = console.log, folded = false } = {}) {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
  const dir = path.join(dataDir, 'modules', 'maps', 'map-tiles');
  let src;
  try { src = await newestBuild(); } catch (e) {
    if (folded && e instanceof Offline) return { done: false, message: 'skipped, the map build could not be reached (offline). Run npm run seed:demo-map when online.' };
    throw e;
  }
  say(`Reading ${src}`);
  const source = {
    getKey: () => src,
    getBytes: async (offset, length) => {
      const r = await fetch(src, { headers: { range: `bytes=${offset}-${offset + length - 1}` } });
      if (r.status >= 300) throw new Error(`The build answered ${r.status}.`);
      return { data: await r.arrayBuffer() };
    },
  };
  const p = new pm.PMTiles(source);
  const meta = await p.getMetadata();
  const wanted = [];
  for (let z = 0; z <= MAX_ZOOM; z += 1) {
    const seen = new Set();
    for (const [a, b, c, d] of BOXES) {
      for (let x = lon2x(a, z); x <= lon2x(c, z); x += 1) for (let y = lat2y(d, z); y <= lat2y(b, z); y += 1) seen.add(`${x}/${y}`);
    }
    for (const k of seen) { const [x, y] = k.split('/').map(Number); wanted.push([z, x, y]); }
  }
  say(`${wanted.length} tiles to read.`);
  const tiles = [];
  for (let i = 0; i < wanted.length; i += 8) {
    const got = await Promise.all(wanted.slice(i, i + 8).map(async ([z, x, y]) => ({ z, x, y, r: await p.getZxy(z, x, y) })));
    for (const { z, x, y, r } of got) {
      if (!r) continue;
      let buf = Buffer.from(r.data);
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
      tiles.push({ id: pm.zxyToTileId(z, x, y), d: buf });
    }
    if ((i / 8) % 10 === 0) say(`  ${Math.min(i + 8, wanted.length)} of ${wanted.length}`);
  }
  tiles.sort((a, b) => a.id - b.id);
  const varint = (arr, v) => { while (v >= 128) { arr.push((v % 128) | 128); v = Math.floor(v / 128); } arr.push(v); };
  const dirBytes = [];
  varint(dirBytes, tiles.length);
  let last = 0;
  for (const t of tiles) { varint(dirBytes, t.id - last); last = t.id; }
  for (let i = 0; i < tiles.length; i += 1) varint(dirBytes, 1);
  for (const t of tiles) varint(dirBytes, t.d.length);
  let off = 0;
  tiles.forEach((t, i) => { varint(dirBytes, i > 0 ? 0 : off + 1); off += t.d.length; });
  const rootDir = zlib.gzipSync(Buffer.from(dirBytes));
  if (127 + rootDir.length > 16384) throw new Error('Too many tiles for one directory; lower DEMO_MAP_ZOOM.');
  const metaBytes = zlib.gzipSync(Buffer.from(JSON.stringify(meta)));
  const data = Buffer.concat(tiles.map((t) => t.d));
  const H = Buffer.alloc(127);
  H.write('PMTiles', 0); H[7] = 3;
  let o = 8;
  const u64 = (v) => { H.writeBigUInt64LE(BigInt(v), o); o += 8; };
  u64(127); u64(rootDir.length); u64(127 + rootDir.length); u64(metaBytes.length); u64(127 + rootDir.length + metaBytes.length); u64(0);
  u64(127 + rootDir.length + metaBytes.length); u64(data.length); u64(tiles.length); u64(tiles.length); u64(tiles.length);
  H[o++] = 1; H[o++] = 2; H[o++] = 1; H[o++] = 1; H[o++] = 0; H[o++] = MAX_ZOOM; // clustered, gzip directories, uncompressed tiles, vector tiles, zooms
  const i32 = (v) => { H.writeInt32LE(Math.round(v * 1e7), o); o += 4; };
  const minLon = Math.min(...BOXES.map((b) => b[0])); const minLat = Math.min(...BOXES.map((b) => b[1]));
  const maxLon = Math.max(...BOXES.map((b) => b[2])); const maxLat = Math.max(...BOXES.map((b) => b[3]));
  i32(minLon); i32(minLat); i32(maxLon); i32(maxLat); H[o++] = 11; i32(-9.14); i32(38.72);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, OUT_NAME);
  fs.writeFileSync(file, Buffer.concat([H, rootDir, metaBytes, data]));
  say(`Wrote ${file} (${tiles.length} tiles, ${Math.round((127 + rootDir.length + metaBytes.length + data.length) / 1024)} KB).`);

  // Tick it in the Maps module.
  const signIn = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: adminPassword }) }).catch(() => null);
  if (!signIn || signIn.status !== 200) { const message = `${OUT_NAME} is in place, but ticking it needs the server: No server answered at ${base}, or the sign-in failed. Tick it in Manage, on the Maps module's settings.`; say(message); return { done: false, message }; }
  const cookie = signIn.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const all = await call('GET', '/api/module-settings/environment');
  const maps = ((all.json && all.json.modules) || []).find((m) => m.id === 'maps');
  const current = maps && (maps.settings.find((s) => s.key === 'map') || {}).value;
  const ticked = [...new Set([...(Array.isArray(current) ? current : []), OUT_NAME])];
  const r = await call('PUT', '/api/modules/maps/settings/environment', { values: { map: ticked } });
  const message = r.status < 300 ? `made and ticked ${OUT_NAME} for the Maps module (${tiles.length} tiles). Open the Map from the top bar.` : `could not tick ${OUT_NAME} (${r.status}: ${r.json && r.json.error}). Tick it in Manage.`;
  say(message);
  return { done: r.status < 300, message, file };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) seedMap({ base: resolveTarget(), login: process.env.ADMIN_LOGIN || 'admin', adminPassword: process.env.ADMIN_PASSWORD || '' }).catch((e) => { console.error(`seed:demo-map failed: ${e.message}`); process.exit(1); });
