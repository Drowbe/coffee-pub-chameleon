// The second step of signing in (see plans/plan-mfa.md): /login/verify asks for a code and issues the session;
// /login/enrol sets a required account up first, and the enable answer carries the session. Where to go afterwards is
// `next` in the address, the same as the sign-in page's.
import { loadBranding, api } from '/brand.js';
import { mountEnrolment } from '/mfa-enrol.js';
import { sameSiteNext } from '/next-address.js';

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
  api('GET', '/api/agreements').then((a) => {
    if (!a.required || !a.docs.length) { location.href = next; return; }
    docs = a.docs;
    draw(docs);
  }, (err) => fail(err.message));
  $('agree').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('agree-error').hidden = true;
    if (!docs.length) return;
    if (!/\S+\s+\S+/.test($('agree-name').value.trim())) { fail('Type your first and last name.'); $('agree-name').focus(); return; }
    $('agree-go').disabled = true;
    try {
      await api('POST', '/api/agreements/accept', { versions: Object.fromEntries(docs.map((d) => [d.id, d.version])) });
      location.href = next;
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
