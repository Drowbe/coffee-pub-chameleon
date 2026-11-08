// The start page (public/start.html; documentation/plans/plan-product-site.md, slices 4 and 5), drawn first on the Prototype's Start page
// section and locked there. The product host's one page: a person types the address of their environment and goes to its own sign-in
// page. It lists no environments, takes no password and carries no marketing.
// What it asks the host (all public): GET /api/product (the name, the base domain, whether sign-up is open, the templates and the one link
// out) and GET /api/product/environment?slug= (as the person types). Recent is this browser's own: the server keeps nothing for it.
const D = document;
const $ = (id) => D.getElementById(id);
const h = (tag, cls, text) => { const e = D.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fa = (name) => { const i = h('i', `fa-solid fa-${name} fa-fw`); i.setAttribute('aria-hidden', 'true'); return i; };

let product = null; // GET /api/product, once it has answered

// ---- the address ----
// Where an environment's own page lives: its address under the base domain, the request's port kept. The only place Go sends anyone.
const envUrl = (slug, path = '/login') => `${location.protocol}//${slug}.${product.baseDomain}${location.port ? `:${location.port}` : ''}${path}`;
// What a person typed, as a slug: lower case, spaces trimmed, a full address pasted in (with or without https://, a path or a port) cut to its first label.
const clean = (raw) => {
  const host = String(raw || '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#:@\s]/)[0];
  return host.split('.')[0];
};
const shapeOk = (s) => /^[a-z0-9-]{3,30}$/.test(s);
const addr = (slug) => `${slug}.${product.baseDomain}`;

const SAY = {
  none: 'There is nothing at that address. Check the spelling.',
  bad: 'An address is 3 to 30 letters, digits or hyphens.',
  net: 'Could not reach the server. Try again.',
  limit: 'Too many tries. Wait a minute, then try again.',
};

// A status line: an icon (or a spinner) and some words; kind is '', 'ok' or 'error'. No parts empties it.
function line(el, kind, icon, parts) {
  el.textContent = '';
  if (kind) el.dataset.kind = kind; else delete el.dataset.kind;
  if (!parts || !parts.length) return;
  if (icon === 'spin') { const s = h('span', 'sdk-spinner sdk-spinner-sm'); s.setAttribute('aria-hidden', 'true'); el.append(s); } else if (icon) el.append(fa(icon));
  const t = h('span');
  for (const p of parts) t.append(typeof p === 'string' ? D.createTextNode(p) : p);
  el.append(t);
}

// ---- light or dark ----
// Light unless this browser picked dark (theme-head.js reads the same key the app's other pages write). The round button flips it.
const MODE_KEY = 'app.themeMode';
function shownMode() { return D.documentElement.dataset.themeMode === 'dark' ? 'dark' : 'light'; }
function paintMode() {
  const mode = shownMode();
  D.documentElement.dataset.modeShown = mode;
  const b = $('sp-theme');
  const word = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  b.setAttribute('aria-label', word); b.title = word;
  b.replaceChildren(fa(mode === 'dark' ? 'sun' : 'moon'));
}
$('sp-theme').addEventListener('click', () => {
  const next = shownMode() === 'dark' ? 'light' : 'dark';
  D.documentElement.dataset.themeMode = next;
  try { localStorage.setItem(MODE_KEY, next); } catch { /* no storage: the choice lasts for this visit */ }
  paintMode();
});
paintMode();

// The header's lockup: "Coffee Pub" in the display face and the rest of the name in coral, one size. A name that does not start
// with "Coffee Pub " is all one word.
function drawLockup(name) {
  const full = String(name || '').trim();
  const box = $('sp-lockup');
  box.replaceChildren();
  const rest = full.startsWith('Coffee Pub ') ? full.slice('Coffee Pub '.length).trim() : '';
  if (!rest) { box.append(h('span', 'sp-lockup-product', full)); return; }
  box.append(h('span', 'sp-lockup-brand', 'Coffee Pub'), ' ', h('span', 'sp-lockup-product', rest));
}

// ---- Recent: this browser's own, newest first, up to 5 ----
const RECENT_KEY = 'app.recentEnvironments';
const RECENT_MAX = 5;
function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return (Array.isArray(list) ? list : []).filter((r) => r && typeof r.slug === 'string' && shapeOk(r.slug) && typeof r.name === 'string' && r.name).map((r) => ({ slug: r.slug, name: r.name.slice(0, 100) })).slice(0, RECENT_MAX);
  } catch { return []; }
}
function saveRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* no storage: nothing is remembered */ }
}
let recent = readRecent();
function addRecent(env) {
  recent = [{ slug: env.slug, name: env.name }, ...recent.filter((r) => r.slug !== env.slug)].slice(0, RECENT_MAX);
  saveRecent(recent);
  drawRecent();
}
function dropRecent(slug) {
  recent = recent.filter((r) => r.slug !== slug);
  saveRecent(recent);
}
function drawRecent(focusAt) {
  const sec = $('sp-recent');
  const ul = $('sp-recent-list');
  ul.textContent = '';
  if (!recent.length || !product) {
    sec.hidden = true; // none: the part is not drawn
    if (focusAt !== undefined) $('sp-find-input').focus();
    return;
  }
  sec.hidden = false;
  recent.forEach((env, i) => {
    const li = h('li', 'sp-chip');
    const main = h('span', 'sp-chip-main');
    const a = h('a', 'sdk-open sp-chip-name', env.name);
    a.href = envUrl(env.slug);
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      const say = $('sp-recent-say');
      line(say, '', 'spin', [`Looking for ${addr(env.slug)}`]);
      const r = await lookup(env.slug);
      if (r.error === 'none') { // gone since: dropped, with Go's sentence
        dropRecent(env.slug);
        drawRecent(Math.min(i, recent.length - 1));
        line($('sp-recent-say'), 'error', 'circle-exclamation', [`${SAY.none} ${env.name} is gone from Recent.`]);
        return;
      }
      if (r.error) { line(say, 'error', 'circle-exclamation', [SAY[r.error]]); return; }
      goTo(r);
    });
    main.append(a, h('span', 'sp-chip-addr', addr(env.slug)));
    const x = h('button', 'sdk-icon-btn btn-quiet btn-small');
    x.type = 'button'; x.setAttribute('aria-label', `Remove ${env.name} from Recent`); x.title = 'Remove from Recent';
    x.append(fa('xmark'));
    x.addEventListener('click', () => {
      dropRecent(env.slug);
      line($('sp-recent-say'), '', '', []);
      drawRecent(Math.min(i, recent.length - 1));
    });
    li.append(main, x);
    ul.append(li);
  });
  if (focusAt !== undefined && focusAt >= 0) { const a = ul.querySelectorAll('a')[focusAt]; if (a) a.focus(); }
}

