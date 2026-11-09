// check-prototype-parity.mjs: the Prototype's Planner (public/design-system/prototype.html) and the real Planner drawn the same,
// measured in a headless Chromium so nobody has to find the difference by eye (Thomas, 2026-10-30).
//
// What it does. It starts the throwaway server with the screenshot seed (tools/shots.mjs, bootSeeded: the travel template, a frozen
// clock), adds the few objects the seed lacks (a buffer, a travel day, a free day, rows from the Calendar, an undated object per
// phase), opens the real Planner and the Prototype's Planner at the same panel width and measures the same parts in both.
//   1. Parity: strip, Unscheduled and its rows, the phase bars, day card and head, row cards, joint and its + button, suggestions,
//      the empty-day box and the more buttons have the same left edge, right inset and height (within 1 px) in both, each measured
//      from its own #body. At 1280 light and dark, 700 and a real 390 viewport.
//   2. Columns: in .days and Unscheduled every full-width part shares one left and right edge; in a day the cards, the suggestions
//      and the empty box share one left and right edge; every more button shares one centre.
//   3. Joint: the gap above and below the + circle differs by at most 2 px.
//   4. Phone: at a real 390 viewport every button and summary in the Planner (and the Prototype's) is at least 44 px tall, counting
//      the hit area its ::after adds.
//   5. Container, not viewport: the Prototype at ?w=390 in a wide window draws the day head as a real 390 window does.
//   6. Copies: the Prototype's TEMPLATES are character for character modules/travel/src/travel.html's, and
//      public/design-system/sources.js is what `node tools/design-system-snapshot.mjs --sources` writes now.
// Usage: node tools/check-prototype-parity.mjs. PARITY_DEBUG=1 prints every measurement. With no Chromium it says SKIPPED and exits 0
// (a skip, never a pass), and fails when CI is set.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';
import { buildSources } from './design-system-snapshot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (...a) => console.log('check-prototype-parity:', ...a);
const DEBUG = Boolean(process.env.PARITY_DEBUG);
const failures = [];
const fail = (m) => { if (!failures.includes(m)) failures.push(m); };
const started = Date.now();

