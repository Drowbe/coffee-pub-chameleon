// Checks that a browser started through tools/browser-launch.mjs never outlives its check, and that tools/reap-browsers.mjs kills
// only orphans. The browser part needs a Chromium (CHROME_PATH or the usual places) and is SKIPPED, loudly, without one; run it
// under the browser lock when machines are shared. The reaper part uses a copy of `sleep` named `chrome`, so no real browser is touched.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const fail = (m) => { bad += 1; console.log(`  FAIL ${m}`); };
const ok = (c, m) => { if (!c) fail(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return !fs.readFileSync(`/proc/${pid}/stat`, 'utf8').includes(') Z '); } catch { return false; } };
async function goneWithin(pids, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (!pids.some(alive)) return true; await sleep(100); } return !pids.some(alive); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-browser-orphans-'));

function findBrowser() {
  const cands = [process.env.CHROME_PATH];
  for (const root of [path.join(os.homedir(), '.cache', 'ms-playwright'), '/opt/pw-browsers']) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root).sort().reverse()) {
      cands.push(path.join(root, d, 'chrome-linux', 'chrome'), path.join(root, d, 'chrome-linux64', 'chrome'), path.join(root, d, 'chrome-linux', 'headless_shell'),
        path.join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
    }
  }
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  return cands.find((c) => c && fs.existsSync(c)) || null;
}
// the pids whose command line carries a profile folder: the browser and everything it started
function pidsFor(dir) {
  const out = [];
  for (const n of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(n)) continue;
    try { if (fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').split('\0').includes(`--user-data-dir=${dir}`)) out.push(Number(n)); } catch { /* gone */ }
  }
  return out;
}

// ---- 0. no tool outside the helper starts a browser by itself, and every profile folder is one the reaper knows ----
{
  const { BROWSER_PROFILE_PREFIXES } = await import('./browser-profiles.mjs');
  const files = [...fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => f.endsWith('.mjs')).map((f) => path.join('tools', f)),
    ...fs.readdirSync(path.join(ROOT, 'modules')).flatMap((m) => { const d = path.join(ROOT, 'modules', m, 'test'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.mjs')).map((f) => path.join('modules', m, 'test', f)) : []; })];
  const allowed = new Set(['tools/browser-launch.mjs', 'tools/browser-watchdog.mjs', 'tools/browser-profiles.mjs', 'tools/reap-browsers.mjs', 'tools/check-browser-orphans.mjs']);
  for (const f of files) {
    if (allowed.has(f.split(path.sep).join('/'))) continue;
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (src.includes('--user-data-dir')) ok(src.includes('startBrowser('), `${f} starts a browser itself: use startBrowser from tools/browser-launch.mjs`);
    if (/\bspawn\(\s*bin\b/.test(src)) fail(`${f} spawns a browser directly: use startBrowser from tools/browser-launch.mjs`);
    if (src.includes('startBrowser(')) for (const m of src.matchAll(/mkdtempSync\(path\.join\(os\.tmpdir\(\), '([^']*-chrome-)'\)/g)) {
      ok(BROWSER_PROFILE_PREFIXES.includes(m[1]), `${f}: the profile folder prefix '${m[1]}' is not in tools/browser-profiles.mjs, so the reaper would not clean it`);
    }
  }
}

// ---- 1. the reaper, with fake browsers: symlinks to node under the names a real one has ----
if (!fs.existsSync('/proc/self/stat')) {
  console.log('check-browser-orphans: SKIPPED (needs Linux /proc). This is not a pass.');
  process.exit(0);
}
const reaper = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'reap-browsers.mjs'), `--only-under=${tmp}`, ...a], { encoding: 'utf8' });
{
  const link = (name) => { const p = path.join(tmp, name); fs.symlinkSync(process.execPath, p); return p; };
  const profile = (prefix) => `--user-data-dir=${path.join(os.tmpdir(), prefix + 'fake' + Math.random().toString(36).slice(2, 8))}`;
  const SCRIPT = ['-e', 'setInterval(() => {}, 1000)', '--'];
  const ppidOf = (pid) => Number(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]);
  // started by a shell that exits, so the parent becomes pid 1 (or the container's init)
  const orphanOf = (bin, arg) => Number(spawnSync('sh', ['-c', '"$@" >/dev/null 2>&1 & echo $!', 'sh', bin, ...SCRIPT, arg], { encoding: 'utf8' }).stdout.trim());
  const good = profile('check-confirm-chrome-');
  const mine = spawn(link('chrome'), [...SCRIPT, good], { stdio: 'ignore' }); // a live parent: this process
  const orphan = orphanOf(path.join(tmp, 'chrome'), good);
  const crashpad = orphanOf(link('chrome_crashpad_handler'), good);
  const driver = orphanOf(link('chromedriver'), good);
  const foreign = orphanOf(path.join(tmp, 'chrome'), profile('somebody-elses-'));
  const nodir = orphanOf(path.join(tmp, 'chrome'), '--no-profile');
  await sleep(400);
  if (ppidOf(orphan) !== 1) {
    console.log(`  note: the container's orphans go to pid ${ppidOf(orphan)}, not 1: the orphan cases are not exercised here`);
    for (const p of [orphan, crashpad, driver, foreign, nodir]) { try { process.kill(p); } catch { /* gone */ } }
  } else {
    let r = reaper('--min-age=0', '--dry-run');
    ok(/ 1 orphaned browser process found, none killed/.test(r.stdout), `dry run should find only the one real orphan (not crashpad, chromedriver, a foreign profile or none): ${r.stdout.trim()}`);
    ok([orphan, crashpad, driver, foreign, nodir].every(alive) && alive(mine.pid), 'a dry run killed something');
    r = reaper('--min-age=3600');
    ok(/ 0 orphaned/.test(r.stdout) && alive(orphan), `an orphan younger than the minimum age was touched: ${r.stdout.trim()}`);
    r = reaper('--min-age=0');
    ok(/ 1 orphaned browser process found, 1 killed/.test(r.stdout), `reaper output: ${r.stdout.trim()}`);
    ok(await goneWithin([orphan], 2000), 'the orphan is still running after the reaper');
    ok([crashpad, driver, foreign, nodir].every(alive), 'the reaper killed a crashpad handler, a chromedriver, or a browser with a profile that is not one of the checks');
    for (const p of [crashpad, driver, foreign, nodir]) { try { process.kill(p); } catch { /* gone */ } }
  }
  ok(alive(mine.pid), 'the reaper killed a browser whose parent is alive');
  mine.kill();
  const none = reaper('--min-age=0');
  ok(none.status === 0 && / 0 orphaned/.test(none.stdout), `with nothing to reap the reaper should say 0: ${none.stdout.trim()}`);
  const badArg = reaper('--min-age=abc');
  ok(badArg.status === 2, 'a bad --min-age should exit 2');
}

// ---- 2. the browser ----
const bin = findBrowser();
if (!bin) console.log('check-browser-orphans: browser part SKIPPED (no Chromium found; set CHROME_PATH). This is not a pass.');
else {
  const runner = path.join(tmp, 'runner.mjs');
  fs.writeFileSync(runner, `import { startBrowser, liveBrowsers } from ${JSON.stringify(path.join(ROOT, 'tools', 'browser-launch.mjs'))};
import fs from 'node:fs';
const dir = process.argv[2];
fs.mkdirSync(dir, { recursive: true });
const child = startBrowser(${JSON.stringify(bin)}, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank'], dir);
let buf = '';
child.stderr.on('data', (d) => { buf += d; if (/DevTools listening/.test(buf)) console.log('READY ' + child.pid); });
if (process.argv[3] === 'selfexit') child.once('exit', () => setTimeout(() => { console.log('LIVE ' + liveBrowsers() + ' GONE ' + !fs.existsSync(dir)); process.exit(0); }, 300));
else setInterval(() => {}, 1000);
`);
  async function start(label, mode = '') {
    const dir = path.join(tmp, `profile-${label}`);
    const node = spawn(process.execPath, [runner, dir, mode], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('the browser did not start')), 30000);
      node.stdout.on('data', (d) => { if (/READY/.test(String(d))) { clearTimeout(t); res(); } });
      node.on('exit', () => { clearTimeout(t); rej(new Error('the runner exited early')); });
    });
    await sleep(500); // renderers, the watchdog
    return { node, dir, pids: pidsFor(dir) };
  }
  try {
    // a different job's browser, to prove ours never touches it
    const other = await start('other');
    for (const how of ['SIGKILL', 'SIGTERM', 'SIGINT']) {
      const s = await start(how);
      ok(s.pids.length >= 1, `${how}: no browser process found for the profile folder`);
      const t0 = Date.now();
      s.node.kill(how);
      const gone = await goneWithin(s.pids, 8000);
      ok(gone, `${how}: the browser (pids ${s.pids.filter(alive).join(', ')}) is still running 8 s after its check was killed`);
      if (gone) console.log(`  ${how}: browser gone ${Date.now() - t0} ms after the check was killed`);
      await sleep(1200);
      ok(!fs.existsSync(s.dir), `${how}: the profile folder was not deleted`);
      ok(alive(other.node.pid) && other.pids.every(alive), `${how}: another check's browser was killed`);
    }
    // a browser that ends by itself, then the check ends: nothing is left registered, so nothing signals its old group
    {
      const s = await start('selfexit', 'selfexit');
      let out = ''; s.node.stdout.on('data', (d) => { out += d; });
      const code = new Promise((r) => s.node.once('exit', r));
      process.kill(s.pids[0], 'SIGKILL');
      ok((await Promise.race([code, sleep(8000).then(() => 'timeout')])) === 0, 'selfexit: the check did not end cleanly after its browser ended');
      ok(/LIVE 0 GONE true/.test(out), `selfexit: the browser stayed registered or its profile folder stayed (${out.trim()})`);
    }
    // a normal end
    other.node.kill('SIGTERM');
    ok(await goneWithin(other.pids, 8000), 'the last browser is still running after its check ended');
  } catch (e) { fail(e.message); }
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* harmless */ }
console.log(bad ? `check-browser-orphans: ${bad} problem${bad === 1 ? '' : 's'}` : 'check-browser-orphans: ok');
process.exit(bad ? 1 : 0);
