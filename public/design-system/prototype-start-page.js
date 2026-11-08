// The Start page section of the Prototype (plan-product-site.md, slice 3): the page at the product host's "/" that replaces today's
// product pages (landing.html), drawn for Thomas to judge and lock before anything is built. Design-process only: nothing here ships,
// nothing is fetched and nothing is stored. The page is drawn with the app's own system (public/sdk/system.css) and theme tokens, in the
// current default theme, light or dark from the switch at the top of the Prototype; the Chameleon theme, once built, restyles it.
// What is real: the address field (typing builds the address, the check runs on made-up environments, Go and Enter go), Recent (choose a
// row, remove one, a stale row is dropped), the sign-up address check and its Make button, the folded form, the demo's Copy and Retry on a
// failed load. Where the real page would leave (open an environment's sign-in, the product page, a mail link) a dashed Prototype note says
// where it would go instead. The product's name, the base domain, the contact and the product page's address are sample words: the real
// page reads them from GET /api/product (PRODUCT_NAME, BASE_DOMAIN, CONTACT_EMAIL, PRODUCT_SITE_URL). The sample domain is example.com
// because the brand's own domains may not be written in code (tools/check-brand-hosts.mjs).
const D = document;
const h = (tag, cls, text) => { const e = D.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fa = (name) => { const i = h('i', `fa-solid fa-${name} fa-fw`); i.setAttribute('aria-hidden', 'true'); return i; };
let uid = 0;
const nid = (p) => `sp-${p}-${++uid}`;

// ---- the sample: what GET /api/product would give, and the made-up environments behind GET /api/product/environment ----
const P = { name: 'Coffee Pub Chameleon', short: 'Chameleon', base: 'example.com', site: 'https://example.com/products/chameleon', contact: 'hello@example.com', host: 'chameleon.example.com' };
const ENVS = { 'elegant-eight': 'The Elegant Eight', 'rome-2027': 'Rome 2027', mossfield: 'Mossfield Campaign', 'lisbon-week': 'A Week in Lisbon', demo: 'Demo' };
const RESERVED = new Set(['admin', 'www', 'api', 'mail']);
const TEMPLATES = [
  ['', 'None', 'Start plain: the usual words and settings.'],
  ['travel', 'Travel', 'Plan trips together: the itinerary, places, maps, research and a calendar.'],
  ['games', 'Games', 'Run a campaign together: the chat, the calendar for sessions, a campaign planner, quests, lore and polls, and every player as an OBS source.'],
];
const DEMO_PASSWORD = 'try-it-out';
const R1 = [{ slug: 'elegant-eight', name: 'The Elegant Eight' }];
const R3 = [{ slug: 'rome-2027', name: 'Rome 2027' }, { slug: 'elegant-eight', name: 'The Elegant Eight' }, { slug: 'old-crew', name: 'Old Crew' }];
const addr = (slug) => `${slug}.${P.base}`;
const signIn = (slug, login) => `https://${addr(slug)}/login${login ? `?login=${encodeURIComponent(login)}` : ''}`;

// Go's cleaning (the plan): lower case, spaces trimmed, a full address pasted in cut to its first label.
const clean = (raw) => {
  let s = String(raw).trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#\s]/)[0];
  return s.includes('.') ? s.split('.')[0] : s;
};
const shapeOk = (s) => /^[a-z0-9-]{3,30}$/.test(s);
// The made-up GET /api/product/environment?slug=: the name, 404, or (for the drawings of errors) no answer or too many tries.
const lookup = (slug) => new Promise((done) => setTimeout(() => {
  if (slug === 'offline') done({ error: 'net' });
  else if (slug === 'busy') done({ error: 'limit' });
  else done(ENVS[slug] ? { slug, name: ENVS[slug] } : { error: 'none' });
}, 450));

const SAY = {
  none: 'There is nothing at that address. Check the spelling.',
  bad: 'An address is 3 to 30 letters, digits or hyphens.',
  net: 'Could not reach the server. Try again.',
  limit: 'Too many tries. Wait a minute, then try again.',
  signupHint: 'Letters, digits and hyphens, 3 to 30. It cannot be changed later.',
};

function line(el, kind, icon, parts) {
  el.textContent = '';
  if (kind) el.dataset.kind = kind; else delete el.dataset.kind;
  if (!parts || !parts.length) return;
  if (icon === 'spin') { const s = h('span', 'sdk-spinner sdk-spinner-sm'); s.setAttribute('aria-hidden', 'true'); el.append(s); } else if (icon) el.append(fa(icon));
  const t = h('span');
  for (const p of parts) t.append(typeof p === 'string' ? D.createTextNode(p) : p);
  el.append(t);
}
function protoNote(el, text) { el.textContent = ''; el.append(h('b', '', 'Prototype'), h('span', '', text)); el.hidden = false; }
function protoEl() { const p = h('p', 'sp-proto'); p.hidden = true; p.setAttribute('role', 'status'); return p; }

// The address with the base domain after it, in one box (a click anywhere in it puts the cursor in the field).
function addressBox(input, suffixNode) {
  const box = h('div', 'sp-address');
  box.append(input, suffixNode || h('span', 'sp-suffix', `.${P.base}`));
  box.addEventListener('mousedown', (e) => { if (e.target !== input) { e.preventDefault(); input.focus(); } });
  return box;
}

// ---- 1. Find your environment ----
// check: 'type' (A, the name is looked up as you type and Go waits for it) or 'go' (B, the plan's contract: Go looks it up and opens).
// state: { value, phase } to start in: idle, looking, found, none, bad, net, limit, opening. loading: the base domain is not known yet.
function findPart(ctx, { check = 'type', value = '', phase = 'idle', loading = false } = {}) {
  const sec = h('section', 'sdk-panel sp-part');
  const hid = nid('find');
  sec.setAttribute('aria-labelledby', hid);
  const title = h('h2', '', 'Find your environment'); title.id = hid;
  const form = h('form', 'sp-form');
  form.noValidate = true;
  const iid = nid('addr');
  const lab = h('label', 'sdk-label', 'Its address'); lab.htmlFor = iid;
  const input = h('input');
  Object.assign(input, { id: iid, type: 'text', value, autocomplete: 'off', spellcheck: false, placeholder: 'yourname' });
  input.setAttribute('autocapitalize', 'off'); input.setAttribute('enterkeyhint', 'go');
  const suffix = loading ? h('span', 'sdk-skel sdk-skel-line sp-skel-suffix') : h('span', 'sp-suffix', `.${P.base}`);
  if (loading) suffix.setAttribute('aria-hidden', 'true');
  const go = h('button', 'btn btn-primary sp-go');
  go.type = 'submit';
  const say = h('p', 'sp-line'); say.id = nid('say'); say.setAttribute('aria-live', 'polite');
  input.setAttribute('aria-describedby', say.id);
  const proto = protoEl();
  const row = h('div', 'sp-go-row');
  row.append(addressBox(input, suffix), go);
  form.append(lab, row, say);
  sec.append(title, form, proto);

  const st = { phase, env: phase === 'found' || phase === 'opening' ? { slug: clean(value), name: ENVS[clean(value)] || 'The Elegant Eight' } : null, token: 0, timer: null };
  function draw() {
    const slug = clean(input.value);
    const busy = st.phase === 'looking' || st.phase === 'opening';
    go.textContent = '';
    if (busy && check === 'go') { const s = h('span', 'sdk-spinner sdk-spinner-sm'); s.setAttribute('aria-hidden', 'true'); go.append(s, h('span', '', 'Go')); } else go.append(h('span', '', 'Go'));
    go.setAttribute('aria-busy', String(busy));
    go.disabled = loading || (check === 'type' ? st.phase !== 'found' : !input.value.trim() || busy);
    input.setAttribute('aria-invalid', String(st.phase === 'none' || st.phase === 'bad'));
    if (st.phase === 'looking') line(say, '', 'spin', [`Looking for ${addr(slug)}`]);
    else if (st.phase === 'found') { const n = h('strong', '', st.env.name); line(say, 'ok', 'circle-check', [n, ` at ${addr(st.env.slug)}`]); }
    else if (st.phase === 'opening') line(say, 'ok', 'spin', ['Opening ', h('strong', '', st.env.name)]);
    else if (st.phase === 'none') line(say, 'error', 'circle-exclamation', [SAY.none]);
    else if (st.phase === 'bad') line(say, 'error', 'circle-exclamation', [SAY.bad]);
    else if (st.phase === 'net') line(say, 'error', 'circle-exclamation', [SAY.net]);
    else if (st.phase === 'limit') line(say, 'error', 'circle-exclamation', [SAY.limit]);
    else if (slug && !loading) line(say, '', 'globe', [slug !== input.value.trim() ? `Goes to ${addr(slug)}` : addr(slug)]);
    else line(say, '', '', []);
  }
  function open(env) {
    st.phase = check === 'go' ? 'opening' : 'found'; st.env = env; draw();
    protoNote(proto, `Go would open ${signIn(env.slug)} in this tab (that environment's own sign-in), and ${env.name} would be first in Recent.`);
    ctx.addRecent(env);
  }
  async function ask(then) {
    const slug = clean(input.value);
    const mine = ++st.token;
    st.phase = 'looking'; draw();
    const r = await lookup(slug);
    if (mine !== st.token) return;
    if (r.error) { st.phase = r.error; draw(); return; }
    st.env = r; st.phase = 'found'; draw();
    if (then) open(r);
  }
  input.addEventListener('input', () => {
    clearTimeout(st.timer); st.token += 1; st.phase = 'idle'; st.env = null; proto.hidden = true; draw();
    if (check !== 'type' || loading) return;
    const slug = clean(input.value);
    if (!slug || (slug.length < 3 && /^[a-z0-9-]*$/.test(slug))) return; // too short to say anything yet
    st.timer = setTimeout(() => { if (!shapeOk(slug)) { st.phase = 'bad'; draw(); } else ask(false); }, 300);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (loading) return;
    const slug = clean(input.value);
    if (!slug) { input.focus(); return; }
    if (!shapeOk(slug)) { st.phase = 'bad'; draw(); input.focus(); return; }
    if (st.phase === 'found' && st.env && st.env.slug === slug) { open(st.env); return; }
    clearTimeout(st.timer);
    ask(true);
  });
  draw();
  ctx.focusFind = () => input.focus();
  return sec;
}

// ---- 2. Recent: the environments this browser reached through this page, newest first, up to 5 ----
function recentPart(ctx) {
  const sec = h('section', 'sdk-panel sp-part');
  const hid = nid('recent');
  sec.setAttribute('aria-labelledby', hid);
  const title = h('h2', '', 'Recent'); title.id = hid;
  const ul = h('ul', 'sp-recent');
  const say = h('p', 'sp-line'); say.setAttribute('aria-live', 'polite');
  const proto = protoEl();
  sec.append(title, ul, say, proto);
  function draw(focusAt) {
    ul.textContent = '';
    ctx.recent.forEach((env, i) => {
      const li = h('li', 'sdk-row');
      const main = h('span', 'sdk-row-main');
      const a = h('a', 'sdk-open sdk-row-title', env.name);
      a.href = signIn(env.slug);
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        line(say, '', 'spin', [`Looking for ${addr(env.slug)}`]); proto.hidden = true;
        const r = await lookup(env.slug);
        if (r.error === 'none') { // gone since: dropped, with Go's sentence
          ctx.recent = ctx.recent.filter((x) => x.slug !== env.slug);
          line(say, 'error', 'circle-exclamation', [`${SAY.none} ${env.name} is gone from Recent.`]);
          ctx.drawRecent(Math.min(i, ctx.recent.length - 1));
          return;
        }
        if (r.error) { line(say, 'error', 'circle-exclamation', [SAY[r.error]]); return; }
        line(say, '', '', []);
        protoNote(proto, `Would open ${signIn(env.slug)} in this tab, and move ${env.name} to the top of Recent.`);
      });
      main.append(a, h('span', 'sdk-row-sub', addr(env.slug)));
      const x = h('button', 'sdk-icon-btn btn-quiet btn-small');
      x.type = 'button'; x.setAttribute('aria-label', `Remove ${env.name} from Recent`); x.title = 'Remove from Recent';
      x.append(fa('xmark'));
      x.addEventListener('click', () => {
        ctx.recent = ctx.recent.filter((r) => r.slug !== env.slug);
        line(say, '', '', []); proto.hidden = true;
        ctx.drawRecent(Math.min(i, ctx.recent.length - 1));
      });
      li.append(main, x);
      ul.append(li);
    });
    if (focusAt !== undefined && focusAt >= 0) { const a = ul.querySelectorAll('a')[focusAt]; if (a) a.focus(); }
  }
  return { sec, draw };
}

