// The product pages' one script (public/landing.html and each use page). It is a plain script loaded in <head>, not a
// module and not deferred, so its first lines choose light or dark before the first paint (the pages' content security
// policy allows no inline script, and the product host serves only a fixed list of files: server/index.js
// PRODUCT_HOST_PATHS). Everything else waits for the page to be read.
// The product's name, the contact address and the base domain come from the host (GET /api/product, public), so the
// page never hard-codes a name while the name is still being chosen.

// --- Light or dark, before the first paint ---------------------------------------------------------------------------
// Light for anyone who has not chosen, whatever the browser prefers. The header's Light / Dark switch keeps a choice in
// this browser (localStorage 'landing.theme'); without storage the page is light and the switch still works for the visit.
// landing.css keys the dark palette on <html data-theme="dark">, and shows the switch only once data-theme is set.
const THEME_KEY = 'landing.theme';
function savedTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.content = theme === 'dark' ? '#0E1A2B' : '#FBF6EC'; // the page ground of each palette (landing.css)
}
setTheme(savedTheme());

// --- The parts that need nothing from the host (tools/landing-preview.mjs copies everything down to the host line) ---
// The switch names what it turns the page to: a moon and "Dark" on a light page, a sun and "Light" on a dark one.
function themeSwitch() {
  const button = document.getElementById('theme-switch');
  if (!button) return;
  const label = () => {
    const name = document.documentElement.dataset.theme === 'dark' ? 'Light' : 'Dark';
    button.setAttribute('aria-label', name);
    button.title = name;
  };
  label();
  button.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // no storage: the choice lasts for this visit
    }
    label();
  });
}

// The walkthrough (See it in action): the screens crossfade by themselves in CSS, 10 seconds round. This only adds the
// controls: Pause, and a button for each screen, which stops the animation and shows that screen. Without this script the
// animation still runs; with reduced motion it starts still, on the first screen.
function tour() {
  const box = document.getElementById('tour-box');
  const bar = document.getElementById('tour-bar');
  if (!box || !bar) return;
  const frames = [...box.querySelectorAll('.tour-frame')];
  const tabs = [...bar.querySelectorAll('[data-frame]')];
  const toggle = document.getElementById('tour-toggle');
  bar.hidden = false;
  const show = (n) => {
    box.classList.remove('paused');
    box.classList.add('manual');
    toggle.textContent = 'Play';
    frames.forEach((f, i) => f.classList.toggle('on', i === n));
    tabs.forEach((t, i) => (i === n ? t.setAttribute('aria-current', 'true') : t.removeAttribute('aria-current')));
  };
  for (const t of tabs) t.addEventListener('click', () => show(Number(t.dataset.frame)));
  toggle.addEventListener('click', () => {
    if (box.classList.contains('manual')) { // back to the animation
      box.classList.remove('manual');
      toggle.textContent = 'Pause';
      tabs.forEach((t) => t.removeAttribute('aria-current'));
      return;
    }
    const paused = box.classList.toggle('paused');
    toggle.textContent = paused ? 'Play' : 'Pause';
  });
}

// The bar's lockup: the mark, then the product's name as live text (it follows PRODUCT_NAME). A name that starts with
// "Coffee Pub " shows the brand in Fraunces and the rest in Figtree, the same size; any other name is all Figtree.
function lockup() {
  for (const el of document.querySelectorAll('.brand .brand-name')) {
    const full = el.textContent.trim();
    const rest = full.startsWith('Coffee Pub ') ? full.slice('Coffee Pub '.length).trim() : '';
    if (!rest) { el.textContent = full; continue; }
    const brandWord = document.createElement('span');
    brandWord.className = 'brand-word';
    brandWord.textContent = 'Coffee Pub '; // the space is the word's own, so a phone can drop the word and its space
    const productWord = document.createElement('span');
    productWord.className = 'product-word';
    productWord.textContent = rest;
    el.replaceChildren(brandWord, productWord);
  }
}

function pageParts() {
  themeSwitch();
  tour();
  lockup();
}