// ---- asking whether an address is there ----
// GET /api/product/environment?slug= is limited (120 a minute from one address, shared with the sign-up check), so the page asks as little as it
// can: one request at a time, every answer kept for the life of the page (found or not found), nothing asked twice. Not kept: no answer and 429.
const answers = new Map(); // slug -> { slug, name } or { error: 'none' }
let running = null;
let limited = false; // a 429 was seen: typing stops asking, Go asks once when pressed
async function ask(slug) {
  try {
    const res = await fetch(`/api/product/environment?slug=${encodeURIComponent(slug)}`, { headers: { accept: 'application/json' } });
    if (res.status === 404) return { error: 'none' };
    if (res.status === 429) return { error: 'limit' };
    if (!res.ok) return { error: 'net' };
    const data = await res.json();
    if (!data || typeof data.name !== 'string' || data.slug !== slug) return { error: 'net' };
    return { slug: data.slug, name: data.name };
  } catch { return { error: 'net' }; }
}
async function lookup(slug) {
  if (answers.has(slug)) return answers.get(slug);
  while (running) await running; // never two at once
  if (answers.has(slug)) return answers.get(slug);
  const p = ask(slug).finally(() => { if (running === p) running = null; });
  running = p;
  const r = await p;
  if (!r.error || r.error === 'none') answers.set(slug, r);
  if (r.error === 'limit') limited = true; else if (!r.error) limited = false;
  return r;
}