// ---- 3. Got a link? ----
function linkPart() {
  const sec = h('section', 'sp-plain');
  sec.append(h('h2', '', 'Got a link?'), h('p', '', 'Open the link itself. A guest link or an invite takes you in on its own; there is nothing to choose here.'));
  return sec;
}

// ---- the demo (decision 5): its own sign-in with the login filled in, the public password beside the button ----
function demoPart() {
  const sec = h('section', 'sdk-panel sp-part');
  const hid = nid('demo');
  sec.setAttribute('aria-labelledby', hid);
  const title = h('h2', '', 'Try the demo'); title.id = hid;
  const proto = protoEl();
  const go = h('a', 'btn btn-primary', 'Try the demo');
  go.href = signIn('demo', 'demo');
  go.addEventListener('click', (e) => { e.preventDefault(); protoNote(proto, `Would open ${signIn('demo', 'demo')}: the demo's own sign-in with the login demo filled in. The password is typed there.`); });
  const key = h('span', 'sp-demo-key');
  const code = h('code', '', DEMO_PASSWORD);
  const copy = h('button', 'btn btn-small btn-quiet', 'Copy');
  copy.type = 'button'; copy.setAttribute('aria-label', 'Copy the demo password');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(DEMO_PASSWORD); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select it to copy'; }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
  });
  key.append(h('span', '', 'Password'), code, copy);
  const row = h('div', 'sp-demo-row');
  row.append(go, key);
  // the real page's anchor is #demo; drawn many times here, so no id
  sec.append(title, h('p', 'sp-quiet', 'A sample trip to look around in. Anyone can use it, and it is put back every night.'), row, proto);
  return sec;
}

