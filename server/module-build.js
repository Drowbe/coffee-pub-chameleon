// Builds a module's zip from its source folder (modules/<id>/): module.json plus src/<id>.html,
// .css and .js, with the CSS and JS inlined into the HTML (a module page loads nothing else; see
// documentation/api/api-module-sdk.md). Used by tools/build-module.mjs to write a zip to upload,
// and by the server to install or update a module that ships with the app without uploading one.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// A small zip writer: deflate, no extras.
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zipFiles(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name);
    const packed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, packed);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(8, 10);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(nameBuf.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

// The module in `dir`, built: { manifest, fileCount, zip }. Throws if the folder is not a module.
function buildModule(dir) {
  const manifestPath = path.join(dir, 'module.json');
  if (!fs.existsSync(manifestPath)) throw new Error('that folder has no module.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const read = (name, ext) => fs.readFileSync(path.join(dir, 'src', `${name}.${ext}`), 'utf8');
  const srcFiles = fs.readdirSync(path.join(dir, 'src'));
  // Code more than one of the module's pages shares can live in src/<id>-lib.js, put where the page's script has
  // `/*__LIB__*/`. Function replacements throughout, so "$&" and friends in the code are not treated as patterns.
  // (or several: src/<id>-lib.js first, then src/<id>-lib-*.js in name order). A page of its own (src/<id>-<part>.html, see
  // below) carries its own library the same way, from src/<id>-<part>-lib.js and src/<id>-<part>-lib-*.js, never the module's.
  // Plain data a library carries (src/<id>-lib-<name>.json) goes in first as `const LIB_<NAME> = <json>;` (dashes in the name
  // become underscores), so the file stays data a check can read and the code finds it as a constant.
  const libOf = (owner) => {
    const libFile = `${owner}-lib.js`;
    const isLib = (f) => f === libFile || (f.startsWith(`${owner}-lib-`) && f.endsWith('.js'));
    const libNames = srcFiles.filter(isLib).sort((x, y) => (x === libFile ? -1 : y === libFile ? 1 : x.localeCompare(y)));
    const dataLib = srcFiles.filter((f) => f.startsWith(`${owner}-lib-`) && f.endsWith('.json')).sort()
      .map((f) => {
        const name = f.slice(`${owner}-lib-`.length, -5);
        if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`${f}: the name after "${owner}-lib-" must be lower case letters, digits and dashes`);
        let data;
        try { data = JSON.parse(read(f.slice(0, -5), 'json')); } catch (err) { throw new Error(`${f} is not valid JSON: ${err.message}`); }
        return `const LIB_${name.toUpperCase().replace(/-/g, '_')} = ${JSON.stringify(data)};`;
      });
    return {
      js: [...dataLib, ...libNames.map((f) => read(f.slice(0, -3), 'js'))].join('\n'),
      // Stylesheets of a library the page carries (src/<owner>-lib-*.css, in name order) come before the page's own.
      css: srcFiles.filter((f) => f.startsWith(`${owner}-lib-`) && f.endsWith('.css')).sort().map((f) => read(f.slice(0, -4), 'css')).join('\n'),
    };
  };
  const sharedLib = libOf(manifest.id);
  const build = (name, owner = manifest.id) => {
    const lib = owner === manifest.id ? sharedLib : libOf(owner);
    return read(name, 'html')
      .replace('/*__CSS__*/', () => (name === owner ? lib.css + '\n' : '') + read(name, 'css'))
      .replace('/*__JS__*/', () => read(name, 'js').replace('/*__LIB__*/', () => lib.js).replace(/<\/script/gi, '<\\/script'));
  };
  // The page and the panel are one file; a dashboard widget is its own (src/<id>-widget.*), and so is a keyed
  // page (src/<id>-keyed.*) -- a transparent box for something like OBS is a different page from the module's
  // own, not a variant of it. Both share the same lib.
  const shared = build(manifest.id);
  const files = [['module.json', fs.readFileSync(manifestPath)]];
  const seen = new Set();
  // surfaces.destination is a list of parts (plan-calendar-destination.md), each drawn from the module's own page.
  const entries = Object.entries(manifest.surfaces || {}).flatMap(([surface, def]) => (Array.isArray(def) ? def.map((d) => [surface, d]) : [[surface, def]]));
  for (const [surface, def] of entries) {
    if (!def || typeof def.entry !== 'string' || seen.has(def.entry)) continue;
    seen.add(def.entry);
    // A destination part whose entry is `<part>.html` is its own page when src/<id>-<part>.html exists (Maps' list part, list.html).
    const partPage = surface === 'destination' ? `${manifest.id}-${path.basename(def.entry, '.html')}` : null;
    const own = partPage && partPage !== manifest.id && srcFiles.includes(`${partPage}.html`) ? partPage : null;
    files.push([def.entry, Buffer.from(surface === 'widget' ? build(`${manifest.id}-widget`) : surface === 'keyed' ? build(`${manifest.id}-keyed`) : own ? build(own, own) : shared)]);
  }
  return { manifest, fileCount: files.length, zip: zipFiles(files) };
}

// The modules that ship with this deployment: a folder under modules/ with a module.json and a src/.
function bundledModules(rootDir) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(rootDir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(name)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, name, 'module.json'), 'utf8'));
      if (manifest.id === name && fs.existsSync(path.join(rootDir, name, 'src'))) out.push(manifest);
    } catch {
      // not a module folder
    }
  }
  return out;
}

module.exports = { buildModule, bundledModules, zipFiles };