// --- The host line: below here the page talks to the host ------------------------------------------------------------
// Each keystroke is checked against GET /api/product/address, after a short pause so a fast typist sends one request.
// Every keystroke first puts the shape hint back, so an earlier answer never stays up for a different name; a reply that
// is not ok (too many checks, 429, or none here) leaves the hint, and the server says on submit. Kept apart from the page
// so tools/check-product-pages.mjs can run it with stubs.
function slugChecker({ say, hint, slugOk, baseDomain, get, wait, cancel }) {
  let token = 0;
  let timer = null;
  return (slug) => {
    cancel(timer);
    const mine = ++token;
    say(hint);
    if (!slugOk(slug)) return;
    timer = wait(async () => {
      try {
        const res = await get(slug);
        if (mine !== token) return;
        if (!res.ok) { say(hint); return; }
        const data = await res.json();
        if (mine !== token) return;
        if (data.free) say(`${slug}.${baseDomain} is free.`);
        else if (data.reason === 'reserved') say(`"${slug}" is reserved. Pick another.`, true);
        else if (data.reason === 'taken') say(`${slug}.${baseDomain} is taken.`, true);
        else say(hint);
      } catch (err) {
        say(hint); // the server says on submit
      }
    }, 250);
  };
}

// What a person typed into Sign in, as an environment's slug: lower case, spaces trimmed, and a full address pasted in
// (with or without https://, a path or a port) cut to its first label. Whether it is a slug at all is the caller's test.
function addressSlug(text) {
  const host = String(text || '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#:@\s]/)[0];
  return host.split('.')[0];
}

const fill = (sel, text) => { for (const el of document.querySelectorAll(sel)) el.textContent = text; };

async function fromHost() {
  let product = { name: 'Coffee Pub', contact: null, baseDomain: '', productDomain: '', version: '' };
  try {
    const res = await fetch('/api/product');
    if (res.ok) product = { ...product, ...(await res.json()) };
  } catch (err) {
    // the defaults stand
  }

  fill('[data-product]', product.name);
  lockup();
  // A use page names its own title: <title data-title="Plan trips together: {name}">; the front page's is the name alone.
  document.title = document.querySelector('title[data-title]')?.dataset.title.replace('{name}', product.name) || product.name;
  for (const img of document.querySelectorAll('[data-product-alt]')) {
    img.alt = product.name;
    // the name in text if the logo cannot load (a host that does not serve the brand folder at its base)
    const showName = () => { img.hidden = true; const name = img.nextElementSibling; if (name) name.classList.remove('sr-only'); };
    if (img.complete && img.naturalWidth === 0) showName();
    img.addEventListener('error', showName);
  }
  fill('[data-version]', product.version ? String(product.version) : '');
  const example = document.querySelector('[data-example-host]');
  if (example && product.baseDomain) example.textContent = `yourname.${product.baseDomain}`;

  // The use cards on the front page: a card links to its page (/travel, /games, /projects) only when this host has that page
  // (GET /api/product's `pages`); otherwise it stays a plain card, still shown as a use.
  const pagePaths = new Set((Array.isArray(product.pages) ? product.pages : []).map((p) => p && p.path));
  for (const card of document.querySelectorAll('.aud[data-page]')) {
    if (!pagePaths.has(card.dataset.page)) continue;
    const go = document.createElement('a');
    go.className = 'aud-go';
    go.href = card.dataset.page;
    go.textContent = `More about ${card.querySelector('h3').textContent.toLowerCase()}`;
    card.append(go);
  }

  // Whether anyone can make an environment from this page (the host's SIGNUP switch, on a host with a base domain). Off,
  // every call to action reads "Coming soon" and does nothing (the author: not ready for this), and the Get started band
  // says so; a contact address, when the host has given one, is still offered as the way to ask.
  const signupOpen = Boolean(product.signup && product.baseDomain);
  const comingSoon = (el) => { el.textContent = 'Coming soon'; el.classList.add('coming-soon'); el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); };

  // The calls to action go to the Get started band (the form, when sign-up is open); the band's own "Ask" link is a mail link.
  for (const a of document.querySelectorAll('[data-contact-link]')) {
    const isAsk = Boolean(a.closest('#start-ask')); // the one link that stays a way to ask while sign-up is off, given an address
    if (!signupOpen && !(isAsk && product.contact)) comingSoon(a);
    else if (isAsk && product.contact) a.href = `mailto:${product.contact}?subject=${encodeURIComponent(`An environment on ${product.name}`)}`;
  }
  const hint = document.querySelector('[data-contact-hint]');
  if (hint) {
    hint.hidden = false;
    hint.textContent = product.contact ? `Or write to ${product.contact}.` : (signupOpen ? '' : 'Sign-up from this page is coming; for now, ask whoever runs this host.');
    hint.hidden = !hint.textContent;
  }

  // --- Sign in: type the address ------------------------------------------------------------------------------------
  // The page lists no environments (plan-product-site.md, decision 1) and takes no password (decision 3): a person types
  // their environment's address, GET /api/product/environment?slug= confirms it is there (it reveals only what visiting
  // the address would), and Go opens that environment's own sign-in page in this tab. Unknown and suspended look the same.
  const envUrl = (slug, path = '/login') => `${location.protocol}//${slug}.${product.baseDomain}${location.port ? `:${location.port}` : ''}${path}`;
  const slugOk = (s) => /^[a-z0-9-]{3,30}$/.test(s);
  const note = document.getElementById('signin-note');
  const sayNote = (text) => { note.textContent = text; note.hidden = !text; };
  const signinForm = document.getElementById('signin-form');
  const field = document.getElementById('signin-env');
  const go = document.getElementById('signin-go');
  const nothingThere = 'There is nothing at that address. Check the spelling.';
  document.querySelector('[data-signin-domain]').textContent = product.baseDomain ? `.${product.baseDomain}` : '';
  if (!product.baseDomain) {
    sayNote('Sign-in from this page needs a base domain; this host has one environment, at its own address.');
    field.disabled = true;
    go.disabled = true;
  }
  field.addEventListener('input', () => sayNote(''));
  signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!product.baseDomain) return;
    const slug = addressSlug(field.value);
    if (!slug) { sayNote('Type your environment\'s address first.'); field.focus(); return; }
    if (!slugOk(slug)) { sayNote(nothingThere); field.focus(); return; }
    go.disabled = true;
    try {
      const res = await fetch(`/api/product/environment?slug=${encodeURIComponent(slug)}`);
      if (res.status === 404) { sayNote(nothingThere); field.focus(); return; }
      if (!res.ok) throw new Error(String(res.status));
      location.href = envUrl(slug);
    } catch (err) {
      sayNote('That address could not be checked just now. Try again.');
    } finally {
      go.disabled = false;
    }
  });

  // --- Plans, from the host's catalog ---------------------------------------------------------------------------------
  // GET /api/product lists the plans (id, name, caps, checkoutUrl). The free plan is what sign-up makes; a plan with a
  // checkout address is bought on the provider's own page (the app never sees a card); one without is not sold online.
  const capLine = (caps) => {
    const c = caps || {};
    const gb = (b) => (b >= 1e9 ? `${Math.round(b / 1e9)} GB` : `${Math.round(b / 1e6)} MB`);
    return [
      c.members ? `${c.members} people` : 'unlimited people',
      c.storageBytes ? `${gb(c.storageBytes)} of storage` : 'unlimited storage',
      c.aiCallsPerMonth ? `${c.aiCallsPerMonth} assistant calls a month` : 'the assistant without a cap',
      c.calls ? `${c.calls} call${c.calls === 1 ? '' : 's'} at once` : 'calls without a cap',
      Array.isArray(c.modules) ? `${c.modules.length} modules` : 'every module',
    ];
  };
  if (Array.isArray(product.plans) && product.plans.length && document.getElementById('plans-grid')) {
    const grid = document.getElementById('plans-grid');
    grid.replaceChildren(...product.plans.map((p) => {
      const box = document.createElement('div');
      box.className = 'plan';
      const h = document.createElement('h3');
      h.textContent = p.name || p.id;
      const ul = document.createElement('ul');
      ul.className = 'plan-caps';
      for (const line of capLine(p.caps)) { const li = document.createElement('li'); li.textContent = line; ul.append(li); }
      box.append(h, ul);
      if (!signupOpen) {
        const a = document.createElement('a'); a.className = 'btn btn-small'; comingSoon(a); box.append(a);
      } else if (p.id === 'free') {
        const a = document.createElement('a'); a.className = 'btn btn-small'; a.href = '#start'; a.textContent = 'Start free'; box.append(a);
      } else if (p.checkoutUrl) {
        const a = document.createElement('a'); a.className = 'btn btn-primary btn-small'; a.href = p.checkoutUrl; a.rel = 'noopener'; a.textContent = `Choose ${p.name || p.id}`; box.append(a);
        const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'Start free, then upgrade from inside your environment.'; box.append(note);
      } else {
        const note = document.createElement('p'); note.className = 'hint'; note.textContent = product.contact ? `Ask at ${product.contact}.` : 'Ask whoever runs this host.'; box.append(note);
      }
      return box;
    }));
  }


  // --- Sign-up: an environment of your own ---------------------------------------------------------------------------
  // POST /api/product/signup makes it on the free plan and answers its address. Off (SIGNUP=off, or no base domain), the
  // section falls back to asking. The slug is checked as it is typed against the address check (GET /api/product/address).
  const signup = document.getElementById('signup-form');
  const ask = document.getElementById('start-ask');
  const startLede = document.getElementById('start-lede');
  if (!signup) {
    // a use page: its Get started links to the front page's form
  } else if (signupOpen) {
    signup.hidden = false;
    document.querySelector('[data-signup-domain]').textContent = `.${product.baseDomain}`;
    const slugInput = document.getElementById('signup-slug');
    const slugNote = document.getElementById('signup-slug-note');
    const status = document.getElementById('signup-status');
    // The Template choice (GET /api/product's `templates`): None, then each with its description; hidden when there are none.
    const templates = (Array.isArray(product.templates) ? product.templates : []).filter((t) => t && typeof t.id === 'string');
    const templateBox = document.getElementById('signup-template');
    if (templates.length) {
      const options = document.getElementById('signup-template-options');
      const option = (id, name, description) => {
        const label = document.createElement('label');
        label.className = 'template-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'template';
        input.value = id;
        input.checked = !id;
        const text = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = name;
        const about = document.createElement('span');
        about.className = 'hint';
        about.textContent = description;
        text.append(strong, about);
        label.append(input, text);
        return label;
      };
      options.replaceChildren(option('', 'None', 'Start plain: the usual words and settings.'), ...templates.map((t) => option(t.id, t.name || t.id, t.description || '')));
      // /?template=travel#start (from a use page) chooses that template, when this host offers it; otherwise None stays chosen
      const wanted = new URLSearchParams(location.search).get('template');
      const wantedInput = wanted && [...options.querySelectorAll('input')].find((i) => i.value === wanted);
      if (wantedInput) wantedInput.checked = true;
      templateBox.hidden = false;
    }
    const say = (text, bad) => { slugNote.textContent = text; slugNote.classList.toggle('error', Boolean(bad)); };
    const hint = 'Letters, digits and hyphens, 3 to 30; it cannot be changed later.';
    const checkSlug = slugChecker({ say, hint, slugOk, baseDomain: product.baseDomain, get: (slug) => fetch(`/api/product/address?slug=${encodeURIComponent(slug)}`), wait: setTimeout, cancel: clearTimeout });
    slugInput.addEventListener('input', () => {
      slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      checkSlug(slugInput.value);
    });
    signup.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        slug: slugInput.value.trim(),
        name: document.getElementById('signup-name').value.trim(),
        ...(templateBox.querySelector('input:checked')?.value ? { template: templateBox.querySelector('input:checked').value } : {}),
        owner: { login: document.getElementById('signup-login').value.trim(), displayName: document.getElementById('signup-display').value.trim(), password: document.getElementById('signup-password').value },
      };
      status.classList.remove('error');
      status.textContent = 'Making it...';
      document.getElementById('signup-submit').disabled = true;
      try {
        const res = await fetch('/api/product/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `could not create it (${res.status})`);
        status.textContent = `Made. Taking you to ${body.slug}.${product.baseDomain} to sign in...`;
        location.href = data.url || envUrl(body.slug, '/login');
      } catch (err) {
        status.classList.add('error');
        status.textContent = err.message;
        document.getElementById('signup-submit').disabled = false;
      }
    });
  } else {
    document.getElementById('start-title').textContent = 'Coming soon';
    ask.hidden = !product.contact; // the mail link is the one way to ask; without an address there is nothing to press
    if (product.contact) ask.querySelector('a').textContent = 'Ask for an environment';
    startLede.textContent = product.baseDomain ? 'Making your own environment from this page is not open yet.' : 'This host is one environment at its own address; there is nothing to sign up for here.';
  }
}

function start() {
  pageParts();
  fromHost();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
