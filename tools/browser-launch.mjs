// The one place the checks start a headless Chrome from, so one that is killed never leaves a browser behind.
//   startBrowser(bin, args, dir)  starts it in a process group of its own and returns the child process
//   stopBrowser(child, dir)       closes the browser (the whole group) and deletes its profile folder `dir`
// What this guarantees (see tools/check-browser-orphans.mjs):
//   - normal end, uncaught error: an 'exit' handler kills every browser this process started
//   - SIGTERM, SIGINT, SIGHUP: the same, then the process exits with the signal's code
//   - SIGKILL of the check (nothing can run): a small watchdog process (tools/browser-watchdog.mjs), started beside the browser,
//     sees the check is gone and kills that browser's group within about a second. Linux only (it reads /proc).
// Only the group this helper started is ever killed: its leader is the browser child, and the kill is by that group id.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

export { BROWSER_PROFILE_PREFIXES } from './browser-profiles.mjs';

const live = new Map(); // key -> { pid, dir }: the browsers this process started and has not seen end (pid is 0 when it never started)
const WATCHDOG = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'browser-watchdog.mjs');

function killGroup(pid, signal) {
  try { process.kill(-pid, signal); return true; } catch { return false; } // false: no such group
}
function rm(dir) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* a temp folder left behind is harmless */ } }

function cleanupNow() {
  for (const { pid, dir } of live.values()) { if (pid) killGroup(pid, 'SIGKILL'); rm(dir); }
  live.clear();
}
process.on('exit', cleanupNow);
for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) {
  process.on(sig, () => { try { cleanupNow(); } finally { process.exit(code); } });
}

export const liveBrowsers = () => live.size; // for tools/check-browser-orphans.mjs

export function startBrowser(bin, args, dir) {
  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true }); // detached: its own process group
  const key = Symbol('browser');
  live.set(key, { pid: child.pid || 0, dir }); // registered even when it did not start, so its folder is still removed
  child.on('error', () => { /* the caller's 'exit' or timeout handling reports it */ });
  child.once('exit', () => { // renderers left in the group go with it; then the entry is gone, so nothing later signals a stale group
    if (child.pid) killGroup(child.pid, 'SIGKILL');
    live.delete(key);
    rm(dir);
  });
  if (!child.pid) return child;
  if (fs.existsSync('/proc/self/stat')) {
    const dog = spawn(process.execPath, [WATCHDOG, String(process.pid), String(child.pid), dir], { stdio: 'ignore', detached: true });
    dog.on('error', () => { /* no watchdog: the in-process handlers still run */ });
    dog.unref();
  }
  return child;
}

export async function stopBrowser(child, dir) {
  if (!child) return;
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((r) => child.once('exit', r));
  if (child.pid) {
    killGroup(child.pid, 'SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    killGroup(child.pid, 'SIGKILL'); // whatever is still in the group
  }
  if (dir) { await new Promise((r) => setTimeout(r, 100)); rm(dir); }
}