// ---- Find your environment ----
const find = { phase: 'idle', env: null, token: 0, timer: null, goAfter: false };
function drawFind() {
  const input = $('sp-find-input');
  const go = $('sp-go');
  const say = $('sp-find-say');
  const slug = clean(input.value);
  const busy = find.phase === 'opening';
  go.textContent = '';
  if (busy) { const s = h('span', 'sdk-spinner sdk-spinner-sm'); s.setAttribute('aria-hidden', 'true'); go.append(s, h('span', '', 'Go')); } else go.append(h('span', '', 'Go'));
  go.setAttribute('aria-busy', String(busy));
  go.disabled = !product || busy; // always on once the host has answered; off only while a go is in progress
  input.setAttribute('aria-invalid', String(find.phase === 'none' || find.phase === 'bad'));
  const p = find.phase;
  if (p === 'looking') line(say, '', 'spin', [`Looking for ${addr(slug)}`]);
  else if (p === 'found') line(say, 'ok', 'circle-check', [h('strong', '', find.env.name), ` at ${addr(find.env.slug)}`]);
  else if (p === 'opening') line(say, 'ok', 'spin', ['Opening ', h('strong', '', find.env.name)]);
  else if (p === 'none' || p === 'bad' || p === 'net' || p === 'limit') line(say, 'error', 'circle-exclamation', [SAY[p]]);
  else if (slug && product) line(say, '', 'globe', [slug !== input.value.trim() ? `Goes to ${addr(slug)}` : addr(slug)]);
  else line(say, '', '', []);
}
// Go on to the environment's own sign-in page, in this tab. Recent gets it first.
function goTo(env) {
  find.phase = 'opening'; find.env = env; drawFind();
  addRecent(env);
  location.href = envUrl(env.slug);
}
// Ask about the text now in the field. then: go on when the name is found.
async function check(then) {
  const slug = clean($('sp-find-input').value);
  const mine = ++find.token;
  find.phase = 'looking'; find.goAfter = Boolean(then); drawFind();
  const r = await lookup(slug);
  if (mine !== find.token) return; // the text changed meanwhile: this answer is for another address
  if (r.error) { find.phase = r.error; find.goAfter = false; drawFind(); return; }
  find.phase = 'found'; find.env = r; drawFind();
  if (find.goAfter) goTo(r);
}
function showFindAnswer(slug, r) {
  if (r.error) find.phase = r.error; else { find.phase = 'found'; find.env = r; }
  drawFind();
}
$('sp-find-input').addEventListener('input', () => {
  clearTimeout(find.timer); find.token += 1; find.goAfter = false; find.phase = 'idle'; find.env = null; drawFind();
  if (!product) return;
  const slug = clean($('sp-find-input').value);
  if (!slug || (slug.length < 3 && /^[a-z0-9-]*$/.test(slug))) return; // too short to say anything yet
  find.timer = setTimeout(() => {
    if (!shapeOk(slug)) { find.phase = 'bad'; drawFind(); return; }
    if (answers.has(slug)) { showFindAnswer(slug, answers.get(slug)); return; }
    if (limited) return; // a 429 was seen: wait for Go
    check(false);
  }, 400);
});
$('sp-find-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!product || find.phase === 'opening') return;
  const input = $('sp-find-input');
  const slug = clean(input.value);
  if (!slug) { input.focus(); return; }
  clearTimeout(find.timer);
  if (!shapeOk(slug)) { find.phase = 'bad'; drawFind(); input.focus(); return; }
  if (find.phase === 'found' && find.env && find.env.slug === slug) { goTo(find.env); return; }
  if (find.phase === 'looking') { find.goAfter = true; return; } // the check is already running: go when it finds the name
  check(true);
});
// Back to the page from the environment (the browser keeps pages): Go is ready again.
addEventListener('pageshow', (e) => { if (e.persisted && find.phase === 'opening') { find.phase = 'idle'; find.env = null; drawFind(); } });

