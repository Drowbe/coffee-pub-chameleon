// A new owner's first password (documentation/plans/plan-first-password.md). The address's fragment holds a one-time
// token. Before anything else runs (this module has no static imports, so nothing is loaded ahead of it), the token is
// read and taken out of the address. From then on it lives only in `token` below: never in storage, the page's text, a
// log or another address. The exchange spends it and starts a ten-minute step in a cookie, so a reload can still set
// the password; the set step chooses it and signs in, or hands over to the second step's enrolment. A new link opened
// in a tab that already shows this page changes only the fragment, so the browser stays on the page: the same steps
// run again then (takeNewLink, on hashchange), one link at a time. The set step sends the login the page names, and
// the server refuses it unless the step's cookie is that owner's.

// Every link's token has this form (32 random bytes, base64url); any other fragment is no link and is never sent.
const LINK = /^[A-Za-z0-9_-]{43}$/;

// The address's fragment, taken out of the address (and so out of this history entry).
function takeFragment() {
  const found = location.hash.slice(1);
  if (location.href.includes('#') || location.search) history.replaceState(null, '', location.pathname);
  return found;
}

let token = takeFragment();
const noLinkAtLoad = token !== '' && !LINK.test(token); // a fragment, but not a link's
if (noLinkAtLoad) token = '';

// The words a person reads for every failure of the link, whatever the reason (the server sends the same).
const DEAD = 'This link has expired or was already used. Ask whoever runs this host for a new one.';
const TOO_MANY = 'Too many tries from here. Keep this page open, wait a few minutes, then press Try again.';
const OFFLINE = 'Could not reach the server. Check your connection, then press Try again.';
const MIN = 8;
const MAX = 200;

const $ = (id) => document.getElementById(id);

// The login of this tab's last good exchange: the owner whose step the browser's cookie holds, unless a newer step
// replaced it (then the set step refuses). Kept for this tab only, so a reload still names the owner and can still send
// the login the set step needs. Never the token.
const NAMED = 'app.firstPasswordLogin';
let current = '';
try { current = sessionStorage.getItem(NAMED) || ''; } catch { current = ''; }
const named = () => current;
function setNamed(login) {
  current = login;
  try { if (login) sessionStorage.setItem(NAMED, login); else sessionStorage.removeItem(NAMED); } catch { /* storage off: a reload then cannot name the owner */ }
}

// The app's own pieces (the environment's name, icon, background and light or dark; the Show button), loaded only
// once the token is out of the address.
// The form is shown only once the module has loaded (appPieces), because the Show button's click handler lives in it:
// a person who pressed Show before then would get nothing.
const appPieces = import('/brand.js').then((brand) => { brand.loadBranding().catch(() => {}); }).catch(() => {});

function show(part) {
  for (const id of ['fp-wait', 'fp-choose', 'fp-dead']) $(id).hidden = id !== part;
}

function dead() {
  token = '';
  queued = '';
  show('fp-dead');
  $('fp-dead-text').textContent = DEAD; // after the panel shows, so it is read out as an alert
  $('fp-signin').focus(); // the one way on
}

// One POST of JSON: { status, data }, or status 0 when the server could not be reached.
async function post(url, body) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: {} };
  }
}

async function choose(login) {
  $('fp-error').hidden = true;
  $('fp-error').textContent = '';
  $('fp-password').removeAttribute('aria-invalid');
  $('fp-password').setAttribute('aria-describedby', 'fp-rule');
  $('fp-submit').disabled = false;
  $('fp-login').value = login || '';
  $('fp-lede').textContent = login ? `Choose the password you will sign in with as ${login}.` : 'Choose the password you will sign in with.';
  await appPieces;
  if (busy) return; // a newer link began meanwhile; its own answer shows the form
  show('fp-choose');
  $('fp-password').focus();
}

// One exchange at a time. A link that comes while one is being opened waits for it to be answered (only the newest
// waits; one it replaces was never sent, so it still works). So the browser stores the cookies in the order the links
// came, the newest link's last, and the page names the owner of the last exchange that set one.
let busy = false;
let queued = '';
async function exchange() {
  busy = true;
  show('fp-wait');
  $('fp-retry').hidden = true;
  $('fp-wait-text').classList.remove('error');
  $('fp-wait-text').textContent = 'Opening your link...';
  const { status, data } = await post('/api/login/first-password', { token });
  busy = false;
  if (status === 200) {
    // Spent: the cookie the server just set says who this is now. `token` is kept (this page's memory only, gone when
    // it unloads) so the same link opened again in this tab is recognised and ignored (takeNewLink), not sent to be refused.
    setNamed(typeof data.login === 'string' ? data.login : '');
    if (typeof data.environmentName === 'string' && data.environmentName) document.querySelectorAll('[data-brand="environmentName"]').forEach((el) => { el.textContent = data.environmentName; });
  }
  if (queued) {
    token = queued;
    queued = '';
    exchange();
    return;
  }
  if (status === 200) {
    choose(named());
    return;
  }
  if (status === 429 || status === 0) {
    // The link was not looked at, so it may still work: the person can try again from this page.
    $('fp-wait-text').classList.add('error');
    $('fp-wait-text').textContent = status === 429 ? TOO_MANY : OFFLINE;
    $('fp-retry').hidden = false;
    $('fp-retry').focus();
    return;
  }
  dead();
}

$('fp-retry').addEventListener('click', exchange);

$('fp-choose').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('fp-error');
  const field = $('fp-password');
  const say = (text) => {
    error.hidden = false;
    error.textContent = text; // after it shows, so it is read out as an alert
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', 'fp-rule fp-error');
    field.focus();
  };
  error.hidden = true;
  error.textContent = '';
  field.removeAttribute('aria-invalid');
  field.setAttribute('aria-describedby', 'fp-rule');
  const password = field.value;
  if (password.length < MIN) return say(`A password needs at least ${MIN} characters.`);
  if (password.length > MAX) return say(`A password can have at most ${MAX} characters.`);
  $('fp-submit').disabled = true;
  const { status, data } = await post('/api/login/first-password/set', { login: $('fp-login').value, password });
  if (status === 200 || status === 401) setNamed(''); // the step is over, one way or the other
  if (status === 200 && data.mfaRequired) { location.href = `/login/${data.enrol ? 'enrol' : 'verify'}?next=/`; return; } // the second step, as the sign-in page hands over
  if (status === 200) { location.href = '/'; return; }
  $('fp-submit').disabled = false;
  if (status === 401) return dead();
  if (status === 429) return say('Too many tries from here. Wait a few minutes, then try again.');
  if (status === 0) return say('Could not reach the server. Check your connection, then try again.');
  return say(typeof data.error === 'string' && data.error ? data.error : 'That did not work. Try again.');
});

// A new link in the same tab (only the fragment changed, so no new page): take it out of the address and open it, as at
// load. A fragment that is no link (empty, or not a token's form) is taken out and changes nothing: the form, the step
// and what the page shows stay as they are.
function takeNewLink() {
  const found = takeFragment();
  if (!LINK.test(found)) return;
  if (found === token || found === queued) return; // the link in hand, in flight or just spent, or the one waiting: the form stays
  if (busy) { queued = found; return; } // opened once the link in hand is answered
  token = found;
  exchange();
}
window.addEventListener('hashchange', takeNewLink);

// With a link: open it. A fragment that is no link: dead, with nothing sent. Without one (a reload, once the link has
// been opened): the step may still be going, in a cookie this page cannot read, so the form shows, naming the owner
// this tab last opened a link for, and the set step says whether it is.
if (token) exchange();
else if (noLinkAtLoad) dead();
else choose(named());
