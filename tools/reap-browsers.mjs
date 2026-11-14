// Kills the Chrome processes a dead check left behind. Safe to run when there are none.
//   node tools/reap-browsers.mjs [--min-age=<seconds, default 300>] [--dry-run] [--only-under=<folder>]
// It kills ONLY a process that is all of: owned by you, named like a Chrome (chrome, chromium, headless_shell, chrome-headless-shell),
// whose parent is pid 1 (its starter is gone), and older than the minimum age. A Chrome whose parent is alive is never touched,
// so another job's browser is safe. It also requires `--user-data-dir=` under os.tmpdir() with a profile prefix from
// tools/browser-profiles.mjs, so a browser started by anything else (or a driver such as chromedriver) is never matched. It kills each pid by itself (never by name, never a group), and prints how many it found.
// --only-under=<folder> narrows it further to processes whose command line mentions that folder (the test uses it).
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { BROWSER_PROFILE_PREFIXES } from './browser-profiles.mjs';

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const minAge = arg('min-age') === '' ? 300 : Number(arg('min-age'));
const dry = process.argv.includes('--dry-run');
const under = arg('only-under');
if (!Number.isFinite(minAge) || minAge < 0) { console.error('reap-browsers: --min-age must be a number of seconds'); process.exit(2); }

const NAME = /^(?:(?:chrome|chromium|chromium-browse|headless_shell)|chrome-headless-.*)$/; // not chrome_crashpad_handler: it always has parent 1 while its browser lives. `comm` is cut to 15 characters
let rows = [];
try {
  rows = execFileSync('ps', ['-eo', 'pid=,ppid=,uid=,etimes=,comm=,args='], { encoding: 'utf8' }).split('\n').filter(Boolean);
} catch (e) { console.log(`reap-browsers: cannot list processes (${e.message.split('\n')[0]}); nothing done`); process.exit(0); }

const me = process.getuid();
const found = [];
for (const line of rows) {
  const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
  if (!m) continue;
  const [pid, ppid, uid, age] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (ppid !== 1 || uid !== me || age < minAge || !NAME.test(m[5])) continue;
  if (pid === process.pid || pid === 1) continue;
  // the command line must carry --user-data-dir=<a folder under the temp folder named like one of the checks' browser profiles>
  const profile = /(?:^|\s)--user-data-dir=(\S+)/.exec(m[6]);
  if (!profile || !BROWSER_PROFILE_PREFIXES.some((p) => profile[1].startsWith(path.join(os.tmpdir(), p)))) continue;
  if (under && !m[6].includes(under)) continue;
  found.push(pid);
}
let killed = 0;
if (!dry) {
  for (const pid of found) { try { process.kill(pid, 'SIGKILL'); killed += 1; } catch { /* already gone */ } }
}
console.log(`reap-browsers: ${found.length} orphaned browser process${found.length === 1 ? '' : 'es'} found, ${dry ? 'none killed (dry run)' : `${killed} killed`}`);