// ---- 4. Get your own ----
// own: 'open' (sign-up), 'contact' (closed, a contact address), 'soon' (closed, none). fold: B, the form behind a button.
// password: B, today's owner password in the form. slugState: a sign-up address to start with.
function ownPart(ctx, { own = 'open', fold = false, password = false, slug = '', submit = 'idle' } = {}) {
  const sec = h('section', 'sdk-panel sp-part');
  const hid = nid('own');
  sec.setAttribute('aria-labelledby', hid);
  const title = h('h2', '', 'Get your own'); title.id = hid;
  sec.append(title);
  const proto = protoEl();
  if (own === 'soon') { sec.append(h('p', 'sp-quiet', 'Coming soon.')); return sec; }
  if (own === 'contact') {
    const a = h('a', 'btn', 'Ask for an environment');
    a.href = `mailto:${P.contact}?subject=${encodeURIComponent(`An environment on ${P.name}`)}`;
    a.addEventListener('click', (e) => { e.preventDefault(); protoNote(proto, `Would open a new mail to ${P.contact}.`); });
    const acts = h('div', 'sp-own-actions'); acts.append(a);
    sec.append(h('p', 'sp-quiet', 'Making your own environment here is not open yet. Ask, and we will set one up.'), acts, h('p', 'sp-quiet', `Writes to ${P.contact}.`), proto);
    return sec;
  }
  sec.append(h('p', 'sp-quiet', 'Your own environment on the free plan: its own address, people and spaces. It takes a minute.'));
  const form = h('form', 'sp-form');
  form.noValidate = true;
  const field = (word, input, hint) => { const l = h('label'); l.append(h('span', 'sdk-label', word), input); if (hint) l.append(hint); return l; };
  const inp = (attrs) => { const i = h('input'); Object.assign(i, { type: 'text', autocomplete: 'off', ...attrs }); return i; };
  const slugIn = inp({ value: slug, maxLength: 30, spellcheck: false, placeholder: 'yourname' });
  slugIn.setAttribute('autocapitalize', 'off');
  const slugSay = h('span', 'sdk-hint');
  slugSay.id = nid('slugsay'); slugSay.setAttribute('aria-live', 'polite'); slugIn.setAttribute('aria-describedby', slugSay.id);
  const slugLab = h('label'); slugLab.append(h('span', 'sdk-label', 'Address'), addressBox(slugIn), slugSay);
  const nameIn = inp({ maxLength: 60, placeholder: 'The Elegant Eight' });
  const loginIn = inp({ maxLength: 40 }); loginIn.setAttribute('autocapitalize', 'off');
  const displayIn = inp({ maxLength: 40 });
  const fs = h('fieldset');
  const lg = h('legend', 'sdk-label', 'Template');
  const list = h('div', 'sdk-choice-list');
  const gname = nid('tpl');
  for (const [id, word, desc] of TEMPLATES) {
    const r = h('label', 'sdk-choice-row sdk-choice-boxed');
    const i = h('input'); i.type = 'radio'; i.name = gname; i.value = id; i.checked = !id;
    const t = h('span', 'sdk-choice-text'); t.append(h('span', 'sdk-choice-label', word), h('span', 'sdk-choice-desc', desc));
    r.append(i, t); list.append(r);
  }
  fs.append(lg, h('p', 'sdk-hint', 'Set it up for one use: its words, home icon and modules. You can change anything it sets later.'), list);
  const make = h('button', 'btn btn-primary', 'Make my environment'); make.type = 'submit';
  const status = h('p', 'sp-line'); status.setAttribute('role', 'status');
  const foot = h('div', 'sp-form-foot'); foot.append(make);
  form.append(slugLab, field('Its name', nameIn), fs, field('Your login', loginIn), field('Your name (optional)', displayIn));
  if (password) { const pw = inp({ type: 'password', autocomplete: 'new-password', minLength: 8 }); form.append(field('Your password', pw)); }
  form.append(foot, status);
  if (!password) form.append(h('p', 'sdk-hint', 'Next you choose your password, on your new environment\'s own page.'));
  // The address check as you type (as landing.js does today): the shape hint, then free, taken or reserved after a short pause.
  let token = 0; let timer = null;
  const sayCheck = (text, kind) => { slugSay.textContent = text; slugSay.className = kind === 'error' ? 'sdk-error' : 'sdk-hint'; slugIn.setAttribute('aria-invalid', String(kind === 'error')); };
  const check = (now) => {
    clearTimeout(timer); const mine = ++token; const s = slugIn.value;
    sayCheck(SAY.signupHint);
    if (!shapeOk(s)) return;
    const run = () => { if (mine !== token) return; if (RESERVED.has(s)) sayCheck(`"${s}" is reserved. Pick another.`, 'error'); else if (ENVS[s] || s === 'old-crew') sayCheck(`${addr(s)} is taken.`, 'error'); else sayCheck(`${addr(s)} is free.`, 'ok'); };
    if (now) run(); else timer = setTimeout(run, 250);
  };
  slugIn.addEventListener('input', () => { slugIn.value = slugIn.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); check(false); });
  check(true);
  const setStatus = (kind) => {
    make.disabled = kind === 'making';
    if (kind === 'making') line(status, '', 'spin', ['Making it']);
    else if (kind === 'error') line(status, 'error', 'circle-exclamation', [`${addr(slugIn.value || 'rome-2027')} was just taken. Pick another address.`]);
    else if (kind === 'done') line(status, 'ok', 'circle-check', [`Made. Taking you to ${addr(slugIn.value)}.`]);
    else line(status, '', '', []);
  };
  setStatus(submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = slugIn.value;
    if (!shapeOk(s)) { sayCheck(SAY.signupHint, 'error'); slugIn.focus(); return; }
    if (!nameIn.value.trim()) { nameIn.setAttribute('aria-invalid', 'true'); nameIn.focus(); return; }
    if (!loginIn.value.trim()) { loginIn.setAttribute('aria-invalid', 'true'); loginIn.focus(); return; }
    nameIn.removeAttribute('aria-invalid'); loginIn.removeAttribute('aria-invalid');
    setStatus('making');
    setTimeout(() => {
      if (ENVS[s] || RESERVED.has(s)) { setStatus('error'); return; }
      setStatus('done');
      ctx.addRecent({ slug: s, name: nameIn.value.trim() });
      protoNote(proto, `Would open ${signIn(s, loginIn.value.trim())}${password ? '' : ', where the owner chooses a password first'}. ${nameIn.value.trim()} is now first in Recent.`);
    }, 700);
  });
  if (fold) {
    const open = h('button', 'btn', 'Make an environment');
    open.type = 'button';
    form.id = nid('signup'); form.hidden = true;
    open.setAttribute('aria-expanded', 'false'); open.setAttribute('aria-controls', form.id);
    const acts = h('div', 'sp-own-actions'); acts.append(open);
    open.addEventListener('click', () => { form.hidden = false; acts.hidden = true; open.setAttribute('aria-expanded', 'true'); slugIn.focus(); });
    sec.append(acts);
  }
  sec.append(form, proto);
  return sec;
}

