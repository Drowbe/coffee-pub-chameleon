// Started by tools/browser-launch.mjs beside each browser: node tools/browser-watchdog.mjs <check pid> <browser pid> <profile dir>
// When the check that started the browser is gone (even by SIGKILL), it kills that browser's process group and deletes the profile
// folder, then exits. It exits by itself when the browser is already gone. Linux only (reads /proc).
// Safety: it kills only the process group whose leader pid is <browser pid>, and only while a member of that group still has
// `--user-data-dir=<profile dir>` on its command line (so a reused pid is never touched). It never matches by name.
import fs from 'node:fs';

const [parentPid, groupPid, dir] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
if (!parentPid || !groupPid || !dir) process.exit(2);

// field 22 of /proc/<pid>/stat is the start time: it tells a pid that was reused from the one we watched
function stat(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = s.slice(s.lastIndexOf(')') + 2).split(' '); // f[0] is field 3 (state)
    return { state: f[0], pgrp: Number(f[2]), start: f[19] };
  } catch { return null; }
}
const parentStart = stat(parentPid)?.start;
function parentAlive() { const s = stat(parentPid); return Boolean(s) && s.start === parentStart && s.state !== 'Z' && s.state !== 'X'; } // one read, so it cannot throw
function members() { // the processes in the browser's group that carry our profile folder
  const out = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const s = stat(name);
    if (!s || s.pgrp !== groupPid) continue;
    try { if (fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0').includes(`--user-data-dir=${dir}`)) out.push(Number(name)); } catch { /* gone */ }
  }
  return out;
}

if (parentStart === undefined) process.exit(0);
const timer = setInterval(() => {
  if (parentAlive()) {
    if (members().length === 0) { clearInterval(timer); process.exit(0); } // the browser finished normally
    return;
  }
  clearInterval(timer);
  if (members().length) { try { process.kill(-groupPid, 'SIGKILL'); } catch { /* gone */ } }
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* harmless */ }
  process.exit(0);
}, 500);
