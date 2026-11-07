#!/usr/bin/env node
/*
 * check-compose.mjs -- docker-compose.yml and the Dockerfile agree with the server (plan-attachments-vault.md, step 6).
 * Every variable the compose file sets or shows (commented examples too) is one the server reads; the essential variables
 * are all there; the file is short, pins the image tag, holds no real-looking secret; the library folder (VAULT_DIR) is a volume of its own, apart from the data folder, in the compose file
 * and the Dockerfile; the file has no tabs and its volumes list stays a list. No YAML library: the file is read as text.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const serverText = fs.readdirSync(path.join(ROOT, 'server')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(ROOT, 'server', f), 'utf8')).join('\n');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };

ok(!/\t/.test(compose), 'docker-compose.yml has no tab characters');
// Variables named in the app service's environment, set or in a commented example. LiveKit's own config is not an env var list.
const app = compose.slice(compose.indexOf('\n  chameleon:')); // the app service (LiveKit's own config comes before)
const names = new Set([...app.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]{2,}):\s*["']/gm)].map((m) => m[1]));
ok(names.size >= 10, `the compose file lists the app's variables (${names.size})`);
for (const name of names) ok(new RegExp(`\\b${name}\\b`).test(serverText), `${name} is in docker-compose.yml, so the server must read it`);
for (const name of ['LIVEKIT_HOST', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'ADMIN_LOGIN', 'ADMIN_PASSWORD', 'PRODUCT_NAME', 'BASE_DOMAIN', 'PRODUCT_DOMAIN', 'ENABLE_MFA', 'ADMIN_MFA_LOCKOUT_BYPASS', 'VAULT_DIR']) ok(names.has(name), `${name} is in the compose file`);

const vaultDir = /^\s*VAULT_DIR:\s*"([^"]+)"/m.exec(app)?.[1];
ok(vaultDir && vaultDir.startsWith('/'), 'VAULT_DIR is set to an absolute folder in the container');
const volumes = [...app.matchAll(/^\s*-\s+(\S+):(\/\S+)/gm)].map((m) => ({ host: m[1], target: m[2] }));
const vol = volumes.find((v) => v.target === vaultDir);
ok(vol, `${vaultDir} is a volume`);
const data = volumes.find((v) => v.target === '/app/data');
ok(data && data.host !== vol.host && !vol.host.startsWith(`${data.host}/`), 'and not inside the data folder\'s volume, so a backup of the data stays small');
ok(new RegExp(`ENV VAULT_DIR=${vaultDir}\\b`).test(docker) && docker.includes(`VOLUME ["/app/data", "${vaultDir}"]`), 'the Dockerfile sets the same VAULT_DIR and declares both volumes');

// A short file with a pinned image, no real secrets, and the names the host will see.
ok(compose.split('\n').length < 100, 'the file is under 100 lines');
const image = /^\s*image:\s*ghcr\.io\/drowbe\/coffee-pub-collaborator(\S*)/m.exec(compose);
ok(image && /^:sha-[A-Za-z0-9_]+$/.test(image[1]), 'the app image has a pinned sha- tag (a placeholder is fine)');
ok(!/^\s*image:\s*ghcr.*:latest\b/m.test(compose), 'the app image is not :latest');
ok(/container_name: chameleon-app/.test(compose) && /container_name: chameleon-livekit/.test(compose) && /^  chameleon:/m.test(compose), 'the service and container names are chameleon, chameleon-app and chameleon-livekit');
ok(volumes.filter((v) => v.target === vaultDir).length === 1 && volumes.some((v) => v.target === '/app/data'), 'VAULT_DIR has its own volume line, so the Vault is never an anonymous volume');
for (const m of compose.matchAll(/^\s*(?:LIVEKIT_API_KEY|LIVEKIT_API_SECRET|ADMIN_LOGIN|ADMIN_PASSWORD):\s*"([^"]*)"/gm)) ok(/^CHANGE_ME/.test(m[1]), 'a secret in the file is a CHANGE_ME placeholder');
ok(!/\b(sk-[A-Za-z0-9-]{8,}|sk-ant-[A-Za-z0-9-]{8,}|wrkspc_[A-Za-z0-9]{6,})/.test(compose.replace(/^#.*$/gm, '')), 'no AI key or other real-looking secret is set');
const turnDomain = /domain:\s*(\S+)/.exec(compose)?.[1];
ok(turnDomain && turnDomain === /^\s*LIVEKIT_HOST:\s*"([^"]+)"/m.exec(compose)?.[1], 'LiveKit\'s turn domain and LIVEKIT_HOST are the same');

// The demo seeder runs inside the image (npm run seed:demo): every repository file it imports or reads must be COPYed.
const copied = [...docker.matchAll(/^COPY\s+(?!--)(.+)$/gm)].flatMap((m) => { const a = m[1].trim().split(/\s+/); a.pop(); return a; }).map((s) => s.replace(/^\.\//, '').replace(/\/+$/, ''));
const isCopied = (rel) => copied.some((c) => c === rel || rel.startsWith(`${c}/`));
for (const seeder of ['tools/seed-demo.mjs', 'tools/seed-demo-map.mjs']) {
  ok(isCopied(seeder), `the Dockerfile copies ${seeder}, so npm run seed:demo works in the image`);
  const text = fs.readFileSync(path.join(ROOT, seeder), 'utf8');
  const needs = [...text.matchAll(/(?:from|import\(|require\()\s*'(\.[^']+)'/g)].map((m) => path.posix.join('tools', m[1]));
  for (const m of text.matchAll(/path\.join\(root,\s*((?:'[^']+'(?:,\s*)?)+)\)/g)) needs.push([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).join('/'));
  // `data` is the runtime data folder (the image sets DATA_DIR), not a repository file.
  for (const rel of needs.filter((r) => r !== 'data')) ok(isCopied(rel), `the Dockerfile copies ${rel}, which ${seeder} needs`);
}
// The seeder hands over to the demo loader (server/demo-loader.js), which reads the template's data file.
ok(isCopied('server/demo-loader.js') && isCopied('templates/demo/travel.json'), 'the Dockerfile copies the demo loader and the demo data files');
console.log(`check-compose: ${n} checks OK`);