// ---- 5. About: the product page on the website, when PRODUCT_SITE_URL is set ----
function footPart(proto) {
  const f = h('footer', 'sp-foot');
  const a = h('a', '', `About ${P.short}`);
  a.href = P.site;
  a.append(fa('arrow-up-right-from-square'));
  a.addEventListener('click', (e) => { e.preventDefault(); protoNote(proto, `Would open ${P.site}, the product page on the website (PRODUCT_SITE_URL).`); });
  f.append(a);
  return f;
}

// ---- the whole page ----
// w: 1280 or 390. recent: the rows to start with. layout: 'one' (A) or 'two' (B). recentAt: 'below' (B) or 'above' (A) the field.
function startPage(o = {}) {
  const { w = 1280, recent = [], layout = 'one', recentAt = 'below', demo = false, own = 'open', fold = true, password = false, about = true, find = {}, load = 'ok', keys = false } = o;
  const screen = h('div', `sp-screen${keys ? ' sp-keys' : ''}`);
  screen.dataset.w = String(w);
  const bar = h('div', 'sp-bar');
  bar.setAttribute('aria-hidden', 'true');
  bar.append(fa('lock'), h('span', 'sp-bar-url', `${P.host}/`));
  const page = h('div', 'sp-page');
  page.dataset.w = String(w);
  screen.append(bar, page);
  const ctx = { recent: recent.map((r) => ({ ...r })) };
  function build() {
    page.textContent = '';
    if (load === 'failed' && !ctx.retried) {
      const e = h('div', 'sdk-empty');
      e.dataset.kind = 'error';
      const retry = h('button', 'btn', 'Try again'); retry.type = 'button';
      retry.addEventListener('click', () => { ctx.retried = true; build(); if (ctx.focusFind) ctx.focusFind(); });
      const acts = h('div', 'sdk-empty-actions'); acts.append(retry);
      e.append(fa('triangle-exclamation'), h('p', 'sdk-empty-title', 'This page did not load'), h('p', 'sdk-empty-text', 'Check your connection, then try again.'), acts);
      page.append(e);
      return;
    }
    const loading = load === 'loading';
    const cols = h('div', 'sp-cols');
    cols.dataset.layout = layout;
    const name = loading ? h('div', 'sdk-skel sdk-skel-title sp-skel-name') : h('h1', 'sp-name', P.name);
    if (loading) { name.setAttribute('role', 'img'); name.setAttribute('aria-label', 'Loading'); }
    const slot = h('div'); slot.style.display = 'contents';
    const rec = recentPart(ctx);
    ctx.drawRecent = (focusAt) => {
      slot.textContent = '';
      if (!ctx.recent.length) { if (focusAt !== undefined && ctx.focusFind) ctx.focusFind(); return; } // none: the part is not drawn
      slot.append(rec.sec); rec.draw(focusAt);
    };
    ctx.addRecent = (env) => { ctx.recent = [env, ...ctx.recent.filter((r) => r.slug !== env.slug)].slice(0, 5); ctx.drawRecent(); };
    const findSec = findPart(ctx, { ...find, loading });
    const first = h('div', 'sp-col'); const second = h('div', 'sp-col');
    first.append(name);
    if (recentAt === 'above') first.append(slot, findSec); else first.append(findSec, slot);
    if (!loading) {
      if (demo) first.append(demoPart());
      first.append(linkPart());
      (layout === 'two' ? second : first).append(ownPart(ctx, { own, fold, password }));
    }
    cols.append(first);
    if (layout === 'two' && second.childElementCount) cols.append(second);
    page.append(cols);
    ctx.drawRecent();
    if (about && !loading) { const proto = protoEl(); page.append(footPart(proto), proto); }
  }
  build();
  if (keys) {
    // The keyboard drawing: a number on each Tab stop, in order (a radio group is one stop: its checked radio).
    const badges = h('div');
    screen.append(badges);
    screen.style.position = 'relative';
    const place = () => {
      badges.textContent = '';
      const sr = screen.getBoundingClientRect();
      const stops = [...page.querySelectorAll('a[href], button, input, select, textarea')].filter((e) => !e.disabled && e.getClientRects().length && !e.closest('[hidden]') && (e.type !== 'radio' || e.checked));
      stops.forEach((e, i) => {
        const r = e.getBoundingClientRect();
        const b = h('span', 'sp-badge', String(i + 1));
        b.setAttribute('aria-hidden', 'true');
        b.style.left = `${r.left - sr.left}px`; b.style.top = `${r.top - sr.top}px`;
        badges.append(b);
      });
    };
    new ResizeObserver(() => place()).observe(screen);
    new MutationObserver(() => requestAnimationFrame(place)).observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
  }
  return screen;
}

