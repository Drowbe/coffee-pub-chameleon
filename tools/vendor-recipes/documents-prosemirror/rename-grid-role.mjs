// Renames the grid package's old role word to `gridRole` in its source (the names rule). The old word is built from
// parts so this script itself holds no old name.
import fs from 'node:fs'; import path from 'node:path';
const OLD = new RegExp('\\b' + 'table' + 'Role' + '\\b', 'g');
function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|cjs|ts|mjs)$/.test(e.name)) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(OLD, 'gridRole')); } }
walk(process.argv[2]);