// ---- 6. the copies (no browser) ----
function checkCopies() {
  const html = fs.readFileSync(path.join(root, 'modules', 'travel', 'src', 'travel.html'), 'utf8');
  const proto = fs.readFileSync(path.join(root, 'public', 'design-system', 'prototype-planner.js'), 'utf8');
  const m = /const TEMPLATES = (\{[\s\S]*?\n\});/.exec(proto);
  if (!m) { fail('public/design-system/prototype-planner.js has no "const TEMPLATES = {...};" block to compare'); return; }
  let templates;
  try { templates = vm.runInNewContext('(' + m[1] + ')'); } catch (e) { fail(`the TEMPLATES block of prototype-planner.js does not run: ${e.message}`); return; }
  const real = new Map([...html.matchAll(/<template id="(tpl-[^"]+)">([\s\S]*?)<\/template>/g)].map((x) => [x[1], x[2]]));
  let n = 0;
  for (const [key, text] of Object.entries(templates)) {
    const id = [key === 'day' ? 'tpl-day2' : `tpl-${key}`, `tpl-card-${key}`].find((c) => real.has(c));
    if (!id) { fail(`prototype-planner.js TEMPLATES.${key} has no <template> in modules/travel/src/travel.html (tpl-${key} or tpl-card-${key})`); continue; }
    n += 1;
    if (real.get(id) !== text) {
      const a = real.get(id); let i = 0; while (i < a.length && a[i] === text[i]) i += 1;
      fail(`prototype-planner.js TEMPLATES.${key} differs from #${id} in travel.html at character ${i}: product "${a.slice(Math.max(0, i - 20), i + 40)}" / Prototype "${text.slice(Math.max(0, i - 20), i + 40)}". Copy the template over character for character`);
    }
  }
  const disk = fs.readFileSync(path.join(root, 'public', 'design-system', 'sources.js'), 'utf8');
  if (buildSources().js !== disk) fail('public/design-system/sources.js is not what the stylesheets on disk produce. Run: node tools/design-system-snapshot.mjs --sources');
  say(`copies: ${n} templates compared with travel.html, sources.js compared with the stylesheets`);
}

// ---- the measuring, in the page ----
const PARTS = {
  strip: '#stripbar', undated: '#undated', undatedRow: '#undated li.sdk-row', ends: '.timeline.ends', phaseBar: '.row.marker.phase .sdk-mk-line',
  day: '.days > .sdk-day', dayHead: '.sdk-day > .sdk-day-head', dayMore: '.sdk-day-head [data-action="day-more"]', dayAdd: '.sdk-day-head .day-add',
  rowcard: '.sdk-day .row.entry .slot > article.sdk-card-banded', block: '.sdk-day .row.entry .slot > article.block', mid: '.card.stay.mid',
  lane: '.row.marker.lane .sdk-mk-line', joint: '.joint', jointadd: '.jointadd', suggestions: '.sdk-day .suggestions:not([hidden]) .suggestion',
  empty: '.sdk-day-empty',
};
const HOST_PAGE = `(document.querySelector('#module-frame') || document.querySelector('.pp-planner'))`;
const HOST_DOCKED = `([...document.querySelectorAll('.module-root')].find((e) => e.shadowRoot && e.shadowRoot.getElementById('daystrip') && e.getClientRects().length))`;
const MEASURE = (hostExpr) => `(() => {
  const PARTS = ${JSON.stringify(PARTS)};
  const MORE = '.sdk-day-head [data-action="day-more"], .sdk-day .menu-btn';
  const host = HOSTEXPR;
  const root = host && host.shadowRoot; if (!root) return null;
  const body = root.getElementById('body'); const br = body.getBoundingClientRect();
  const vis = (e) => e.getClientRects().length > 0;
  const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left - br.left, r: br.right - b.right, w: b.width, h: b.height, cx: (b.left + b.right) / 2 - br.left, top: b.top, bottom: b.bottom }; };
  const out = { body: br.width, parts: {}, more: [], taps: [], joints: [] };
  for (const [k, sel] of Object.entries(PARTS)) out.parts[k] = [...root.querySelectorAll(sel)].filter(vis).map(r);
  out.more = [...root.querySelectorAll(MORE)].filter(vis).map((e) => ({ ...r(e), what: e.className.toString().slice(0, 30) }));
  for (const j of root.querySelectorAll('.joint')) {
    const c = j.querySelector('.jointadd'); const p = j.previousElementSibling; const n = j.nextElementSibling;
    if (!c || !vis(c) || !p || !n || !vis(p) || !vis(n)) continue;
    const cb = c.getBoundingClientRect();
    // A timeline of markers and cards has its own padding around its pill or card: measure from the pill or the card's border, which is what a person sees.
    const edge = (el, last) => { if (!el.classList.contains('timeline')) return el.getBoundingClientRect(); const rows = [...el.querySelectorAll('.sdk-mk-line, article.card')].filter(vis); const x = last ? rows[rows.length - 1] : rows[0]; return (x || el).getBoundingClientRect(); };
    out.joints.push({ prev: p.className.toString().slice(0, 30), next: n.className.toString().slice(0, 30), above: cb.top - edge(p, true).bottom, below: edge(n, false).top - cb.bottom });
  }
  for (const e of root.querySelectorAll('button, summary, a[href], [role="button"]')) {
    if (!vis(e)) continue;
    const b = e.getBoundingClientRect(); let hit = b.height;
    for (const which of ['::before', '::after']) { const ps = getComputedStyle(e, which); if (ps.content !== 'none' && ps.position === 'absolute') hit = Math.max(hit, parseFloat(ps.height) || 0); }
    out.taps.push({ cls: e.className.toString().slice(0, 40) || e.tagName.toLowerCase(), action: e.dataset.action || '', text: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24), h: b.height, hit });
  }
  const d = root.querySelector('.sdk-day > .sdk-day-head');
  out.dayHead = d ? { h: d.getBoundingClientRect().height, addWord: (() => { const w = d.querySelector('.sdk-day-add-word'); return w ? w.getClientRects().length > 0 : false; })() } : null;
  return out;
})()`.replace('HOSTEXPR', hostExpr);

// The things a person can press and the words they read, measured in the page (4, the docked column, and the card heads).
// A control's hit area is what answers a press: elementFromPoint probes along both axes through its centre, every half pixel, as
// far as the control itself is the thing found. Whatever covers the control (a joint, a sticky head) ends the area there.
const PROBE = (hostExpr) => `(() => {
  const host = HOSTEXPR; const root = host && host.shadowRoot; if (!root) return null;
  const vis = (e) => e.getClientRects().length > 0;
  const out = { taps: [], heads: [], truncated: [], cardHeads: [] };
  const name = (e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24);
  const cls = (e) => e.className.toString().trim().split(/\\s+/).slice(0, 3).join('.');
  const around = (e) => { const c = e.closest('.row, .suggestion, .joint, .sdk-day-head, .stripbar, #undated, .sdk-card-head'); return c ? c.className.toString().trim().split(/\\s+/)[0] : ''; };
  const controls = [...root.querySelectorAll('button, summary, a[href], [role="button"], .leg, .sdk-mk-tag')].filter((e) => vis(e) && !e.disabled);
  for (const e of controls) {
    e.scrollIntoView({ block: 'center', inline: 'center' });
    const b = e.getBoundingClientRect(); const cx = (b.left + b.right) / 2; const cy = (b.top + b.bottom) / 2;
    const own = (x, y) => { const t = root.elementFromPoint(x, y); return Boolean(t) && (t === e || e.contains(t)); };
    const t = { leg: e.classList.contains('leg'), what: (e.dataset.action || cls(e) || e.tagName.toLowerCase()) + (name(e) ? ' "' + name(e) + '"' : ''), where: around(e), w: b.width, h: b.height, hitW: 0, hitH: 0, covered: '' };
    if (!own(cx, cy)) { const c = root.elementFromPoint(cx, cy); t.covered = c ? c.tagName.toLowerCase() + '.' + cls(c) : 'nothing'; out.taps.push(t); continue; }
    let up = 0; let dn = 0; let lf = 0; let rt = 0;
    while (up < 40 && own(cx, cy - up - 0.5)) up += 0.5;
    while (dn < 40 && own(cx, cy + dn + 0.5)) dn += 0.5;
    while (lf < 80 && own(cx - lf - 0.5, cy)) lf += 0.5;
    while (rt < 80 && own(cx + rt + 0.5, cy)) rt += 0.5;
    t.hitH = up + dn + 0.5; t.hitW = lf + rt + 0.5;
    // What stopped it: a box the control sits in (it clips), another control (a neighbour's area starts there) or its own row are
    // fine; anything else painted over it (a joint, a sticky head, another card) covers it.
    const fam = e.closest('.row, .suggestion, .sdk-card-head, .sdk-day-head, .stripbar, .joint');
    const against = (x, y) => { const c = root.elementFromPoint(x, y); return Boolean(c) && !c.contains(e) && !c.closest('button, summary, a[href], [role="button"]') && !(fam && fam.contains(c)); };
    t.coverH = (up < 40 && against(cx, cy - up - 1)) || (dn < 40 && against(cx, cy + dn + 1));
    t.coverW = (lf < 80 && against(cx - lf - 1, cy)) || (rt < 80 && against(cx + rt + 1, cy));
    // The size the stylesheet gives its area (the control plus its ::before and ::after), however much is clipped or shared.
    t.css = b.height;
    for (const which of ['::before', '::after']) { const ps = getComputedStyle(e, which); if (ps.content !== 'none' && ps.position === 'absolute') t.css = Math.max(t.css, parseFloat(ps.height) || 0); }
    out.taps.push(t);
  }
  out.heads = [...root.querySelectorAll('.sdk-day > .sdk-day-head')].filter(vis).map((e) => e.getBoundingClientRect().height);
  // The day title ("Day 1 of 10") in its head: how many lines it takes and whether it broke inside a word.
  out.dayTitles = [...root.querySelectorAll('.sdk-day > .sdk-day-head h2')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(e).lineHeight) || 20; return { text: e.textContent.trim(), lines: Math.round(r.height / lh), nowrap: getComputedStyle(e).whiteSpace === 'nowrap' || r.height < lh * 1.5 }; });
  for (const e of root.querySelectorAll('.sdk-mk-tag, .sdk-mk-tag *, .sdk-chip-tag, .sdk-chip-tag *, .sdk-chip, .sdk-chip *')) {
    if (vis(e) && e.scrollWidth > e.clientWidth + 0.5) out.truncated.push({ what: cls(e) + ' "' + name(e) + '"', scroll: e.scrollWidth, client: e.clientWidth });
  }
  for (const head of root.querySelectorAll('.sdk-card-head')) {
    if (!vis(head)) continue;
    const main = head.querySelector(':scope > .sdk-card-main'); if (!main) continue;
    const m = main.getBoundingClientRect(); const parts = [];
    for (const e of main.querySelectorAll(':scope > .sdk-card-icon, :scope > .sdk-card-title, :scope > .sdk-card-sub')) parts.push([cls(e), e.getBoundingClientRect()]);
    for (const e of head.querySelectorAll(':scope > button, :scope > a')) if (vis(e)) parts.push([cls(e) + ' (button)', e.getBoundingClientRect()]);
    const title = (head.querySelector('.sdk-card-title') || {}).textContent || '';
    const sub = head.querySelector('.sdk-card-sub'); const problems = [];
    if (sub && vis(sub)) { const s = sub.getBoundingClientRect(); if (s.right > m.right + 0.5 || s.left < m.left - 0.5) problems.push('the kicker goes ' + Math.round(Math.max(s.right - m.right, m.left - s.left)) + 'px outside the card head\\'s main part'); }
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i][1]; const c = parts[j][1];
      if (Math.min(a.right, c.right) - Math.max(a.left, c.left) > 1 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 1) problems.push(parts[i][0] + ' overlaps ' + parts[j][0]);
    }
    for (const [n, r] of parts) if (n.includes('(button)') && m.right > r.left + 0.5) problems.push('the main part reaches ' + Math.round(m.right - r.left) + 'px under ' + n);
    if (problems.length) out.cardHeads.push({ title: title.trim().slice(0, 24), problems: [...new Set(problems)] });
  }
  return out;
})()`.replace('HOSTEXPR', hostExpr);

const round = (n) => Math.round(n * 10) / 10;
const EXTRA = (trip) => {
  const day = (n) => new Date(Date.UTC(2026, 9, 15 + n)).toISOString().slice(0, 10);
  const ref = (id) => ({ module: 'calendar', kind: 'event', id, scope: 'space', space: trip });
  return [
    ['x1', { kind: 'block', type: 'buffer', title: 'Buffer', date: day(8), time: '10:00', minutes: 60, notes: 'Slack before the airport run', order: 1 }],
    ['x2', { kind: 'lane', type: 'travel-day', title: 'Travel day', after: day(9), notes: 'Overnight flight', order: 1 }],
    ['x3', { kind: 'block', type: 'free-day', title: 'Free day', date: day(16), order: 1 }],
    ['x4', { kind: 'link', title: 'Farewell dinner', date: day(18), time: '20:00', ref: ref('e5'), order: 1 }],
    ['x5', { kind: 'link', title: 'Pack the suitcases', date: day(9), ref: ref('e2'), order: 1 }],
    ['x6', { kind: 'note', title: 'Packing', date: day(0), notes: 'Passports, chargers, two jackets.', order: 1 }],
    ['x8', { kind: 'note', title: 'On the line', after: day(11), notes: 'A card at a joint, not a marker', order: 1 }],
    ['x7', { kind: 'block', type: 'meet-up', title: 'Meet-up', date: day(8), time: '18:30', notes: 'In the hotel lobby', order: 1 }],
  ];
};


// Auto-scroll while dragging (Thomas, 2026-10-30): synthetic dragover events on the real Planner. Nothing moves in the middle of the
// list or on dragstart; near the bottom edge it scrolls down, near the top edge up; it stops at dragend.
const SCROLL_PROBE = (hostExpr) => `(async () => {
  const host = ${hostExpr}; const root = host && host.shadowRoot; if (!root) return null;
  const body = root.getElementById('body'); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const row = root.querySelector('.row.entry'); if (!row) return { error: 'no entry row' };
  const range = body.scrollHeight - body.clientHeight; if (range < 400) return { error: 'the list does not scroll: ' + range };
  body.scrollTop = Math.round(range / 2);
  const r = body.getBoundingClientRect(); const out = { range, start: body.scrollTop };
  const fire = (type, y, el = row) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: y, dataTransfer: new DataTransfer() }));
  const hold = async (y, ms) => { const end = performance.now() + ms; while (performance.now() < end) { fire('dragover', y, body); await wait(40); } };
  row.draggable = true; fire('dragstart', r.top + r.height / 2);
  await wait(300); out.afterStart = body.scrollTop;
  await hold(r.top + r.height / 2, 500); out.middle = body.scrollTop;
  await hold(r.bottom - 4, 500); out.bottom = body.scrollTop;
  await hold(r.top + r.height / 2, 100); const rest = body.scrollTop; await wait(300); out.stoppedLeaving = body.scrollTop - rest;
  await hold(r.top + 4, 500); out.top = body.scrollTop;
  fire('dragend', r.top + 4); const after = body.scrollTop; await wait(400); out.afterEnd = body.scrollTop - after;
  return out;
})()`;

async function main() {
  checkCopies();
  const bin = findBrowser();
  if (!bin) {
    say('SKIPPED the browser parts. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.');
    return finish(process.env.CI || failures.length ? 1 : 0);
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const ck = boot.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
    const phases = (await (await fetch(S.base + '/api/branding', { headers: { cookie: ck, accept: 'application/json' } })).json()).phases || [];
    const extra = EXTRA(S.ctx.trip);
    phases.forEach((p, i) => extra.push([`u${i}`, { kind: 'note', title: `Undated under ${p.label || p.id}`, phase: p.id, notes: 'No date yet', order: i + 1 }]));
    extra.push(['u9', { kind: 'stop', type: 'sight', title: 'Undated sight, no phase', order: 9 }]);
    for (const [id, value] of extra) {
      const r = await fetch(`${S.base}/api/modules/travel/data/${encodeURIComponent('plan:' + id)}?scope=space&space=${S.ctx.trip}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: ck }, body: JSON.stringify({ value: { by: 'Mia Alvarez', ...value } }) });
      if (r.status >= 300) throw new Error(`the extra object ${id} was refused (${r.status})`);
    }
    browser = await launch(bin);

    const measure = async (which, size, mode, protoW, phoneWindow = 0, probe = false) => {
      const tab = new Tab(browser.cdp, S.ctx);
      // The Prototype sits in a wide window so its own width setting is what is measured, not the window.
      await tab.open(which === 'real' ? size : phoneWindow ? size : Math.max(size + 200, 1400), mode);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      try {
        if (which === 'real') await driveScreen(tab, { id: 'planner', as: 'mia', url: '/modules/travel?space={trip}', wait: '#module-frame >>> .day-add' }, S.base, S.cookies, S.ctx);
        else await driveScreen(tab, { id: 'proto', as: 'none', url: `/design-system/prototype.html?theme=chameleon&mode=${mode}&w=${protoW.id}&look=current`, wait: '.pp-planner >>> .day-add' }, S.base, S.cookies, S.ctx);
        // The Prototype's frame is as wide as the real panel (its own 1 px border included), so both bodies are the same width.
        if (which === 'proto' && protoW.px) {
          await tab.eval(`document.documentElement.style.setProperty('--pp-w', '${protoW.px}px')`);
          await sleep(300);
        }
        await sleep(500);
        const m = await tab.eval(MEASURE(HOST_PAGE));
        if (!m) throw new Error(`${which} Planner has no shadow root with #body`);
        if (probe) m.probe = await tab.eval(PROBE(HOST_PAGE));
        return m;
      } finally { await tab.close(); }
    };

    const real = {}; const protos = {};
    for (const [size, mode] of [[1280, 'light'], [1280, 'dark'], [700, 'light'], [390, 'light']]) {
      const key = `${size} ${mode}`;
      real[key] = await measure('real', size, mode, undefined, 0, size === 390 || key === '1280 light');
      // The border of the Prototype's frame is 2 px of its width: widen it so its #body matches the real one's.
      // At 390 the Prototype is in a window of 390 too (so the window's own rules apply as on the phone); wider ones sit in a wide window.
      const phone = size === 390;
      let p = await measure('proto', size, mode, { id: String(size), px: Math.round(real[key].body) + 2 }, phone ? 1 : 0, phone);
      if (Math.abs(p.body - real[key].body) > 0.5) p = await measure('proto', size, mode, { id: String(size), px: Math.round(real[key].body) + 2 + Math.round(real[key].body - p.body) }, phone ? 1 : 0, phone);
      protos[key] = p;
      if (DEBUG) console.log(key, JSON.stringify({ real: real[key], proto: p }));
      say(`${key}: real body ${round(real[key].body)}px, Prototype body ${round(p.body)}px`);
    }
    // The docked Workspace column (256 px): the whole page, the call stood in for, the Planner in its column beside the call.
    const docked = await (async () => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(1280, 'light', true);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      try {
        await driveScreen(tab, { id: 'workspace', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true, space: true }, S.base, S.cookies, S.ctx);
        await tab.eval(`document.querySelectorAll('.module-floating').forEach((f) => { f.style.display = 'none'; })`);
        await sleep(800);
        const m = await tab.eval(MEASURE(HOST_DOCKED));
        if (!m) throw new Error('the docked Planner (a .module-root with #daystrip) was not found in the Workspace');
        m.probe = await tab.eval(PROBE(HOST_DOCKED));
        return m;
      } finally { await tab.close(); }
    })();
    if (DEBUG) console.log('docked', JSON.stringify(docked));
    say(`docked column: body ${round(docked.body)}px`);
    const wide390 = await measure('proto', 390, 'light', { id: '390' }); // ?w=390 in a window 1400 wide

    // ---- 1. parity ----
    const REQUIRED = ['strip', 'undated', 'undatedRow', 'ends', 'phaseBar', 'day', 'dayHead', 'dayMore', 'rowcard', 'joint', 'jointadd', 'suggestions', 'empty'];
    for (const key of Object.keys(real)) {
      const a = real[key]; const b = protos[key];
      if (Math.abs(a.body - b.body) > 1) fail(`Parity ${key}: the Prototype's #body is ${round(b.body)}px wide, the real Planner's ${round(a.body)}px, so the parts cannot be compared`);
      for (const part of Object.keys(PARTS)) {
        const x = a.parts[part][0]; const y = b.parts[part][0];
        if (!x || !y) { if (REQUIRED.includes(part) && key.startsWith('1280')) fail(`Parity ${key}: ${PARTS[part]} is ${!x && !y ? 'in neither' : !x ? 'missing in the real Planner (but in the Prototype)' : 'missing in the Prototype (but in the real Planner)'}`); continue; }
        // A box that holds rows (the days, the Unscheduled box, the suggestions) is as tall as its content, which differs between the two.
        const grows = ['undated', 'ends', 'day', 'suggestions'].includes(part);
        for (const [what, f] of [['left edge', 'l'], ['right edge (from the right of #body)', 'r'], ['height', 'h']].filter((x) => !(grows && x[1] === 'h'))) {
          if (Math.abs(x[f] - y[f]) > 1) fail(`Parity ${key}: ${PARTS[part]} ${what} is ${round(x[f])}px in the real Planner and ${round(y[f])}px in the Prototype`);
        }
      }
    }

    // ---- 2. columns and 3. joints and 4. taps ----
    const spread = (list, f) => (list.length ? Math.max(...list.map((e) => e[f])) - Math.min(...list.map((e) => e[f])) : 0);
    for (const [which, set] of [['real Planner', real], ['Prototype', protos], ['docked Planner', { docked }]]) {
      for (const key of Object.keys(set)) {
        const m = set[key]; const tag = `${which} ${key}`;
        const col = (name, list, sides = ['l', 'r']) => { for (const f of sides) { const what = f === 'l' ? 'left edge' : 'right edge'; if (spread(list, f) > 1) fail(`Column ${tag}: ${name} do not share one ${what}: they range over ${round(spread(list, f))}px (${[...new Set(list.map((e) => round(e[f])))].join(', ')}px from #body)`); } };
        const full = [...m.parts.day.map((e) => ({ ...e, n: 'day' })), ...m.parts.phaseBar.map((e) => ({ ...e, n: 'phase bar' })), ...m.parts.ends.map((e) => ({ ...e, n: 'timeline.ends' })), ...m.parts.undated.map((e) => ({ ...e, n: '#undated' })), ...m.parts.undatedRow.map((e) => ({ ...e, n: 'unscheduled row' }))];
        col('the full-width parts of .days and #undated (day cards, phase bars, timeline.ends, #undated, its rows)', full);
        // A card sits beside the time and the rail, so its left edge is its own; the boxes that stack under the cards (each suggestion, the empty-day box) share one left edge, and all of them end at one right edge.
        col('the cards, the suggestions and the empty box inside the days', [...m.parts.rowcard, ...m.parts.suggestions, ...m.parts.empty], ['r']);
        col('the suggestions and the empty box inside the days', [...m.parts.suggestions, ...m.parts.empty], ['l']);
        col('the cards inside the days', m.parts.rowcard, ['l']);
        if (spread(m.more, 'cx') > 1) fail(`Column ${tag}: the more buttons do not share one centre: ${round(spread(m.more, 'cx'))}px apart (${[...new Set(m.more.map((e) => round(e.cx)))].join(', ')}px from #body)`);
        const bad = m.joints.filter((j) => Math.abs(j.above - j.below) > 1);
        if (bad.length) fail(`Joint ${tag}: the + circle is not centred (drawn edge above and below differ by more than 1px) between its two days in ${bad.length} of ${m.joints.length} joints: ${[...new Set(bad.map((j) => `${round(j.above)}px above and ${round(j.below)}px below, between .${j.prev.trim().replace(/\\s+/g, '.')} and .${j.next.trim().replace(/\\s+/g, '.')}`))].join('; ')}`);
        if (!m.joints.length) fail(`Joint ${tag}: no joint with a + circle between two days was found`);
      }
    }
    // A press is answered by whatever is topmost at the point: probes along both axes through each control's centre. On a phone and in the
    // docked column a control needs 44 px each way, and nothing (a joint, a head, another control's area) may cover it. A way-between chip
    // (.leg) is a target as wide as its chip, no wider: a press beside it is not its press.
    for (const [which, m] of [['real Planner 390', real['390 light']], ['Prototype 390', protos['390 light']], ['docked Planner', docked], ['real Planner 1280', real['1280 light']]]) {
      const need = which.endsWith('1280') ? 0 : 43.5; // a wide pane: the control as drawn, whole (nothing covers any of it)
      const seen = new Set();
      for (const t of m.probe.taps) {
        const k = `${t.what}|${t.where}`; if (seen.has(k)) continue;
        if (t.covered) { seen.add(k); fail(`Tap target ${which}: ${t.what} (in .${t.where}) is covered at its centre by ${t.covered}`); continue; }
        const lack = need
          ? (t.css < need ? `its area is ${round(t.css)}px tall by the stylesheet` : t.coverH && t.hitH < need ? `something covers it: it answers a press over ${round(t.hitH)}px of height` : t.coverW && t.hitW < need ? `something covers it: it answers a press over ${round(t.hitW)}px of width` : '')
          : (t.coverH && t.hitH < Math.min(t.h, 80) - 0.5 ? `something covers it: only ${round(t.hitH)}px of its ${round(t.h)}px height answers a press` : t.coverW && t.hitW < Math.min(t.w, 160) - 0.5 ? `something covers it: only ${round(t.hitW)}px of its ${round(t.w)}px width answers a press` : '');
        if (lack) { seen.add(k); fail(`Tap target ${which}: ${t.what} (in .${t.where}), drawn ${round(t.w)} x ${round(t.h)}px, ${need ? 'needs 44px each way and ' : 'must answer over all of its drawn size and '}${lack}`); }
        else if (t.leg && t.hitW > t.w + 1.5) { seen.add(k); fail(`Tap target ${which}: ${t.what} answers a press ${round(t.hitW)}px wide but is drawn ${round(t.w)}px wide: a press beside the chip must not open it`); }
      }
      if (!m.probe.taps.length) fail(`Tap target ${which}: no controls were probed`);
    }

    // ---- 7. the docked column: the day head, words that are not cut, the card heads ----
    const heads = docked.probe.heads;
    if (!heads.length) fail('Docked: no day head was found in the docked Planner');
    else if (Math.max(...heads) > 134) fail(`Docked: a day head in the ${round(docked.body)}px column is ${round(Math.max(...heads))}px tall (the tallest of ${heads.length}; all ${heads.map(round).join(', ')}); it should stay at or under about 134px, the words wrapping and the tag keeping its width`);
    for (const t of docked.probe.dayTitles) if (t.lines > 1) fail(`Docked: the day title "${t.text}" takes ${t.lines} lines in the ${round(docked.body)}px column; it should stay on one line (no "Day / 1 of / 10" fragments)`);
    for (const t of docked.probe.truncated) fail(`Docked: ${t.what} is cut: its text is ${round(t.scroll)}px wide in a box ${round(t.client)}px wide`);
    for (const [which, m] of [['docked Planner', docked], ['real Planner 390', real['390 light']]]) {
      const ch = (m.probe || { cardHeads: [] }).cardHeads;
      for (const c of ch) fail(`Card head ${which}: "${c.title}": ${c.problems.join('; ')}`);
    }
    if (!docked.probe.cardHeads || !heads.length) fail('Docked: the card heads were not probed');

    // ---- 5. container, not viewport ----
    const phone = real['390 light'].dayHead; const wide = wide390.dayHead;
    if (!phone || !wide) fail('Container: no day head to compare at 390');
    else {
      if (Math.abs(phone.h - wide.h) > 1) fail(`Container: the day head is ${round(wide.h)}px tall in the Prototype at ?w=390 in a wide window and ${round(phone.h)}px in a real 390px window`);
      if (phone.addWord !== wide.addWord) fail(`Container: the day's Add word is ${wide.addWord ? 'shown' : 'hidden'} in the Prototype at ?w=390 in a wide window and ${phone.addWord ? 'shown' : 'hidden'} in a real 390px window`);
    }
    // ---- 8. auto-scroll while dragging ----
    {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(1280, 'light');
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      try {
        await driveScreen(tab, { id: 'planner', as: 'mia', url: '/modules/travel?space={trip}', wait: '#module-frame >>> .day-add' }, S.base, S.cookies, S.ctx);
        await sleep(500);
        const sc = await tab.eval(SCROLL_PROBE(HOST_PAGE));
        say('auto-scroll: ' + JSON.stringify(sc));
        if (!sc || sc.error) fail('Auto-scroll: ' + (sc ? sc.error : 'no Planner'));
        else {
          if (sc.afterStart !== sc.start) fail(`Auto-scroll: dragstart scrolled the list (${sc.start} to ${sc.afterStart})`);
          if (sc.middle !== sc.start) fail(`Auto-scroll: a drag in the middle scrolled the list (${sc.start} to ${sc.middle})`);
          if (!(sc.bottom > sc.middle)) fail(`Auto-scroll: near the bottom edge the list did not scroll down (${sc.middle} to ${sc.bottom})`);
          if (sc.stoppedLeaving !== 0) fail(`Auto-scroll: it kept scrolling ${sc.stoppedLeaving}px after the pointer left the edge`);
          if (!(sc.top < sc.bottom)) fail(`Auto-scroll: near the top edge the list did not scroll up (${sc.bottom} to ${sc.top})`);
          if (sc.afterEnd !== 0) fail(`Auto-scroll: it kept scrolling ${sc.afterEnd}px after dragend`);
        }
      } finally { await tab.close(); }
    }

    return finish(failures.length ? 1 : 0);
  } finally {
    if (browser) { try { browser.child.kill(); await sleep(300); fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a temp folder left behind */ } }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
function finish(code) {
  for (const f of failures) console.log('  FAIL ' + f);
  say(`${code === 0 ? 'ok' : 'FAIL'}: ${failures.length} problem(s); ${Math.round((Date.now() - started) / 1000)} s`);
  return code;
}
main().then((c) => process.exit(c), (e) => { console.error('check-prototype-parity: ERROR ' + (e.stack || e)); process.exit(1); });
