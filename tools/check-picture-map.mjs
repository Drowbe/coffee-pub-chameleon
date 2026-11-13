#!/usr/bin/env node
/*
 * check-picture-map.mjs -- the picture map (documentation/plans/plan-map-image.md, steps 1 and 2): an environment's one
 * raster PMTiles file, put in by its owner, that replaces the world map. Run on its own and on a throwaway server
 * (PORT=0, DATA_DIR in the temp folder, MAP_IMAGE_MAX_MB set low), with PMTiles files this check builds itself (a real
 * 127-byte header, a minimal gzipped directory and one tile; raster or vector):
 *   - the header's tile type, bounds and zoom range read back (server/pmtiles-header.js), the old zoom reader unchanged;
 *   - the module.json rules (`upload`, `pictureMap`) and the bundled Maps' own declaration;
 *   - PUT /api/modules/:id/files/:folder: a picture file accepted (200, the setting set, the environment's fact there); a
 *     second one replacing the first (the first file gone); a vector file (422), a file that is not PMTiles (415), one cut
 *     short (422), over the limit (413, nothing left behind), a bad name (400), a name another folder holds (409);
 *     signed out (401), a member (403);
 *   - Manage's file listing says "picture" or "vector" for each file, a picture file is refused in the `map` list and a
 *     vector file in the picture setting (400, a plain sentence);
 *   - while it is set the place search answers "not set up" without asking anyone, and answers as before once cleared;
 *     clearing the file (DELETE ...?folder=image-map) clears the setting and the fact.
 * No network beyond localhost, no LiveKit.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { pmtilesInfo, pmtilesZoomRange } = require('../server/pmtiles-header.js');
const { cleanManifest } = require('../server/modules.js');

let n = 0;
const test = async (name, fn) => { await fn(); n += 1; };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-picture-map-'));

// A whole small PMTiles v3 file: header, a gzipped root directory of one tile, and the tile's bytes.
function pmtiles({ tileType = 2, minZoom = 0, maxZoom = 3, bounds = [-180, -85, 180, 85], pad = 0, cutShort = false } = {}) {
  const dir = zlib.gzipSync(Buffer.from([1, 0, 1, 4, 1])); // one entry: tile 0, run 1, length 4, offset 0
  const tile = Buffer.from([1, 2, 3, 4]);
  const head = Buffer.alloc(127);
  head.write('PMTiles', 0, 'ascii');
  head.writeUInt8(3, 7);
  head.writeBigUInt64LE(127n, 8); // root directory
  head.writeBigUInt64LE(BigInt(dir.length), 16);
  head.writeBigUInt64LE(BigInt(127 + dir.length), 56); // tile data
  head.writeBigUInt64LE(BigInt(tile.length), 64);
  head.writeUInt8(1, 97); head.writeUInt8(2, 98); // gzip directories, gzip tiles
  head.writeUInt8(tileType, 99);
  head.writeUInt8(minZoom, 100);
  head.writeUInt8(maxZoom, 101);
  bounds.forEach((d, i) => head.writeInt32LE(Math.round(d * 1e7), 102 + i * 4));
  const whole = Buffer.concat([head, dir, tile, Buffer.alloc(pad)]);
  return cutShort ? whole.subarray(0, 127 + 2) : whole;
}
const PICTURE = pmtiles({ tileType: 2, minZoom: 0, maxZoom: 4 });
const PICTURE_2 = pmtiles({ tileType: 4, minZoom: 1, maxZoom: 5 });
const VECTOR = pmtiles({ tileType: 1, minZoom: 0, maxZoom: 14 });

// --- the header, on its own ---------------------------------------------------------------------------------------
await test('header: tile type, bounds and zoom range; the zoom reader as before', () => {
  const f = (name, buf) => { const p = path.join(base, name); fs.writeFileSync(p, buf); return p; };
  const info = pmtilesInfo(f('a.pmtiles', pmtiles({ tileType: 3, minZoom: 2, maxZoom: 6, bounds: [-10.5, -20.25, 30, 40.125] })));
  assert.equal(info.tileType, 'jpeg');
  assert.equal(info.kind, 'picture');
  assert.deepEqual([info.minZoom, info.maxZoom], [2, 6]);
  assert.deepEqual(info.bounds, { minLon: -10.5, minLat: -20.25, maxLon: 30, maxLat: 40.125 });
  assert.deepEqual(['png', 'jpeg', 'webp', 'avif'].map((t, i) => pmtilesInfo(f(`t${i}.pmtiles`, pmtiles({ tileType: i + 2 }))).tileType), ['png', 'jpeg', 'webp', 'avif']);
  assert.equal(pmtilesInfo(f('v.pmtiles', VECTOR)).kind, 'vector');
  assert.equal(pmtilesInfo(f('u.pmtiles', pmtiles({ tileType: 0 }))).kind, 'unknown');
  assert.deepEqual(pmtilesZoomRange(f('z.pmtiles', PICTURE)), { minZoom: 0, maxZoom: 4 });
  assert.equal(pmtilesInfo(f('bad.pmtiles', Buffer.from('not a pmtiles file at all'.repeat(10)))), null);
  assert.equal(pmtilesInfo(path.join(base, 'missing.pmtiles')), null);
});

await test('manifest: upload and pictureMap are kept; the rules hold', () => {
  const files = new Map([['page.html', Buffer.from('')]]);
  const m = (extra, settings) => ({ id: 'atlas', name: 'Atlas', version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'page.html' } }, settings, ...extra });
  const pic = { key: 'pic', label: 'Picture', type: 'file', folder: 'pics', scope: 'environment', upload: { accept: 'pmtiles-picture' } };
  const ok = cleanManifest(m({ pictureMap: { setting: 'pic' } }, [pic]), files);
  assert.deepEqual(ok.pictureMap, { setting: 'pic' });
  assert.deepEqual(ok.settings[0].upload, { accept: 'pmtiles-picture' });
  assert.equal(cleanManifest(m({}, [pic]), files).pictureMap, null);
  assert.throws(() => cleanManifest(m({ pictureMap: { setting: 'nope' } }, [pic]), files), /pictureMap needs a `setting`/);
  assert.throws(() => cleanManifest(m({ pictureMap: { setting: 'pic' } }, [{ ...pic, upload: undefined }]), files), /pictureMap needs a `setting`/);
  assert.throws(() => cleanManifest(m({}, [{ ...pic, upload: { accept: 'zip' } }]), files), /upload must be/);
  assert.throws(() => cleanManifest(m({}, [{ ...pic, type: 'files' }]), files), /upload must be/);
  assert.throws(() => cleanManifest(m({}, [{ ...pic, shared: 'host' }]), files), /cannot be shared/);
  const maps = cleanManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'maps', 'module.json'), 'utf8')), new Map([['page.html', Buffer.from('')], ['list.html', Buffer.from('')], ['canvas.html', Buffer.from('')]]));
  assert.deepEqual(maps.pictureMap, { setting: 'imageMap' });
  const def = maps.settings.find((d) => d.key === 'imageMap');
  assert.equal(def.type, 'file');
  assert.equal(def.folder, 'image-map');
  assert.equal(def.shared, undefined, 'not shared with the host');
});

// --- a real server ------------------------------------------------------------------------------------------------
const servers = [];
async function startServer(dataDir, extraEnv) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const server = { port, stop: () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) };
  servers.push(server);
  return server;
}
function send(server, method, urlPath, { json, raw, cookie, type = 'application/octet-stream', headers: extra } = {}) {
  const payload = raw !== undefined ? raw : json === undefined ? null : Buffer.from(JSON.stringify(json));
  const headers = { host: `localhost:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = raw !== undefined ? type : 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  Object.assign(headers, extra);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, text, json: body, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const expect = (r, status, what) => assert.equal(r.status, status, `${what}: ${r.status} ${r.text}`);

try {
  const dataDir = path.join(base, 'data');
  const server = await startServer(dataDir, { ADMIN_PASSWORD: 'testpass1234', MAP_IMAGE_MAX_MB: '0.01' }); // 10 485 bytes
  const owner = cookieOf(await send(server, 'POST', '/api/login', { json: { login: 'admin', password: 'testpass1234' } }));
  assert.ok(owner, 'the admin signs in');
  expect(await send(server, 'POST', '/api/users', { cookie: owner, json: { login: 'pat', displayName: 'Pat', role: 'member', password: 'memberpass1234' } }), 201, 'make a member');
  const pat = cookieOf(await send(server, 'POST', '/api/login', { json: { login: 'pat', password: 'memberpass1234' } }));
  for (const id of ['maps']) {
    expect(await send(server, 'POST', `/api/modules/bundled/${id}/install`, { cookie: owner, json: {} }), 201, `install ${id}`);
    expect(await send(server, 'PATCH', `/api/modules/${id}`, { cookie: owner, json: { enabled: true, allSpaces: true } }), 200, `enable ${id}`);
  }
  const folder = path.join(dataDir, 'modules', 'maps', 'image-map');
  const mapFolder = path.join(dataDir, 'modules', 'maps', 'map-tiles');
  const put = (name, raw, cookie = owner, type) => send(server, 'PUT', `/api/modules/maps/files/image-map?name=${name}`, { raw, cookie, type });
  const context = async () => (await send(server, 'GET', '/api/modules/maps/context?scope=environment', { cookie: owner })).json;
  const values = async () => (await send(server, 'GET', '/api/modules/maps/settings/values?scope=environment', { cookie: owner })).json.values;
  const left = () => (fs.existsSync(folder) ? fs.readdirSync(folder).sort() : []);

  await test('before anything: no picture map, the search is asked as before', async () => {
    assert.equal((await context()).environment.pictureMap, null);
    const r = await send(server, 'GET', '/api/modules/maps/geocode?q=paris', { cookie: owner });
    assert.equal(r.status, 200);
    assert.equal(r.json.pictureMap, undefined);
    assert.equal(r.json.configured, false, 'no search chosen, as before');
  });

  await test('refused: signed out, a member, an unknown folder, a bad name, a wrong content type', async () => {
    expect(await put('world.pmtiles', PICTURE, ''), 401, 'signed out');
    expect(await put('world.pmtiles', PICTURE, pat), 403, 'a member');
    expect(await send(server, 'PUT', '/api/modules/maps/files/map-tiles?name=w.pmtiles', { raw: PICTURE, cookie: owner }), 404, 'a folder that takes no upload');
    expect(await send(server, 'PUT', '/api/modules/nothing/files/image-map?name=w.pmtiles', { raw: PICTURE, cookie: owner }), 404, 'no such module');
    const bad = await put('world.png', PICTURE);
    expect(bad, 400, 'not .pmtiles');
    assert.match(bad.json.error, /ending in \.pmtiles/);
    expect(await put('..%2Fw.pmtiles', PICTURE), 400, 'a path in the name');
    expect(await put('world.pmtiles', PICTURE, owner, 'text/plain'), 415, 'a text body');
    assert.deepEqual(left(), [], 'nothing was written');
  });

  await test('refused: not PMTiles (415), map data (422), cut short (422)', async () => {
    const notPm = await put('text.pmtiles', Buffer.from('hello, this is a text file'));
    expect(notPm, 415, 'text');
    assert.equal(notPm.json.error, 'That is not a PMTiles file.');
    expect(await put('empty.pmtiles', Buffer.alloc(0)), 415, 'empty');
    const vec = await put('vec.pmtiles', VECTOR);
    expect(vec, 422, 'vector tiles');
    assert.equal(vec.json.error, 'That PMTiles file holds map data, not a picture.');
    const cut = await put('cut.pmtiles', pmtiles({ cutShort: true }));
    expect(cut, 422, 'cut short');
    assert.equal(cut.json.error, 'That PMTiles file looks cut short.');
    assert.deepEqual(left(), [], 'nothing was left behind');
    assert.equal((await values()).imageMap, '');
  });

  await test('over the limit: 413 whether announced or not, and no file left', async () => {
    const big = pmtiles({ pad: 20000 });
    const r = await put('big.pmtiles', big);
    expect(r, 413, 'over the limit');
    assert.match(r.json.error, /over the limit of 0\.01 MB/);
    // The same without a length in advance: a chunked body, counted as it streams.
    const chunked = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.port, method: 'PUT', path: '/api/modules/maps/files/image-map?name=big2.pmtiles', headers: { host: `localhost:${server.port}`, 'content-type': 'application/octet-stream', cookie: owner, 'transfer-encoding': 'chunked' } }, (res) => {
        let t = '';
        res.on('data', (c) => { t += c; });
        res.on('end', () => resolve({ status: res.statusCode, text: t }));
      });
      req.on('error', reject);
      req.write(big.subarray(0, 8000));
      req.write(big.subarray(8000));
      req.end();
    });
    assert.equal(chunked.status, 413, chunked.text);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(left(), [], 'no part file or file left behind');
    assert.equal((await context()).environment.pictureMap, null);
  });

  await test('a picture file: accepted, the setting set, the environment says so', async () => {
    const r = await put('world.pmtiles', PICTURE);
    expect(r, 200, 'the picture');
    assert.deepEqual(r.json, { name: 'world.pmtiles', size: PICTURE.length, minZoom: 0, maxZoom: 4 });
    assert.deepEqual(left(), ['world.pmtiles']);
    assert.deepEqual(fs.readFileSync(path.join(folder, 'world.pmtiles')), PICTURE);
    assert.equal((await values()).imageMap, 'world.pmtiles');
    assert.deepEqual((await context()).environment.pictureMap, { file: 'world.pmtiles', minZoom: 0, maxZoom: 4, tileType: 'png' });
    // The file reads back by range from its own folder.
    const ranged = await send(server, 'GET', '/api/modules/maps/files/world.pmtiles?folder=image-map', { cookie: owner });
    expect(ranged, 200, 'the file');
    assert.equal(ranged.text.length, PICTURE.length);
    // The environment's own data folder holds it, so a backup carries it (a single install: the data folder itself).
    assert.ok(fs.existsSync(path.join(dataDir, 'modules', 'maps', 'image-map', 'world.pmtiles')));
  });

  await test('the settings listing says picture or vector for each file', async () => {
    fs.mkdirSync(mapFolder, { recursive: true });
    fs.writeFileSync(path.join(mapFolder, 'city.pmtiles'), VECTOR);
    fs.writeFileSync(path.join(mapFolder, 'art.pmtiles'), PICTURE);
    const list = (await send(server, 'GET', '/api/module-settings/environment', { cookie: owner })).json.modules.find((m) => m.id === 'maps').settings;
    assert.deepEqual(list.find((d) => d.key === 'map').kinds, { 'art.pmtiles': 'picture', 'city.pmtiles': 'vector' });
    assert.deepEqual(list.find((d) => d.key === 'map').zooms['city.pmtiles'], { minZoom: 0, maxZoom: 14 });
    assert.deepEqual(list.find((d) => d.key === 'imageMap').kinds, { 'world.pmtiles': 'picture' });
    // `folder` is the manifest's folder name (the full path is under `path`); `shared` is true only when the host really keeps
    // the folder, never the manifest's "host" string (this is a single install, so the maps' own `map` setting is not shared).
    assert.equal(list.find((d) => d.key === 'imageMap').folder, 'image-map');
    assert.ok(path.isAbsolute(list.find((d) => d.key === 'imageMap').path) && list.find((d) => d.key === 'imageMap').path.endsWith('image-map'));
    for (const d of list.filter((x) => x.type === 'file' || x.type === 'files')) {
      assert.ok(!/[\\/]/.test(d.folder), `${d.key}: folder is a name`);
      assert.ok(d.shared === undefined || d.shared === true, `${d.key}: shared is never the manifest string`);
    }
    assert.equal(list.find((d) => d.key === 'map').shared, undefined, 'the maps folder is not shared on a single install');
  });

  await test('a picture file is refused in Map files, map data in Picture map', async () => {
    const inMap = await send(server, 'PUT', '/api/modules/maps/settings/environment', { cookie: owner, json: { values: { map: ['city.pmtiles', 'art.pmtiles'] } } });
    expect(inMap, 400, 'a picture in the map list');
    assert.equal(inMap.json.error, 'That file is a picture map. Choose it under Picture map instead.');
    assert.equal((await values()).map.length, 0, 'the list was not saved');
    expect(await send(server, 'PUT', '/api/modules/maps/settings/environment', { cookie: owner, json: { values: { map: ['city.pmtiles'] } } }), 200, 'map data in the map list');
    const inPic = await send(server, 'PUT', '/api/modules/maps/settings/environment', { cookie: owner, json: { values: { imageMap: 'city.pmtiles' } } });
    // city.pmtiles is not in the picture folder at all, so it is refused as a missing file; put it there to test the kind.
    expect(inPic, 400, 'a name the picture folder does not have');
    fs.writeFileSync(path.join(folder, 'vector.pmtiles'), VECTOR);
    const wrongKind = await send(server, 'PUT', '/api/modules/maps/settings/environment', { cookie: owner, json: { values: { imageMap: 'vector.pmtiles' } } });
    expect(wrongKind, 400, 'map data as the picture');
    assert.equal(wrongKind.json.error, 'That file is map data, not a picture. Choose it under Map files instead.');
    fs.rmSync(path.join(folder, 'vector.pmtiles'));
    assert.equal((await values()).imageMap, 'world.pmtiles');
    // A picture already ticked before this rule is not what blocks saving other settings.
    expect(await send(server, 'PUT', '/api/modules/maps/settings/environment', { cookie: owner, json: { values: { map: [] } } }), 200, 'clearing the list');
  });

  await test('a name another folder holds is refused (409)', async () => {
    const r = await put('city.pmtiles', PICTURE);
    expect(r, 409, 'the same name as a map file');
    assert.match(r.json.error, /already in Map files/);
    assert.deepEqual(left(), ['world.pmtiles']);
  });

  await test('the search is off while it is set, and asks nobody', async () => {
    const r = await send(server, 'GET', '/api/modules/maps/geocode?q=paris', { cookie: owner });
    expect(r, 200, 'the search');
    assert.deepEqual(r.json, { results: [], configured: false, pictureMap: true, message: 'Place search is off while the map is a picture of an invented world.' });
    const cache = path.join(dataDir, 'modules', 'maps', 'geocode.json');
    assert.ok(!fs.existsSync(cache), 'no place collection written');
  });

  await test('a second picture replaces the first: the first file is gone', async () => {
    const r = await put('world2.pmtiles', PICTURE_2);
    expect(r, 200, 'the second picture');
    assert.deepEqual(left(), ['world2.pmtiles']);
    assert.equal((await values()).imageMap, 'world2.pmtiles');
    assert.deepEqual((await context()).environment.pictureMap, { file: 'world2.pmtiles', minZoom: 1, maxZoom: 5, tileType: 'webp' });
    // A refused upload after it changes nothing.
    expect(await put('world3.pmtiles', VECTOR), 422, 'a vector file after');
    assert.deepEqual(left(), ['world2.pmtiles']);
    assert.equal((await values()).imageMap, 'world2.pmtiles');
    // The same name again replaces the file in place.
    expect(await put('world2.pmtiles', PICTURE), 200, 'the same name');
    assert.deepEqual(left(), ['world2.pmtiles']);
    assert.deepEqual((await context()).environment.pictureMap, { file: 'world2.pmtiles', minZoom: 0, maxZoom: 4, tileType: 'png' });
  });

  await test('clearing: the setting, the file and the fact go; the search is as before', async () => {
    expect(await send(server, 'DELETE', '/api/modules/maps/files/world2.pmtiles?folder=image-map', { cookie: pat }), 403, 'a member clearing');
    expect(await send(server, 'DELETE', '/api/modules/maps/files/world2.pmtiles?folder=image-map', { cookie: owner }), 200, 'the owner clearing');
    assert.deepEqual(left(), []);
    assert.equal((await values()).imageMap, '');
    assert.equal((await context()).environment.pictureMap, null);
    const r = await send(server, 'GET', '/api/modules/maps/geocode?q=paris', { cookie: owner });
    assert.equal(r.json.pictureMap, undefined);
    assert.equal(r.json.configured, false);
    assert.ok(fs.existsSync(path.join(mapFolder, 'city.pmtiles')), 'the map files were not touched');
    // Setting it empty by hand (the file stays) also turns it off.
    expect(await put('again.pmtiles', PICTURE), 200, 'upload again');
    expect(await send(server, 'PUT', '/api/modules/maps/settings/environment', { cookie: owner, json: { values: { imageMap: '' } } }), 200, 'unset');
    assert.equal((await context()).environment.pictureMap, null);
  });

  await test('a leftover part file is not listed as a map file', async () => {
    fs.writeFileSync(path.join(folder, '.upload-deadbeef.part'), 'half');
    const list = (await send(server, 'GET', '/api/module-settings/environment', { cookie: owner })).json.modules.find((m) => m.id === 'maps').settings.find((d) => d.key === 'imageMap');
    assert.ok(!list.available.some((f) => f.startsWith('.upload')) && !list.skipped.some((s) => s.name.startsWith('.upload')));
    fs.rmSync(path.join(folder, '.upload-deadbeef.part'));
  });

  await test('bugs found in review: ranges, wrong type, repeated folder, rollback, zoom wording', async () => {
    expect(await put('ranged.pmtiles', PICTURE), 200, 'a file to read');
    const get = (range) => send(server, 'GET', '/api/modules/maps/files/ranged.pmtiles?folder=image-map', { cookie: owner, headers: range ? { range } : {} });
    for (const range of ['bytes=5-4', 'bytes=99999999-', 'bytes=-0']) {
      const r = await get(range);
      expect(r, 416, `range ${range}`);
      assert.equal(r.headers['content-range'], `bytes */${PICTURE.length}`);
      assert.ok(r.json && typeof r.json.error === 'string' && !/server error/.test(r.json.error), 'a plain sentence');
    }
    const ok = await get('bytes=0-9');
    expect(ok, 206, 'a valid range');
    assert.equal(ok.headers['content-range'], `bytes 0-9/${PICTURE.length}`);
    expect(await get(), 200, 'no range');
    fs.writeFileSync(path.join(folder, 'zero.pmtiles'), '');
    expect((await send(server, 'GET', '/api/modules/maps/files/zero.pmtiles?folder=image-map', { cookie: owner })), 200, 'a zero-length file');
    fs.rmSync(path.join(folder, 'zero.pmtiles'));

    const wrong = await send(server, 'PUT', '/api/modules/maps/files/image-map?name=j.pmtiles', { cookie: owner, raw: Buffer.alloc(1048576, 32), type: 'application/json' });
    expect(wrong, 415, 'a 1 MB JSON body');
    assert.equal(wrong.json.error, 'Send the file itself, as application/octet-stream.');

    expect(await send(server, 'DELETE', '/api/modules/maps/files/ranged.pmtiles?folder=image-map&folder=map-tiles', { cookie: owner }), 400, 'repeated folder');
    assert.ok(fs.existsSync(path.join(folder, 'ranged.pmtiles')), 'nothing was removed');

    const zoom = await put('high.pmtiles', pmtiles({ maxZoom: 23 }));
    expect(zoom, 422, 'maxZoom 23');
    assert.equal(zoom.json.error, 'The zoom range is out of range.');
    expect(await put('high.pmtiles', pmtiles({ maxZoom: 22 })), 200, 'maxZoom 22 is fine');
    const rev = await put('rev.pmtiles', pmtiles({ minZoom: 5, maxZoom: 2 }));
    expect(rev, 422, 'a reversed zoom range');
    assert.match(rev.json.error, /zoom range is not valid/);
    const odd = await put('odd.pmtiles', pmtiles({ tileType: 9 }));
    expect(odd, 422, 'an unknown tile type');
    assert.match(odd.json.error, /tile type is not one the map can draw/);
    expect(await put('none.pmtiles', pmtiles({ tileType: 0 })), 422, 'tile type 0');

    // The setting cannot be saved (its temporary file's name is taken by a folder): the rename is rolled back.
    const before = await values();
    const tmpBlock = path.join(dataDir, 'modules', 'settings.json.tmp');
    fs.mkdirSync(tmpBlock, { recursive: true });
    const names = left();
    const bytesBefore = fs.readFileSync(path.join(folder, 'high.pmtiles'));
    expect(await put('stray.pmtiles', PICTURE), 500, 'settings cannot be saved');
    expect(await put('high.pmtiles', PICTURE_2), 500, 'a replacement, settings cannot be saved');
    fs.rmdirSync(tmpBlock);
    assert.deepEqual(left(), names, 'no stray file, no part, no leftover');
    assert.deepEqual(fs.readFileSync(path.join(folder, 'high.pmtiles')), bytesBefore, 'the file it would have replaced is back');
    assert.equal((await values()).imageMap, before.imageMap);
  });

  await server.stop();
  // The default limit when the variable is not set: a file over 0.01 MB goes in (the limit is MAP_IMAGE_MAX_MB, default 100).
  const second = await startServer(path.join(base, 'data2'), { ADMIN_PASSWORD: 'testpass1234' });
  const cookie2 = cookieOf(await send(second, 'POST', '/api/login', { json: { login: 'admin', password: 'testpass1234' } }));
  for (const id of ['maps']) {
    await send(second, 'POST', `/api/modules/bundled/${id}/install`, { cookie: cookie2, json: {} });
    await send(second, 'PATCH', `/api/modules/${id}`, { cookie: cookie2, json: { enabled: true, allSpaces: true } });
  }
  await test('with no MAP_IMAGE_MAX_MB the limit is 100 MB: a 20 kB file goes in', async () => {
    const r = await send(second, 'PUT', '/api/modules/maps/files/image-map?name=big.pmtiles', { raw: pmtiles({ pad: 20000 }), cookie: cookie2 });
    expect(r, 200, 'a 20 kB picture');
  });
} finally {
  await Promise.all(servers.map((s) => s.stop()));
  fs.rmSync(base, { recursive: true, force: true });
}
console.log(`check-picture-map: ${n} groups OK`);