// Only one part, for the states (the Find, Recent and Get your own parts on the page's own surface).
function partScreen(build) {
  const screen = h('div', 'sp-screen');
  screen.dataset.w = 'part';
  const page = h('div', 'sp-page');
  page.dataset.w = 'part';
  const ctx = { recent: [] };
  ctx.addRecent = () => {};
  page.append(build(ctx));
  screen.append(page);
  return screen;
}

// ---- the section: heading, note, jump list, sets ----
const main = D.getElementById('pp-main');
const sec = h('section', 'pp-group sp');
sec.id = 'pp-start-page';
sec.setAttribute('aria-labelledby', 'pp-start-page-name');
const title = h('h2', 'pp-group-name', 'Start page: find your environment');
title.id = 'pp-start-page-name';
sec.append(title, h('p', 'pp-state-note', `Slice 3 of plan-product-site.md, for Thomas to look at and lock before anything is built. The page at the product host's address that replaces today's product pages: Find your environment, Recent, Got a link?, Get your own and About, and later Try the demo. Drawn with the app's own system and tokens in the current default theme; use Light or Dark at the top. The Chameleon theme, once built, restyles it with nothing here changed. Sample words: the product is ${P.name} (${P.short} for short), the base domain ${P.base}; the real page reads them from the server. The address field, Recent, the sign-up check and the buttons work; nothing leaves the page: a dashed Prototype note says where the real page would go. Try typing elegant-eight, rome-2027, mossfield or demo (found), anything else (not found), offline or busy (the errors).`));
const jump = h('nav', 'pp-jump');
jump.setAttribute('aria-label', 'Jump to a part of the Start page');
jump.append(h('span', 'pp-jump-label', 'Jump to'));
sec.append(jump);

