// A new owner's first password (documentation/plans/plan-first-password.md). The address's fragment holds a one-time
// token. Before anything else runs (this module has no static imports, so nothing is loaded ahead of it), the token is
// read and taken out of the address. From then on it lives only in `token` below: never in storage, the page's text, a
// log or another address. The exchange spends it and starts a ten-minute step in a cookie, so a reload can still set
// the password; the set step chooses it and signs in, or hands over to the second step's enrolment. A new link opened
// in a tab that already shows this page changes only the fragment, so the browser stays on the page: the same steps
// run again then (takeNewLink, on hashchange).

// The address's fragment, taken out of the address (and so out of this history entry): the link's token, or ''.
function takeFragment() {
  const found = location.hash.slice(1);
  if (location.href.includes('#') || location.search) history.replaceState(null, '', location.pathname);
  return found.length > 512 ? '' : found; // no link is this long: treated as no link
}

let token = takeFragment();

// The words a person reads for every failure of the link, whatever the reason (the server sends the same).
const DEAD = 'This link has expired or was already used. Ask whoever runs this host for a new one.';
const TOO_MANY = 'Too many tries from here. Keep this page open, wait a few minutes, then press Try again.';
const OFFLINE = 'Could not reach the server. Check your connection, then press Try again.';
const MIN = 8;
const MAX = 200;

const $ = (id) => document.getElementById(id);

// The app's own pieces (the environment's name, icon, background and light or dark; the Show button), loaded only
// once the token is out of the address.
import('/brand.js').then((brand) => brand.loadBranding()).catch(() => {});

function show(part) {
  for (const id of ['fp-wait', 'fp-choose', 'fp-dead']) $(id).hidden = id !== part;
}

function dead() {
  token = '';
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

function choose(login) {
  $('fp-error').hidden = true;
  $('fp-error').textContent = '';
  $('fp-password').removeAttribute('aria-invalid');
  $('fp-password').setAttribute('aria-describedby', 'fp-rule');
  $('fp-submit').disabled = false;
  $('fp-login').value = login || '';
  $('fp-lede').textContent = login ? `Choose the password you will sign in with as ${login}.` : 'Choose the password you will sign in with.';
  show('fp-choose');
  $('fp-password').focus();
}

let exchanges = 0; // a newer link's exchange makes an older one's answer moot
async function exchange() {
  const mine = ++exchanges;
  show('fp-wait');
  $('fp-retry').hidden = true;
  $('fp-wait-text').classList.remove('error');
  $('fp-wait-text').textContent = 'Opening your link...';
  const { status, data } = await post('/api/login/first-password', { token });
  if (mine !== exchanges) return;
  if (status === 200) {
    token = ''; // spent: the cookie the server just set says who this is now
    if (typeof data.environmentName === 'string' && data.environmentName) document.querySelectorAll('[data-brand="environmentName"]').forEach((el) => { el.textContent = data.environmentName; });
    choose(typeof data.login === 'string' ? data.login : '');
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
  const { status, data } = await post('/api/login/first-password/set', { password });
  if (status === 200 && data.mfaRequired) { location.href = `/login/${data.enrol ? 'enrol' : 'verify'}?next=/`; return; } // the second step, as the sign-in page hands over
  if (status === 200) { location.href = '/'; return; }
  $('fp-submit').disabled = false;
  if (status === 401) return dead();
  if (status === 429) return say('Too many tries from here. Wait a few minutes, then try again.');
  if (status === 0) return say('Could not reach the server. Check your connection, then try again.');
  return say(typeof data.error === 'string' && data.error ? data.error : 'That did not work. Try again.');
});

// A new link in the same tab (only the fragment changed, so no new page): take it out of the address and open it, as at
// load. A fragment that is no link is taken out and changes nothing.
function takeNewLink() {
  const found = takeFragment();
  if (!found) return;
  token = found;
  exchange();
}
window.addEventListener('hashchange', takeNewLink);

// With a link: open it. Without one (a reload, once the link has been opened): the step may still be going, in a
// cookie this page cannot read, so the form shows and the set step says whether it is.
if (token) exchange();
else choose('');
