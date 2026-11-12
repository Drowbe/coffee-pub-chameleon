import { loadBranding, api } from '/brand.js';
import { sameSiteNext } from '/next-address.js';

const $ = (id) => document.getElementById(id);
loadBranding().then((b) => {
  $('register-note').hidden = !b.allowRegistration;
  // The guest door: both switches are on (the host's and the owner's), so branding says so.
  $('guest-door').hidden = b.guestDoor !== true;
  // The policy says everyone signs in in two steps: say so before the password is typed.
  if (b.mfaRequired && b.mfaOffered !== false) { $('mfa-note').textContent = 'You will be asked for a code from your authenticator app after this.'; $('mfa-note').hidden = false; }
});

// ?login=<login> fills the login in (sign-up's answer sends the new owner here that way), so only the password is typed.
{
  const params = new URLSearchParams(location.search);
  if (params.get('login')) $('login-name').value = params.get('login').slice(0, 40);
}

$('login').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('error').hidden = true;
  try {
    const res = await api('POST', '/api/login', { login: $('login-name').value.trim(), password: $('password').value });
    const safeNext = sameSiteNext(new URLSearchParams(location.search).get('next'));
    // A second step: the code page, or enrolment first for an account the policy requires to have one (the pending
    // token that says who this is is in a cookie the server just set).
    if (res && res.mfaRequired) { location.href = `/login/${res.enrol ? 'enrol' : 'verify'}?next=${encodeURIComponent(safeNext)}`; return; }
    location.href = safeNext;
  } catch (err) {
    $('error').textContent = err.message;
    $('error').hidden = false;
  }
});