function set(id, name, note) {
  const s = h('section', 'sp-set');
  s.id = `sp-${id}`;
  s.setAttribute('aria-labelledby', `sp-${id}-name`);
  const hh = h('h3', 'sp-set-name', name);
  hh.id = `sp-${id}-name`;
  s.append(hh);
  if (note) s.append(h('p', '', note));
  sec.append(s);
  const b = h('button', 'btn btn-small', name);
  b.type = 'button';
  b.addEventListener('click', () => { hh.scrollIntoView({ block: 'start' }); s.classList.add('pp-flash'); setTimeout(() => s.classList.remove('pp-flash'), 900); });
  jump.append(b);
  return s;
}
const cells = (parent, wide) => { const c = h('div', `sp-cells${wide ? ' sp-wide' : ''}`); parent.append(c); return c; };
function cell(into, name, note, node, ab) {
  const c = h('div', 'sp-cell');
  const n = h('h4', 'sp-cell-name');
  if (ab) n.append(h('span', 'sp-ab', ab));
  n.append(name);
  c.append(n);
  if (note) c.append(h('p', '', note));
  c.append(node);
  into.append(c);
  return c;
}
const ul = (items) => { const l = h('ul', 'sp-list-words'); for (const t of items) { const li = h('li'); if (Array.isArray(t)) li.append(h('strong', '', t[0]), ` ${t[1]}`); else li.append(t); l.append(li); } return l; };

// 1. The page, wide and on a phone, with 0, 1 and 3 recent.
{
  const s = set('page', 'The page', 'One plain column, the parts in the plan\'s order: Find your environment, Recent (only when there is one), Got a link?, Get your own, and About at the foot. The wide window keeps the same 480px column in the middle. Recent is drawn below the field and the sign-up form folded behind a button: the recommendations (Choices). The address is checked as you type (A, recommended); the states show B too.');
  const c = cells(s, true);
  cell(c, 'Wide (1280), a first visit: no Recent', 'Nothing in Recent, so the part is not drawn (no empty box). Sign-up is closed and the host has a contact address. About is there (PRODUCT_SITE_URL set).', startPage({ w: 1280, recent: [], own: 'contact' }));
  cell(c, 'Wide (1280), coming back: three in Recent, the demo, sign-up open', 'Old Crew has gone since this browser used it: choose it and it is dropped with Go\'s sentence. Make an environment opens the form in place.', startPage({ w: 1280, recent: R3, demo: true, own: 'open' }));
  const p = cells(s);
  cell(p, 'Phone (390): one in Recent, sign-up closed, no contact', 'Get your own says Coming soon. No PRODUCT_SITE_URL: no About link, no foot.', startPage({ w: 390, recent: R1, own: 'soon', about: false }));
  cell(p, 'Phone (390): three in Recent, the demo, sign-up open', 'Every control is 44px tall here, as on the app\'s other pages on a phone.', startPage({ w: 390, recent: R3, demo: true, own: 'open' }));
  cell(p, 'Phone (390): a first visit', 'No Recent, sign-up closed with a contact, About at the foot.', startPage({ w: 390, recent: [], own: 'contact' }));
}

// 2. The typed address, A and B side by side.
{
  const s = set('address', 'Find your environment: the states', 'Every field here is real: type in any of them. A checks the address as you type and shows the environment\'s name before you go; Go waits for it. B is the plan\'s contract: Go asks, then opens at once (the name shows only while it opens). Both clean the text the same way (lower case, spaces trimmed, a pasted address cut to its first part) and give the same sentence for an address that is not there, never why: a suspended environment and an unknown one look the same.');
  const rows = [
    ['Empty', 'Go is off until there is something to look for (A: until it is found).', { value: '', phase: 'idle' }],
    ['Typing', 'The field and the base domain after it build the address.', { value: 'elegant-ei', phase: 'idle' }],
    ['Looking (loading)', 'A short pause after the last key (A) or Go pressed (B).', { value: 'elegant-eight', phase: 'looking' }],
    ['Found', 'A: the name, and Go is on. B: the name while it opens the sign-in.', { value: 'elegant-eight', phase: 'found' }],
    ['Not found', 'The plan\'s sentence; the text stays so it can be fixed.', { value: 'elegant-eigth', phase: 'none' }],
    ['A bad name', 'Anything that cannot be an address: shown after the pause (A) or on Go (B).', { value: 'the eight!', phase: 'bad' }],
    ['A full address pasted in', 'Cut to its first part, and said so.', { value: `https://rome-2027.${P.base}/login`, phase: 'idle' }],
    ['No answer from the server', 'Type offline to see it live.', { value: 'rome-2027', phase: 'net' }],
    ['Too many tries', 'The server\'s limit (429). Type busy to see it live.', { value: 'rome-2027', phase: 'limit' }],
  ];
  for (const [name, note, st] of rows) {
    const c = cells(s);
    cell(c, `${name}: as you type`, note, partScreen((ctx) => findPart(ctx, { check: 'type', ...st, phase: st.phase })), 'A');
    cell(c, `${name}: on Go`, '', partScreen((ctx) => findPart(ctx, { check: 'go', ...st, phase: st.phase === 'found' ? 'opening' : st.phase })), 'B');
  }
}

