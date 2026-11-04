#!/usr/bin/env node
// A space's icon is the same everywhere: its link icon, else the template's home icon, else `folder` (the server's
// spaceSummary). The public branding carries `templateHomeIcon` so the pages can do the same; read as code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const server = read('server/index.js');
const brand = read('public/brand.js');
const profile = read('public/profile.js');
const space = read('public/space.js');
const problems = [];
const must = (ok, msg) => { if (!ok) problems.push(msg); };

const branding = server.match(/function branding\(\) \{[\s\S]*?\n\}/)[0];
must(/templateHomeIcon: store\.templateHomeIcon \|\| null/.test(branding), 'branding() does not carry templateHomeIcon');
must(/store\.templateHomeIcon \|\| SPACE_ICON/.test(server) && /const SPACE_ICON = 'folder'/.test(server), "the server's spaceSummary fallback changed");
must(/b\.templateHomeIcon/.test(brand), 'brand.js does not read branding.templateHomeIcon');
must(/templateHomeIcon \|\| 'folder'/.test(brand), "brand.js spaceIconId does not fall back to the template's home icon, then folder");
must(/spaceIconId\(spacesById\.get\(id\)\)/.test(profile), "profile.js does not use spaceIconId for a space's icon");
must(!/linkIcon !== 'link' \? [^:]+ : 'folder'/.test(profile), 'profile.js still falls back to folder by itself');
must(/spaceCrumbIcon\(null\)/.test(space) && !/'message'/.test(space.match(/const iconOf = .*/)[0]), "space.js uses a chat icon when no space is open");
assert.deepEqual(problems, [], problems.join('\n'));
console.log('check-space-icon: OK');
