// The landing after the guest door (/guest): the spaces open to this visitor, what they can't do, and Leave. Everything comes from
// GET /api/guest-door and is drawn as text. No guest session goes to the agreement and name page (the server redirects).
import { loadBranding, api, noticeToast } from '/brand.js';
import { word } from '/words.js';

const $ = (id) => document.getElementById(id);
loadBranding();

function draw(answer) {
  $('guest-hello').textContent = `You are in as ${answer.guest.name} (${word('guest')}).`;
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
    const go = document.createElement('i');
    go.className = 'fa-solid fa-chevron-right guest-space-go';
    go.setAttribute('aria-hidden', 'true');
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
    state.textContent = pending ? 'Requested' : 'Declined';
    actions.append(state);
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
        await api(pending ? 'DELETE' : 'POST', `/api/spaces/${encodeURIComponent(space.id)}/request`);
      } catch (err) {
        noticeToast(err.message || "Couldn't send that. Try again.", { kind: 'danger' });
      }
      load();
    });
    actions.append(button);
  }
  row.append(actions);
  return row;
}

function load() {
  return api('GET', '/api/guest-door').then(draw, (err) => {
    if (err.status === 401) { location.href = '/agree?next=%2Fguest'; return; }
    $('guest-error').textContent = err.message;
    $('guest-error').hidden = false;
  });
}
load();
$('guest-leave').addEventListener('click', async () => {
  try { await api('DELETE', '/api/guest-door'); } catch { /* the cookie is cleared by the answer, or it is already gone */ }
  location.href = '/login';
});