// 3. Recent: none, one, three, and a stale one.
{
  const s = set('recent', 'Recent', 'Kept in this browser only (the page\'s own storage, a key named by kind), written when Go finds an environment and after a sign-up; up to 5, newest first. Each row opens that environment\'s sign-in; the x removes it, for a shared computer. The server keeps nothing. With none, the part is not drawn at all.');
  const c = cells(s);
  cell(c, 'None', 'Nothing is drawn: the next part follows Find your environment.', partScreen(() => { const d = h('div', 'sp-plain'); d.append(h('p', '', 'No Recent part on the page.')); return d; }));
  const mk = (list) => partScreen((ctx) => { ctx.recent = list.map((r) => ({ ...r })); const wrap = h('div'); wrap.style.display = 'contents'; const r = recentPart(ctx); ctx.drawRecent = (f) => { wrap.textContent = ''; if (ctx.recent.length) { wrap.append(r.sec); r.draw(f); } else wrap.append(h('p', 'sp-quiet', 'The last one is removed: the part is gone, and the focus is back in the address field.')); }; ctx.drawRecent(); return wrap; });
  cell(c, 'One', '', mk(R1));
  cell(c, 'Three, one of them gone', 'Choose Old Crew: it is dropped, with the same sentence as Go. Remove one: the focus moves to the next row.', mk(R3));
}

// 4. The demo, present and hidden.
{
  const s = set('demo', 'Try the demo', 'Decision 5: the button opens the demo environment\'s own sign-in with the login filled in (?login=demo), and the public demo password is shown beside it; the person types it there. Two steps, and no password field on this page. Its anchor on the real page is #demo. It is not drawn until the demo exists (#416, slices 4, 6 and 7).');
  const c = cells(s);
  cell(c, 'Present (the demo exists)', 'Between Find your environment and Got a link?, so a visitor sees it before the sign-up.', partScreen(() => demoPart()));
  cell(c, 'Hidden (until then)', 'Not drawn at all: nothing says a demo is coming.', partScreen(() => { const d = h('div', 'sp-plain'); d.append(h('p', '', 'No Try the demo part on the page.')); return d; }));
}

// 5. Get your own: open, the name check, closed.
{
  const s = set('own', 'Get your own', 'Sign-up when the host has SIGNUP on: the address with its check as you type (as today), a name, the template choice as the app does today (None, then each of the host\'s templates; ?template=travel would choose Travel), and the owner\'s login. Closed: the contact link when the host has CONTACT_EMAIL, else Coming soon. Its anchor on the real page is #start.');
  const c = cells(s);
  cell(c, 'Open', 'Try an address: rome-2027 is taken, admin is reserved, anything else is free. Make my environment works.', partScreen((ctx) => ownPart(ctx, { own: 'open' })));
  cell(c, 'Closed, with a contact', '', partScreen((ctx) => ownPart(ctx, { own: 'contact' })));
  cell(c, 'Closed, no contact', '', partScreen((ctx) => ownPart(ctx, { own: 'soon' })));
  const n = cells(s);
  for (const [name, slug, note] of [
    ['The address check: too short', 'ro', 'The shape hint stays until it is 3 or more.'],
    ['Free', 'riverside', ''],
    ['Taken', 'rome-2027', ''],
    ['Reserved', 'admin', ''],
  ]) cell(n, name, note, partScreen((ctx) => ownPart(ctx, { own: 'open', slug })));
  const m = cells(s);
  cell(m, 'Making it (loading)', '', partScreen((ctx) => ownPart(ctx, { own: 'open', slug: 'riverside', submit: 'making' })));
  cell(m, 'Refused', 'The server\'s words, under the button; nothing typed is lost.', partScreen((ctx) => ownPart(ctx, { own: 'open', slug: 'riverside', submit: 'error' })));
  cell(m, 'Made', 'It goes on to the new environment\'s sign-in, and the environment is first in Recent.', partScreen((ctx) => ownPart(ctx, { own: 'open', slug: 'riverside', submit: 'done' })));
}

// 6. Loading and errors.
{
  const s = set('errors', 'Loading and errors', 'Before the server has answered GET /api/product the page has no name and no base domain: the field can be typed in, Go waits. If the answer never comes, one plain error and Try again. The field\'s own errors are in Find your environment: the states; the sign-up\'s are under Get your own.');
  const c = cells(s);
  cell(c, 'Loading (390)', '', startPage({ w: 390, load: 'loading' }));
  cell(c, 'Did not load (390)', 'Try again draws the page (real here).', startPage({ w: 390, load: 'failed', recent: R1, own: 'contact' }));
}

// 7. The keyboard.
{
  const s = set('keys', 'Keyboard and focus order', 'The numbers are the Tab order, read from the drawing itself (it is real: press Tab in it). The address field is first, so a person who knows their address types and presses Enter. A row of Recent is two stops: the row (Enter opens it) and its x. A radio group is one stop; the arrow keys move in it. The page sets no tabindex of its own.');
  s.append(ul([
    ['Enter', 'in the address field is Go. In A it waits for the name; pressed before then it looks the address up and goes.'],
    ['After x', 'the focus moves to the next row of Recent, or the one before; after the last, to the address field.'],
    ['Make an environment', 'opens the form in place and puts the focus in its Address.'],
    ['Errors', 'are read out (a live line under the field) and leave the focus where it was, in the field.'],
    ['Focus', 'is the system\'s ring on every control, the same as on the app\'s other pages.'],
  ]));
  const c = cells(s, true);
  cell(c, 'Wide (1280): three in Recent, the demo, sign-up folded', '', startPage({ w: 1280, recent: R3, demo: true, own: 'open', keys: true }));
  const p = cells(s);
  cell(p, 'Phone (390): the same order', '', startPage({ w: 390, recent: R3, demo: true, own: 'open', keys: true }));
}

