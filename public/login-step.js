// The second step of signing in (see plans/plan-mfa.md): /login/verify asks for a code and issues the session;
// /login/enrol sets a required account up first, and the enable answer carries the session. Where to go afterwards is
// `next` in the address, the same as the sign-in page's.
import { loadBranding, api } from '/brand.js';
import { mountEnrolment } from '/mfa-enrol.js';
import { sameSiteNext } from '/next-address.js';
import { word } from '/words.js';

const $ = (id) => document.getElementById(id);
const mode = location.pathname.endsWith('/agree') ? 'agree' : location.pathname.endsWith('/enrol') ? 'enrol' : 'verify';
const next = sameSiteNext(new URLSearchParams(location.search).get('next'));

loadBranding();

if (mode === 'agree') {
  document.title = 'Agree';
  $('agree').hidden = false;
  let docs = [];
  const fail = (text) => { $('agree-error').textContent = text; $('agree-error').hidden = false; };
  // The texts are drawn as text, paragraph by paragraph, never as markup. (The safe Markdown reader lives in
  // /sdk/host.js, which the agreement gate keeps closed until the person has agreed.)
  const draw = (list) => {
    const box = $('agree-docs');
    box.textContent = '';
    for (const d of list) {
      const section = document.createElement('section');
      section.className = 'agree-doc mfa-block';
      const h = document.createElement('h2');
      h.textContent = d.title || d.id;
      section.append(h);
      for (const part of String(d.text || '').split(/\n{2,}/)) {
        if (!part.trim()) continue;
        const p = document.createElement('p');
        p.textContent = part.trim();
        section.append(p);
      }
      box.append(section);
    }
  };
  // The guest door (plan-access-bundle.md, step 4): with no account and the door open, the same page asks for a name and
  // enters through POST /api/guest-door, which records the typed name, the versions and the date.
  let guest = false;
  api('GET', '/api/agreements').then((a) => {
    guest = a.mode === 'guest';
    if (guest) {
      document.title = `Continue as ${word('guest')}`;
      $('agree-lede').textContent = a.required && a.docs.length ? `Read this, then type a name to come in as ${word('guest', { a: true })}.` : `Type a name to come in as ${word('guest', { a: true })}.`;
      $('agree-name').closest('label').firstChild.textContent = 'Your name';
      $('agree-name').autocomplete = 'nickname';
      $('agree-note').textContent = a.required && a.docs.length ? 'Type your name to agree to the text above.' : '';
      $('agree-out').textContent = 'Back to sign in';
      $('agree-out').href = '/login';
      if (!(a.required && a.docs.length)) $('agree-go').lastChild.textContent = ' Continue';
    } else if (!a.required || !a.docs.length) { location.href = next; return; }
    docs = a.docs || [];
    draw(docs);
  }, (err) => fail(err.message));
  $('agree').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('agree-error').hidden = true;
    if (!guest && !docs.length) return;
    const typed = $('agree-name').value.trim();
    if (guest ? !typed : !/\S+\s+\S+/.test(typed)) { fail(guest ? 'Type a name.' : 'Type your first and last name.'); $('agree-name').focus(); return; }
    $('agree-go').disabled = true;
    try {
      const versions = Object.fromEntries(docs.map((d) => [d.id, d.version]));
      if (guest) await api('POST', '/api/guest-door', { name: typed, ...(docs.length ? { versions } : {}) });
      else await api('POST', '/api/agreements/accept', { versions });
      location.href = guest && next === '/' ? '/guest' : next;
    } catch (err) {
      fail(err.status === 409 ? 'The text has changed. It is shown again below; read it, then agree.' : err.message);
      if (err.status === 409) api('GET', '/api/agreements').then((a) => { docs = a.docs; draw(docs); }, () => {});
      $('agree-go').disabled = false;
    }
  });
} else if (mode === 'verify') {
  $('verify').hidden = false;
  let recovery = false;
  $('use-recovery').addEventListener('click', () => {
    recovery = !recovery;
    $('code-label').firstChild.textContent = recovery ? 'Recovery code' : 'Code';
    $('verify-lede').textContent = recovery ? 'One of the recovery codes you saved when you set the app up. It works once.' : 'One more step: the six digits your authenticator app shows.';
    $('use-recovery').textContent = recovery ? 'Use the app instead' : 'Use a recovery code instead';
    $('code').value = '';
    $('code').focus();
  });
  $('verify').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('error').hidden = true;
    try {
      await api('POST', '/api/login/verify', { code: $('code').value.trim(), remember: $('remember').checked });
      location.href = next;
    } catch (err) {
      $('error').textContent = err.status === 401 && !/\S/.test(err.message || '') ? 'That code is not right.' : err.message;
      $('error').hidden = false;
      $('code').select();
    }
  });
} else {
  $('enrol').hidden = false;
  mountEnrolment($('enrol-block'), {
    start: '/api/me/mfa/start',
    enable: '/api/me/mfa/enable',
    onDone: () => { location.href = next; },
  });
}
