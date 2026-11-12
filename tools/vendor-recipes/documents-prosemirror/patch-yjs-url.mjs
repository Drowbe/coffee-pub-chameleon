// Recipe step: remove the one outside address from Yjs's console.error text (kept out of the file so no allow-list entry is needed).
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; let n = 0;
const OLD = ' - https://github.com/yjs/yjs/issues/438';
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (/\.(js|mjs|cjs)$/.test(e.name)) { const s = fs.readFileSync(p, 'utf8');
    if (s.includes(OLD)) { fs.writeFileSync(p, s.split(OLD).join('')); n++; } } } })(dir);
if (n < 1) throw new Error('yjs url strip: nothing replaced');
console.log('yjs url stripped in ' + n + ' files');