// ---- the page ----
// The studio's parts: the hero's button, the header's links, the ways to use the product and the footer. Every link is the studio's
// address (product.productSiteUrl, from PRODUCT_SITE_URL) with a path on it; without that address none of them is drawn.
const WAYS = [
  { icon: 'suitcase', title: 'Travel', line: 'Plans, places and the budget', path: '/products/chameleon/travel' },
  { icon: 'dice', title: 'Gaming', line: 'Chat, calls and streams', path: '/products/chameleon/games' },
  { icon: 'clipboard', title: 'Projects', line: 'Tasks, dates and research', path: '/products/chameleon/projects', soon: true },
  { icon: 'mentoring', title: 'Mentoring', line: 'Sessions, polls and notes', path: '/products/chameleon/mentoring', soon: true },
  { icon: 'real-estate', title: 'Real estate', line: 'Viewings, costs and paperwork', path: '/products/chameleon/real-estate', soon: true },
];
const footProducts = () => [[product.name, '/products/chameleon'], ['Showrunner', '/products/showrunner'], ['Foundry VTT modules', '/products#modules'], ['All products', '/products']];
const FOOT_STUDIO = [['About', '/about'], ['Contact', '/contact'], ['Get help', '/support'], ['Design system', '/design-system']];
// Elsewhere: the studio's own pages elsewhere on the web. They are not on the studio's address, so they are written out.
const FOOT_ELSEWHERE = [['willhavebeen.com', 'https://willhavebeen.com'], ['Patreon', 'https://www.patreon.com/cw/CoffeePub'], ['GitHub', 'https://github.com/Drowbe']];
function drawHero() {
  const full = product.name; const short = product.productShortName || product.name;
  $('sp-title').textContent = full;
  const site = siteOrigin();
  $('sp-lead').textContent = `This is the front door to ${full}. Sign in to your own environment below${site ? ', or ask for an invite to get one' : ''}. Chat all week, call when it counts, and keep the plans, the maps and the notes right beside it.`;
  const where = $('sp-where');
  where.replaceChildren('Your own environment at ', h('code', '', `yourname.${product.baseDomain}`), ': your people, your spaces, your tools.');
  const invite = $('sp-invite'); invite.hidden = !site;
  if (site) invite.href = siteLink('/contact');
  return short;
}
function siteOrigin() {
  try { return product.productSiteUrl ? new URL(product.productSiteUrl).origin : ''; } catch { return ''; }
}
function siteLink(path) { return new URL(path, siteOrigin()).href; }
function drawStudio(short) {
  const site = siteOrigin();
  for (const id of ['sp-nav-more', 'sp-nav-support']) $(id).hidden = !site;
  $('sp-ways').hidden = !site; $('sp-site').hidden = !site;
  if (!site) return;
  $('sp-nav-more').href = product.productSiteUrl;
  $('sp-nav-support').href = siteLink('/support');
  $('sp-foot-brand').href = siteLink('/');
  $('sp-ways-h').textContent = `Ways to use ${short}`;
  $('sp-ways-grid').replaceChildren(...WAYS.map((w) => {
    const a = h('a', 'sp-way');
    a.href = siteLink(w.path);
    const img = h('img', ''); img.src = `/assets/images/brand/start/${w.icon}.svg`; img.alt = ''; img.width = 56; img.height = 56; img.loading = 'lazy';
    a.append(img, h('b', '', w.title), ...(w.soon ? [h('span', 'sp-soon', 'Coming soon')] : []), h('span', 'sp-way-line', w.line));
    return a;
  }));
  const column = (id, list, outside) => $(id).append(...list.map(([text, to]) => { const a = h('a', '', text); a.href = outside ? to : siteLink(to); if (outside) { a.target = '_blank'; a.rel = 'noopener'; } return a; }));
  column('sp-foot-products', footProducts()); column('sp-foot-studio', FOOT_STUDIO); column('sp-foot-else', FOOT_ELSEWHERE, true);
  const legal = $('sp-legal');
  legal.replaceChildren(`\u00a9 ${new Date().getFullYear()} Coffee Pub Studio \u00b7 `, Object.assign(h('a', '', 'Privacy'), { href: siteLink('/privacy.html') }), ' \u00b7 ', Object.assign(h('a', '', 'Terms'), { href: siteLink('/terms.html') }));
}
async function load() {
  $('sp-failed').hidden = true;
  let data = null;
  try {
    const res = await fetch('/api/product', { headers: { accept: 'application/json' } });
    if (res.ok) data = await res.json();
  } catch { /* shown below */ }
  if (!data || typeof data.name !== 'string' || !data.baseDomain) {
    $('sp-find').hidden = true;
    $('sp-failed').hidden = false;
    return;
  }
  product = data;
  $('sp-find').hidden = false;
  D.title = product.name;
  drawLockup(product.name);
  const suffix = $('sp-find-suffix');
  suffix.className = 'sp-suffix'; suffix.removeAttribute('aria-hidden'); suffix.textContent = `.${product.baseDomain}`;
  $('sp-find-box').addEventListener('mousedown', (e) => { if (e.target !== $('sp-find-input')) { e.preventDefault(); $('sp-find-input').focus(); } });
  $('sp-link').hidden = false;
  drawFind();
  drawRecent();
  drawStudio(drawHero());
  if (matchMedia('(pointer: fine)').matches) $('sp-find-input').focus(); // not on a phone: the keyboard would cover the page
}
$('sp-retry').addEventListener('click', async () => { await load(); });
load();
