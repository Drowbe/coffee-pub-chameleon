#!/usr/bin/env node
/*
 * check-product-name.mjs -- the product's full and short names (server/product-name.js, PRODUCT_NAME).
 *   - the default is "Coffee Pub Chameleon", short "Chameleon";
 *   - PRODUCT_NAME is the FULL name; the short form drops a leading "Coffee Pub " (any letter case, one space), so a
 *     branded "Travel Pub" stays whole and "Coffee Pub Gaming" is "Gaming";
 *   - empty or blank PRODUCT_NAME falls back to the default;
 *   - the user-agent is "<name with hyphens>/<version>" and printable ASCII;
 *   - a throwaway server carries both names in /api/branding and /api/product (productName / name, productShortName).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pn = require('../server/product-name.js');
const version = require('../package.json').version;
let n = 0;
const same = (a, b, msg) => { assert.deepEqual(a, b, msg); n += 1; };

const saved = process.env.PRODUCT_NAME;
const withName = (value, fn) => { if (value === undefined) delete process.env.PRODUCT_NAME; else process.env.PRODUCT_NAME = value; fn(); };
try {
  same(pn.DEFAULT_PRODUCT_NAME, 'Coffee Pub Chameleon', 'the default is the full name');
  withName(undefined, () => {
    same([pn.productName(), pn.shortProductName()], ['Coffee Pub Chameleon', 'Chameleon'], 'unset');
    same(pn.userAgent(), `Coffee-Pub-Chameleon/${version}`, 'the default user-agent');
  });
  withName('Travel Pub', () => same([pn.productName(), pn.shortProductName()], ['Travel Pub', 'Travel Pub'], 'a branded name stays whole'));
  withName('Coffee Pub Gaming', () => same([pn.productName(), pn.shortProductName()], ['Coffee Pub Gaming', 'Gaming'], 'prefix dropped'));
  withName('coffee pub Gaming', () => same(pn.shortProductName(), 'Gaming', 'any letter case'));
  withName('Coffee Pubs', () => same(pn.shortProductName(), 'Coffee Pubs', 'only the prefix and a space'));
  withName('Coffee Pub', () => same(pn.shortProductName(), 'Coffee Pub', 'nothing left: the whole name'));
  for (const blank of ['', '   ']) withName(blank, () => same([pn.productName(), pn.shortProductName()], ['Coffee Pub Chameleon', 'Chameleon'], 'blank falls back'));
  withName('Kollab – Mesa', () => {
    const ua = pn.userAgent({ contact: 'a@b.c' });
    assert.match(ua, /^[\x20-\x7e]+$/, 'printable ASCII');
    same(ua, `Kollab-Mesa/${version} (+a@b.c)`, 'user-agent');
  });
} finally {
  if (saved === undefined) delete process.env.PRODUCT_NAME; else process.env.PRODUCT_NAME = saved;
}

async function withServer(env, fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-product-name-'));
  let out = '';
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the server did not start in time:\n${out}`)), 25000);
      const look = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
      child.stdout.on('data', look);
      child.stderr.on('data', look);
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
    });
    const get = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`, { headers: { accept: 'application/json' } })).json();
    await fn(get);
  } finally {
    if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

for (const [setting, full, short] of [[undefined, 'Coffee Pub Chameleon', 'Chameleon'], ['Travel Pub', 'Travel Pub', 'Travel Pub'], ['Coffee Pub Gaming', 'Coffee Pub Gaming', 'Gaming']]) {
  const env = setting === undefined ? {} : { PRODUCT_NAME: setting };
  await withServer(env, async (get) => {
    const b = await get('/api/branding');
    same([b.productName, b.productShortName], [full, short], `/api/branding for ${setting}`);
    const p = await get('/api/product');
    same([p.name, p.productShortName], [full, short], `/api/product for ${setting}`);
  });
}
console.log(`check-product-name: ${n} assertions OK`);