// 8. The choices, A and B.
{
  const s = set('choices', 'Choices: A or B', 'Visual choices the plan leaves open, drawn both ways with a recommendation each. The page above is drawn with the recommendations.');
  const q1 = h('p'); q1.append(h('strong', '', 'The layout in a wide window. '), 'A: one column, the same at every width. B: two columns from 900px, signing in on the left and Get your own on the right. Recommendation: A. The page is a doorway; almost everyone comes to type an address, and one column reads top to bottom the same way on a phone.');
  s.append(q1);
  const c1 = cells(s, true);
  cell(c1, 'One column', '', startPage({ w: 1280, recent: R1, own: 'open', fold: false }), 'A');
  cell(c1, 'Two columns', '', startPage({ w: 1280, recent: R1, own: 'open', fold: false, layout: 'two' }), 'B');
  const q2 = h('p'); q2.append(h('strong', '', 'Where Recent sits. '), 'A: above the address field, so a returning person\'s one click comes first. B: below it, the plan\'s order. Recommendation: B. The field stays in one place whether or not there is a Recent, and it is the first Tab stop either way.');
  s.append(q2);
  const c2 = cells(s);
  cell(c2, 'Recent above the field', '', startPage({ w: 390, recent: R3, own: 'soon', recentAt: 'above' }), 'A');
  cell(c2, 'Recent below the field', '', startPage({ w: 390, recent: R3, own: 'soon' }), 'B');
  const q3 = h('p'); q3.append(h('strong', '', 'When the address is checked. '), 'A: as you type, after a short pause, the environment\'s name shown before you go. B: only on Go, which then opens at once (the plan\'s contract). Recommendation: A. Seeing "The Elegant Eight" before leaving catches a wrong address on this page, not on a sign-in page that is not yours. It asks the same route Go does, so it shows nothing Go would not; it needs the same per-address limit the sign-up check has. Both are in Find your environment: the states.');
  s.append(q3);
  const c3 = cells(s);
  cell(c3, 'As you type', 'Type mossfield.', partScreen((ctx) => findPart(ctx, { check: 'type' })), 'A');
  cell(c3, 'On Go', 'Type mossfield and press Go.', partScreen((ctx) => findPart(ctx, { check: 'go' })), 'B');
  const q4 = h('p'); q4.append(h('strong', '', 'The sign-up form. '), 'A: open in the page. B: folded behind Make an environment, opened in place. Recommendation: B. The form is long and most visitors only sign in; the website\'s #start link would open it already unfolded.');
  s.append(q4);
  const c4 = cells(s);
  cell(c4, 'Open', '', partScreen((ctx) => ownPart(ctx, { own: 'open' })), 'A');
  cell(c4, 'Folded', '', partScreen((ctx) => ownPart(ctx, { own: 'open', fold: true })), 'B');
  const q5 = h('p'); q5.append(h('strong', '', 'The owner\'s password at sign-up. '), 'The plan says no password field anywhere on the page, and also keeps today\'s sign-up, which asks for the owner\'s password. A: no password here; the new environment\'s own page asks for it first (this needs a server change: sign-up\'s answer would carry a one-time way to set it). B: today\'s password field, against "no password anywhere". Recommendation: A, and Thomas decides; drawn as A everywhere above.');
  s.append(q5);
  const c5 = cells(s);
  cell(c5, 'No password here', '', partScreen((ctx) => ownPart(ctx, { own: 'open' })), 'A');
  cell(c5, 'The password as today', '', partScreen((ctx) => ownPart(ctx, { own: 'open', password: true })), 'B');
}

// 9. What the page is not.
{
  const s = set('not', 'What it is not', 'So the page stays a doorway (the plan, "What the start page is").');
  s.append(ul([
    ['No list of environments.', 'It shows only what this browser reached through it (Recent). The public list, GET /api/product/environments, goes in slice 0.'],
    ['No password.', 'It sends people on to their environment\'s own sign-in page, which asks. The demo\'s password is printed, not typed here.'],
    ['No marketing.', 'No hero, screenshots, uses, plans to sell or "how it works": those are on the product page on the website, linked by About.'],
    ['No account here.', 'The host does not know who anyone is: no email, no "find my environments", no sign-in across environments.'],
    ['Not the product page.', 'It never says what the product does beyond its name.'],
    ['Not drawn here: Plans.', 'The plan\'s sixth part (decision 9, #plans), a short list of the host\'s plans for Manage\'s Upgrade link, was not in this brief.'],
  ]));
}

main.append(sec);
// The page's own jump list (prototype-phone.js; the Vault moves it into the dock): one more button.
const pageJump = D.querySelector('nav.pp-jump[aria-label="Jump to a section of the page"]');
if (pageJump) {
  const b = h('button', 'btn btn-small', 'Start page');
  b.type = 'button';
  b.addEventListener('click', () => title.scrollIntoView({ block: 'start' }));
  pageJump.append(b);
}
window.startPageSection = { clean, shapeOk };
