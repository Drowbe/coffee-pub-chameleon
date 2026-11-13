// The guest's two screens, one page (/guest). The landing says who they are and what they can't do, with Continue to Home and a
// small Leave. Home (/guest#home) lists the spaces open to them, each with Open, or those they may ask for. Everything comes from
// GET /api/guest-door and is drawn as text. It is read again every 12 seconds while the page is open and visible, so an answer
// to a request (approved, declined) or a space opened or closed shows without a reload. No guest session goes to the agreement
// and name page (the server redirects).
import { loadBranding, api, noticeToast } from '/brand.js';
import { word } from '/words.js';

const $ = (id) => document.getElementById(id);
loadBranding().then(() => showView()); // the Home word comes with the branding

const onHome = () => location.hash === '#home';
function showView() {
  const home = onHome();
  $('guest-landing').hidden = home;
  $('guest-home').hidden = !home;
  $('guest-home-title').textContent = word('home');
  document.title = home ? word('home') : 'Welcome';
}

function draw(answer) {
  $('guest-hello').textContent = `You are in as ${answer.guest.name}.`;
  const list = $('guest-unavailable');
  list.textContent = '';
  for (const text of answer.unavailable || []) {
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
  }
  const box = $('guest-spaces');
  box.textContent = '';
  if (!answer.spaces.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = answer.none;
    box.append(p);
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'guest-space-list';
  for (const space of answer.spaces) {
    const li = document.createElement('li');
    if (space.state === 'request' || space.state === 'pending') {
      li.append(askRow(space));
      ul.append(li);
      continue;
    }
    const row = document.createElement('a');
    row.className = 'guest-space';
    row.href = `/guest/${encodeURIComponent(space.id)}`;
    if (space.hasImage) {
      const img = document.createElement('img');
      img.src = `/img/space/${encodeURIComponent(space.id)}`;
      img.alt = '';
      img.width = 32;
      img.height = 32;
      row.append(img);
    }
    const name = document.createElement('span');
    name.textContent = space.name;
    row.append(name);
    const go = document.createElement('span');
    go.className = 'guest-space-go guest-space-open';
    go.textContent = 'Open';
    row.append(go);
    li.append(row);
    ul.append(li);
  }
  box.append(ul);
}

// A space the visitor may only ask to enter: its picture, name and description (text), and Request access, or Requested with
// Withdraw, or Declined with no button. Not a link: there is nothing to enter yet.
function askRow(space) {
  const row = document.createElement('div');
  row.className = 'guest-space guest-space-ask';
  if (space.hasImage) {
    const img = document.createElement('img');
    img.src = `/img/space/${encodeURIComponent(space.id)}`;
    img.alt = '';
    img.width = 32;
    img.height = 32;
    row.append(img);
  }
  const text = document.createElement('span');
  text.className = 'guest-space-text';
  const name = document.createElement('strong');
  name.textContent = space.name;
  text.append(name);
  if (space.description) {
    const d = document.createElement('span');
    d.className = 'hint';
    d.textContent = space.description;
    text.append(d);
  }
  row.append(text);
  const actions = document.createElement('span');
  actions.className = 'guest-space-actions';
  const pending = space.state === 'pending';
  const declined = !pending && space.answer === 'denied';
  if (pending || declined) {
    const state = document.createElement('span');
    state.className = 'guest-space-state';
    state.textContent = pending ? 'Requested' : 'Not this time';
    actions.append(state);
    if (declined) {
      const again = document.createElement('span');
      again.className = 'hint';
      again.textContent = 'You can ask again tomorrow.';
      actions.append(again);
    }
  }
  if (!declined) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = pending ? 'btn' : 'btn btn-primary';
    const icon = document.createElement('i');
    icon.className = `fa-solid ${pending ? 'fa-rotate-left' : 'fa-hand'} fa-fw`;
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon, document.createTextNode(pending ? ' Withdraw' : ' Request access'));
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        // Withdraw reads the server first: an answer may have come since this page was drawn (approved or declined), and then
        // there is nothing to take back; the page shows what is true instead. An approved request stays approved.
        if (pending) {
          const now = (await api('GET', '/api/guest-door')).spaces.find((s) => s.id === space.id);
          if (!now || now.state !== 'pending') { await load(); return; }
        }
        await api(pending ? 'DELETE' : 'POST', `/api/spaces/${encodeURIComponent(space.id)}/request`);
      } catch (err) {
        if (!(pending && err.status === 404)) noticeToast(err.message || "Couldn't send that. Try again.", { kind: 'danger' });
      }
      load();
    });
    actions.append(button);
  }
  row.append(actions);
  return row;
}

let shown = '';
function load() {
  return api('GET', '/api/guest-door').then((answer) => {
    $('guest-error').hidden = true;
    const snapshot = JSON.stringify([answer.guest, answer.spaces, answer.none]);
    if (snapshot === shown) return; // nothing changed: no redraw, so a button being pressed is not swapped under the pointer
    shown = snapshot;
    draw(answer);
  }, (err) => {
    if (err.status === 401) { location.href = '/agree?next=%2Fguest'; return; }
    $('guest-error').textContent = err.message;
    $('guest-error').hidden = false;
  });
}
showView();
load();
window.addEventListener('hashchange', showView);
$('guest-continue').addEventListener('click', () => { location.hash = '#home'; });
// A gentle read again while the page is open and visible (and once more when it comes back into view).
const POLL_MS = 12000;
setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
$('guest-leave').addEventListener('click', async () => {
  try { await api('DELETE', '/api/guest-door'); } catch { /* the cookie is cleared by the answer, or it is already gone */ }
  location.href = '/login';
});
